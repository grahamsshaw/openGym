// PERSONAL-READ: read phone health data through the native plugin and shape
// it as Health Data Export CSV text, so the pull chain consumes it unchanged
// (same headers, same converter, same `(phone)` naming downstream).
//
// Only the personal APK has the native `read` method (upstream's plugin is
// write-only). Everything here is injectable and unit-tested; the Android
// side is HealthConnectPlugin.read. Day attribution: a session belongs to
// the day it starts; a night's sleep to the day its first minute falls in;
// a record appearing in two adjacent day windows is kept once (by start).
// health-sync.js's plugin() caches its result in pluginP — if that promise
// ever hung during initialization (HealthConnectCard calls healthStatus() on
// mount), the stuck promise poisons every later call. The read path registers
// the plugin directly instead, so a stuck cache can never lock it out.
import { MOBILE } from './mobile.js'

export const READ_DAYS_DEFAULT = 30

/** How long any single native round-trip may take before it is written off. */
export const PLUGIN_TIMEOUT_MS = 8000

/** Display names for the typeName strings HealthConnectPlugin.read returns. */
export const TYPE_LABELS = {
  strength_training: 'Strength training',
  walking: 'Walking',
  running: 'Running',
  biking_stationary: 'Stationary bike',
  elliptical: 'Elliptical',
  stair_climbing_machine: 'Stair climber',
  other: 'Workout',
}

/** Sessions from these packages are this app's own echo — never re-import. */
export const OWN_PACKAGES = ['ch.duartesantos.opengym']

/** The native plugin, or null on web/iOS/official builds without `read`. */
/**
 * The Health Connect plugin proxy, or why there isn't one.
 *
 * Registers the plugin directly rather than going through lib/health-sync.js's
 * cached accessor, because that cache can hold a promise that hung during
 * initialization and never settles again.
 *
 * Bounded on purpose: a lookup that never settles is worse than any failure,
 * because it takes the caller's busy flag down with it and every other button
 * stops answering. The reason is reported so a failure names its cause.
 *
 * @returns {Promise<{hc: object|null, why?: string}>}
 *   `why` is 'web', 'unavailable' or 'timeout'.
 */
export async function readPlugin({ timeoutMs = PLUGIN_TIMEOUT_MS } = {}) {
  if (!MOBILE) return { hc: null, why: 'web' }
  let timer
  let timedOut = false
  try {
    const hc = await Promise.race([
      (async () => {
        const { registerPlugin } = await import('@capacitor/core')
        return registerPlugin('HealthConnect')
      })(),
      new Promise(resolve => {
        timer = setTimeout(() => { timedOut = true; resolve(null) }, timeoutMs)
      }),
    ])
    if (!hc) return { hc: null, why: timedOut ? 'timeout' : 'unavailable' }
    return { hc }
  } catch {
    return { hc: null, why: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ask for the read permissions.
 *
 * The native `read` refuses outright without them, so this has to happen before
 * it. Every failure used to collapse to a plain `false` and the same message,
 * which made "Health Connect is not installed", "you said no" and "this build
 * cannot ask" indistinguishable from the outside. The reason is what tells us
 * which one it was, so it is returned rather than thrown away.
 *
 * `status` is the plugin's own answer to "is Health Connect even here", taken
 * before asking, because on Android 13 and lower it is an app of its own and may
 * simply not be installed — asking for permission there can only fail.
 *
 * A plugin call that never answers would leave the caller's busy flag set for
 * good and take every other button down with it, so the wait is bounded.
 *
 * @returns {Promise<{ok: boolean, why?: string, message?: string}>}
 *   `why` is one of: 'no-plugin', 'missing', 'update', 'unsupported',
 *   'unavailable', 'denied', 'timeout', 'failed'.
 */
export const PERMISSION_TIMEOUT_MS = 45000

export async function ensureReadPermissions(hc, { timeoutMs = PERMISSION_TIMEOUT_MS } = {}) {
  if (!hc) return { ok: false, why: 'no-plugin' }
  if (typeof hc.requestReadPermissions !== 'function') return { ok: false, why: 'no-plugin' }

  try {
    // status() is a plain plugin call with no activity result behind it, so it
    // cannot be the thing that hangs. Where Health Connect is not installed,
    // asking for permission is pointless and this is the real answer.
    if (typeof hc.status === 'function') {
      const st = await hc.status()
      if (st?.status && st.status !== 'available') return { ok: false, why: st.status }
    }
  } catch { /* an unreadable status is not fatal; the request below is the real test */ }

  let timer
  try {
    const r = await Promise.race([
      hc.requestReadPermissions(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error('Health Connect did not answer'), { code: 'timeout' })), timeoutMs)
      }),
    ])
    return r?.granted ? { ok: true } : { ok: false, why: 'denied' }
  } catch (e) {
    const code = e?.code || ''
    const text = e?.message || ''
    if (code === 'timeout') return { ok: false, why: 'timeout' }
    // Health Connect not installed, or its provider needs updating. Nothing the
    // user can grant, so it must not be reported as a permission problem.
    if (code === 'unavailable' || /not available/i.test(text)) return { ok: false, why: 'unavailable' }
    if (code === 'permission') return { ok: false, why: 'denied' }
    return { ok: false, why: 'failed', message: text }
  } finally {
    clearTimeout(timer)
  }
}

