# MediaStack Regler

Eine lokale Web-Oberfläche (Vite + React) zum komfortablen Steuern von **Radarr / Sonarr / qBittorrent / Prowlarr**.

## Was kann es?
- **Einstellungen** pro Profil (Filme & Serien getrennt): Sprachen (Pflicht/Optional/Aus), Qualität (min/max), HDR-Präferenz, Maximal-Dateigröße.
- **Erweiterte Qualität** (v1.1): Codec-Präferenz (x265/x264/AV1 – bevorzugt/egal/nicht), Remux bevorzugen, Release-Gruppen-Blacklist.
- **Live-Vorschau** (v1.1): Beispiel-Dateinamen, die mit den aktuellen Regeln akzeptiert bzw. abgelehnt würden.
- **Profil-Vergleich** (v1.1): Filme- vs. Serien-Profil nebeneinander, Unterschiede hervorgehoben.
- **„Auf beide anwenden"** (v1.1): geänderte Einstellung mit einem Klick aufs jeweils andere Profil übertragen.
- **Import / Export** (v1.1): Einstellungen als JSON sichern und wieder einspielen.
- **Verbindungstest** (v1.1): Sonarr/Radarr separat anpingen (Antwortzeit + API-Version).
- **Änderungshistorie + Rückgängig** (v1.1) und **Toast-Feedback** beim Speichern.
- **Downloads**: Live-Fortschrittsbalken (einstellbares Intervall) aus qBittorrent + Radarr/Sonarr.
- **Suchen**: manuelle Release-Auswahl mit Infos (Qualität, Größe, HDR, Sprache, Seeder) und 1-Klick-Download.
- **„Warum?"-Analyse** bei fehlenden Titeln inkl. Lösungsvorschlag.
- **Dark/Light Mode**.

### Neu in v1.2
- **Download-Fortschritt korrekt** (v1.2): echter Fortschritt & Speed direkt aus qBittorrent (`progress`/`dlspeed`); Season-Packs werden nicht mehr als 0%-Phantom-Episoden doppelt gezählt.
- **Korrektes Status-Mapping** (v1.2): wartende Torrents (queuedDL/stalledDL/metaDL) zählen als „Warteschlange", nicht als „fehlend"; neue Kategorien „Wird geprüft" & „Pausiert".
- **Sprachlogik** (v1.2): „🌐 Jede Sprache akzeptieren" / „🌍 Sprache im Titel ignorieren" (Standard AN) – Releases werden nach Audio-Track gefiltert, nicht nach Dateiname. Korrigierte Live-Vorschau.
- **Suchen erweitert** (v1.2): Freitext-Filter der Bibliothek, Profil-Match-Badges (🟢/🟡/🔴), „nur Profil-konforme", Batch-„alle fehlenden automatisch suchen".
- **UX** (v1.2): Skeleton-Loader, Verbindungs-Warnbanner, Lade-Spinner, Ctrl+R = Refresh.

## Starten
```bash
npm install
npm run dev
```
Öffnet `http://localhost:5173`. Der Dev-Server proxyt die API-Anfragen zu den lokalen Diensten (kein CORS-Problem).

Voraussetzung: Der MediaStack (Docker) läuft lokal. Ein-Klick-Start: `START-MediaStack.bat`.

> Hinweis: Die API-Schlüssel in `src/config.js` gehören zu lokalen Diensten (localhost) und sind nur im Heimnetz nutzbar.
