// Sonarr/Radarr-API-Logik – bewusst OHNE React, damit sie auch in Node-Tests
// (test/arr.test.mjs) gegen die echten Dienste laufen kann.
import {
  cfReqName, cfPrefName, cfMaxName, CF_HDR, HDR_REGEX, LEGACY_CFS, LANGUAGES,
  CODECS, cfCodecName, cfRemuxName, cfBlacklistName, CODEC_REGEX, REMUX_REGEX, blacklistRegex, CODEC_DEFAULT,
  qName, tierOf, isExcluded,
} from './config.js'

export async function api(app, path, opts = {}) {
  const { timeout, ...rest } = opts
  let signal, timer
  if (timeout) { const ac = new AbortController(); signal = ac.signal; timer = setTimeout(() => ac.abort(), timeout) }
  try {
    const r = await fetch(app.base + path, { ...rest, signal, headers: { 'X-Api-Key': app.key, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const t = await r.text(); return t ? JSON.parse(t) : null
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitlimit (10s) erreicht – langsame Indexer übersprungen. Klick nochmal „Warum?" für das vollständige Ergebnis.')
    throw e
  } finally { clearTimeout(timer) }
}

export const getProfiles = app => api(app, '/api/v3/qualityprofile')

export async function ensureCF(app, name, regex) {
  const list = await api(app, '/api/v3/customformat')
  const cf = list.find(c => c.name === name)
  if (!cf) return api(app, '/api/v3/customformat', { method: 'POST', body: JSON.stringify({ name, includeCustomFormatWhenRenaming: false, specifications: [{ name: 'regex', implementation: 'ReleaseTitleSpecification', negate: false, required: true, fields: [{ name: 'value', value: regex }] }] }) })
  cf.specifications.forEach(s => s.fields.forEach(f => { if (f.name === 'value') f.value = regex }))
  return api(app, `/api/v3/customformat/${cf.id}`, { method: 'PUT', body: JSON.stringify(cf) })
}
export async function ensureSizeCF(app, name, minGB) {
  const list = await api(app, '/api/v3/customformat')
  const cf = list.find(c => c.name === name)
  const spec = { name: 'size', implementation: 'SizeSpecification', negate: false, required: true, fields: [{ name: 'min', value: minGB }, { name: 'max', value: 999999 }] }
  if (!cf) return api(app, '/api/v3/customformat', { method: 'POST', body: JSON.stringify({ name, includeCustomFormatWhenRenaming: false, specifications: [spec] }) })
  cf.specifications = [spec]
  return api(app, `/api/v3/customformat/${cf.id}`, { method: 'PUT', body: JSON.stringify(cf) })
}
export async function deleteByName(app, name) {
  try { const list = await api(app, '/api/v3/customformat'); const cf = list.find(c => c.name === name); if (cf) await api(app, `/api/v3/customformat/${cf.id}`, { method: 'DELETE' }) } catch (e) {}
}

export async function applySettings(app, profileId, { langStates, minTier, maxTier, hdr, maxSize, codecStates = {}, remux = false, blacklist = '' }) {
  const reqName = cfReqName(profileId), prefName = cfPrefName(profileId), maxName = cfMaxName(profileId)
  const required = LANGUAGES.filter(l => langStates[l.id] === 'required')
  const preferred = LANGUAGES.filter(l => langStates[l.id] === 'preferred')
  const reqRegex = required.length ? '(?i)' + required.map(l => `(?=.*(${l.token}))`).join('') : '(?s).*'
  const prefRegex = preferred.length ? `(?i)(${preferred.map(l => l.token).join('|')})` : 'zzz^neverMatch'
  await ensureCF(app, reqName, reqRegex)
  await ensureCF(app, prefName, prefRegex)
  await ensureCF(app, CF_HDR, HDR_REGEX)
  if (maxSize > 0) await ensureSizeCF(app, maxName, maxSize)
  // Codec-CFs: nur anlegen wenn nicht „egal", sonst aufraeumen
  for (const c of CODECS) {
    const name = cfCodecName(profileId, c.id)
    if (codecStates[c.id] && codecStates[c.id] !== 'off') await ensureCF(app, name, CODEC_REGEX(c.id))
    else await deleteByName(app, name)
  }
  const remuxName = cfRemuxName(profileId)
  if (remux) await ensureCF(app, remuxName, REMUX_REGEX); else await deleteByName(app, remuxName)
  const blName = cfBlacklistName(profileId)
  const blGroups = String(blacklist || '').split(',').map(s => s.trim()).filter(Boolean)
  if (blGroups.length) await ensureCF(app, blName, blacklistRegex(blGroups)); else await deleteByName(app, blName)
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
  const codecScoreName = {}
  for (const c of CODECS) codecScoreName[cfCodecName(profileId, c.id)] = codecStates[c.id] === 'pref' ? 15 : codecStates[c.id] === 'no' ? -15 : 0
  ;(p.formatItems || []).forEach(fi => {
    if (fi.name === reqName) fi.score = required.length ? 100 : 0
    else if (fi.name === prefName) fi.score = preferred.length ? 20 : 0
    else if (fi.name === CF_HDR) fi.score = hdrScore
    else if (fi.name === maxName) fi.score = maxSize > 0 ? -1000 : 0
    else if (fi.name === remuxName) fi.score = remux ? 50 : 0
    else if (fi.name === blName) fi.score = blGroups.length ? -10000 : 0
    else if (fi.name in codecScoreName) fi.score = codecScoreName[fi.name]
    else if (fi.name.startsWith('Regler ')) fi.score = 0
  })
  await api(app, `/api/v3/qualityprofile/${profileId}`, { method: 'PUT', body: JSON.stringify(p) })
}

export async function loadSettings(app, profileId) {
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
  // Erweiterte Optionen einlesen
  const codecStates = CODEC_DEFAULT()
  for (const c of CODECS) { const sc = fi.find(f => f.name === cfCodecName(profileId, c.id))?.score || 0; codecStates[c.id] = sc > 0 ? 'pref' : sc < 0 ? 'no' : 'off' }
  const remux = (fi.find(f => f.name === cfRemuxName(profileId))?.score || 0) > 0
  const blCF = cfs.find(c => c.name === cfBlacklistName(profileId))
  let blacklist = ''
  if (blCF) {
    const v = blCF.specifications?.[0]?.fields?.find(f => f.name === 'value')?.value || ''
    blacklist = v.replace(/^\(\?i\)\(?/, '').replace(/\)$/, '').split('|').map(s => s.replace(/\\(.)/g, '$1').trim()).filter(Boolean).join(', ')
  }
  return { langStates, minTier, maxTier, hdr, maxSize, codecStates, remux, blacklist }
}
