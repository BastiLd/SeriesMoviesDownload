import React, { useState, useEffect } from 'react'
import {
  RADARR_KEY, SONARR_KEY, cfReqName, cfPrefName, cfMaxName, CF_HDR, HDR_REGEX, LEGACY_CFS,
  LANGUAGES, STATES, QUALITY_MIN, QUALITY_MAX, HDR_STATES, MAXSIZE, REFRESH_OPTS, SERVICES,
  qName, tierOf, isExcluded, detectHDR,
  CODECS, CODEC_STATES, REMUX_STATES, cfCodecName, cfRemuxName, cfBlacklistName,
  CODEC_REGEX, REMUX_REGEX, blacklistRegex, CODEC_DEFAULT,
} from './config.js'
import { api, getProfiles, applySettings, loadSettings } from './arr.js'
import ThreeBanner from './ThreeBanner.jsx'

const APPS = [
  { id: 'radarr', anchor: 'filme', title: 'Filme', icon: '🎬', base: '/radarr', key: RADARR_KEY },
  { id: 'sonarr', anchor: 'serien', title: 'Serien', icon: '📺', base: '/sonarr', key: SONARR_KEY },
]
const appById = id => APPS.find(a => a.id === id)

function fmtBytes(b) {
  if (!b || b < 0) return '–'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++ }
  return b.toFixed(b < 10 && i > 0 ? 1 : 0) + ' ' + u[i]
}
function seasonOf(title = '') {
  const m = title.match(/S(\d{1,2})[. ]?E\d/i) || title.match(/\bS(\d{1,2})\b/i) || title.match(/Season[. ]?(\d{1,2})/i)
  return m ? parseInt(m[1], 10) : null
}

// ---------- Download-Status korrekt erkennen ----------
// Kategorien: active (lädt) · queue (wartet) · meta (Metadaten) · done (fertig) · problem (wirklich fehlend/Fehler)
const CATS = {
  active:  { icon: '🟢', label: 'Lädt aktiv' },
  queue:   { icon: '🟡', label: 'Warteschlange' },
  meta:    { icon: '🔵', label: 'Metadaten' },
  done:    { icon: '✅', label: 'Fertig' },
  problem: { icon: '🔴', label: 'Problem' },
}
const DONE_STATES = ['uploading', 'stalledup', 'queuedup', 'forcedup', 'checkingup', 'pausedup', 'completed', 'seeding']
const PROBLEM_STATES = ['error', 'missingfiles', 'unknown', 'failed', 'pauseddl', 'paused']
const QUEUE_STATES = ['queueddl', 'stalleddl', 'checkingdl', 'allocating', 'checkingresumedata', 'moving', 'queued', 'delay']

// Kernlogik: ein Torrent mit 0 Seeds/Peers/Speed WARTET (sequenzieller Download) – das ist KEIN Fehler.
function classifyState(state, { speed = 0, prog = 0, seeds = 0, leech = 0 } = {}) {
  const st = String(state || '').toLowerCase()
  if (prog >= 1) return 'done'
  if (DONE_STATES.includes(st)) return 'done'
  if (st === 'metadl') return 'meta'
  if (speed > 0) return 'active'
  if (PROBLEM_STATES.includes(st)) return 'problem'
  if (QUEUE_STATES.includes(st) || st.includes('queue')) return 'queue'
  // 0 Seeds + 0 Peers + 0 Speed, aber kein Fehler-State → wartet in Warteschlange
  if (seeds === 0 && leech === 0 && speed === 0) return 'queue'
  return 'queue'
}

function fmtSpeed(b) { return b > 0 ? fmtBytes(b) + '/s' : '0 B/s' }
function fmtETA(sec) {
  if (sec == null || sec < 0 || sec >= 8640000 || !isFinite(sec)) return '—'
  if (sec < 60) return Math.round(sec) + 's'
  const m = Math.floor(sec / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (d > 0) return d + 'd ' + (h % 24) + 'h'
  if (h > 0) return h + 'h ' + (m % 60) + 'm'
  return m + 'm'
}
function fmtTime(date) { return date ? date.toLocaleTimeString('de-DE') : '—' }
// Titel normalisieren für Abgleich missing ↔ Torrent
function normTitle(s = '') { return s.toLowerCase().replace(/[^a-z0-9]+/g, '') }

// ---------- KI (Ollama lokal / Server oder OpenAI-kompatible API) ----------
const AI_DEFAULT = { provider: 'ollama', model: 'gemma:2b', url: '', key: '', name: 'KI' }
function getAI() { try { return { ...AI_DEFAULT, ...JSON.parse(localStorage.getItem('regler-ai') || '{}') } } catch { return { ...AI_DEFAULT } } }
async function callAI(prompt) {
  const c = getAI()
  if (c.provider === 'openai') {
    const r = await fetch((c.url || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: prompt }], stream: false }),
    })
    if (!r.ok) throw new Error(r.status + ' ' + await r.text())
    const j = await r.json(); return j.choices?.[0]?.message?.content || '(keine Antwort)'
  }
  const base = c.provider === 'ollama-direct' && c.url ? c.url.replace(/\/$/, '') : '/ollama'
  const r = await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.model, prompt, stream: false }) })
  if (!r.ok) throw new Error(r.status + ' ' + await r.text())
  const j = await r.json(); return j.response || '(keine Antwort)'
}

function AISettings({ onClose }) {
  const [c, setC] = useState(getAI())
  const set = (k, v) => setC(p => ({ ...p, [k]: v }))
  const save = () => { localStorage.setItem('regler-ai', JSON.stringify(c)); onClose() }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>🧠 KI-Einstellungen</h3><button className="x" onClick={onClose}>✕</button></div>
        <label className="prof-label">Anbieter</label>
        <select className="prof-select" value={c.provider} onChange={e => set('provider', e.target.value)}>
          <option value="ollama">Ollama – lokal (localhost:11434)</option>
          <option value="ollama-direct">Ollama – andere Adresse (z. B. Server)</option>
          <option value="openai">Externe API (OpenAI-kompatibel)</option>
        </select>
        {c.provider === 'ollama-direct' && <><label className="prof-label">Ollama-Adresse</label><input className="prof-select" value={c.url} onChange={e => set('url', e.target.value)} placeholder="http://192.168.68.10:11434" /></>}
        {c.provider === 'openai' && <>
          <label className="prof-label">Name (frei)</label><input className="prof-select" value={c.name} onChange={e => set('name', e.target.value)} placeholder="z. B. Groq / OpenAI" />
          <label className="prof-label">Basis-URL</label><input className="prof-select" value={c.url} onChange={e => set('url', e.target.value)} placeholder="https://api.openai.com/v1" />
          <label className="prof-label">API-Key</label><input className="prof-select" type="password" value={c.key} onChange={e => set('key', e.target.value)} placeholder="sk-..." />
        </>}
        <label className="prof-label">Modell</label><input className="prof-select" value={c.model} onChange={e => set('model', e.target.value)} placeholder="gemma:2b" />
        <div className="modal-box why" style={{ marginTop: 10 }}><b>Modell-Tipp:</b> <b>gemma:2b</b> reicht für kurze Erklärungen, ist aber schwach. Besser (brauchen mehr RAM/GPU): <b>llama3.2:3b</b> (klein, ok) · <b>qwen2.5:7b</b> oder <b>llama3.1:8b</b> (gut, ~8 GB) · <b>gemma2:9b</b> (sehr gut). Installieren: <code>ollama pull qwen2.5:7b</code></div>
        <div className="modal-actions"><button className="save inline" onClick={save}>💾 Speichern</button><button className="mini-btn" onClick={onClose}>Abbrechen</button></div>
      </div>
    </div>
  )
}

