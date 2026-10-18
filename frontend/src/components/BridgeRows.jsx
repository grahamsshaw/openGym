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
  const readPhone = async () => {
    if (busy) return
    setBusy(true)
    setProgress(null)
    try {
      const hc = await readPlugin()
      if (!hc) {
        toast(t('Needs the personal app build with Health Connect read.'))
        return
      }
      if (!(await ensureReadPermissions(hc))) {
        toast(t('Allow reading in Health Connect, then try again.'))
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
      toast(files.length
        ? t('{0} sessions from the last {1} days, on the server. Now pull to import.',
          read.sessions.length, READ_DAYS_DEFAULT)
        : t('Nothing new on this phone.'))
      await refresh()
    } catch (e) {
      toast(e?.code === 'permission' || /permission/i.test(e?.message || '')
        ? t('Allow reading in Health Connect, then try again.')
        // The old text swallowed the reason entirely, so a real failure was
        // indistinguishable from a button that did nothing.
        : t('Could not read phone health data: {0}', e?.message || t('unknown error')))
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
          : t('Last {0} days from Health Connect, straight to the server.', READ_DAYS_DEFAULT)}
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
