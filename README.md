# SCHWARM – Phase 1 (Live-Party) auf Phase 0 (Musik-Gate)

**Master:** https://altibo.github.io/Schwarm/ · **Gast:** https://altibo.github.io/Schwarm/guest.html ·
**Blindtest:** https://altibo.github.io/Schwarm/test.html · **Datenschutz:** https://altibo.github.io/Schwarm/privacy.html

SCHWARM ist ein KI-DJ, der mit der Tanzfläche spielt (Konzept „SCHWARM v4“). Phase 0 hat die
Musik-Engine gebaut, Phase 1 bringt die **echte Messung**: Gäste scannen einen QR-Code, ihr Handy
misst in der Tasche die Bewegung, der Master bündelt das live und steuert damit den Drop.

> **Ehrlich:** Getestet ist alles automatisiert in Chromium (headless) mit **künstlichen
> Bewegungsdaten**. Auf echten Handys, in Safari/iOS und mit echten Tänzern ist Phase 1 **ungetestet**.
> Die Schwellen und Lage-Referenzen sind Startwerte, bis das Labor (Konzept §13) misst.

## Ausprobieren mit zwei Handys

1. **Master** (Laptop, Tablet oder Handy, am besten mit Lautsprecher): https://altibo.github.io/Schwarm/
   öffnen → Vorlage wählen (z. B. „10 min · Demo-Welle“) → **„Crowd: Live“**. Es erscheint ein
   großer QR-Code mit 6-stelligem Code. **„Zurück“**, dann **▶ Play**.
2. **Handy 1 (Gast):** QR-Code mit der Kamera scannen (oder `…/guest.html` öffnen und den Code tippen)
   → kurzen Hinweis lesen → **„Mitmachen“** (iPhone fragt nach „Bewegung und Ausrichtung“ →
   erlauben). Nach 2–5 s ist der Bildschirm **schwarz (Taschenmodus)**: Handy in die Hosentasche, tanzen.
3. **Handy 2:** genauso. Auf dem Master steht jetzt „2 zählen“, darunter Energie und Gleichtakt.
4. **Statistik ansehen:** auf dem Gast-Handy **„Statistik“ 2 s gedrückt halten** – Schwarm, Gleichtakt-Ring,
   eigene Werte, Drop-Bereitschaft, Kurve mit „Du bist hier“. „Taschenmodus“ macht wieder schwarz.
5. **Drop freischalten:** beide im Takt wippen. Im Build-up füllt sich die Drop-Bereitschaft; bei 100 %
   fällt der Drop auf die nächste Eins, sonst kommt spätestens nach 3 Blöcken der Rettungs-Drop.
   Vor dem Drop erscheint auf den Gast-Handys **„PHONES UP!“** (Android vibriert), beim Drop **blitzen
   alle Bildschirme gleichzeitig** (höchstens einmal pro Takt). Zum schnellen Ausprobieren:
   „Drop jetzt erzwingen“.
6. **Allein testen:** Master auf dem Handy → „Ich tanze mit“ (Steuerung wird gesperrt, Entsperren
   3 s halten, Stop bleibt sichtbar). Ein Tänzer reicht: Solo-Regel (eigener Takt ≥ 60 % über 16 Takte).
7. **TV-Modus:** im QR-Fenster „TV-Modus“ – große Phase, Drop-Bereitschaft, QR in der Ecke, blitzt
   beim Drop mit. Bluetooth-Lautsprecher? Im QR-Fenster **„Mitklopfen (8×)“** im Takt tippen.

## Phase 1: was dazu kam

- **Sitzung + Beitritt** (`src/net/session.ts`): QR-Link `guest.html?s=<id>#k=<schlüssel>`, 6-stelliger
  Code über eine verschlüsselte Lobby, Einwilligung (deutsch, 3 Sätze, „Raus“ jederzeit, Link zur
  Datenschutzseite), iOS-Bewegungsfreigabe per Tipp, „Nur zuschauen“ ohne Sensor. Beitritt in den
  Tests 1–3,5 s (Ziel < 15 s).
