# Phase 2 – Nach der Nacht, Story-Karten, TV-Licht, Kalibrierung, Fortsetzen

## „Nach der Nacht“ (Master, `report.html`)

- **Aufzeichnung:** Jeder gehörte Takt wird als kompakte Zeile gespeichert: Zeit, Uhrzeit, Soll, Musikstufe, E, S, P, N, Bereitschaft, Abschnitt, Phase, Drop, Move, Phones-up. Dazu kommt das Ereignisprotokoll des Directors.
  - Gespeichert wird **nur lokal**: IndexedDB `schwarm` → `parties`, alle 8 Takte sowie bei Stop, Seitenwechsel und Set-Ende.
  - 3 h sind etwa 2.900 Zeilen, rund 0,5 MB.
- **Auswertung** (`src/report/analyze.ts`, rein regelbasiert, Unit-getestet):
  - **CEI** = 100 · (0,45 · E/10 + 0,35 · S + 0,20 · P) (Konzept §7). Takte ohne Messung (N = 0) haben **keinen** CEI; es wird nichts erfunden.
  - **Soll vs. Ist** pro Takt mit Breakdown- und Build-up-Bändern und Drop-Markern. Beteiligung P, Gleichtakt S und N über die Zeit.
  - **Drops:** Art (freigeschaltet, Rettung, erzwungen), Wartezeit im Build-up, CEI 8 Takte davor und danach.
  - **Breakdowns:** Länge, CEI davor und danach.
  - **Moves:** CEI 8 Takte vor dem Move gegen CEI in Takt 24–32 danach. Davon wird abgezogen, was die Soll-Kurve ohnehin erwarten lässt (1 Energiepunkt = 4,5 CEI); übrig bleibt die Belohnung (Konzept §8).
    - Bewertung: ≥ +3 „gewirkt“, ≤ −3 „eher nicht“, dazwischen „neutral“.
    - Liegt ein Drop, Breakdown oder Build-up im Fenster, ist der Move „überlagert“ und wird nicht bewertet.
    - Daneben steht das Live-Urteil des Directors. Top-3 und Flop-3 werden nach der Belohnung sortiert.
  - **Top-Momente:** gleitender CEI über 16 Takte, höchstens 3 Maxima mit mindestens 64 Takten Abstand.
- **Export:**
  - JSON: der ganze Datensatz plus die Zusammenfassung.
  - CSV: eine Zeile pro Takt, Komma als Trenner, Dezimalpunkt, UTF-8.
- **Löschen:** zweistufig, nur auf diesem Gerät. Die „Beispiel-Nacht“ ist eine offline simulierte 60-min-Nacht und als Simulation gekennzeichnet.
- **PDF-Export** (Konzept §11) fehlt noch; der Browser-Druck geht.

## Story-Karte (MVP)

- 1080 × 1920 PNG, auf einem Canvas lokal gezeichnet (`src/report/card.ts`).
  - Inhalt: Peak-Uhrzeit, Drops (davon freigeschaltet), Tänzer, Minuten, Gleichtakt, Mini-Kurve mit Soll gestrichelt, Peak-Punkt und Drop-Rauten.
  - SCHWARM-Glow, Farbe nach Energiestufe. Ohne Namen.
- **Teilen:** über die Web Share API mit Datei, wo verfügbar (Handys). Sonst wird die Datei heruntergeladen.
- **Gast-Karte („Meine Nacht“):**
  - Das Handy merkt sich pro Minute die live empfangenen Gruppenwerte (E, S, N, Drops, Phones-up-Rufe) und die eigenen Sensorwerte: Minuten mitgetanzt, Anteil der Takte mit Rᵢ ≥ 0,6, Ø Energie.
  - Gespeichert in `localStorage` (`schwarm.nights`), höchstens 6 Nächte, unter „Deine Nächte“ löschbar.
  - Nach „Raus“ öffnet sich die Karte von selbst.
- **Rückschau-Link am Folgetag:** Laut Konzept speichert ein Relay die anonyme Gruppenkurve pro Minute und löscht sie nach 72 h. **Wir haben kein eigenes Relay**, und die öffentlichen MQTT-Broker speichern nicht verlässlich (Retained Messages wären öffentlich lesbar, ohne Löschgarantie). Deshalb gibt es **keinen Server-Speicher**: Die Rückschau entsteht ausschließlich aus dem, was das Handy live empfangen hat. Wer nicht bis zum Ende dabei war, sieht nur seinen Teil der Nacht. Mit einem eigenen Relay wäre es ein `PUT /recap/<sid>` (Minutenkurve, TTL 72 h) plus ein Link in der letzten Bar-Nachricht.

## TV als größte Lichtfläche

