[README.md](https://github.com/user-attachments/files/26385770/README.md)
# SIBT — Should I Be Trading?

Reliability-first market **permission** dashboard for swing traders.

## Core framing
SIBT is a **market permission tool**, not a directional prediction engine.

## Basic test pass
A lightweight test pass now exists for:
- market scoring buckets
- feed health / unavailable state
- confidence scoring

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