// ---------- Toast / Snackbar (globaler Mini-Event-Bus) ----------
let toastSeq = 0
const toastSubs = new Set()
function toast(text, kind = 'ok', ms = 4200) { const id = ++toastSeq; toastSubs.forEach(fn => fn({ id, text, kind, ms })); return id }
function ToastHost() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const add = t => { setItems(p => [...p, t]); setTimeout(() => setItems(p => p.filter(x => x.id !== t.id)), t.ms) }
    toastSubs.add(add); return () => toastSubs.delete(add)
  }, [])
  if (!items.length) return null
  return (
    <div className="toast-host">
      {items.map(t => (
        <div key={t.id} className={'toast ' + t.kind} onClick={() => setItems(p => p.filter(x => x.id !== t.id))}>
          <span className="toast-ico">{t.kind === 'err' ? '⚠️' : t.kind === 'info' ? 'ℹ️' : '✅'}</span>
          <span className="toast-txt">{t.text}</span>
          <span className="toast-x">✕</span>
        </div>
      ))}
    </div>
  )
}

function Seg({ options, value, onChange, small }) {
  return <div className={'seg' + (small ? ' small' : '')}>{options.map(o => <button key={o.id} className={'seg-btn ' + o.id + (value === o.id ? ' on' : '')} onClick={() => onChange(o.id)} title={o.hint || ''}>{o.label}</button>)}</div>
}
function Bar({ pct }) { return <div className="bar"><div className="bar-fill" style={{ width: Math.round(pct) + '%' }} /></div> }

// ---------- Helfer fuer die Einstellungen ----------
const SETTINGS_DEFAULT = () => ({ langStates: Object.fromEntries(LANGUAGES.map(l => [l.id, 'off'])), minTier: 1080, maxTier: 2160, hdr: 'off', maxSize: 0, codecStates: CODEC_DEFAULT(), remux: false, blacklist: '' })
function normalizeSettings(s = {}) { const d = SETTINGS_DEFAULT(); return { ...d, ...s, langStates: { ...d.langStates, ...(s.langStates || {}) }, codecStates: { ...d.codecStates, ...(s.codecStates || {}) } } }
function qLabelOf(min, max) { return min === max ? (min === 2160 ? 'nur 4K' : 'nur ' + min + 'p') : `${min}p–${max === 2160 ? '4K' : max + 'p'}` }
function tierLabel(t) { return t === 2160 ? '2160p' : t === 1080 ? '1080p' : t === 720 ? '720p' : '480p' }
function relTime(ts) {
  if (!ts) return null
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return 'gerade eben'
  const m = Math.round(s / 60); if (m < 60) return `vor ${m} Min.`
  const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std.`
  return `vor ${Math.round(h / 24)} Tg.`
}
const codecStateLabel = id => CODEC_STATES.find(s => s.id === id)?.label || id

// Live-Vorschau: aus den Einstellungen Beispiel-Dateinamen ableiten (akzeptiert / abgelehnt)
function buildPreview(s) {
  const req = LANGUAGES.filter(l => s.langStates[l.id] === 'required')
  const prefCodec = CODECS.find(c => s.codecStates[c.id] === 'pref')
  const noCodecs = CODECS.filter(c => s.codecStates[c.id] === 'no')
  const langPart = req.length ? req.map(l => l.sample).join('.') : 'German'
  const codecPart = prefCodec ? prefCodec.sample : 'x265'
  const base = 'The.Mentalist.S01E01'
  const accepted = [`${base}.${tierLabel(s.maxTier)}.BluRay.${langPart}.${codecPart}.mkv`]
  if (s.remux) accepted.push(`${base}.${tierLabel(s.maxTier)}.BluRay.REMUX.${langPart}.${codecPart}.mkv`)
  const rejected = []
  if (req.length) rejected.push({ name: `${base}.${tierLabel(s.maxTier)}.BluRay.English.${codecPart}.mkv`, reason: `fehlt: ${req.map(l => l.label).join(' + ')}` })
  if (s.minTier > 720) rejected.push({ name: `${base}.720p.WEB.${langPart}.${codecPart}.mkv`, reason: `Qualität unter ${tierLabel(s.minTier)}` })
  if (s.maxTier < 2160) rejected.push({ name: `${base}.2160p.BluRay.${langPart}.${codecPart}.mkv`, reason: 'über Max-Qualität (4K)' })
  if (s.hdr === 'no') rejected.push({ name: `${base}.${tierLabel(s.maxTier)}.BluRay.HDR.${langPart}.${codecPart}.mkv`, reason: 'HDR ausgeschlossen' })
  for (const c of noCodecs) rejected.push({ name: `${base}.${tierLabel(s.maxTier)}.BluRay.${langPart}.${c.sample}.mkv`, reason: `Codec ${c.label} nicht erwünscht` })
  const blGroups = String(s.blacklist || '').split(',').map(x => x.trim()).filter(Boolean)
  if (blGroups.length) rejected.push({ name: `${base}.${tierLabel(s.maxTier)}.BluRay.${langPart}.${codecPart}-${blGroups[0]}.mkv`, reason: `Release-Gruppe „${blGroups[0]}" blockiert` })
  if (s.maxSize > 0) rejected.push({ name: `${base}.2160p.BluRay.REMUX.${langPart}.${codecPart}.mkv`, reason: `größer als ${s.maxSize} GB` })
  return { accepted, rejected: rejected.slice(0, 5) }
}

function describeSettings(s) {
  return [
    { k: 'Sprache Pflicht', v: LANGUAGES.filter(l => s.langStates[l.id] === 'required').map(l => l.label).join(', ') || '—' },
    { k: 'Sprache Optional', v: LANGUAGES.filter(l => s.langStates[l.id] === 'preferred').map(l => l.label).join(', ') || '—' },
    { k: 'Qualität', v: qLabelOf(s.minTier, s.maxTier) },
    { k: 'HDR / DV', v: s.hdr === 'pref' ? 'bevorzugt' : s.hdr === 'no' ? 'ohne' : 'egal' },
    { k: 'Max-Größe', v: s.maxSize > 0 ? s.maxSize + ' GB' : 'aus' },
    { k: 'Codec', v: CODECS.filter(c => s.codecStates[c.id] === 'pref').map(c => c.label).join(', ') || 'egal' },
    { k: 'Remux', v: s.remux ? 'bevorzugt' : 'egal' },
    { k: 'Blacklist', v: (s.blacklist || '').trim() || '—' },
  ]
}

