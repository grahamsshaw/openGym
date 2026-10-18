// PERSONAL-BRIDGE: server pull trigger + phone-file inbox upload.
//
// Two rows for Settings → Data ("Bring data in" area):
// - "Pull gym + Wii data": POSTs /api/bridge/pull, then shows the queue
//   state from /api/bridge/status (runner present? pending? last result?).
// - "Send phone files to server": picks Health Data Export CSVs (or any
//   .csv/.json/.xml) and POSTs each to /api/bridge/inbox, where the pull
//   chain consumes them. Works wherever the app runs — browser, PWA, or
//   the paired phone app — because lib/api.js carries the session both ways.
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { MOBILE, isAndroid } from '../lib/mobile.js'
import { readPlugin, readPhoneHealth, toHealthExportCsv, ensureReadPermissions, READ_DAYS_DEFAULT } from '../lib/health-read.js'
import { Row, Section } from './ui.jsx'

function statusLine(s) {
  if (!s) return ''
  const bits = []
  bits.push(s.runner ? t('Runner watching') : t('Queued — runs on the next pull'))
  if (s.pending?.length) bits.push(t('{0} waiting', s.pending.length))
  if (s.last) bits.push(t('Last: {0}', s.last.ok ? t('done') : t('failed')))
  return bits.join(' · ')
}

export function BridgeDataSection() {
  const toast = useUI(s => s.toast)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [readNote, setReadNote] = useState(null)
  const [droid, setDroid] = useState(false)
  const upRef = useRef(null)
  useEffect(() => { if (MOBILE) isAndroid().then(setDroid).catch(() => {}) }, [])

  const refresh = async () => {
    try { setStatus(await api('/api/bridge/status')) }
    catch { /* offline: keep the last status shown */ }
  }

  const pull = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api('/api/bridge/pull', { method: 'POST', body: JSON.stringify({}) })
      toast(r.coalesced ? t('A pull is already queued.') : t('Pull queued.'))
      await refresh()
    } catch (e) {
      toast(e?.data?.error || t('Could not queue the pull.'))
    }
    setBusy(false)
  }

  const upload = async ev => {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!files.length) return
    let ok = 0
    for (const f of files) {
      try {
        const content = await f.text()
        await api('/api/bridge/inbox', {
          method: 'POST', body: JSON.stringify({ filename: f.name, content }),
        })
        ok++
      } catch (e) {
        toast(t('{0}: {1}', f.name, e?.data?.error || t('refused')))
      }
    }
    if (ok) toast(t('{0} file(s) on the server.', ok))
  }

  // PERSONAL-READ: read this phone's Health Connect data and upload it as
  // the export app's CSVs, straight into the server inbox. Needs the
  // personal APK (the official build has no native `read`); anything else
  // says so plainly instead of failing quietly.
  //
  // The read set is asked for here rather than assumed: `read` refuses without
  // it, so a button that only reported the refusal could never succeed.
  //
  // Every outcome is also written into the row's own subtitle, not only raised
  // as a toast. A toast that flashes off-screen is indistinguishable from a
  // button that did nothing, which is exactly what was being reported.
  const readPhone = async () => {
    if (busy) return
    setBusy(true)
    setProgress(null)
    setReadNote(null)
    try {
      const hc = await readPlugin()
      if (!hc) {
        const note = t('This build cannot read Health Connect.')
        setReadNote(note)
        toast(note)
        return
      }
      const permit = await ensureReadPermissions(hc)
      if (!permit.ok) {
        // Each reason gets its own words. "Not installed" and "you said no" look
        // identical from the outside if both are reported as a permission.
        const WHY = {
          'no-plugin': t('This build cannot ask for Health Connect access.'),
          missing: t('Health Connect is not installed on this phone. Install it from the Play Store, then try again.'),
          update: t('Health Connect needs updating before it can be used.'),
          unsupported: t('Health Connect is not available on this phone.'),
          unavailable: t('Health Connect is not available on this phone.'),
          denied: t('Health Connect access was not granted.'),
          timeout: t('Health Connect did not answer. Close the app and try again.'),
        }
        const note = WHY[permit.why] || t('Health Connect request failed: {0}', permit.message || t('unknown error'))
        setReadNote(note)
        toast(note)
        return
      }
      const read = await readPhoneHealth({
        days: READ_DAYS_DEFAULT, hc,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const csv = toHealthExportCsv(read)
      const files = [
        ['Activity.csv', csv.activity],
        ['Sleep.csv', csv.sleep],
        ['Vitals.csv', csv.vitals],
      ].filter(([, text]) => text.trim().split('\n').length > 2)
      for (const [filename, content] of files) {
        await api('/api/bridge/inbox', { method: 'POST', body: JSON.stringify({ filename, content }) })
      }
      const days = Object.keys(read.days || {}).length
      const note = files.length
        ? t('Read {0} session(s) over {1} days. On the server — pull to import.', read.sessions.length, days)
        : t('Nothing new on this phone.')
      setReadNote(note)
      toast(note)
      await refresh()
    } catch (e) {
      const note = t('Could not read phone health data: {0}', e?.message || t('unknown error'))
      setReadNote(note)
      toast(note)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Section title={t('From your other data')}>
      <Row icon="download" iconTint="var(--teal)" title={t('Pull gym + Wii data')}
        subtitle={status ? statusLine(status) : t('Ask the server to fetch Technogym, Wii and waiting phone files.')}
        accessory="chevron" onClick={pull} />
      {MOBILE && droid && <Row icon="heart" iconTint="var(--red)" title={t('Read phone health data')}
        subtitle={progress
          // A 30-day read is 30 native round-trips. Without a running count the
          // button looks dead for the whole of it, which is what "nothing
          // happened" meant when the permission prompt had not even been asked.
          ? t('Reading day {0} of {1}…', progress.done, progress.total)
          // The last outcome stays on the row until the next tap, so a result
          // that arrives while the user is looking elsewhere is still there to
          // be read.
          : readNote || t('Last {0} days from Health Connect, straight to the server.', READ_DAYS_DEFAULT)}
        accessory={progress ? 'none' : 'chevron'}
        onClick={progress ? undefined : readPhone} />}
      <Row icon="share" iconTint="var(--teal)" title={t('Send phone files to server')}
        subtitle={t('Health Data Export CSVs from this device. The next pull imports them.')}
        accessory="chevron" onClick={() => upRef.current.click()} />
      <input ref={upRef} type="file" accept=".csv,.json,.xml,text/csv,application/json" multiple
        style={{ display: 'none' }} onChange={upload} />
    </Section>
  )
}
