import React, { useState, useEffect } from 'react'
import {
  RADARR_KEY, SONARR_KEY, cfReqName, cfPrefName, cfMaxName, CF_HDR, HDR_REGEX, LEGACY_CFS,
  LANGUAGES, STATES, QUALITY_MIN, QUALITY_MAX, HDR_STATES, MAXSIZE, REFRESH_OPTS, SERVICES,
  qName, tierOf, isExcluded, detectHDR,
} from './config.js'
import ThreeBanner from './ThreeBanner.jsx'

const APPS = [
  { id: 'radarr', anchor: 'filme', title: 'Filme', icon: '🎬', base: '/radarr', key: RADARR_KEY },
  { id: 'sonarr', anchor: 'serien', title: 'Serien', icon: '📺', base: '/sonarr', key: SONARR_KEY },
]
const appById = id => APPS.find(a => a.id === id)

async function api(app, path, opts = {}) {
  const r = await fetch(app.base + path, { ...opts, headers: { 'X-Api-Key': app.key, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}
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
const getProfiles = app => api(app, '/api/v3/qualityprofile')

async function ensureCF(app, name, regex) {
  const list = await api(app, '/api/v3/customformat')
  const cf = list.find(c => c.name === name)
  if (!cf) return api(app, '/api/v3/customformat', { method: 'POST', body: JSON.stringify({ name, includeCustomFormatWhenRenaming: false, specifications: [{ name: 'regex', implementation: 'ReleaseTitleSpecification', negate: false, required: true, fields: [{ name: 'value', value: regex }] }] }) })
  cf.specifications.forEach(s => s.fields.forEach(f => { if (f.name === 'value') f.value = regex }))
  return api(app, `/api/v3/customformat/${cf.id}`, { method: 'PUT', body: JSON.stringify(cf) })
}
async function ensureSizeCF(app, name, minGB) {
  const list = await api(app, '/api/v3/customformat')
  const cf = list.find(c => c.name === name)
  const spec = { name: 'size', implementation: 'SizeSpecification', negate: false, required: true, fields: [{ name: 'min', value: minGB }, { name: 'max', value: 999999 }] }
  if (!cf) return api(app, '/api/v3/customformat', { method: 'POST', body: JSON.stringify({ name, includeCustomFormatWhenRenaming: false, specifications: [spec] }) })
  cf.specifications = [spec]
  return api(app, `/api/v3/customformat/${cf.id}`, { method: 'PUT', body: JSON.stringify(cf) })
}
async function deleteByName(app, name) {
  try { const list = await api(app, '/api/v3/customformat'); const cf = list.find(c => c.name === name); if (cf) await api(app, `/api/v3/customformat/${cf.id}`, { method: 'DELETE' }) } catch (e) {}
}

async function applySettings(app, profileId, { langStates, minTier, maxTier, hdr, maxSize }) {
  const reqName = cfReqName(profileId), prefName = cfPrefName(profileId), maxName = cfMaxName(profileId)
  const required = LANGUAGES.filter(l => langStates[l.id] === 'required')
  const preferred = LANGUAGES.filter(l => langStates[l.id] === 'preferred')
  const reqRegex = required.length ? '(?i)' + required.map(l => `(?=.*(${l.token}))`).join('') : '(?s).*'
  const prefRegex = preferred.length ? `(?i)(${preferred.map(l => l.token).join('|')})` : 'zzz^neverMatch'
  await ensureCF(app, reqName, reqRegex)
  await ensureCF(app, prefName, prefRegex)
  await ensureCF(app, CF_HDR, HDR_REGEX)
  if (maxSize > 0) await ensureSizeCF(app, maxName, maxSize)
  for (const n of LEGACY_CFS) await deleteByName(app, n)
  const p = await api(app, `/api/v3/qualityprofile/${profileId}`)
  let highId = null, highTier = -1
  for (const it of p.items) {
    const name = qName(it); const tier = tierOf(name)
    const allowed = !isExcluded(name) && tier > 0 && tier >= minTier && tier <= maxTier
    it.allowed = allowed
    const id = it.quality ? it.quality.id : it.id
    if (allowed && tier >= highTier) { highTier = tier; highId = id }
  }
  if (highId != null) p.cutoff = highId
  p.upgradeAllowed = true
  p.minFormatScore = required.length ? 100 : 0
  const hdrScore = hdr === 'pref' ? 25 : hdr === 'no' ? -25 : 0
  ;(p.formatItems || []).forEach(fi => {
    if (fi.name === reqName) fi.score = required.length ? 100 : 0
    else if (fi.name === prefName) fi.score = preferred.length ? 20 : 0
    else if (fi.name === CF_HDR) fi.score = hdrScore
    else if (fi.name === maxName) fi.score = maxSize > 0 ? -1000 : 0
    else if (fi.name.startsWith('Regler ')) fi.score = 0
  })
  await api(app, `/api/v3/qualityprofile/${profileId}`, { method: 'PUT', body: JSON.stringify(p) })
}

async function loadSettings(app, profileId) {
  const p = await api(app, `/api/v3/qualityprofile/${profileId}`)
  const cfs = await api(app, '/api/v3/customformat')
  const valOf = name => { const c = cfs.find(x => x.name === name); return (c?.specifications?.[0]?.fields?.find(f => f.name === 'value')?.value || '').toLowerCase() }
  const reqVal = valOf(cfReqName(profileId)), prefVal = valOf(cfPrefName(profileId))
  const hasOwn = cfs.some(c => c.name === cfReqName(profileId) || c.name === cfPrefName(profileId))
  const required = p.minFormatScore > 0
  const langStates = {}
  for (const l of LANGUAGES) {
    if (reqVal.includes(l.detect) && required) langStates[l.id] = 'required'
    else if (prefVal.includes(l.detect)) langStates[l.id] = 'preferred'
    else langStates[l.id] = 'off'
  }
  if (!hasOwn) { LANGUAGES.forEach(l => { langStates[l.id] = 'off' }); if (required) langStates.en = 'required' }
  const tiers = p.items.filter(i => i.allowed).map(i => tierOf(qName(i))).filter(t => t > 0)
  let minTier = tiers.length ? Math.min(...tiers) : 1080
  let maxTier = tiers.length ? Math.max(...tiers) : 2160
  if (![720, 1080, 2160].includes(minTier)) minTier = 1080
  if (![1080, 2160].includes(maxTier)) maxTier = 2160
  const fi = p.formatItems || []
  const hdrScore = fi.find(f => f.name === CF_HDR)?.score || 0
  const hdr = hdrScore > 0 ? 'pref' : hdrScore < 0 ? 'no' : 'off'
  const maxScore = fi.find(f => f.name === cfMaxName(profileId))?.score || 0
  let maxSize = 0
  if (maxScore < 0) { const mc = cfs.find(c => c.name === cfMaxName(profileId)); maxSize = Number(mc?.specifications?.[0]?.fields?.find(f => f.name === 'min')?.value) || 0 }
  if (![0, 15, 25, 50].includes(maxSize)) maxSize = maxSize > 0 ? 25 : 0
  return { langStates, minTier, maxTier, hdr, maxSize }
}

function Seg({ options, value, onChange, small }) {
  return <div className={'seg' + (small ? ' small' : '')}>{options.map(o => <button key={o.id} className={'seg-btn ' + o.id + (value === o.id ? ' on' : '')} onClick={() => onChange(o.id)} title={o.hint || ''}>{o.label}</button>)}</div>
}
function Bar({ pct }) { return <div className="bar"><div className="bar-fill" style={{ width: Math.round(pct) + '%' }} /></div> }

function Panel({ app }) {
  const [profiles, setProfiles] = useState([])
  const [sel, setSel] = useState(null)
  const [langStates, setLangStates] = useState(Object.fromEntries(LANGUAGES.map(l => [l.id, 'off'])))
  const [minTier, setMinTier] = useState(1080)
  const [maxTier, setMaxTier] = useState(2160)
  const [hdr, setHdr] = useState('off')
  const [maxSize, setMaxSize] = useState(0)
  const [status, setStatus] = useState({ text: 'verbinde…', kind: 'info' })
  const [busy, setBusy] = useState(false)

  useEffect(() => { (async () => { try { const list = await getProfiles(app); setProfiles(list); setSel(list.find(p => p.id === 4)?.id ?? list[0]?.id) } catch (e) { setStatus({ text: 'keine Verbindung (Stack/Docker an?)', kind: 'err' }) } })() }, [])
  useEffect(() => {
    if (sel == null) return
    (async () => {
      setStatus({ text: 'lade Profil…', kind: 'info' })
      try { const s = await loadSettings(app, sel); setLangStates(s.langStates); setMinTier(s.minTier); setMaxTier(s.maxTier); setHdr(s.hdr); setMaxSize(s.maxSize); setStatus({ text: 'verbunden – Profil geladen', kind: 'ok' }) }
      catch (e) { setStatus({ text: 'Fehler: ' + e.message, kind: 'err' }) }
    })()
  }, [sel])
  const setLang = (id, st) => setLangStates(p => ({ ...p, [id]: st }))
  const save = async () => {
    let mx = maxTier < minTier ? minTier : maxTier
    setBusy(true); setStatus({ text: 'speichere…', kind: 'info' })
    try { await applySettings(app, sel, { langStates, minTier, maxTier: mx, hdr, maxSize }); setStatus({ text: 'Gespeichert – sofort aktiv ✓', kind: 'ok' }) }
    catch (e) { setStatus({ text: 'Fehler: ' + e.message, kind: 'err' }) }
    setBusy(false)
  }
  const reqList = LANGUAGES.filter(l => langStates[l.id] === 'required').map(l => l.label)
  const profName = profiles.find(p => p.id === sel)?.name || ''
  const qLabel = minTier === maxTier ? (minTier === 2160 ? 'nur 4K' : 'nur ' + minTier + 'p') : `${minTier}p–${maxTier === 2160 ? '4K' : maxTier + 'p'}`

  return (
    <section className="card" id={app.anchor}>
      <div className="card-head"><span className="emoji">{app.icon}</span><h2>{app.title}</h2><span className={'dot-status ' + status.kind} /></div>
      <label className="prof-label">Profil (beim Hinzufügen wählbar)</label>
      <select className="prof-select" value={sel ?? ''} onChange={e => setSel(Number(e.target.value))}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <h3>Sprachen</h3>
      <div className="langs">{LANGUAGES.map(l => <div className="lang-row" key={l.id}><span className="lang-name"><span className="flag">{l.flag}</span>{l.label}</span><Seg small options={STATES} value={langStates[l.id]} onChange={st => setLang(l.id, st)} /></div>)}</div>
      <h3>Qualität</h3>
      <div className="qrow"><span className="qlab">Mindestens</span><Seg small options={QUALITY_MIN} value={minTier} onChange={setMinTier} /></div>
      <div className="qrow"><span className="qlab">Höchstens</span><Seg small options={QUALITY_MAX} value={maxTier} onChange={setMaxTier} /></div>
      <div className="qrow"><span className="qlab">HDR / Dolby Vision</span><Seg small options={HDR_STATES} value={hdr} onChange={setHdr} /></div>
      <div className="qrow"><span className="qlab">Max. Dateigröße</span><Seg small options={MAXSIZE} value={maxSize} onChange={setMaxSize} /></div>
      <p className="hint">Innerhalb der Spanne wird die beste Qualität bevorzugt. Max-Größe lehnt zu große Dateien ab.</p>
      <div className="summary"><b>{profName}</b> · <b>{qLabel}</b>{hdr === 'pref' ? ' · HDR bevorzugt' : hdr === 'no' ? ' · ohne HDR' : ''}{maxSize > 0 ? ' · max ' + maxSize + ' GB' : ''}</div>
      <button className="save" onClick={save} disabled={busy || sel == null}>{busy ? '…' : '💾  Speichern & aktivieren'}</button>
      <div className={'status ' + status.kind}>{status.text}</div>
    </section>
  )
}

function suggestFix(reasons) {
  const txt = reasons.join(' ').toLowerCase()
  if (txt.includes('custom format') && txt.includes('minimum')) return { why: 'Deine Sprach-Pflicht ist zu streng – kein Release erfüllt sie.', fix: 'In „Einstellungen" die Sprache (z. B. Deutsch) auf „Optional" statt „Pflicht" stellen.' }
  if (txt.includes('meets cutoff')) return { why: 'Es wurde bereits ein passendes Release gegriffen – alles gut.', fix: 'Schau bei „Aktive Downloads" oder in der Bibliothek.' }
  if (txt.includes('not wanted') || (txt.includes('quality') && txt.includes('rejected'))) return { why: 'Die gefundenen Releases haben eine Qualität, die du ausgeschlossen hast.', fix: 'In „Einstellungen" die Qualitäts-Spanne erweitern (z. B. „ab 720p" oder „bis 4K").' }
  if (txt.includes('size')) return { why: 'Die Releases sind größer als deine Max-Größe.', fix: 'In „Einstellungen" die „Max. Dateigröße" erhöhen oder auf „Aus".' }
  if (txt.includes('seeder')) return { why: 'Die Releases haben zu wenige Seeder (niemand teilt sie gerade).', fix: 'Später nochmal versuchen, oder im „Suchen"-Tab eines mit mehr Seedern wählen.' }
  if (!reasons.length) return { why: 'Es wurden keine Releases gefunden (gibt es evtl. nicht auf den öffentlichen Indexern).', fix: 'Im „Suchen"-Tab prüfen, oder einen deutschen Tracker hinzufügen.' }
  return { why: 'Releases wurden gefunden, aber alle abgelehnt.', fix: 'Im „Suchen"-Tab anschauen – dort kannst du auch „abgelehnte" manuell laden.' }
}

function Status() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [interval, setIntervalMs] = useState(() => Number(localStorage.getItem('regler-refresh')) || 5000)
  const [modal, setModal] = useState(null)
  const [openG, setOpenG] = useState({})       // aufgeklappte Download-Staffeln
  const [openMiss, setOpenMiss] = useState({})  // aufgeklappte fehlt-Staffeln

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
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load(); const t = setInterval(load, interval); return () => clearInterval(t) }, [interval])
  useEffect(() => { localStorage.setItem('regler-refresh', String(interval)) }, [interval])

  const why = async (appId, item) => {
    const title = item.title || `${item.series?.title} S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
    setModal({ title, loading: true })
    try {
      const app = appById(appId)
      const q = appId === 'radarr' ? `movieId=${item.id}` : `episodeId=${item.id}`
      const rel = await api(app, `/api/v3/release?${q}`)
      const accepted = rel.filter(r => !r.rejected)
      const reasons = [...new Set(rel.flatMap(r => r.rejections || []))].slice(0, 5)
      setModal({ title, loading: false, found: rel.length, accepted: accepted.length, reasons, ...suggestFix(reasons), appId, item })
    } catch (e) { setModal({ title: 'Fehler', loading: false, why: e.message, fix: '', reasons: [] }) }
  }
  const searchNow = async (appId, item) => {
    try {
      const app = appById(appId)
      const body = appId === 'radarr' ? `{"name":"MoviesSearch","movieIds":[${item.id}]}` : `{"name":"EpisodeSearch","episodeIds":[${item.id}]}`
      await api(app, '/api/v3/command', { method: 'POST', body }); setModal(m => ({ ...m, searched: true }))
    } catch (e) { setModal(m => ({ ...m, why: 'Suche-Fehler: ' + e.message })) }
  }

  // Download-Reihen
  const rows = []
  ;(d?.torrents || []).forEach(t => rows.push({ key: t.hash, label: t.name, prog: t.progress, speed: t.dlspeed, state: t.state, size: t.size, sizeleft: t.size * (1 - t.progress) }))
  ;(d?.queue || []).forEach(q => { if ((d.torrents || []).some(t => t.name === q.title || t.name.replace(/\.\w+$/, '') === q.title)) return; rows.push({ key: 'q' + q.title, label: q.kind + ' ' + q.title, prog: q.size > 0 ? (q.size - q.sizeleft) / q.size : 0, state: q.status, size: q.size, sizeleft: q.sizeleft }) })

  // nach Staffel gruppieren
  const groups = {}
  rows.forEach(r => { const s = seasonOf(r.label); const key = s != null ? 'S' + String(s).padStart(2, '0') : 'movies'; (groups[key] ||= { key, label: s != null ? 'Staffel ' + s : '🎬 Filme / Sonstiges', sort: s != null ? s : 999, items: [] }).items.push(r) })
  const groupList = Object.values(groups).sort((a, b) => a.sort - b.sort)
  const totSize = rows.reduce((a, r) => a + (r.size || 0), 0)
  const totDone = rows.reduce((a, r) => a + (r.size || 0) * r.prog, 0)
  const overall = totSize > 0 ? (totDone / totSize) * 100 : 0
  const gPct = g => { const s = g.items.reduce((a, r) => a + (r.size || 0), 0); const dn = g.items.reduce((a, r) => a + (r.size || 0) * r.prog, 0); return s > 0 ? dn / s * 100 : 0 }

  // fehlt: Serien-Folgen nach Staffel
  const missByS = {}
  ;(d?.missS?.records || []).forEach(m => { const k = m.seasonNumber ?? 0; (missByS[k] ||= []).push(m) })
  const missSeasons = Object.keys(missByS).map(Number).sort((a, b) => a - b)

  return (
    <div className="status-wrap">
      <div className="status-bar"><span className="live-dot" /> Aktualisierung:<Seg small options={REFRESH_OPTS} value={interval} onChange={setIntervalMs} /><button className="mini-btn" onClick={load}>↻ jetzt</button></div>
      {err && <div className="card status-card"><p className="status err">Fehler: {err}</p></div>}
      {!d && !err && <div className="card status-card"><p className="hint">lade…</p></div>}
      {d && <>
        <section className="card status-card">
          <div className="card-head"><span className="emoji">⬇️</span><h2>Aktive Downloads</h2><span className="live">{rows.filter(r => r.prog < 1).length} aktiv · {rows.length} gesamt</span></div>
          {rows.length === 0 && <p className="empty">Gerade läuft kein Download.</p>}
          {rows.length > 0 && <div className="overall"><div className="overall-top"><b>Gesamt-Fortschritt</b><span className="dl-pct">{Math.round(overall)}%</span></div><Bar pct={overall} /></div>}
          {groupList.map(g => {
            const open = !!openG[g.key]
            return (
              <div className="grp" key={g.key}>
                <button className="grp-head" onClick={() => setOpenG(o => ({ ...o, [g.key]: !o[g.key] }))}>
                  <span className="grp-arrow">{open ? '▾' : '▸'}</span>
                  <span className="grp-label">{g.label}</span>
                  <span className="grp-count">{g.items.length}</span>
                  <span className="grp-bar"><Bar pct={gPct(g)} /></span>
                  <span className="grp-pct">{Math.round(gPct(g))}%</span>
                </button>
                {open && g.items.map(r => (
                  <div className="dl-row" key={r.key}>
                    <div className="dl-top"><span className="dl-name">{r.label}</span><span className="dl-pct">{Math.round(r.prog * 100)}%</span></div>
                    <Bar pct={r.prog * 100} />
                    <div className="dl-meta">{r.state}{r.speed ? ' · ↓ ' + fmtBytes(r.speed) + '/s' : ''} · {fmtBytes(r.sizeleft)} übrig von {fmtBytes(r.size)}</div>
                  </div>
                ))}
              </div>
            )
          })}
        </section>

        <section className="card status-card warn">
          <div className="card-head"><span className="emoji">🔎</span><h2>Noch nichts gefunden / fehlt</h2></div>
          <p className="hint">Klick auf „Warum?" – ich prüfe, woran es liegt und schlage eine Lösung vor.</p>
          <div className="miss-grid">
            <div>
              <div className="miss-head">🎬 Filme ({d.missR.totalRecords ?? 0})</div>
              <div className="miss-scroll">
                {(d.missR.records || []).map(m => <div className="miss-item act" key={m.id}><span>{m.title} {m.year ? '(' + m.year + ')' : ''}</span><button className="why-btn" onClick={() => why('radarr', m)}>Warum?</button></div>)}
                {(d.missR.records || []).length === 0 && <div className="miss-item empty">— nichts —</div>}
              </div>
            </div>
            <div>
              <div className="miss-head">📺 Serien-Folgen ({d.missS.totalRecords ?? 0})</div>
              <div className="miss-scroll">
                {missSeasons.map(s => {
                  const open = !!openMiss[s]
                  return (
                    <div className="grp" key={s}>
                      <button className="grp-head sm" onClick={() => setOpenMiss(o => ({ ...o, [s]: !o[s] }))}>
                        <span className="grp-arrow">{open ? '▾' : '▸'}</span><span className="grp-label">Staffel {s}</span><span className="grp-count">{missByS[s].length}</span>
                      </button>
                      {open && missByS[s].map(m => <div className="miss-item act" key={m.id}><span>{m.series?.title || ''} S{String(m.seasonNumber).padStart(2, '0')}E{String(m.episodeNumber).padStart(2, '0')}</span><button className="why-btn" onClick={() => why('sonarr', m)}>Warum?</button></div>)}
                    </div>
                  )
                })}
                {missSeasons.length === 0 && <div className="miss-item empty">— nichts —</div>}
              </div>
            </div>
          </div>
        </section>
      </>}

      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>{modal.title}</h3><button className="x" onClick={() => setModal(null)}>✕</button></div>
            {modal.loading ? <p className="hint">analysiere über alle Indexer … (~30s)</p> : <>
              {modal.found != null && <p className="modal-stat"><b>{modal.found}</b> Releases gefunden · <b>{modal.accepted}</b> passen zu deiner Regel</p>}
              <div className="modal-box why"><b>Warum:</b> {modal.why}</div>
              {modal.fix && <div className="modal-box fix"><b>Lösung:</b> {modal.fix}</div>}
              {modal.reasons?.length > 0 && <details className="modal-det"><summary>technische Ablehnungsgründe</summary>{modal.reasons.map((r, i) => <div key={i} className="reason">{r}</div>)}</details>}
              {modal.searched && <p className="status ok">Suche gestartet! Schau bei „Aktive Downloads".</p>}
              <div className="modal-actions">
                {modal.appId && !modal.searched && <button className="save inline" onClick={() => searchNow(modal.appId, modal.item)}>🔍 Jetzt suchen</button>}
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
      {view === 'settings' && <main className="grid">{APPS.map(a => <Panel key={a.id} app={a} />)}</main>}
      {view === 'status' && <main><Status /></main>}
      {view === 'search' && <main><SearchTab /></main>}
      <footer>
        <div><b>Tipp:</b> Für beste 4K ohne Riesendateien: <i>HDR bevorzugt</i> + <i>Max 25 GB</i>. Schnellster Download: im <i>Suchen</i>-Tab „Schnellste (Seeder)".</div>
        <div className="made">MediaStack Regler · lokal auf deinem Laptop</div>
      </footer>
    </div>
  )
}