- **Transport** (`src/net/transport.ts`, `src/net/mqtt-lite.ts`): öffentliche MQTT-Broker über WSS
  (shiftr.io, HiveMQ, EMQX) primär, WebRTC über PeerJS (Master als Hub) als Fallback, BroadcastChannel
  für Tests. Ende-zu-Ende-verschlüsselt (AES-GCM, Schlüssel nur im URL-Fragment). Begründung,
  Messwerte und Grenzen: [docs/netz.md](docs/netz.md).
- **Uhrsync** (`src/net/clock.ts`): ≥ 10 Ping-Pongs, kleinste Laufzeit zählt, alle 30 s neu. Der
  Master sendet pro Takt das **gehörte** Raster; Lichtbefehle 1–2 Takte im Voraus.
- **Messung am Gast** (`src/sense.ts`): DeviceMotion `acceleration`, sonst Hochpass 0,3 Hz auf
  `accelerationIncludingGravity` (qᵢ = 0,7); pro Takt eᵢ (gegen Lage-Referenz, persönliche Anpassung
  ±30 % nur aus Fenstern mit Rᵢ ≥ 0,6, Zeitkonstante 30 min), Bewegungsperiode ½/1/2 Schläge, Phase φᵢ′,
  Stabilität Rᵢ über 4 Takte (zufallskorrigiert), Lage Tasche/Hand/hoch/Tisch. Taschenmodus schwarz mit
  Touch-Sperre (2 s halten), Wake Lock, ehrlicher Hinweis nach verdeckter Seite, Akku-Hinweis < 30 %.
- **Aggregation am Master** (`src/aggregate.ts`, `src/party.ts`): O(1) pro Meldung, N, Beteiligung P,
  getrimmte q-gewichtete Energie E, zufallskorrigierter Gleichtakt S, Rayleigh, Median Rᵢ, Phones-up-Quote U;
  Stichprobe ab 150 Geräten. Speist den Director („Crowd: Live“); Regler und Simulation bleiben wählbar.
- **Phones up + Licht**: Licht-Moment vom Build-up-Start bis 8 Takte nach dem Drop (höchstens alle 15 min,
  E eingefroren), „PHONES UP!“, Blitz auf der Eins auf allen Gast-Handys und im TV-Modus, Farbe folgt
  der Energie, ≤ 1 Blitz pro Takt, Reduced Motion: kein Blitz.
- **Teilnehmer-Ansicht** mit echten Daten; eigene Werte aus dem eigenen Sensor.
- **Last-Test** (`swarm.html`): N simulierte Gäste in einem Tab, jeder mit eigener Verbindung, eigener
  Uhr und derselben Messkette.

### Tests (Phase 1)

- Unit (`tests/sense.test.ts`, `tests/aggregate-net.test.ts`): Merkmale (Periode, Phase, Rᵢ, Fallback,
  Lage, Anpassung, Anti-Cheat), Aggregation (Zufallskorrektur und Falsch-Freigaben ≤ 5 % bei N = 5,
  Rayleigh, getrimmtes Mittel, Präsenz, Solo-Serie, Einfrieren, Stichprobe, O(1)-Last), Uhrsync, Krypto,
  Licht-Momente.
- Playwright (`tests/browser/party.spec.ts`), echte Bewegungs-Events (`DeviceMotionEvent`) künstlich erzeugt:
  1 Gast (Solo, lokal), **5 Gäste über shiftr.io** in getrennten Browser-Kontexten, **50 Gäste über
  shiftr.io** (Last-Test-Seite), Phones up + Blitz-Synchronität, Code-Beitritt über die Lobby +
  Neuladen des Masters, **WebRTC/PeerJS**, Layout.

## Phase 0: Was gebaut ist

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
- **Teilnehmer-Ansicht** (`guest.html?preview`): Vorschau, gespeist aus Simulations-Reglern (Phase 1: live mit echten Daten): leuchtender
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
