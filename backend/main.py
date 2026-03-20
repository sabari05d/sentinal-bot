"""
SENTINEL API — v3.1
====================
Dual-mode execution:

  Normal (FastAPI server):
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

  GitHub Actions / CLI (runs briefing once and exits):
    python main.py --briefing morning
    python main.py --briefing evening

  New in v3.1:
    POST /api/strategy/signal  — strategy signal engine
    GET  /api/strategy/list    — list available strategy types
"""

# ── stdlib ────────────────────────────────────────────────────────────────────
import argparse
import asyncio
import os
import sys
from contextlib import asynccontextmanager
from datetime import date

# ── third-party ───────────────────────────────────────────────────────────────
import httpx
import jwt as pyjwt
import pytz
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jwt import PyJWKClient

load_dotenv()

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

SUPABASE_URL        = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY        = os.environ.get("SUPABASE_KEY", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
TELEGRAM_BOT_TOKEN  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID    = os.environ.get("TELEGRAM_CHAT_ID", "")
TG_API              = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

IST = pytz.timezone("Asia/Kolkata")

BRIEFING_SYMBOLS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
    "HINDUNILVR", "ITC", "SBIN", "BAJFINANCE", "WIPRO",
]


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════════

_jwks_client: PyJWKClient | None = None


def get_jwks_client() -> PyJWKClient | None:
    global _jwks_client
    if _jwks_client is None and SUPABASE_URL:
        _jwks_client = PyJWKClient(
            f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
        )
    return _jwks_client


bearer = HTTPBearer(auto_error=False)


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = credentials.credentials

    jwks = get_jwks_client()
    if jwks:
        try:
            signing_key = jwks.get_signing_key_from_jwt(token)
            return pyjwt.decode(
                token, signing_key.key,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
        except pyjwt.exceptions.PyJWTError as e:
            print(f"[SENTINEL] ES256 failed: {e}")

    if SUPABASE_JWT_SECRET:
        try:
            return pyjwt.decode(
                token, SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        except pyjwt.exceptions.PyJWTError as e:
            print(f"[SENTINEL] HS256 failed: {e}")

    raise HTTPException(status_code=401, detail="Token verification failed")


# ═══════════════════════════════════════════════════════════════════════════════
# TELEGRAM HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

async def tg_send(text: str, chat_id: str | None = None) -> bool:
    cid = chat_id or TELEGRAM_CHAT_ID
    if not TELEGRAM_BOT_TOKEN or not cid:
        print("[SENTINEL] Telegram not configured — skipping send")
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{TG_API}/sendMessage",
                json={"chat_id": cid, "text": text, "parse_mode": "Markdown"},
            )
            ok = resp.status_code == 200
            if not ok:
                print(f"[SENTINEL] Telegram error: {resp.status_code} {resp.text}")
            return ok
    except Exception as e:
        print(f"[SENTINEL] Telegram send error: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# NSE / YAHOO DATA FETCHERS
# ═══════════════════════════════════════════════════════════════════════════════

NSE_HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":          "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.nseindia.com/",
    "Connection":      "keep-alive",
}


def _clean(symbol: str) -> str:
    return symbol.upper().strip().removesuffix(".NS").removesuffix(".BO")


def _nse_ticker(symbol: str) -> str:
    return f"{_clean(symbol)}.NS"


async def _fetch_nse_quote(symbol: str) -> dict:
    display = _clean(symbol)
    url = f"https://www.nseindia.com/api/quote-equity?symbol={display}"
    try:
        async with httpx.AsyncClient(
            headers=NSE_HEADERS, timeout=10, follow_redirects=True
        ) as client:
            await client.get("https://www.nseindia.com", timeout=10)
            resp = await client.get(url, timeout=10)
            resp.raise_for_status()
            data = resp.json()

        pd_   = data.get("priceInfo", {})
        intra = pd_.get("intraDayHighLow", {})
        last  = float(pd_.get("lastPrice", 0))
        prev  = float(pd_.get("previousClose", 0))
        pct   = round(float(pd_.get("pChange", 0)), 2)
        return {
            "symbol":     display,
            "price":      round(last, 2),
            "prev_close": round(prev, 2),
            "open":       round(float(pd_.get("open", 0)), 2),
            "day_high":   round(float(intra.get("max", 0)), 2),
            "day_low":    round(float(intra.get("min", 0)), 2),
            "volume":     0,
            "pct_change": pct,
            "change":     round(float(pd_.get("change", 0)), 2),
            "is_up":      pct >= 0,
            "source":     "NSE",
        }
    except Exception as e:
        print(f"[SENTINEL] NSE error for {display}: {e}")
        return await _fetch_yfinance_quote(display)


async def _fetch_yfinance_quote(symbol: str) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _yf_sync, symbol)


