[README.md](https://github.com/user-attachments/files/26385404/README.md)
# SIBT — Should I Be Trading?

Reliability-first market **permission** dashboard for swing traders.

## Core framing
SIBT is a **market permission tool**, not a directional prediction engine.

It is designed to answer:
- Is the environment supportive for pressing fresh swing risk?
- How much permission exists right now?
- What is blocking better conditions?

It is **not** designed to claim:
- where SPY must go next
- automatic bearish/bullish forecasts
- guaranteed trade outcomes

## What changed in this refactor
- Canonical project structure: `api/`, `public/`, `lib/`
- No production demo fallback for live failures
- Explicit system states: `ok`, `degraded`, `unavailable`
- Confidence scoring added
- Backend owns decision truth; frontend renders only
- Watchlist ported into new structure
- Journal + backtest ported into new structure
- Market wording updated to emphasize permission over prediction

## Project structure
```text
api/server.js
public/index.html
public/app.js
public/styles.css
lib/config.js
lib/indicators.js
lib/health.js
lib/scoring/market.js
lib/scoring/confidence.js
lib/scoring/watchlist.js
lib/journal/store.js
lib/journal/backtest.js
```

## Run locally
```bash
node api/server.js
```
