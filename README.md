[README.md](https://github.com/user-attachments/files/26385920/README.md)
# SIBT — Should I Be Trading?

Reliability-first market **permission** dashboard for swing traders.

## Core framing
SIBT is a **market permission tool**, not a directional prediction engine.

## Decision layers
- The market-permission score measures whether broad conditions support new swing risk.
- Stock setup and momentum scores evaluate each ticker independently.
- Entry posture combines the stock setup with market permission without rewriting the stock's own score.
- The browser-local editable watchlist supports up to 12 tickers and links each name to the options desk.
- Forward validation uses exact trading-date matches. Closed-market snapshots are excluded and performance percentages remain hidden until each decision bucket has at least 10 verified observations.
- Proxy breadth is excluded from scoring. Published FOMC, CPI, jobs-report, market-holiday, and early-close dates are explicit model inputs.

## Basic test pass
Run locally:
```bash
npm test
```

## Covered-call desk

The dashboard includes a deterministic, paper-only covered-call comparison for Schwab-supported optionable U.S. stocks and ETFs. Holdings, screening rules, and paper journals remain browser-only. Manual broker quotes work as a fallback.

- `TRADIER_TOKEN`: Tradier live or sandbox API token
- `TRADIER_SANDBOX=true`: optional; uses delayed sandbox market data

The app reads market data only. It contains no order-placement endpoint.

## Cash-secured-put desk

The put desk screens standard 100-share puts using full cash coverage, a hard maximum purchase strike, quote freshness, liquidity, premium, expiration, scheduled-event risk, and the dashboard's stock-entry posture. It ranks only surviving contracts with disclosed conservative, balanced, and income-focused decision scores. Browser-local paper assignment can continue into the covered-call side of a wheel workflow; no real position or order is created.

## Schwab market-data migration

The registered OAuth callback URL is:

`https://trading-dashboard-chi-vert.vercel.app/api/schwab/callback`

The Schwab application requests only Market Data Production. OAuth tokens are stored in an encrypted HttpOnly cookie; app credentials remain protected Vercel environment variables. The server exposes no account, position, or order endpoint. Never commit or place credential values in browser code.

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
