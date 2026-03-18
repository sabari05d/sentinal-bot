import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Lock, Mail, ShieldAlert, ArrowRight } from 'lucide-react'
import axios from 'axios'

const API = 'http://localhost:8000'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // true  → owner exists → show login only, no sign-up toggle ever
  // false → no owner yet → show sign-up by default
  const [userExists, setUserExists] = useState(true)   // default true = safe fallback
  const [checkingUser, setCheckingUser] = useState(true)

  const navigate = useNavigate()

  useEffect(() => {
    async function checkLock() {
      try {
        const { data } = await axios.get(`${API}/api/has_users`)
        if (data.has_users) {
          setUserExists(true)
          setIsSignUp(false)   // force login mode
        } else {
          setUserExists(false)
          setIsSignUp(true)    // first-run: show sign-up
        }
      } catch {
        // Backend unreachable → safest assumption: locked
        setUserExists(true)
        setIsSignUp(false)
      } finally {
        setCheckingUser(false)
      }
    }
    checkLock()
  }, [])

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (isSignUp) {
        // ── First-time owner registration ─────────────────────────────────
        const { error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) throw signUpError

        // Tell the backend to lock registrations permanently
        await axios.post(`${API}/api/register_owner`)

        alert('Account created! Check your email to confirm, then sign in.')
        setIsSignUp(false)
        setUserExists(true)   // hide the toggle immediately after signup
      } else {
        // ── Normal login ──────────────────────────────────────────────────
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
        navigate('/')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (checkingUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primaryHighlight/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md">
        <div className="glass-panel rounded-2xl p-8 relative z-10">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-textMuted bg-clip-text text-transparent">
              SENTINEL
            </h1>
            <p className="text-sm text-textMuted mt-2">
              {isSignUp ? 'Initialize master account' : 'Welcome back, commander'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-textMuted mb-1.5 ml-1">
                  Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-textMuted/50" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 border border-white/10 rounded-xl bg-surface/50 text-white placeholder-textMuted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 sm:text-sm transition-all duration-200"
                    placeholder="admin@sentinel.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-textMuted mb-1.5 ml-1">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-textMuted/50" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 border border-white/10 rounded-xl bg-surface/50 text-white placeholder-textMuted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 sm:text-sm transition-all duration-200"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary hover:bg-primaryHighlight focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/50 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isSignUp ? 'Initialize Instance' : 'Authenticate'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Toggle only visible when no owner exists yet */}
          {!userExists && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-sm text-textMuted hover:text-white transition-colors duration-200"
              >
                {isSignUp ? 'Already have access? Sign in' : 'First time? Create account'}
              </button>
            </div>
          )}

          {/* Subtle lock indicator once owner exists */}
          {userExists && (
            <p className="mt-6 text-center text-xs text-textMuted/40 flex items-center justify-center gap-1.5">
              <Lock className="w-3 h-3" />
              Private instance — registration closed
            </p>
          )}
        </div>
      </div>
    </div>
  )
}