const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
const fmtDay = ms => {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const fmtTime = ms => {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${fmtDay(ms)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Read the last `days` days, one window per day.
 *
 * @param {object} opts days, now (epoch ms), hc ({ read({startMs,endMs}) }),
 *   ownPackages (sessions from these apps are skipped as echo),
 *   onProgress (done, total) — a 30-day read is 30 native round-trips and
 *   without it the button looks broken while it works.
 * @returns { sessions[], days: {date: {steps,distanceM,calories,vitals}},
 *   sleep[] } with sleep deduped across midnight boundaries.
 */
export async function readPhoneHealth({
  days = READ_DAYS_DEFAULT, now = Date.now(), hc, ownPackages = OWN_PACKAGES,
  onProgress,
} = {}) {
  if (!hc) throw Object.assign(new Error('Health Connect read is not available'), { code: 'unavailable' })
  const sessions = []
  const dayMap = {}
  const sleepSeen = new Set()
  const sleep = []
  const today = dayStart(now)
  let done = 0
  for (let back = days - 1; back >= 0; back--) {
    const startMs = today - back * 86400000
    const endMs = startMs + 86400000
    const date = fmtDay(startMs)
    const r = await hc.read({ startMs, endMs })
    done++
    if (onProgress) onProgress(done, days)
    const day = (dayMap[date] = dayMap[date] || {
      steps: 0, distanceM: 0, calories: 0, vitals: {},
    })
    day.steps += r.steps || 0
    day.distanceM += r.distanceM || 0
    day.calories += r.caloriesKcal || 0
    if (r.hrMin > 0) day.vitals.hrMin = Math.min(day.vitals.hrMin || Infinity, r.hrMin)
    if (r.hrAvg > 0) day.vitals.hrAvg = r.hrAvg
    if (r.hrMax > 0) day.vitals.hrMax = Math.max(day.vitals.hrMax || 0, r.hrMax)
    for (const s of r.sessions || []) {
      if (ownPackages.includes(s.app)) continue
      if (s.end <= s.start) continue
      sessions.push({
        // A session the user titled keeps its title; otherwise the type label,
        // the same wording the export app uses ("79 - Walking" style).
        name: s.title || TYPE_LABELS[s.typeName] || 'Workout',
        startMs: s.start, endMs: s.end,
        distanceM: s.distanceM || 0, caloriesKcal: s.caloriesKcal || 0,
        date: fmtDay(s.start),
      })
    }
    for (const sl of r.sleep || []) {
      if (sleepSeen.has(sl.start)) continue
      sleepSeen.add(sl.start)
      sleep.push(sl)
    }
  }
  for (const key of Object.keys(dayMap)) {
    if (dayMap[key].vitals.hrMin === Infinity) delete dayMap[key].vitals.hrMin
  }
  return { sessions, days: dayMap, sleep }
}

const ACTIVITY_HEADER = 'Date,Source(s),Timezone,Steps,Distance (m),Elevation (m),Floors climbed,Total Calories (kcal),Active Calories (kcal),Power min (W),Power max (W),Power avg (W),Speed min (m/s),Speed max (m/s),Speed avg (m/s),VO2 max min (ml/min/kg),VO2 max max (ml/min/kg),VO2 max avg (ml/min/kg),Wheelchair pushes,Start Date/Time,Exercise Name,Duration (min),Exercise Calories (kcal),Exercise Distance (m)'
const SLEEP_HEADER = 'Date,Source(s),Timezone,Start Time,End Time,Light Sleep (min),Deep Sleep (min),REM Sleep (min),Awake (min)'
const VITALS_HEADER = 'Date,Source(s),Timezone,Heart rate min (bpm),Heart rate max (bpm),Heart rate avg (bpm),Heart rate variability min (ms),Heart rate variability max (ms),Heart rate variability avg (ms),Oxygen saturation min (%),Oxygen saturation max (%),Oxygen saturation avg (%),Respiratory rate min (breaths/min),Respiratory rate max (breaths/min),Respiratory rate avg (breaths/min),Resting heart rate min (bpm),Resting heart rate max (bpm),Resting heart rate avg (bpm),Blood pressure (mmHg),Blood glucose (mmol/L),Body temperature (°C)'

const num = v => (v === null || v === undefined || v === '' ? '' : String(v))

/**
 * Render a read result as the Health Data Export app's three files, so the
 * existing converter and chain consume it byte-identically to a manual
 * export. Source column reads `phone` (converter ignores the column).
 */
export function toHealthExportCsv(read) {
  const activity = [ACTIVITY_HEADER]
  const vitals = [VITALS_HEADER]
  const byDate = {}
  for (const s of read.sessions) {
    ;(byDate[s.date] = byDate[s.date] || []).push(s)
    const mins = Math.round((s.endMs - s.startMs) / 60000)
    activity.push(['', 'phone', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      fmtTime(s.startMs), s.name, mins,
      s.caloriesKcal ? Math.round(s.caloriesKcal * 10) / 10 : '',
      s.distanceM ? Math.round(s.distanceM) : ''].join(','))
  }
  for (const date of Object.keys(read.days).sort()) {
    const d = read.days[date]
    const hasSession = (byDate[date] || []).length > 0
    if (!hasSession && !d.steps && !d.distanceM && !d.calories) continue
    activity.push([date, 'phone', '', num(d.steps || ''), num(d.distanceM || ''),
      '', '', num(d.calories || ''), '', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', ''].join(','))
    if (Object.keys(d.vitals).length) {
      vitals.push([date, 'phone', '',
        num(d.vitals.hrMin || ''), num(d.vitals.hrMax || ''), num(d.vitals.hrAvg || ''),
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''].join(','))
    }
  }
  const sleep = [SLEEP_HEADER]
  for (const sl of [...read.sleep].sort((a, b) => a.start - b.start)) {
    sleep.push(['', 'phone', '', fmtTime(sl.start), fmtTime(sl.end),
      num(sl.lightMin || ''), num(sl.deepMin || ''), num(sl.remMin || ''),
      num(sl.awakeMin || '')].join(','))
  }
  return { activity: activity.join('\n') + '\n', sleep: sleep.join('\n') + '\n', vitals: vitals.join('\n') + '\n' }
}
