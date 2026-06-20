// API-Schluessel kommen aus der lokalen secrets.js (nicht im Git).
export { RADARR_KEY, SONARR_KEY } from './secrets.js'

// Pro Quality-Profil eigene Custom Formats (so kann jedes Profil andere Regeln haben)
export const cfReqName = id => `Regler ${id} Pflicht`
export const cfPrefName = id => `Regler ${id} Bonus`
// Alte CF-Namen aus frueheren Versionen -> werden aufgeraeumt
export const LEGACY_CFS = ['DE+EN Audio (German DL)', 'Regler: Sprache Pflicht', 'Regler: Sprache Bonus']

// Auswaehlbare Sprachen. token = Regex-Bausteine (wie diese Sprache in Release-Titeln auftaucht).
// sample = wie die Sprache in einem Beispiel-Dateinamen geschrieben wird (fuer die Live-Vorschau).
export const LANGUAGES = [
  { id: 'de',    label: 'Deutsch',     flag: '🇩🇪', token: 'german|deutsch|ger[\\.\\- ]?dl', detect: 'german',  sample: 'German' },
  { id: 'en',    label: 'Englisch',    flag: '🇬🇧', token: 'english|\\beng\\b|.', detect: 'english', sample: 'English' },
  { id: 'multi', label: 'MULTi',       flag: '🌐', token: 'multi',                          detect: 'multi',   sample: 'MULTi' },
  { id: 'dual',  label: 'Dual Audio',  flag: '🔊', token: 'dual',                           detect: 'dual',    sample: 'DUAL' },
  { id: 'fr',    label: 'Französisch', flag: '🇫🇷', token: 'french|truefrench|vostfr',       detect: 'french',  sample: 'FRENCH' },
  { id: 'es',    label: 'Spanisch',    flag: '🇪🇸', token: 'spanish|castellano|espanol',     detect: 'spanish', sample: 'Spanish' },
  { id: 'it',    label: 'Italienisch', flag: '🇮🇹', token: 'italian|\\bita\\b',              detect: 'italian', sample: 'iTALiAN' },
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

// ---------- Erweiterte Qualitaets-Optionen ----------
// Codec-Praeferenz: pro Codec ein eigenes Custom Format mit Bonus/Malus-Score.
export const CODECS = [
  { id: 'x265', label: 'x265 / HEVC', flag: '🎞️', token: 'x265|h\\.?265|hevc',  sample: 'x265' },
  { id: 'x264', label: 'x264 / AVC',  flag: '📼', token: 'x264|h\\.?264|\\bavc\\b', sample: 'x264' },
  { id: 'av1',  label: 'AV1',         flag: '🆕', token: '\\bav1\\b',            sample: 'AV1' },
]
export const CODEC_STATES = [
  { id: 'pref', label: 'Bevorzugt' },
  { id: 'off',  label: 'Egal' },
  { id: 'no',   label: 'Nicht' },
]
export const REMUX_STATES = [
  { id: 'yes', label: 'Bevorzugt' },
  { id: 'no',  label: 'Egal' },
]
export const cfCodecName = (id, codec) => `Regler ${id} Codec ${codec}`
export const cfRemuxName = id => `Regler ${id} Remux`
export const cfBlacklistName = id => `Regler ${id} Blacklist`
export const CODEC_REGEX = c => `(?i)(${CODECS.find(x => x.id === c).token})`
export const REMUX_REGEX = '(?i)(remux)'

// Sonderzeichen fuer den Blacklist-Regex entschaerfen (Release-Gruppen sind frei eingegeben).
export function escapeRegex(s = '') { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export function blacklistRegex(groups = []) { return groups.length ? `(?i)(${groups.map(escapeRegex).join('|')})` : '' }
// Default-Werte fuer die erweiterten Optionen (zentral, damit Hook + Import identisch sind).
export const CODEC_DEFAULT = () => Object.fromEntries(CODECS.map(c => [c.id, 'off']))

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
