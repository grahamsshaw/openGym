// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', movesSheet: vi.fn(),
}))

// PERSONAL-MOVES: the Home MOVEs card reads entry.moves (see lib/moves.js).
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = workouts => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts, bodyweight: [], dayPlan: {}, week: {}, active: null },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const movesHeading = () => [...host.querySelectorAll('h2')].find(el => el.textContent === 'Moves')

describe('Home MOVEs card', () => {
  it('shows today total with move-carrying sessions', () => {
    mountWith([{ d: '2026-10-10', entries: [{ id: 'e', sets: [], moves: 278 }] }])
    expect(movesHeading()).toBeTruthy()
    expect(host.textContent).toContain('278')
  })

  it('hides when nothing reported MOVEs', () => {
    mountWith([{ d: '2026-10-10', entries: [{ id: 'e', sets: [] }] }])
    expect(movesHeading()).toBeFalsy()
    mountWith([])
    expect(movesHeading()).toBeFalsy()
  })
})
