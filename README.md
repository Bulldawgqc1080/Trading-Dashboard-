[README.md](https://github.com/user-attachments/files/26385920/README.md)
# SIBT — Should I Be Trading?

Reliability-first market **permission** dashboard for swing traders.

## Core framing
SIBT is a **market permission tool**, not a directional prediction engine.

## Cleanup pass completed
Recent cleanup improvements:
- removed unnecessary `spyHistory` from `/api/market` public payload
- kept SPY history server-side for watchlist logic only
- split market cache from watchlist use more cleanly
- kept behavior the same while trimming payload size

## Basic test pass
Run locally:
```bash
npm test
```

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
test/fixtures/*.json
test/*.test.js
```
