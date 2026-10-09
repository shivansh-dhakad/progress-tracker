import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from './supabase'
import FeatureTracker from './tracker.jsx'

/* ---------- date helpers (local time, YYYY-MM-DD) ---------- */
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)) // Monday
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const longDate = (s) => parse(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKS = 26
const PERIODS = ['daily', 'weekly', 'monthly']
const TITLES = { daily: 'Today', weekly: 'This week', monthly: 'This month' }

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (!ready) return null
  return session ? <FeatureTracker /> : <Auth />
}

/* ---------- sign in / sign up ---------- */
function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [msg, setMsg] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setMsg('')
    const redirectUrl = `${window.location.origin}/`
    const fn = mode === 'signin' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const payload = mode === 'signin'
      ? { email, password }
      : { email, password, options: { emailRedirectTo: redirectUrl } }
    const { error } = await fn.call(supabase.auth, payload)
    if (error) setMsg(error.message)
    else if (mode === 'signup') setMsg('Account created. Check your email to confirm, then sign in. After verification, the app will return here automatically.')
  }
  return (
    <main className="auth">
      <form onSubmit={submit} className="panel">
        <h1>Goal Tracker</h1>
        <p className="muted">Set goals, tick them off, keep the streak alive.</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        <button className="primary">{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        {msg && <p className="msg">{msg}</p>}
        <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  )
}