- Im TV-Modus folgt die Farbe der Crowd-Energie; zählt niemand, folgt sie der Musikstufe. Die Helligkeit folgt ebenfalls der Energie, dazu ein weicher Beat-Puls (höchstens 2,3 Hz, keiner bei Reduced Motion).
- Beim Drop blitzt der TV auf der Eins und auf den nächsten 3 Downbeats, so wie die Handys.
- **Blitz-Kalibrierung:**
  - Der Bildschirm blitzt jede Sekunde; man tippt 8× genau dann, wenn es auf dem Fernseher blitzt. Der Versatz ist der Median der Taps gegen die Zeichenzeit, begrenzt auf 0–300 ms. Alternativ gibt es einen Regler.
  - Der Master zeichnet den Blitz um diesen Versatz früher.
  - Gespeichert im Party-Profil des Geräts (`localStorage` `schwarm.profile`).
  - Hinweis im Setup: „Browser direkt am TV oder per HDMI – kein Casting oder AirPlay, Spielmodus an.“
  - **Grenze:** Menschen tippen auf Lichtblitze ungenauer als auf Klicks (typisch ±20–40 ms und eine eigene Vorhalte-Neigung). Das ist eine Grobkorrektur.

## Lautsprecher: Mitklopfen und optional Mikrofon

- **Mitklopfen** (Phase 1) schreibt jetzt ins Party-Profil.
- **Mikrofon-Messung** (`src/calib/mic.ts`):
  - Das eingebaute Mikrofon wird mit `echoCancellation`, `noiseSuppression` und `autoGainControl` auf false geöffnet, dann spielen 8 Klicks im Abstand von 0,5 s.
  - Ein AudioWorklet zeichnet auf derselben Audio-Zeitachse auf. Gemessen wird der Einsatz jedes Klicks (Schwelle: das 6-Fache des Rauschens). Der Median wird nur übernommen, wenn mindestens 5 Klicks gehört wurden und die Streuung höchstens 15 ms beträgt.
  - Davon abgezogen werden die gemeldete Ausgabelatenz und, falls der Browser sie meldet, die Eingabelatenz. Das Ergebnis ist die Korrektur.
  - Das Mikrofon wird sofort geschlossen; aufgenommen oder gespeichert wird nichts.
  - Warnungen: Bluetooth-Freisprechprofil, Mono-Ton, veränderte Latenz. Heißt das Mikrofon nach Bluetooth/Headset, kommt eine extra Warnung.
- **Beim zweiten Start** zeigt das QR-Fenster „Party-Profil geladen …“, ein Tipp auf **▶ Start** reicht.

## Fortsetzen nach einem Master-Reload

- Alle 4 Takte und bei Stop wird ein vollständiger, JSON-fähiger Schnappschuss des Directors gespeichert, inklusive Zustand des Zufallsgenerators.
- Nach einem Reload (bis zu 30 min später) fragt der Master „Party fortsetzen?“. Danach geht es an derselben Stelle der Kurve weiter: gleiche Phase, gleiche Müdigkeit, gleicher Move- und Drop-Plan.
- Die Aufzeichnung läuft unter derselben Party-ID weiter, und die Gäste bleiben verbunden (Phase 1).
- Unit-Test: Ein wiederhergestellter Director plant die nächsten 500 Takte bitgenau wie das Original.
- **Grenze:** 1–2 vorausgeplante, aber nicht gehörte Takte fallen weg. Der Licht-Moment-Zustand startet neu.

## Fehlerbehebung aus dem Gerätetest (Phase 1 → 2)

- **Symptom:** Tanzen wurde gut erkannt. Danach lag das Handy flach auf dem Tisch. Die gemessene Kurve fiel kurz auf ~0, sprang dann auf einen konstanten mittleren Wert und blieb minutenlang flach, während der Master „0 tanzen mit“ zeigte.
- **Ursache:**
  - Kam in einem Takt keine einzige Meldung an, hat die Aggregation den **letzten gemessenen Wert gehalten**. Das war als Brücke für ein verlorenes Paket gedacht, galt aber unbegrenzt und auch bei N = 0.
  - Ging das Handy aus dem Zählen (Seite verdeckt, Bildschirm aus, „liegt still“ oder Verbindung weg), blieb sein letzter Wert für immer die „Crowd-Energie“, und der Director bekam ihn als Messung.
  - Zusätzlich galt im Taschenmodus nie „liegt auf dem Tisch“.
- **Behebung:**
  - Das Halten gilt nur noch für höchstens 2 Takte und nur, solange noch jemand zählt. Danach fällt der Wert (Halbwertszeit 1 Takt), bei N = 0 schnell auf 0 (in etwa 4 Takten).
  - Das Einfrieren im Licht-Moment endet bei N = 0.
  - Flach und reglos für 60 s gilt jetzt auch im Taschenmodus als „Tisch“: zählt nicht und gilt nicht als müde.
  - Bei N = 0 spielt der Director nur nach Kurve (wie bisher).
- **Tests:**
  - Unit: 0 Tänzer, Gast meldet nichts mehr, Handy liegt still (auch im Taschenmodus und mit Fallback-Sensor).
  - Browser: `tests/browser/empty-floor.spec.ts` – Master allein, Gast ohne Netz (alle Pakete verloren, kein Abschied), Handy liegt 60 s auf dem Tisch.
