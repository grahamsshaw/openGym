// PERSONAL-TCX: decide which recorded session a .tcx file belongs to.
//
// The file never says. A treadmill's TCX has no serial, no session id and no
// name — just a date, a time and a shape. So this matches on what can be
// compared: the day, how long it ran, and how far. Duration is the strong
// signal (two machines rarely run for the same number of minutes on the same
// day by accident); distance breaks ties when the console recorded it.
//
// Anything ambiguous is reported as ambiguous rather than guessed. Enriching
// the wrong session would quietly write wrong numbers into real history, which
// is worse than asking.

// A cardio set is stored as minutes; strength sets carry weight or reps.
const isCardioSet = set => set && typeof set.min === 'number' && set.min > 0

/** Minutes and speed a stored entry represents, or null when it is not cardio. */
export function entryShape(entry) {
  const cardio = (entry?.sets || []).filter(isCardioSet)
  if (!cardio.length) return null
  const minutes = cardio.reduce((sum, s) => sum + s.min, 0)
  // The console leaves speed at 0 when it does not report one (an indoor bike),
  // and then the distance is unknown rather than zero — 0 km would match
  // nothing, but would also wrongly reject a real 7 km ride.
  const speeds = cardio.filter(s => s.speed > 0).map(s => s.speed)
  const speedKmh = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null
  const distanceKm = speedKmh ? (speedKmh * minutes) / 60 : null
  return { minutes, speedKmh, distanceKm }
}

const closeness = (a, b, floor) => {
  const scale = Math.max(floor, Math.abs(a))
  return Math.max(0, 1 - Math.abs(a - b) / scale)
}

/**
 * How well a stored entry matches a TCX summary, and why.
 * @returns {{ score: number, why: string, minutes: number, distanceKm: number|null }|null}
 */
export function scoreEntry(summary, entry) {
  const shape = entryShape(entry)
  if (!shape) return null

  const minutes = summary.durationS / 60
  const durationScore = closeness(minutes, shape.minutes, 3)
  // Under two minutes there is no meaningful similarity to speak of.
  if (durationScore <= 0) return null

  let score = durationScore
  let signals = 1
  const why = [`${Math.round(minutes)} min vs ${shape.minutes} min recorded`]

  if (summary.distanceM > 0 && shape.distanceKm) {
    const distanceScore = closeness(summary.distanceM / 1000, shape.distanceKm, 0.5)
    score = score * 0.65 + distanceScore * 0.35
    signals = 2
    why.unshift(`${(summary.distanceM / 1000).toFixed(2)} km vs ${shape.distanceKm.toFixed(2)} km`)
  } else {
    score = Math.min(score, SINGLE_SIGNAL_CAP)
  }
  return { score, signals, why: why.join(', '), minutes: shape.minutes, distanceKm: shape.distanceKm }
}

/**
 * A score earned on duration alone is capped below the confident threshold.
 *
 * Without this, a candidate the stored entry cannot corroborate (an indoor
 * bike keeps no average speed, so its entry has no distance to compare) scores
 * a perfect 1.0 on duration and outranks a treadmill entry that matches on
 * duration *and* distance. One signal must never beat two agreeing ones.
 */
const SINGLE_SIGNAL_CAP = 0.9

/**
 * How sure a match is.
 *
 * Certainty needs two independent signals that agree, plus a high score.
 * Duration alone is never enough: on a day with a 20-minute treadmill and a
 * 20-minute bike, a file with no distance of its own fits both exactly. That
 * is *unimpeached*, not *confirmed*.
 */
export const MATCH_CONFIDENT = 0.8
export const MATCH_POSSIBLE = 0.55
/** How far clear of the runner-up a match has to be before it is offered alone. */
const TIE_MARGIN = 0.15

export function matchConfidence(score, { signals = 2 } = {}) {
  if (score === null || score === undefined) return 'none'
  if (score < MATCH_POSSIBLE) return 'weak'
  if (signals >= 2 && score >= MATCH_CONFIDENT) return 'confident'
  return 'possible'
}

/**
 * Rank the stored entries a TCX file could belong to.
 *
 * Only sessions on the same calendar day are considered — a 20-minute run on
 * another date is a different session however well the numbers line up.
 *
 * @returns {{ workoutIndex: number, entryIndex: number, score: number, why: string,
 *             confidence: string, ambiguous: boolean }[]} best first
 */
export function candidatesFor(summary, workouts = []) {
  const out = []
  workouts.forEach((workout, workoutIndex) => {
    if (workout?.d !== summary.date) return
    ;(workout.entries || []).forEach((entry, entryIndex) => {
      const scored = scoreEntry(summary, entry)
      if (!scored) return
      out.push({ workoutIndex, entryIndex, score: scored.score, signals: scored.signals, why: scored.why })
    })
  })
  out.sort((a, b) => b.score - a.score)

  // The margin is what separates a certain match from a coin toss, so it is
  // worked out here rather than each caller guessing at it.
  const [first, second] = out
  const margin = first && second ? first.score - second.score : Infinity
  for (const candidate of out) {
    candidate.margin = candidate === first ? margin : Infinity
    candidate.confidence = matchConfidence(candidate.score, { signals: candidate.signals })
    // Another entry the file fits almost as well: close enough that the user
    // should be asked rather than told.
    candidate.ambiguous = candidate === first && !!second && margin < TIE_MARGIN
  }
  return out
}

/**
 * What to add to the stored note, given what it already says.
 *
 * Only adds what is missing: a treadmill entry that never recorded a heart
 * rate gains one, while the bike entry that already carries HR 153/180 and
 * 79 W gains nothing and is left alone. Returns null when there is nothing to
 * say, so an already-complete entry is not rewritten for the sake of it.
 */
export function enrichmentNote(summary, existingNote = '', maxLength = 280) {
  const note = String(existingNote || '')
  // Already enriched by this or an earlier import. Re-importing the same file
  // is an easy mistake to make and would otherwise append the facts twice.
  if (/\bTCX:/.test(note)) return null
  const bits = []

  if (summary.avgHr && !/\bHR\b/.test(note)) {
    bits.push(`HR ${Math.round(summary.avgHr)}/${Math.round(summary.maxHr || summary.avgHr)}`)
  }
  if (summary.maxPowerW && !/\d+\s*W\b/.test(note)) {
    bits.push(`peak ${Math.round(summary.maxPowerW)} W`)
  }
  if (summary.speedLevels > 1) {
    bits.push(summary.speedText)
    if (summary.speedHint === 'hi-lo blocks') bits.push('hi-lo blocks')
  }
  if (!bits.length) return null

  const tail = `TCX: ${bits.join('; ')}`
  // The note is capped, so the original is trimmed from the middle rather than
  // the new facts being dropped — the new facts are the point of the import.
  const room = maxLength - tail.length - 3
  if (room <= 0) return null
  const head = note.length <= room ? note : `${note.slice(0, Math.max(0, room - 1)).trimEnd()}…`
  return head ? `${head}; ${tail}` : tail
}