import { useEffect, useRef, useState } from 'react'
import './plan.css'

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const dow = (d) => (d.getDay() + 6) % 7
const hm = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m` }
const clock = (s) => [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':')
const niceDate = (s) => parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const formatTime = (t) => {
  const [hour, minute] = t.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5)
const Tick = () => <svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.8 3.8 7.2-8.3" /></svg>

function TimeField({ value, label, onChange }) {
  const [rawHour, rawMinute] = (value || '00:00').split(':').map(Number)
  const hour = rawHour % 12 || 12
  const period = rawHour < 12 ? 'AM' : 'PM'
  const update = (nextHour, nextMinute, nextPeriod) => {
    const hour24 = (nextHour % 12) + (nextPeriod === 'PM' ? 12 : 0)
    onChange(`${String(hour24).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`)
  }
  return (
    <div className="time-field" role="group" aria-label={label}>
      <select aria-label={`${label} hour`} value={hour} onChange={(e) => update(Number(e.target.value), rawMinute, period)}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span>:</span>
      <select aria-label={`${label} minute`} value={rawMinute} onChange={(e) => update(hour, Number(e.target.value), period)}>
        {Array.from({ length: 60 }, (_, m) => m).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select aria-label={`${label} AM or PM`} value={period} onChange={(e) => update(hour, rawMinute, e.target.value)}>
        <option>AM</option>
        <option>PM</option>
      </select>
    </div>
  )
}

export const shiftInfo = (sl = []) => {
  const arr = Array.isArray(sl) ? sl : []
  return {
    s: arr[0] || '',
    e: arr[1] || '',
    removed: !!arr[2],
    topic: typeof arr[3] === 'string' ? arr[3].trim() : '',
    note: typeof arr[4] === 'string' ? arr[4].trim() : '',
  }
}

export const shiftMinutes = (s, e) => Math.max(0, toMin(e) - toMin(s))
/* a timestamp from the database -> the user's local calendar day (slice(0,10) would give the UTC day) */
export const localDate = (iso) => (iso ? fmt(new Date(iso)) : null)
/* paused_ranges: [[from, to], ...] inclusive; to = null means "until I resume" */
export const pausedOn = (g, date) => (g.paused_ranges || []).some(([a, b]) => date >= a && (!b || date <= b))

/* ---------- plan maths: every day of the plan, every shift, done / missed / skipped / moved ----------
   A shift in g.schedule is [start, end] (a 3rd item of 1 = removed, kept so history indexes stay stable).
   slot_completions rows: status 'done' | 'skipped' | 'moved' (moved_to = new day, moved_done = finished there). */
export function planInfo(g, slots, todayStr) {
  const start = g.start_date || localDate(g.created_at) || todayStr
  const n = g.plan_days || 30
  const sched = g.schedule || {}
  const rows = new Map(slots.filter((s) => s.goal_id === g.id).map((s) => [`${s.done_on}:${s.slot_idx}`, s]))
  const movedIn = {}
  rows.forEach((r) => {
    if (r.status !== 'moved' || !r.moved_to) return
    const sl = (sched[dow(parse(r.done_on))] || [])[r.slot_idx]
    if (sl && !sl[2]) {
      const meta = shiftInfo(sl)
      ;(movedIn[r.moved_to] ||= []).push({ idx: r.slot_idx, s: meta.s, e: meta.e, topic: meta.topic, savedNote: r.note || '', from: r.done_on, movedIn: true, st: r.moved_done ? 'done' : 'pending', done: !!r.moved_done })
    }
  })
  let totalAll = 0, doneAll = 0, missed = 0, skipped = 0, maxItems = 1
  const days = Array.from({ length: n }, (_, i) => {
    const date = fmt(addDays(parse(start), i))
    const own = (sched[dow(parse(date))] || []).map((sl, idx) => ({ sl, idx })).filter((x) => !x.sl[2]).map(({ sl, idx }) => {
      const r = rows.get(`${date}:${idx}`), st = r ? r.status : 'pending', meta = shiftInfo(sl)
      return { idx, s: meta.s, e: meta.e, topic: meta.topic, st, done: st === 'done', movedTo: r?.moved_to || null, savedNote: r?.note || '' }
    })
    const inn = movedIn[date] || []
    const paused = pausedOn(g, date) && !inn.length
    const items = paused ? [] : [...own, ...inn].sort((a, b) => a.s.localeCompare(b.s))
    const due = items.filter((x) => x.movedIn || x.st === 'pending' || x.st === 'done' || x.st === 'missed')
    const nd = due.filter((x) => x.done).length
    totalAll += due.length; doneAll += nd
    missed += due.filter((x) => !x.done && (date < todayStr || x.st === 'missed')).length
    skipped += items.filter((x) => !x.movedIn && (x.st === 'skipped' || x.st === 'moved')).length
    maxItems = Math.max(maxItems, items.length)
    const state = paused ? 'paused' : !items.length ? 'rest' : !due.length ? 'skip' : date > todayStr ? 'future' : nd === due.length ? 'hit'
      : date === todayStr ? 'pending' : nd ? 'partial' : 'miss'
    return { date, items, state, due: due.length, nd }
  })
  return {
    start, end: days[n - 1].date, n, days, totalAll, doneAll, missed, skipped, maxItems, left: totalAll - doneAll - missed,
    todayIdx: days.findIndex((d) => d.date === todayStr),
    finished: totalAll > 0 && doneAll === totalAll,
  }
}

/* the shifts that are still due on a given day across live plans: [{ g, it }] */
export function shiftsOn(live, slots, date) {
  return live.filter((g) => g.period === 'plan').flatMap((g) => {
    const day = planInfo(g, slots, date).days.find((d) => d.date === date)
    return (day?.items || []).filter((x) => x.movedIn || x.st === 'pending' || x.st === 'done' || x.st === 'missed').map((it) => ({ g, it }))
  })
}
export const todayShifts = (live, slots, todayStr) => shiftsOn(live, slots, todayStr)
/* plans that have a free day today */
export function freeToday(live, slots, todayStr) {
  return live.filter((g) => g.period === 'plan').filter((g) => {
    const day = planInfo(g, slots, todayStr).days.find((d) => d.date === todayStr)
    return day && day.state === 'rest'
  })
}
/* plans that are paused today */
export function pausedToday(live, slots, todayStr) {
  return live.filter((g) => g.period === 'plan').filter((g) => planInfo(g, slots, todayStr).days.find((d) => d.date === todayStr)?.state === 'paused')
}
export const studiedOn = (times, goalId, date, idx) =>
  (times || []).filter((t) => t.goal_id === goalId && t.slot_idx === idx && t.log_date === date).reduce((a, t) => a + t.seconds, 0)

/* ---------- one shift row, used on the dashboard and inside a plan ---------- */
export function ShiftRow({ g, it, date, todayStr, nowHm, times, act, maxDate, showTitle }) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [note, setNote] = useState(it.savedNote || '')
  const off = it.st === 'skipped' || it.st === 'moved'
  const studied = studiedOn(times, g.id, date, it.idx), planned = shiftMinutes(it.s, it.e) * 60
  const [txt, cls] = it.st === 'skipped' ? ['Skipped on purpose', 'skip']
    : it.st === 'moved' ? [`Moved to ${niceDate(it.movedTo)}`, 'skip']
    : it.st === 'missed' ? ['Marked missed', 'bad']
    : it.done ? ['Completed', 'ok']
    : date < todayStr ? ['Missed', 'bad']
    : date > todayStr ? ['Upcoming', '']
    : nowHm > it.e ? ['Time passed', 'bad'] : nowHm >= it.s ? ['Now', 'now'] : ['Later today', '']
  const min = date >= todayStr ? fmt(addDays(parse(date), 1)) : todayStr
  const close = () => { setOpen(false); setTo('') }
  const label = `${g.title}, ${formatTime(it.s)} to ${formatTime(it.e)}`
  useEffect(() => { setNote(it.savedNote || '') }, [it.savedNote])
  return (
    <li className={`goal-item ${it.done ? 'completed' : ''} ${off ? 'off' : ''}`}>
      <button className="check" aria-pressed={it.done} disabled={date > todayStr || it.st === 'moved' || it.st === 'missed'}
        aria-label={`${it.done ? 'Undo completion' : 'Mark complete'} ${label}`} onClick={() => act.toggle(g, it, date)}><Tick /></button>
      <div className="grow">
        <span className="gt">{showTitle ? g.title : `${formatTime(it.s)} – ${formatTime(it.e)}`}</span>
        <span className="meta">
          {showTitle && <em className="due">{formatTime(it.s)} – {formatTime(it.e)}</em>}
          <em className={`slot-st ${cls}`}>{txt}</em>
          {it.topic && <em className="tag">{it.topic}</em>}
          {it.movedIn && <em className="due">from {niceDate(it.from)}</em>}
          {showTitle && g.tag && <em className="tag">{g.tag}</em>}
        </span>
        {it.done && it.savedNote && <span className="studied">{it.savedNote}</span>}
        {studied > 0 && <span className="studied"><span className="prog-line"><i style={{ width: `${Math.min(100, (studied / planned) * 100)}%` }} /></span>{hm(studied)} of {hm(planned)} studied</span>}
        {open && (
          <div className="shift-menu">
            {it.st === 'skipped' && <button className="ghost" onClick={() => { act.restore(g, it, date); close() }}>Undo skip</button>}
            {it.st === 'moved' && <button className="ghost" onClick={() => { act.restore(g, it, date); close() }}>Cancel move</button>}
            {it.st === 'pending' && <>
              {it.movedIn
                ? <button className="ghost" onClick={() => { act.restore(g, it, date); close() }}>Move back to {niceDate(it.from)}</button>
                : <div className="move-row">
                    <input type="date" value={to} min={min} max={maxDate} aria-label="Move to day" onChange={(e) => setTo(e.target.value)} />
                    <button className="ghost" disabled={!to || to < min || (maxDate && to > maxDate)} onClick={() => { act.move(g, it, date, to); close() }}>Move to this day</button>
                  </div>}
              <button className="ghost" onClick={() => { act.skip(g, it, date); close() }}>Skip on purpose</button>
              {!it.movedIn && date <= todayStr && <button className="ghost" onClick={() => { act.miss(g, it, date); close() }}>Mark as missed</button>}
            </>}
            {it.done && act.saveNote && (
              <div className="note-box">
                <label className="lbl">What did you do here?<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Revised LSTM, RNN and GRU" /></label>
                <button className="ghost" onClick={() => { act.saveNote(g, it.movedIn ? it.from : date, it.idx, note); close() }}>Save what I learned</button>
              </div>
            )}
          </div>
        )}
      </div>
      {!it.done && it.st !== 'missed' && <button className="ghost dots-btn" aria-expanded={open} aria-label="Shift options" onClick={() => setOpen(!open)}>⋯</button>}
    </li>
  )
}

/* ---------- dashboard: collapsed list of plans (details + all days) ---------- */
export function PlanToday({ live, slots, times, todayStr, nowHm, act, onEdit, onRemove }) {
  const plans = live.filter((g) => g.period === 'plan')
  if (!plans.length) return null
  return (
    <section className="panel plans-box">
      <h2>Your study plans <small>tap one to see every day</small></h2>
      {plans.map((g) => {
        const i = planInfo(g, slots, todayStr)
        const paused = i.days.find((d) => d.date === todayStr)?.state === 'paused'
        return (
          <details className="plan-line" key={g.id}>
            <summary>
              <span className="gt">{g.title}{paused && <em className="slot-st now pause-tag">Paused</em>}</span>
              <span className="muted small">
                {i.todayIdx >= 0 ? `Day ${i.todayIdx + 1} of ${i.n}` : todayStr < i.start ? `Starts ${niceDate(i.start)}` : 'Ended'} · {i.doneAll}/{i.totalAll} shifts{i.missed ? ` · ${i.missed} missed` : ''}
              </span>
            </summary>
            <PlanCard g={g} slots={slots} times={times} todayStr={todayStr} nowHm={nowHm} act={act} onEdit={onEdit} onRemove={onRemove} />
          </details>
        )
      })}
    </section>
  )
}

function PlanCard({ g, slots, times, todayStr, nowHm, act, onEdit, onRemove }) {
  const info = planInfo(g, slots, todayStr)
  const [sel, setSel] = useState(null)
  const shown = sel || (info.todayIdx >= 0 ? todayStr : null)
  const day = info.days.find((d) => d.date === shown)
  const pct = info.totalAll ? Math.round((info.doneAll / info.totalAll) * 100) : 0
  const names = { hit: 'all done', partial: 'partly done', miss: 'missed', rest: 'free day', pending: 'today', future: 'upcoming', paused: 'paused', skip: 'skipped on purpose' }
  return (
    <div className="plan-card inner">
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <p className="plan-sum"><b>{info.doneAll}</b> done · <b className="bad">{info.missed}</b> missed · <b>{info.left}</b> to go{info.skipped ? <> · <b>{info.skipped}</b> skipped or moved</> : null}</p>
      {day ? <>
        <h3 className="plan-day">{day.date === todayStr ? 'Today' : niceDate(day.date)}
          {day.date !== todayStr && <button className="link" onClick={() => setSel(null)}>Back to today</button>}</h3>
        {day.state === 'paused' ? <p className="muted">⏸ Plan paused. No shifts are due and your streak is safe.</p>
          : !day.items.length ? <p className="muted">🌿 Free day. Nothing to do. (Up to 2 free days a month keep your streak.)</p> : (
          <ul className="plain">
            {day.items.map((it) => <ShiftRow key={`${it.from || ''}${it.idx}`} g={g} it={it} date={day.date} todayStr={todayStr} nowHm={nowHm} times={times} act={act} maxDate={info.end} />)}
          </ul>
        )}
      </> : <p className="muted">{todayStr < info.start ? 'Your first shift is on the start date.' : 'This plan has finished. Tap any day below to review it, or edit the plan to extend it.'}</p>}
      <div className="plan-strip" role="list" aria-label="All days of the plan">
        {info.days.map((d, i) => (
          <button key={d.date} role="listitem" className={`pc ${d.state} ${d.date === shown ? 'sel' : ''} ${d.date === todayStr ? 'now' : ''}`}
            title={`${niceDate(d.date)}: ${names[d.state]}`} onClick={() => setSel(d.date)}>{i + 1}</button>
        ))}
      </div>
      <p className="legend muted"><i className="pc hit" />All done<i className="pc partial" />Some<i className="pc miss" />Missed<i className="pc skip" />Skipped<i className="pc rest" />Free<i className="pc paused" />Paused<i className="pc pending" />Today</p>
      <button className="ghost edit-plan" onClick={() => onEdit(g)}>Edit, extend or pause this plan</button>
      <button className="ghost delete-plan" onClick={() => onRemove(g)}>Delete this study plan</button>
    </div>
  )
}

/* ---------- create a study plan: 3 short steps ---------- */
const SHIFTS = [['09:00', '10:00'], ['19:00', '21:00']]
const preset = (free) => Array.from({ length: 7 }, (_, i) => (free.includes(i) ? [] : SHIFTS.map((x) => [...x])))
const PRESETS = [['Mon–Sat, Sunday free', [6]], ['Mon–Fri, weekend free', [5, 6]], ['Every day', []]]
const sum = (d) => (d.length ? d.map((s) => `${formatTime(s[0])}–${formatTime(s[1])}`).join(', ') : 'Free day')

/* ---------- weekday shift editor, shared by the wizard and the plan editor ----------
   orig (editor only) = shifts per weekday that already exist. Those are never spliced out, only flagged as
   removed, so the history saved against each shift position stays correct. */
const liveOf = (d) => d.map((sl, j) => ({ sl, j })).filter((x) => !x.sl[2])
function ScheduleEditor({ sc, setSc, open, setOpen, orig }) {
  const upd = (d, fn) => setSc((s) => s.map((x, i) => (i === d ? fn(x) : x)))
  const removeAt = (i, j) => upd(i, (x) => (orig && j < orig[i] ? x.map((sl, k) => (k === j ? [sl[0], sl[1], 1, sl[3] || '', sl[4] || ''] : sl)) : x.filter((_, k) => k !== j)))
  const clearDay = (i) => upd(i, (x) => (orig ? x.map((sl, k) => (k < orig[i] ? [sl[0], sl[1], 1, sl[3] || '', sl[4] || ''] : sl)).filter((sl, k) => k < orig[i]) : []))
  const setTime = (i, j, which, v) => upd(i, (x) => x.map((sl, k) => (k === j ? (which === 0 ? [v, sl[1] || '00:00', sl[2] || false, sl[3] || '', sl[4] || ''] : [sl[0] || '00:00', v, sl[2] || false, sl[3] || '', sl[4] || '']) : sl)))
  const setTopic = (i, j, v) => upd(i, (x) => x.map((sl, k) => (k === j ? [sl[0] || '00:00', sl[1] || '00:00', sl[2] || false, v, sl[4] || ''] : sl)))
  return (
    <div className="sched">
      {sc.map((d, i) => {
        const live = liveOf(d)
        return (
          <div className="sched-row" key={i}>
            <div className="sday">
              <div><b>{FULL[i]}</b><span className="muted small block">{sum(live.map((x) => x.sl))}</span></div>
              <button type="button" className="ghost" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Done' : 'Edit'}</button>
            </div>
            {open === i && <>
              {live.map(({ sl, j }) => (
                <div className="sched-slot" key={j}>
                  <div className="shift-time-wrap">
                    <TimeField value={sl[0]} label="Start time" onChange={(v) => setTime(i, j, 0, v)} />
                    <span>to</span>
                    <TimeField value={sl[1]} label="End time" onChange={(v) => setTime(i, j, 1, v)} />
                  </div>
                  <div className="shift-meta-wrap">
                    <label className="shift-field">
                      <span>Topic</span>
                      <input type="text" value={sl[3] || ''} aria-label="Topic" placeholder="Revision / Self-attention" onChange={(e) => setTopic(i, j, e.target.value)} />
                    </label>
                  </div>
                  <button type="button" className="x" aria-label="Remove shift" onClick={() => removeAt(i, j)}>×</button>
                </div>
              ))}
              <div className="sched-acts">
                <button type="button" className="ghost" onClick={() => upd(i, (x) => [...x, ['09:00', '10:00', false, '', '']])}>+ Add shift</button>
                {live.length > 0 && <button type="button" className="ghost" onClick={() => clearDay(i)}>Make free day</button>}
                {!orig && i === 0 && <button type="button" className="ghost" onClick={() => setSc((s) => s.map((x, k) => (k > 0 && k < 5 ? s[0].map((a) => [...a]) : x)))}>Copy to Tue–Fri</button>}
              </div>
            </>}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- edit a running plan: name, length, shift times, pauses ---------- */
export function PlanEditor({ g, tags, todayStr, onSave }) {
  const orig = Array.from({ length: 7 }, (_, i) => ((g.schedule || {})[i] || []).length)
  const start = g.start_date || localDate(g.created_at) || todayStr
  const len0 = g.plan_days || 30
  const [f, setF] = useState({ title: g.title, tag: g.tag || '', days: String(len0), end: fmt(addDays(parse(start), len0 - 1)) })
  const [sc, setSc] = useState(() => Array.from({ length: 7 }, (_, i) => ((g.schedule || {})[i] || []).map((x) => [...x])))
  const [open, setOpen] = useState(null)
  const [paused, setPaused] = useState(() => (g.paused_ranges || []).map((r) => [...r]))
  const [pf, setPf] = useState({ from: todayStr, to: '', extend: true })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const setDays = (v) => setF((x) => { const n = Number(v); return { ...x, days: v, end: n >= 1 ? fmt(addDays(parse(start), Math.min(365, n) - 1)) : x.end } })
  const setEnd = (v) => setF((x) => {
    if (!v) return { ...x, end: v }
    const n = daysBetween(start, v) + 1
    return { ...x, end: v, days: n >= 1 ? String(n) : x.days }
  })
  const yesterday = fmt(addDays(parse(todayStr), -1))
  const addPause = () => {
    if (!pf.from) return setErr('Choose the first day of the pause.')
    if (pf.to && pf.to < pf.from) return setErr('The pause cannot end before it starts.')
    setErr('')
    setPaused((p) => [...p, [pf.from, pf.to || null]])
    if (pf.to && pf.extend) setDays(String((Number(f.days) || len0) + daysBetween(pf.from, pf.to) + 1))
    setPf({ from: todayStr, to: '', extend: true })
  }
  const resume = (i) => setPaused((p) => p.flatMap((r, k) => (k !== i ? [r] : r[0] >= todayStr ? [] : [[r[0], yesterday]])))
  const save = async () => {
    const n = Number(f.days)
    if (!f.title.trim()) return setErr('Give your plan a name.')
    if (!(n >= 1 && n <= 365)) return setErr('The plan must be between 1 and 365 days long.')
    if (!sc.some((d) => d.some((sl) => !sl[2]))) return setErr('Keep at least one shift.')
    for (let i = 0; i < 7; i++) for (const [s, e, rm] of sc[i]) if (!rm && (!s || !e || s >= e)) { setOpen(i); return setErr(`${FULL[i]}: each shift must end after it starts.`) }
    setErr(''); setBusy(true)
    const msg = await onSave({
      title: f.title.trim(), tag: f.tag.trim() || null, plan_days: n, due_date: fmt(addDays(parse(start), n - 1)),
      schedule: Object.fromEntries(sc.map((d, i) => [i, d])), paused_ranges: paused,
    })
    setBusy(false); if (msg) setErr(msg)
  }
  return (
    <div className="form plan-editor">
      <section className="edit-sec">
        <h3>Name and length</h3>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Plan name" />
        <div className="grid4">
          <label>Number of days<input type="number" min="1" max="365" value={f.days} onChange={(e) => setDays(e.target.value)} /></label>
          <label>Ends on<input type="date" value={f.end} min={start} max={fmt(addDays(parse(start), 364))} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>Subject<input list="tags" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="ML, DSA…" /></label>
        </div>
        <datalist id="tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
        <p className="muted small">Starts {niceDate(start)} and cannot move. Raise the days or the end date to extend the plan.</p>
      </section>

      <section className="edit-sec">
        <h3>Pause</h3>
        <p className="muted small">Ill or travelling? Paused days have no shifts due and never break your streak.</p>
        {paused.length > 0 && <ul className="plain">
          {paused.map((r, i) => (
            <li key={i}><span>⏸ {niceDate(r[0])} → {r[1] ? niceDate(r[1]) : 'until you resume'}</span>
              <span className="acts">
                {r[0] <= todayStr && (!r[1] || r[1] >= todayStr) && <button type="button" className="ghost" onClick={() => resume(i)}>Resume now</button>}
                <button type="button" className="x" aria-label="Remove pause" onClick={() => setPaused((p) => p.filter((_, k) => k !== i))}>×</button></span></li>
          ))}
        </ul>}
        <div className="grid4">
          <label>Pause from<input type="date" value={pf.from} onChange={(e) => setPf({ ...pf, from: e.target.value })} /></label>
          <label>Until (optional)<input type="date" value={pf.to} min={pf.from} onChange={(e) => setPf({ ...pf, to: e.target.value })} /></label>
        </div>
        <label className="check-line"><input type="checkbox" checked={pf.extend} onChange={(e) => setPf({ ...pf, extend: e.target.checked })} /> Push the end date back by the paused days</label>
        <button type="button" className="ghost" onClick={addPause}>Add pause</button>
      </section>

      <section className="edit-sec">
        <h3>Shift times</h3>
        <p className="muted small">Changes apply to the whole plan. Removed shifts disappear from every day; completed history is kept.</p>
        <ScheduleEditor sc={sc} setSc={setSc} open={open} setOpen={setOpen} orig={orig} />
      </section>

      {err && <p className="msg" role="alert">{err}</p>}
      <button type="button" className="primary" disabled={busy} onClick={save}>Save changes</button>
    </div>
  )
}

export function PlanWizard({ tags, onAdd }) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState({ title: '', tag: '', start: fmt(new Date()), days: '30', end: fmt(addDays(new Date(), 29)) })
  const [sc, setSc] = useState(() => preset([6]))
  const [open, setOpen] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  // start, days and end stay in sync: change one and the others follow
  const setStart = (v) => setF((x) => ({ ...x, start: v, end: v && Number(x.days) >= 1 ? fmt(addDays(parse(v), Math.min(365, Number(x.days)) - 1)) : x.end }))
  const setDays = (v) => setF((x) => {
    const n = Number(v)
    return { ...x, days: v, end: x.start && n >= 1 ? fmt(addDays(parse(x.start), Math.min(365, n) - 1)) : x.end }
  })
  const setEnd = (v) => setF((x) => {
    if (!v || !x.start) return { ...x, end: v }
    const n = Math.round((parse(v) - parse(x.start)) / 864e5) + 1
    return { ...x, end: v, days: n >= 1 ? String(n) : x.days }
  })
  const n = Math.max(1, Math.min(365, Number(f.days) || 30))

  const next1 = () => {
    if (!f.title.trim()) return setErr('Give your plan a name.')
    if (!f.start || !(Number(f.days) >= 1)) return setErr('Choose a start date and the number of days.')
    setErr(''); setStep(2)
  }
  const next2 = () => {
    if (!sc.some((d) => d.length)) return setErr('Add at least one shift on one day.')
    for (let i = 0; i < 7; i++) for (const [s, e, rm] of sc[i]) if (!rm) if (!s || !e || s >= e) { setOpen(i); return setErr(`${FULL[i]}: each shift must end after it starts.`) }
    setErr(''); setStep(3)
  }
  const create = async () => {
    setBusy(true)
    const msg = await onAdd({
      title: f.title.trim(), period: 'plan', tag: f.tag.trim() || null,
      start_date: f.start, plan_days: n, due_date: fmt(addDays(parse(f.start), n - 1)),
      schedule: Object.fromEntries(sc.map((d, i) => [i, d])),
    })
    setBusy(false); if (msg) setErr(msg)
  }

  return (
    <div className="form wizard">
      <div className="dots" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      <p className="muted small">Step {step} of 3 · {['What and when', 'Daily shifts', 'Review'][step - 1]}</p>

      {step === 1 && <>
        <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Complete the Transformer book" autoFocus />
        <div className="grid4">
          <label>Starts on<input type="date" value={f.start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Number of days<input type="number" min="1" max="365" value={f.days} onChange={(e) => setDays(e.target.value)} /></label>
          <label>Ends on<input type="date" value={f.end} min={f.start} max={f.start ? fmt(addDays(parse(f.start), 364)) : undefined} onChange={(e) => setEnd(e.target.value)} /></label>
          <label>Subject (optional)<input list="tags" value={f.tag} onChange={(e) => set('tag', e.target.value)} placeholder="ML, DSA…" /></label>
        </div>
        <datalist id="tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
        <p className="muted small">Change the number of days or the end date, the other one updates.</p>
      </>}

      {step === 2 && <>
        <p className="muted small">Pick a starting point, then change any day you like.</p>
        <div className="presets">
          {PRESETS.map(([label, free]) => <button type="button" className="ghost" key={label} onClick={() => { setSc(preset(free)); setOpen(null) }}>{label}</button>)}
        </div>
        <ScheduleEditor sc={sc} setSc={setSc} open={open} setOpen={setOpen} />
      </>}

      {step === 3 && (() => {
        const per = Array.from({ length: n }, (_, i) => sc[dow(addDays(parse(f.start), i))].length)
        return <>
          <div className="review">
            <div><span>Plan</span><b>{f.title}</b></div>
            <div><span>Dates</span><b>{niceDate(f.start)} → {niceDate(fmt(addDays(parse(f.start), n - 1)))}</b></div>
            <div><span>Length</span><b>{n} days</b></div>
            <div><span>Total shifts</span><b>{per.reduce((a, b) => a + b, 0)}</b></div>
            <div><span>Free days</span><b>{per.filter((x) => !x).length}</b></div>
          </div>
          <p className="muted small">Each day you just tick your shifts as done. A shift you skip shows as missed. Up to 2 free days a month keep your streak.</p>
        </>
      })()}

      {err && <p className="msg" role="alert">{err}</p>}
      <div className="wiz-nav">
        {step > 1 ? <button type="button" className="ghost" onClick={() => { setErr(''); setStep(step - 1) }}>Back</button> : <span />}
        {step === 1 && <button type="button" className="primary" onClick={next1}>Next</button>}
        {step === 2 && <button type="button" className="primary" onClick={next2}>Next</button>}
        {step === 3 && <button type="button" className="primary" disabled={busy} onClick={create}>Start plan</button>}
      </div>
    </div>
  )
}

/* ---------- insights: study plan table (rows = dates, columns = shifts) ---------- */
export function PlanProgress({ goals, slots, todayStr }) {
  const plans = goals.filter((g) => g.period === 'plan')
  const [id, setId] = useState(null)
  const g = plans.find((x) => x.id === id) || plans.find((x) => !x.archived) || plans[0]
  const box = useRef(null)
  useEffect(() => {
    const el = box.current, row = el?.querySelector('tr.today')
    if (el && row) el.scrollTop = Math.max(0, row.offsetTop - el.querySelector('thead').offsetHeight - 48)
  }, [g?.id])
  if (!plans.length) return <section className="panel"><h2>Study plan progress</h2><p className="muted">No study plan yet. Use “+ New” at the top to create one, and its day-by-day table will appear here.</p></section>
  const info = planInfo(g, slots, todayStr)
  const cols = info.maxItems
  const due = info.doneAll + info.missed
  return (
    <section className="panel">
      <h2>Study plan progress
        {plans.length > 1 && <select className="plan-pick" value={g.id} onChange={(e) => setId(e.target.value)} aria-label="Choose plan">
          {plans.map((x) => <option key={x.id} value={x.id}>{x.title}{x.archived ? ' (archived)' : ''}</option>)}</select>}
      </h2>
      <p className="plan-sum"><b>{g.title}</b> · {niceDate(info.start)} → {niceDate(info.end)}</p>
      <div className="stats">
        <div><b>{info.doneAll}</b><span>done</span></div>
        <div><b className="bad">{info.missed}</b><span>missed</span></div>
        <div><b>{info.left}</b><span>to go</span></div>
        <div><b>{info.skipped}</b><span>skipped or moved</span></div>
        <div><b>{due ? Math.round((info.doneAll / due) * 100) : 0}%</b><span>on track</span></div>
      </div>
      <div className="ptable-wrap" ref={box}>
        <table className="ptable">
          <thead><tr><th>Date</th>{Array.from({ length: cols }, (_, i) => <th key={i}>Shift {i + 1}</th>)}<th>Day</th></tr></thead>
          <tbody>
            {info.days.map((d) => {
              const past = d.date < todayStr
              return (
                <tr key={d.date} className={d.date === todayStr ? 'today' : ''}>
                  <th scope="row">{niceDate(d.date)}</th>
                  {Array.from({ length: cols }, (_, i) => {
                    if (!d.items.length) return <td key={i} className="c rest" title={d.state === 'paused' ? 'Plan paused' : 'Free day'}><span>–</span></td>
                    const it = d.items[i]
                    if (!it) return <td key={i} className="c none" />
                    const [sym, cls] = it.st === 'skipped' ? ['⊘', 'skip'] : it.st === 'moved' ? ['↷', 'skip'] : it.st === 'missed' || past ? ['✗', 'bad'] : it.done ? ['✓', 'ok'] : ['·', 'wait']
                    const note = it.st === 'skipped' ? ' · skipped on purpose' : it.st === 'moved' ? ` · moved to ${niceDate(it.movedTo)}` : it.movedIn ? ` · moved from ${niceDate(it.from)}` : ''
                    return <td key={i} className={`c ${cls}`} title={`${formatTime(it.s)} – ${formatTime(it.e)}${note}`}><span>{sym}</span><small>{formatTime(it.s)}–{formatTime(it.e)}</small></td>
                  })}
                  <td className={`c day ${!d.items.length ? 'rest' : ''}`}>{d.state === 'paused' ? 'Paused' : !d.items.length ? 'Free' : !d.due ? 'Off' : `${d.nd}/${d.due}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="legend muted"><span className="lg ok">✓</span>Done<span className="lg bad">✗</span>Missed<span className="lg skip">⊘</span>Skipped<span className="lg skip">↷</span>Moved<span className="lg">–</span>Free or paused<span className="lg wait">·</span>Not yet</p>
    </section>
  )
}

