// PERSONAL-READ: readPhoneHealth + toHealthExportCsv against a fake plugin.
import { describe, expect, it, vi } from 'vitest'
import { readPhoneHealth, toHealthExportCsv, ensureReadPermissions } from './health-read.js'

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

  it('reports progress so a 30-day read is not a dead button', async () => {
    const seen = []
    await readPhoneHealth({ days: 3, now: NOW, hc, onProgress: (d, n) => seen.push([d, n]) })
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]])
  })
})

// The native `read` rejects without the read set held, so the app has to ask
// for it before reading. Every failure must come back with a distinct reason:
// "Health Connect is missing", "you said no" and "this build cannot ask" are
// different problems, and reporting all three as a permission problem is what
// made the button unreadable from the outside.
describe('ensureReadPermissions', () => {
  it('reports granted when Health Connect says so', async () => {
    const plugin = { requestReadPermissions: vi.fn(async () => ({ granted: true })) }
    await expect(ensureReadPermissions(plugin)).resolves.toEqual({ ok: true })
    expect(plugin.requestReadPermissions).toHaveBeenCalledTimes(1)
  })

  it('reports denied when the sheet is dismissed', async () => {
    const plugin = { requestReadPermissions: vi.fn(async () => ({ granted: false })) }
    await expect(ensureReadPermissions(plugin)).resolves.toEqual({ ok: false, why: 'denied' })
  })

  // Health Connect missing, or its provider needing an update, is not something
  // the user can grant - so it must not be dressed up as a permission problem.
  it('reports unavailable distinctly from denied', async () => {
    const plugin = {
      requestReadPermissions: vi.fn(async () => {
        throw Object.assign(new Error('Health Connect is not available'), { code: 'unavailable' })
      }),
    }
    await expect(ensureReadPermissions(plugin)).resolves.toEqual({ ok: false, why: 'unavailable' })
  })

  it('recognises unavailable from the message when there is no code', async () => {
    const plugin = { requestReadPermissions: vi.fn(async () => { throw new Error('Health Connect is not available') }) }
    await expect(ensureReadPermissions(plugin)).resolves.toEqual({ ok: false, why: 'unavailable' })
  })

  // Anything else keeps its own wording, which is the only clue to what broke.
  it('carries the real message through on any other failure', async () => {
    const plugin = { requestReadPermissions: vi.fn(async () => { throw new Error('sheet exploded') }) }
    await expect(ensureReadPermissions(plugin)).resolves.toEqual({
      ok: false, why: 'failed', message: 'sheet exploded',
    })
  })

  // A plugin predating the read-permission method must not blow up either.
  it('reports no-plugin when the method is missing', async () => {
    await expect(ensureReadPermissions({ read: vi.fn() })).resolves.toEqual({ ok: false, why: 'no-plugin' })
    await expect(ensureReadPermissions(null)).resolves.toEqual({ ok: false, why: 'no-plugin' })
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
