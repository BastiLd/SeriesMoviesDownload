// End-to-End-Test der echten arr.js-Logik gegen laufende Sonarr/Radarr-Container.
// Schreibt Testwerte, prueft das Zuruecklesen und stellt danach den ORIGINALZUSTAND wieder her.
// Start:  node test/arr.test.mjs
import { RADARR_KEY, SONARR_KEY } from '../src/secrets.js'
import { api, getProfiles, applySettings, loadSettings } from '../src/arr.js'

const APPS = [
  { id: 'radarr', title: 'Filme  (Radarr)', base: 'http://localhost:7878', key: RADARR_KEY },
  { id: 'sonarr', title: 'Serien (Sonarr)', base: 'http://localhost:8989', key: SONARR_KEY },
]

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++ }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

for (const app of APPS) {
  console.log(`\n=== ${app.title} ===`)
  try {
    // 1) Verbindungstest (wie der „🔌 Test"-Button)
    const t0 = performance.now()
    const status = await api(app, '/api/v3/system/status', { timeout: 8000 })
    ok('Verbindung / system/status', !!status?.version, `${Math.round(performance.now() - t0)} ms · API ${status?.version}`)

    // 2) Profil waehlen (wie die App: id 4, sonst erstes)
    const profiles = await getProfiles(app)
    const sel = profiles.find(p => p.id === 4)?.id ?? profiles[0]?.id
    ok('Profile geladen', profiles.length > 0, `${profiles.length} Profile, teste Profil #${sel} „${profiles.find(p => p.id === sel)?.name}"`)

    // 3) ORIGINAL sichern
    const original = await loadSettings(app, sel)
    console.log('  ℹ️  Original:', JSON.stringify(original))

    // 4) Testwerte schreiben (erweiterte Optionen)
    const test = { ...original, codecStates: { x265: 'pref', x264: 'no', av1: 'off' }, remux: true, blacklist: 'YIFY, RARBG, EVO' }
    await applySettings(app, sel, test)

    // 5) Zuruecklesen + pruefen
    const back = await loadSettings(app, sel)
    ok('Codec x265 = bevorzugt round-trip', back.codecStates.x265 === 'pref', back.codecStates.x265)
    ok('Codec x264 = nicht round-trip', back.codecStates.x264 === 'no', back.codecStates.x264)
    ok('Remux = bevorzugt round-trip', back.remux === true, String(back.remux))
    const bl = back.blacklist.split(',').map(s => s.trim()).filter(Boolean)
    ok('Blacklist round-trip (YIFY/RARBG/EVO)', ['YIFY', 'RARBG', 'EVO'].every(g => bl.includes(g)), back.blacklist)
    ok('Sprachen unveraendert', eq(back.langStates, original.langStates))
    ok('Qualitaet unveraendert', back.minTier === original.minTier && back.maxTier === original.maxTier, `${back.minTier}-${back.maxTier}`)

    // 6) ORIGINAL wiederherstellen + verifizieren
    await applySettings(app, sel, original)
    const restored = await loadSettings(app, sel)
    ok('Originalzustand wiederhergestellt', eq(restored, original), eq(restored, original) ? 'sauber' : JSON.stringify(restored))
  } catch (e) {
    ok('Lauf ohne Fehler', false, e.message); console.error(e)
  }
}

console.log(`\n──────────────\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`)
process.exit(fail ? 1 : 0)