/* ---------- main app ---------- */
function Tracker() {
  const today = new Date()
  const todayStr = fmt(today)
  const [goals, setGoals] = useState([])
  const [done, setDone] = useState([]) // all completions {goal_id, done_on}
  const [logs, setLogs] = useState({}) // {date: note}
  const [tab, setTab] = useState('today')
  const [selected, setSelected] = useState(todayStr)

  const load = useCallback(async () => {
    const [g, c, l] = await Promise.all([
      supabase.from('goals').select('*').order('created_at'),
      supabase.from('completions').select('goal_id,done_on'),
      supabase.from('logs').select('log_date,note'),
    ])
    setGoals(g.data || [])
    setDone(c.data || [])
    const map = {}
    ;(l.data || []).forEach((r) => (map[r.log_date] = r.note))
    setLogs(map)
  }, [])
  useEffect(() => { load() }, [load])

  const goalMap = useMemo(() => Object.fromEntries(goals.map((g) => [g.id, g])), [goals])
  const periodStart = (p) => fmt(p === 'daily' ? today : p === 'weekly' ? weekStart(today) : monthStart(today))
  const isDone = (g) => done.some((c) => c.goal_id === g.id && c.done_on >= periodStart(g.period))

  const toggle = async (g) => {
    if (isDone(g)) await supabase.from('completions').delete().eq('goal_id', g.id).gte('done_on', periodStart(g.period))
    else await supabase.from('completions').insert({ goal_id: g.id, done_on: todayStr })
    load()
  }
  const addGoal = async (title, period) => { await supabase.from('goals').insert({ title, period }); load() }
  const removeGoal = async (g) => {
    if (!confirm(`Delete "${g.title}"? Its completion history will be removed too.`)) return
    await supabase.from('goals').delete().eq('id', g.id); load()
  }
  const saveNote = async (note) => { await supabase.from('logs').upsert({ log_date: todayStr, note }); await load() }

  /* ---------- streak stats ---------- */
  const active = useMemo(() => {
    const s = new Set(done.map((c) => c.done_on))
    Object.entries(logs).forEach(([d, n]) => n.trim() && s.add(d))
    return s
  }, [done, logs])
  const sorted = [...active].sort()
  const first = sorted[0]
  let streak = 0
  for (let d = active.has(todayStr) ? today : addDays(today, -1); active.has(fmt(d)); d = addDays(d, -1)) streak++
  let longest = 0, run = 0, prev = null
  for (const d of sorted) { run = prev && fmt(addDays(parse(prev), 1)) === d ? run + 1 : 1; longest = Math.max(longest, run); prev = d }
  const status = (d) => {
    if (active.has(d)) return 'hit'
    if (d > todayStr) return 'future'
    if (d === todayStr) return 'pending'
    return first && d >= first ? 'miss' : 'future'
  }

  return (
    <main className="app">
      <header>
        <div>
          <h1>Goal Tracker</h1>
          <p className="muted">{longDate(todayStr)}</p>
        </div>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <Streak today={today} todayStr={todayStr} status={status} selected={selected} onSelect={setSelected}
        stats={{ streak, longest, total: active.size }} done={done} goalMap={goalMap} logs={logs} />

      <nav className="tabs">
        {[['today', 'Today'], ['goals', 'Goals'], ['logs', 'Logs']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      {tab === 'today' && <TodayTab goals={goals} isDone={isDone} onToggle={toggle} goToGoals={() => setTab('goals')} />}
      {tab === 'goals' && <GoalsTab goals={goals} done={done} onAdd={addGoal} onRemove={removeGoal} />}
      {tab === 'logs' && <LogsTab todayStr={todayStr} logs={logs} done={done} goalMap={goalMap} onSave={saveNote} />}
    </main>
  )
}

/* ---------- streak heatmap with month/year labels and day details ---------- */
function Streak({ today, todayStr, status, selected, onSelect, stats, done, goalMap, logs }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth }, [])
  const start = addDays(weekStart(today), -7 * (WEEKS - 1))
  const weeks = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, i) => fmt(addDays(start, w * 7 + i))))
  const label = (days) => {
    const d1 = days.find((d) => parse(d).getDate() === 1)
    if (!d1) return ''
    const dt = parse(d1)
    return MONTHS[dt.getMonth()] + (dt.getMonth() === 0 ? ` ${dt.getFullYear()}` : '')
  }
  const words = { hit: 'Done', miss: 'Missed', pending: 'Nothing yet today', future: 'No data' }
  const doneGoals = done.filter((c) => c.done_on === selected).map((c) => goalMap[c.goal_id]?.title).filter(Boolean)
  const note = (logs[selected] || '').trim()
  const range = `${MONTHS[parse(weeks[0][0]).getMonth()]} ${parse(weeks[0][0]).getFullYear()} – ${MONTHS[today.getMonth()]} ${today.getFullYear()}`

  return (
    <section className="panel">
      <div className="stats">
        <div><b className="g">{stats.streak}</b><span>current streak</span></div>
        <div><b>{stats.longest}</b><span>longest streak</span></div>
        <div><b>{stats.total}</b><span>active days</span></div>
      </div>
      <p className="muted range">{range} · tap a square for details</p>
      <div className="heat-wrap" ref={ref}>
        <div className="heat">
          <div className="dow"><i /><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /></div>
          {weeks.map((days, w) => (
            <div className="week" key={w}>
              <em className="mlabel">{label(days)}</em>
              {days.map((d) => (
                <button key={d} className={`cell ${status(d)} ${d === selected ? 'sel' : ''}`}
                  title={`${longDate(d)}: ${words[status(d)]}`} aria-label={`${longDate(d)}: ${words[status(d)]}`} onClick={() => onSelect(d)} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="legend muted"><i className="cell hit" /> Done <i className="cell miss" /> Missed <i className="cell pending" /> Today, open</p>
      <div className="detail">
        <h3>{longDate(selected)}{selected === todayStr ? ' (today)' : ''}</h3>
        <p className={`pill ${status(selected)}`}>{words[status(selected)]}</p>
        {doneGoals.length > 0 && <ul className="plain">{doneGoals.map((t, i) => <li key={i}>✓ {t}</li>)}</ul>}
        {note && <p className="note">{note}</p>}
        {!doneGoals.length && !note && <p className="muted">Nothing recorded for this day.</p>}
      </div>
    </section>
  )
}

/* ---------- Today: tick off goals ---------- */
function TodayTab({ goals, isDone, onToggle, goToGoals }) {
  if (!goals.length)
    return <section className="panel empty"><p>You haven’t set any goals yet.</p><button className="primary" onClick={goToGoals}>Add your first goal</button></section>
  return (
    <div className="cols">
      {PERIODS.map((p) => {
        const list = goals.filter((g) => g.period === p)
        const n = list.filter(isDone).length
        return (
          <section className="panel" key={p}>
            <h2>{TITLES[p]} <small>{n}/{list.length}</small></h2>
            <div className="bar"><div style={{ width: list.length ? `${(n / list.length) * 100}%` : 0 }} /></div>
            <ul className="plain">
              {list.map((g) => (
                <li key={g.id} className={isDone(g) ? 'on' : ''}>
                  <span>{g.title}</span>
                  <button className={isDone(g) ? 'done-btn' : 'mark-btn'} onClick={() => onToggle(g)}>
                    {isDone(g) ? 'Done ✓ · Undo' : 'Mark done'}
                  </button>
                </li>
              ))}
              {!list.length && <li className="muted">No {p} goals.</li>}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ---------- Goals: manage goals ---------- */
function GoalsTab({ goals, done, onAdd, onRemove }) {
  const [text, setText] = useState('')
  const [period, setPeriod] = useState('daily')
  const submit = (e) => { e.preventDefault(); if (text.trim()) { onAdd(text.trim(), period); setText('') } }
  return (
    <div className="stack">
      <section className="panel">
        <h2>Set a new goal</h2>
        <form onSubmit={submit} className="row">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Finish 2 lectures of the React course" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
          <button className="primary">Add goal</button>
        </form>
      </section>
      <div className="cols">
        {PERIODS.map((p) => (
          <section className="panel" key={p}>
            <h2>{p[0].toUpperCase() + p.slice(1)} goals <small>{goals.filter((g) => g.period === p).length}</small></h2>
            <ul className="plain">
              {goals.filter((g) => g.period === p).map((g) => (
                <li key={g.id}>
                  <div>
                    <span>{g.title}</span>
                    <small className="muted block">Added {new Date(g.created_at).toLocaleDateString()} · completed {done.filter((c) => c.goal_id === g.id).length}×</small>
                  </div>
                  <button className="x" aria-label="Delete goal" onClick={() => onRemove(g)}>×</button>
                </li>
              ))}
              {!goals.some((g) => g.period === p) && <li className="muted">None yet.</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/* ---------- Logs: write today's log + browse history with filters ---------- */
function LogsTab({ todayStr, logs, done, goalMap, onSave }) {
  const [note, setNote] = useState(logs[todayStr] || '')
  const [saved, setSaved] = useState(false)
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')
  const [type, setType] = useState('all')

  const save = async () => { await onSave(note); setSaved(true); setTimeout(() => setSaved(false), 1500) }

  const entries = useMemo(() => {
    const by = {}
    const get = (d) => (by[d] ||= { date: d, note: '', goals: [] })
    Object.entries(logs).forEach(([d, n]) => { if (n.trim()) get(d).note = n })
    done.forEach((c) => { const g = goalMap[c.goal_id]; if (g) get(c.done_on).goals.push(g) })
    return Object.values(by).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [logs, done, goalMap])

  const shown = entries.filter((e) => {
    if (month && !e.date.startsWith(month)) return false
    if (type === 'notes' && !e.note) return false
    if (type === 'goals' && !e.goals.length) return false
    const s = q.trim().toLowerCase()
    return !s || e.note.toLowerCase().includes(s) || e.goals.some((g) => g.title.toLowerCase().includes(s))
  })

  return (
    <div className="stack">
      <section className="panel">
        <h2>What did I complete today?</h2>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Finished React hooks chapter, solved 3 array problems" />
        <button className="primary" onClick={save}>{saved ? 'Saved ✓' : 'Save today’s log'}</button>
      </section>
      <section className="panel">
        <h2>Previous logs <small>{shown.length} of {entries.length}</small></h2>
        <div className="filters">
          <input placeholder="Search logs and goals" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month" />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All entries</option><option value="notes">With a log note</option><option value="goals">With goals done</option>
          </select>
          {(q || month || type !== 'all') && <button className="link" onClick={() => { setQ(''); setMonth(''); setType('all') }}>Clear filters</button>}
        </div>
        <ul className="plain history">
          {shown.map((e) => (
            <li key={e.date}>
              <div>
                <b>{longDate(e.date)}</b>
                {e.note && <p className="note">{e.note}</p>}
                {e.goals.length > 0 && <p className="chips">{e.goals.map((g, i) => <span key={i} className={`chip ${g.period}`}>✓ {g.title}</span>)}</p>}
              </div>
            </li>
          ))}
          {!shown.length && <li className="muted">{entries.length ? 'No entries match these filters.' : 'No logs yet. Save your first one above.'}</li>}
        </ul>
      </section>
    </div>
  )
}