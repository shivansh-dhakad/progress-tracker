import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import FeatureTracker from './tracker.jsx'
import Icon from './icons.jsx'

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
  const [show, setShow] = useState(false)
  return (
    <main className="auth">
      <div className="auth-brand">Streakbook</div>
      <form onSubmit={submit} className="panel">
        <div className="auth-title"><h1>{mode === 'signin' ? 'Welcome back' : 'Join Streakbook'}</h1><span className="auth-pill"><Icon name="flame" fill size={14} />Study streaks</span></div>
        <p className="muted">Plan your study, tick off each shift, keep the streak alive.</p>
        <label className="field"><span>Email address</span>
          <div className="field-box"><Icon name="mail" /><input type="email" placeholder="name@university.edu" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></label>
        <label className="field"><span>Password (min 6 characters)</span>
          <div className="field-box"><Icon name="lock" />
            <input type={show ? 'text' : 'password'} placeholder="••••••••" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            <button type="button" className="eye" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} /></button></div></label>
        <button className="primary big">{mode === 'signin' ? 'Sign in' : 'Create account'}<Icon name="arrow" /></button>
        {msg && <p className="msg" role="alert">{msg}</p>}
        <div className="auth-tip"><span><Icon name="bolt" fill /></span><p><b>Plan first, study second.</b> Shifts you schedule in the morning are the ones that get done.</p></div>
        <p className="auth-switch">{mode === 'signin' ? 'New here?' : 'Have an account?'} <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}</button></p>
      </form>
    </main>
  )
}