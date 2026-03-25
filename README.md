[README.md](https://github.com/user-attachments/files/26251406/README.md)
# SIBT — Should I Be Trading?

Market environment dashboard for swing traders.

## What it does
- Pulls live market data from Yahoo Finance
- Tracks SPY, QQQ, VIX, DXY, 10Y, and sector ETFs
- Scores the market across 5 weighted categories (0–100)
- Produces a simple market decision:
  - **YES**
  - **CAUTION**
  - **NO**
- Ranks watchlist names based on setup + momentum
- Applies **market regime gating** so weak market conditions reduce stock-level signals
- Auto-refreshes on a timer
- Falls back to demo behavior if the backend is unreachable

---

## Core Model

### Market Regime Score
The market score is built from 5 categories:

| Category   | Weight |
|------------|--------|
| Volatility | 25%    |
| Momentum   | 25%    |
| Trend      | 20%    |
| Breadth    | 20%    |
| Macro      | 10%    |

### Decision Bands
Current regime output:

| Score | Decision |
|------|----------|
| 70–100 | YES |
| 45–69 | CAUTION |
| 0–44 | NO |

### Veto Logic
The backend also applies **regime veto rules**.

Even if the weighted score looks acceptable, the final decision can be capped lower when multiple hostile conditions appear together, such as:
- elevated and rising volatility
- SPY below major moving averages
- weak participation
- defensive sector leadership

This keeps the model from being too optimistic in structurally weak tape.

---

## Watchlist Logic
Watchlist names are scored separately from the market regime.

Each stock uses:
- trend structure
- relative strength vs SPY
- momentum
- setup quality

But stock verdicts are also **gated by the market regime**:

- In a **NO** market, stocks are downgraded
- In a **CAUTION** market, `ACTIONABLE` requires stronger conditions
- Single-name strength is not allowed to fully override hostile market context

---

## Data Notes

### Reliable enough for dashboard use
- SPY / QQQ / sector ETF pricing
- VIX level and short-term slope
- moving averages
- RSI
- sector leadership
- relative strength vs SPY

### Proxy / partial inputs
Some parts of the model are intentionally marked as less authoritative:

- **Breadth** = currently a **proxy**
  - estimated from sector participation and SPY tone
  - not true exchange breadth
- **Macro** = currently **partial**
  - uses yields, dollar trend, and FOMC proximity
  - not a full macro regime model
- **Put/Call** = currently **unavailable**
  - not wired to a live options sentiment feed

---

## Important Limitations
This project is useful as a **market context tool**, but it should not be treated as a fully validated execution engine.

Current limitations:
- Yahoo Finance is unofficial and may be inconsistent
- breadth is proxy-based, not true NYSE/Nasdaq internals
- macro model is partial
- no live put/call feed
- no institutional-grade market internals
- no formal backtest layer yet

If this is used for real-money trading, it should be treated as a **decision support dashboard**, not a blind signal engine.

---

## What would improve accuracy
To make the model more serious, the next upgrades should be:

- real breadth data
  - adv/decl
  - new highs/new lows
  - % above key moving averages
- live put/call data
- stronger macro inputs
- backtesting against forward returns
- better validation of regime thresholds

---

## Local Development

### Start the backend
```bash
node api/server.js
```

Backend default:
```text
http://localhost:3001
```

Market endpoint:
```text
http://localhost:3001/api/market
```

Watchlist endpoint:
```text
http://localhost:3001/api/watchlist
```

Crypto endpoint:
```text
http://localhost:3001/api/crypto
```

### Frontend
Open:
```text
public/index.html
```

The frontend auto-detects localhost and calls the local backend.

---

## Deployment
This project can be deployed on Vercel or any simple Node-compatible host.

---

## Current Philosophy
SIBT is built to answer:

**“Is this a good environment to press risk?”**

It is **not** meant to imply:
- guaranteed trades
- automated execution quality
- institutional-grade precision

The goal is clarity, discipline, and context — not false certainty.
