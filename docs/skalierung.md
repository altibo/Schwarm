# Skalierung: von 1 Tänzer bis 1000+ (Plan, noch kein Server)

Stand Phase 0: Es gibt **keinen Server** und **keine echte Messung**. Die App rechnet mit einem
simulierten Crowd-Aggregat. Dieses Dokument legt fest, wie die echten Daten später fließen, damit
Director und Oberflächen schon jetzt richtig gebaut sind.

## Grundsatz: Der Director sieht nur ein Aggregat

```
CrowdInput = { energy (0–10), sync (0–1), participation (0–1), n (≥ 1) }
```

- Kein Director-Code kennt einzelne Personen. Er bekommt pro Takt genau ein `CrowdInput`.
- Gebaut wird es von `CrowdAggregate` (`src/crowd.ts`): laufende, gewichtete Summen
  (Σw, Σw·e, Σw·cos φ, Σw·sin φ, Σw·Stabilität, Anzahl beigetreten/zählend).
  **O(1) pro Teilnehmer-Update, O(1) Speicher**, keine Listen. Zwei Aggregate lassen sich
  addieren, also auch über Shards hinweg zusammenführen.
- `sync` ist für N ≥ 2 die Rayleigh-Länge R = |Σw·e^{iφ}| / Σw.

## Drop-Freigabe hängt von N ab (`unlockRule(n)`)

| N | Modus | Regel |
|---|---|---|
| 1 | **Solo** | Rayleigh ist bei einer Phase sinnlos (R = 1). Stattdessen zählt die **eigene Taktstabilität** des Tänzers (Konstanz seiner Phase über die letzten Takte) ≥ 60 % und Energie ≥ 6. Der Master kann der einzige Teilnehmer sein. |
| 2–4 | Kleine Gruppe | Gleichtakt R ≥ 65 %, Energie ≥ 5,5, mindestens 50 % zählen. Zufälliges Wippen erreicht bei so wenigen Phasen leicht hohe R-Werte, darum die strengere Schwelle. |
| ≥ 5 | Gruppe | R ≥ max(0,35; √(−ln 0,05 / N)) (kritischer Rayleigh-Wert, α = 5 %), Energie ≥ 5, mindestens 40 % zählen. Bei großen N fällt die statistische Schwelle unter die musikalische Untergrenze 0,35. |

Die Schwellen sind **Startwerte** (Handprioren). Im Labor (Konzept §13, Stufe 2) werden die
Falsch-Freigaben bei N = 5, 8, 12 gemessen und die Werte angepasst. Der Rettungs-Drop nach
höchstens 3 Build-Blöcken gilt für jedes N.

## Datenfluss später

1. **Gerät** (Gast oder Master im Modus „Ich tanze jetzt“): rechnet lokal aus dem Bewegungssensor
   pro Fenster (z. B. 2 Takte) eine Zusammenfassung `{energy, phase, stability, weight}`, etwa
   20 Byte. Rohdaten verlassen das Gerät nicht.
2. **Relay**: nimmt Zusammenfassungen an und hält pro Party ein `CrowdAggregate` je Fenster.
3. **Master**: bekommt pro Fenster ein einziges Aggregat (unter 100 Byte), egal wie viele Gäste.
4. **Rückkanal an die Gäste** (Teilnehmer-Ansicht): ebenfalls nur das Aggregat plus Phase und
   Drop-Bereitschaft, als **Broadcast** pro Party, nicht pro Person.

## Wachstumsstufen

| Teilnehmer | Aufbau |
|---|---|
| 1–200 | Ein Relay-Prozess pro Party (WebSocket). Jede Zusammenfassung wird sofort ins Aggregat addiert. |
| 200–5 000 | **Sharding** nach Gast-ID (Hash) auf mehrere Relay-Knoten. Jeder Shard hält sein Teil-Aggregat; ein Koordinator addiert die Teil-Summen einmal pro Fenster (Summen sind additiv). Fan-out des Rückkanals über Pub/Sub (ein Publish pro Fenster, Abonnenten pro Shard). |
| > 5 000 | **Stichprobe**: Oberhalb einer Schwelle (z. B. 2 000 aktive Geräte) senden Geräte nur mit Wahrscheinlichkeit p = 2 000 / N; das Relay gewichtet mit 1/p. Die Unsicherheit von R wächst nur mit 1/√(Stichprobe), die Freigaberegel nutzt dann N_eff = Stichprobengröße. Zusätzlich längere Fenster (4 Takte) und Delta-Kompression. |

- **Rückkanal-Last:** ein Broadcast pro Fenster (etwa alle 3,5 s bei 136 BPM) und Party; über ein
  CDN/Edge-Pub/Sub skaliert das unabhängig von N.
- **Uhren:** Phasen werden relativ zum gehörten Raster gemessen (Konzept §6); die Relay-Uhr ist
  nur für die Fensterzuordnung nötig, nicht für die Musik.
- **Datenschutz:** nur anonyme Fenster-Zusammenfassungen, keine Kamera, keine Rohdaten.

## Was in Phase 0 schon so gebaut ist

- `CrowdAggregate` mit Tests für N = 1, 500 und 10 000 (Streaming-Summen).
- `unlockRule(n)` mit Tests (Solo → kleine Gruppe → Rayleigh-Schwelle sinkt mit N).
- Hauptansicht: Regler **„Anzahl Tänzer“** (1 … 5 000, logarithmisch) mit live angezeigter Regel.
- Teilnehmer-Ansicht: Schwarm-Punkte 1:1 bis 150, darüber logarithmisch (höchstens 420 Punkte,
  „1 Punkt ≈ k Tänzer“), damit auch 1 000+ flüssig und akkuschonend bleibt.

Nicht gebaut: Relay, Sensorik, Sharding, Stichprobe. Alles oben ist ein Plan.
