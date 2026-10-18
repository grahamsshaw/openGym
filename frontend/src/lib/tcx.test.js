// PERSONAL-TCX: parser against fixtures shaped exactly like the real exports,
// including their rough edges (lap duration 0, missing speed, flat-zero heart
// rate where no strap was worn).
import { describe, expect, it } from 'vitest'
import { parseTcx, speedBlocks, describeShape, describeTcx } from './tcx.js'

const lap = ({ start, seconds = 0, distance = 0 }) =>
  `<Lap StartTime="${start}" TotalTimeSeconds="${seconds}" DistanceMeters="${distance}" Calories="0">`

const point = ({ t, dist, hr = 0, speed = null, watts = null, cadence = null }) => {
  const ext = []
  if (speed !== null) ext.push(`<Speed>${speed}</Speed>`)
  if (watts !== null) ext.push(`<Watts>${watts}</Watts>`)
  if (cadence !== null) ext.push(`<RunCadence>${cadence}</RunCadence>`)
  return `<Trackpoint><Time>${t}</Time><DistanceMeters>${dist}</DistanceMeters>` +
    `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>` +
    (ext.length ? `<Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">${ext.join('')}</TPX></Extensions>` : '') +
    `</Trackpoint>`
}

const build = ({ sport = 'Running', laps = '', points = '' }) =>
  `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garwin.com/xmlschemas/TrainingCenterDatabase/v2">` +
  `<Activities><Activity Sport="${sport}">${laps}${points}</Track></Activity></Activities></TrainingCenterDatabase>`

// Real export shape: 3-second samples, 405 of them, hi-low speed blocks.
const treadmill = build({
  laps: lap({ start: '2026-10-17T12:15:23.000Z' }),
  points: Array.from({ length: 40 }, (_, i) => point({
    t: new Date(Date.parse('2026-10-17T12:15:23.000Z') + i * 3e3).toISOString(),
    dist: 1290 + i * 4.6,
    hr: i < 10 ? 0 : 140 + (i % 5),
    speed: i < 12 ? 5.6 : i < 24 ? 10.8 : 6.0,
  })).join(''),
})

const bike = build({
  sport: 'Other',
  laps: lap({ start: '2026-10-17T13:43:05.000Z' }),
  points: Array.from({ length: 30 }, (_, i) => point({
    t: new Date(Date.parse('2026-10-17T13:43:05.000Z') + i * 40e3).toISOString(),
    dist: i * 248,
    hr: 149 + (i % 3),
    watts: 70 + (i % 10),
    cadence: 74,
  })).join(''),
})

describe('parseTcx', () => {
  it('reads duration and distance from the trackpoints, not the empty lap', () => {
    const s = parseTcx(treadmill)
    expect(s.durationS).toBe(117)          // 39 gaps of 3s
    expect(s.distanceM).toBeGreaterThan(1400)
    expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('ignores zero heart rate rather than averaging it in', () => {
    const s = parseTcx(treadmill)
    expect(s.hrPoints).toBe(30)             // first 10 read 0
    expect(s.avgHr).toBeGreaterThan(139)
    expect(s.avgHr).toBeLessThan(145)
  })

  it('reads power and cadence off a bike file with no speed', () => {
    const s = parseTcx(bike)
    expect(s.avgPowerW).toBeGreaterThan(70)
    expect(s.avgCadence).toBe(74)
    expect(s.speedLevels).toBe(0)           // no Speed element at all
  })

  it('prefers a lap duration when the trackpoints disagree wildly', () => {
    const sparse = build({
      laps: lap({ start: '2026-10-17T09:00:00.000Z', seconds: 1800 }),
      points: [0, 1].map(i => point({
        t: new Date(Date.parse('2026-10-17T09:00:00.000Z') + i * 60e3).toISOString(),
        dist: i * 100, hr: 120,
      })).join(''),
    })
    expect(parseTcx(sparse).durationS).toBe(1800)
  })

  it('does not let a long pause inflate the session', () => {
    const t0 = Date.parse('2026-10-17T08:00:00.000Z')
    const at = s => new Date(t0 + s * 1000).toISOString()
    const paused = build({
      points: [
        point({ t: at(0), dist: 0, speed: 6 }),
        point({ t: at(600), dist: 200, speed: 6 }),   // ten minutes off
        point({ t: at(660), dist: 260, speed: 6 }),
      ].join(''),
    })
    // The ten-minute gap is a pause and must not count; the minute after it is work.
    expect(parseTcx(paused).durationS).toBe(60)
  })

  it('refuses things that are not TCX, with a reason', () => {
    expect(parseTcx('').error).toBe('empty')
    expect(parseTcx('hello').error).toBe('not-tcx')
    expect(parseTcx('<TrainingCenterDatabase><oops>').error).toBeTruthy()
  })
})

describe('speed blocks', () => {
  it('merges samples within tolerance and splits beyond it', () => {
    const blocks = speedBlocks([
      { t: 0, kmh: 6.0 }, { t: 60, kmh: 6.1 }, { t: 120, kmh: 6.0 },
      { t: 180, kmh: 10.5 }, { t: 240, kmh: 10.7 }, { t: 300, kmh: 6.2 },
    ])
    // The middle block reports the average of the readings that formed it.
    expect(blocks.map(b => Math.round(b.kmh))).toEqual([6, 11, 6])
  })

  it('drops blocks too short to be an effort', () => {
    // A brief spike between two long holds of the same pace: the spike is real
    // data, but counting it would split one steady effort into two — or, if it
    // happened often enough, invent an interval session out of a steady one.
    const series = []
    let t = 0
    const hold = (kmh, samples) => {
      for (let i = 0; i < samples; i++) { series.push({ t, kmh }); t += 2 }
    }
    hold(6, 20)   // 40s
    hold(12, 3)   // 6s spike
    hold(6, 20)   // 40s
    const blocks = speedBlocks(series)
    expect(blocks.map(b => Math.round(b.kmh))).toEqual([6])
    expect(blocks[0].seconds).toBe(86)      // no time lost
  })

  it('names a clear alternating session and refuses a flat one', () => {
    const alt = [
      { t: 0, kmh: 5 }, { t: 60, kmh: 5 }, { t: 120, kmh: 11 }, { t: 180, kmh: 11 },
      { t: 240, kmh: 5 }, { t: 300, kmh: 5 }, { t: 360, kmh: 11 }, { t: 420, kmh: 11 },
    ]
    expect(describeShape(speedBlocks(alt)).hint).toBe('hi-lo blocks')

    // One way and staying there is a climb, not intervals.
    const climb = [
      { t: 0, kmh: 5 }, { t: 60, kmh: 6.5 }, { t: 120, kmh: 8 },
      { t: 180, kmh: 9.5 }, { t: 240, kmh: 11 }, { t: 300, kmh: 12 },
    ]
    expect(describeShape(speedBlocks(climb)).hint).not.toBe('hi-lo blocks')

    const flat = [
      { t: 0, kmh: 6 }, { t: 60, kmh: 6.1 }, { t: 120, kmh: 5.9 }, { t: 180, kmh: 6 },
    ]
    expect(describeShape(speedBlocks(flat)).hint).toBe('')
    expect(describeShape(speedBlocks(flat)).text).toBe('steady 6.0 km/h')
  })
})

describe('describeTcx', () => {
  it('summarises what matters in one line', () => {
    const line = describeTcx(parseTcx(treadmill))
    expect(line).toMatch(/min/)
    expect(line).toMatch(/km/)
    expect(line).toMatch(/HR/)
  })
})