/* ---------- insights: study time per day, slide between weeks (all sessions added) ---------- */
export function StudyWeek({ today, todayStr, ftimes, timer, elapsed }) {
  const [off, setOff] = useState(0)
  const touchX = useRef(null)
  const ws = addDays(today, -dow(today) + 7 * off), we = addDays(ws, 6)
  const short = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), date = fmt(d)
    const rows = ftimes.filter((t) => t.log_date === date)
    let secs = rows.reduce((a, t) => a + t.seconds, 0)
    if (timer && timer.logDate === date) secs += elapsed
    return { l: DAYS[i], n: d.getDate(), date, secs }
  })
  const max = Math.max(1, ...week.map((d) => d.secs)), total = week.reduce((a, d) => a + d.secs, 0)
  const prev = () => setOff((o) => o - 1), next = () => setOff((o) => Math.min(0, o + 1))
  const onEnd = (e) => {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (dx > 50) prev(); else if (dx < -50) next()
  }
  return (
    <section className="panel">
      <h2>Study time <small>{hm(total)} total</small></h2>
      <div className="weeknav">
        <button className="ghost" aria-label="Previous week" onClick={prev}>←</button>
        <div><b>{off === 0 ? 'This week' : off === -1 ? 'Last week' : `${-off} weeks ago`}</b><span className="muted small block">{short(ws)} – {short(we)}</span></div>
        <button className="ghost" aria-label="Next week" disabled={off >= 0} onClick={next}>→</button>
      </div>
      <div className="bars dated" onTouchStart={(e) => { touchX.current = e.touches[0].clientX }} onTouchEnd={onEnd}>
        {week.map((d) => <div key={d.date} className={d.date === todayStr ? 'now' : ''}><b>{d.secs ? hm(d.secs) : '–'}</b>
          <div className="col"><i style={{ height: `${(d.secs / max) * 100}%`, opacity: d.secs ? 1 : 0 }} /></div><small>{d.l}<br />{d.n}</small></div>)}
      </div>
      <p className="muted small">Swipe or use the arrows to see other weeks. All sessions on the same day are added together.</p>
    </section>
  )
}

