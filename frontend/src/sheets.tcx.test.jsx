// @vitest-environment happy-dom
// PERSONAL-TCX: the Settings -> Data row, through a real .tcx to a real edit.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromTcx } from './sheets.jsx'

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

// The treadmill file, at its real shape: 20 minutes, 2.41 km, no distance on
// the stored entry's treadmill counterpart but heart rate missing from it.
const trackpoints = Array.from({ length: 60 }, (_, i) =>
  `<Trackpoint><Time>${new Date(Date.parse('2026-10-17T12:15:23.000Z') + i * 20e3).toISOString()}</Time>` +
  `<DistanceMeters>${Math.round(1290 + i * 20)}</DistanceMeters>` +
  `<HeartRateBpm><Value>${i < 6 ? 0 : 140 + (i % 6)}</Value></HeartRateBpm>` +
  `<Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">` +
  `<Speed>${i < 20 ? 5.6 : i < 40 ? 10.8 : 6.0}</Speed></TPX></Extensions></Trackpoint>`).join('')

const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">` +
  `<Activities><Activity Sport="Running"><Lap StartTime="2026-10-17T12:15:23.000Z" TotalTimeSeconds="0" DistanceMeters="0">` +
  `${trackpoints}</Lap></Track></Activity></Activities></TrainingCenterDatabase>`

function file(text) {
  const f = new File([text], 'treadmill data.tcx', { type: 'application/xml' })
  // jsdom's File has no .text(); the app reads with FileReader, but a stub here
  // keeps the test to one read path.
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) })
  return f
}

const treadmillEntry = {
  id: 'im-treadmill',
  sets: [{ min: 20, speed: 7.2, done: true }],
  note: 'Run Excite Live; avg 7.2 km/h; climb 0 m; Move 304; source technogym-live',
  moves: 304,
}

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({
    S: {
      ...structuredClone(DEF),
      workouts: [{ d: '2026-10-17', entries: [treadmillEntry], start: Date.parse('2026-10-17T10:00:00') }],
      routines: [], active: null,
    },
    user: null,
  })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

async function openSheetFor(files) {
  await act(async () => {
    importFromTcx(files)
    // FileReader delivers on a macrotask, which act does not flush, so the
    // sheet would not exist yet — and a reader left pending would open its
    // sheet inside whichever test ran next.
    await new Promise(resolve => setTimeout(resolve, 30))
  })
  return renderTop()
}

const button = (host, text) =>
  [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

describe('TCX import sheet', () => {
  it('matches the file to the session it describes and shows what it adds', async () => {
    const host = await openSheetFor([file(tcx)])

    expect(host.textContent).toContain('treadmill data.tcx')
    expect(host.textContent).toContain('Run Excite Live')          // the matched entry
    expect(host.textContent).toMatch(/2\.47 km vs 2\.40 km/)       // why it matched
    expect(host.textContent).toMatch(/Adds: TCX:/)                // what it will add
    expect(host.textContent).toMatch(/HR 143\/145/)               // the gap it fills
  })

  it('says clearly that it only adds detail', async () => {
    const host = await openSheetFor([file(tcx)])
    expect(host.textContent).toMatch(/only add detail/i)
    expect(host.textContent).toMatch(/Nothing is created or replaced/i)
  })

  it('writes the heart rate into the note and leaves the rest alone', async () => {
    const host = await openSheetFor([file(tcx)])
    const confirm = button(host, '1 session to update')
    expect(confirm).toBeTruthy()

    act(() => { confirm.click() })

    const entry = useStore.getState().S.workouts[0].entries[0]
    expect(entry.note).toMatch(/HR 143\/145/)                    // the gap, filled
    expect(entry.note).toMatch(/3 speed levels/)                 // what the shape says
    expect(entry.note).toMatch(/^Run Excite Live/)               // original kept
    expect(entry.note).toMatch(/Move 304/)                      // and its MOVEs
    expect(entry.moves).toBe(304)                               // untouched
    expect(entry.sets).toEqual(treadmillEntry.sets)             // untouched
  })

  it('refuses a file that fits nothing on that day', async () => {
    const wrongDay = tcx.replace(/2026-10-17/g, '2026-09-01')
    const host = await openSheetFor([file(wrongDay)])
    expect(host.textContent).toMatch(/No session recorded on that day/i)
    expect(button(host, 'Nothing to add')).toBeTruthy()
  })

  it('does not touch a session when the file is skipped', async () => {
    const host = await openSheetFor([file(tcx)])
    const row = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Run Excite Live'))
    act(() => { row.click() })                     // toggle it off
    expect(button(host, '1 session to update')).toBeFalsy()
    expect(button(host, 'Nothing to add')).toBeTruthy()

    act(() => { button(host, 'Cancel').click() })
    expect(useStore.getState().S.workouts[0].entries[0].note).toBe(treadmillEntry.note)
  })

  it('refuses a selection with no .tcx files in it', async () => {
    const other = new File(['{}'], 'notes.json', { type: 'application/json' })
    await act(async () => {
      importFromTcx([other])
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toMatch(/\.tcx/)
  })

  it('reports a .tcx file it cannot read rather than opening an empty sheet', async () => {
    await act(async () => {
      importFromTcx([file('this is not xml at all')])
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toMatch(/Could not read/i)
  })

  it('lists the unreadable file by name alongside the good ones', async () => {
    const junk = Object.defineProperty(new File(['nope'], 'broken.tcx'),
      'text', { value: () => Promise.resolve('nope') })
    const host = await openSheetFor([file(tcx), junk])
    expect(host.textContent).toContain('treadmill data.tcx')
    expect(host.textContent).toContain('broken.tcx')
    expect(host.textContent).toMatch(/not a \.tcx file/i)
    // The good file is still importable.
    expect(button(host, '1 session to update')).toBeTruthy()
  })
})