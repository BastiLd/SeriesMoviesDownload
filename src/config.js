// API-Schluessel kommen aus der lokalen secrets.js (nicht im Git).
export { RADARR_KEY, SONARR_KEY } from './secrets.js'

// Pro Quality-Profil eigene Custom Formats (so kann jedes Profil andere Regeln haben)
export const cfReqName = id => `Regler ${id} Pflicht`
export const cfPrefName = id => `Regler ${id} Bonus`
// Alte CF-Namen aus frueheren Versionen -> werden aufgeraeumt
export const LEGACY_CFS = ['DE+EN Audio (German DL)', 'Regler: Sprache Pflicht', 'Regler: Sprache Bonus']

// Auswaehlbare Sprachen. token = Regex-Bausteine (wie diese Sprache in Release-Titeln auftaucht).
export const LANGUAGES = [
  { id: 'de',    label: 'Deutsch',     flag: '🇩🇪', token: 'german|deutsch|ger[\\.\\- ]?dl', detect: 'german' },
  { id: 'en',    label: 'Englisch',    flag: '🇬🇧', token: 'english|\\beng\\b|.', detect: 'english' },
  { id: 'multi', label: 'MULTi',       flag: '🌐', token: 'multi',                          detect: 'multi' },
  { id: 'dual',  label: 'Dual Audio',  flag: '🔊', token: 'dual',                           detect: 'dual' },
  { id: 'fr',    label: 'Franzoesisch',flag: '🇫🇷', token: 'french|truefrench|vostfr',       detect: 'french' },
  { id: 'es',    label: 'Spanisch',    flag: '🇪🇸', token: 'spanish|castellano|espanol',     detect: 'spanish' },
  { id: 'it',    label: 'Italienisch', flag: '🇮🇹', token: 'italian|\\bita\\b',              detect: 'italian' },
]

export const STATES = [
  { id: 'required',  label: 'Pflicht',  hint: 'muss vorhanden sein' },
  { id: 'preferred', label: 'Optional', hint: 'gern, aber kein Muss' },
  { id: 'off',       label: 'Aus',      hint: 'egal' },
]

export const QUALITY_MIN = [
  { id: 720,  label: 'ab 720p' },
  { id: 1080, label: 'ab 1080p' },
  { id: 2160, label: 'ab 4K' },
]

export const QUALITY_MAX = [
  { id: 1080, label: 'bis 1080p' },
  { id: 2160, label: 'bis 4K' },
]

export const REFRESH_OPTS = [
  { id: 1000,  label: 'Live (1s)' },
  { id: 2000,  label: '2s' },
  { id: 5000,  label: '5s' },
  { id: 10000, label: '10s' },
]

export const HDR_STATES = [
  { id: 'pref', label: 'Bevorzugt' },
  { id: 'off',  label: 'Egal' },
  { id: 'no',   label: 'Ohne HDR' },
]
export const MAXSIZE = [
  { id: 0,  label: 'Aus' },
  { id: 15, label: '15 GB' },
  { id: 25, label: '25 GB' },
  { id: 50, label: '50 GB' },
]
export const CF_HDR = 'Regler HDR'
export const cfMaxName = id => `Regler ${id} MaxGroesse`
export const HDR_REGEX = '(?i)(hdr10\\+|hdr10|\\bhdr\\b|dolby.?vision|\\bdovi\\b|\\bdv\\b)'

// HDR / Format-Erkennung aus dem Titel
export function detectHDR(title = '') {
  if (/dolby.?vision|\bdv\b|\bdovi\b/i.test(title)) return 'DV'
  if (/hdr10\+|hdr10|\bhdr\b/i.test(title)) return 'HDR'
  return 'SDR'
}

// Direktlinks zu allen Apps (fuer das Menue)
export const SERVICES = [
  { label: 'qBittorrent', url: 'http://localhost:8200', icon: '⬇️' },
  { label: 'Prowlarr',    url: 'http://localhost:9696', icon: '🔍' },
  { label: 'Sonarr',      url: 'http://localhost:8989', icon: '📺' },
  { label: 'Radarr',      url: 'http://localhost:7878', icon: '🎬' },
  { label: 'Bazarr',      url: 'http://localhost:6767', icon: '💬' },
  { label: 'Jellyfin',    url: 'http://localhost:8096', icon: '🍿' },
  { label: 'Jellyseerr',  url: 'http://localhost:5055', icon: '✨' },
]

export function qName(item) { return item.quality ? item.quality.name : item.name }

export function tierOf(name) {
  if (/2160p/i.test(name)) return 2160
  if (/1080p/i.test(name)) return 1080
  if (/720p/i.test(name)) return 720
  if (/(480p|576p|SDTV|\bDVD\b|CAM|TELE|SCR|REGIONAL|WORKPRINT)/i.test(name)) return 480
  return 0
}

export function isExcluded(name) { return /(BR-DISK|Raw-HD|Unknown)/i.test(name) }
