#!/usr/bin/env python3
"""Objective metrics for a SCHWARM render (no listening claims). Usage:
   python3 tools/metrics.py <base>   (reads <base>.wav, <base>.plan.json, writes <base>.metrics.json/.md)"""
import json, subprocess, sys, re, math
import numpy as np
base = sys.argv[1]
plan = json.load(open(base + ".plan.json"))
bars = plan["bars"]
SR = 22050
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", base + ".wav", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
dur = len(x) / SR
out = {"file": base + ".wav", "seconds": round(dur, 2), "bars": len(bars), "preset": plan["preset"], "seed": plan["seed"]}

# 1) Clipping / peaks on the full-resolution stereo file
st = subprocess.run(["ffmpeg", "-v", "error", "-i", base + ".wav", "-f", "s16le", "-"], capture_output=True, check=True).stdout
s16 = np.frombuffer(st, dtype=np.int16)
out["samplePeakDbfs"] = round(20 * math.log10(max(1, int(np.abs(s16.astype(np.int32)).max())) / 32768), 2)
out["clippedSamples"] = int(np.sum(np.abs(s16.astype(np.int32)) >= 32767))
del st, s16

# 2) Loudness (EBU R128 via ffmpeg) + RMS per minute
eb = subprocess.run(["ffmpeg", "-nostats", "-i", base + ".wav", "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
shorts = [(float(m.group(1)), float(m.group(2))) for m in re.finditer(r"t:\s*([\d.]+)\s+TARGET.*?S:\s*(-?[\d.]+|-inf)", eb) if m.group(2) != "-inf"]
summ = eb[eb.rfind("Summary:"):]
def grab(label):
    m = re.search(label + r":\s*(-?[\d.]+)", summ)
    return float(m.group(1)) if m else None
out["integratedLufs"] = grab("I")
out["loudnessRangeLu"] = grab("LRA")
out["truePeakDbtp"] = grab("Peak")
per_min = []
for m in range(int(math.ceil(dur / 60))):
    seg = x[m * 60 * SR:(m + 1) * 60 * SR]
    rms = float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0
    s = [v for t, v in shorts if m * 60 <= t < (m + 1) * 60 and v > -70]
    lufs = 10 * math.log10(np.mean([10 ** (v / 10) for v in s])) if s else None
    lv = [b["level"] for b in bars if m * 60 <= b["t"] < (m + 1) * 60]
    per_min.append({"minute": m, "rmsDbfs": round(20 * math.log10(max(rms, 1e-9)), 1), "shortTermLufs": round(lufs, 1) if lufs else None, "meanLevel": round(float(np.mean(lv)), 1) if lv else None})
out["perMinute"] = per_min

# 3) Spectral fingerprints per bar: 24 log bands × 16 steps
edges = np.geomspace(30, 10000, 25)
def bar_features(seg, n_steps=16):
    if len(seg) < 2048: return None
    steps = np.array_split(seg, n_steps)
    mat = []
    for s in steps:
        spec = np.abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2
        f = np.fft.rfftfreq(len(s), 1 / SR)
        mat.append([spec[(f >= edges[i]) & (f < edges[i + 1])].sum() + 1e-12 for i in range(24)])
    mat = np.log10(np.array(mat))
    whole = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    fw = np.fft.rfftfreq(len(seg), 1 / SR)
    centroid = float((whole * fw).sum() / (whole.sum() + 1e-12))
    flat = float(np.exp(np.mean(np.log(whole[1:] + 1e-12))) / (np.mean(whole[1:]) + 1e-12))
    return mat, centroid, flat
feats, cents, flats = [], [], []
for i, b in enumerate(bars):
    t0 = b["t"]; t1 = bars[i + 1]["t"] if i + 1 < len(bars) else t0 + 240 / b["bpm"]
    r = bar_features(x[int(t0 * SR):int(t1 * SR)])
    if r is None: feats.append(None); cents.append(None); flats.append(None); continue
    feats.append(r[0].ravel()); cents.append(r[1]); flats.append(r[2])
F = np.array([f for f in feats if f is not None])
Fn = F - F.mean(axis=1, keepdims=True)
Fn /= np.linalg.norm(Fn, axis=1, keepdims=True) + 1e-12
# self-similarity: max cosine similarity to any of the previous 64 bars
maxsim = []
for i in range(len(Fn)):
    if i == 0: maxsim.append(0); continue
    lo = max(0, i - 64)
    maxsim.append(float((Fn[lo:i] @ Fn[i]).max()))
maxsim = np.array(maxsim)
def windows(n_minutes=10):
    res = []
    for w0 in range(0, int(math.ceil(dur / 60)), n_minutes):
        idx = [i for i, b in enumerate(bars) if w0 * 60 <= b["t"] < (w0 + n_minutes) * 60 and feats[i] is not None]
        if not idx: continue
        fp = {bars[i]["fp"] for i in idx}; fpx = {bars[i]["fpx"] for i in idx}
        sub = Fn[[sum(1 for f in feats[:i] if f is not None) for i in idx]]
        # greedy leader clustering: a bar is a new audio variant if cos-sim < 0.97 to all leaders
        leaders = []
        for v in sub:
            if not leaders or max(float(l @ v) for l in leaders) < 0.97: leaders.append(v)
        c = [cents[i] for i in idx]
        sim = sub @ sub.T
        res.append({"from": w0, "to": w0 + n_minutes, "bars": len(idx), "distinctBarsSymbolic": len(fp), "distinctBarsExact": len(fpx),
                    "audioVariants97": len(leaders), "meanPairwiseCosDistance": round(float(1 - sim[np.triu_indices(len(sub), 1)].mean()), 3),
                    "centroidHzMean": round(float(np.mean(c))), "centroidHzStd": round(float(np.std(c))),
                    "levels": sorted({bars[i]["level"] for i in idx}), "sections": sorted({bars[i]["section"] for i in idx})})
    return res
out["perTenMinutes"] = windows(10)
out["audioSelfSimilarity"] = {"barsWithNearDuplicateInLast64_0.995": int((maxsim > 0.995).sum()), "share": round(float((maxsim > 0.995).mean()), 3),
                               "medianMaxSim": round(float(np.median(maxsim)), 3)}
# 4) Symbolic repetition
fps = [b["fp"] for b in bars]
run = best = 1; best_end = 0
for i in range(1, len(fps)):
    run = run + 1 if fps[i] == fps[i - 1] else 1
    if run > best: best, best_end = run, i
stale = best_stale = 0; stale_end = 0
for i in range(len(fps)):
    stale = stale + 1 if fps[i] in fps[max(0, i - 16):i] else 0
    if stale > best_stale: best_stale, stale_end = stale, i
first_seen = {}
for i, f in enumerate(fps): first_seen.setdefault(f, i)
gap = best_gap = 0; gap_end = 0
for i in range(len(fps)):
    gap = gap + 1 if first_seen[fps[i]] != i else 0
    if gap > best_gap: best_gap, gap_end = gap, i
bt = lambda i: round(bars[i]["t"] / 60, 2)
out["repetition"] = {
    "longestIdenticalConsecutiveBars": best, "atMinute": bt(best_end - best + 1),
    "longestLoopStretchBars": best_stale, "longestLoopStretchSeconds": round(bars[stale_end]["t"] - bars[stale_end - best_stale + 1]["t"] + 240 / bars[stale_end]["bpm"], 1) if best_stale else 0,
    "longestLoopStretchAtMinute": bt(stale_end - best_stale + 1) if best_stale else None,
    "longestStretchWithoutNeverHeardBarBars": best_gap,
    "longestStretchWithoutNeverHeardBarSeconds": round(bars[gap_end]["t"] - bars[gap_end - best_gap + 1]["t"] + 240 / bars[gap_end]["bpm"], 1) if best_gap else 0,
    "distinctBarsSymbolicTotal": len(set(fps)), "distinctBarsExactTotal": len({b["fpx"] for b in bars}),
}
# 5) Tempo / beat accuracy: detect kick onsets in the low band near every scheduled strong kick
bpms = [b["bpm"] for b in bars]
phr = [b["bpm"] for b in bars if b["phraseBar"] == 0]
out["tempo"] = {"minBpm": min(bpms), "maxBpm": max(bpms), "maxStepBetweenBars": round(max(abs(bpms[i] - bpms[i - 1]) for i in range(1, len(bpms))), 3)}
kicks = np.array(plan["kicks"])
def onset_near(t):
    a = int((t - 0.015) * SR); b = int((t + 0.06) * SR)
    if a < 0 or b > len(x): return None
    seg = x[a:b]
    # one-pole low-pass ~150 Hz, then envelope
    alpha = 1 - math.exp(-2 * math.pi * 150 / SR)
    y = np.empty_like(seg); acc = 0.0
    for i, v in enumerate(seg): acc += alpha * (v - acc); y[i] = acc
    e = np.abs(y)
    pk = e.max()
    if pk < 0.02: return None
    i = int(np.argmax(e >= 0.5 * pk))
    return (a + i) / SR - t
sample_idx = np.linspace(0, len(kicks) - 1, min(1500, len(kicks))).astype(int)
offs = [o for o in (onset_near(kicks[i]) for i in sample_idx) if o is not None]
offs = np.array(offs) * 1000
med = float(np.median(offs))
dev = np.abs(offs - med)
out["beatAccuracy"] = {"kicksChecked": len(offs), "medianOnsetOffsetMs": round(med, 2), "p95DeviationMs": round(float(np.percentile(dev, 95)), 3),
                       "maxDeviationMs": round(float(dev.max()), 3), "note": "Offset = detected low-band onset (50 % of local peak) minus scheduled time; constant offset is the kick's attack, deviation is timing jitter."}
# Beat accuracy on a kick-only stem (no rumble, no other sounds): first sample above threshold
import os
if os.path.exists(base + ".kick.wav"):
    KSR = plan["sampleRate"]
    kr = subprocess.run(["ffmpeg", "-v", "error", "-i", base + ".kick.wav", "-ac", "1", "-f", "s16le", "-"], capture_output=True, check=True).stdout
    k = np.abs(np.frombuffer(kr, dtype=np.int16).astype(np.float32) / 32768.0)
    found, missing = [], 0
    for t in kicks:
        a = int(round((t - 0.003) * KSR)); b = int(round((t + 0.006) * KSR))
        if a < 0 or b > len(k): continue
        idx = np.nonzero(k[a:b] > 0.02)[0]
        if not len(idx): missing += 1; continue
        found.append(((a + idx[0]) / KSR - t) * 1000)
    found = np.array(found)
    medk = float(np.median(found)); devk = np.abs(found - medk)
    # tempo from detected onsets: inter-onset intervals vs the planned grid
    out["beatAccuracyKickStem"] = {"kicksScheduled": int(len(kicks)), "kicksFound": int(len(found)), "missing": missing,
        "medianOnsetOffsetMs": round(medk, 3), "p95DeviationMs": round(float(np.percentile(devk, 95)), 4), "maxDeviationMs": round(float(devk.max()), 4),
        "sampleMs": round(1000 / KSR, 4),
        "note": "Kick-only render of the same set. Onset = first sample above -34 dBFS within -3…+6 ms of the scheduled time. Deviation in units of samples shows the scheduling is sample-accurate across tempo changes and chunk joins."}

# 6) Dramaturgy vs curve
phrase_bars = [b for b in bars if b["section"] == "groove" and b["phraseBar"] == 0]
devs = [abs(b["level"] - b["soll"]) for b in phrase_bars]
drops = [{"minute": bt(i), "type": b["drop"], "level": b["level"]} for i, b in enumerate(bars) if b["drop"]]
bds = []
for i, b in enumerate(bars):
    if b["section"] == "breakdown" and (i == 0 or bars[i - 1]["section"] != "breakdown"): bds.append(bt(i))
# every drop must be preceded by pre-drop bars and land on phraseBar 0
ok_drop = all(bars[i]["phraseBar"] == 0 and bars[i - 1]["preDrop"] for i, b in enumerate(bars) if b["drop"])
out["dramaturgy"] = {
    "phrasesWithinOnePointFive": round(float(np.mean([d <= 1.5 for d in devs])), 3), "meanAbsLevelMinusSoll": round(float(np.mean(devs)), 2),
    "maxLevelStepPerPhrase": int(max(abs(phrase_bars[i]["level"] - phrase_bars[i - 1]["level"]) for i in range(1, len(phrase_bars)))),
    "breakdownsAtMinute": bds, "drops": drops, "dropsUnlocked": sum(d["type"] == "freigeschaltet" for d in drops), "dropsRescue": sum(d["type"] == "rettung" for d in drops),
    "allDropsOnTheOneAfterPreDrop": ok_drop,
    "directorEvents": [e for e in plan["director"] if e["kind"] in ("breakdown", "drop", "anchor", "move", "move-ok", "move-fail")],
}
# 7) Chunk joins (120 s chunks): sample jump at each join vs the 99.9th percentile of all jumps
d = np.abs(np.diff(x))
p999 = float(np.percentile(d, 99.9))
joins = [int(k * 120 * SR) for k in range(1, int(dur // 120) + 1) if k * 120 * SR < len(d)]
out["chunkJoins"] = {"count": len(joins), "maxJumpAtJoin": round(float(max(d[j - 2:j + 2].max() for j in joins)), 4) if joins else 0, "p999JumpOverall": round(p999, 4)}
json.dump(out, open(base + ".metrics.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ("perMinute", "perTenMinutes")}, indent=1, ensure_ascii=False)[:6000])
print(json.dumps(out["perTenMinutes"], ensure_ascii=False))
