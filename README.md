# MediaStack Regler

Eine lokale Web-Oberfläche (Vite + React) zum komfortablen Steuern von **Radarr / Sonarr / qBittorrent / Prowlarr**.

## Was kann es?
- **Einstellungen** pro Profil (Filme & Serien getrennt): Sprachen (Pflicht/Optional/Aus), Qualität (min/max), HDR-Präferenz, Maximal-Dateigröße.
- **Downloads**: Live-Fortschrittsbalken (einstellbares Intervall) aus qBittorrent + Radarr/Sonarr.
- **Suchen**: manuelle Release-Auswahl mit Infos (Qualität, Größe, HDR, Sprache, Seeder) und 1-Klick-Download.
- **„Warum?"-Analyse** bei fehlenden Titeln inkl. Lösungsvorschlag.
- **Dark/Light Mode**.

## Starten
```bash
npm install
npm run dev
```
Öffnet `http://localhost:5173`. Der Dev-Server proxyt die API-Anfragen zu den lokalen Diensten (kein CORS-Problem).

Voraussetzung: Der MediaStack (Docker) läuft lokal. Ein-Klick-Start: `START-MediaStack.bat`.

> Hinweis: Die API-Schlüssel in `src/config.js` gehören zu lokalen Diensten (localhost) und sind nur im Heimnetz nutzbar.
