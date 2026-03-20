import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { supabase } from '../lib/supabase';
import {
    FlaskConical, Play, TrendingUp, TrendingDown, Minus,
    RefreshCw, AlertCircle, Clock, Loader2, BarChart3,
    Target, Cpu, ChevronRight, Zap
} from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function authHeader() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('No active session');
    return { Authorization: `Bearer ${session.access_token}` };
}

function cleanSymbol(s) {
    return s.trim().toUpperCase().replace(/\.NS$/i, '').replace(/\.BO$/i, '');
}

// ── Signal Badge ──────────────────────────────────────────────────────────────
function SignalBadge({ signal }) {
    const cfg = {
        BUY: { cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400', icon: <TrendingUp className="w-3 h-3" /> },
        SELL: { cls: 'bg-red-500/15 border-red-500/40 text-red-400', icon: <TrendingDown className="w-3 h-3" /> },
        HOLD: { cls: 'bg-amber-500/15 border-amber-500/40 text-amber-400', icon: <Minus className="w-3 h-3" /> },
        ERROR: { cls: 'bg-zinc-700/40 border-zinc-600/40 text-zinc-500', icon: <AlertCircle className="w-3 h-3" /> },
    };
    const s = cfg[signal] || cfg.HOLD;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${s.cls}`}>
            {s.icon}{signal}
        </span>
    );
}

// ── Confidence Bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ value }) {
    const w = Math.max(value, 2);
    const color = value >= 70 ? 'bg-emerald-500' : value >= 45 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${w}%` }} />
            </div>
            <span className="text-[10px] font-mono text-zinc-400 w-7 text-right shrink-0">{value}%</span>
        </div>
    );
}

// ── Strategy type colour map ──────────────────────────────────────────────────
const TYPE_STYLES = {
    momentum: 'text-blue-400  border-blue-500/30  bg-blue-500/10',
    mean_reversion: 'text-pink-400  border-pink-500/30  bg-pink-500/10',
    trend: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
    breakout: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
};

