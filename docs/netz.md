# Netz in Phase 1: Transport, Verschlüsselung, Uhr, Datenschutz

Stand Phase 1 (Prototyp). **Kein eigener Server**: GitHub Pages liefert nur statische Dateien.
Master und Gäste reden darum über einen **öffentlichen, kontolosen Vermittler**. Alles, was
darüber läuft, ist Ende-zu-Ende-verschlüsselt.

## Wahl des Transports

| Option | Bewertung | Rolle |
|---|---|---|
| **Öffentliche MQTT-Broker über WSS** (shiftr.io public, HiveMQ public, EMQX public) | Kein Konto, Pub/Sub passt genau zu „viele Gäste → ein Master, ein Broadcast zurück“, funktioniert hinter Mobilfunk-NAT (nur ausgehende WebSocket/TLS-Verbindung), Fan-out macht der Broker. Nachteile: fremder Dienst ohne SLA, Rate-Limits unbekannt, Laufzeit 50–250 ms. | **Primär** |
| **WebRTC-Datenkanäle, Master als Hub** (PeerJS-Cloud nur für die Signalisierung) | Direkte, schnelle Verbindung (RTT ≈ 1–30 ms im WLAN), Broker sieht nichts. Nachteile: NAT-Traversal scheitert ohne TURN je nach Netz; ein Browser-Tab hält keine Hunderte Peer-Verbindungen. | **Fallback** (kleine Partys) |
| BroadcastChannel | Nur im selben Browser. | Tests, Demo auf einem Gerät |
| Firebase, Ably, Pusher, Supabase … | Brauchen Konto/API-Key, Key läge öffentlich im Code. | verworfen |
| ntfy.sh, Nostr-Relays | Kein Konto, aber Rate-Limits pro IP (ntfy) bzw. ungeeignete Semantik/Speicherung (Nostr speichert Events). | verworfen |

**Ausfallsicherheit:**
- Der **Master verbindet sich mit allen** Brokern **und** registriert sich bei PeerJS (`HubLink`).
  Er empfängt von allen und sendet auf allen.
- Ein **Gast nimmt den ersten, der antwortet** (`ClientLink`: Wettlauf, MQTT zuerst, WebRTC mit
  1,5 s Verzögerung). Ist die Verbindung 8 s weg, beginnt der Wettlauf neu. Die MQTT-Verbindung
  selbst verbindet sich mit Backoff (1–10 s) wieder neu.
- Fällt alles aus, **läuft die Musik weiter** (die Engine ist lokal). Die Gäste laufen mit der
  letzten BPM bis zu 32 Takte frei weiter und dimmen dann. Der Director fährt ohne Messung nur
  nach Kurve (`n = 0` → Ist = Soll − δ, Moves werden nicht bewertet).

**Geprüft vom Testrechner aus (echte Verbindungen):**
- shiftr.io: verbindet in ≈ 0,8 s, RTT ≈ 120–250 ms. Ein Test mit 50 gleichzeitigen Verbindungen
  aus Node kam vollständig an (500 von 500 Nachrichten); der Playwright-Test mit 50 Gästen
  läuft dauerhaft (siehe README).
- PeerJS-Cloud (0.peerjs.com): Signalisierung funktioniert, Datenkanal zwischen zwei
  Browser-Kontexten steht in ≈ 3,5 s.
- HiveMQ (:8884) und EMQX (:8084): **vom Testrechner aus nicht erreichbar**, weil dessen
  Netz ausgehend nur Port 443 durchlässt. Auf Handys im WLAN oder Mobilfunk gehen sie normalerweise
  (ungetestet). Sie bleiben als weitere Fallbacks in der Liste.
- Eigener, kleiner MQTT-3.1.1-Client (`src/net/mqtt-lite.ts`, nur QoS 0) statt mqtt.js: keine
  Abhängigkeit, wenige KB, läuft gleich in Browser und Node.

## Nachrichten (etwa 1 pro Takt und Gast)

| Richtung | Inhalt | Größe (verschlüsselt) |
|---|---|---|
| Gast → Master (`<sid>/up`) | `f`: Takt-Index, eᵢ, φᵢ′, Rᵢ, qᵢ, Lage, p | ≈ 150 B |
| Gast → Master | `hello`, `hb` (Herzschlag alle 8 Takte, wenn nicht gemeldet wird, oder bei Sichtbarkeitswechsel), `ping`, `bye` | < 120 B |
| Master → Gast (`<sid>/g/<id>`) | `pong` (Uhr), `welcome` | < 100 B |
| Master → alle (`<sid>/down`) | `bar`: gehörtes Taktraster (Startzeit, BPM), Phase, Stufe, Kurvenposition, Crowd-Werte, Drop-Bereitschaft, Lichtbefehl, Licht-Moment, Stichprobe p | ≈ 450 B |