/* ---------- full-screen, distraction-free timer ---------- */
export function FocusOverlay({ open, timer, elapsed, todaySecs, error, shiftNow, onPause, onResume, onStop, onMinimize }) {
  if (!open || !timer) return null
  const running = !!timer.startedAt
  return (
    <div className={`focus ${running ? 'run' : 'paused'}`} role="dialog" aria-modal="true" aria-label="Study timer">
      <p className="focus-state">{running ? 'Studying' : 'Paused'}</p>
      <time className="focus-clock">{clock(elapsed)}</time>
      {shiftNow && <p className="focus-today">Shift now: <b>{formatTime(shiftNow.it.s)} – {formatTime(shiftNow.it.e)}</b> <span>{shiftNow.g.title}</span></p>}
      <p className="focus-today">Today so far: <b>{hm(todaySecs)}</b> <span>(all sessions added together)</span></p>
      <div className="focus-btns">
        {running ? <button className="focus-main" onClick={onPause}>Pause</button> : <button className="focus-main" onClick={onResume}>Resume</button>}
        <button className="focus-stop" onClick={onStop}>Stop &amp; save</button>
      </div>
      {error && <p className="focus-err" role="alert">{error}</p>}
      <button className="focus-min" onClick={onMinimize}>Hide this screen (timer keeps running)</button>
    </div>
  )
}