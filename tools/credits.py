#!/usr/bin/env python3
"""Writes CREDITS.md + public/samples/CREDITS.txt from src/audio/sample-bank.json (one line per shipped file)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
bank = json.loads((root / "src/audio/sample-bank.json").read_text())
CC0 = "CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)"
SOURCES = {
    "tr808": ("Roland TR-808 Sample Set 1.0.0 (1994)", "Michael Fischer (Technopolis); packaged by TidalCycles", "https://github.com/tidalcycles/sounds-tr808-fischer", CC0 + " – LICENSE file of the repository; original README: “these samples are ABSOLUTELY FREE”"),
    "synth-bass-1": ("FreePats Synth Bass #1 (2019-07-23)", "roberto@zenvoid.org (ZynAddSubFX/Yoshimi)", "https://github.com/freepats/synth-bass-1", CC0),
    "electric-bass-YR": ("FreePats Finger Bass YR (2019-09-30)", "Andrea Biasior (Yamaha RBX), edits roberto@zenvoid.org", "https://github.com/freepats/electric-bass-YR", CC0),
    "lately-bass": ("FreePats Lately Bass (2024-03-21)", "Yingchun Soul (Dexed)", "https://github.com/freepats/lately-bass", CC0),
    "sweep-pad": ("FreePats Sweep Pad (2019-08-13)", "roberto@zenvoid.org", "https://github.com/freepats/sweep-pad", CC0),
    "new-age": ("FreePats New Age pad (2019-07-30)", "roberto@zenvoid.org", "https://github.com/freepats/new-age", CC0),
    "synth-pad-bowed": ("FreePats Synth Pad Bowed (2019-07-19)", "Strix SoundFont Team, adapted by roberto@zenvoid.org", "https://github.com/freepats/synth-pad-bowed", CC0),
    "synth-strings-1": ("FreePats Synth Strings #1 (2020-05-28)", "FreePats project (ZynAddSubFX/Yoshimi)", "https://github.com/freepats/synth-strings-1", CC0),
    "synth-pad-choir": ("FreePats Synth Pad Choir (2020-05-16)", "Elf of Happy and Love (快乐爱的小精灵), edits roberto@zenvoid.org", "https://github.com/freepats/synth-pad-choir", CC0),
    "fm-piano1": ("FreePats FM Piano #1 (2019-09-16)", "roberto@zenvoid.org (Hexter DX7 emulation)", "https://github.com/freepats/fm-piano1", CC0),
    "hang-D-minor": ("FreePats Hang in D minor (2022-03-30)", "performer Mar; recorded by Gonzalo & Roberto", "https://github.com/freepats/hang-D-minor", CC0 + ". Note: FreePats advises against pitch-shifting hang notes; SCHWARM shifts the nearest recorded hang note by up to ±2 semitones (measured; riff folded into G3–D5), so its background resonance is shifted too."),
    "synth-brass-1": ("FreePats Synth Brass #1 (2021-04-26)", "roberto@zenvoid.org", "https://github.com/freepats/synth-brass-1", CC0),
    "synth-fifths": ("FreePats Synth Fifths (2020-05-19)", "Elf of Happy and Love (快乐爱的小精灵), edits roberto@zenvoid.org", "https://github.com/freepats/synth-fifths", CC0),
}
rows = []
for kind, d in bank["drums"].items():
    rows.append((d["file"], d["source"], d["original"], d["sha256"]))
for inst, i in bank["instruments"].items():
    for z in i["zones"]:
        orig = z["original"] if isinstance(z["original"], str) else " + ".join(z["original"])
        rows.append((z["file"], i["source"], orig, z["sha256"]))
used = sorted({r[1] for r in rows})
md = ["# Credits & Lizenzen der Samples", "",
      "Alle Musik-Samples in `public/samples/` stammen aus den folgenden Quellen. Alle sind unter **CC0 1.0** (Public-Domain-Widmung) veröffentlicht; eine Namensnennung ist rechtlich nicht nötig und erfolgt hier freiwillig.",
      "Die Dateien sind unverändert aus dem BoomStep-Samplesatz übernommen (dort per tools/build-samples.py aufbereitet: Mono-Downmix, Resampling, Onset-Trim, DC-Entfernung, Fade-out, Peak-Normalisierung auf 0,89, 16-bit WAV). Lizenzen am 10.11.2026 erneut über die GitHub-Lizenz-API der Quell-Repositories geprüft: alle CC0-1.0.", "",
      "Eigene Synthese (kein Sample, kein Fremdmaterial): Techno-Kick, Rumble, Acid-/Saw-Bass, Rausch-Hats, Riser, Downlifter, Crash, Impact.", "",
      "## Quellen", ""]
for s in used:
    name, author, url, lic = SOURCES[s]
    md += [f"- **{name}** – {author} – <{url}> – Lizenz: {lic}"]
md += ["", f"## Dateien ({len(rows)})", "", "| Datei | Quelle | Originaldatei | SHA-256 |", "|---|---|---|---|"]
md += [f"| `{f}` | {s} | `{o}` | `{h[:16]}…` |" for f, s, o, h in rows]
(root / "CREDITS.md").write_text("\n".join(md) + "\n")
txt = ["SCHWARM sample credits (all CC0 1.0)", ""] + [f"{SOURCES[s][0]} | {SOURCES[s][1]} | {SOURCES[s][2]} | {SOURCES[s][3]}" for s in used] + ["", "Files:"] + [f"{f}  <=  {s}:{o}" for f, s, o, _ in rows]
(root / "public/samples/CREDITS.txt").write_text("\n".join(txt) + "\n")
print(len(rows), "files,", len(used), "sources")
