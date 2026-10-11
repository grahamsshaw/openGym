// @vitest-environment happy-dom
// PERSONAL-QR: machine scan sheet, machine sheet, picker equipment preset.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { machineScanSheet, machineSheet, exercisePicker } from './sheets.jsx'
import { resolveQr } from './lib/qr-resolve.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('machine scan sheet', () => {
  it('lists mapped machines for manual pick', () => {
    machineScanSheet(() => {})
    const host = renderTop()
    expect(host.textContent).toContain('Run Excite Live')
    expect(host.textContent).toContain('Skill Rower')
  })

  it('machine sheet shows programs and hands the machine over', () => {
    const machine = resolveQr('http://s.technogym.com/skillrow/rower?et=RWX25003798XAB')
    expect(machine?.machine).toContain('Rower')
    const picked = []
    machineSheet(machine, m => picked.push(m))
    const host = renderTop()
    expect(host.textContent).toContain('Skill Rower')
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Choose exercise'))
    act(() => { btn.click() })
    expect(picked).toHaveLength(1)
  })
})

describe('picker equipment preset', () => {
  it('opens narrowed to the given kit', () => {
    exercisePicker(() => {}, { title: 'Bike', initialEq: 'stationary bike' })
    const host = renderTop()
    const on = [...host.querySelectorAll('.chip.on')].map(c => c.textContent)
    expect(on.some(t => t.includes('stationary bike'))).toBe(true)
  })

  it('unknown tags fall back to any equipment', () => {
    exercisePicker(() => {}, { title: 'X', initialEq: 'treadmill' })
    const host = renderTop()
    const on = [...host.querySelectorAll('.chip.on')].map(c => c.textContent)
    expect(on.some(t => t.includes('Any equipment'))).toBe(true)
  })
})
