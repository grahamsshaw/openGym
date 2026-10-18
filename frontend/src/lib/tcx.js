// PERSONAL-TCX: read a Garmin Training Center Database (.tcx) export.
//
// A gym console's own export gives one row per session with averages. The TCX
// gives every few seconds, which is where the things an average destroys live:
// whether the effort was steady or in blocks, what the peak was, and — the
// reason this exists at all — the heart rate the console sometimes never
// reported at all.
//
// Nothing here writes anything. parseTcx() turns a file's text into a plain
// summary; matching it to a session and deciding what to change lives in
// lib/tcx-match.js.
//
// Deliberately no DOMParser. It is absent outside a browser, and the XML
// support where it does exist is uneven; these files are machine-generated
// with a fixed shape, so reading the handful of elements we need directly is
// both smaller and the same answer everywhere.

/** ns of the Garmin schema; the ActivityExtension one carries speed/power. */

/** A trackpoint gap larger than this is the machine pausing, not you working. */
const MAX_GAP_S = 60
/** A block shorter than this is noise between two real efforts. */
const MIN_BLOCK_S = 30
/** Two speeds within this (km/h, or this fraction of the mean) are one effort. */
const SPEED_TOLERANCE_KMH = 0.4
const SPEED_TOLERANCE_FRACTION = 0.08

