// PERSONAL-BRIDGE: server pull trigger + phone-file inbox upload.
//
// Two rows for Settings → Data ("Bring data in" area):
// - "Pull gym + Wii data": POSTs /api/bridge/pull, then shows the queue
//   state from /api/bridge/status (runner present? pending? last result?).
// - "Send phone files to server": picks Health Data Export CSVs (or any
//   .csv/.json/.xml) and POSTs each to /api/bridge/inbox, where the pull
//   chain consumes them. Works wherever the app runs — browser, PWA, or
//   the paired phone app — because lib/api.js carries the session both ways.
import { useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
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
  const upRef = useRef(null)

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

  return (
    <Section title={t('From your other data')}>
      <Row icon="download" iconTint="var(--teal)" title={t('Pull gym + Wii data')}
        subtitle={status ? statusLine(status) : t('Ask the server to fetch Technogym, Wii and waiting phone files.')}
        accessory="chevron" onClick={pull} />
      <Row icon="share" iconTint="var(--teal)" title={t('Send phone files to server')}
        subtitle={t('Health Data Export CSVs from this device. The next pull imports them.')}
        accessory="chevron" onClick={() => upRef.current.click()} />
      <input ref={upRef} type="file" accept=".csv,.json,.xml,text/csv,application/json" multiple
        style={{ display: 'none' }} onChange={upload} />
    </Section>
  )
}