// ---------- Hook: kapselt Laden/Speichern/Historie eines Panels ----------
function usePanelState(app) {
  const [profiles, setProfiles] = useState([])
  const [sel, setSel] = useState(null)
  const [settings, setSettings] = useState(SETTINGS_DEFAULT())
  const [status, setStatus] = useState({ text: 'verbinde…', kind: 'info' })
  const [busy, setBusy] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [history, setHistory] = useState([])      // [{field,label,old,value,time}]
  const [lastChange, setLastChange] = useState(null)
  const [conn, setConn] = useState(null)          // {ms,version} | {error}
  const [dirty, setDirty] = useState(false)
  const savedKey = id => `regler-saved-${app.id}-${id}`

  useEffect(() => { (async () => { try { const list = await getProfiles(app); setProfiles(list); setSel(list.find(p => p.id === 4)?.id ?? list[0]?.id) } catch (e) { setStatus({ text: 'keine Verbindung (Stack/Docker an?)', kind: 'err' }) } })() }, [])
  useEffect(() => {
    if (sel == null) return
    setStatus({ text: 'lade Profil…', kind: 'info' }); setHistory([]); setLastChange(null); setDirty(false)
    const ls = Number(localStorage.getItem(savedKey(sel))); setLastSaved(ls || null)
    ;(async () => {
      try { const s = await loadSettings(app, sel); setSettings(normalizeSettings(s)); setStatus({ text: 'verbunden – Profil geladen', kind: 'ok' }) }
      catch (e) { setStatus({ text: 'Fehler: ' + e.message, kind: 'err' }) }
    })()
  }, [sel])

  const update = (field, value, label) => {
    setSettings(prev => {
      setHistory(h => [{ field, label, old: prev[field], value, time: Date.now() }, ...h].slice(0, 25))
      return { ...prev, [field]: value }
    })
    setLastChange({ field, value, label }); setDirty(true)
  }
  const setLang = (id, st) => update('langStates', { ...settings.langStates, [id]: st }, `${LANGUAGES.find(l => l.id === id).label} → ${STATES.find(x => x.id === st).label}`)
  const setCodec = (id, st) => update('codecStates', { ...settings.codecStates, [id]: st }, `Codec ${CODECS.find(c => c.id === id).label} → ${codecStateLabel(st)}`)
  const undo = () => setHistory(h => { if (!h.length) return h; const [last, ...rest] = h; setSettings(s => ({ ...s, [last.field]: last.old })); setLastChange(null); setDirty(true); toast(`Rückgängig: ${last.label}`, 'info'); return rest })
  const applyField = (field, value, label) => update(field, value, label)
  const importSettings = obj => { setSettings(normalizeSettings(obj)); setDirty(true); setLastChange(null); setHistory([]) }

  const save = async () => {
    const mx = settings.maxTier < settings.minTier ? settings.minTier : settings.maxTier
    setBusy(true); setStatus({ text: 'speichere…', kind: 'info' })
    try {
      await applySettings(app, sel, { ...settings, maxTier: mx })
      const t = Date.now(); setLastSaved(t); localStorage.setItem(savedKey(sel), String(t))
      setStatus({ text: 'Gespeichert – sofort aktiv ✓', kind: 'ok' }); setDirty(false); setLastChange(null)
      toast(`✅ ${app.title}: Gespeichert und an ${app.id === 'radarr' ? 'Radarr' : 'Sonarr'} übertragen`, 'ok')
    } catch (e) { setStatus({ text: 'Fehler: ' + e.message, kind: 'err' }); toast(`⚠️ ${app.title}: Speichern fehlgeschlagen – ${e.message}`, 'err', 6000) }
    setBusy(false)
  }
  const testConnection = async () => {
    setConn({ loading: true })
    const t0 = performance.now()
    try { const s = await api(app, '/api/v3/system/status', { timeout: 8000 }); setConn({ ms: Math.round(performance.now() - t0), version: s.version }); toast(`🔌 ${app.title}: erreichbar (${Math.round(performance.now() - t0)} ms · API ${s.version})`, 'ok') }
    catch (e) { setConn({ error: e.message }); toast(`🔌 ${app.title}: keine Verbindung`, 'err', 6000) }
  }
  const profName = profiles.find(p => p.id === sel)?.name || ''
  return { app, profiles, sel, setSel, settings, update, setLang, setCodec, undo, applyField, importSettings, save, testConnection, status, busy, lastSaved, history, lastChange, setLastChange, conn, dirty, profName }
}

// ---------- Live-Vorschau ----------
function Preview({ settings }) {
  const { accepted, rejected } = buildPreview(settings)
  return (
    <div className="preview">
      <div className="prev-head">👁️ Live-Vorschau – was diese Regeln bedeuten</div>
      {accepted.map((n, i) => <div className="prev-row ok" key={'a' + i}><span className="prev-mark">✅</span><code>{n}</code><span className="prev-tag">würde akzeptiert</span></div>)}
      {rejected.map((r, i) => <div className="prev-row no" key={'r' + i}><span className="prev-mark">❌</span><code>{r.name}</code><span className="prev-tag">{r.reason}</span></div>)}
      {rejected.length === 0 && <p className="hint">Sehr offene Regeln – fast alles würde akzeptiert.</p>}
    </div>
  )
}

// ---------- Änderungshistorie + Rückgängig ----------
function History({ history, onUndo }) {
  if (!history.length) return null
  const last = history[0]
  return (
    <div className="history">
      <div className="hist-top">
        <span className="hist-label">🕘 Zuletzt geändert: <b>{last.label}</b> ({relTime(last.time)})</span>
        <button className="mini-btn" onClick={onUndo}>↩ Rückgängig</button>
      </div>
      {history.length > 1 && (
        <details className="hist-det"><summary>Verlauf ({history.length})</summary>
          {history.map((h, i) => <div className="hist-item" key={i}><span>{h.label}</span><span className="hist-time">{relTime(h.time)}</span></div>)}
        </details>
      )}
    </div>
  )
}

