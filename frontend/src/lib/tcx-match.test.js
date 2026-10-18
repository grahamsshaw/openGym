// PERSONAL-TCX: matching and enrichment, on the shapes the real files produce.
import { describe, expect, it } from 'vitest'
import { candidatesFor, matchConfidence, entryShape, enrichmentNote } from './tcx-match.js'

// What the 2026-10-17 session looks like on the server today.
const workouts = [
  { d: '2026-10-10', entries: [{ sets: [{ min: 20, speed: 0 }], note: 'Bike Excite Live; Move 201' }] },
  {
    d: '2026-10-17',
    entries: [
      { sets: [{ min: 20, speed: 7.2 }], note: 'Run Excite Live; avg 7.2 km/h; climb 0 m; Move 304; source technogym-live' },
      { sets: [{ min: 10, speed: 0 }], note: 'Activities; Move 264; source technogym-live' },
      { sets: [{ min: 0.58, speed: 0 }], note: 'Synchro Excite Live; Move 8; source technogym-live' },
      { sets: [{ min: 14, speed: 0 }], note: 'Climb Excite Live; 38 floors; Move 231; source technogym-live' },
      // The bike: 20 minutes, distance recorded but no average speed, so the
      // stored entry cannot reproduce the distance the file has.
      { sets: [{ min: 20, speed: 0 }], note: 'Bike Excite Live; HR 153.0/180.0; avg 79 W; avg 74 rpm; Move 201; source technogym-live' },
      { sets: [{ w: 40, reps: 12 }], note: 'Abdominal Crunch Sel' },
    ],
  },
]

const treadmill = {
  date: '2026-10-17', durationS: 1170, distanceM: 2414,
  avgSpeedKmh: 7.4, avgHr: 140, maxHr: 188,
  speedLevels: 19, speedText: '19 speed levels 5.1-10.3 km/h', speedHint: 'hi-lo blocks',
}
const bike = {
  date: '2026-10-17', durationS: 1200, distanceM: 7446,
  avgSpeedKmh: 22.3, avgHr: 149, maxHr: 180,
  avgPowerW: 79.5, maxPowerW: 569,
  speedLevels: 0, speedText: '', speedHint: '',
}

describe('entryShape', () => {
  it('reads minutes and derives distance from speed', () => {
    expect(entryShape(workouts[1].entries[0])).toEqual({
      minutes: 20, speedKmh: 7.2, distanceKm: 2.4,
    })
  })

  it('says distance is unknown when the console reported no speed', () => {
    expect(entryShape(workouts[1].entries[4])).toEqual({
      minutes: 20, speedKmh: null, distanceKm: null,
    })
  })

  it('ignores strength entries', () => {
    expect(entryShape(workouts[1].entries[5])).toBeNull()
  })
})

describe('candidatesFor', () => {
  it('picks the treadmill entry for the treadmill file', () => {
    const [best] = candidatesFor(treadmill, workouts)
    expect(best.entryIndex).toBe(0)
    expect(best.workoutIndex).toBe(1)
    // Duration and distance agree, and nothing else comes close: certain.
    expect(best.signals).toBe(2)
    expect(best.confidence).toBe('confident')
    expect(best.why).toMatch(/km/)
  })

  it('picks the bike entry for the bike file, but not confidently', () => {
    const [best] = candidatesFor(bike, workouts)
    // The bike entry stores no distance, so only duration is left to match on.
    // Nothing contradicts it, but one signal is not a confirmation.
    expect(best.entryIndex).toBe(4)
    expect(best.signals).toBe(1)
    expect(best.confidence).toBe('possible')
  })

  it('never looks at another day, however well the numbers fit', () => {
    const sameNumbersOtherDay = { ...treadmill, date: '2026-11-01' }
    expect(candidatesFor(sameNumbersOtherDay, workouts)).toEqual([])
  })

  it('reports a day with nothing comparable rather than guessing', () => {
    const lonely = { ...treadmill, durationS: 600 }   // 10 min, matches the rowing
    const ranked = candidatesFor(lonely, workouts)
    expect(ranked[0].entryIndex).toBe(1)
    // The rowing entry has no distance recorded, so this rests on duration
    // alone: an exact 10-for-10, but only ever "possible".
    expect(ranked[0].confidence).toBe('possible')
    expect(ranked[0].signals).toBe(1)
  })

  it('calls a tie ambiguous rather than picking a winner', () => {
    // Two sessions the file fits identically: nothing may be auto-applied.
    const tied = [0, 1].map(() => ({
      d: '2026-10-17', entries: [{ sets: [{ min: 20, speed: 0 }], note: 'x' }],
    }))
    const ranked = candidatesFor(
      { date: '2026-10-17', durationS: 1200, distanceM: 0, avgHr: 120, speedLevels: 0 }, tied)
    expect(ranked).toHaveLength(2)
    expect(ranked[0].ambiguous).toBe(true)
    expect(ranked[0].confidence).not.toBe('confident')
  })
})

describe('enrichmentNote', () => {
  it('fills in a heart rate the console never recorded', () => {
    const note = enrichmentNote(treadmill, workouts[1].entries[0].note)
    expect(note).toMatch(/HR 140\/188/)
    expect(note).toMatch(/hi-lo blocks/)
    expect(note).toMatch(/19 speed levels/)
    expect(note).toMatch(/^Run Excite Live/)   // the original text is kept
  })

  it('leaves an entry that already says everything alone', () => {
    const existing = workouts[1].entries[4].note   // HR and 79 W already there
    expect(enrichmentNote(bike, existing)).toBeNull()
  })

  it('still adds what is missing when part of it is known', () => {
    const note = enrichmentNote(bike, 'Bike Excite Live; HR 153/180; Move 201')
    // The heart rate was already recorded, so it must not be added a second
    // time -- only the peak power, which the console never reported.
    const added = note.slice(note.indexOf('TCX:'))
    expect(added).toMatch(/peak 569 W/)
    expect(added).not.toMatch(/HR/)
  })

  it('respects the note cap, keeping the new facts', () => {
    const long = `${'x'.repeat(400)}; something`
    const note = enrichmentNote(treadmill, long, 280)
    expect(note.length).toBeLessThanOrEqual(280)
    expect(note).toMatch(/hi-lo blocks/)
  })

  it('is a no-op when the entry already carries TCX facts', () => {
    // Re-importing the same file is an easy mistake; it must not append twice.
    const once = enrichmentNote(treadmill, workouts[1].entries[0].note)
    expect(enrichmentNote(treadmill, once)).toBeNull()
  })

  it('says nothing at all when the file adds nothing', () => {
    expect(enrichmentNote({ date: '2026-10-17', durationS: 600, distanceM: 0, avgHr: null, speedLevels: 0 },
      'Activities; Move 264')).toBeNull()
  })
})