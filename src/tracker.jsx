import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from './supabase'
import { PlanToday, PlanProgress, StudyWeek, FocusOverlay, ShiftRow, planInfo, shiftsOn, freeToday, pausedToday, localDate, shiftMinutes, formatTime, shiftInfo, studiedOn } from './plans.jsx'
import { SettingsPanel, useShiftReminders } from './reminders.jsx'
import { NewSheet } from './newgoal.jsx'

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
const shortDate = (s) => parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const clockTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PERIODS = ['daily', 'weekly', 'monthly', 'project']
const RECURRING = ['daily', 'weekly', 'monthly']
const TITLES = { daily: 'Today', weekly: 'This week', monthly: 'This month' }
const WEEKS = 26

export default function Tracker() {
  const today = new Date(), todayStr = fmt(today)
  const [goals, setGoals] = useState([]), [done, setDone] = useState([]), [logs, setLogs] = useState({})
  const [rest, setRest] = useState(new Set()), [times, setTimes] = useState([]), [reviews, setReviews] = useState({}), [slots, setSlots] = useState([])
  const [settings, setSettings] = useState({}), [notice, setNotice] = useState(''), [delTarget, setDelTarget] = useState(null), [editGoal, setEditGoal] = useState(null), [stopPrompt, setStopPrompt] = useState(null)
  const [tab, setTab] = useState('dashboard'), [selected, setSelected] = useState(todayStr), [tag, setTag] = useState('')
  const timerSaveInFlight = useRef(false)
  const readStoredTimer = useCallback(() => {
    try {
      const raw = localStorage.getItem('timer')
      if (!raw) return null
      const saved = JSON.parse(raw)
      if (!saved || typeof saved !== 'object') return null
      const startedAt = saved.startedAt ?? saved.start ?? null
      return {
        logDate: saved.logDate || fmt(new Date(startedAt || Date.now())),
        elapsedSeconds: Number.isFinite(saved.elapsedSeconds) ? saved.elapsedSeconds : 0,
        startedAt,
        sessionStart: saved.sessionStart ?? startedAt ?? Date.now()
      }
    } catch { return null }
  }, [])
  const [timer, setTimer] = useState(readStoredTimer)
  const [now, setNow] = useState(Date.now())
  const [sheet, setSheet] = useState(null) // null | 'choose' | 'plan' | 'habit' | 'deadline' | 'manage'
  const [focus, setFocus] = useState(() => { try { const saved = JSON.parse(localStorage.getItem('timer') || 'null'); return !!saved?.startedAt } catch { return false } })
  const [timerError, setTimerError] = useState('')

  const load = useCallback(async () => {
    const q = (t, c) => supabase.from(t).select(c)
    const [g, c, l, r, t, v, sl, us] = await Promise.all([q('goals', '*').order('created_at'), q('completions', 'goal_id,done_on'),
      q('logs', 'log_date,note'), q('rest_days', 'day'), q('time_entries', 'id,goal_id,seconds,log_date,slot_idx,note,started_at,ended_at'), q('reviews', 'week_start,note'),
      q('slot_completions', 'goal_id,done_on,slot_idx,status,moved_to,moved_done,topic,note'), q('user_settings', '*')])
    const bad = [g, c, t, sl, us].find((x) => x.error)
    setNotice(bad ? `Could not load everything (${bad.error.message}). Run study_plans_migration.sql in the Supabase SQL Editor, then refresh.` : '')
    setGoals(g.data || []); setDone(c.data || []); setTimes(t.data || []); setSlots(sl.data || []); setSettings((us.data || [])[0] || {})
    setLogs(Object.fromEntries((l.data || []).map((x) => [x.log_date, x.note])))
    setRest(new Set((r.data || []).map((x) => x.day)))
    setReviews(Object.fromEntries((v.data || []).map((x) => [x.week_start, x.note])))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i) }, [])
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
  const isDone = (g) => g.period === 'plan' ? planInfo(g, slots, todayStr).finished : g.period === 'project'
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
  const addGoal = async (row) => {
    const { error } = await supabase.from('goals').insert(row)
    if (error) return error.message
    load()
  }
  const archive = async (g, v) => {
    await supabase.from('goals').update({ archived: v, archived_at: v ? new Date().toISOString() : null }).eq('id', g.id)
    load()
  }
  const updateGoal = async (id, patch) => {
    const { error } = await supabase.from('goals').update(patch).eq('id', id)
    if (error) return error.message
    await load()
  }
  const remove = (g) => setDelTarget(g)
  const confirmRemove = async () => {
    const g = delTarget
    setDelTarget(null)
    if (!g) return
    const { error } = await supabase.from('goals').delete().eq('id', g.id)
    if (error) setNotice(`Could not delete "${g.title}": ${error.message}`)
    load()
  }
  /* shift history: row = null clears it; otherwise { status, moved_to, moved_done } */
  const writeSlot = async (g, day, idx, row) => {
    const same = (x) => x.goal_id === g.id && x.done_on === day && x.slot_idx === idx
    const prev = slots.find(same)
    const payload = row ? {
      goal_id: g.id,
      done_on: day,
      slot_idx: idx,
      status: 'done',
      moved_to: null,
      moved_done: false,
      note: prev?.note ?? null,
      topic: prev?.topic ?? null,
      ...row,
    } : null
    setSlots((a) => [...a.filter((x) => !same(x)), ...(payload ? [payload] : [])])
    const del = await supabase.from('slot_completions').delete().eq('goal_id', g.id).eq('done_on', day).eq('slot_idx', idx)
    let error = del.error
    if (!error && payload) ({ error } = await supabase.from('slot_completions').upsert(payload, { onConflict: 'goal_id,done_on,slot_idx' }))
    if (error) setNotice(`Could not save that shift: ${error.message}`)
    await load()
  }
  const saveShiftNote = async (g, date, idx, note) => {
    const text = (note || '').trim()
    const match = slots.find((x) => x.goal_id === g.id && x.done_on === date && x.slot_idx === idx)
    if (!match || (match.status !== 'done' && !(match.status === 'moved' && match.moved_done))) return
    const row = {
      goal_id: g.id,
      done_on: date,
      slot_idx: idx,
      status: match?.status || 'done',
      moved_to: match?.moved_to || null,
      moved_done: !!match?.moved_done,
      note: text || null,
      topic: match?.topic || null,
    }
    const { error } = await supabase.from('slot_completions').upsert(row, { onConflict: 'goal_id,done_on,slot_idx' })
    if (error) setNotice(`Could not save that note: ${error.message}`)
    await load()
  }
  const origin = (it, date) => (it.movedIn ? it.from : date)
  const act = {
    toggle: (g, it, date) => it.movedIn
      ? writeSlot(g, it.from, it.idx, { status: 'moved', moved_to: date, moved_done: !it.done })
      : writeSlot(g, date, it.idx, it.done ? null : { status: 'done' }),
    skip: (g, it, date) => writeSlot(g, origin(it, date), it.idx, { status: 'skipped' }),
    miss: (g, it, date) => writeSlot(g, date, it.idx, { status: 'missed' }),
    move: (g, it, date, to) => writeSlot(g, date, it.idx, { status: 'moved', moved_to: to, moved_done: false }),
    restore: (g, it, date) => writeSlot(g, origin(it, date), it.idx, null),
    saveNote: saveShiftNote,
  }
  const saveSettings = async (patch) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return userError?.message || 'Please sign in to save your settings.'
    const { error } = await supabase.from('user_settings').upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    if (error) return error.message
    await load()
  }
  const saveNote = async (note) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return
    await supabase.from('logs').upsert({ user_id: user.id, log_date: todayStr, note }, { onConflict: 'user_id,log_date' })
    await load()
  }
  const saveReview = async (week_start, note) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return
    await supabase.from('reviews').upsert({ user_id: user.id, week_start, note }, { onConflict: 'user_id,week_start' })
    await load()
  }
  const toggleRest = async (day) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return
    if (rest.has(day)) await supabase.from('rest_days').delete().eq('user_id', user.id).eq('day', day)
    else {
      const start = fmt(weekStart(parse(day))), end = fmt(addDays(weekStart(parse(day)), 6))
      if ([...rest].some((d) => d >= start && d <= end)) return alert('You already planned a rest day for that week.')
      await supabase.from('rest_days').insert({ user_id: user.id, day })
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
    saveTimer({ logDate: todayStr, elapsedSeconds: 0, startedAt: Date.now(), sessionStart: Date.now() })
    setFocus(true)
    document.documentElement.requestFullscreen?.().catch(() => {})
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
    setFocus(true)
  }
  const atTime = (date, hmStr) => { const [h, m] = hmStr.split(':').map(Number), d = parse(date); d.setHours(h, m, 0, 0); return d.getTime() }
  /* unfinished shifts that overlap the study session, with the minutes of overlap */
  const overlaps = (from, to, date) => shiftsOn(live, slots, date).filter((x) => !x.it.done).map((x) => ({
    ...x, ov: Math.max(0, Math.min(to, atTime(date, x.it.e)) - Math.max(from, atTime(date, x.it.s))),
  })).filter((x) => x.ov > 0)
  /* Stop: the session is always saved on its own (it never depends on a shift). We ask what you studied,
     and offer to tick any planned shift the session mostly covered. */
  const stopTimer = () => {
    if (!timer || timerSaveInFlight.current || stopPrompt) return
    const endAt = Date.now(), seconds = elapsedAt(endAt)
    const startAt = timer.sessionStart ?? endAt - seconds * 1000
    if (seconds <= 0) return finishStop({ seconds: 0, picked: [], note: '', startAt, endAt })
    const matches = overlaps(startAt, endAt, timer.logDate)
    saveTimer({ ...timer, elapsedSeconds: seconds, startedAt: null })
    setStopPrompt({
      seconds, startAt, endAt, matches, note: '',
      picked: new Set(matches.filter((m) => m.ov >= (shiftMinutes(m.it.s, m.it.e) * 60000) / 2).map((m) => m.g.id + ':' + (m.it.from || '') + ':' + m.it.idx)),
    })
  }
  const cancelStop = () => { setStopPrompt(null); resumeTimer() }
  /* save the session (with what you studied); picked = planned shifts to tick off as done */
  const finishStop = async ({ seconds, picked, note, startAt, endAt }) => {
    if (timerSaveInFlight.current) return
    timerSaveInFlight.current = true
    try {
      const text = (note || '').trim()
      if (seconds > 0) {
        const { error } = await supabase.from('time_entries').insert({
          goal_id: null, seconds, log_date: timer.logDate, note: text || null,
          started_at: new Date(startAt).toISOString(), ended_at: new Date(endAt).toISOString(),
        })
        if (error) { setTimerError(`Could not save study time: ${error.message}`); setStopPrompt(null); return }
      }
      for (const m of picked) {
        const extra = text ? { note: text } : {}
        if (m.it.movedIn) await writeSlot(m.g, m.it.from, m.it.idx, { status: 'moved', moved_to: timer.logDate, moved_done: true, ...extra })
        else await writeSlot(m.g, timer.logDate, m.it.idx, { status: 'done', ...extra })
      }
      await load()
      setTimerError(''); setStopPrompt(null)
      saveTimer(null)
      setFocus(false)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    } finally {
      timerSaveInFlight.current = false
    }
  }
  const confirmStop = () => finishStop({
    seconds: stopPrompt.seconds, startAt: stopPrompt.startAt, endAt: stopPrompt.endAt, note: stopPrompt.note,
    picked: stopPrompt.matches.filter((m) => stopPrompt.picked.has(m.g.id + ':' + (m.it.from || '') + ':' + m.it.idx)),
  })

  const todaySecs = times.filter((t) => t.log_date === todayStr).reduce((a, t) => a + t.seconds, 0) + (timer && timer.logDate === todayStr ? elapsed : 0)
  const wkStart = fmt(weekStart(today))
  const weekSecs = times.filter((t) => t.log_date >= wkStart && t.log_date <= todayStr).reduce((a, t) => a + t.seconds, 0) + (timer && timer.logDate >= wkStart && timer.logDate <= todayStr ? elapsed : 0)

  /* finished shifts, dated by the day they were actually done (a moved shift counts on its new day) */
  const slotDone = useMemo(() => slots.flatMap((c) => {
    const g = goalMap[c.goal_id]
    if (!g) return []
    const date = c.status === 'done' ? c.done_on : c.status === 'moved' && c.moved_done ? c.moved_to : null
    if (!date) return []
    const sl = (g.schedule?.[dow(parse(c.done_on))] || [])[c.slot_idx]
    return [{ goal_id: c.goal_id, done_on: date, slot_idx: c.slot_idx, label: sl ? `${g.title} · ${formatTime(sl[0])}–${formatTime(sl[1])}` : g.title }]
  }), [slots, goalMap])
  const fslotDone = slotDone.filter((c) => inTag(goalMap[c.goal_id]))

  /* streak: rest days bridge a gap but don't add to the count */
  const active = useMemo(() => {
    const s = new Set([...done.map((c) => c.done_on), ...slotDone.map((c) => c.done_on)])
    Object.entries(logs).forEach(([d, n]) => n.trim() && s.add(d))
    const perDay = {}
    times.forEach((t) => { perDay[t.log_date] = (perDay[t.log_date] || 0) + t.seconds })
    Object.entries(perDay).forEach(([d, sec]) => { if (sec >= 60) s.add(d) })
    return s
  }, [done, slotDone, logs, times])
  /* Paused days always keep the streak. Free days, and days where every shift was skipped or moved, keep it
     too, but only 2 per calendar month in total. */
  const { planRest, pausedRest } = useMemo(() => {
    const cover = {}, paused = new Set()
    goals.filter((g) => g.period === 'plan').forEach((g) => {
      const stop = g.archived && g.archived_at ? localDate(g.archived_at) : null
      planInfo(g, slots, todayStr).days.forEach((d) => {
        if (d.date > todayStr || (stop && d.date > stop)) return
        if (d.state === 'paused') paused.add(d.date)
        const c = (cover[d.date] ||= { busy: false })
        if (d.state !== 'rest' && d.state !== 'skip' && d.state !== 'paused') c.busy = true
      })
    })
    const used = {}, out = new Set()
    Object.keys(cover).sort().forEach((k) => {
      if (cover[k].busy || active.has(k) || rest.has(k) || paused.has(k)) return
      const m = k.slice(0, 7)
      if ((used[m] || 0) < 2) { used[m] = (used[m] || 0) + 1; out.add(k) }
    })
    return { planRest: out, pausedRest: new Set([...paused].filter((k) => !cover[k]?.busy)) }
  }, [goals, slots, active, rest, todayStr])
  const restAll = useMemo(() => new Set([...rest, ...planRest, ...pausedRest]), [rest, planRest, pausedRest])
  const first = [...active].sort()[0]
  let streak = 0
  for (let d = active.has(todayStr) || restAll.has(todayStr) ? today : addDays(today, -1); ; d = addDays(d, -1)) {
    const k = fmt(d)
    if (active.has(k)) streak++
    else if (!restAll.has(k)) break
  }
  let longest = 0, run = 0
  if (first) for (let d = parse(first); fmt(d) <= todayStr; d = addDays(d, 1)) {
    const k = fmt(d)
    if (active.has(k)) { run++; longest = Math.max(longest, run) } else if (!restAll.has(k) && k !== todayStr) run = 0
  }
  const status = (d) => {
    if (active.has(d)) return 'hit'
    if (restAll.has(d)) return 'rest'
    if (d > todayStr) return 'future'
    if (d === todayStr) return 'pending'
    return first && d >= first ? 'miss' : 'future'
  }
  const hr = today.getHours(), hello = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
  const nowHm = new Date(now).toTimeString().slice(0, 5)
  const shiftsToday = shiftsOn(live, slots, todayStr), habitsToday = live.filter((g) => g.period === 'daily' && scheduled(g))
  useShiftReminders(shiftsToday, settings.reminder_lead ?? 5, todayStr)
  const shiftNow = shiftsToday.find((x) => !x.it.done && nowHm >= x.it.s && nowHm <= x.it.e) || null
  const openEdit = (g) => { setEditGoal(g); setSheet('edit') }
  const todays = [...shiftsToday, ...habitsToday]
  const todayDone = shiftsToday.filter((x) => x.it.done).length + habitsToday.filter(isDone).length
  const week = Array.from({ length: 7 }, (_, i) => fmt(addDays(weekStart(today), i)))
  const ctx = { today, todayStr, nowHm, goals, fgoals, live, goalMap, done, fdone, ftimes, times, logs, isDone, scheduled, toggle, act, onEdit: openEdit, timer, elapsed, startTimer, pauseTimer, resumeTimer, stopTimer, slots, slotDone, fslotDone, todaySecs, shiftsToday, habitsToday }
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
            <button className="primary new-btn" onClick={() => setSheet('choose')}>+ New</button>
            <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
        {timer && <section className={`timer-banner ${timer?.startedAt ? 'is-running' : 'is-paused'}`} aria-live="polite">
          <div>
            <span className="timer-status">{timer ? (timer.startedAt ? 'Study session in progress' : 'Study session paused') : 'Independent study timer'}</span>
            <strong>{timer ? 'Study time' : 'Track time spent studying'}</strong>
            <time>{clock(elapsed)}</time>
            <span className="timer-status">Today so far: {hm(todaySecs)} (all sessions added)</span>
          </div>
          <div className="timer-controls">
            {!timer
              ? <button className="primary" onClick={() => startTimer()}>Start timer</button>
              : timer.startedAt
              ? <button className="ghost" onClick={pauseTimer}>Pause</button>
              : <button className="primary" onClick={resumeTimer}>Resume</button>}
            {timer && <button className="ghost" onClick={() => setFocus(true)}>Full screen</button>}
            {timer && <button className="timer-stop" onClick={stopTimer}>Stop &amp; save</button>}
          </div>
        </section>}
        {timerError && <p className="msg" role="alert">{timerError}</p>}
        {notice && <p className="msg" role="alert">{notice} <button className="link" onClick={() => setNotice('')}>Dismiss</button></p>}
        <FocusOverlay open={focus && !stopPrompt} timer={timer} elapsed={elapsed} todaySecs={todaySecs} error={timerError} shiftNow={shiftNow}
          onPause={pauseTimer} onResume={resumeTimer} onStop={stopTimer} onMinimize={() => setFocus(false)} />
        <StopPrompt prompt={stopPrompt} setPrompt={setStopPrompt} onSave={confirmStop} onCancel={cancelStop} />
        <ConfirmDelete goal={delTarget} onCancel={() => setDelTarget(null)} onConfirm={confirmRemove} />
        <NewSheet view={sheet} setView={setSheet} tags={tags} onAdd={addGoal} todayStr={todayStr} editGoal={editGoal} onEdit={updateGoal}
          settings={<SettingsPanel settings={settings} onSave={saveSettings} />}
          manage={<ManageGoals {...ctx} onArchive={archive} onRemove={remove} />} />
        {tab === 'dashboard' && (goals.length === 0
          ? <Welcome onPlan={() => setSheet('plan')} onOther={() => setSheet('choose')} />
          : <>
            {dow(today) === 6 && <div className="banner">It’s Sunday. <button className="link" onClick={() => setTab('insights')}>Start your weekly review</button></div>}
            <Hero n={todayDone} total={todays.length} streak={streak} longest={longest} week={week} status={status} todayStr={todayStr} />
            {(!timer || settings.daily_target_minutes || settings.weekly_target_minutes) &&
              <StudyTarget todaySecs={todaySecs} weekSecs={weekSecs} settings={settings} timer={timer} startTimer={startTimer} onSetup={() => setSheet('settings')} />}
            <TodayList {...ctx} />
            <PlanToday {...ctx} onRemove={remove} />
            <ProjectGoals {...ctx} />
            <p className="manage-links">
              <button className="link manage-link" onClick={() => setSheet('manage')}>Manage &amp; archive goals</button>
              <button className="link manage-link" onClick={() => setSheet('settings')}>Reminders &amp; study targets</button>
            </p>
          </>)}
        {tab === 'history' && <LogsTab {...ctx} tag={tag} onSave={saveNote} />}
        {tab === 'insights' && <Insights {...ctx} reviews={reviews} onSaveReview={saveReview}
          streakNode={<Streak {...ctx} status={status} selected={selected} onSelect={setSelected} stats={{ streak, longest, total: active.size }} rest={rest} onRest={toggleRest} />} />}
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
function Streak({ today, todayStr, status, selected, onSelect, stats, done, goalMap, logs, rest, onRest, slotDone, times }) {
  const [restDate, setRestDate] = useState(todayStr)
  const [mo, setMo] = useState(0)
  const m = new Date(today.getFullYear(), today.getMonth() + mo, 1)
  const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  const cells = [...Array(dow(m)).fill(null), ...Array.from({ length: n }, (_, i) => fmt(new Date(m.getFullYear(), m.getMonth(), i + 1)))]
  const hits = cells.filter((d) => d && status(d) === 'hit').length
  const words = { hit: 'Done', miss: 'Missed', pending: 'Open today', future: 'No data', rest: 'Rest day' }
  const titles = done.filter((c) => c.done_on === selected).map((c) => goalMap[c.goal_id]?.title).filter(Boolean)
    .concat(slotDone.filter((c) => c.done_on === selected).map((c) => c.label))
  const note = (logs[selected] || '').trim()
  const sessions = times.filter((t) => t.log_date === selected && !t.goal_id && t.seconds > 0)
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
      <details className="more streak-help">
        <summary>How streaks work</summary>
        <ul>
          <li><b>A day counts</b> when you finish any shift or habit, save a progress note, or save a study-timer session (1 minute or more). That works on rest days and free days too.</li>
          <li><b>Missing a day</b> resets the streak, unless that day is covered below.</li>
          <li><b>Rest days</b> you plan yourself (one per week) bridge a gap but do not add to the count.</li>
          <li><b>Plan free days</b> and days where every shift was skipped or moved are covered too, up to 2 per month. Pick the days that matter.</li>
          <li><b>Paused plans</b> are always covered, with no limit.</li>
          <li>A shift you <b>move</b> counts on the day you actually do it.</li>
        </ul>
      </details>
      <div className="detail">
        <h3>{longDate(selected)}{selected === todayStr ? ' · today' : ''} <span className={`pill ${status(selected)}`}>{words[status(selected)]}</span></h3>
        {titles.length > 0 && <p className="chips">{titles.map((t, i) => <span className="chip" key={i}>✓ {t}</span>)}</p>}
        {sessions.length > 0 && <p className="chips">{sessions.map((t, i) => <span className="chip" key={t.id || i}>⏱ {hm(t.seconds)}{t.note ? ` · ${t.note}` : ''}</span>)}</p>}
        {note && <p className="note">{note}</p>}
        {!titles.length && !note && !sessions.length && <p className="muted">Nothing recorded for this day.</p>}
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

function Welcome({ onPlan, onOther }) {
  return (
    <section className="panel welcome">
      <h2>Welcome to Streakbook 👋</h2>
      <ol>
        <li><b>Create</b> a study plan or a simple habit.</li>
        <li><b>Tick it off</b> each day on this screen.</li>
        <li><b>Watch your streak</b> grow.</li>
      </ol>
      <button className="primary" onClick={onPlan}>Create your first study plan</button>
      <button className="link" onClick={onOther}>or add a simple habit or deadline</button>
    </section>
  )
}

const Tick = () => <svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.8 3.8 7.2-8.3" /></svg>

/* one list for everything that is due today: timed shifts first, then daily habits */
function TodayList(c) {
  const { live, isDone, toggle, act, todayStr, nowHm, times, shiftsToday, habitsToday, slots } = c
  const items = [
    ...shiftsToday.map((x) => ({ key: `s${x.g.id}:${x.it.from || ''}:${x.it.idx}`, time: x.it.s, done: x.it.done, shift: x })),
    ...habitsToday.map((g) => ({ key: g.id, time: '99:99', done: isDone(g), habit: g })),
  ].sort((a, b) => Number(a.done) - Number(b.done) || a.time.localeCompare(b.time))
  const n = items.filter((i) => i.done).length
  const longer = live.filter((g) => g.period === 'weekly' || g.period === 'monthly')
  const free = freeToday(live, slots, todayStr), paused = pausedToday(live, slots, todayStr)
  return (
    <section className="panel">
      <h2>Today <small>{n} of {items.length} done</small></h2>
      <div className="bar"><div style={{ width: items.length ? `${(n / items.length) * 100}%` : 0 }} /></div>
      <ul className="plain">
        {items.map((i) => i.shift
          ? <ShiftRow key={i.key} g={i.shift.g} it={i.shift.it} date={todayStr} todayStr={todayStr} nowHm={nowHm} times={times} act={act}
              maxDate={planInfo(i.shift.g, slots, todayStr).end} showTitle />
          : (
          <li key={i.key} className={`goal-item ${i.done ? 'completed' : ''}`}>
            <button className="check" aria-pressed={i.done} aria-label={i.done ? `Undo ${i.habit.title}` : `Mark ${i.habit.title} done`} onClick={() => toggle(i.habit)}><Tick /></button>
            <div className="grow"><span className="gt">{i.habit.title}</span><Meta g={i.habit} {...c} /></div>
          </li>
        ))}
        {!items.length && <li className="muted">{paused.length ? '⏸ Your plan is paused. Nothing due, and your streak is safe.' : free.length ? '🌿 Free day. Nothing scheduled, enjoy the rest.' : 'Nothing scheduled today.'}</li>}
      </ul>
      {free.length > 0 && items.length > 0 && <p className="muted small">🌿 Free day for {free.map((g) => g.title).join(', ')}</p>}
      {paused.length > 0 && items.length > 0 && <p className="muted small">⏸ Paused: {paused.map((g) => g.title).join(', ')}</p>}
      {longer.length > 0 && (
        <details className="fold-in">
          <summary>This week &amp; this month <span>{longer.filter(isDone).length}/{longer.length} done</span></summary>
          <ul className="plain">
            {longer.map((g) => (
              <li key={g.id} className={`goal-item ${isDone(g) ? 'completed' : ''}`}>
                <button className="check" aria-pressed={isDone(g)} aria-label={isDone(g) ? `Undo ${g.title}` : `Mark ${g.title} done`} onClick={() => toggle(g)}><Tick /></button>
                <div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} /></div>
                <em className="tag">{g.period === 'weekly' ? 'This week' : 'This month'}</em>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/* ---------- study-time target: daily ring + weekly bar + start button ---------- */
function StudyTarget({ todaySecs, weekSecs, settings, timer, startTimer, onSetup }) {
  const dT = (settings.daily_target_minutes || 0) * 60, wT = (settings.weekly_target_minutes || 0) * 60
  const C = 2 * Math.PI * 30, frac = dT ? Math.min(1, todaySecs / dT) : 0
  return (
    <section className="panel target">
      {dT > 0 && <div className="tring" role="img" aria-label={`${Math.round(frac * 100)} percent of today's study target`}>
        <svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" className="trk" />
          <circle cx="36" cy="36" r="30" className="val" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} /></svg>
        <b>{Math.round(frac * 100)}%</b>
      </div>}
      <div className="grow">
        <b>{hm(todaySecs)}{dT > 0 && <> of {hm(dT)}</>} <span className="muted">today</span></b>
        {dT > 0 && todaySecs >= dT && <span className="muted small block">Daily target reached</span>}
        {wT > 0 && <><div className="bar"><div style={{ width: `${Math.min(100, (weekSecs / wT) * 100)}%` }} /></div><span className="muted small">{hm(weekSecs)} of {hm(wT)} this week</span></>}
        {!dT && !wT && <button className="link" onClick={onSetup}>Set a daily or weekly study target</button>}
      </div>
      {!timer && <button className="primary" onClick={() => startTimer()}>▶ Start studying</button>}
    </section>
  )
}

/* ---------- Stop & save: what did you study? (+ optionally tick shifts it covered) ---------- */
function StopPrompt({ prompt, setPrompt, onSave, onCancel }) {
  if (!prompt) return null
  const keyOf = (m) => m.g.id + ':' + (m.it.from || '') + ':' + m.it.idx
  const flip = (k) => setPrompt((p) => { const picked = new Set(p.picked); picked.has(k) ? picked.delete(k) : picked.add(k); return { ...p, picked } })
  return (
    <div className="sheet-bg confirm-bg">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Save study session">
        <header className="sheet-head"><span /><strong>You studied {hm(prompt.seconds)}</strong><span /></header>
        <label className="lbl">What did you study?
          <textarea autoFocus rows={3} value={prompt.note} onChange={(e) => setPrompt((p) => ({ ...p, note: e.target.value }))}
            placeholder="e.g. Positional encoding and multi-head attention" /></label>
        {prompt.matches.length > 0 && <>
          <p className="muted small">This session overlapped a planned shift. Tick any shift it completed:</p>
          <ul className="plain">
            {prompt.matches.map((m) => (
              <li key={keyOf(m)}>
                <label className="check-line">
                  <input type="checkbox" checked={prompt.picked.has(keyOf(m))} onChange={() => flip(keyOf(m))} />
                  <span><b>{m.g.title}</b> <span className="muted">{formatTime(m.it.s)} – {formatTime(m.it.e)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </>}
        <div className="wiz-nav">
          <button type="button" className="link" onClick={onCancel}>Keep studying</button>
          <button type="button" className="primary" onClick={onSave}>Save session</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- delete forever: type the goal's name ---------- */
function ConfirmDelete({ goal, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  useEffect(() => { setTyped('') }, [goal?.id])
  if (!goal) return null
  const ok = typed.trim().toLowerCase() === goal.title.trim().toLowerCase()
  return (
    <div className="sheet-bg confirm-bg" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="sheet" role="alertdialog" aria-modal="true" aria-label={`Delete ${goal.title}`} onSubmit={(e) => { e.preventDefault(); if (ok) onConfirm() }}>
        <header className="sheet-head"><span /><strong>Delete forever?</strong><button type="button" className="x" aria-label="Close" onClick={onCancel}>×</button></header>
        <p>“{goal.title}” and all of its history will be removed. This cannot be undone. Archiving keeps the history.</p>
        <label className="lbl">Type the name to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder={goal.title} /></label>
        <div className="wiz-nav">
          <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary danger" disabled={!ok}>Delete forever</button>
        </div>
      </form>
    </div>
  )
}

function ProjectGoals(c) {
  const projects = c.live.filter((g) => g.period === 'project')
    .sort((a, b) => Number(c.isDone(a)) - Number(c.isDone(b)) ||
      (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'))
  if (!projects.length) return null
  return (
    <details className="panel fold">
      <summary>Deadlines <span>{projects.filter((g) => !c.isDone(g)).length} remaining</span></summary>
      <ul className="plain">
        {projects.map((g) => (
          <li key={g.id} className={`goal-item ${c.isDone(g) ? 'completed' : 'remaining'}`}>
            <button className="check" aria-pressed={c.isDone(g)}
              aria-label={c.isDone(g) ? `Undo ${g.title}` : `Mark ${g.title} done`}
              onClick={() => c.toggle(g)}><Tick /></button>
            <div className="grow"><span className="gt">{g.title}</span><Meta g={g} {...c} /></div>
          </li>
        ))}
      </ul>
    </details>
  )
}

/* ---------- manage: list, archive, restore, delete ---------- */
function ManageGoals(c) {
  const { goals, live, onArchive, onRemove, onEdit } = c
  const [showArch, setShowArch] = useState(false)
  const arch = goals.filter((g) => g.archived)
  const groups = [['plan', 'Study plans'], ['daily', 'Daily habits'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['project', 'Deadlines']]
  const detail = (g) => g.period === 'plan'
    ? <span className="meta">{g.tag && <em className="tag">{g.tag}</em>}<em className="due">{g.start_date} → {g.due_date}</em></span>
    : <Meta g={g} {...c} />
  if (!goals.length) return <p className="muted">Nothing here yet. Use “+ New” to add your first goal.</p>
  return (
    <div className="stack">
      {groups.map(([p, label]) => live.some((g) => g.period === p) && (
        <section className="panel" key={p}>
          <h2>{label} <small>{live.filter((g) => g.period === p).length}</small></h2>
          <ul className="plain">
            {live.filter((g) => g.period === p).map((g) => (
              <li key={g.id}><div className="grow"><span className="gt">{g.title}</span>{detail(g)}</div>
                <div className="acts">{g.period === 'plan' && <button className="ghost" onClick={() => onEdit(g)}>Edit</button>}
                  <button className="ghost" onClick={() => onArchive(g, true)}>Archive</button></div></li>
            ))}
          </ul>
        </section>
      ))}
      {arch.length > 0 && (
        <section className="panel">
          <h2>Archived <small>{arch.length}</small></h2>
          <button className="link" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide' : 'Show'} archived goals</button>
          {showArch && <ul className="plain">{arch.map((g) => (
            <li key={g.id}><div className="grow"><span className="gt">{g.title}</span>{detail(g)}</div>
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
function Insights({ today, todayStr, goals, fgoals, live, fdone, ftimes, logs, reviews, isDone, timer, elapsed, onSaveReview, slots, slotDone, fslotDone, streakNode }) {
  const [view, setView] = useState('overview')
  const [off, setOff] = useState(0), [note, setNote] = useState(''), [saved, setSaved] = useState(false)
  const ws = fmt(addDays(weekStart(today), 7 * off)), we = fmt(addDays(parse(ws), 6))
  useEffect(() => { setNote(reviews[ws] || '') }, [ws, reviews])
  const inR = (d) => d >= ws && d <= we
  const fall = [...fdone, ...fslotDone] // habits and plan shifts
  const wd = fall.filter((c) => inR(c.done_on))
  const per = {}; wd.forEach((c) => (per[c.done_on] = (per[c.done_on] || 0) + 1))
  const days = new Set([...slotDone.filter((c) => inR(c.done_on)).map((c) => c.done_on), ...Object.keys(per), ...ftimes.filter((t) => inR(t.log_date) && t.seconds >= 60).map((t) => t.log_date), ...Object.keys(logs).filter((d) => inR(d) && logs[d].trim())]).size
  const best = Object.entries(per).sort((a, b) => b[1] - a[1])[0]
  const activeSessionSeconds = timer ? elapsed : 0
  const sessionInSelectedWeek = timer && timer.logDate >= ws && timer.logDate <= we ? activeSessionSeconds : 0
  const secs = ftimes.filter((t) => inR(t.log_date)).reduce((a, t) => a + t.seconds, 0) + sessionInSelectedWeek
  const currentWeekStart = fmt(weekStart(today))
  const previousWeekStart = fmt(addDays(weekStart(today), -7))
  const previousWeekEnd = fmt(addDays(parse(previousWeekStart), 6))
  const currentWeekDone = fall.filter((c) => c.done_on >= currentWeekStart && c.done_on <= todayStr)
  const previousWeekDone = fall.filter((c) => c.done_on >= previousWeekStart && c.done_on <= previousWeekEnd)
  const currentWeekDays = new Set([
    ...currentWeekDone.map((c) => c.done_on),
    ...Object.keys(logs).filter((d) => d >= currentWeekStart && d <= todayStr && logs[d].trim())
  ]).size
  const currentWeekSeconds = ftimes.filter((t) => t.log_date >= currentWeekStart && t.log_date <= todayStr)
    .reduce((a, t) => a + t.seconds, 0) +
    (timer && timer.logDate >= currentWeekStart && timer.logDate <= todayStr ? activeSessionSeconds : 0)
  const studyWeekly = Array.from({ length: 8 }, (_, i) => {
    const start = fmt(addDays(weekStart(today), -7 * (7 - i)))
    const end = fmt(addDays(parse(start), 6))
    let seconds = ftimes.filter((t) => t.log_date >= start && t.log_date <= end)
      .reduce((a, t) => a + t.seconds, 0)
    if (timer && timer.logDate >= start && timer.logDate <= end) seconds += activeSessionSeconds
    return { l: `${MONTHS[parse(start).getMonth()]} ${parse(start).getDate()}`, v: Math.round((seconds / 3600) * 10) / 10 }
  })
  const deadlineGoals = live.filter((g) => g.period !== 'plan' && g.due_date && !isDone(g))
    .map((g) => ({ ...g, daysLeft: Math.round((parse(g.due_date) - parse(todayStr)) / 864e5) }))
    .filter((g) => g.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5)
  const cut30 = fmt(addDays(today, -29)), cut14 = fmt(addDays(today, -14))
  const act30 = new Set([...fdone.filter((c) => c.done_on >= cut30).map((c) => c.done_on),
    ...fslotDone.filter((c) => c.done_on >= cut30 && c.done_on <= todayStr).map((c) => c.done_on),
    ...ftimes.filter((t) => t.log_date >= cut30 && t.log_date <= todayStr && t.seconds >= 60).map((t) => t.log_date),
    ...Object.keys(logs).filter((d) => d >= cut30 && d <= todayStr && logs[d].trim())]).size
  const courses = live.filter((g) => g.target).map((g) => ({ g, n: fdone.filter((c) => c.goal_id === g.id).length }))
  const stalled = live.filter((g) => g.period !== 'plan' && (localDate(g.created_at) || '') < cut14 && !fdone.some((c) => c.goal_id === g.id && c.done_on >= cut14)).slice(0, 4)
  /* completion rate per goal: shifts for a study plan; finished periods for a habit; done/open for a deadline.
     The period that is still running (today, this week, this month) only counts once it is done. */
  const goalRates = live.map((g) => {
    if (g.period === 'plan') {
      const i = planInfo(g, slots, todayStr), due = i.doneAll + i.missed
      return { g, kind: 'Study plan', pct: due ? Math.round((i.doneAll / due) * 100) : null, detail: `${i.doneAll} of ${due} shifts done${i.left ? ` · ${i.left} to go` : ''}` }
    }
    const mine = fdone.filter((c) => c.goal_id === g.id)
    if (g.period === 'project') {
      const isFin = mine.length > 0
      return { g, kind: 'Deadline', pct: isFin ? 100 : null, label: isFin ? 'Done' : 'Open', detail: g.due_date ? `Due ${shortDate(g.due_date)}` : 'No date' }
    }
    const keyOf = (d) => (g.period === 'daily' ? d : g.period === 'weekly' ? fmt(weekStart(parse(d))) : d.slice(0, 7))
    const created = localDate(g.created_at) || todayStr, possible = new Set()
    for (let d = created; d <= todayStr; d = fmt(addDays(parse(d), 1)))
      if (!(g.period === 'daily' && g.days?.length && !g.days.includes(dow(parse(d))))) possible.add(keyOf(d))
    const doneKeys = new Set(mine.map((c) => c.done_on).filter((d) => d >= created && !(g.period === 'daily' && g.days?.length && !g.days.includes(dow(parse(d))))).map(keyOf))
    const current = keyOf(todayStr)
    const total = possible.size - (possible.has(current) && !doneKeys.has(current) ? 1 : 0)
    const hit = [...doneKeys].filter((k) => possible.has(k)).length
    const unit = g.period === 'daily' ? 'days' : g.period === 'weekly' ? 'weeks' : 'months'
    return { g, kind: g.period === 'daily' ? 'Daily habit' : g.period === 'weekly' ? 'Weekly habit' : 'Monthly habit', pct: total > 0 ? Math.min(100, Math.round((hit / total) * 100)) : null, detail: total > 0 ? `${hit} of ${total} ${unit}` : 'Just started' }
  }).sort((a, b) => (a.g.period === 'plan' ? 0 : 1) - (b.g.period === 'plan' ? 0 : 1) || a.kind.localeCompare(b.kind))
  const dlt = currentWeekDone.length - previousWeekDone.length
  const save = async () => { await onSaveReview(ws, note); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  return (
    <div className="stack">
      <div className="seg insight-tabs" role="tablist" aria-label="Insights sections">
        {[['overview', 'Overview'], ['plans', 'Study plans'], ['trends', 'Trends']].map(([k, l]) =>
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
      </div>

      {view === 'overview' && <>
        <section className="insight-summary" aria-label="At a glance">
          <div><b>{currentWeekDone.length}</b><span>done this week</span><small>{dlt >= 0 ? '+' : ''}{dlt} vs last week</small></div>
          <div><b>{act30}<em>/30</em></b><span>active days</span><small>last 30 days</small></div>
          <div><b>{hm(currentWeekSeconds)}</b><span>study time</span><small>this week</small></div>
        </section>
        {streakNode}
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
          <p className="muted small">Do it once today, or archive it from “Manage &amp; archive goals” on the Dashboard.</p>
        </section>}
        {deadlineGoals.length > 0 && <section className="panel deadlines">
          <h2>Deadlines <small>next 14 days</small></h2>
          <ul className="plain">
            {deadlineGoals.map((g) => <li key={g.id}>
              <div className="grow"><span className="gt">{g.title}</span><Meta g={g} done={fdone} todayStr={todayStr} isDone={isDone} times={ftimes} /></div>
              <span className={`deadline-label ${g.daysLeft < 0 ? 'late' : ''}`}>
                {g.daysLeft < 0 ? `${-g.daysLeft}d overdue` : g.daysLeft === 0 ? 'Due today' : `${g.daysLeft}d left`}
              </span>
            </li>)}
          </ul>
        </section>}
      </>}

      {view === 'plans' && <PlanProgress goals={goals} slots={slots} todayStr={todayStr} />}

      {view === 'trends' && <>
        <StudyWeek today={today} todayStr={todayStr} ftimes={ftimes} timer={timer} elapsed={elapsed} />
        <section className="panel"><h2>Study time per week</h2><Bars data={studyWeekly} unit="h" /></section>
        <section className="panel">
          <h2>Completion rate <small>per goal</small></h2>
          {goalRates.length ? <ul className="plain">{goalRates.map((r) => <li key={r.g.id}>
            <div className="grow">
              <span className="gt">{r.g.title}</span>
              <span className="meta"><em className="tag">{r.kind}</em><em className="due">{r.detail}</em></span>
              <div className="track"><i style={{ width: `${r.pct ?? 0}%` }} /></div>
            </div>
            <b className="cnt">{r.label || (r.pct === null ? '–' : `${r.pct}%`)}</b></li>)}</ul>
            : <p className="muted small">Add a study plan or habit to see its completion rate here.</p>}
          <p className="muted small">Study plans: shifts done ÷ shifts due so far. Habits: finished days, weeks or months ÷ those that have passed.</p>
        </section>
        {courses.length > 0 && <section className="panel">
          <h2>Course progress <small>{courses.length} tracked</small></h2>
          <ul className="plain">{courses.map(({ g, n }) => <li key={g.id}>
            <div className="grow"><span className="gt">{g.title}</span><div className="track"><i style={{ width: `${Math.min(100, (n / g.target) * 100)}%` }} /></div></div>
            <b className="cnt">{n}/{g.target}</b></li>)}</ul>
        </section>}
      </>}
    </div>
  )
}

/* ---------- history: a day-by-day learning journal, grouped by week ---------- */
function LogsTab({ today, todayStr, logs, done, goalMap, slots, times, tag, onSave }) {
  const [note, setNote] = useState(logs[todayStr] || ''), [saved, setSaved] = useState(false)
  const [q, setQ] = useState(''), [month, setMonth] = useState(''), [type, setType] = useState('all')
  const save = async () => { await onSave(note); setSaved(true); setTimeout(() => setSaved(false), 1500) }

  /* one record per day: shifts finished, extra study sessions, habits ticked, the day note, total time studied */
  const days = useMemo(() => {
    const by = {}, get = (d) => (by[d] ||= { date: d, note: '', shifts: [], sessions: [], habits: [], secs: 0 })
    if (!tag) Object.entries(logs).forEach(([d, n]) => n.trim() && (get(d).note = n.trim()))
    slots.forEach((c) => {
      const g = goalMap[c.goal_id]
      if (!g || (tag && g.tag !== tag)) return
      const date = c.status === 'done' ? c.done_on : c.status === 'moved' && c.moved_done ? c.moved_to : null
      if (!date) return
      const meta = shiftInfo((g.schedule?.[dow(parse(c.done_on))] || [])[c.slot_idx])
      get(date).shifts.push({
        key: `${c.goal_id}:${c.done_on}:${c.slot_idx}`, title: g.title, s: meta.s, e: meta.e, topic: meta.topic,
        note: (c.note || '').trim(), from: c.status === 'moved' ? c.done_on : null, studied: studiedOn(times, g.id, c.done_on, c.slot_idx),
      })
    })
    done.forEach((c) => { const g = goalMap[c.goal_id]; if (g && (!tag || g.tag === tag)) get(c.done_on).habits.push(g) })
    times.forEach((t) => {
      if (t.seconds <= 0) return
      const g = t.goal_id ? goalMap[t.goal_id] : null
      if (tag && !(g && g.tag === tag)) return
      const day = get(t.log_date)
      day.secs += t.seconds
      if (!t.goal_id) day.sessions.push({ key: t.id || `${t.log_date}:${t.started_at}`, secs: t.seconds, note: (t.note || '').trim(), start: t.started_at, end: t.ended_at })
    })
    Object.values(by).forEach((d) => {
      d.shifts.sort((a, b) => a.s.localeCompare(b.s))
      d.sessions.sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    })
    return Object.values(by).sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [logs, done, slots, times, goalMap, tag])

  const byDate = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d])), [days])
  const noteCount = (e) => (e.note ? 1 : 0) + e.shifts.filter((x) => x.note).length + e.sessions.filter((x) => x.note).length
  const cut = fmt(addDays(today, -29))
  const recent = days.filter((d) => d.date >= cut)
  const sum = { secs: recent.reduce((a, d) => a + d.secs, 0), shifts: recent.reduce((a, d) => a + d.shifts.length, 0), active: recent.length, notes: recent.reduce((a, d) => a + noteCount(d), 0) }
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = fmt(addDays(today, i - 13)), e = byDate[d]
    return { d, n: +d.slice(8), v: e ? Math.round(e.secs / 360) / 10 : 0 }
  })
  const maxV = Math.max(0.1, ...last14.map((b) => b.v))

  const s = q.trim().toLowerCase()
  const text = (e) => [e.note, ...e.shifts.flatMap((x) => [x.title, x.topic, x.note]), ...e.sessions.map((x) => x.note), ...e.habits.map((h) => h.title)].join(' ').toLowerCase()
  const has = { shifts: (e) => e.shifts.length > 0, sessions: (e) => e.sessions.length > 0, notes: (e) => noteCount(e) > 0, habits: (e) => e.habits.length > 0 }
  const shown = days.filter((e) => (!month || e.date.startsWith(month)) && (type === 'all' || has[type](e)) && (!s || text(e).includes(s)))
  const weeks = []
  shown.forEach((e) => {
    const k = fmt(weekStart(parse(e.date)))
    let w = weeks[weeks.length - 1]
    if (!w || w.key !== k) weeks.push((w = { key: k, days: [] }))
    w.days.push(e)
  })
  const thisWeek = fmt(weekStart(today)), lastWeek = fmt(addDays(weekStart(today), -7))
  const weekName = (k) => (k === thisWeek ? 'This week' : k === lastWeek ? 'Last week' : `Week of ${parse(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`)
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

  return (
    <div className="stack">
      <section className="panel progress-entry">
        <h2>Enter today’s progress</h2>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on or learn today?" />
        <button className="primary" onClick={save}>{saved ? 'Saved ✓' : 'Save today’s progress'}</button>
      </section>

      <section className="panel">
        <h2>Last 30 days{tag ? ` · ${tag}` : ''}</h2>
        <div className="hsum">
          <div><b>{hm(sum.secs)}</b><span>studied</span></div>
          <div><b>{sum.shifts}</b><span>shifts finished</span></div>
          <div><b>{sum.active}</b><span>days with activity</span></div>
          <div><b>{sum.notes}</b><span>things you wrote down</span></div>
        </div>
        <div className="bars hbars" role="img" aria-label="Hours studied per day, last 14 days">
          {last14.map((b) => <div key={b.d} className={b.d === todayStr ? 'now' : ''}><b>{b.v || ''}</b>
            <div className="col"><i style={{ height: `${(b.v / maxV) * 100}%`, opacity: b.v ? 1 : 0 }} /></div><small>{b.n}</small></div>)}
        </div>
        <p className="muted small">Hours studied per day, last 14 days.</p>
      </section>

      <section className="panel">
        <h2>Journal <small>{shown.length} of {days.length} days</small></h2>
        <div className="filters">
          <input placeholder="Search topics, notes and goals" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month" />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Show">
            <option value="all">Everything</option><option value="shifts">Plan shifts</option><option value="sessions">Study sessions</option>
            <option value="notes">Only days with notes</option><option value="habits">Habits &amp; goals</option>
          </select>
          {(q || month || type !== 'all') && <button className="link" onClick={() => { setQ(''); setMonth(''); setType('all') }}>Clear</button>}
        </div>
        {weeks.map((w, wi) => {
          const secs = w.days.reduce((a, d) => a + d.secs, 0), shifts = w.days.reduce((a, d) => a + d.shifts.length, 0)
          return (
            <details className="hweek" key={w.key} open={wi < 2 || !!s}>
              <summary>{weekName(w.key)}<span>{[secs > 0 && hm(secs), shifts > 0 && plural(shifts, 'shift'), plural(w.days.length, 'active day')].filter(Boolean).join(' · ')}</span></summary>
              {w.days.map((e) => (
                <article className="hday" key={e.date}>
                  <header>
                    <b>{shortDate(e.date)}{e.date === todayStr ? ' · today' : ''}</b>
                    <span className="hpills">
                      {e.secs > 0 && <em className="hpill time">⏱ {hm(e.secs)}</em>}
                      {e.shifts.length > 0 && <em className="hpill">{plural(e.shifts.length, 'shift')}</em>}
                      {e.sessions.length > 0 && <em className="hpill">{plural(e.sessions.length, 'session')}</em>}
                      {e.habits.length > 0 && <em className="hpill">{plural(e.habits.length, 'habit')}</em>}
                    </span>
                  </header>
                  {e.shifts.length > 0 && <>
                    <span className="hlabel">Plan shifts</span>
                    <ul className="hlist">{e.shifts.map((x) => (
                      <li className="hitem" key={x.key}>
                        <span className="hrow"><b>{x.title}</b>{x.s && <span className="muted small">{formatTime(x.s)} – {formatTime(x.e)}</span>}
                          {x.topic && <em className="tag">{x.topic}</em>}{x.from && <em className="due">moved from {shortDate(x.from)}</em>}</span>
                        {x.note ? <p className="note learned">{x.note}</p> : <p className="muted small">No note for this shift.</p>}
                        {x.studied > 0 && <span className="muted small">{hm(x.studied)} on the timer</span>}
                      </li>))}
                    </ul>
                  </>}
                  {e.sessions.length > 0 && <>
                    <span className="hlabel">Study sessions</span>
                    <ul className="hlist">{e.sessions.map((x) => (
                      <li className="hitem" key={x.key}>
                        <span className="hrow"><b>{hm(x.secs)}</b>{x.start && x.end && <span className="muted small">{clockTime(x.start)} – {clockTime(x.end)}</span>}</span>
                        {x.note ? <p className="note learned">{x.note}</p> : <p className="muted small">No note for this session.</p>}
                      </li>))}
                    </ul>
                  </>}
                  {e.habits.length > 0 && <>
                    <span className="hlabel">Habits &amp; goals</span>
                    <p className="chips">{e.habits.map((g) => <span key={g.id} className="chip">✓ {g.title}</span>)}</p>
                  </>}
                  {e.note && <>
                    <span className="hlabel">Day note</span>
                    <p className="note">{e.note}</p>
                  </>}
                </article>
              ))}
            </details>
          )
        })}
        {!shown.length && <p className="muted">{days.length ? 'Nothing matches these filters.' : 'Nothing yet. Finish a shift or save a study session and it will show up here.'}</p>}
      </section>
    </div>
  )
}