[README.md](https://github.com/user-attachments/files/26385283/README.md)
# SIBT — Should I Be Trading?

Reliability-first market environment dashboard for swing traders.

## What changed in this refactor
- Canonical project structure: `api/`, `public/`, `lib/`
- No production demo fallback for live failures
- Explicit system states: `ok`, `degraded`, `unavailable`
- Confidence scoring added
- Backend owns decision truth; frontend renders only
- Watchlist ported into new structure
- Journal + backtest ported into new structure

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
