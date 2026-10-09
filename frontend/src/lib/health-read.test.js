// PERSONAL-READ: readPhoneHealth + toHealthExportCsv against a fake plugin.
import { describe, expect, it, vi } from 'vitest'
import { readPhoneHealth, toHealthExportCsv } from './health-read.js'

const noon = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = noon(2026, 10, 8)
const D1 = noon(2026, 10, 7, 0)
const D2 = noon(2026, 10, 8, 0)

const hc = {
  read: vi.fn(async ({ startMs }) => {
    if (startMs === D1) {
      return {
        sessions: [
          { start: D1 + 11 * 3600000, end: D1 + 11 * 3600000 + 30 * 60000, type: 79, typeName: 'walking', title: '', app: 'com.sec.android.app.shealth', distanceM: 2000, caloriesKcal: 100 },
          { start: D1 + 18 * 3600000, end: D1 + 18 * 3600000 + 20 * 60000, type: 0, typeName: 'other', title: 'Evening yoga', app: 'com.sec.android.app.shealth', distanceM: 0, caloriesKcal: 50 },
          { start: D1 + 19 * 3600000, end: D1 + 19 * 3600000 + 40 * 60000, type: 1, typeName: 'strength_training', title: 'Gym', app: 'ch.duartesantos.opengym', distanceM: 0, caloriesKcal: 200 },
        ],
        steps: 5000, distanceM: 2000, caloriesKcal: 300, hrMin: 60, hrAvg: 80, hrMax: 120,
        sleep: [{ start: D1 + 23 * 3600000, end: D2 + 7 * 3600000, lightMin: 200, deepMin: 90, remMin: 100, awakeMin: 30 }],
      }
    }
    return {
      sessions: [], steps: 100, distanceM: 0, caloriesKcal: 0, hrMin: 0, hrAvg: 70, hrMax: 0,
      sleep: [{ start: D1 + 23 * 3600000, end: D2 + 7 * 3600000, lightMin: 200, deepMin: 90, remMin: 100, awakeMin: 30 }],
    }
  }),
}

describe('readPhoneHealth', () => {
  it('reads day windows, skips own-app echo, dedupes sleep across midnight', async () => {
    const r = await readPhoneHealth({ days: 2, now: NOW, hc })
    expect(hc.read).toHaveBeenCalledTimes(2)
    expect(r.sessions.map(s => s.name)).toEqual(['Walking', 'Evening yoga'])
    expect(r.sessions[0]).toMatchObject({ date: '2026-10-07', distanceM: 2000, caloriesKcal: 100 })
    expect(r.days['2026-10-07']).toMatchObject({ steps: 5000, distanceM: 2000, calories: 300 })
    expect(r.days['2026-10-07'].vitals).toMatchObject({ hrMin: 60, hrAvg: 80, hrMax: 120 })
    expect(r.sleep).toHaveLength(1)
  })

  it('refuses without a plugin', async () => {
    await expect(readPhoneHealth({ hc: null })).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('toHealthExportCsv', () => {
  it('shapes reads as the export app files', async () => {
    const csv = toHealthExportCsv(await readPhoneHealth({ days: 2, now: NOW, hc }))
    expect(csv.activity).toContain('2026-10-07 11:00:00,Walking,30,100,2000')
    expect(csv.activity).toContain('2026-10-07,phone,,5000,2000,,,300,')
    expect(csv.sleep).toContain('2026-10-07 23:00:00,2026-10-08 07:00:00,200,90,100,30')
    expect(csv.vitals).toContain('2026-10-07,phone,,60,120,80,')
  })
})
