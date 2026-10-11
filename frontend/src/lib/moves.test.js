// PERSONAL-MOVES: rollups over entry.moves (see lib/import-csv.js).
import { describe, expect, it } from 'vitest'
import { movesByDay, movesOn } from './moves.js'

const w = (d, moves) => ({ d, entries: moves.map(m => ({ id: 'e', sets: [], ...(m == null ? {} : { moves: m }) })) })

describe('moves rollups', () => {
  it('sums entries per day, oldest first, skipping move-less days', () => {
    expect(movesByDay([
      w('2026-10-02', [100, 50]),
      w('2026-10-01', [200]),
      w('2026-10-03', [null]),
      w('2026-10-02', [25]),
    ])).toEqual([
      { d: '2026-10-01', moves: 200 },
      { d: '2026-10-02', moves: 175 },
    ])
  })

  it('reads one day or zero', () => {
    const days = [w('2026-10-01', [200])]
    expect(movesOn(days, '2026-10-01')).toBe(200)
    expect(movesOn(days, '2026-10-02')).toBe(0)
    expect(movesOn([], '2026-10-01')).toBe(0)
  })
})
