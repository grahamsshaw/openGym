// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// PERSONAL-BRIDGE: the "Pull gym + Wii data" and "Send phone files to
// server" rows. lib/api.js is mocked; the server contract is covered by
// api/test/bridge.test.js against the real server.
const mocks = vi.hoisted(() => {
  const state = { S: null, apiCalls: [] }
  state.snapshot = () => ({
    S: state.S, user: null, update: vi.fn(),
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  state.toast = vi.fn()
  state.api = vi.fn(async (path, opts) => {
    state.apiCalls.push([path, opts])
    if (path === '/api/bridge/status') {
      return { ok: true, runner: false,
        pending: state.queued ? [{ id: 'job1', sources: ['technogym'], at: '2026-10-09' }] : [],
        last: null }
    }
    if (path === '/api/bridge/pull') {
      state.queued = true
      return { ok: true, job: { id: 'job1', sources: ['technogym'], at: '2026-10-09' }, coalesced: false }
    }
    if (path === '/api/bridge/inbox') return { ok: true, file: 'Activity.csv', bytes: 10 }
    throw new Error('unexpected ' + path)
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => false,
  passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, isAndroid: () => Promise.resolve(false),
  shareExport: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({ checkForUpdate: () => Promise.resolve({ hasUpdate: false }), downloadAndInstall: vi.fn() }))
vi.mock('../lib/health-sync.js', () => ({
  healthStatus: () => Promise.resolve({ status: 'unsupported' }),
  loadHealth: () => Promise.resolve(null), enableHealth: vi.fn(),
  disableHealth: vi.fn(), openHealthConnect: vi.fn(), onHealthChange: () => () => {},
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.apiCalls = []
  mocks.queued = false
  mocks.toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async () => {
  await act(async () => { root.render(<Settings page="data" />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const row = text => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(text))

describe('Settings — bridge rows', () => {
  it('shows the pull and send rows on the data page', async () => {
    await mount()
    expect(row('Pull gym + Wii data')).toBeTruthy()
    expect(row('Send phone files to server')).toBeTruthy()
  })

  it('pull queues a server job and reports it', async () => {
    await mount()
    await act(async () => { row('Pull gym + Wii data').click() })
    const [path, opts] = mocks.apiCalls.find(([p]) => p === '/api/bridge/pull')
    expect(path).toBe('/api/bridge/pull')
    expect(opts.method).toBe('POST')
    expect(mocks.toast).toHaveBeenCalledWith('Pull queued.')
    expect(row('1 waiting')).toBeTruthy()
  })

  it('upload posts each picked file to the inbox', async () => {
    await mount()
    const input = host.querySelector('input[type="file"][multiple]')
    expect(input).toBeTruthy()
    const file = { name: 'Activity.csv', text: async () => 'Date,Steps\n2026-10-01,1\n' }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    const sent = mocks.apiCalls.find(([p]) => p === '/api/bridge/inbox')
    expect(sent).toBeTruthy()
    expect(JSON.parse(sent[1].body)).toMatchObject({ filename: 'Activity.csv' })
    expect(mocks.toast).toHaveBeenCalledWith('1 file(s) on the server.')
  })
})
