"""
SENTINEL Strategy Engine
========================
Pure, synchronous indicator calculations.
Called via asyncio.run_in_executor — never blocks the event loop.

Strategies supported (matched by strategy.type from Supabase):
  momentum        — RSI crossover logic
  mean_reversion  — RSI extremes + Bollinger Bands
  trend           — EMA 20/50 crossover + MACD
  breakout        — Price vs 52-week high/low

To add a new strategy:
  1. Write a def _strategy_<name>(hist: pd.DataFrame) -> dict
  2. Register it in STRATEGY_MAP at the bottom of this file
"""

from __future__ import annotations
from typing import Literal
import numpy as np
import pandas as pd

Signal = Literal["BUY", "SELL", "HOLD"]


# ═══════════════════════════════════════════════════════════════════════════════
# INDICATOR PRIMITIVES
# ═══════════════════════════════════════════════════════════════════════════════

def calc_rsi(closes: pd.Series, period: int = 14) -> float:
    """RSI — returns last value (0-100). Returns 50 if insufficient data."""
    if len(closes) < period + 1:
        return 50.0
    delta = closes.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, np.nan)
    rsi   = 100 - (100 / (1 + rs))
    val   = rsi.iloc[-1]
    return round(float(val) if not np.isnan(val) else 50.0, 2)


def calc_ema(closes: pd.Series, span: int) -> pd.Series:
    """EMA series."""
    return closes.ewm(span=span, adjust=False).mean()


def calc_sma(closes: pd.Series, window: int) -> float:
    """SMA — last value."""
    if len(closes) < window:
        return round(float(closes.mean()), 2)
    return round(float(closes.rolling(window).mean().iloc[-1]), 2)


def calc_macd(closes: pd.Series) -> tuple[float, float]:
    """Returns (macd_line, signal_line) — last values."""
    if len(closes) < 26:
        return 0.0, 0.0
    ema12  = calc_ema(closes, 12)
    ema26  = calc_ema(closes, 26)
    macd   = ema12 - ema26
    signal = calc_ema(macd, 9)
    return round(float(macd.iloc[-1]), 4), round(float(signal.iloc[-1]), 4)