const num = value => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Inner text of every <tag>…</tag>, in order. */
function tagValues(xml, tag) {
  const out = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

/** Inner text of the first <tag>…</tag>, or null. */
function tagValue(xml, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? m[1] : null
}

/** An attribute off an element's opening tag, e.g. Sport="Running". */
function attr(openingTag, name) {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`).exec(openingTag || '')
  return m ? m[1] : null
}

/** Number inside the first <tag>…</tag>, or null when absent or unparseable. */
function firstNum(xml, tag) {
  const raw = tagValue(xml, tag)
  return raw === null ? null : num(raw.trim())
}

/** Every <Trackpoint> body, in order. */
function trackpointBodies(xml) {
  return tagValues(xml, 'Trackpoint')
}

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
const round1 = n => (n === null ? null : Math.round(n * 10) / 10)

/**
 * Group a speed series into effort blocks.
 *
 * Consecutive samples within a tolerance are the same effort; a clear gap
 * starts the next one. Returns [{ kmh, seconds }] longest-held first is *not*
 * assumed — order is kept, because "up, down, up" is what makes intervals
 * different from a single steady pace.
 *
 * @param {{ t: number, kmh: number }[]} samples sorted by time, seconds relative
 * @returns {{ kmh: number, seconds: number }[]}
 */
export function speedBlocks(samples) {
  if (!samples.length) return []
  const values = samples.map(s => s.kmh)
  const tolerance = Math.max(SPEED_TOLERANCE_KMH,
    (mean(values) || 0) * SPEED_TOLERANCE_FRACTION)

  // Raw runs, every one of them, however brief.
  const raw = [{ kmh: samples[0].kmh, seconds: 0 }]
  let previousStep = 0
  for (let i = 0; i < samples.length; i++) {
    // The gap *forward* to the next sample is what this reading was held for.
    // Using the gap from the previous sample instead would credit the
    // transition between two efforts to both of them, which turns a
    // four-second spike into a forty-second block.
    let step = 0
    if (i < samples.length - 1) {
      step = Math.max(0, samples[i + 1].t - samples[i].t)
      previousStep = step
    } else {
      // The last reading has no successor to measure against, but the machine
      // was still reading at that pace until the session ended, so it held for
      // as long as the samples before it were apart.
      step = previousStep
    }
    const last = raw[raw.length - 1]
    if (Math.abs(samples[i].kmh - last.kmh) > tolerance) raw.push({ kmh: samples[i].kmh, seconds: 0 })
    raw[raw.length - 1].seconds += step
  }

  // Drop blips, giving their time back to the run they interrupted. A two-second
  // reading between two holds of the same pace is noise, and counting it would
  // split one steady effort into two — or, repeated, invent an interval
  // session out of a steady one.
  const kept = []
  for (let i = 0; i < raw.length; i++) {
    const block = raw[i]
    if (block.seconds < MIN_BLOCK_S) {
      const previous = kept[kept.length - 1]
      const following = raw[i + 1]
      if (previous && following && Math.abs(previous.kmh - following.kmh) <= tolerance) {
        previous.seconds += block.seconds
      }
      continue
    }
    kept.push(block)
  }

  // Finally join neighbours that ended up within tolerance of each other.
  const merged = []
  for (const block of kept) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.kmh - block.kmh) <= tolerance) {
      last.seconds += block.seconds
      last.kmh = (last.kmh + block.kmh) / 2
    } else {
      merged.push({ ...block })
    }
  }
  return merged
}

/**
 * What the blocks say about the session, said without overclaiming.
 *
 * Only a clear, repeated high/low alternation earns the word "intervals".
 * Anything vaguer is described by its numbers instead of being given a name it
 * might not deserve.
 */
export function describeShape(blocks) {
  if (!blocks.length) return { levels: 0, hint: '', text: '' }
  const levels = blocks.length
  const low = Math.min(...blocks.map(b => b.kmh))
  const high = Math.max(...blocks.map(b => b.kmh))
  const slowest = blocks.reduce((a, b) => (b.seconds > a.seconds ? b : a))

  let hint = ''
  if (levels >= 4 && high > low * 1.2) {
    // Count direction changes along the time-ordered blocks. "Up, down, up,
    // down" is intervals; a hill climb or a fade goes one way and stays there.
    const dirs = []
    for (let i = 1; i < levels; i++) {
      const delta = blocks[i].kmh - blocks[i - 1].kmh
      if (Math.abs(delta) > Math.max(0.3, (high - low) * 0.15)) dirs.push(Math.sign(delta))
    }
    let flips = 0
    for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) flips++
    if (flips >= 2) hint = 'hi-lo blocks'
    else hint = `${levels} speed levels`
  } else if (levels >= 2) {
    hint = `${levels} speed levels`
  }

  const text = levels === 1
    ? `steady ${low.toFixed(1)} km/h`
    : `${levels} speed levels ${low.toFixed(1)}-${high.toFixed(1)} km/h` +
      (levels > 1 ? `, longest ${Math.round(slowest.seconds)}s` : '')
  return { levels, hint, text, low: round1(low), high: round1(high) }
}

/**
 * Parse a .tcx file's text into a summary of the activity.
 *
 * @param {string} text raw file contents
 * @returns {object} summary, or { error } describing why it could not be read
 */
export function parseTcx(text) {
  const xml = String(text || '').trim()
  if (!xml) return { error: 'empty' }
  if (!xml.includes('<TrainingCenterDatabase')) return { error: 'not-tcx' }
  if (!/<Activity[\s>]/.test(xml)) return { error: 'no-activity' }

  const activityTag = /<Activity(\s[^>]*)?>/.exec(xml)
  const lapTag = /<Lap(\s[^>]*)?>/.exec(xml)

  const points = trackpointBodies(xml)
  if (!points.length) return { error: 'no-trackpoints' }

  const times = []
  const hr = []
  const watts = []
  const cadence = []
  const speeds = []
  let distanceM = null

  for (const tp of points) {
    const when = tagValue(tp, 'Time')
    if (when) {
      const ms = Date.parse(when.trim())
      if (Number.isFinite(ms)) times.push(ms)
    }
    const dist = firstNum(tp, 'DistanceMeters')
    if (dist !== null) distanceM = dist

    // A console with no strap connected reports a flat 0. Counting those would
    // drag the average down to nonsense, so only real readings are kept.
    const beatBlock = tagValue(tp, 'HeartRateBpm')
    const beat = beatBlock === null ? null : firstNum(beatBlock, 'Value')
    if (beat !== null && beat > 0) hr.push(beat)

    const power = firstNum(tp, 'Watts')
    if (power !== null) watts.push(power)

    const cad = firstNum(tp, 'RunCadence') ?? firstNum(tp, 'Cadence')
    if (cad !== null) cadence.push(cad)

    const spd = firstNum(tp, 'Speed')
    if (spd !== null) speeds.push({ ms: tagValue(tp, 'Time') ? Date.parse(tagValue(tp, 'Time').trim()) : NaN, kmh: spd })
  }

  if (!times.length) return { error: 'no-times' }

  const startMs = times[0]
  const spanWall = (times[times.length - 1] - startMs) / 1000

  // A lap that reports its own duration is authoritative when the trackpoints
  // are sparse; otherwise a machine that was paused mid-session inflates the
  // span by the length of every gap, so the moving time is used instead.
  const lapSeconds = lapTag ? num(attr(lapTag[0], 'TotalTimeSeconds')) : null
  let span = spanWall
  if (lapSeconds && lapSeconds > 0) {
    span = Math.abs(lapSeconds - spanWall) > spanWall * 0.5 ? lapSeconds : spanWall
  } else {
    let moving = 0
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] - times[i - 1]) / 1000
      if (gap <= MAX_GAP_S) moving += gap
    }
    if (moving > 0) span = moving
  }

  if (distanceM === null) distanceM = (lapTag && num(attr(lapTag[0], 'DistanceMeters'))) || 0

  // Build the speed series, breaking it at a pause so one long stop cannot
  // merge two separate efforts into one block.
  const series = []
  for (const s of speeds) {
    if (!Number.isFinite(s.ms)) continue
    const prev = series[series.length - 1]
    if (prev && (s.ms - prev.ms) / 1000 > MAX_GAP_S) series.push({ t: 0, kmh: s.kmh })
    series.push({ t: (s.ms - startMs) / 1000, kmh: s.kmh })
  }
  const shape = describeShape(speedBlocks(series))

  const local = new Date(startMs)
  return {
    sport: attr(activityTag[0], 'Sport') || '',
    start: new Date(startMs).toISOString(),
    // The app keys days on the calendar date in the phone's own timezone, and
    // the console stamps its rows the same way, so match on that rather than
    // on a UTC slice that would move a late session to the wrong day.
    date: [local.getFullYear(),
      String(local.getMonth() + 1).padStart(2, '0'),
      String(local.getDate()).padStart(2, '0')].join('-'),
    time: [String(local.getHours()).padStart(2, '0'),
      String(local.getMinutes()).padStart(2, '0')].join(':'),
    durationS: Math.round(span),
    distanceM: Math.round(distanceM),
    avgSpeedKmh: span > 0 ? (distanceM / 1000) / (span / 3600) : null,
    avgHr: round1(mean(hr)),
    minHr: hr.length ? Math.min(...hr) : null,
    maxHr: hr.length ? Math.max(...hr) : null,
    hrPoints: hr.length,
    avgPowerW: round1(mean(watts)),
    maxPowerW: watts.length ? Math.max(...watts) : null,
    avgCadence: round1(mean(cadence)),
    speedLevels: shape.levels,
    speedHint: shape.hint,
    speedText: shape.text,
    trackpoints: points.length,
  }
}

/** What is worth saying about this file, in one line for a list. */
export function describeTcx(s) {
  const bits = []
  bits.push(`${Math.round(s.durationS / 60)} min`)
  if (s.distanceM) bits.push(`${(s.distanceM / 1000).toFixed(2)} km`)
  if (s.avgHr) bits.push(`HR ${Math.round(s.avgHr)}/${Math.round(s.maxHr || s.avgHr)}`)
  if (s.avgPowerW) bits.push(`${Math.round(s.avgPowerW)} W`)
  if (s.speedLevels > 1) bits.push(`${s.speedLevels} speed levels`)
  return bits.join(' · ')
}