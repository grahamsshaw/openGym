// PERSONAL-QR: resolve a gym QR code to a mapped machine.
//
// Technogym console codes (`s.technogym.com/qractive?et=…`) are one base64
// blob (checksum after the `.` is ignored): serial|facility|platform|
// screen|os|…|model|…|firmware|… Rowers (`skillrow/rower?et=…`) carry only
// a serial. Matching keys on the model code (serials vary per unit), with
// recorded serials as the fallback — verified against real gym scans (see
// documentation/QR-PLAN.md), whose shape the test fixtures below copy.
import DATA from './equipment-qr.json'

const b64 = s => {
  const clean = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '')
  try {
    return atob(clean)
  } catch {
    return null
  }
}

/** Pull { serial, facility, model } out of a QR text, or null. */
export function decodeTechnogymPayload(text) {
  const raw = String(text || '')
  const rower = /skillrow\/rower\?et=([A-Za-z0-9]+)/i.exec(raw)
  if (rower) return { serial: rower[1].toUpperCase(), facility: null, model: null }
  const et = /[?&]et=([^&\s]+)/.exec(raw) || (/^([A-Za-z0-9+/=]+(\.[0-9a-f]+)?)$/.exec(raw.trim()) && [null, raw.trim()])
  if (!et) return null
  let blob = et[1].split('.')[0]
  while (blob.length % 4 === 1) blob = blob.slice(0, -1)
  const decoded = b64(blob)
  if (!decoded || !decoded.includes('|')) return null
  const fields = decoded.split('|')
  if (fields.length < 7) return null
  return { serial: fields[0] || null, facility: fields[1] || null, model: fields[6] || null }
}

/** The mapped machine for a QR text, or null when nothing matches. */
export function resolveQr(text) {
  const found = decodeTechnogymPayload(text)
  if (!found) return null
  const machines = DATA.machines || []
  if (found.model) {
    const hit = machines.find(m => m.model_code && m.model_code === found.model)
    if (hit) return hit
  }
  if (found.serial) {
    const hit = machines.find(m => (m.serials || []).some(s => found.serial.includes(s) || s.includes(found.serial)))
    if (hit) return hit
  }
  return null
}
