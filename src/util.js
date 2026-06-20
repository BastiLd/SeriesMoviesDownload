// Reine Helfer ohne React/DOM – damit sie in Node-Tests (test/) verifizierbar sind.

export function seasonOf(title = '') {
  const m = title.match(/S(\d{1,2})[. ]?E\d/i) || title.match(/\bS(\d{1,2})\b/i) || title.match(/Season[. ]?(\d{1,2})/i)
  return m ? parseInt(m[1], 10) : null
}

// Sauberen Serien-/Film-Titel aus einem Release-/Torrent-Namen ableiten (zum Gruppieren nach Serie statt nur Staffel).
export function mediaTitle(name = '') {
  const raw = String(name).trim()
  if (/^[0-9a-f]{16,}$/i.test(raw)) return '⏳ Metadaten…'   // Hash ohne Metadaten
  let s = raw.replace(/\.(mkv|mp4|avi|mov)$/i, '').replace(/^[\s🎬📺]+/, '').replace(/[._]+/g, ' ')
  s = s.replace(/\((?:19|20)\d{2}\)/g, ' ')   // „(2008)" entfernen, damit Jahres-Varianten zusammenfallen
  // ab dem ersten Staffel-/Jahr-/Qualitäts-/Tag-Marker abschneiden – davor steht der Titel
  // (?:^|[\s.\-]+) statt nur [\s.\-]+ : fängt auch Namen ab, die mit einem Marker BEGINNEN
  s = s.replace(/(?:^|[\s.\-]+)(?:s\d{1,2}(?:\s*e\d{1,3})?|season\s*\d{1,2}|staffel\s*\d{1,2}|complete|\d{3,4}p|2160p|1080p|720p|480p|(?:19|20)\d{2}|bluray|blu-ray|web[- ]?dl|webrip|hdtv|x264|x265|h\.?26[45]|hevc|remux|uhd|bdremux|dvdrip|proper|repack|multi|german|english|truefrench)\b.*$/i, '')
  s = s.trim().replace(/\s+/g, ' ').replace(/[\s\-:]+$/, '')
  if (!s || s.length < 2) return raw.replace(/[._]+/g, ' ').slice(0, 40)
  return s
}

export function normTitle(s = '') { return s.toLowerCase().replace(/[^a-z0-9]+/g, '') }

// qBittorrent-States exakt gemäß API-Doku zuordnen
export const DONE_STATES    = ['uploading', 'stalledup', 'queuedup', 'forcedup', 'pausedup', 'stoppedup', 'completed', 'seeding']
export const QUEUE_STATES   = ['queueddl', 'stalleddl', 'metadl', 'allocating', 'queued', 'delay', 'forceddl']
export const CHECK_STATES   = ['checkingdl', 'checkingup', 'checkingresumedata', 'moving']
export const PAUSED_STATES  = ['pauseddl', 'stoppeddl', 'stopped']
export const PROBLEM_STATES = ['error', 'missingfiles', 'unknown']

// Kernlogik: ein wartender Torrent (queuedDL/stalledDL/metaDL …) ist KEIN Fehler, sondern „Warteschlange".
export function classifyState(state, { speed = 0, prog = 0 } = {}) {
  const st = String(state || '').toLowerCase()
  if (prog >= 1) return 'done'
  if (DONE_STATES.includes(st)) return 'done'
  if (CHECK_STATES.includes(st)) return 'check'
  if (PAUSED_STATES.includes(st)) return 'paused'
  if (PROBLEM_STATES.includes(st)) return 'problem'
  if (st === 'downloading' || st === 'forceddl') return speed > 0 ? 'active' : 'queue'
  if (QUEUE_STATES.includes(st) || st.includes('queue') || st.includes('stalled') || st.includes('dl')) return 'queue'
  return 'queue'
}
