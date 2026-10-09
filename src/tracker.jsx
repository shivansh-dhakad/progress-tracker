import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from './supabase'

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d, n) => {
  const day = d.getDate(), result = new Date(d.getFullYear(), d.getMonth() + n, 1)
  result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()))
  return result
}
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7))
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const dow = (d) => (d.getDay() + 6) % 7
const longDate = (s) => parse(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hm = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m` }
const clock = (s) => [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PERIODS = ['daily', 'weekly', 'monthly', 'project']
const TITLES = { daily: 'Today', weekly: 'This week', monthly: 'This month' }
const WEEKS = 26

export default function Tracker() {
  const today = new Date(), todayStr = fmt(today)
  const [goals, setGoals] = useState([]), [done, setDone] = useState([]), [logs, setLogs] = useState({})
  const [rest, setRest] = useState(new Set()), [times, setTimes] = useState([]), [reviews, setReviews] = useState({})
  const [tab, setTab] = useState('dashboard'), [selected, setSelected] = useState(todayStr), [tag, setTag] = useState('')
  const goalManagerRef = useRef(null)
  const timerSaveInFlight = useRef(false)
  const [timer, setTimer] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('timer'))
      if (!saved) return null
      const startedAt = saved.startedAt ?? saved.start ?? null
      return {
        logDate: saved.logDate || fmt(new Date(startedAt || Date.now())),
        elapsedSeconds: saved.elapsedSeconds ?? 0,
        startedAt
      }
    } catch { return null }
  })
  const [now, setNow] = useState(Date.now())
  const [timerError, setTimerError] = useState('')

  const load = useCallback(async () => {
    const q = (t, c) => supabase.from(t).select(c)
    const [g, c, l, r, t, v] = await Promise.all([q('goals', '*').order('created_at'), q('completions', 'goal_id,done_on'),
      q('logs', 'log_date,note'), q('rest_days', 'day'), q('time_entries', 'goal_id,seconds,log_date'), q('reviews', 'week_start,note')])
    setGoals(g.data || []); setDone(c.data || []); setTimes(t.data || [])
    setLogs(Object.fromEntries((l.data || []).map((x) => [x.log_date, x.note])))
    setRest(new Set((r.data || []).map((x) => x.day)))
    setReviews(Object.fromEntries((v.data || []).map((x) => [x.week_start, x.note])))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!timer?.startedAt) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    const refresh = () => setNow(Date.now())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(i)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [timer?.startedAt])

  const goalMap = useMemo(() => Object.fromEntries(goals.map((g) => [g.id, g])), [goals])
  const tags = [...new Set(goals.map((g) => g.tag).filter(Boolean))]
  const inTag = (g) => g && (!tag || g.tag === tag)
  const fgoals = goals.filter(inTag)
  const live = goals.filter((g) => !g.archived && inTag(g))
  const fdone = done.filter((c) => inTag(goalMap[c.goal_id]))
  const ftimes = times.filter((t) => !t.goal_id || inTag(goalMap[t.goal_id]))
  const periodStart = (p) => fmt(p === 'daily' ? today : p === 'weekly' ? weekStart(today) : monthStart(today))
  const isDone = (g) => g.period === 'project'
    ? done.some((c) => c.goal_id === g.id)
    : done.some((c) => c.goal_id === g.id && c.done_on >= periodStart(g.period))
  const scheduled = (g) => g.period === 'project' || g.period !== 'daily' || !g.days?.length || g.days.includes(dow(today))

  /* actions */
  const toggle = async (g) => {
    if (isDone(g)) {
      const query = supabase.from('completions').delete().eq('goal_id', g.id)
      if (g.period !== 'project') query.gte('done_on', periodStart(g.period))
      await query
    }
    else await supabase.from('completions').insert({ goal_id: g.id, done_on: todayStr })
    load()
  }
  const addGoal = async (row) => { await supabase.from('goals').insert(row); load() }
  const archive = async (g, v) => {
    await supabase.from('goals').update({ archived: v, archived_at: v ? new Date().toISOString() : null }).eq('id', g.id)
    load()
  }
  const remove = async (g) => {
    if (!confirm(`Delete "${g.title}" forever? Its history is removed too. Archive it instead to keep history.`)) return
    await supabase.from('goals').delete().eq('id', g.id); load()
  }
  const saveNote = async (note) => { await supabase.from('logs').upsert({ log_date: todayStr, note }); await load() }
  const saveReview = async (week_start, note) => { await supabase.from('reviews').upsert({ week_start, note }); await load() }
  const toggleRest = async (day) => {
    if (rest.has(day)) await supabase.from('rest_days').delete().eq('day', day)
    else {
      const start = fmt(weekStart(parse(day))), end = fmt(addDays(weekStart(parse(day)), 6))
      if ([...rest].some((d) => d >= start && d <= end)) return alert('You already planned a rest day for that week.')
      await supabase.from('rest_days').insert({ day })
    }
    load()
  }
  const saveTimer = (t) => {
    setTimer(t)
    try { t ? localStorage.setItem('timer', JSON.stringify(t)) : localStorage.removeItem('timer') }
    catch (error) { console.error('Could not save study timer locally:', error) }
  }
  const startTimer = () => {
    setTimerError('')
    saveTimer({ logDate: todayStr, elapsedSeconds: 0, startedAt: Date.now() })
  }
  const elapsed = timer
    ? timer.elapsedSeconds + (timer.startedAt ? Math.max(0, Math.round((now - timer.startedAt) / 1000)) : 0)
    : 0
  const elapsedAt = (at) => timer
    ? timer.elapsedSeconds + (timer.startedAt ? Math.max(0, Math.round((at - timer.startedAt) / 1000)) : 0)
    : 0
  const pauseTimer = () => {
    if (!timer?.startedAt) return
    saveTimer({ ...timer, elapsedSeconds: elapsedAt(Date.now()), startedAt: null })
  }
  const resumeTimer = () => {
    if (!timer || timer.startedAt) return
    saveTimer({ ...timer, startedAt: Date.now() })
  }
  const stopTimer = async () => {
    if (!timer || timerSaveInFlight.current) return
    timerSaveInFlight.current = true
    try {
      const seconds = elapsedAt(Date.now())
      if (seconds > 0) {
        const { error } = await supabase.from('time_entries').insert({
          goal_id: null,
          seconds,
          log_date: timer.logDate
        })
        if (error) {
          setTimerError(`Could not save study time: ${error.message}`)
          return
        }
        await load()
      }
      setTimerError('')
      saveTimer(null)
    } finally {
      timerSaveInFlight.current = false
    }
  }

  /* streak: rest days bridge a gap but don't add to the count */
  const active = useMemo(() => {
    const s = new Set(done.map((c) => c.done_on))
    Object.entries(logs).forEach(([d, n]) => n.trim() && s.add(d))
    return s
  }, [done, logs])
  const first = [...active].sort()[0]
  let streak = 0
  for (let d = active.has(todayStr) || rest.has(todayStr) ? today : addDays(today, -1); ; d = addDays(d, -1)) {
    const k = fmt(d)
    if (active.has(k)) streak++
    else if (!rest.has(k)) break
  }
  let longest = 0, run = 0
  if (first) for (let d = parse(first); fmt(d) <= todayStr; d = addDays(d, 1)) {
    const k = fmt(d)
    if (active.has(k)) { run++; longest = Math.max(longest, run) } else if (!rest.has(k) && k !== todayStr) run = 0
  }
  const status = (d) => {
    if (active.has(d)) return 'hit'
    if (rest.has(d)) return 'rest'
    if (d > todayStr) return 'future'
    if (d === todayStr) return 'pending'
    return first && d >= first ? 'miss' : 'future'
  }
  const hr = today.getHours(), hello = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
  const todays = live.filter(scheduled), todayDone = todays.filter(isDone).length
  const week = Array.from({ length: 7 }, (_, i) => fmt(addDays(weekStart(today), i)))
  const ctx = { today, todayStr, goals, fgoals, live, goalMap, done, fdone, ftimes, times, logs, isDone, scheduled, toggle, timer, elapsed, startTimer, pauseTimer, resumeTimer, stopTimer }
  const openGoalManager = () => {
    if (!goalManagerRef.current) return
    goalManagerRef.current.open = true
    goalManagerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">Streakbook</div>
        <div className="badge"><b>{streak}</b><span>day streak</span></div>
        <PageNav tab={tab} setTab={setTab} className="nav" />
      </aside>
      <main className="main">
        <div className="toolbar">
          <div>
            <h1>{tab === 'dashboard' ? hello : tab === 'history' ? 'History' : 'Insights'}</h1>
            <span className="muted">{longDate(todayStr)}</span>
          </div>
          <div>
            {tags.length > 0 && (
              <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by subject">
                <option value="">All subjects</option>{tags.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
            <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
        {(timer || tab === 'dashboard') && <section className={`timer-banner ${timer?.startedAt ? 'is-running' : 'is-paused'}`} aria-live="polite">
          <div>
            <span className="timer-status">{timer ? (timer.startedAt ? 'Study session in progress' : 'Study session paused') : 'Independent study timer'}</span>
            <strong>{timer ? 'Study time' : 'Track time spent studying'}</strong>
            <time>{clock(elapsed)}</time>
          </div>
          <div className="timer-controls">
            {!timer
              ? <button className="primary" onClick={() => startTimer()}>Start timer</button>
              : timer.startedAt
              ? <button className="ghost" onClick={pauseTimer}>Pause</button>
              : <button className="primary" onClick={resumeTimer}>Resume</button>}
            {timer && <button className="timer-stop" onClick={stopTimer}>Stop &amp; save</button>}
          </div>
        </section>}
        {timerError && <p className="msg" role="alert">{timerError}</p>}
        {tab === 'dashboard' && <>
          {dow(today) === 6 && <div className="banner">It’s Sunday. <button className="link" onClick={() => setTab('insights')}>Start your weekly review</button></div>}
          <Hero n={todayDone} total={todays.length} streak={streak} longest={longest} week={week} status={status} todayStr={todayStr} />
          <TodayTab {...ctx} goToGoals={openGoalManager} />
          <ProjectGoals {...ctx} />
          <LogsTab {...ctx} tag={tag} onSave={saveNote} showHistory={false} />
          <Streak {...ctx} status={status} selected={selected} onSelect={setSelected} stats={{ streak, longest, total: active.size }}
            rest={rest} onRest={toggleRest} />
          <details className="panel goal-manager" id="goal-manager" ref={goalManagerRef}>
            <summary>Manage goals <span>{live.length} active</span></summary>
            <GoalsTab {...ctx} tags={tags} onAdd={addGoal} onArchive={archive} onRemove={remove} />
          </details>
        </>}
        {tab === 'history' && <>
          <LogsTab {...ctx} tag={tag} onSave={saveNote} showProgress={false} />
        </>}
        {tab === 'insights' && <Insights {...ctx} reviews={reviews} onSaveReview={saveReview} />}
      </main>
      <PageNav tab={tab} setTab={setTab} className="mobile-nav" />
    </div>
  )
}

const ICONS = {
  dashboard: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" />,
  history: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  insights: <path d="M5 19v-8M12 19V5M19 19v-5" />,
}
function PageNav({ tab, setTab, className }) {
  const pages = [['dashboard', 'Dashboard'], ['history', 'History'], ['insights', 'Insights']]
  return (
    <nav className={className} aria-label="Main navigation">
      {pages.map(([key, label]) => (
        <button key={key} type="button" className={tab === key ? 'on' : ''}
          aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[key]}</svg><span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

/* ---------- hero: streak + today ring + this week ---------- */
function Hero({ n, total, streak, longest, week, status, todayStr }) {
  const C = 2 * Math.PI * 44, off = C * (1 - (total ? n / total : 0))
  const line = !total ? 'Add a goal to begin' : n === total ? 'All done for today' : `${total - n} left today`
  return (
    <section className="hero">
      <div className="hero-main">
        <div>
          <svg className="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c1 3.6 5.5 5.6 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.2 1.1-3.5 2.2-4.5.1 2 1 3 2 3.1-.4-3.2-.9-6 1.3-9.2z" /></svg>
          <b className="big">{streak}</b>
          <span className="hero-sub">day streak · best {longest}</span>
        </div>
        <div className="ring" role="img" aria-label={`${n} of ${total} goals done today`}>
          <svg viewBox="0 0 104 104"><circle cx="52" cy="52" r="44" className="trk" />
            <circle cx="52" cy="52" r="44" className="val" style={{ '--c': C, '--o': off, strokeDasharray: C, strokeDashoffset: off }} /></svg>
          <div><b>{n}/{total}</b><span>{line}</span></div>
        </div>
      </div>
      <div className="wkstrip">
        {week.map((d, i) => <span key={d} className={`wd ${status(d)} ${d === todayStr ? 'now' : ''}`}><i>{'MTWTFSS'[i]}</i><u /></span>)}
      </div>
    </section>
  )
}

/* ---------- streak grid ---------- */
function Streak({ today, todayStr, status, selected, onSelect, stats, done, goalMap, logs, rest, onRest }) {
  const [restDate, setRestDate] = useState(todayStr)
  const [mo, setMo] = useState(0)
  const m = new Date(today.getFullYear(), today.getMonth() + mo, 1)
  const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  const cells = [...Array(dow(m)).fill(null), ...Array.from({ length: n }, (_, i) => fmt(new Date(m.getFullYear(), m.getMonth(), i + 1)))]
  const hits = cells.filter((d) => d && status(d) === 'hit').length
  const words = { hit: 'Done', miss: 'Missed', pending: 'Open today', future: 'No data', rest: 'Rest day' }
  const titles = done.filter((c) => c.done_on === selected).map((c) => goalMap[c.goal_id]?.title).filter(Boolean)
  const note = (logs[selected] || '').trim()
  const pick = (d) => { onSelect(d); setRestDate(d) }
  return (
    <section className="panel streak">
      <div className="stats">
        <div><b>{stats.streak}</b><span>current</span></div><div><b>{stats.longest}</b><span>longest</span></div><div><b>{stats.total}</b><span>active days</span></div>
      </div>
      <div className="calhead">
        <button className="ghost" aria-label="Previous month" onClick={() => setMo(mo - 1)}>←</button>
        <div><h2>{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><span className="muted small">{hits} active {hits === 1 ? 'day' : 'days'}</span></div>
        <button className="ghost" aria-label="Next month" disabled={mo >= 0} onClick={() => setMo(mo + 1)}>→</button>
      </div>
      <div className="cal">
        {DAYS.map((d) => <i key={d}>{d[0]}</i>)}
        {cells.map((d, i) => d
          ? <button key={d} className={`day ${status(d)} ${d === selected ? 'sel' : ''} ${d === todayStr ? 'now' : ''}`}
              title={`${longDate(d)}: ${words[status(d)]}`} aria-label={`${longDate(d)}: ${words[status(d)]}`} onClick={() => pick(d)}>{+d.slice(8)}</button>
          : <span key={'b' + i} />)}
      </div>
      <p className="legend muted"><i className="cell hit" />Done<i className="cell miss" />Missed<i className="cell rest" />Rest<i className="cell pending" />Open</p>
      <div className="detail">
        <h3>{longDate(selected)}{selected === todayStr ? ' · today' : ''} <span className={`pill ${status(selected)}`}>{words[status(selected)]}</span></h3>
        {titles.length > 0 && <p className="chips">{titles.map((t, i) => <span className="chip" key={i}>✓ {t}</span>)}</p>}
        {note && <p className="note">{note}</p>}
        {!titles.length && !note && <p className="muted">Nothing recorded for this day.</p>}
        <div className="rest-plan">
          <button className="ghost" onClick={() => onRest(restDate)}>
            {rest.has(restDate) ? 'Cancel rest day' : 'Plan as rest day'}
          </button>
          <span className="muted small">One per week keeps your streak alive</span>
        </div>
      </div>
    </section>
  )
}

/* ---------- one goal row (shared) ---------- */
function Meta({ g, done, todayStr, isDone, times }) {
  const n = done.filter((c) => c.goal_id === g.id).length
  const secs = times.filter((t) => t.goal_id === g.id).reduce((a, t) => a + t.seconds, 0)
  const diff = g.due_date ? Math.round((parse(g.due_date) - parse(todayStr)) / 864e5) : null
  return (
    <span className="meta">
      {g.tag && <em className="tag">{g.tag}</em>}
      {diff !== null && (isDone(g) ? <em className="due">Due {g.due_date}</em> : diff < 0 ? <em className="due over">Overdue by {-diff}d</em> : <em className="due">{diff === 0 ? 'Due today' : `Due in ${diff}d`}</em>)}
      {g.period === 'daily' && g.days?.length > 0 && <em className="due">{g.days.map((d) => DAYS[d]).join(' ')}</em>}
      {secs > 0 && <em className="due">{hm(secs)} studied</em>}
      {g.target && <span className="prog"><i style={{ width: `${Math.min(100, (n / g.target) * 100)}%` }} /><b>{n}/{g.target}</b></span>}
    </span>
  )
}

function TodayTab(c) {
  const { live, isDone, scheduled, toggle } = c
  if (!live.some((g) => g.period !== 'project')) return <section className="panel empty"><p>No recurring goals yet.</p><button className="primary" onClick={c.goToGoals}>Create a goal</button></section>
  return (
    <div className="cols">
      {PERIODS.filter((p) => p !== 'project').map((p) => {
        const all = live.filter((g) => g.period === p), list = all.filter(scheduled)
          .sort((a, b) => Number(isDone(a)) - Number(isDone(b))), n = list.filter(isDone).length
        return (
          <section className="panel" key={p}>
            <h2>{TITLES[p]} <small>{n} done · {list.length - n} remaining</small></h2>
            <div className="bar"><div style={{ width: list.length ? `${(n / list.length) * 100}%` : 0 }} /></div>
            <ul className="plain">
              {list.map((g) => (
                <li key={g.id} className={`goal-item ${isDone(g) ? 'completed' : 'remaining'}`}>
                  <button className="check" aria-pressed={isDone(g)} aria-label={isDone(g) ? `Undo ${g.title}` : `Mark ${g.title} done`} onClick={() => toggle(g)}><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.8 3.8 7.2-8.3" /></svg></button>
                  <div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} /></div>
                </li>
              ))}
              {!list.length && <li className="muted">{all.length ? 'Nothing scheduled today.' : `No ${p} goals.`}</li>}
            </ul>
            {all.length > list.length && <p className="muted small">{all.length - list.length} not scheduled today</p>}
          </section>
        )
      })}
    </div>
  )
}

function ProjectGoals(c) {
  const projects = c.live.filter((g) => g.period === 'project')
    .sort((a, b) => Number(c.isDone(a)) - Number(c.isDone(b)) ||
      (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'))
  if (!projects.length) return null
  return (
    <section className="panel">
      <h2>Project goals <small>{projects.filter((g) => !c.isDone(g)).length} remaining</small></h2>
      <ul className="plain">
        {projects.map((g) => (
          <li key={g.id} className={`goal-item ${c.isDone(g) ? 'completed' : 'remaining'}`}>
            <button className="check" aria-pressed={c.isDone(g)}
              aria-label={c.isDone(g) ? `Undo ${g.title}` : `Mark ${g.title} done`}
              onClick={() => c.toggle(g)}><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.8 3.8 7.2-8.3" /></svg></button>
            <div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} /></div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- goals: create, archive ---------- */
function GoalsTab(c) {
  const { goals, tags, onAdd, onArchive, onRemove } = c
  const blank = { title: '', kind: 'recurring', period: 'daily', tag: '', target: '', due: '', deadlineMode: 'date', duration: '1', days: [] }
  const [f, setF] = useState(blank), [showArch, setShowArch] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const submit = (e) => {
    e.preventDefault()
    if (!f.title.trim()) return
    const durationMonths = f.deadlineMode === 'duration' ? Math.max(1, Number(f.duration)) : null
    const dueDate = f.kind === 'project'
      ? f.deadlineMode === 'duration' ? fmt(addMonths(new Date(), durationMonths)) : f.due || null
      : f.due || null
    onAdd({
      title: f.title.trim(),
      period: f.kind === 'project' ? 'project' : f.period,
      tag: f.tag.trim() || null,
      target: f.kind === 'recurring' && f.target ? +f.target : null,
      due_date: dueDate,
      duration_months: durationMonths,
      days: f.kind === 'recurring' && f.period === 'daily' && f.days.length ? f.days : null
    })
    setF({ ...blank, kind: f.kind, period: f.period })
  }
  const arch = goals.filter((g) => g.archived)
  return (
    <div className="stack">
      <form className="panel form" onSubmit={submit}>
        <h2>Create a goal</h2>
        <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Learn transformers" required />
        <div className="grid4">
          <label>Goal type<select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="recurring">Recurring</option><option value="project">Project / deadline</option></select></label>
          {f.kind === 'recurring' && <label>Repeats<select value={f.period} onChange={(e) => set('period', e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>}
          <label>Subject<input list="tags" value={f.tag} onChange={(e) => set('tag', e.target.value)} placeholder="DSA, React…" /><datalist id="tags">{tags.map((t) => <option key={t} value={t} />)}</datalist></label>
          {f.kind === 'recurring' && <label>Course target<input type="number" min="1" value={f.target} onChange={(e) => set('target', e.target.value)} placeholder="e.g. 40" /></label>}
          {f.kind === 'project' && <label>Deadline<select value={f.deadlineMode} onChange={(e) => set('deadlineMode', e.target.value)}><option value="date">Set a date</option><option value="duration">Duration from today</option></select></label>}
          {f.kind === 'project' && (f.deadlineMode === 'date'
            ? <label>Finish by<input type="date" value={f.due} min={fmt(new Date())} onChange={(e) => set('due', e.target.value)} required /></label>
            : <label>Complete in (months)<input type="number" min="1" max="120" value={f.duration} onChange={(e) => set('duration', e.target.value)} required /></label>)}
          {f.kind === 'recurring' && <label>Due date<input type="date" value={f.due} onChange={(e) => set('due', e.target.value)} /></label>}
        </div>
        {f.kind === 'recurring' && f.period === 'daily' && (
          <div className="dayrow"><span className="muted">Only on (empty = every day)</span>
            {DAYS.map((d, i) => <button type="button" key={d} className={f.days.includes(i) ? 'on' : ''} onClick={() => set('days', f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i])}>{d}</button>)}
          </div>
        )}
        <button className="primary">Add goal</button>
      </form>
      <div className="cols">
        {PERIODS.filter((p) => p !== 'project').map((p) => (
          <section className="panel" key={p}>
            <h2>{p[0].toUpperCase() + p.slice(1)} <small>{c.live.filter((g) => g.period === p).length}</small></h2>
            <ul className="plain">
              {c.live.filter((g) => g.period === p).map((g) => (
                <li key={g.id}><div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} /></div>
                  <button className="ghost" onClick={() => onArchive(g, true)}>Archive</button></li>
              ))}
              {!c.live.some((g) => g.period === p) && <li className="muted">None.</li>}
            </ul>
          </section>
        ))}
      </div>
      {c.live.some((g) => g.period === 'project') && <section className="panel">
        <h2>Project goals <small>{c.live.filter((g) => g.period === 'project').length}</small></h2>
        <ul className="plain">
          {c.live.filter((g) => g.period === 'project').map((g) => (
            <li key={g.id}><div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} /></div>
              <button className="ghost" onClick={() => onArchive(g, true)}>Archive</button></li>
          ))}
        </ul>
      </section>}
      {arch.length > 0 && (
        <section className="panel">
          <h2>Archived <small>{arch.length}</small></h2>
          <button className="link" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide' : 'Show'} archived goals</button>
          {showArch && <ul className="plain">{arch.map((g) => (
            <li key={g.id}><div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} isDone={() => true} /></div>
              <div className="acts"><button className="ghost" onClick={() => onArchive(g, false)}>Restore</button><button className="x" aria-label="Delete forever" onClick={() => onRemove(g)}>×</button></div></li>
          ))}</ul>}
        </section>
      )}
    </div>
  )
}

/* ---------- insights: weekly review + charts ---------- */
const Bars = ({ data, unit = '' }) => {
  const m = Math.max(1, ...data.map((d) => d.v))
  return <div className="bars">{data.map((d, i) => <div key={i}><b>{d.v}{unit}</b><div className="col"><i style={{ height: `${(d.v / m) * 100}%` }} /></div><small>{d.l}</small></div>)}</div>
}
function Insights({ today, todayStr, fgoals, live, fdone, ftimes, logs, reviews, isDone, timer, elapsed, onSaveReview }) {
  const [off, setOff] = useState(0), [note, setNote] = useState(''), [saved, setSaved] = useState(false)
  const ws = fmt(addDays(weekStart(today), 7 * off)), we = fmt(addDays(parse(ws), 6))
  useEffect(() => { setNote(reviews[ws] || '') }, [ws, reviews])
  const inR = (d) => d >= ws && d <= we
  const wd = fdone.filter((c) => inR(c.done_on))
  const per = {}; wd.forEach((c) => (per[c.done_on] = (per[c.done_on] || 0) + 1))
  const days = new Set([...Object.keys(per), ...Object.keys(logs).filter((d) => inR(d) && logs[d].trim())]).size
  const best = Object.entries(per).sort((a, b) => b[1] - a[1])[0]
  const activeSessionSeconds = timer ? elapsed : 0
  const sessionInSelectedWeek = timer && timer.logDate >= ws && timer.logDate <= we ? activeSessionSeconds : 0
  const secs = ftimes.filter((t) => inR(t.log_date)).reduce((a, t) => a + t.seconds, 0) + sessionInSelectedWeek
  const currentWeekStart = fmt(weekStart(today))
  const previousWeekStart = fmt(addDays(weekStart(today), -7))
  const previousWeekEnd = fmt(addDays(parse(previousWeekStart), 6))
  const currentWeekDone = fdone.filter((c) => c.done_on >= currentWeekStart && c.done_on <= todayStr)
  const previousWeekDone = fdone.filter((c) => c.done_on >= previousWeekStart && c.done_on <= previousWeekEnd)
  const currentWeekDays = new Set([
    ...currentWeekDone.map((c) => c.done_on),
    ...Object.keys(logs).filter((d) => d >= currentWeekStart && d <= todayStr && logs[d].trim())
  ]).size
  const currentWeekSeconds = ftimes.filter((t) => t.log_date >= currentWeekStart && t.log_date <= todayStr)
    .reduce((a, t) => a + t.seconds, 0) +
    (timer && timer.logDate >= currentWeekStart && timer.logDate <= todayStr ? activeSessionSeconds : 0)
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const s = fmt(addDays(weekStart(today), -7 * (7 - i))), e = fmt(addDays(parse(s), 6))
    return { l: `${MONTHS[parse(s).getMonth()]} ${parse(s).getDate()}`, v: fdone.filter((c) => c.done_on >= s && c.done_on <= e).length }
  })
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const startDate = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1)
    const start = fmt(startDate)
    const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0)
    const end = fmt(i === 5 ? today : monthEnd)
    const activeOn = (g, date) => {
      const created = g.created_at?.slice(0, 10) || start
      const archived = g.archived_at?.slice(0, 10)
      return date >= created && (!archived || date <= archived)
    }
    const opportunities = new Set()
    const completed = new Set()
    fgoals.filter((g) => g.period !== 'project').forEach((g) => {
      for (let d = start; d <= end; d = fmt(addDays(parse(d), 1))) {
        if (!activeOn(g, d)) continue
        if (g.period === 'daily') {
          if (!g.days?.length || g.days.includes(dow(parse(d)))) opportunities.add(`${g.id}:${d}`)
        } else if (g.period === 'weekly') {
          opportunities.add(`${g.id}:${fmt(weekStart(parse(d)))}`)
        } else {
          opportunities.add(`${g.id}:${d.slice(0, 7)}`)
        }
      }
    })
    fdone.forEach((c) => {
      if (c.done_on < start || c.done_on > end) return
      const g = fgoals.find((goal) => goal.id === c.goal_id)
      if (!g || !activeOn(g, c.done_on)) return
      if (g.period === 'daily' && g.days?.length && !g.days.includes(dow(parse(c.done_on)))) return
      const period = g.period === 'daily' ? c.done_on : g.period === 'weekly' ? fmt(weekStart(parse(c.done_on))) : c.done_on.slice(0, 7)
      completed.add(`${g.id}:${period}`)
    })
    const rate = opportunities.size ? Math.round((completed.size / opportunities.size) * 100) : 0
    return { l: MONTHS[startDate.getMonth()], v: Math.min(100, rate) }
  })
  const studyWeekly = Array.from({ length: 8 }, (_, i) => {
    const start = fmt(addDays(weekStart(today), -7 * (7 - i)))
    const end = fmt(addDays(parse(start), 6))
    let seconds = ftimes.filter((t) => t.log_date >= start && t.log_date <= end)
      .reduce((a, t) => a + t.seconds, 0)
    if (timer && timer.logDate >= start && timer.logDate <= end) seconds += activeSessionSeconds
    return { l: `${MONTHS[parse(start).getMonth()]} ${parse(start).getDate()}`, v: Math.round((seconds / 3600) * 10) / 10 }
  })
  const recentStart = fmt(addDays(today, -29))
  const recentCompletions = fdone.filter((c) => c.done_on >= recentStart && c.done_on <= todayStr)
  const recentGoals = {}
  const recentTags = {}
  recentCompletions.forEach((completion) => {
    const goal = fgoals.find((g) => g.id === completion.goal_id)
    if (!goal) return
    recentGoals[goal.id] = { id: goal.id, title: goal.title, count: (recentGoals[goal.id]?.count || 0) + 1 }
    const subject = goal.tag || 'Untagged'
    recentTags[subject] = (recentTags[subject] || 0) + 1
  })
  const topGoals = Object.values(recentGoals).sort((a, b) => b.count - a.count).slice(0, 5)
  const topTags = Object.entries(recentTags).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const deadlineGoals = live.filter((g) => g.due_date && !isDone(g))
    .map((g) => ({ ...g, daysLeft: Math.round((parse(g.due_date) - parse(todayStr)) / 864e5) }))
    .filter((g) => g.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5)
  const cut30 = fmt(addDays(today, -29)), cut14 = fmt(addDays(today, -14))
  const act30 = new Set([...fdone.filter((c) => c.done_on >= cut30).map((c) => c.done_on),
    ...Object.keys(logs).filter((d) => d >= cut30 && d <= todayStr && logs[d].trim())]).size
  const wdCount = Array(7).fill(0)
  fdone.filter((c) => c.done_on >= fmt(addDays(today, -55))).forEach((c) => wdCount[dow(parse(c.done_on))]++)
  const topDow = Math.max(...wdCount), byDow = DAYS.map((l, i) => ({ l, v: wdCount[i] }))
  const courses = live.filter((g) => g.target).map((g) => ({ g, n: fdone.filter((c) => c.goal_id === g.id).length }))
  const stalled = live.filter((g) => (g.created_at || '').slice(0, 10) < cut14 && !fdone.some((c) => c.goal_id === g.id && c.done_on >= cut14)).slice(0, 4)
  const maxTag = Math.max(1, ...topTags.map((t) => t[1]))
  const dlt = currentWeekDone.length - previousWeekDone.length
  const save = async () => { await onSaveReview(ws, note); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  return (
    <div className="stack">
      <section className="insight-summary" aria-label="At a glance">
        <div><b>{currentWeekDone.length}</b><span>done this week</span><small>{dlt >= 0 ? '+' : ''}{dlt} vs last week</small></div>
        <div><b>{act30}<em>/30</em></b><span>active days</span><small>last 30 days</small></div>
        <div><b>{hm(currentWeekSeconds)}</b><span>study time</span><small>this week</small></div>
      </section>
      {courses.length > 0 && <section className="panel">
        <h2>Course progress <small>{courses.length} tracked</small></h2>
        <ul className="plain">{courses.map(({ g, n }) => <li key={g.id}>
          <div className="grow"><span className="gt">{g.title}</span><div className="track"><i style={{ width: `${Math.min(100, (n / g.target) * 100)}%` }} /></div></div>
          <b className="cnt">{n}/{g.target}</b></li>)}</ul>
      </section>}
      <section className="panel">
        <h2>Weekly review <span className="wk"><button className="ghost" aria-label="Previous week" onClick={() => setOff(off - 1)}>←</button>{ws.slice(5)} – {we.slice(5)}<button className="ghost" aria-label="Next week" disabled={off >= 0} onClick={() => setOff(off + 1)}>→</button></span></h2>
        <div className="stats">
          <div><b>{wd.length}</b><span>completed</span></div><div><b>{days}/7</b><span>days active</span></div>
          <div><b>{best ? DAYS[dow(parse(best[0]))] : '–'}</b><span>best day{best ? ` (${best[1]})` : ''}</span></div><div><b>{hm(secs)}</b><span>studied</span></div>
        </div>
        <label className="lbl">What will you change next week?</label>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="One thing to keep, one thing to change" />
        <button className="primary" onClick={save}>{saved ? 'Saved ✓' : 'Save review'}</button>
      </section>
      {stalled.length > 0 && <section className="panel attention">
        <h2>Needs attention <small>nothing done in 14 days</small></h2>
        <ul className="plain">{stalled.map((g) => <li key={g.id}><span className="gt">{g.title}</span><em className="tag">{g.period}</em></li>)}</ul>
        <p className="muted small">Do it once today, or archive it in Manage goals.</p>
      </section>}
      <div className="cols two">
        <section className="panel"><h2>Goals per week</h2><Bars data={weekly} /></section>
        <section className="panel"><h2>Your strongest days <small>8 weeks</small></h2><Bars data={byDow} />
          {topDow > 0 && <p className="muted small">You finish most on {DAYS[wdCount.indexOf(topDow)]}s. Put your hardest goal there.</p>}</section>
        <section className="panel"><h2>Study time per week</h2><Bars data={studyWeekly} unit="h" /></section>
        <section className="panel"><h2>Completion rate <small>by month</small></h2><Bars data={monthly} unit="%" /><p className="muted small">Completed ÷ scheduled goals</p></section>
      </div>
      <section className="panel">
        <h2>By subject <small>last 30 days</small></h2>
        {topTags.length ? <ul className="plain">{topTags.map(([name, count]) => <li key={name}>
          <div className="grow"><span className="gt">{name}</span><div className="track"><i style={{ width: `${(count / maxTag) * 100}%` }} /></div></div><b className="cnt">{count}</b></li>)}</ul>
          : <p className="muted small">Add a subject to your goals to compare where your effort goes.</p>}
      </section>
      <section className="panel deadlines">
        <h2>Deadlines <small>next 14 days</small></h2>
        {deadlineGoals.length ? <ul className="plain">
          {deadlineGoals.map((g) => <li key={g.id}>
            <div className="grow"><span className="gt">{g.title}</span><Meta g={g} done={fdone} todayStr={todayStr} isDone={isDone} times={ftimes} /></div>
            <span className={`deadline-label ${g.daysLeft < 0 ? 'late' : ''}`}>
              {g.daysLeft < 0 ? `${-g.daysLeft}d overdue` : g.daysLeft === 0 ? 'Due today' : `${g.daysLeft}d left`}
            </span>
          </li>)}
        </ul> : <p className="muted small">No incomplete goals due soon.</p>}
      </section>
    </div>
  )
}

/* ---------- logs ---------- */
function LogsTab({ todayStr, logs, done, goalMap, tag, onSave, showProgress = true, showHistory = true }) {
  const [note, setNote] = useState(logs[todayStr] || ''), [saved, setSaved] = useState(false)
  const [q, setQ] = useState(''), [month, setMonth] = useState(''), [type, setType] = useState('all')
  const save = async () => { await onSave(note); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  const entries = useMemo(() => {
    const by = {}, get = (d) => (by[d] ||= { date: d, note: '', goals: [] })
    if (!tag) Object.entries(logs).forEach(([d, n]) => n.trim() && (get(d).note = n))
    done.forEach((c) => { const g = goalMap[c.goal_id]; if (g && (!tag || g.tag === tag)) get(c.done_on).goals.push(g) })
    return Object.values(by).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [logs, done, goalMap, tag])
  const s = q.trim().toLowerCase()
  const shown = entries.filter((e) => (!month || e.date.startsWith(month)) && (type !== 'notes' || e.note) && (type !== 'goals' || e.goals.length)
    && (!s || e.note.toLowerCase().includes(s) || e.goals.some((g) => g.title.toLowerCase().includes(s))))
  return (
    <div className="stack">
      {showProgress && <section className="panel progress-entry">
        <h2>Enter today’s progress</h2>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on or learn today?" />
        <button className="primary" onClick={save}>{saved ? 'Saved ✓' : 'Save today’s progress'}</button>
      </section>}
      {showHistory && <section className="panel">
        <h2>Previous logs <small>{shown.length} of {entries.length}{tag ? ` · ${tag}` : ''}</small></h2>
        <div className="filters">
          <input placeholder="Search logs and goals" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month" />
          <select value={type} onChange={(e) => setType(e.target.value)}><option value="all">All entries</option><option value="notes">With a note</option><option value="goals">With goals done</option></select>
          {(q || month || type !== 'all') && <button className="link" onClick={() => { setQ(''); setMonth(''); setType('all') }}>Clear</button>}
        </div>
        <ul className="plain history">
          {shown.map((e) => (
            <li key={e.date}><div><b>{longDate(e.date)}</b>{e.note && <p className="note">{e.note}</p>}
              {e.goals.length > 0 && <p className="chips">{e.goals.map((g, i) => <span key={i} className="chip">✓ {g.title}</span>)}</p>}</div></li>
          ))}
          {!shown.length && <li className="muted">{entries.length ? 'No entries match these filters.' : 'No logs yet. Save your first one above.'}</li>}
        </ul>
      </section>}
    </div>
  )
}