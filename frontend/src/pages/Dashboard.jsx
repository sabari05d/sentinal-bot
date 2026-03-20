import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { supabase } from '../lib/supabase';
import {
    AreaChart, Area, ResponsiveContainer, Tooltip, YAxis
} from 'recharts';
import {
    LogOut, Plus, X, RefreshCw, AlertCircle,
    Activity, TrendingUp, TrendingDown, Minus,
    Bell, BellOff, ChevronUp, ChevronDown, Wifi
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

// Helper to check if NSE is open
const isMarketOpen = () => {
    const now = new Date();
    // Convert current time to India Standard Time (IST)
    const indiaTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        weekday: 'long',
        hour12: false
    }).formatToParts(now);

    const getPart = (type) => indiaTime.find(p => p.type === type).value;

    const day = getPart('weekday');
    const hour = parseInt(getPart('hour'));
    const minute = parseInt(getPart('minute'));

    // Weekend Check
    if (day === 'Saturday' || day === 'Sunday') return false;

    // Time Check (09:15 to 15:30)
    const timeInMinutes = hour * 60 + minute;
    const openTime = 9 * 60 + 15;
    const closeTime = 15 * 60 + 30;

    return timeInMinutes >= openTime && timeInMinutes <= closeTime;
};

// ── Sentiment Ticker ──────────────────────────────────────────────────────────
function SentimentTicker({ briefing, loading }) {

    const [marketLive, setMarketLive] = useState(isMarketOpen());

    // Update status every minute
    useEffect(() => {
        const timer = setInterval(() => {
            setMarketLive(isMarketOpen());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    if (loading) {
        return (
            <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2 overflow-hidden">
                <div className="flex gap-2 text-xs font-mono text-zinc-600 animate-pulse">
                    <span>[ FETCHING MARKET DATA... ]</span>
                </div>
            </div>
        );
    }
    if (!briefing) return null;

    const sentColor = briefing.sentiment === 'Bullish'
        ? 'text-emerald-400' : briefing.sentiment === 'Bearish'
            ? 'text-red-400' : 'text-amber-400';

    const gainers = briefing.top_gainers?.map(g =>
        `${g.symbol} +${g.pct_change}%`
    ).join('   ·   ') || '';

    const losers = briefing.top_losers?.map(l =>
        `${l.symbol} ${l.pct_change}%`
    ).join('   ·   ') || '';

    const tickerContent = [
        `SENTIMENT: ${briefing.sentiment}`,
        `▲ ADVANCES: ${briefing.advances}`,
        `▼ DECLINES: ${briefing.declines}`,
        `DATE: ${briefing.date}`,
        gainers ? `TOP GAINERS ▸ ${gainers}` : null,
        losers ? `TOP LOSERS  ▸ ${losers}` : null,
    ].filter(Boolean).join('   ◆   ');

    return (
        <div className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur overflow-hidden">
            <div className="flex items-center gap-0">
                {/* Static label */}
                <div className={`shrink-0 px-3 py-1.5 text-[10px] font-mono font-bold border-r border-zinc-800 ${sentColor}`}>
                    {briefing.sentiment === 'Bullish' ? '▲' : briefing.sentiment === 'Bearish' ? '▼' : '◆'} NSE
                </div>
                {/* Scrolling ticker */}
                <div className="overflow-hidden flex-1 py-1.5">
                    <div
                        className="whitespace-nowrap text-[10px] font-mono text-zinc-400 inline-block"
                        style={{ animation: 'marquee 40s linear infinite' }}
                    >
                        {tickerContent}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{tickerContent}
                    </div>
                </div>
                {/* DYNAMIC Live indicator */}
                <div className="shrink-0 px-3 flex items-center gap-1.5 border-l border-zinc-800">
                    <div className={`w-1.5 h-1.5 rounded-full ${marketLive ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
                    <span className={`text-[10px] font-mono ${marketLive ? 'text-zinc-500' : 'text-red-900'}`}>
                        {marketLive ? 'LIVE' : 'CLOSED'}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ── Sparkline Chart ───────────────────────────────────────────────────────────
function Sparkline({ data, isUp }) {
    if (!data || data.length < 2) {
        return (
            <div className="h-12 flex items-center justify-center text-zinc-700 text-xs font-mono">
                NO HIST DATA
            </div>
        );
    }
    const color = isUp ? '#34d399' : '#f87171';
    return (
        <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id={`g-${isUp}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <YAxis domain={['dataMin', 'dataMax']} hide />
                <Tooltip
                    contentStyle={{
                        background: '#18181b',
                        border: '1px solid #3f3f46',
                        borderRadius: 4,
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: '#e4e4e7',
                    }}
                    formatter={(v) => [`₹${v}`, '']}
                    labelFormatter={(l) => l}
                />
                <Area
                    type="monotone"
                    dataKey="close"
                    stroke={color}
                    strokeWidth={1.5}
                    fill={`url(#g-${isUp})`}
                    dot={false}
                    activeDot={{ r: 3, fill: color }}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}

// ── Stock Card ────────────────────────────────────────────────────────────────
function StockCard({ stock, history, onRemove }) {
    const isUp = stock.is_up;
    const hasErr = !!stock.error;

    const changeColor = isUp ? 'text-emerald-400' : 'text-red-400';
    const borderHover = isUp ? 'hover:border-emerald-500/40' : 'hover:border-red-500/40';
    const badgeBg = isUp ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        : 'bg-red-500/10 text-red-400 border-red-500/20';

    return (
        <div className={`group relative bg-zinc-900 border border-zinc-800 ${borderHover} rounded-lg p-4 transition-all duration-200 hover:bg-zinc-900/80`}>
            {/* Remove button */}
            <button
                onClick={() => onRemove(stock.symbol)}
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 p-0.5"
            >
                <X className="w-3.5 h-3.5" />
            </button>

            {/* Header row */}
            <div className="flex items-start justify-between mb-3 pr-4">
                <div>
                    <span className="text-sm font-mono font-bold text-zinc-100 tracking-wider">
                        {stock.symbol}
                    </span>
                    {stock.source && (
                        <span className="ml-2 text-[9px] font-mono text-zinc-600 border border-zinc-700 px-1 rounded">
                            {stock.source}
                        </span>
                    )}
                </div>
                {!hasErr && (
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${badgeBg}`}>
                        {isUp ? '+' : ''}{stock.pct_change}%
                    </span>
                )}
            </div>

            {hasErr ? (
                <div className="py-3">
                    <p className="text-xs font-mono text-red-500/70">⚠ FETCH_ERROR</p>
                    <p className="text-[10px] font-mono text-zinc-600 mt-1">check symbol</p>
                </div>
            ) : (
                <>
                    {/* Price */}
                    <div className={`text-2xl font-mono font-bold tracking-tight mb-1 ${changeColor}`}>
                        ₹{stock.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>

                    {/* Change */}
                    <div className="flex items-center gap-1 mb-3">
                        {isUp
                            ? <ChevronUp className="w-3 h-3 text-emerald-400" />
                            : <ChevronDown className="w-3 h-3 text-red-400" />
                        }
                        <span className={`text-xs font-mono ${changeColor}`}>
                            {stock.change != null
                                ? `${stock.change > 0 ? '+' : ''}₹${stock.change?.toFixed(2)}`
                                : `${isUp ? '+' : ''}${stock.pct_change}%`
                            }
                        </span>
                    </div>

                    {/* Sparkline */}
                    <Sparkline data={history} isUp={isUp} />

                    {/* H/L row */}
                    <div className="flex justify-between mt-2 pt-2 border-t border-zinc-800/60">
                        <span className="text-[10px] font-mono text-zinc-500">
                            H <span className="text-zinc-300">₹{stock.day_high?.toLocaleString('en-IN')}</span>
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                            L <span className="text-zinc-300">₹{stock.day_low?.toLocaleString('en-IN')}</span>
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                            C <span className="text-zinc-300">₹{stock.prev_close?.toLocaleString('en-IN')}</span>
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
const Dashboard = ({ user }) => {
    const [stocks, setStocks] = useState([]);
    const [histories, setHistories] = useState({});   // symbol → [{date, close}]
    const [briefing, setBriefing] = useState(null);
    const [loading, setLoading] = useState(true);
    const [briefingLoading, setBriefingLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [newSymbol, setNewSymbol] = useState('');
    const [addError, setAddError] = useState('');
    const [syncError, setSyncError] = useState('');
    const [testingTg, setTestingTg] = useState(false);
    const [tgStatus, setTgStatus] = useState('');

    // Fetch morning briefing (no auth needed for banner display)
    const fetchBriefing = useCallback(async () => {
        setBriefingLoading(true);
        try {
            const headers = await authHeader();
            const { data } = await axios.get(`${API}/api/stocks/morning-briefing`, { headers });
            setBriefing(data);
        } catch (e) {
            console.error('[SENTINEL] Briefing error:', e.message);
        } finally {
            setBriefingLoading(false);
        }
    }, []);

    // Fetch sparkline history for a symbol
    const fetchHistory = useCallback(async (symbol) => {
        try {
            const headers = await authHeader();
            const { data } = await axios.get(`${API}/api/stocks/history/${symbol}`, { headers });
            setHistories(prev => ({ ...prev, [symbol]: data }));
        } catch (e) {
            // silently fail — sparkline is optional
        }
    }, []);

    const fetchWatchlistData = useCallback(async (isManualRefresh = false) => {
        if (!user?.id) return;
        if (isManualRefresh) setRefreshing(true);
        setSyncError('');

        try {
            const headers = await authHeader();

            const { data: watchlist, error: dbError } = await supabase
                .from('watchlist')
                .select('symbol')
                .eq('user_id', user.id);

            if (dbError) {
                setSyncError(`DB error: ${dbError.message}`);
                return;
            }

            if (!watchlist || watchlist.length === 0) {
                setStocks([]);
                return;
            }

            const symbols = watchlist.map(s => cleanSymbol(s.symbol));

            const response = await axios.post(
                `${API}/api/stocks/batch`,
                { user_id: user.id, symbols },
                { headers }
            );

            setStocks(response.data);

            // Fetch sparklines for each symbol (non-blocking)
            response.data.forEach(s => {
                if (!s.error) fetchHistory(s.symbol);
            });

        } catch (err) {
            setSyncError(`Sync failed: ${err.response?.data?.detail || err.message}`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user?.id, fetchHistory]);

    useEffect(() => {
        fetchWatchlistData();
        fetchBriefing();
        const interval = setInterval(() => fetchWatchlistData(), 180000);
        return () => clearInterval(interval);
    }, [fetchWatchlistData, fetchBriefing]);

    const handleLogout = () => supabase.auth.signOut();

    const addStock = async (e) => {
        e.preventDefault();
        const sym = cleanSymbol(newSymbol);
        if (!sym) return;
        setAddError('');

        const { data: existing } = await supabase
            .from('watchlist').select('id')
            .eq('symbol', sym).eq('user_id', user.id).maybeSingle();

        if (existing) { setAddError(`${sym} already in watchlist`); return; }

        const { error } = await supabase
            .from('watchlist')
            .insert([{ symbol: sym, user_id: user.id }]);

        if (error) setAddError(error.message);
        else { setNewSymbol(''); fetchWatchlistData(); }
    };

    const removeStock = async (symbol) => {
        const clean = cleanSymbol(symbol);
        const { error } = await supabase.from('watchlist')
            .delete().eq('symbol', clean).eq('user_id', user.id);
        if (error) alert(error.message);
        else setStocks(prev => prev.filter(s => s.symbol !== symbol));
    };

    const testTelegram = async () => {
        setTestingTg(true);
        setTgStatus('');
        try {
            const headers = await authHeader();
            await axios.post(`${API}/api/test-telegram`, {}, { headers });
            setTgStatus('✓ Message sent — check Telegram');
        } catch (e) {
            setTgStatus(`✗ ${e.response?.data?.detail || e.message}`);
        } finally {
            setTestingTg(false);
            setTimeout(() => setTgStatus(''), 5000);
        }
    };

    // Stats
    const advancing = stocks.filter(s => !s.error && s.is_up).length;
    const declining = stocks.filter(s => !s.error && !s.is_up).length;

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">

            {/* ── Marquee CSS ── */}
            <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>

            {/* ── Market Mood Ticker ── */}
            <SentimentTicker briefing={briefing} loading={briefingLoading} />

            {/* ── Top bar ── */}
            <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-3 flex items-center justify-between gap-4">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-emerald-500/10 border border-emerald-500/30 rounded flex items-center justify-center">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div>
                        <span className="text-sm font-bold tracking-[0.2em] text-zinc-100">SENTINEL</span>
                        <span className="text-zinc-600 text-xs ml-2">PATTERN_LAB v2</span>
                    </div>
                </div>

                {/* Mini stats */}
                <div className="hidden md:flex items-center gap-4 text-xs font-mono">
                    {stocks.length > 0 && (
                        <>
                            <span className="text-emerald-400">▲ {advancing} ADV</span>
                            <span className="text-red-400">▼ {declining} DEC</span>
                            <span className="text-zinc-600">{stocks.length} SYMBOLS</span>
                        </>
                    )}
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2">
                    {/* Add symbol form */}
                    <form onSubmit={addStock} className="flex items-center gap-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="ADD SYMBOL"
                                className="bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 px-3 py-1.5 rounded text-xs font-mono w-32 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 uppercase"
                                value={newSymbol}
                                onChange={e => { setNewSymbol(e.target.value); setAddError(''); }}
                            />
                            {addError && (
                                <div className="absolute top-full mt-1 left-0 z-10 bg-red-950 border border-red-800 text-red-300 text-[10px] px-2 py-1 rounded whitespace-nowrap">
                                    {addError}
                                </div>
                            )}
                        </div>
                        <button
                            type="submit"
                            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center gap-1"
                        >
                            <Plus className="w-3 h-3" /> ADD
                        </button>
                    </form>

                    {/* Refresh */}
                    <button
                        onClick={() => fetchWatchlistData(true)}
                        disabled={refreshing}
                        className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors disabled:opacity-30"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Test Telegram */}
                    <button
                        onClick={testTelegram}
                        disabled={testingTg}
                        className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-amber-400 hover:border-amber-500/40 transition-colors disabled:opacity-30 relative"
                        title="Test Telegram"
                    >
                        <Bell className="w-4 h-4" />
                    </button>

                    {/* Logout */}
                    <button
                        onClick={handleLogout}
                        className="p-1.5 rounded border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                        title="Logout"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Telegram status toast */}
            {tgStatus && (
                <div className={`mx-6 mt-3 px-4 py-2 rounded border text-xs font-mono ${tgStatus.startsWith('✓')
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                    : 'bg-red-950 border-red-800 text-red-300'
                    }`}>
                    {tgStatus}
                </div>
            )}

            {/* Sync error */}
            {syncError && (
                <div className="mx-6 mt-3 px-4 py-2 rounded border border-red-800 bg-red-950 text-red-300 text-xs font-mono flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {syncError}
                </div>
            )}

            {/* ── Main content ── */}
            <div className="px-6 py-5">

                {/* User context line */}
                <div className="flex items-center justify-between mb-5">
                    <div className="text-[10px] font-mono text-zinc-600 flex items-center gap-3">
                        <span className="text-emerald-600">●</span>
                        <span>SESSION: {user?.email}</span>
                        <span className="text-zinc-700">|</span>
                        <span>AUTO_REFRESH: 3m</span>
                        <span className="text-zinc-700">|</span>
                        <span>ALERTS: ACTIVE</span>
                    </div>
                </div>

                {/* Loading */}
                {loading && stocks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-3">
                        <div className="w-5 h-5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-mono text-zinc-600 animate-pulse tracking-widest">
                            [ INITIALIZING_DATA_STREAMS ]
                        </span>
                    </div>

                ) : stocks.length === 0 && !syncError ? (
                    <div className="border border-dashed border-zinc-800 rounded-lg py-24 text-center">
                        <div className="text-zinc-600 text-xs font-mono space-y-2">
                            <p className="text-zinc-500">WATCHLIST_EMPTY</p>
                            <p>Add symbols using the input above</p>
                            <p className="text-zinc-700">e.g. RELIANCE · INFY · GOLDBEES · IOC · ZOMATO</p>
                        </div>
                    </div>

                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                        {stocks.map((stock, i) => (
                            <div
                                key={stock.symbol}
                                style={{ animationDelay: `${i * 60}ms` }}
                                className="animate-[fadeIn_0.3s_ease_forwards] opacity-0"
                            >
                                <StockCard
                                    stock={stock}
                                    history={histories[stock.symbol] || []}
                                    onRemove={removeStock}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Footer ── */}
            <div className="border-t border-zinc-900 px-6 py-2 flex justify-between text-[10px] font-mono text-zinc-700">
                <span>SENTINEL PATTERN_LAB — NSE RESEARCH TERMINAL</span>
                <span>DATA: NSE/YAHOO · ALERTS: HOURLY · PRIVATE INSTANCE</span>
            </div>

            {/* Fade-in keyframe */}
            <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
        </div>
    );
};

export default Dashboard;