**Keine Rohdaten**: die Sensorwerte (60 Hz) bleiben auf dem Handy; gesendet wird nur das
Ergebnis pro Takt.

## Verschlüsselung und Sitzung

- Der Master erzeugt eine **Sitzungs-ID** (10 Zeichen, zufällig), einen **6-stelligen Code**
  und einen **128-bit-Schlüssel**.
- QR-Link: `…/guest.html?s=<sid>#k=<schlüssel>`. Der Teil hinter `#` wird **nie an einen
  Server gesendet** (weder an GitHub Pages noch an den Broker).
- Jede Nachricht: AES-GCM (WebCrypto), zufälliger IV, AAD = Sitzungs-ID. Fremde oder
  veränderte Nachrichten werden verworfen.
- **Code-Beitritt** (ohne Kamera): Der Gast tippt den Code. Gesprochen wird auf dem Thema
  `lobby/<SHA-256(code)>`, verschlüsselt mit einem per PBKDF2 (150 000 Runden) aus dem Code
  abgeleiteten Schlüssel; der Master antwortet mit Sitzungs-ID und Schlüssel. Wer den Code kennt,
  kommt rein – genauso wie jeder, der den QR-Code sieht. Ein Mitleser beim Broker müsste
  den 30-bit-Code offline durchprobieren (Stunden mit GPU). Für eine Party reicht das,
  für öffentliche Events nicht (dann echter Relay, siehe unten). Code-Beitritt geht nur über MQTT.
- Der Master hält Sitzung und Schlüssel in `localStorage`: **Neuladen des Master-Tabs** behält
  die Party; Gäste bleiben verbunden, erkennen die neue Seiten-Epoche und synchronisieren die Uhr neu.
  Der Musik-Zustand (Director) beginnt nach dem Neuladen neu.

## Was der Broker sieht

Zufällige Themen-Namen (`schwarm/v1/<sid>/…`), verschlüsselte Bytes, Zeitpunkte, Größen und
die **IP-Adressen** der Teilnehmer. Der öffentliche shiftr.io-Broker zeigt aktive Themen sogar
in einer öffentlichen Live-Grafik – darum sind die Themen zufällig und die Inhalte verschlüsselt.
Für echte Veranstaltungen ersetzt ein eigener Relay in der EU den öffentlichen Broker (Konzept §4, §12).

## Uhrsync

- NTP-artig: ≥ 10 Ping-Pongs beim Beitritt, danach alle 30 s drei weitere. Die Probe mit der
  **kleinsten Laufzeit** der letzten 24 zählt (`ClockSync`): Versatz = t_master − (t₀ + t₂)/2,
  Fehlergrenze ≤ RTT/2.
- Gemessen auf dem Testrechner (gleiche Uhr, wahrer Versatz 0): über shiftr.io −14 … +12 ms bei
  5 Gästen; bis 60 ms, wenn 50 simulierte Gäste in **einem** Browser-Tab laufen (Event-Loop
  belastet). Über WebRTC/lokal < 1 ms.
- Der Master stempelt jeden Takt mit dem **gehörten** Zeitpunkt (`AudioContext.getOutputTimestamp`
  bzw. `outputLatency`, plus Mitklopf-Kalibrierung). Gäste rechnen das Raster in ihre Uhr um.
- **Lichtbefehle gehen mindestens einen Takt voraus**: Sobald der Director den Pre-Drop
  entscheidet (2 Takte vor dem Drop, beim erzwungenen Drop 1 Takt), steht `dropAt` in der
  Takt-Nachricht. Gäste planen den Blitz lokal auf genau diesen Zeitpunkt.

## Skalierung über den Hub hinaus

- Bis `SAMPLE_TARGET = 150` aktive Geräte meldet jeder Gast jeden Takt.
- Darüber sendet der Master **p = 150 / N** mit. Jeder Gast meldet pro Takt nur mit
  Wahrscheinlichkeit p (Gewicht 1/p) und sonst alle 8 Takte einen Herzschlag. Mittelwerte bleiben
  erwartungstreu; die Zufallskorrektur von S und der Rayleigh-Test nutzen die **Stichprobengröße m**.
  Bei 1 000 Gästen: ≈ 80 Meldungen/s plus ≈ 60 Herzschläge/s am Master statt 530/s.
- Der Weg zu einem echten Relay steht in `skalierung.md`: Sharding nach Gast-ID, additive
  Teil-Aggregate, Pub/Sub-Fan-out für den Rückkanal.
