# SCHWARM – Phase 0 (Musik-Gate)

**Live:** https://altibo.github.io/Schwarm/ · **Blindtest:** https://altibo.github.io/Schwarm/test.html · **Teilnehmer-Ansicht:** https://altibo.github.io/Schwarm/guest.html

SCHWARM ist ein KI-DJ, der mit der Tanzfläche spielt (Konzept „SCHWARM v4“). Phase 0 baut nur das,
was vor allem anderen geprüft werden muss: **Trägt die selbst erzeugte Musik 60 Minuten?**

> **Ehrlich:** Niemand im Team hat die Musik bisher angehört. Alle Aussagen über Klang stammen aus
> objektiven Messungen (siehe [docs/messwerte.md](docs/messwerte.md)). Ob es gut klingt, entscheidet
> erst der Blindtest mit Menschen. Getestet wurde automatisiert in Chromium (Desktop, headless),
> **nicht** in Safari, nicht auf einem echten Handy, nicht über echte Lautsprecher.

## Was gebaut ist

- **Engine** (`src/audio/mix.ts`, `src/live.ts`): eigene Web-Audio-Engine nach dem BoomStep-Prinzip.
  Look-ahead-Scheduler, alle Klänge auf der Audio-Uhr (sample-genau), Wechsel auf Taktgrenzen.
  Derselbe Mix-Graph rendert live (AudioContext) und offline (OfflineAudioContext).
- **Director** (`src/director.ts`), regelbasiert mit Handprioren (Konzept §8):
  - 16-Takt-Phrasen, Energieleiter 1–10, höchstens 1 Stufe pro Phrase, Hysterese 0,75 über 2 Phrasen
  - Vorhalten: L_ziel = clamp(Ist + δ, Soll − 2, Soll), δ = +1 (Ausklang 0)
  - Tempo 128–138 BPM, höchstens ±1 BPM pro Phrase, nur auf Phrasenanfängen
  - Müdigkeit F (steigt je Phrase über Stufe 6), Pflicht-Breakdown nach 15–25 min auf Stufe ≥ 7,
    Breakdown vor dem Peak jeder Welle, Abwechslungs-Breakdowns
  - Build-ups in 8-Takt-Blöcken, Drop auf die Eins (mit Pause ab Schritt 14 davor):
    **freigeschaltet** (Crowd bereit), **Rettung** (spätestens nach 3 Blöcken) oder **erzwungen**
  - 8 kleine Moves (Hi-Hat, Bass, Swing, Percussion, Filter, Stab, Fill, Acid), Erkundungsrate je
    Phase (Warm-up 20 %, Aufbau 10 %, Peak 0 %, Ausklang 5 %); 2 Fehlschläge → Anker-Groove für 2 Phrasen
- **Crowd-Eingang als Aggregat** (`src/crowd.ts`): `{energy, sync, participation, n}`; Streaming-Summen
  O(1) pro Teilnehmer; Drop-Freigabe je nach N (Solo / kleine Gruppe / Rayleigh). Siehe
  [docs/skalierung.md](docs/skalierung.md).
- **Techno-Pack „Dark Bounce“** (`src/pack/techno.ts`): 10 Stufen, 4 Kick-, 7 Bass-, 5 Hat-, 4 Clap-,
  4 Stab-Varianten, 2 euklidische Percussion-Ebenen (5 Klänge, wechselnde Dichte/Rotation/Tonhöhe),
  generative Ghost-Hats, 7 Akkordfolgen in f-Moll, generative Acid-Linien mit Mutation je 4 Takte,
  „Hymne des Abends“ (wiederkehrendes Motiv), Fills, Riser, Downlifter, Crash, Impact, Filterfahrten,
  Rumble, Sidechain-Pumpen, 3 Anker-Grooves.
- **Hauptansicht** (`index.html`): große Energiekurve mit Soll/Musik/Crowd, Position „jetzt“, Stufe,
  Phase, BPM, Drop-Bereitschaft, Müdigkeit, Play/Stop, Vorlagen (60 min · 1 Welle, 3 h · 2 Wellen,
  10 min Demo), Crowd-Regler (Energie, Gleichtakt, **Anzahl Tänzer 1 … 5 000**) oder Simulation,
  „Drop jetzt erzwingen“ (gelb solange vorgemerkt). Ohne Untermenüs, quer- und hochkant.
- **Blindtest** (`test.html`): deutsches Testformular, spielt das feste Set A (Seed 2026, 60 min),
  „Langweilig“-Taste mit Zeitstempel, Note 1–10 alle 10 Minuten, Modus „Playlist bewerten“ mit Timer,
  Export als JSON/CSV, Gate-Rechner für die Testleitung. Anleitung: [docs/blindtest.md](docs/blindtest.md).
- **Teilnehmer-Ansicht** (`guest.html`): Vorschau, gespeist aus Simulations-Reglern: leuchtender
  Schwarm (Punkte = Tänzer, log-skaliert ab 150), pulsierender Gleichtakt-Ring, Crowd-Energie,
  eigene Werte mit „Du bist im Takt!“, Drop-Bereitschaft, Kurve mit „Du bist hier“. Taschenmodus
  schwarz ohne Animation; Statistik nur auf Knopfdruck.
- **Offline-Render + Messung** (`tools/render.ts`, `tools/metrics.py`).
- **PWA**: alle Seiten und Samples werden beim ersten Besuch gecacht und laufen offline.

## Gestaltung

Glühen und Farben je Energiestufe (blau → violett → magenta → pink). Gelb nur für „vorgemerkt“.
Ein weicher Glow-Puls pro Schlag (höchstens 2,3 Hz, also unter 3 Hz), ein einzelner Blitz beim Drop.
Mit „Bewegung reduzieren“ gibt es keinen Puls und keinen Blitz. Schrift mindestens 11 px,
Bedienelemente mindestens 44 px (automatisch geprüft).

## Entwickeln

```bash
npm ci
npm test               # Unit-Tests (node --test, TypeScript direkt)
npm run lint && npm run typecheck
npm run build
npm run test:browser   # Playwright/Chromium gegen den Produktions-Build
node tools/render.ts 1h 2026 /pfad/schwarm-60min      # Offline-Render (WAV + Plan)
node tools/render.ts 1h 2026 /pfad/schwarm-60min.kick 44100 kick   # nur Kick (Timing-Messung)
python3 tools/metrics.py /pfad/schwarm-60min          # Messwerte (braucht ffmpeg + numpy)
```

## Lizenzen

Alle Samples: CC0 1.0, siehe [CREDITS.md](CREDITS.md) (Quell-Lizenzen am 10.11.2026 erneut geprüft).
Alle übrigen Klänge sind eigene Synthese. Fremdcode: nur Build-/Test-Werkzeuge (Vite, TypeScript,
ESLint, Playwright; MIT/Apache-2.0), nichts davon wird in die App gebündelt außer dem eigenen Code.