// ── Strategy Card ─────────────────────────────────────────────────────────────
function StrategyCard({ strategy, symbolCount, isActive, isRunning, onRun }) {
    const typeStyle = TYPE_STYLES[strategy.type] || TYPE_STYLES.momentum;

    return (
        <div
            className={`bg-zinc-900 border rounded-lg p-4 transition-all cursor-pointer
        ${isActive
                    ? 'border-pink-500/50 shadow-[0_0_12px_rgba(236,72,153,0.12)]'
                    : 'border-zinc-800 hover:border-zinc-700'
                }`}
            onClick={() => !isRunning && onRun(strategy)}
        >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-mono font-bold text-zinc-100 truncate">{strategy.name}</span>
                        {strategy.type && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0 ${typeStyle}`}>
                                {strategy.type.replace('_', ' ')}
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                        {strategy.description || 'No description.'}
                    </p>
                </div>
                <div className="shrink-0 mt-0.5">
                    {isRunning
                        ? <Loader2 className="w-4 h-4 text-pink-400 animate-spin" />
                        : <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
                    }
                </div>
            </div>

            {/* Indicator chips */}
            {strategy.indicators?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                    {strategy.indicators.map(ind => (
                        <span key={ind} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                            {ind}
                        </span>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2.5 border-t border-zinc-800/60">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600">
                    <Target className="w-3 h-3" />
                    {symbolCount} symbols
                </div>
                <button
                    onClick={e => { e.stopPropagation(); onRun(strategy); }}
                    disabled={isRunning || symbolCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded
                     bg-zinc-800 border border-zinc-700 text-zinc-300
                     hover:bg-pink-500/10 hover:border-pink-500/40 hover:text-pink-400
                     disabled:opacity-30 disabled:cursor-not-allowed
                     transition-all text-[11px] font-mono font-bold"
                >
                    {isRunning
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> RUNNING</>
                        : <><Play className="w-3 h-3" /> RUN BACKTEST</>
                    }
                </button>
            </div>
        </div>
    );
}

// ── Signal Feed Row ───────────────────────────────────────────────────────────
function SignalRow({ result, index }) {
    return (
        <div
            className="grid grid-cols-[68px_68px_110px_76px_1fr] items-center gap-2
                 px-4 py-2.5 border-b border-zinc-800/50 last:border-0
                 hover:bg-zinc-800/25 transition-colors
                 animate-[fadeSlide_0.3s_ease_forwards] opacity-0"
            style={{ animationDelay: `${index * 40}ms` }}
        >
            <span className="font-mono font-bold text-zinc-100 text-xs truncate">{result.symbol}</span>
            <div><SignalBadge signal={result.signal} /></div>
            <div className="pr-2"><ConfidenceBar value={result.confidence ?? 0} /></div>
            <span className="font-mono text-xs text-zinc-400 text-right">
                {result.price ? `₹${Number(result.price).toLocaleString('en-IN')}` : '—'}
            </span>
            <span className="text-[10px] font-mono text-zinc-500 truncate" title={result.reason}>
                {result.reason}
            </span>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
const StrategyLab = ({ user }) => {
    const [strategies, setStrategies] = useState([]);
    const [watchlistSymbols, setWatchlistSymbols] = useState([]);
    const [signalFeed, setSignalFeed] = useState([]);
    const [runningId, setRunningId] = useState(null);
    const [activeStrategy, setActiveStrategy] = useState(null);
    const [loadingStrats, setLoadingStrats] = useState(true);
    const [loadingSignals, setLoadingSignals] = useState(false);
    const [stratError, setStratError] = useState('');
    const [signalError, setSignalError] = useState('');
    const [lastRun, setLastRun] = useState(null);

    // ── Load strategies from Supabase ──────────────────────────────────────────
    const fetchStrategies = useCallback(async () => {
        setLoadingStrats(true);
        setStratError('');
        try {
            const { data, error } = await supabase
                .from('strategies')
                .select('*')
                .order('created_at', { ascending: true });
            if (error) throw error;
            setStrategies(data || []);
        } catch (e) {
            setStratError(e.message);
        } finally {
            setLoadingStrats(false);
        }
    }, []);

    // ── Load watchlist symbols ─────────────────────────────────────────────────
    const fetchWatchlist = useCallback(async () => {
        if (!user?.id) return;
        try {
            const { data } = await supabase
                .from('watchlist')
                .select('symbol')
                .eq('user_id', user.id);
            setWatchlistSymbols((data || []).map(r => cleanSymbol(r.symbol)));
        } catch (e) {
            console.error('[SENTINEL] Watchlist fetch:', e);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchStrategies();
        fetchWatchlist();
    }, [fetchStrategies, fetchWatchlist]);

    // ── Run backtest ───────────────────────────────────────────────────────────
    const handleRunBacktest = async (strategy) => {
        if (watchlistSymbols.length === 0) return;
        setRunningId(strategy.id);
        setActiveStrategy(strategy);
        setSignalFeed([]);
        setSignalError('');
        setLoadingSignals(true);

        try {
            const headers = await authHeader();
            const ORDER = { BUY: 0, SELL: 1, HOLD: 2, ERROR: 3 };

            // Fire all symbols concurrently; handle individual failures gracefully
            const settled = await Promise.allSettled(
                watchlistSymbols.map(symbol =>
                    axios
                        .post(
                            `${API}/api/strategy/signal`,
                            {
                                strategy_id: strategy.id,
                                strategy_type: strategy.type,   // pass directly — avoids extra DB round-trip
                                symbol,
                                period: '1y',
                            },
                            { headers, timeout: 20000 }
                        )
                        .then(r => r.data)
                        .catch(e => ({
                            symbol,
                            signal: 'ERROR',
                            confidence: 0,
                            reason: e.response?.data?.detail || e.message,
                            price: null,
                        }))
                )
            );

            const signals = settled
                .map(r => r.status === 'fulfilled' ? r.value : null)
                .filter(Boolean)
                .sort((a, b) => (ORDER[a.signal] ?? 3) - (ORDER[b.signal] ?? 3));

            setSignalFeed(signals);
            setLastRun(new Date());
        } catch (e) {
            setSignalError(e.message);
        } finally {
            setRunningId(null);
            setLoadingSignals(false);
        }
    };

    const buyCount = signalFeed.filter(s => s.signal === 'BUY').length;
    const sellCount = signalFeed.filter(s => s.signal === 'SELL').length;
    const holdCount = signalFeed.filter(s => s.signal === 'HOLD').length;

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
            <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

            {/* ── Page header ── */}
            <div className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-6 py-3
                      flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-pink-500/10 border border-pink-500/30 rounded
                          flex items-center justify-center">
                        <FlaskConical className="w-3.5 h-3.5 text-pink-400" />
                    </div>
                    <div>
                        <span className="text-sm font-bold tracking-[0.2em] text-zinc-100">STRATEGY LAB</span>
                        <span className="text-zinc-600 text-xs ml-2">// SENTINEL v3.1</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {watchlistSymbols.length > 0 && (
                        <span className="text-[10px] font-mono text-zinc-600 border border-zinc-800 px-2 py-1 rounded">
                            {watchlistSymbols.length} SYMBOLS
                        </span>
                    )}
                    <button
                        onClick={() => { fetchStrategies(); fetchWatchlist(); }}
                        title="Refresh"
                        className="p-1.5 rounded border border-zinc-800 text-zinc-500
                       hover:text-zinc-300 hover:border-zinc-600 transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* ── Two-column layout ── */}
            <div className="px-6 py-5 grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6 items-start">

                {/* ══ LEFT: Strategy list ══════════════════════════════════════════════ */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                            Strategies ({strategies.length})
                        </span>
                        {loadingStrats && <Loader2 className="w-3 h-3 text-zinc-600 animate-spin" />}
                    </div>

                    {/* Supabase error */}
                    {stratError && (
                        <div className="p-3 rounded border border-red-800/60 bg-red-950/30
                            text-red-300 text-xs flex items-start gap-2">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{stratError}</span>
                        </div>
                    )}

                    {/* Empty state */}
                    {!loadingStrats && strategies.length === 0 && !stratError && (
                        <div className="border border-dashed border-zinc-800 rounded-lg py-16 text-center">
                            <FlaskConical className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                            <p className="text-zinc-600 text-xs">No strategies found.</p>
                            <p className="text-zinc-700 text-[10px] mt-1">
                                Run the SQL migration to seed default strategies.
                            </p>
                        </div>
                    )}

                    {/* Strategy cards */}
                    {strategies.map(s => (
                        <StrategyCard
                            key={s.id}
                            strategy={s}
                            symbolCount={watchlistSymbols.length}
                            isActive={activeStrategy?.id === s.id}
                            isRunning={runningId === s.id}
                            onRun={handleRunBacktest}
                        />
                    ))}

                    {/* Watchlist scope pill */}
                    {watchlistSymbols.length > 0 && (
                        <div className="mt-1 p-3 rounded-lg border border-zinc-800 bg-zinc-900/40">
                            <p className="text-[9px] font-mono text-zinc-600 mb-2 uppercase tracking-wider">
                                Symbols in scope
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {watchlistSymbols.map(s => (
                                    <span key={s}
                                        className="text-[9px] font-mono px-1.5 py-0.5 rounded
                               bg-zinc-800 border border-zinc-700 text-zinc-400">
                                        {s}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {watchlistSymbols.length === 0 && (
                        <p className="text-[10px] font-mono text-zinc-600 text-center py-2">
                            Add symbols to your Watchlist to run backtests.
                        </p>
                    )}
                </div>

                {/* ══ RIGHT: Signal feed ═══════════════════════════════════════════════ */}
                <div className="flex flex-col gap-4">
                    {/* Feed header */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                                Signal Feed
                            </span>
                            {activeStrategy && (
                                <span className="text-[9px] font-mono px-2 py-0.5 rounded
                                 border border-pink-500/30 bg-pink-500/10 text-pink-400">
                                    {activeStrategy.name}
                                </span>
                            )}
                        </div>
                        {lastRun && (
                            <div className="flex items-center gap-1 text-[9px] font-mono text-zinc-600">
                                <Clock className="w-3 h-3" />
                                {lastRun.toLocaleTimeString('en-IN', {
                                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                                })}
                            </div>
                        )}
                    </div>

                    {/* Summary stats */}
                    {signalFeed.length > 0 && (
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { label: 'BUY', count: buyCount, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25' },
                                { label: 'SELL', count: sellCount, color: 'text-red-400', bg: 'bg-red-500/10     border-red-500/25' },
                                { label: 'HOLD', count: holdCount, color: 'text-amber-400', bg: 'bg-amber-500/10   border-amber-500/25' },
                            ].map(({ label, count, color, bg }) => (
                                <div key={label} className={`rounded-lg border p-3 ${bg}`}>
                                    <p className={`text-2xl font-mono font-bold ${color}`}>{count}</p>
                                    <p className="text-[9px] font-mono text-zinc-500 mt-0.5">{label} SIGNALS</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Error banner */}
                    {signalError && (
                        <div className="p-3 rounded border border-red-800/60 bg-red-950/30
                            text-red-300 text-xs flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            {signalError}
                        </div>
                    )}

                    {/* Table */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">

                        {/* Column headers */}
                        <div className="grid grid-cols-[68px_68px_110px_76px_1fr] gap-2
                            px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/60">
                            {['SYMBOL', 'SIGNAL', 'CONFIDENCE', 'PRICE', 'REASON'].map(h => (
                                <span key={h} className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
                                    {h}
                                </span>
                            ))}
                        </div>

                        {/* Loading */}
                        {loadingSignals && (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <div className="relative">
                                    <Cpu className="w-8 h-8 text-zinc-700" />
                                    <Loader2 className="w-4 h-4 text-pink-400 animate-spin absolute -top-1 -right-1" />
                                </div>
                                <span className="text-xs font-mono text-zinc-600 animate-pulse tracking-widest">
                                    [ COMPUTING {activeStrategy?.name?.toUpperCase()} — {watchlistSymbols.length} SYMBOLS ]
                                </span>
                            </div>
                        )}

                        {/* Empty state — no run yet */}
                        {!loadingSignals && signalFeed.length === 0 && !signalError && (
                            <div className="flex flex-col items-center justify-center py-24 gap-3">
                                <BarChart3 className="w-10 h-10 text-zinc-800" />
                                <p className="text-xs font-mono text-zinc-600">
                                    Select a strategy and click <span className="text-pink-400">RUN BACKTEST</span>
                                </p>
                                <p className="text-[10px] font-mono text-zinc-700">
                                    BUY / SELL / HOLD signals will appear for each watchlist symbol
                                </p>
                            </div>
                        )}

                        {/* Signal rows */}
                        {!loadingSignals && signalFeed.map((result, i) => (
                            <SignalRow key={`${result.symbol}-${i}`} result={result} index={i} />
                        ))}
                    </div>

                    {/* Disclaimer */}
                    {signalFeed.length > 0 && (
                        <p className="text-[9px] font-mono text-zinc-700 text-center">
                            ⚠ Signals are indicative only · Not financial advice ·
                            Confidence = indicator agreement score (0–95%)
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StrategyLab;