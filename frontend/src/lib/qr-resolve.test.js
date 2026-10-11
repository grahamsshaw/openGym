// PERSONAL-QR: resolver tests. Fixtures are synthetic payloads in the exact
// shape of real gym scans (see documentation/QR-PLAN.md) — same fields,
// invented serials — so no gym hardware IDs land in the test suite.
import { describe, expect, it } from 'vitest'
import { decodeTechnogymPayload, resolveQr } from './qr-resolve.js'

const payload = (serial, model) => {
  const raw = [serial, '57157b28-8d3e-4bdf-8477-2fe0a138a2e3', 'UnityCoach',
    'Screen15_6', 'Android', 'False', model, 'ac095868', '2.19.2.262',
    'PlatformEssential', '', '0', '1'].join('|')
  return 'http://s.technogym.com/qractive?et=' + btoa(raw) + '0.deadbeef'
}
const codes = {
  treadmill: payload('DFKGAA025009999', '1097'),
  bike: payload('DFCG4A025008888', '1121'),
  unknownModel: payload('XXXXAA025007777', '9999'),
  rower: 'http://s.technogym.com/skillrow/rower?et=RWX25003798XAB',
}

describe('decodeTechnogymPayload', () => {
  it('pulls serial, facility and model out', () => {
    expect(decodeTechnogymPayload(codes.treadmill)).toMatchObject({
      serial: 'DFKGAA025009999', model: '1097',
      facility: '57157b28-8d3e-4bdf-8477-2fe0a138a2e3',
    })
  })

  it('reads rower serials', () => {
    expect(decodeTechnogymPayload(codes.rower)).toMatchObject({ serial: 'RWX25003798XAB' })
  })

  it('refuses junk', () => {
    expect(decodeTechnogymPayload('hello world')).toBeNull()
    expect(decodeTechnogymPayload('')).toBeNull()
  })
})

describe('resolveQr', () => {
  it('matches any unit of a model (serials vary)', () => {
    expect(resolveQr(codes.treadmill)?.machine).toBe('Run Excite Live')
    expect(resolveQr(codes.bike)?.machine).toBe('Bike Excite Live')
  })

  it('matches the rower by recorded serial', () => {
    expect(resolveQr(codes.rower)?.machine).toContain('Rower')
  })

  it('returns null for unknown models and junk', () => {
    expect(resolveQr(codes.unknownModel)).toBeNull()
    expect(resolveQr('not a code')).toBeNull()
  })
})