def _yf_sync(symbol: str) -> dict:
    import requests, yfinance as yf

    display    = _clean(symbol)
    ticker_str = _nse_ticker(symbol)
    session    = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
    })
    try:
        t    = yf.Ticker(ticker_str, session=session)
        hist = t.history(period="5d", interval="1d", auto_adjust=True)
        if hist.empty:
            hist = t.history(period="1mo", interval="1d", auto_adjust=True)
        if hist.empty:
            return {"symbol": display, "error": f"No data for '{display}'",
                    "price": 0, "pct_change": 0, "is_up": False}
        latest     = hist.iloc[-1]
        prev       = hist.iloc[-2] if len(hist) >= 2 else hist.iloc[0]
        last       = round(float(latest["Close"]), 2)
        prev_close = round(float(prev["Close"]), 2)
        pct        = round(((last - prev_close) / prev_close) * 100, 2) if prev_close else 0
        return {
            "symbol":     display,
            "price":      last,
            "prev_close": prev_close,
            "open":       round(float(latest["Open"]), 2),
            "day_high":   round(float(latest["High"]), 2),
            "day_low":    round(float(latest["Low"]), 2),
            "volume":     int(latest["Volume"]) if latest["Volume"] else 0,
            "pct_change": pct,
            "is_up":      pct >= 0,
            "source":     "Yahoo",
        }
    except Exception as e:
        print(f"[SENTINEL] yfinance error {ticker_str}: {e}")
        return {"symbol": display, "error": str(e), "price": 0, "pct_change": 0, "is_up": False}


def _yf_history_sync(symbol: str, period: str = "1mo") -> list[dict]:
    """Sparkline history — returns list of {date, close}."""
    import requests, yfinance as yf

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 Chrome/120.0.0.0"})
    try:
        hist = yf.Ticker(_nse_ticker(symbol), session=session).history(
            period=period, interval="1d", auto_adjust=True
        )
        if hist.empty:
            return []
        return [
            {"date": str(idx.date()), "close": round(float(row["Close"]), 2)}
            for idx, row in hist.iterrows()
        ]
    except Exception:
        return []


def _yf_history_df_sync(symbol: str, period: str = "1y") -> "pd.DataFrame":
    """
    Returns a raw OHLCV DataFrame for strategy engine calculations.
    Uses a longer period (1y) so indicators like EMA50 have enough data.
    """
    import requests, yfinance as yf, pandas as pd

    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 Chrome/120.0.0.0"})
    try:
        hist = yf.Ticker(_nse_ticker(symbol), session=session).history(
            period=period, interval="1d", auto_adjust=True
        )
        return hist if not hist.empty else pd.DataFrame()
    except Exception as e:
        print(f"[SENTINEL] History DF fetch error for {symbol}: {e}")
        import pandas as pd
        return pd.DataFrame()


async def _quote(symbol: str) -> dict:
    return await _fetch_nse_quote(symbol)


async def _history(symbol: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _yf_history_sync, symbol)


