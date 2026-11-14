# CLAUDE.md – Anweisungen für Claude

Dieses Repo enthält die **Web-App (PWA)** des LBS-Projekts **MountainNotes**: ortsgebundene Notizen für Bergtouren (Modul Advanced Spatial Methods, FHNW, HS2026), für Beta-Nutzer auf iOS und Android ohne App Store. Gian arbeitet mit dir in VS Code.

Die native iOS-App (Capacitor/Xcode) und das **Backend** liegen im Schwester-Repo `../lbs-workshop`. Dieses Repo ist eine Kopie davon (Stand `e122df5`, 13.11.2026) ohne `ios/`, `demo/` und `backend/`. Beide Apps nutzen dasselbe Backend auf dem Pi; Backend-Änderungen nur in `lbs-workshop` machen und von dort deployen.

## Dokumente

| Datei | Zweck |
| --- | --- |
| `../Konzept/KONZEPT.md` | Konzept: Anforderungen, Funktionen, Architektur, Datenmodell, Zeitplan, Entscheidungslog, Release. **Einzige Quelle der Wahrheit.** |
| `../Konzept/PROTOKOLL.md` | Arbeitsprotokoll, ein Eintrag pro Sitzung |
| `CLAUDE.md` | Diese Arbeitsregeln |

Die beiden Konzept-Dateien liegen neben dem Repo im Ordner `LBS_project/Konzept` (im VS-Code-Arbeitsbereich als Ordner "Konzept").

## Arbeitsregeln

1. **Zuerst lesen**: Lies vor jeder Aufgabe `KONZEPT.md` (mindestens Funktionen, Zeitplan, Entscheidungslog und offene Fragen). Wenn eine Aufgabe dem Konzept widerspricht, sag es, bevor du loslegst.
2. **Immer dokumentieren**: Trage am Ende jeder Aufgabe in `PROTOKOLL.md` ein, was du gemacht hast: Datum, Änderungen, geänderte Dateien, offene Punkte. Neueste Einträge zuoberst.
3. **Entscheide sofort ins Konzept**: Sobald Gian und du etwas entscheiden (Technik, Funktion, Umfang, Datenmodell, UI), trägst du es ins **Entscheidungslog** von `KONZEPT.md` ein *und* passt den betroffenen Abschnitt an. Erledigte Punkte im Zeitplan und Backlog abhaken. Offene Fragen, die beantwortet sind, entfernen.
4. **Diagramme als Mermaid**: Diagramme im Konzept bleiben Mermaid-Code, damit sie bearbeitbar sind. Bei Änderungen an Architektur oder Datenmodell das Diagramm mitziehen.
5. **Kleine Schritte**: Lieber kleine, lauffähige Schritte als grosse Umbauten. Nach jedem Schritt bauen (`npm run build`) und, wenn vorhanden, Tests laufen lassen.
6. **Git**: Commits klein und thematisch, Commit-Messages auf Englisch. Nichts pushen, ohne dass Gian es will.
7. **Nachfragen statt raten**: Bei Unklarheiten kurz fragen; bei kleinen Details die naheliegende Lösung wählen und es erwähnen.

## Technik

- Ionic 9, Angular (standalone components, signals), MapLibre/Leaflet mit swisstopo Basiskarte, Turf.js
- Capacitor-Plugins laufen hier mit ihrer **Web-Implementierung** (Preferences → localStorage, Filesystem → IndexedDB, Geolocation → Browser, Fotos über ein eigenes `<input type="file" accept="image/*">` (kein Kamera-Plugin))
- PWA: `src/manifest.webmanifest`, Angular Service Worker (`ngsw-config.json`, nur Produktions-Build) cacht die App-Hülle; Notes, Outbox und Karten haben ihren eigenen Offline-Speicher
- Hosting: `sh deploy.sh` baut und kopiert `www/` auf den Pi (nginx-Container `hosting/`, `127.0.0.1:8081`), Tailscale Funnel veröffentlicht ihn auf Port 10000. API bleibt auf Port 8443.
- Immer `coords.accuracy` berücksichtigen; Radien nicht unter 20 m; Geofencing nur im Vordergrund
- Privacy by design: keine Tracks speichern, genaue Position des Lesers nie an den Server
- Das Repo ist **öffentlich**: keine Passwörter, Testkonten oder `.env` einchecken

## Ziel

- Beta-Nutzer installieren die App über "Zum Home-Bildschirm" (iOS Safari, Android Chrome). Keine Entwicklerkosten.
- Grenzen der Web-App (kein Hintergrund-GPS, keine Vibration auf iOS, Speicher kann ohne Installation gelöscht werden) stehen im Konzept.

## Sprache

Gian schreibt Deutsch: antworte auf Deutsch, Dokumentation auf Deutsch. Code, Kommentare im Code und Commits auf Englisch.
