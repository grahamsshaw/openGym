// PERSONAL-MOVES: daily MOVEs rollups for the Home card + history sheet.
// Technogym reports MOVEs per session (kept numeric on entries by the CSV
// import); nothing else reports them, so days sum what exists and skip the
// rest. A day with sessions but no MOVEs reads as "no data", never zero.

/** [{ d: 'YYYY-MM-DD', moves }] oldest first, only days with MOVEs. */
export function movesByDay(workouts) {
  const byDay = new Map()
  for (const w of workouts || []) {
    if (!w || !w.d) continue
    let day = 0
    for (const e of w.entries || []) {
      if (typeof e?.moves === 'number' && Number.isFinite(e.moves)) day += e.moves
    }
    if (day > 0) byDay.set(w.d, (byDay.get(w.d) || 0) + day)
  }
  return [...byDay.entries()].map(([d, moves]) => ({ d, moves })).sort((a, b) => (a.d < b.d ? -1 : 1))
}

/** MOVEs logged on one date, 0 when nothing reported them. */
export function movesOn(workouts, dateISO) {
  return movesByDay(workouts).find(d => d.d === dateISO)?.moves || 0
}
