import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import FeatureTracker from './tracker.jsx'

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
        <h1>Streakbook</h1>
        <p className="muted">Plan your study, tick off each shift, keep the streak alive.</p>
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