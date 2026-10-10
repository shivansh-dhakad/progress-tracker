import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/* ---------- service worker (needed for installable app + notifications) ---------- */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return
  const secure = window.isSecureContext || location.hostname === 'localhost'
  if (!secure) return
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.warn('Service worker registration failed:', error)
  }))
}

const urlB64 = (b) => {
  const raw = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}
export const remindersOn = () => {
  try { return localStorage.getItem('reminders') === 'on' && 'Notification' in window && Notification.permission === 'granted' } catch { return false }
}
export const pushConfigured = () => !!import.meta.env.VITE_VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window

/* ask permission, then (if the server side is set up) subscribe this device to push */
export async function enableReminders() {
  if (!('Notification' in window)) throw new Error('This browser does not support notifications.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or phone settings, then try again.')
  localStorage.setItem('reminders', 'on')
  if (!pushConfigured()) return { push: false }

  const reg = await navigator.serviceWorker?.ready?.catch(() => null)
  if (!reg) {
    console.warn('Service worker is not ready; reminder push was skipped.')
    return { push: false }
  }

  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(import.meta.env.VITE_VAPID_PUBLIC_KEY) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
    { onConflict: 'endpoint' })
  if (error) throw new Error(`Could not save this device for push: ${error.message}`)
  return { push: true }
}
export async function disableReminders() {
  localStorage.setItem('reminders', 'off')
  try {
    const reg = await navigator.serviceWorker?.ready?.catch(() => null)
    const sub = await reg?.pushManager.getSubscription()
    if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
  } catch { /* nothing to clean up */ }
}

export const shiftTag = (g, it, date) => `shift-${g.id}-${date}-${it.idx}${it.from ? `-${it.from}` : ''}`
async function notify(title, body, tag) {
  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg) return reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' } })
    new Notification(title, { body, tag })
  } catch { /* ignore */ }
}

/* while the app is open: notify when a shift is about to start (the server push covers a closed app) */
export function useShiftReminders(shifts, lead, todayStr) {
  const live = useRef({}), fired = useRef(new Set())
  live.current = { shifts, lead, todayStr }
  useEffect(() => {
    const check = () => {
      if (!remindersOn()) return
      const { shifts, lead, todayStr } = live.current
      const d = new Date(), nowMin = d.getHours() * 60 + d.getMinutes()
      shifts.forEach(({ g, it }) => {
        if (it.done) return
        const [h, m] = it.s.split(':').map(Number), at = h * 60 + m - lead
        const tag = shiftTag(g, it, todayStr)
        if (nowMin >= at && nowMin < at + 2 && !fired.current.has(tag)) {
          fired.current.add(tag)
          notify(g.title, lead ? `Shift ${it.s} – ${it.e} starts in ${lead} min` : `Shift ${it.s} – ${it.e} starts now`, tag)
        }
      })
    }
    check()
    const i = setInterval(check, 20000)
    return () => clearInterval(i)
  }, [])
}

/* ---------- settings sheet: reminders + study targets ---------- */
export function SettingsPanel({ settings, onSave }) {
  const hrs = (m) => (m ? String(Math.round((m / 60) * 100) / 100) : '')
  const [daily, setDaily] = useState(hrs(settings.daily_target_minutes))
  const [weekly, setWeekly] = useState(hrs(settings.weekly_target_minutes))
  const [lead, setLead] = useState(String(settings.reminder_lead ?? 5))
  const [on, setOn] = useState(remindersOn())
  const [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  const toMin = (v) => { const n = parseFloat(v); return n > 0 ? Math.round(n * 60) : null }

  const saveTargets = async () => {
    setErr(''); setMsg('')
    const e = await onSave({ daily_target_minutes: toMin(daily), weekly_target_minutes: toMin(weekly), reminder_lead: Math.max(0, Math.min(120, Number(lead) || 0)) })
    if (e) setErr(e); else setMsg('Saved.')
  }
  const toggle = async () => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      if (on) { await disableReminders(); setOn(false); setMsg('Reminders are off on this device.') }
      else {
        const r = await enableReminders(); setOn(true)
        setMsg(r.push ? 'Reminders are on. You will get a nudge even when the app is closed.' : 'Reminders are on while the app is open. Closed-app reminders need the push setup in REMINDERS_SETUP.md.')
      }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <div className="form">
      <section className="edit-sec">
        <h3>Study targets</h3>
        <div className="grid4">
          <label>Hours per day<input type="number" min="0" step="0.25" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="e.g. 4" /></label>
          <label>Hours per week<input type="number" min="0" step="0.5" value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="e.g. 24" /></label>
        </div>
        <p className="muted small">Leave a box empty for no target. Progress shows on the dashboard next to the timer.</p>
      </section>
      <section className="edit-sec">
        <h3>Shift reminders</h3>
        <label>Remind me this many minutes before a shift
          <input type="number" min="0" max="120" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
        <button type="button" className="ghost" disabled={busy || perm === 'unsupported'} onClick={toggle}>{on ? 'Turn reminders off on this device' : 'Turn reminders on for this device'}</button>
        {perm === 'unsupported' && <p className="muted small">This browser cannot show notifications. On iPhone, add Streakbook to your Home Screen first (iOS 16.4 or later), then open it from there.</p>}
        {perm === 'denied' && <p className="muted small">Notifications are blocked for this site. Allow them in your browser or phone settings.</p>}
        <p className="muted small">Reminders are per device. The study timer is also saved on this device only, so a timer started on your laptop will not show on your phone.</p>
      </section>
      {err && <p className="msg" role="alert">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
      <button type="button" className="primary" onClick={saveTargets}>Save targets and lead time</button>
    </div>
  )
}