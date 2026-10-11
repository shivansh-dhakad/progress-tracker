import { useState } from 'react'
import { PlanWizard, PlanEditor } from './plans.jsx'
import Icon from './icons.jsx'

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addMonths = (d, n) => {
  const day = d.getDate(), r = new Date(d.getFullYear(), d.getMonth() + n, 1)
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()))
  return r
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/* One "+ New" sheet: choose what to add, then a short form for it. */
export function NewSheet({ view, setView, tags, onAdd, manage, editGoal, onEdit, todayStr, settings }) {
  if (!view) return null
  const close = () => setView(null)
  const titles = { choose: 'What do you want to add?', plan: 'New study plan', habit: 'New habit', deadline: 'New deadline', manage: 'Manage goals', edit: 'Edit plan', settings: 'Reminders & targets' }
  const add = async (row) => { const err = await onAdd(row); if (!err) close(); return err }
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={titles[view]}>
        <header className="sheet-head">
          {view !== 'choose' && view !== 'manage' && view !== 'edit' && view !== 'settings' ? <button className="link" onClick={() => setView('choose')}>← Back</button> : <span />}
          <strong>{titles[view]}</strong>
          <button className="x" aria-label="Close" onClick={close}>×</button>
        </header>
        {view === 'choose' && (
          <div className="stack">
            <button className="choice" onClick={() => setView('plan')}><span className="choice-ic"><Icon name="book" /></span><b>Study plan</b><span>Fixed time shifts for a number of days. Example: finish a book in 30 days, 2 shifts a day.</span></button>
            <button className="choice" onClick={() => setView('habit')}><span className="choice-ic"><Icon name="repeat" /></span><b>Habit</b><span>A simple task you repeat every day, week or month.</span></button>
            <button className="choice" onClick={() => setView('deadline')}><span className="choice-ic"><Icon name="target" /></span><b>One-time deadline</b><span>Something to finish by a date. Tick it once when done.</span></button>
            <button className="link" onClick={() => setView('manage')}>Manage or archive existing goals</button>
            <button className="link" onClick={() => setView('settings')}>Reminders and study targets</button>
          </div>
        )}
        {view === 'plan' && <PlanWizard tags={tags} onAdd={add} />}
        {view === 'habit' && <HabitForm tags={tags} onAdd={add} />}
        {view === 'deadline' && <DeadlineForm tags={tags} onAdd={add} />}
        {view === 'manage' && manage}
        {view === 'settings' && settings}
        {view === 'edit' && editGoal && <PlanEditor key={editGoal.id} g={editGoal} tags={tags} todayStr={todayStr}
          onSave={async (patch) => { const err = await onEdit(editGoal.id, patch); if (!err) close(); return err }} />}
      </div>
    </div>
  )
}

function HabitForm({ tags, onAdd }) {
  const [f, setF] = useState({ title: '', period: 'daily', tag: '', target: '', days: [] })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const submit = async (e) => {
    e.preventDefault()
    if (!f.title.trim()) return
    setBusy(true)
    const msg = await onAdd({
      title: f.title.trim(), period: f.period, tag: f.tag.trim() || null,
      target: f.target ? +f.target : null, due_date: null, duration_months: null,
      days: f.period === 'daily' && f.days.length ? f.days : null,
    })
    setBusy(false); if (msg) setErr(msg)
  }
  return (
    <form className="form" onSubmit={submit}>
      <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Solve 3 DSA problems" required autoFocus />
      <div className="seg" role="group" aria-label="How often">
        {[['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']].map(([k, l]) =>
          <button type="button" key={k} className={f.period === k ? 'on' : ''} onClick={() => set('period', k)}>{l}</button>)}
      </div>
      <details className="more">
        <summary>More options</summary>
        <div className="form">
          {f.period === 'daily' && <div className="dayrow"><span className="muted">Only on these days (none selected = every day)</span>
            {DAYS.map((d, i) => <button type="button" key={d} className={f.days.includes(i) ? 'on' : ''}
              onClick={() => set('days', f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i])}>{d}</button>)}</div>}
          <label className="lbl">Subject<input list="tags" value={f.tag} onChange={(e) => set('tag', e.target.value)} placeholder="DSA, React…" /></label>
          <datalist id="tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
          <label className="lbl">Total target (optional)<input type="number" min="1" value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="e.g. 40 lectures" /></label>
        </div>
      </details>
      {err && <p className="msg" role="alert">{err}</p>}
      <button className="primary" disabled={busy}>Add habit</button>
    </form>
  )
}

function DeadlineForm({ tags, onAdd }) {
  const [f, setF] = useState({ title: '', mode: 'date', due: '', months: '1', tag: '' })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const submit = async (e) => {
    e.preventDefault()
    if (!f.title.trim()) return
    const months = f.mode === 'duration' ? Math.max(1, Number(f.months)) : null
    setBusy(true)
    const msg = await onAdd({
      title: f.title.trim(), period: 'project', tag: f.tag.trim() || null, target: null, days: null,
      due_date: months ? fmt(addMonths(new Date(), months)) : f.due || null, duration_months: months,
    })
    setBusy(false); if (msg) setErr(msg)
  }
  return (
    <form className="form" onSubmit={submit}>
      <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Submit the hackathon project" required autoFocus />
      <div className="seg" role="group" aria-label="Deadline type">
        <button type="button" className={f.mode === 'date' ? 'on' : ''} onClick={() => set('mode', 'date')}>Pick a date</button>
        <button type="button" className={f.mode === 'duration' ? 'on' : ''} onClick={() => set('mode', 'duration')}>In some months</button>
      </div>
      {f.mode === 'date'
        ? <label className="lbl">Finish by<input type="date" min={fmt(new Date())} value={f.due} onChange={(e) => set('due', e.target.value)} required /></label>
        : <label className="lbl">Finish within (months)<input type="number" min="1" max="120" value={f.months} onChange={(e) => set('months', e.target.value)} required /></label>}
      <details className="more">
        <summary>More options</summary>
        <label className="lbl">Subject<input list="tags" value={f.tag} onChange={(e) => set('tag', e.target.value)} placeholder="DSA, React…" /></label>
        <datalist id="tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
      </details>
      {err && <p className="msg" role="alert">{err}</p>}
      <button className="primary" disabled={busy}>Add deadline</button>
    </form>
  )
}