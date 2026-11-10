# Blindtest Musik-Gate – Anleitung für die Testleitung

Ziel (Konzept §13, Stufe 1): **Median bis Langeweile ≥ 45 min** und **Note ≥ 80 % der Playlist-Note**.
Unter 65 % ist No-Go. Mindestens 10 Hörer je Gruppe.

## Ablauf je Hörer

1. https://altibo.github.io/Schwarm/test.html öffnen (einmal online laden, danach läuft es offline).
2. Kürzel eintragen (Pseudonym, kein Name) und Wiedergabe wählen.
3. **Set A**: „Set A hören“ und „Test starten“. Die App spielt 60 Minuten. Für alle Hörer ist es
   dasselbe Set (Seed 2026), identisch mit `renders/schwarm-60min.mp3`.
   **Playlist**: „Playlist bewerten“, Namen eintragen, Playlist in der eigenen App starten und
   gleichzeitig „Test starten“.
4. Der Hörer tippt „Langweilig“, sobald ihm langweilig wird (mehrfach möglich, gezählt wird der
   erste Tipp; die Musik läuft weiter). Alle 10 Minuten erscheint die Note 1–10.
5. Nach 60 Minuten kommt die Schlussnote. Danach „Alle als JSON exportieren“ und Datei einsammeln.

## Auswertung

Alle JSON-Dateien unten auf der Seite unter „Auswertung“ laden. Der Gate-Rechner zeigt je Gruppe
Hörerzahl, Median bis Langeweile, Ø-Note, das Verhältnis und das Urteil
(bestanden / Grauzone / No-Go / zu wenig Daten). CSV ist für eigene Auswertungen gedacht
(eine Zeile pro Tipp, Note und Testende; bei Set A mit Takt, Stufe und Phase zum Zeitpunkt des Tipps).

## Wichtig zur Verblindung

Der Hörer weiß in diesem Aufbau, ob er Set A oder die Playlist hört. Für einen echten Blindtest:
die Testleitung legt `schwarm-60min.mp3` und die Playlist-Dateien unbeschriftet in denselben
neutralen Player und lässt die Hörer im Modus „Playlist bewerten“ (Timer) bewerten. Dann
unterscheiden sich die Bedingungen nur im Material.

Weitere Grenzen: Die Musik reagiert im Test auf eine **simulierte** Crowd, nicht auf die Hörer.
Kopfhörer und Handylautsprecher geben den Bass sehr unterschiedlich wieder; Wiedergabe wird
darum mitprotokolliert.
