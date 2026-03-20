import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import StrategyLab from './pages/StrategyLab'
import { Activity, FlaskConical, LogOut } from 'lucide-react'

// ── Sidebar nav ───────────────────────────────────────────────────────────────
function AppSidebar({ user, onLogout }) {
    const links = [
        { to: '/', end: true, icon: Activity, label: 'WATCHLIST' },
        { to: '/strategy', end: false, icon: FlaskConical, label: 'STRATEGY LAB' },
    ]

    return (
        <aside className="w-44 shrink-0 bg-zinc-950 border-r border-zinc-800
                      flex flex-col h-screen sticky top-0 z-20">
            {/* Logo */}
            <div className="px-4 py-4 border-b border-zinc-800">
                <p className="text-[11px] font-mono font-bold tracking-[0.25em] text-zinc-200">SENTINEL</p>
                <p className="text-[9px] font-mono text-zinc-600 mt-0.5">PATTERN_LAB v3</p>
            </div>

            {/* Links */}
            <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
                {links.map(({ to, end, icon: Icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded text-[10px] font-mono
               transition-all border ${isActive
                                ? 'bg-zinc-800 text-zinc-100 border-zinc-700'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 border-transparent'
                            }`
                        }
                    >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        {label}
                    </NavLink>
                ))}
            </nav>

            {/* User / logout */}
            <div className="px-3 py-3 border-t border-zinc-800">
                <p className="text-[9px] font-mono text-zinc-600 truncate px-1 mb-2" title={user?.email}>
                    {user?.email}
                </p>
                <button
                    onClick={onLogout}
                    className="flex items-center gap-2 w-full px-3 py-1.5 rounded
                     text-[10px] font-mono text-zinc-600
                     hover:text-red-400 hover:bg-red-500/5
                     border border-transparent hover:border-red-500/20 transition-all"
                >
                    <LogOut className="w-3.5 h-3.5" /> SIGN OUT
                </button>
            </div>
        </aside>
    )
}

// ── Protected layout with sidebar ────────────────────────────────────────────
function AppLayout({ session, onLogout, children }) {
    return (
        <div className="flex min-h-screen bg-zinc-950">
            <AppSidebar user={session?.user} onLogout={onLogout} />
            <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        </div>
    )
}

// ── Auth guard ────────────────────────────────────────────────────────────────
function ProtectedRoute({ session, loading, children }) {
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <div className="w-5 h-5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }
    if (!session) return <Navigate to="/login" replace />
    return children
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
    const [session, setSession] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            setLoading(false)
        })
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
            setSession(session)
        })
        return () => subscription.unsubscribe()
    }, [])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        setSession(null)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <div className="w-5 h-5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <Router>
            <Routes>
                <Route path="/login" element={<Login />} />

                <Route
                    path="/"
                    element={
                        <ProtectedRoute session={session} loading={false}>
                            <AppLayout session={session} onLogout={handleLogout}>
                                <Dashboard user={session?.user} />
                            </AppLayout>
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/strategy"
                    element={
                        <ProtectedRoute session={session} loading={false}>
                            <AppLayout session={session} onLogout={handleLogout}>
                                <StrategyLab user={session?.user} />
                            </AppLayout>
                        </ProtectedRoute>
                    }
                />

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Router>
    )
}