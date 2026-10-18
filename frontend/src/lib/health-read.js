// PERSONAL-READ: read phone health data through the native plugin and shape
// it as Health Data Export CSV text, so the pull chain consumes it unchanged
// (same headers, same converter, same `(phone)` naming downstream).
//
// Only the personal APK has the native `read` method (upstream's plugin is
// write-only). Everything here is injectable and unit-tested; the Android
// side is HealthConnectPlugin.read. Day attribution: a session belongs to
// the day it starts; a night's sleep to the day its first minute falls in;
// a record appearing in two adjacent day windows is kept once (by start).
import { MOBILE } from './mobile.js'

export const READ_DAYS_DEFAULT = 30

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
export async function readPlugin() {
  if (!MOBILE) return null
  try {
    const mobile = await import('./mobile.js')
    if (!(await mobile.isAndroid())) return null
    const { registerPlugin } = await import('@capacitor/core')
    const HC = registerPlugin('HealthConnect')
    return typeof HC?.read === 'function' ? HC : null
  } catch {
    return null
  }
}

/**
 * Ask for the read permissions, then report whether they are all held.
 *
 * The native `read` refuses outright without them, so this has to happen
 * before it — asking for nothing and reporting a permission error tells the
 * user to go somewhere the app cannot send them.
 *
 * @returns {Promise<boolean>} true when the read set is granted
 */
export async function ensureReadPermissions(hc) {
  if (!hc) return false
  try {
    if (typeof hc.requestReadPermissions !== 'function') return false
    const r = await hc.requestReadPermissions()
    return !!r?.granted
  } catch (e) {
    // A refusal is an answer, not a crash: Health Connect may not be installed,
    // or the user dismissed the sheet.
    return false
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