async def _history_df(symbol: str, period: str = "1y") -> "pd.DataFrame":
    """Async wrapper — returns DataFrame for strategy engine."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _yf_history_df_sync, symbol, period)


# ═══════════════════════════════════════════════════════════════════════════════
# BRIEFING FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

async def build_briefing_data(symbols: list[str] | None = None) -> dict:
    syms   = symbols or BRIEFING_SYMBOLS
    quotes = await asyncio.gather(*[_quote(s) for s in syms])
    valid  = [q for q in quotes if "error" not in q]
    valid.sort(key=lambda x: x["pct_change"], reverse=True)

    advances  = sum(1 for q in valid if q["pct_change"] > 0)
    declines  = sum(1 for q in valid if q["pct_change"] < 0)
    unchanged = len(valid) - advances - declines

    return {
        "date":      date.today().strftime("%d %b %Y"),
        "sentiment": (
            "Bullish" if advances > declines
            else "Bearish" if declines > advances
            else "Neutral"
        ),
        "advances":    advances,
        "declines":    declines,
        "unchanged":   unchanged,
        "top_gainers": valid[:3],
        "top_losers":  valid[-3:][::-1],
        "all_quotes":  valid,
    }


def _format_briefing_message(data: dict, briefing_type: str = "morning") -> str:
    sentiment    = data["sentiment"]
    sent_emoji   = "🐂" if sentiment == "Bullish" else "🐻" if sentiment == "Bearish" else "😐"
    header_emoji = "🌅" if briefing_type == "morning" else "🌆"
    label        = "Morning Briefing" if briefing_type == "morning" else "Closing Bell"

    gainers_lines = "\n".join(
        f"  • *{g['symbol']}*  ₹{g['price']}  `+{g['pct_change']}%`"
        for g in data["top_gainers"]
    ) or "  _None_"

    losers_lines = "\n".join(
        f"  • *{l['symbol']}*  ₹{l['price']}  `{l['pct_change']}%`"
        for l in data["top_losers"]
    ) or "  _None_"

    return (
        f"{header_emoji} *SENTINEL — {label}*\n"
        f"📅 {data['date']}\n\n"
        f"*Market Mood:* {sent_emoji} {sentiment}\n"
        f"▲ Advances: `{data['advances']}`   "
        f"▼ Declines: `{data['declines']}`   "
        f"➖ Unchanged: `{data['unchanged']}`\n\n"
        f"🚀 *Top Gainers:*\n{gainers_lines}\n\n"
        f"📉 *Top Losers:*\n{losers_lines}"
    )


async def send_automated_briefing(briefing_type: str = "morning") -> bool:
    print(f"[SENTINEL] 📊 Generating {briefing_type} briefing...")
    try:
        data    = await build_briefing_data()
        message = _format_briefing_message(data, briefing_type)
        success = await tg_send(message)
        print(f"[SENTINEL] {briefing_type.capitalize()} briefing {'✓ sent' if success else '✗ failed'}")
        return success
    except Exception as e:
        print(f"[SENTINEL] Briefing error: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# BACKGROUND TASKS
# ═══════════════════════════════════════════════════════════════════════════════

async def _price_alert_loop():
    _sent: dict[str, date | None] = {"morning": None, "evening": None}
    await asyncio.sleep(15)

    while True:
        now_ist  = __import__("datetime").datetime.now(IST)
        today    = now_ist.date()
        hour_ist = now_ist.hour

        print(f"[SENTINEL] 🕐 Alert loop tick — {now_ist.strftime('%H:%M IST %d %b %Y')}")

        if hour_ist == 9 and _sent["morning"] != today:
            if await send_automated_briefing("morning"):
                _sent["morning"] = today
        elif hour_ist == 16 and _sent["evening"] != today:
            if await send_automated_briefing("evening"):
                _sent["evening"] = today

        if SUPABASE_URL and SUPABASE_KEY:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{SUPABASE_URL}/rest/v1/watchlist?select=symbol,user_id",
                        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                    )
                rows = resp.json() if resp.status_code == 200 else []
            except Exception as e:
                print(f"[SENTINEL] Watchlist fetch error: {e}")
                rows = []

            for sym in list({_clean(r["symbol"]) for r in rows}):
                try:
                    q = await _quote(sym)
                    if "error" in q:
                        continue
                    price     = q["price"]
                    prev      = q.get("prev_close", price)
                    pred_high = round(prev * 1.05, 2)
                    pred_low  = round(prev * 0.95, 2)
                    if price >= pred_high:
                        await tg_send(f"🚀 *ALERT — {sym}*\n₹{price} crossed *UPPER* ₹{pred_high}\nChange: `{q['pct_change']:+.2f}%`")
                    elif price <= pred_low:
                        await tg_send(f"⚠️ *ALERT — {sym}*\n₹{price} crossed *LOWER* ₹{pred_low}\nChange: `{q['pct_change']:+.2f}%`")
                    await asyncio.sleep(0.5)
                except Exception as e:
                    print(f"[SENTINEL] Alert check error for {sym}: {e}")
        else:
            print("[SENTINEL] Supabase not configured — skipping price alerts")

        now_secs = now_ist.minute * 60 + now_ist.second
        await asyncio.sleep(3600 - now_secs)


async def _telegram_long_poll():
    if not TELEGRAM_BOT_TOKEN:
        print("[SENTINEL] No TELEGRAM_BOT_TOKEN — long polling disabled")
        return

    offset = 0
    print("[SENTINEL] 📡 Telegram long polling started")

    while True:
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                resp = await client.get(
                    f"{TG_API}/getUpdates",
                    params={"offset": offset, "timeout": 30, "allowed_updates": ["message"]},
                )
                if resp.status_code != 200:
                    await asyncio.sleep(5)
                    continue
                updates = resp.json().get("result", [])

            for update in updates:
                offset  = update["update_id"] + 1
                message = update.get("message", {})
                text    = message.get("text", "")
                chat_id = str(message.get("chat", {}).get("id", ""))

                if not text or not chat_id:
                    continue
                if TELEGRAM_CHAT_ID and chat_id != TELEGRAM_CHAT_ID:
                    continue

                cmd   = text.strip().lower()
                reply = "Unknown command. Try /help"

                if cmd.startswith("/quote"):
                    parts = text.split()
                    if len(parts) > 1:
                        q = await _quote(parts[1].upper())
                        if "error" not in q:
                            sign  = "🟢" if q["is_up"] else "🔴"
                            reply = (
                                f"{sign} *{q['symbol']}* — ₹{q['price']}\n"
                                f"Change: `{q['pct_change']:+.2f}%`\n"
                                f"H: ₹{q['day_high']}  L: ₹{q['day_low']}\n"
                                f"Prev Close: ₹{q['prev_close']}"
                            )
                        else:
                            reply = f"❌ {q['error']}"
                    else:
                        reply = "Usage: /quote SYMBOL"
                elif cmd.startswith("/briefing"):
                    data  = await build_briefing_data()
                    reply = _format_briefing_message(data, "morning")
                elif cmd.startswith("/watchlist"):
                    if SUPABASE_URL and SUPABASE_KEY:
                        async with httpx.AsyncClient(timeout=10) as c:
                            r = await c.get(
                                f"{SUPABASE_URL}/rest/v1/watchlist?select=symbol",
                                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                            )
                            rows = r.json() if r.status_code == 200 else []
                        syms  = list({_clean(row["symbol"]) for row in rows})
                        reply = (
                            f"📋 *Watchlist* ({len(syms)} symbols)\n"
                            + "\n".join(f"• {s}" for s in sorted(syms))
                        ) if syms else "Watchlist is empty."
                    else:
                        reply = "Supabase not configured."
                elif cmd in ("/help", "/start"):
                    reply = (
                        "🛡 *SENTINEL Commands*\n\n"
                        "/quote SYMBOL\n/briefing\n/watchlist\n/help"
                    )

                await tg_send(reply, chat_id=chat_id)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[SENTINEL] Long poll error: {e}")
            await asyncio.sleep(5)


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app_instance):
    tasks = [
        asyncio.create_task(_price_alert_loop()),
        asyncio.create_task(_telegram_long_poll()),
    ]
    print("[SENTINEL] ✓ Background tasks started")
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    print("[SENTINEL] ✓ Background tasks stopped")


app = FastAPI(title="SENTINEL API", version="3.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://frontend:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Registration lock ─────────────────────────────────────────────────────────
LOCK_FILE = "/app/.owner_registered"

def _is_locked() -> bool:
    return os.path.exists(LOCK_FILE)

def _set_locked():
    open(LOCK_FILE, "w").write("1")

@app.get("/api/has_users")
async def has_users():
    return {"has_users": _is_locked()}

@app.post("/api/register_owner")
async def register_owner():
    if _is_locked():
        return {"status": "already_locked"}
    _set_locked()
    return {"status": "locked"}


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "status":           "Sentinel API v3.1 Online",
        "locked":           _is_locked(),
        "telegram_enabled": bool(TELEGRAM_BOT_TOKEN),
        "supabase_enabled": bool(SUPABASE_URL),
    }

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Telegram ──────────────────────────────────────────────────────────────────
@app.post("/api/test-telegram")
async def test_telegram(_=Depends(require_auth)):
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=400, detail="TELEGRAM_BOT_TOKEN not set")
    if not TELEGRAM_CHAT_ID:
        raise HTTPException(status_code=400, detail="TELEGRAM_CHAT_ID not set")
    ok = await tg_send(
        "🛡 *Sentinel Link Established*\n\n"
        "Dashboard connected. Price alerts + Strategy Engine active.\n"
        "/quote SYMBOL | /briefing | /watchlist | /help"
    )
    if ok:
        return {"status": "sent", "chat_id": TELEGRAM_CHAT_ID}
    raise HTTPException(status_code=500, detail="Telegram send failed")


# ── Stock routes ──────────────────────────────────────────────────────────────
@app.get("/api/stocks/quote/{symbol}")
async def get_quote(symbol: str, _=Depends(require_auth)):
    return await _quote(symbol)

@app.post("/api/stocks/batch")
async def get_batch(body: dict, _=Depends(require_auth)):
    symbols = body.get("symbols") or [
        "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "ZOMATO",
    ]
    results = await asyncio.gather(*[_quote(s) for s in symbols])
    return list(results)

@app.get("/api/stocks/history/{symbol}")
async def get_history(symbol: str, _=Depends(require_auth)):
    return await _history(symbol)

@app.get("/api/stocks/morning-briefing")
async def morning_briefing_endpoint(_=Depends(require_auth)):
    return await build_briefing_data()

@app.post("/api/send-briefing")
async def send_briefing_endpoint(body: dict, _=Depends(require_auth)):
    briefing_type = body.get("type", "morning")
    if briefing_type not in ("morning", "evening"):
        raise HTTPException(status_code=400, detail="type must be 'morning' or 'evening'")
    ok = await send_automated_briefing(briefing_type)
    if ok:
        return {"status": "sent", "type": briefing_type}
    raise HTTPException(status_code=500, detail="Briefing failed — check logs")

@app.post("/stocks/range")
async def predict_range(body: dict, _=Depends(require_auth)):
    symbol = body.get("symbol", "")
    quote  = await _quote(symbol)
    if "error" in quote:
        return quote
    last = quote["price"]
    return {
        "symbol":         _clean(symbol),
        "predicted_low":  round(last * 0.95, 2),
        "predicted_high": round(last * 1.05, 2),
        "confidence":     0.55,
        "note":           "Placeholder — ±5% from last price",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY ROUTES  ← NEW in v3.1
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/strategy/list")
async def list_strategies(_=Depends(require_auth)):
    """Returns the supported strategy types and their descriptions."""
    from strategy_engine import STRATEGY_MAP
    descriptions = {
        "momentum":       "RSI crossover — detects oversold recovery and overbought exits",
        "mean_reversion": "Bollinger Bands + RSI — prices revert to the mean",
        "trend":          "EMA 20/50 crossover + MACD — follows the prevailing trend",
        "breakout":       "52-week high/low proximity — momentum breakout signals",
    }
    return [
        {"type": k, "description": descriptions.get(k, "")}
        for k in STRATEGY_MAP
    ]


@app.post("/api/strategy/signal")
async def compute_strategy_signal(body: dict, _=Depends(require_auth)):
    """
    Compute a BUY / SELL / HOLD signal for a symbol using a given strategy.

    Request body:
      {
        "strategy_id":   "uuid-from-supabase",   // used to look up strategy.type
        "strategy_type": "momentum",              // OR pass type directly (bypasses DB lookup)
        "symbol":        "ITC",
        "period":        "1y"                     // optional, default "1y"
      }

    Response:
      {
        "symbol":        "ITC",
        "signal":        "BUY",
        "confidence":    72,
        "reason":        "RSI crossed above 30 (28.4 → 31.2) — oversold recovery",
        "price":         452.35,
        "strategy_type": "momentum",
        "indicators":    { "rsi": 31.2 }
      }
    """
    from strategy_engine import compute_signal, STRATEGY_MAP

    symbol        = body.get("symbol", "").strip()
    strategy_id   = body.get("strategy_id", "")
    strategy_type = body.get("strategy_type", "")
    period        = body.get("period", "1y")

    if not symbol:
        raise HTTPException(status_code=400, detail="'symbol' is required")

    # ── Resolve strategy_type ─────────────────────────────────────────────────
    # Option A: frontend passes strategy_type directly
    # Option B: frontend passes strategy_id — we look it up from Supabase
    if not strategy_type and strategy_id and SUPABASE_URL and SUPABASE_KEY:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(
                    f"{SUPABASE_URL}/rest/v1/strategies?id=eq.{strategy_id}&select=type",
                    headers={
                        "apikey":        SUPABASE_KEY,
                        "Authorization": f"Bearer {SUPABASE_KEY}",
                    },
                )
                rows = resp.json() if resp.status_code == 200 else []
                strategy_type = rows[0]["type"] if rows else ""
        except Exception as e:
            print(f"[SENTINEL] Strategy lookup error: {e}")

    if not strategy_type:
        raise HTTPException(
            status_code=400,
            detail=f"Could not resolve strategy_type. Pass 'strategy_type' directly or a valid 'strategy_id'. Known types: {list(STRATEGY_MAP.keys())}"
        )

    if strategy_type not in STRATEGY_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategy_type '{strategy_type}'. Valid: {list(STRATEGY_MAP.keys())}"
        )

    # ── Fetch historical data (1y for robust indicator calculation) ───────────
    print(f"[SENTINEL] Computing {strategy_type} signal for {symbol}...")
    hist = await _history_df(symbol, period=period)

    if hist.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No historical data available for '{symbol}'. Check the symbol is a valid NSE ticker."
        )

    # ── Run the strategy engine in thread pool (CPU-bound work) ──────────────
    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, compute_signal, strategy_type, hist, symbol)

    print(f"[SENTINEL] Signal for {symbol}: {result['signal']} ({result['confidence']}%) — {result['reason']}")
    return result


# ── Debug ─────────────────────────────────────────────────────────────────────
@app.post("/api/debug/token")
async def debug_token(request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return {"error": "No Bearer token"}
    token = auth.split(" ", 1)[1]
    try:
        header = pyjwt.get_unverified_header(token)
    except Exception as e:
        return {"error": str(e)}
    result = {"token_alg": header.get("alg"), "token_length": len(token)}
    jwks = get_jwks_client()
    if jwks:
        try:
            key     = jwks.get_signing_key_from_jwt(token)
            payload = pyjwt.decode(
                token, key.key,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
            result.update({
                "decode_success": True,
                "method":         "ES256",
                "role":           payload.get("role"),
                "email":          payload.get("email"),
            })
            return result
        except Exception as e:
            result["es256_error"] = str(e)
    result["decode_success"] = False
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# CLI ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="sentinel", description="SENTINEL — NSE Trading Dashboard backend")
    parser.add_argument(
        "--briefing",
        choices=["morning", "evening"],
        metavar="TYPE",
        help="Run a one-shot briefing and exit. Ideal for GitHub Actions.",
    )
    return parser.parse_args()


async def _cli_briefing(briefing_type: str) -> None:
    print(f"[SENTINEL] ── CLI mode: {briefing_type} briefing ──")
    now_ist = __import__("datetime").datetime.now(IST)
    print(f"[SENTINEL] Time (IST): {now_ist.strftime('%H:%M %d %b %Y')}")

    if not TELEGRAM_BOT_TOKEN:
        print("[SENTINEL] ERROR: TELEGRAM_BOT_TOKEN not set")
        sys.exit(1)
    if not TELEGRAM_CHAT_ID:
        print("[SENTINEL] ERROR: TELEGRAM_CHAT_ID not set")
        sys.exit(1)

    ok = await send_automated_briefing(briefing_type)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    args = _parse_args()
    if args.briefing:
        asyncio.run(_cli_briefing(args.briefing))
    else:
        import uvicorn
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

        