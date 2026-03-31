[README.md](https://github.com/user-attachments/files/26384105/README.md)
# SIBT — Should I Be Trading?

Reliability-first market environment dashboard for swing traders.

## What changed in this refactor
- Canonical project structure: `api/`, `public/`, `lib/`
- No production demo fallback for live failures
- Explicit system states: `ok`, `degraded`, `unavailable`
- Confidence scoring added
- Backend owns decision truth; frontend renders only

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
```

## Reliability rules
- Never show a trading verdict when critical market data is unavailable.
- Mark degraded/partial states clearly.
- Confidence is separate from score.
- Proxy inputs reduce confidence.

## Run locally
```bash
node api/server.js
```
Then open `public/index.html` through your deployed/static setup or Vercel.