// ---------- Präsentations-Panel ----------
function Panel({ p, peer }) {
  const { app, settings, status, busy, lastSaved, profName, lastChange } = p
  const s = settings
  const applyToPeer = () => { peer.applyField(lastChange.field, lastChange.value, `von ${app.title} übernommen`); toast(`↔ „${lastChange.label}" auch für ${peer.app.title} übernommen`, 'info'); p.setLastChange(null) }

  return (
    <section className="card" id={app.anchor}>
      <div className="card-head"><span className="emoji">{app.icon}</span><h2>{app.title}</h2>{p.dirty && <span className="dirty-pill">● ungespeichert</span>}<span className={'dot-status ' + status.kind} /></div>

      {/* Verbindungsstatus prominent */}
      <div className={'conn-banner ' + status.kind}>
        <span className="conn-dot" />
        <div className="conn-info">
          <div className="conn-line">{status.kind === 'ok' ? '🟢 Verbunden' : status.kind === 'err' ? '🔴 Keine Verbindung' : '🟡 ' + status.text}</div>
          <div className="conn-sub">Profil <b>{profName || '—'}</b> · {lastSaved ? <>zuletzt gespeichert <b>{relTime(lastSaved)}</b></> : 'noch nicht gespeichert'}</div>
        </div>
        <button className="mini-btn" onClick={p.testConnection} disabled={p.conn?.loading}>{p.conn?.loading ? '…' : '🔌 Test'}</button>
      </div>
      {p.conn && !p.conn.loading && <div className={'conn-test ' + (p.conn.error ? 'err' : 'ok')}>{p.conn.error ? '⚠️ ' + p.conn.error : `✅ erreichbar · ${p.conn.ms} ms · API-Version ${p.conn.version}`}</div>}

      {lastChange && peer.settings[lastChange.field] !== undefined && (
        <div className="apply-both"><span>„{lastChange.label}" – gleiche Einstellung auch für {peer.app.title}?</span><button className="mini-btn accent" onClick={applyToPeer}>↔ Auf beide anwenden</button></div>
      )}

      <label className="prof-label">Profil (beim Hinzufügen wählbar)</label>
      <select className="prof-select" value={p.sel ?? ''} onChange={e => p.setSel(Number(e.target.value))}>{p.profiles.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select>

      <h3>Sprachen</h3>
      <div className="langs">{LANGUAGES.map(l => <div className="lang-row" key={l.id}><span className="lang-name"><span className="flag">{l.flag}</span>{l.label}</span><Seg small options={STATES} value={s.langStates[l.id]} onChange={st => p.setLang(l.id, st)} /></div>)}</div>

      <h3>Qualität</h3>
      <div className="qrow"><span className="qlab">Mindestens</span><Seg small options={QUALITY_MIN} value={s.minTier} onChange={v => p.update('minTier', v, 'Min-Qualität → ' + tierLabel(v))} /></div>
      <div className="qrow"><span className="qlab">Höchstens</span><Seg small options={QUALITY_MAX} value={s.maxTier} onChange={v => p.update('maxTier', v, 'Max-Qualität → ' + tierLabel(v))} /></div>
      <div className="qrow"><span className="qlab">HDR / Dolby Vision</span><Seg small options={HDR_STATES} value={s.hdr} onChange={v => p.update('hdr', v, 'HDR → ' + (HDR_STATES.find(x => x.id === v)?.label))} /></div>
      <div className="qrow"><span className="qlab">Max. Dateigröße</span><Seg small options={MAXSIZE} value={s.maxSize} onChange={v => p.update('maxSize', v, 'Max-Größe → ' + (v ? v + ' GB' : 'aus'))} /></div>

      <h3>Erweiterte Qualität</h3>
      {CODECS.map(c => <div className="qrow" key={c.id}><span className="qlab">{c.flag} {c.label}</span><Seg small options={CODEC_STATES} value={s.codecStates[c.id]} onChange={st => p.setCodec(c.id, st)} /></div>)}
      <div className="qrow"><span className="qlab">🎬 Remux bevorzugen</span><Seg small options={REMUX_STATES} value={s.remux ? 'yes' : 'no'} onChange={v => p.update('remux', v === 'yes', 'Remux → ' + (v === 'yes' ? 'bevorzugt' : 'egal'))} /></div>
      <label className="prof-label" style={{ marginTop: 12 }}>🚫 Release-Gruppen Blacklist (kommagetrennt)</label>
      <textarea className="prof-select bl-input" rows={2} placeholder="z. B. YIFY, RARBG, EVO" value={s.blacklist} onChange={e => p.update('blacklist', e.target.value, 'Blacklist geändert')} />

      <p className="hint">Innerhalb der Spanne wird die beste Qualität bevorzugt. Max-Größe & Blacklist lehnen passende Releases ab.</p>

      <Preview settings={s} />

      <div className="summary"><b>{profName}</b> · <b>{qLabelOf(s.minTier, s.maxTier)}</b>{s.hdr === 'pref' ? ' · HDR bevorzugt' : s.hdr === 'no' ? ' · ohne HDR' : ''}{s.maxSize > 0 ? ' · max ' + s.maxSize + ' GB' : ''}{s.remux ? ' · Remux' : ''}</div>

      <History history={p.history} onUndo={p.undo} />

      <button className="save" onClick={p.save} disabled={busy || p.sel == null}>{busy ? '…' : '💾  Speichern & aktivieren'}</button>
      <div className={'status ' + status.kind}>{status.text}</div>
    </section>
  )
}

// ---------- Profil-Vergleich ----------
function ProfileCompare({ a, b }) {
  const da = describeSettings(a.settings), db = describeSettings(b.settings)
  return (
    <section className="card compare-card">
      <div className="card-head"><span className="emoji">⚖️</span><h2>Profil-Vergleich</h2></div>
      <div className="cmp-grid">
        <div className="cmp-h">Einstellung</div>
        <div className="cmp-h">🎬 {a.profName || 'Filme'}</div>
        <div className="cmp-h">📺 {b.profName || 'Serien'}</div>
        {da.map((row, i) => {
          const diff = row.v !== db[i].v
          return (
            <React.Fragment key={i}>
              <div className={'cmp-k' + (diff ? ' diff' : '')}>{row.k}</div>
              <div className={'cmp-v' + (diff ? ' diff' : '')}>{row.v}</div>
              <div className={'cmp-v' + (diff ? ' diff' : '')}>{db[i].v}</div>
            </React.Fragment>
          )
        })}
      </div>
      <p className="hint">Gelb markierte Zeilen unterscheiden sich zwischen Filme- und Serien-Profil.</p>
    </section>
  )
}

// ---------- Import / Export ----------
function exportSettings(a, b) {
  const data = {
    app: 'mediastack-regler', version: 1, exportedAt: new Date().toISOString(),
    radarr: { profile: a.profName, settings: a.settings },
    sonarr: { profile: b.profName, settings: b.settings },
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const el = document.createElement('a')
  el.href = url; el.download = `regler-einstellungen-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url)
  toast('📤 Einstellungen exportiert (JSON heruntergeladen)', 'ok')
}
function importSettings(file, a, b) {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result)
      if (data.radarr?.settings) a.importSettings(data.radarr.settings)
      if (data.sonarr?.settings) b.importSettings(data.sonarr.settings)
      toast('📥 Importiert – zum Übertragen je „Speichern & aktivieren" klicken', 'info', 6000)
    } catch (e) { toast('⚠️ Import fehlgeschlagen: ' + e.message, 'err', 6000) }
  }
  reader.readAsText(file)
}

// ---------- Einstellungs-Ansicht: hält beide Panels + globale Aktionen ----------
function SettingsView() {
  const radarr = usePanelState(APPS[0])
  const sonarr = usePanelState(APPS[1])
  const fileRef = React.useRef(null)
  return (
    <>
      <div className="settings-toolbar">
        <span className="tb-label">Einstellungen sichern / übertragen:</span>
        <button className="mini-btn" onClick={() => exportSettings(radarr, sonarr)}>📤 Exportieren (JSON)</button>
        <button className="mini-btn" onClick={() => fileRef.current?.click()}>📥 Importieren</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) importSettings(e.target.files[0], radarr, sonarr); e.target.value = '' }} />
      </div>
      <div className="grid">
        <Panel p={radarr} peer={sonarr} />
        <Panel p={sonarr} peer={radarr} />
      </div>
      <ProfileCompare a={radarr} b={sonarr} />
    </>
  )
}

function suggestFix(reasons, meta = {}) {
  const txt = reasons.join(' ').toLowerCase()
  if (txt.includes('custom format') && txt.includes('minimum')) return { why: 'Deine Sprach-Pflicht ist zu streng – kein Release erfüllt sie.', fix: 'In „Einstellungen" die Sprache (z. B. Deutsch) auf „Optional" statt „Pflicht" stellen.' }
  if (txt.includes('meets cutoff')) return { why: 'Es wurde bereits ein passendes Release gegriffen – alles gut.', fix: 'Schau bei „Aktive Downloads" oder in der Bibliothek.' }
  if (txt.includes('tracker') || txt.includes('indexer') && txt.includes('error')) return { why: 'Ein Indexer/Tracker meldet einen Fehler (offline, Limit erreicht oder Login abgelaufen).', fix: 'In Prowlarr die Indexer testen – evtl. ist ein Tracker gerade down oder dein Tageslimit ist erreicht.' }
  if (txt.includes('not wanted') || (txt.includes('quality') && txt.includes('rejected'))) return { why: 'Die gefundenen Releases haben eine Qualität, die du ausgeschlossen hast.', fix: 'In „Einstellungen" die Qualitäts-Spanne erweitern (z. B. „ab 720p" oder „bis 4K").' }
  if (txt.includes('size')) return { why: 'Die Releases sind größer als deine Max-Größe.', fix: 'In „Einstellungen" die „Max. Dateigröße" erhöhen oder auf „Aus".' }
  if (txt.includes('seeder') || (meta.found > 0 && meta.maxSeed === 0)) return { why: 'Die Releases haben zu wenige Seeder (niemand teilt sie gerade).', fix: 'Später nochmal versuchen, oder im „Suchen"-Tab eines mit mehr Seedern wählen.' }
  if (!reasons.length && !meta.found) return { why: 'Es wurden keine Releases gefunden (gibt es evtl. nicht auf den öffentlichen Indexern).', fix: 'Im „Suchen"-Tab prüfen, oder einen deutschen Tracker hinzufügen.' }
  return { why: 'Releases wurden gefunden, aber alle abgelehnt.', fix: 'Im „Suchen"-Tab anschauen – dort kannst du auch „abgelehnte" manuell laden.' }
}

const FILTERS = [
  { id: 'all', label: 'Alle' },
  { id: 'active', label: '🟢 Aktiv' },
  { id: 'queue', label: '🟡 Warteschlange' },
  { id: 'missing', label: '🔴 Fehlt' },
  { id: 'done', label: '✅ Fertig' },
]
// welche Download-Kategorien zeigt ein Filter?
const FILTER_CATS = { active: ['active'], queue: ['queue', 'meta'], done: ['done'], missing: ['problem'] }

function StatChip({ cat, n }) {
  if (!n) return null
  return <span className={'stat-chip ' + cat}>{CATS[cat].icon} {n}</span>
}

function Status() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [interval, setIntervalMs] = useState(() => Number(localStorage.getItem('regler-refresh')) || 5000)
  const [modal, setModal] = useState(null)
  const [openG, setOpenG] = useState({})       // aufgeklappte Download-Staffeln
  const [openMiss, setOpenMiss] = useState({})  // aufgeklappte fehlt-Staffeln
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [flash, setFlash] = useState(false)

  const load = async () => {
    try {
      const h = k => ({ headers: { 'X-Api-Key': k } })
      const [rq, sq, rm, sm, qbt] = await Promise.all([
        fetch('/radarr/api/v3/queue?pageSize=200', h(RADARR_KEY)).then(r => r.json()).catch(() => ({ records: [] })),
        fetch('/sonarr/api/v3/queue?pageSize=200', h(SONARR_KEY)).then(r => r.json()).catch(() => ({ records: [] })),
        fetch('/radarr/api/v3/wanted/missing?pageSize=500', h(RADARR_KEY)).then(r => r.json()).catch(() => ({ records: [], totalRecords: 0 })),
        fetch('/sonarr/api/v3/wanted/missing?pageSize=500', h(SONARR_KEY)).then(r => r.json()).catch(() => ({ records: [], totalRecords: 0 })),
        fetch('/qbt/api/v2/torrents/info').then(r => r.json()).catch(() => []),
      ])
      const queue = [...(rq.records || []).map(x => ({ ...x, kind: '🎬', appId: 'radarr' })), ...(sq.records || []).map(x => ({ ...x, kind: '📺', appId: 'sonarr' }))]
      setD({ queue, torrents: qbt || [], missR: rm, missS: sm }); setErr(null)
      setLastUpdate(new Date()); setFlash(true); setTimeout(() => setFlash(false), 700)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load(); const t = setInterval(load, interval); return () => clearInterval(t) }, [interval])
  useEffect(() => { localStorage.setItem('regler-refresh', String(interval)) }, [interval])

  const why = async (appId, item, hasTorrent) => {
    const title = item.title || `${item.series?.title} S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
    setModal({ title, loading: true })
    try {
      const app = appById(appId)
      const q = appId === 'radarr' ? `movieId=${item.id}` : `episodeId=${item.id}`
      const rel = await api(app, `/api/v3/release?${q}`, { timeout: 10000 })
      const accepted = rel.filter(r => !r.rejected)
      const reasons = [...new Set(rel.flatMap(r => r.rejections || []))].slice(0, 5)
      const maxSeed = rel.reduce((a, r) => Math.max(a, r.seeders || 0), 0)
      setModal({ title, loading: false, found: rel.length, accepted: accepted.length, reasons, maxSeed, hasTorrent, ...suggestFix(reasons, { found: rel.length, accepted: accepted.length, maxSeed }), appId, item })
    } catch (e) { setModal({ title: 'Fehler', loading: false, why: e.message, fix: '', reasons: [] }) }
  }
  const searchNow = async (appId, item) => {
    try {
      const app = appById(appId)
      const body = appId === 'radarr' ? `{"name":"MoviesSearch","movieIds":[${item.id}]}` : `{"name":"EpisodeSearch","episodeIds":[${item.id}]}`
      await api(app, '/api/v3/command', { method: 'POST', body }); setModal(m => ({ ...m, searched: true }))
    } catch (e) { setModal(m => ({ ...m, why: 'Suche-Fehler: ' + e.message })) }
  }
  const askAI = async () => {
    const m0 = modal
    setModal(m => ({ ...m, aiBusy: true }))
    try {
      const prompt = `Du bist ein Helfer für eine Medien-Download-App (Radarr/Sonarr). Ein Titel wurde NICHT heruntergeladen.\nTitel: ${m0.title}\nGefundene Releases: ${m0.found}, davon passend zur Regel: ${m0.accepted}\nAblehnungsgründe: ${(m0.reasons || []).join(' | ') || 'keine'}\nErkläre dem Nutzer auf einfachem Deutsch in 2-3 Sätzen, warum nichts geladen wurde und was er konkret in den Einstellungen (Sprache Pflicht/Optional, Qualität min/max, Max-Größe) ändern soll. Kurz und klar.`
      const a = await callAI(prompt)
      setModal(m => ({ ...m, aiBusy: false, aiAnswer: a }))
    } catch (e) { setModal(m => ({ ...m, aiBusy: false, aiAnswer: '⚠️ KI-Fehler: ' + e.message + '  (Läuft Ollama? Modell installiert? Bei „localhost" muss Ollama auf diesem PC laufen – sonst in 🧠 KI-Einstellungen die Server-Adresse setzen.)' })) }
  }

  // ----- Download-Reihen aus qBittorrent (+ ergänzend *arr-Queue) bauen -----
  const torrents = d?.torrents || []
  const rows = []
  torrents.forEach(t => {
    const seeds = t.num_seeds ?? t.numSeeds ?? 0
    const leech = t.num_leechs ?? t.numLeechs ?? 0
    const speed = t.dlspeed || 0
    const prog = t.progress || 0
    const sizeleft = t.amount_left != null ? t.amount_left : (t.size || 0) * (1 - prog)
    rows.push({
      key: t.hash, label: t.name, prog, speed, state: t.state, size: t.size || 0, sizeleft,
      eta: t.eta, seeds, leech, priority: t.priority || 0,
      cat: classifyState(t.state, { speed, prog, seeds, leech }),
    })
  })
  ;(d?.queue || []).forEach(q => {
    if (torrents.some(t => t.name === q.title || t.name.replace(/\.\w+$/, '') === q.title)) return
    const prog = q.size > 0 ? (q.size - q.sizeleft) / q.size : 0
    rows.push({
      key: 'q' + q.title, label: q.kind + ' ' + q.title, prog, speed: 0, state: q.status,
      size: q.size || 0, sizeleft: q.sizeleft || 0, eta: null, seeds: 0, leech: 0, priority: 0,
      cat: classifyState(q.status, { prog }),
    })
  })

  // Warteschlangen-Positionen vergeben (nach qBittorrent priority, niedriger = früher dran)
  const queued = rows.filter(r => r.cat === 'queue').sort((a, b) => (a.priority || 9999) - (b.priority || 9999))
  const posByKey = {}
  queued.forEach((r, i) => { posByKey[r.key] = i + 1 })

  // Gesamt-Zähler
  const count = { active: 0, queue: 0, meta: 0, done: 0, problem: 0 }
  rows.forEach(r => { count[r.cat]++ })
  const totSpeed = rows.reduce((a, r) => a + (r.speed || 0), 0)
  const totSize = rows.reduce((a, r) => a + (r.size || 0), 0)
  const totDone = rows.reduce((a, r) => a + (r.size || 0) * r.prog, 0)
  const overall = totSize > 0 ? (totDone / totSize) * 100 : 0
  const remainBytes = rows.filter(r => r.cat === 'active' || r.cat === 'queue' || r.cat === 'meta').reduce((a, r) => a + (r.sizeleft || 0), 0)
  const totETA = totSpeed > 0 ? remainBytes / totSpeed : null

  // Filter + Suche auf Download-Reihen
  const q = search.trim().toLowerCase()
  const visibleRows = rows.filter(r => {
    if (q && !r.label.toLowerCase().includes(q)) return false
    if (filter === 'all' || filter === 'missing') return filter === 'all'
    return (FILTER_CATS[filter] || []).includes(r.cat)
  })

  // nach Staffel gruppieren
  const groups = {}
  visibleRows.forEach(r => { const s = seasonOf(r.label); const key = s != null ? 'S' + String(s).padStart(2, '0') : 'movies'; (groups[key] ||= { key, label: s != null ? 'Staffel ' + s : '🎬 Filme / Sonstiges', sort: s != null ? s : 999, items: [] }).items.push(r) })
  const groupList = Object.values(groups).sort((a, b) => a.sort - b.sort)
  const gStat = g => {
    const s = g.items.reduce((a, r) => a + (r.size || 0), 0)
    const dn = g.items.reduce((a, r) => a + (r.size || 0) * r.prog, 0)
    const spd = g.items.reduce((a, r) => a + (r.speed || 0), 0)
    const left = g.items.filter(r => r.cat === 'active' || r.cat === 'queue' || r.cat === 'meta').reduce((a, r) => a + (r.sizeleft || 0), 0)
    const c = { active: 0, queue: 0, meta: 0, done: 0, problem: 0 }
    g.items.forEach(r => c[r.cat]++)
    return { pct: s > 0 ? dn / s * 100 : 0, speed: spd, eta: spd > 0 ? left / spd : null, c }
  }

  // ----- fehlt: nur WIRKLICH fehlende (kein Torrent vorhanden) -----
  // Abgleich: hat ein missing-Eintrag bereits einen passenden Torrent in qBittorrent?
  const torrentNames = torrents.map(t => normTitle(t.name))
  const hasTorrentFor = (titleParts) => {
    const want = titleParts.filter(Boolean).map(normTitle)
    return torrentNames.some(n => want.every(w => n.includes(w)))
  }
  const missRRecords = (d?.missR?.records || []).filter(m => !hasTorrentFor([m.title]))
  const missSRecords = (d?.missS?.records || []).filter(m => !hasTorrentFor([m.series?.title, 'S' + String(m.seasonNumber).padStart(2, '0')]))
  const missByS = {}
  missSRecords.forEach(m => { const k = m.seasonNumber ?? 0; (missByS[k] ||= []).push(m) })
  const missSeasons = Object.keys(missByS).map(Number).sort((a, b) => a - b)
  const missTotal = missRRecords.length + missSRecords.length

  const showDownloads = filter !== 'missing'
  const showMissing = filter === 'all' || filter === 'missing'

  return (
    <div className="status-wrap">
      <div className="status-bar">
        <span className={'live-dot' + (flash ? ' flash' : '')} /> Aktualisierung:
        <Seg small options={REFRESH_OPTS} value={interval} onChange={setIntervalMs} />
        <button className="mini-btn" onClick={load}>↻ jetzt</button>
        <span className="last-upd">Zuletzt: {fmtTime(lastUpdate)}</span>
      </div>
      <div className="filter-bar">
        <div className="filter-btns">{FILTERS.map(f => <button key={f.id} className={'filter-btn' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div>
        <input className="filter-search" placeholder="🔍 Serie/Film suchen…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {err && <div className="card status-card"><p className="status err">Fehler: {err}</p></div>}
      {!d && !err && <div className="card status-card"><p className="hint">lade…</p></div>}
      {d && <>
        {showDownloads && <section className="card status-card">
          <div className="card-head"><span className="emoji">⬇️</span><h2>Aktive Downloads</h2>
            <span className="dl-totspeed">↓ {fmtSpeed(totSpeed)}</span>
          </div>
          <div className="stat-row">
            <StatChip cat="active" n={count.active} />
            <StatChip cat="queue" n={count.queue} />
            <StatChip cat="meta" n={count.meta} />
            <StatChip cat="done" n={count.done} />
            <StatChip cat="problem" n={count.problem} />
            {rows.length === 0 && <span className="empty">Gerade läuft kein Download.</span>}
            {totETA != null && <span className="stat-eta">⏱ noch ca. {fmtETA(totETA)}</span>}
          </div>
          {rows.length > 0 && <div className="overall"><div className="overall-top"><b>Gesamt-Fortschritt</b><span className="dl-pct">{Math.round(overall)}%</span></div><Bar pct={overall} /></div>}
          {groupList.length === 0 && rows.length > 0 && <p className="empty">Keine Treffer für diesen Filter/Suche.</p>}
          {groupList.map(g => {
            const open = !!openG[g.key]
            const st = gStat(g)
            return (
              <div className="grp" key={g.key}>
                <button className="grp-head" onClick={() => setOpenG(o => ({ ...o, [g.key]: !o[g.key] }))}>
                  <span className="grp-arrow">{open ? '▾' : '▸'}</span>
                  <span className="grp-label">{g.label}</span>
                  <span className="grp-count">{g.items.length}</span>
                  <span className="grp-icons">{['active', 'queue', 'meta', 'done', 'problem'].map(c => st.c[c] ? <span key={c} className="mini-icon">{CATS[c].icon}{st.c[c]}</span> : null)}</span>
                  <span className="grp-bar"><Bar pct={st.pct} /></span>
                  <span className="grp-pct">{Math.round(st.pct)}%</span>
                  <span className="grp-spd">{st.speed > 0 ? '↓ ' + fmtBytes(st.speed) + '/s' : ''}{st.eta != null ? ' · ' + fmtETA(st.eta) : ''}</span>
                </button>
                {open && g.items.map(r => (
                  <div className={'dl-row cat-' + r.cat} key={r.key}>
                    <div className="dl-top">
                      <span className="dl-name"><span className="dl-ico">{CATS[r.cat].icon}</span>{r.label}</span>
                      <span className="dl-pct">{Math.round(r.prog * 100)}%</span>
                    </div>
                    <Bar pct={r.prog * 100} />
                    <div className="dl-meta">
                      <span className="dl-state">{CATS[r.cat].label}</span>
                      {r.cat === 'queue' && posByKey[r.key] ? ' · ⏳ Position ' + posByKey[r.key] + ' in Warteschlange' : ''}
                      {r.speed > 0 ? ' · ↓ ' + fmtBytes(r.speed) + '/s' : ''}
                      {r.cat === 'active' ? ' · ⏱ ' + fmtETA(r.eta != null ? r.eta : (r.speed > 0 ? r.sizeleft / r.speed : null)) : ''}
                      {' · ' + fmtBytes(r.sizeleft) + ' übrig von ' + fmtBytes(r.size)}
                      {(r.cat === 'queue' || r.cat === 'problem') ? ' · ' + r.seeds + ' Seeds / ' + r.leech + ' Peers' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </section>}

        {showMissing && <section className="card status-card warn">
          <div className="card-head"><span className="emoji">🔴</span><h2>Wirklich fehlend</h2><span className="live">{missTotal}</span></div>
          <p className="hint">Nur Inhalte ohne Torrent in qBittorrent. Wartende Downloads stehen oben unter „Warteschlange". Klick „Warum?" für die Diagnose.</p>
          <div className="miss-grid">
            <div>
              <div className="miss-head">🎬 Filme ({missRRecords.length})</div>
              <div className="miss-scroll">
                {missRRecords.map(m => <div className="miss-item act" key={m.id}><span>{m.title} {m.year ? '(' + m.year + ')' : ''}</span><button className="why-btn" onClick={() => why('radarr', m, false)}>Warum?</button></div>)}
                {missRRecords.length === 0 && <div className="miss-item empty">— nichts —</div>}
              </div>
            </div>
            <div>
              <div className="miss-head">📺 Serien-Folgen ({missSRecords.length})</div>
              <div className="miss-scroll">
                {missSeasons.map(s => {
                  const open = !!openMiss[s]
                  return (
                    <div className="grp" key={s}>
                      <button className="grp-head sm" onClick={() => setOpenMiss(o => ({ ...o, [s]: !o[s] }))}>
                        <span className="grp-arrow">{open ? '▾' : '▸'}</span><span className="grp-label">Staffel {s}</span><span className="grp-count">{missByS[s].length}</span>
                      </button>
                      {open && missByS[s].map(m => <div className="miss-item act" key={m.id}><span>{m.series?.title || ''} S{String(m.seasonNumber).padStart(2, '0')}E{String(m.episodeNumber).padStart(2, '0')}</span><button className="why-btn" onClick={() => why('sonarr', m, false)}>Warum?</button></div>)}
                    </div>
                  )
                })}
                {missSeasons.length === 0 && <div className="miss-item empty">— nichts —</div>}
              </div>
            </div>
          </div>
        </section>}
      </>}

      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>{modal.title}</h3><button className="x" onClick={() => setModal(null)}>✕</button></div>
            {modal.loading ? <p className="hint">analysiere über alle Indexer … (max. 10s)</p> : <>
              {modal.found != null && <p className="modal-stat"><b>{modal.found}</b> Releases gefunden · <b>{modal.accepted}</b> passen zu deiner Regel{modal.maxSeed != null ? ' · max. ' + modal.maxSeed + ' Seeder' : ''}</p>}
              <div className="modal-box why"><b>Warum:</b> {modal.why}</div>
              {modal.fix && <div className="modal-box fix"><b>Lösung:</b> {modal.fix}</div>}
              {modal.reasons?.length > 0 && <details className="modal-det"><summary>technische Ablehnungsgründe</summary>{modal.reasons.map((r, i) => <div key={i} className="reason">{r}</div>)}</details>}
              {modal.searched && <p className="status ok">Suche gestartet! Schau bei „Aktive Downloads".</p>}
              {modal.aiBusy && <div className="modal-box why">🧠 KI denkt nach…</div>}
              {modal.aiAnswer && <div className="modal-box ai"><b>🧠 KI:</b> {modal.aiAnswer}</div>}
              <div className="modal-actions">
                {modal.appId && !modal.searched && <button className="save inline" onClick={() => searchNow(modal.appId, modal.item)}>🔍 Jetzt suchen</button>}
                {modal.found != null && <button className="mini-btn" onClick={askAI} disabled={modal.aiBusy}>🧠 KI fragen</button>}
                <button className="mini-btn" onClick={() => setModal(null)}>Schließen</button>
              </div>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

function SearchTab() {
  const [appId, setAppId] = useState('radarr')
  const [items, setItems] = useState([])
  const [selId, setSelId] = useState('')
  const [season, setSeason] = useState('')
  const [sortBy, setSortBy] = useState('quality')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { (async () => {
    try { const a = appById(appId); const list = await api(a, appId === 'radarr' ? '/api/v3/movie' : '/api/v3/series'); list.sort((x, y) => (x.sortTitle || x.title).localeCompare(y.sortTitle || y.title)); setItems(list); setSelId(list[0]?.id ?? ''); setResults(null); setMsg('') }
    catch (e) { setMsg('Konnte Bibliothek nicht laden: ' + e.message) }
  })() }, [appId])

  const cur = items.find(i => i.id === Number(selId))
  const seasons = cur?.seasons?.filter(s => s.seasonNumber > 0).map(s => s.seasonNumber) || []
  const sortRel = (arr) => arr.sort((x, y) => (Number(!!x.rejected) - Number(!!y.rejected)) || (sortBy === 'seeders' ? (y.seeders || 0) - (x.seeders || 0) : (tierOf(y.quality?.quality?.name || '') - tierOf(x.quality?.quality?.name || '')) || ((y.seeders || 0) - (x.seeders || 0))))
  const doSearch = async () => {
    setLoading(true); setResults(null); setMsg('suche über alle Indexer … (~1 Min)')
    try { const a = appById(appId); const q = appId === 'radarr' ? `movieId=${selId}` : `seriesId=${selId}` + (season ? `&seasonNumber=${season}` : ''); const rel = await api(a, `/api/v3/release?${q}`); setResults(sortRel(rel)); setMsg(rel.length ? '' : 'Keine Treffer.') }
    catch (e) { setMsg('Fehler: ' + e.message) }
    setLoading(false)
  }
  useEffect(() => { if (results) setResults(r => sortRel([...r])) }, [sortBy])
  const grab = async (r) => { try { await api(appById(appId), '/api/v3/release', { method: 'POST', body: JSON.stringify({ guid: r.guid, indexerId: r.indexerId }) }); setMsg('„' + r.title + '" wird geladen! → Downloads-Tab.') } catch (e) { setMsg('Laden fehlgeschlagen: ' + e.message) } }

  return (
    <div className="search-wrap">
      <section className="card">
        <div className="card-head"><span className="emoji">🔎</span><h2>Manuell suchen & auswählen</h2></div>
        <div className="search-controls">
          <Seg options={[{ id: 'radarr', label: '🎬 Filme' }, { id: 'sonarr', label: '📺 Serien' }]} value={appId} onChange={setAppId} />
          <select className="prof-select grow" value={selId} onChange={e => { setSelId(e.target.value); setSeason('') }}>{items.map(i => <option key={i.id} value={i.id}>{i.title}{i.year ? ' (' + i.year + ')' : ''}</option>)}</select>
          {appId === 'sonarr' && seasons.length > 0 && <select className="prof-select" value={season} onChange={e => setSeason(e.target.value)}><option value="">ganze Serie</option>{seasons.map(s => <option key={s} value={s}>Staffel {s}</option>)}</select>}
          <button className="save inline" onClick={doSearch} disabled={loading || !selId}>{loading ? 'suche…' : '🔎 Suchen'}</button>
        </div>
        <div className="search-controls" style={{ marginTop: 10 }}><span className="qlab">Sortieren:</span><Seg small options={[{ id: 'quality', label: 'Beste Qualität' }, { id: 'seeders', label: 'Schnellste (Seeder)' }]} value={sortBy} onChange={setSortBy} /></div>
        {msg && <div className="status info" style={{ marginTop: 10 }}>{msg}</div>}
      </section>
      {results && results.length > 0 && (
        <section className="card">
          <div className="card-head"><span className="emoji">📋</span><h2>{results.length} Treffer</h2></div>
          <div className="res-list">
            {results.slice(0, 50).map((r, i) => {
              const hdr = detectHDR(r.title); const langs = (r.languages || []).map(l => l.name).filter(n => n && n !== 'Unknown').join(', ')
              return (
                <div className={'res-row' + (r.rejected ? ' rej' : '')} key={i}>
                  <div className="res-main"><div className="res-title">{r.title}</div>
                    <div className="res-tags"><span className="tag q">{r.quality?.quality?.name || '?'}</span><span className="tag">{fmtBytes(r.size)}</span><span className={'tag ' + (hdr === 'SDR' ? '' : 'hdr')}>{hdr}</span>{langs && <span className="tag">{langs}</span>}<span className="tag seed">⬆ {r.seeders ?? '?'}</span><span className="tag">{r.indexer}</span>{r.rejected && <span className="tag bad" title={(r.rejections || []).join('; ')}>abgelehnt</span>}</div>
                  </div>
                  <button className="grab-btn" onClick={() => grab(r)}>⬇ Laden</button>
                </div>
              )
            })}
          </div>
          <p className="hint">„Schnellste (Seeder)" oben wählen = das mit den meisten Seedern (lädt am schnellsten). „Abgelehnt" kann man trotzdem laden.</p>
        </section>
      )}
    </div>
  )
}

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('regler-dark') === '1')
  const [menu, setMenu] = useState(false)
  const [view, setView] = useState(() => localStorage.getItem('regler-view') || 'settings')
  const [aiOpen, setAiOpen] = useState(false)
  useEffect(() => { document.body.classList.toggle('dark', dark); localStorage.setItem('regler-dark', dark ? '1' : '0') }, [dark])
  useEffect(() => { localStorage.setItem('regler-view', view) }, [view])

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand"><span className="brand-dot" /> MediaStack&nbsp;<b>Regler</b></div>
        <div className="links">
          <button className={'tab' + (view === 'settings' ? ' on' : '')} onClick={() => setView('settings')}>🎚️ Einstellungen</button>
          <button className={'tab' + (view === 'status' ? ' on' : '')} onClick={() => setView('status')}>⬇️ Downloads</button>
          <button className={'tab' + (view === 'search' ? ' on' : '')} onClick={() => setView('search')}>🔎 Suchen</button>
          <div className="menu-wrap" onMouseEnter={() => setMenu(true)} onMouseLeave={() => setMenu(false)}>
            <button className="menu-btn" onClick={() => setMenu(m => !m)}>Apps ▾</button>
            <div className={'menu' + (menu ? ' open' : '')}>{SERVICES.map(s => <a key={s.label} href={s.url} target="_blank" rel="noreferrer"><span>{s.icon}</span>{s.label}</a>)}</div>
          </div>
          <button className="theme-btn" onClick={() => setAiOpen(true)} title="KI-Einstellungen">🧠</button>
          <button className="theme-btn" onClick={() => setDark(d => !d)} title="Dark Mode">{dark ? '☀️' : '🌙'}</button>
        </div>
      </nav>
      <header className="hero">
        <ThreeBanner />
        <div className="hero-scrim" />
        <div className="hero-inner">
          <span className="kicker">DEIN MEDIA-STACK</span>
          <h1>Stell ein, was reinkommt.</h1>
          <p>Pro <b>Filme</b> &amp; <b>Serien</b> und pro <b>Profil</b>: Sprachen, Qualität, HDR und Maximal-Größe. Speichern – sofort live.</p>
        </div>
      </header>
      {view === 'settings' && <main><SettingsView /></main>}
      {view === 'status' && <main><Status /></main>}
      {view === 'search' && <main><SearchTab /></main>}
      <footer>
        <div><b>Tipp:</b> Für beste 4K ohne Riesendateien: <i>HDR bevorzugt</i> + <i>Max 25 GB</i>. Schnellster Download: im <i>Suchen</i>-Tab „Schnellste (Seeder)".</div>
        <div className="made">MediaStack Regler · lokal auf deinem Laptop</div>
      </footer>
      {aiOpen && <AISettings onClose={() => setAiOpen(false)} />}
      <ToastHost />
    </div>
  )
}
