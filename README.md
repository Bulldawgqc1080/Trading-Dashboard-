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

## MSTR covered-call desk

The dashboard includes a deterministic, paper-only covered-call comparison for MSTR. Manual broker quotes always work as a fallback. To enable the automatic Tradier chain on Vercel, configure server-side environment variables (never expose the token through `public/` or commit it):

- `TRADIER_TOKEN`: Tradier live or sandbox API token
- `TRADIER_SANDBOX=true`: optional; uses delayed sandbox market data

The app reads market data only. It contains no order-placement endpoint.

## Schwab market-data migration

The registered OAuth callback URL is:

`https://trading-dashboard-chi-vert.vercel.app/api/schwab/callback`

The Schwab application should request only the Market Data Production product. The callback is intentionally a no-store placeholder until the App Key and App Secret are configured through protected Vercel environment variables. Never commit or place those values in browser code.

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