def calc_bollinger(closes: pd.Series, window: int = 20) -> tuple[float, float, float]:
    """Returns (upper, middle/SMA, lower) — last values."""
    if len(closes) < window:
        m = float(closes.iloc[-1])
        return m, m, m
    sma   = closes.rolling(window).mean()
    std   = closes.rolling(window).std()
    upper = sma + 2 * std
    lower = sma - 2 * std
    return (
        round(float(upper.iloc[-1]), 2),
        round(float(sma.iloc[-1]),   2),
        round(float(lower.iloc[-1]), 2),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL AGGREGATION HELPER
# ═══════════════════════════════════════════════════════════════════════════════

def _votes_to_signal(votes: int, max_votes: int) -> tuple[Signal, int]:
    """
    Convert a net vote tally into (signal, confidence_pct).
    votes > 0  → BUY,  votes < 0 → SELL,  votes == 0 → HOLD
    confidence scales linearly from 50% (zero votes) to 95% (max votes).
    """
    confidence = int(50 + (abs(votes) / max(max_votes, 1)) * 45)
    confidence = max(10, min(95, confidence))

    if votes > 0:
        return "BUY", confidence
    elif votes < 0:
        return "SELL", confidence
    else:
        return "HOLD", 50


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def _strategy_momentum(hist: pd.DataFrame) -> dict:
    """
    RSI Momentum Strategy
    ─────────────────────
    BUY  : RSI crossed above 30 (oversold recovery signal)
    SELL : RSI above 70 (overbought territory)
    HOLD : RSI between 30–70
    Confidence scales with RSI distance from neutral (50).
    """
    closes   = hist["Close"]
    price    = round(float(closes.iloc[-1]), 2)
    rsi      = calc_rsi(closes)
    rsi_prev = calc_rsi(closes.iloc[:-1]) if len(closes) > 15 else rsi

    votes   = 0
    reasons = []

    if rsi_prev < 30 <= rsi:
        votes += 3
        reasons.append(f"RSI crossed above 30 ({rsi_prev} → {rsi}) — oversold recovery")
    elif rsi < 30:
        votes += 1
        reasons.append(f"RSI={rsi} deep oversold — waiting for reversal confirmation")
    elif rsi > 70:
        votes -= 2
        reasons.append(f"RSI={rsi} overbought — momentum may fade")
    elif rsi_prev > 70 >= rsi:
        votes -= 3
        reasons.append(f"RSI crossed below 70 ({rsi_prev} → {rsi}) — overbought exit")
    elif 40 <= rsi <= 60:
        votes += 1
        reasons.append(f"RSI={rsi} healthy momentum zone")
    else:
        reasons.append(f"RSI={rsi} — neutral range")

    signal, confidence = _votes_to_signal(votes, max_votes=3)
    return {
        "signal":     signal,
        "confidence": confidence,
        "reason":     " · ".join(reasons),
        "price":      price,
        "indicators": {"rsi": rsi},
    }


def _strategy_mean_reversion(hist: pd.DataFrame) -> dict:
    """
    Mean Reversion (RSI + Bollinger Bands)
    ───────────────────────────────────────
    BUY  : Price at/below lower Bollinger Band AND RSI < 35
    SELL : Price at/above upper Bollinger Band AND RSI > 65
    HOLD : Price in middle of bands
    """
    closes = hist["Close"]
    price  = round(float(closes.iloc[-1]), 2)
    rsi    = calc_rsi(closes)
    upper, mid, lower = calc_bollinger(closes)

    votes   = 0
    reasons = []
    bb_range = (upper - lower) if upper != lower else 1.0
    bb_pos   = (price - lower) / bb_range  # 0 = at lower, 1 = at upper

    # Bollinger Band position
    if bb_pos <= 0.10:
        votes += 2
        reasons.append(f"Price ₹{price} at/below lower BB ₹{lower}")
    elif bb_pos >= 0.90:
        votes -= 2
        reasons.append(f"Price ₹{price} at/above upper BB ₹{upper}")
    elif bb_pos <= 0.25:
        votes += 1
        reasons.append(f"Price near lower BB (₹{lower}), BB pos={bb_pos*100:.0f}%")
    elif bb_pos >= 0.75:
        votes -= 1
        reasons.append(f"Price near upper BB (₹{upper}), BB pos={bb_pos*100:.0f}%")
    else:
        reasons.append(f"Price mid-range (BB pos={bb_pos*100:.0f}%)")

    # RSI confirmation
    if rsi < 35:
        votes += 1
        reasons.append(f"RSI={rsi} confirms oversold")
    elif rsi > 65:
        votes -= 1
        reasons.append(f"RSI={rsi} confirms overbought")

    signal, confidence = _votes_to_signal(votes, max_votes=3)
    return {
        "signal":     signal,
        "confidence": confidence,
        "reason":     " · ".join(reasons),
        "price":      price,
        "indicators": {"rsi": rsi, "bb_upper": upper, "bb_mid": mid, "bb_lower": lower},
    }


def _strategy_trend(hist: pd.DataFrame) -> dict:
    """
    EMA Crossover + MACD Trend Strategy
    ─────────────────────────────────────
    BUY  : EMA20 > EMA50 (uptrend) AND MACD above signal line
    SELL : EMA20 < EMA50 (downtrend) AND MACD below signal line
    HOLD : Conflicting signals
    """
    closes = hist["Close"]
    price  = round(float(closes.iloc[-1]), 2)
    ema20  = round(float(calc_ema(closes, 20).iloc[-1]), 2)
    ema50  = round(float(calc_ema(closes, 50).iloc[-1]), 2)
    macd_val, macd_sig = calc_macd(closes)

    votes   = 0
    reasons = []

    # EMA trend direction (weighted 2)
    if ema20 > ema50:
        votes += 2
        gap_pct = round(((ema20 - ema50) / ema50) * 100, 2)
        reasons.append(f"EMA20({ema20}) > EMA50({ema50}) uptrend +{gap_pct}%")
    else:
        votes -= 2
        gap_pct = round(((ema50 - ema20) / ema50) * 100, 2)
        reasons.append(f"EMA20({ema20}) < EMA50({ema50}) downtrend -{gap_pct}%")

    # MACD confirmation (weighted 1)
    if macd_val > macd_sig:
        votes += 1
        reasons.append(f"MACD({macd_val:.3f}) above signal({macd_sig:.3f})")
    else:
        votes -= 1
        reasons.append(f"MACD({macd_val:.3f}) below signal({macd_sig:.3f})")

    signal, confidence = _votes_to_signal(votes, max_votes=3)
    return {
        "signal":     signal,
        "confidence": confidence,
        "reason":     " · ".join(reasons),
        "price":      price,
        "indicators": {"ema20": ema20, "ema50": ema50, "macd": macd_val, "macd_signal": macd_sig},
    }


def _strategy_breakout(hist: pd.DataFrame) -> dict:
    """
    52-Week High/Low Breakout Strategy
    ────────────────────────────────────
    BUY  : Price within 3% of 52-week high (breakout momentum)
    SELL : Price within 3% of 52-week low  (breakdown risk)
    HOLD : Price in middle range
    """
    closes    = hist["Close"]
    price     = round(float(closes.iloc[-1]), 2)
    high_52w  = round(float(closes.max()), 2)
    low_52w   = round(float(closes.min()), 2)
    sma_20    = calc_sma(closes, 20)

    price_range = high_52w - low_52w if high_52w != low_52w else 1.0
    position    = (price - low_52w) / price_range   # 0 = at 52w low, 1 = at 52w high

    pct_from_high = round(((high_52w - price) / high_52w) * 100, 2)
    pct_from_low  = round(((price - low_52w) / low_52w) * 100, 2) if low_52w > 0 else 0

    votes   = 0
    reasons = []

    if pct_from_high <= 3.0:
        votes += 3
        reasons.append(f"Price ₹{price} within {pct_from_high}% of 52w high ₹{high_52w} — breakout zone")
    elif position >= 0.80:
        votes += 2
        reasons.append(f"Price in upper 20% of 52w range — strong momentum")
    elif pct_from_low <= 3.0:
        votes -= 3
        reasons.append(f"Price ₹{price} within {pct_from_low}% of 52w low ₹{low_52w} — breakdown risk")
    elif position <= 0.20:
        votes -= 2
        reasons.append(f"Price in lower 20% of 52w range — weakness")
    else:
        reasons.append(f"Price at {position*100:.0f}% of 52w range — no breakout")

    # SMA20 as trend filter
    if price > sma_20:
        votes += 1
        reasons.append(f"Above SMA20 ₹{sma_20}")
    else:
        votes -= 1
        reasons.append(f"Below SMA20 ₹{sma_20}")

    signal, confidence = _votes_to_signal(votes, max_votes=4)
    return {
        "signal":     signal,
        "confidence": confidence,
        "reason":     " · ".join(reasons),
        "price":      price,
        "indicators": {"high_52w": high_52w, "low_52w": low_52w, "sma20": sma_20},
    }


# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY REGISTRY — add new strategies here
# ═══════════════════════════════════════════════════════════════════════════════

STRATEGY_MAP: dict[str, callable] = {
    "momentum":       _strategy_momentum,
    "mean_reversion": _strategy_mean_reversion,
    "trend":          _strategy_trend,
    "breakout":       _strategy_breakout,
}


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def compute_signal(
    strategy_type: str,
    hist: pd.DataFrame,
    symbol: str,
) -> dict:
    """
    Main entry point called by FastAPI route.
    Returns a standardised signal dict:
      {
        symbol, signal, confidence, reason, price,
        strategy_type, indicators
      }
    Raises ValueError for unknown strategy_type.
    """
    fn = STRATEGY_MAP.get(strategy_type)
    if fn is None:
        known = list(STRATEGY_MAP.keys())
        raise ValueError(f"Unknown strategy_type '{strategy_type}'. Known: {known}")

    if hist.empty or len(hist) < 5:
        return {
            "symbol":        symbol.upper(),
            "signal":        "HOLD",
            "confidence":    0,
            "reason":        "Insufficient historical data (< 5 candles)",
            "price":         0.0,
            "strategy_type": strategy_type,
            "indicators":    {},
        }

    result = fn(hist)
    return {
        "symbol":        symbol.upper(),
        "signal":        result["signal"],
        "confidence":    result["confidence"],
        "reason":        result["reason"],
        "price":         result["price"],
        "strategy_type": strategy_type,
        "indicators":    result.get("indicators", {}),
    }