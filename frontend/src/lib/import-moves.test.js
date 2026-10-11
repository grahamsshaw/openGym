// PERSONAL-MOVES: per-entry MOVEs survive the CSV import as numbers.
import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV } from './import-csv.js'

const csv = (rows) => ['workout name,exercise,date,duration seconds,note', ...rows].join('\n')

describe('moves extraction', () => {
  it('keeps "Move N" as entry.moves', () => {
    const p = parseWorkoutCSV(csv(['Gym,Treadmill (Technogym),2026-10-10,1200,Move 278; source technogym']))
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries[0].moves).toBe(278)
  })

  it('reads "N MOVEs" form too', () => {
    const p = parseWorkoutCSV(csv(['Gym,Bike,2026-10-10,1200,197 MOVEs']))
    expect(p.workouts[0].entries[0].moves).toBe(197)
  })

  it('omits moves when the note has none', () => {
    const p = parseWorkoutCSV(csv(['Gym,Treadmill,2026-10-10,1200,steady run']))
    expect(p.workouts[0].entries[0].moves).toBeUndefined()
  })
})
