# SIBT — Should I Be Trading?

Bloomberg Terminal-style market environment dashboard for swing traders.

## What it does
- Pulls live data from Yahoo Finance (SPY, QQQ, VIX, sectors, 10Y, DXY)
- Scores the market across 5 weighted categories (0–100)
- Outputs a clear YES / CAUTION / NO trading decision
- Generates a plain-English market summary from the scores
- Auto-refreshes every 45 seconds
- Falls back to demo data if backend is unreachable

## Scoring Weights
| Category   | Weight |
|------------|--------|
| Volatility | 25%    |
| Momentum   | 25%    |
| Trend      | 20%    |
| Breadth    | 20%    |
| Macro      | 10%    |

## Decision Thresholds
| Score   | Swing    | Day Trade |
|---------|----------|-----------|
| 80–100  | YES      | —         |
| 75–100  | —        | YES       |
| 60–79   | CAUTION  | —         |
| 55–74   | —        | CAUTION   |
| < 60    | NO       | —         |
| < 55    | —        | NO        |

---

## Local Development

### 1. Start the backend
```bash
cd sibt
node api/server.js
```
Backend runs at: http://localhost:3001
Test it: http://localhost:3001/api/market

### 2. Open the frontend
Open `public/index.html` directly in your browser.
The frontend auto-detects localhost and hits `http://localhost:3001/api/market`.

---

## Deploy to Vercel

### One-time setup
```bash
npm install -g vercel
```

### Deploy
```bash
cd sibt
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? (your account)
- Link to existing project? **N**
- Project name: **sibt** (or anything)
- Directory: **./** (current)
- Override settings? **N**

Your dashboard will be live at `https://sibt-[random].vercel.app`

### Production deploy
```bash
vercel --prod
```

---

## Data Sources
- **Quotes & sector data**: Yahoo Finance v7 API (free, no key needed)
- **Price history**: Yahoo Finance v8 chart API (for MA calculations)
- **FOMC calendar**: Hardcoded dates (update annually in `api/server.js`)
- **Fed stance**: Manual — update `getFedStance()` in `api/server.js`
- **Breadth data**: Estimated from sector internals (real breadth requires paid data)

## Known Limitations
- Yahoo Finance unofficial API — may have rate limits or occasional downtime
- Breadth data (% above MAs, A/D line) is estimated, not real NYSE data
- McClellan Oscillator is approximated from sector breadth
- Put/Call ratio is static (requires CBOE feed for real data)
- Fed stance must be updated manually

## Roadmap
- [ ] Wire real breadth data (StockAnalysis free API)
- [ ] Add CBOE put/call ratio
- [ ] Historical score chart (last 30 days)
- [ ] Mobile layout improvements
- [ ] Email/SMS alert when score crosses threshold
- [ ] Optional OpenAI "deep analysis" button
