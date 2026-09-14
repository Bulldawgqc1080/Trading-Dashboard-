const http = require('http');
const { normalizeQuote } = require('../lib/quotes');
const https = require('https');

const { PORT, CACHE_TTL, WATCHLIST, WATCHLIST_CACHE_TTL } = require('../lib/config');
const { calcSMA, calcEMA, calcRSI, calcSlope, calcTrend } = require('../lib/indicators');
const { buildMarketScore, estimateVixPercentile } = require('../lib/scoring/market');
const { buildConfidence } = require('../lib/scoring/confidence');
const { buildStockVerdict, buildWatchlistSignal } = require('../lib/scoring/watchlist');
const { getFeedQuality, buildSystemStatus } = require('../lib/health');
const { loadJournal, logJournalEntry, getJournal } = require('../lib/journal/store');
const { backfillJournalOutcomes, buildBacktestSummary } = require('../lib/journal/backtest');
const { buildMstrChain } = require('../lib/options/tradier');
const { buildSchwabMstrChain } = require('../lib/options/schwab');
const schwabOauth = require('../lib/schwab/oauth');

let marketCache = { data: null, ts: 0, spyHistory: null };
let watchlistCache = { data: null, ts: 0, marketDecision: null };
let feedHealth = {};
loadJournal().catch(() => {});

function httpsGet(reqUrl) {
  return new Promise((resolve, reject) => {
    const opts = new URL(reqUrl);
    const options = { hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' } };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error: ' + data.slice(0, 300))); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function tradierGet(pathname, params) {
  const token = process.env.TRADIER_TOKEN;
  if (!token) throw new Error('TRADIER_TOKEN is not configured');
  const sandbox = process.env.TRADIER_SANDBOX === 'true';
  const reqUrl = new URL(`/v1${pathname}`, sandbox ? 'https://sandbox.tradier.com' : 'https://api.tradier.com');
  for (const [key, value] of Object.entries(params || {})) reqUrl.searchParams.set(key, value);
  return new Promise((resolve, reject) => {
    const req = https.get(reqUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Tradier returned HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Tradier returned invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Tradier request timed out')); });
  });
}

async function fetchYahooHistory(symbol, days) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - (days * 24 * 3600);
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const data = await httpsGet(u);
  const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
  return closes.filter(c => c !== null && !isNaN(c));
}

async function fetchSingleQuote(symbol, feedKey) {
  const start = Date.now();
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (7 * 24 * 3600);
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=true`;
    const data = await httpsGet(u);
    const result = data?.chart?.result?.[0];
    if (!result) {
      feedHealth[feedKey] = { status: 'error', error: 'No result', ts: Date.now(), latency: Date.now() - start };
      return null;
    }
    const quote = normalizeQuote(result);
    if (!quote.price || quote.changePct == null) throw new Error('Incomplete quote or previous session close');
    feedHealth[feedKey] = { status: 'ok', ts: Date.now(), latency: Date.now() - start, price: quote.price, quoteAsOf: quote.quoteAsOf };
    return quote;
  } catch (e) {
    feedHealth[feedKey] = { status: 'error', error: e.message, ts: Date.now(), latency: Date.now() - start };
    return null;
  }
}

function estimateBreadth(spyChgPct, sectorChanges) {
  const upSectors = sectorChanges.filter(c => c > 0).length;
  const sectorCount = sectorChanges.length || 1;
  const participation = (upSectors / sectorCount) * 100;
  const spyFactor = spyChgPct > 1 ? 12 : spyChgPct > 0.5 ? 6 : spyChgPct > 0 ? 2 : spyChgPct > -0.5 ? -4 : -10;
  const pctAboveEma21 = Math.max(20, Math.min(80, participation + spyFactor));
  const pctAboveSma89 = Math.max(15, Math.min(75, pctAboveEma21 - 6));
  const pctAboveSma233 = Math.max(10, Math.min(70, pctAboveSma89 - 6));
  return {
    mode: 'proxy',
    pctAbove20: Math.round(pctAboveEma21),
    pctAbove50: Math.round(pctAboveSma89),
    pctAbove200: Math.round(pctAboveSma233),
    adRatio: Math.round((0.8 + (upSectors / sectorCount) * 0.8) * 100) / 100,
    nasdaqHL: Math.round(30 + (upSectors / sectorCount) * 50),
    mcclellan: null,
    participation: Math.round(participation)
  };
}

function getMarketStatus() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const weekday = map.weekday;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const timeNum = hour * 100 + minute;
  if (weekday === 'Sat' || weekday === 'Sun') return { open: false, label: 'WEEKEND' };
  if (timeNum < 930) return { open: false, label: 'PRE-MARKET' };
  if (timeNum >= 1600) return { open: false, label: 'AFTER-HOURS' };
  return { open: true, label: 'MARKET OPEN' };
}

async function buildMarketData() {
  const sectorSyms = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];
  const sectorNames = { XLK:'Technology', XLF:'Financials', XLE:'Energy', XLV:'Health Care', XLI:'Industrials', XLY:'Cons Discret', XLP:'Cons Staples', XLU:'Utilities', XLB:'Materials', XLRE:'Real Estate', XLC:'Comm Services' };
  const [spy, qqq, vix, dxy, tnx, spyHistory, qqqHistory, vixHistory, tnxHistory, dxyHistory, ...sectorResults] = await Promise.all([
    fetchSingleQuote('SPY', 'SPY'), fetchSingleQuote('QQQ', 'QQQ'), fetchSingleQuote('^VIX', 'VIX'), fetchSingleQuote('DX-Y.NYB', 'DXY'), fetchSingleQuote('^TNX', 'TNX'),
    fetchYahooHistory('SPY', 500), fetchYahooHistory('QQQ', 180), fetchYahooHistory('^VIX', 30), fetchYahooHistory('^TNX', 20), fetchYahooHistory('DX-Y.NYB', 20),
    ...sectorSyms.map(s => fetchSingleQuote(s, s))
  ]);

  const spyPrice = spy?.price || 0, qqqPrice = qqq?.price || 0, vixLevel = vix?.price || 0, dxyPrice = dxy?.price || 0, tnxLevel = tnx?.price || 0;
  const spyEma21 = calcEMA(spyHistory, 21), spySma89 = calcSMA(spyHistory, 89), spySma233 = calcSMA(spyHistory, 233), qqqSma89 = calcSMA(qqqHistory, 89);
  const spyRSI = calcRSI(spyHistory, 14), vixSlope = calcSlope(vixHistory, 5), tenYrTrend = calcTrend(tnxHistory, 3, 10), dxyTrend = calcTrend(dxyHistory, 3, 10);
  const sectors = sectorSyms.map((sym, i) => ({ sym, name: sectorNames[sym], price: sectorResults[i]?.price ?? 0, chg: sectorResults[i]?.changePct ?? 0 })).sort((a, b) => b.chg - a.chg);
  const breadth = estimateBreadth(spy?.changePct || 0, sectors.map(s => s.chg));
  const regime = (spyPrice > spySma89 && spyPrice > spySma233 && spyRSI > 45) ? 'uptrend' : (spyPrice < spySma89 && spyPrice < spySma233) ? 'downtrend' : 'chop';
  const marketStatus = getMarketStatus();

  return {
    publicData: {
      spy: { price: spyPrice, chg: spy?.changePct ?? null, dollar: spy?.change ?? null, quoteAsOf: spy?.quoteAsOf },
      qqq: { price: qqqPrice, chg: qqq?.changePct ?? 0, dollar: qqq?.change ?? 0 },
      vix: { price: vixLevel, chg: vix?.changePct ?? 0 },
      dxy: { price: dxyPrice, chg: dxy?.changePct ?? 0 },
      tnx: { price: tnxLevel, chg: tnx?.changePct ?? 0 },
      spyVs20: spyEma21 && spyPrice > spyEma21 ? 'above' : 'below',
      spyVs50: spySma89 && spyPrice > spySma89 ? 'above' : 'below',
      spyVs200: spySma233 ? (spyPrice > spySma233 ? 'above' : 'below') : 'unknown',
      indicatorHistoryComplete: !!(spySma233 && spySma89 && qqqSma89),
      spyEma21AboveSma89: !!(spyEma21 && spySma89 && spyEma21 > spySma89),
      spySma89AboveSma233: !!(spySma89 && spySma233 && spySma89 > spySma233),
      qqqVs50: qqqSma89 ? (qqqPrice > qqqSma89 ? 'above' : 'below') : 'unknown',
      spyRSI,
      regime,
      vixLevel,
      vixSlope,
      vixPercentile: estimateVixPercentile(vixLevel),
      breadthMode: breadth.mode,
      pctAbove20: breadth.pctAbove20,
      pctAbove50: breadth.pctAbove50,
      pctAbove200: breadth.pctAbove200,
      adRatio: breadth.adRatio,
      nasdaqHL: breadth.nasdaqHL,
      participation: breadth.participation,
      tenYrLevel: tnxLevel,
      tenYrTrend,
      dxyTrend,
      fedStance: 'neutral',
      macroMode: 'partial',
      putCallMode: 'unavailable',
      fomc72hr: null,
      marketOpen: marketStatus.open,
      marketStatus: marketStatus.label,
      sectors,
      lastUpdated: new Date().toISOString(),
      dataSource: 'Yahoo Finance (live)'
    },
    spyHistory
  };
}

async function buildWatchlistData(spyHistory, marketDecision) {
  const stocks = await Promise.all(WATCHLIST.map(async (symbol) => {
    const [history, quote] = await Promise.all([fetchYahooHistory(symbol, 400), fetchSingleQuote(symbol, 'WL_' + symbol)]);
    if (!quote || history.length < 20) return null;
    const price = quote.price;
    const ema8 = calcEMA(history, 8), ema21 = calcEMA(history, 21), sma89 = calcSMA(history, 89), sma233 = calcSMA(history, 233), rsi = calcRSI(history, 14);
    const stockPerf20 = history.length >= 20 ? ((history[history.length - 1] - history[history.length - 20]) / history[history.length - 20]) * 100 : 0;
    const spyPerf20 = spyHistory.length >= 20 ? ((spyHistory[spyHistory.length - 1] - spyHistory[spyHistory.length - 20]) / spyHistory[spyHistory.length - 20]) * 100 : 0;
    const relStrength = Math.round((stockPerf20 - spyPerf20) * 100) / 100;
    const verdictData = buildStockVerdict({ symbol, price, ema8, ema21, sma89, sma233, rsi, relStrength, changePct: quote.changePct, history, marketDecision });
    const signal = buildWatchlistSignal({ ...verdictData, vs20: ema21 ? (price > ema21 ? 'above' : 'below') : 'unknown', vs50: sma89 ? (price > sma89 ? 'above' : 'below') : 'unknown', vs200: sma233 ? (price > sma233 ? 'above' : 'below') : 'unknown', rsi, relStrength }, marketDecision);
    return { symbol, price, changePct: quote.changePct, change: quote.change, ema8, ema21, sma89, sma233, vs20: ema21 ? (price > ema21 ? 'above' : 'below') : 'unknown', vs50: sma89 ? (price > sma89 ? 'above' : 'below') : 'unknown', vs200: sma233 ? (price > sma233 ? 'above' : 'below') : 'unknown', rsi, relStrength, signal, ...verdictData };
  }));
  return stocks.filter(Boolean).sort((a, b) => b.combinedScore - a.combinedScore);
}

async function getMarketPayload() {
  const now = Date.now();
  if (marketCache.data && now - marketCache.ts < CACHE_TTL) return marketCache.data;

  const built = await buildMarketData();
  const marketData = built.publicData;
  const spyHistory = built.spyHistory;
  const feedQuality = getFeedQuality(feedHealth);
  const systemStatus = buildSystemStatus({ marketData, feedQuality });
  const confidence = buildConfidence({ marketData, feedQuality, systemStatus });

  let payload;
  if (systemStatus.suppressDecision) {
    payload = {
      status: 'unavailable',
      timestamp: new Date().toISOString(),
      modelVersion: 'market-v1',
      systemStatus,
      confidenceScore: confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel,
      confidenceReasons: confidence.confidenceReasons,
      dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors, proxyInputs: marketData.breadthMode === 'proxy' ? ['breadth'] : [], missingInputs: ['putCall'] },
      market: { spy: marketData.spy, qqq: marketData.qqq, vix: marketData.vix, dxy: marketData.dxy, tnx: marketData.tnx }
    };
  } else {
    const score = buildMarketScore(marketData);
    payload = {
      status: systemStatus.status,
      timestamp: new Date().toISOString(),
      modelVersion: score.modelVersion,
      decision: score.decision,
      permissionLabel: score.permissionLabel,
      score: score.weightedScore,
      summary: score.summary,
      guidance: score.guidance,
      interpretation: score.interpretation,
      topReasons: score.topReasons,
      blockers: score.blockers,
      validationWarnings: score.validationWarnings,
      categoryScores: score.categoryScores,
      vetoFlags: score.vetoFlags,
      confidenceScore: confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel,
      confidenceReasons: confidence.confidenceReasons,
      systemStatus,
      dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors, proxyInputs: marketData.breadthMode === 'proxy' ? ['breadth'] : [], missingInputs: ['putCall'] },
      market: { spy: marketData.spy, qqq: marketData.qqq, vix: marketData.vix, dxy: marketData.dxy, tnx: marketData.tnx }
    };

    await logJournalEntry({
      modelVersion: score.modelVersion,
      decision: score.decision,
      permissionLabel: score.permissionLabel,
      score: score.weightedScore,
      confidenceScore: confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel,
      status: systemStatus.status,
      marketStatus: marketData.marketStatus,
      spyEntry: marketData.spy.price,
      qqqEntry: marketData.qqq.price,
      vixEntry: marketData.vix.price,
      breadthMode: marketData.breadthMode,
      topReasons: score.topReasons,
      blockers: score.blockers,
      validationWarnings: score.validationWarnings,
      dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors },
      inputsSnapshot: { spy: marketData.spy.price, qqq: marketData.qqq.price, vix: marketData.vix.price, pctAbove50: marketData.pctAbove50, adRatio: marketData.adRatio, topSector: marketData.sectors[0]?.sym || null }
    });
  }

  marketCache = { data: payload, ts: now, spyHistory };
  return payload;
}

async function getWatchlistPayload() {
  const now = Date.now();
  const market = await getMarketPayload();
  const spyHistory = marketCache.spyHistory;
  if (watchlistCache.data && now - watchlistCache.ts < WATCHLIST_CACHE_TTL && watchlistCache.marketDecision === market.decision) return { stocks: watchlistCache.data, cached: true };
  if (!spyHistory) throw new Error('Missing SPY history for watchlist');
  const stocks = await buildWatchlistData(spyHistory, market.decision || 'NO');
  watchlistCache = { data: stocks, ts: now, marketDecision: market.decision };
  return { stocks, cached: false };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parsed = { pathname: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams) };
  if (parsed.pathname === '/api/schwab/login') {
    try {
      const auth = schwabOauth.startAuthorization();
      res.writeHead(302, {
        Location: auth.url,
        'Set-Cookie': auth.setCookie,
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer'
      });
      res.end();
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
      res.end('Schwab market-data connection is not configured yet.');
    }
    return;
  }

  if (parsed.pathname === '/api/schwab/callback') {
    try {
      if (parsed.query.error) throw new Error('Schwab authorization was cancelled or denied');
      if (!parsed.query.code || !schwabOauth.validateState(req, parsed.query.state)) throw new Error('Invalid or expired Schwab authorization state');
      const session = await schwabOauth.exchangeCode(parsed.query.code);
      const cookies = [schwabOauth.sessionCookie(session), ...schwabOauth.clearCookies().slice(1)];
      res.writeHead(302, {
        Location: '/?schwab=connected#optionsDesk',
        'Set-Cookie': cookies,
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer'
      });
      res.end();
    } catch (err) {
      res.writeHead(400, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': schwabOauth.clearCookies().slice(1),
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
      });
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Schwab connection failed</title><body style="font:16px system-ui;background:#07111a;color:#d5e4f0;padding:40px;max-width:720px;margin:auto"><h1 style="color:#ffb86b">Schwab connection failed</h1><p>${String(err.message).replace(/[&<>"']/g, '')}</p><p><a style="color:#59d0ff" href="/?schwab=failed#optionsDesk">Return to the MSTR options desk</a></p></body></html>`);
    }
    return;
  }

  if (parsed.pathname === '/api/schwab/status') {
    try {
      const auth = schwabOauth.configured() ? await schwabOauth.validSession(req) : { session: null, setCookie: null };
      const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' };
      if (auth.setCookie) headers['Set-Cookie'] = auth.setCookie;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ status: auth.session ? 'connected' : schwabOauth.configured() ? 'authorization_required' : 'configuration_required', configured: schwabOauth.configured(), connected: Boolean(auth.session), marketDataOnly: true, orderPlacement: false, connectUrl: '/api/schwab/login' }));
    } catch {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Set-Cookie': schwabOauth.clearCookies()[0], 'Cache-Control': 'private, no-store, max-age=0' });
      res.end(JSON.stringify({ status: 'authorization_required', configured: schwabOauth.configured(), connected: false, marketDataOnly: true, orderPlacement: false, connectUrl: '/api/schwab/login' }));
    }
    return;
  }

  if (parsed.pathname === '/api/schwab/logout') {
    res.writeHead(302, { Location: '/#optionsDesk', 'Set-Cookie': schwabOauth.clearCookies(), 'Cache-Control': 'no-store, max-age=0' });
    res.end();
    return;
  }

  if (parsed.pathname === '/api/options/mstr') {
    let schwabAuth = { session: null, setCookie: null };
    if (schwabOauth.configured()) {
      try { schwabAuth = await schwabOauth.validSession(req); } catch { schwabAuth = { session: null, setCookie: schwabOauth.clearCookies()[0] }; }
    }
    const responseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' };
    if (schwabAuth.setCookie) responseHeaders['Set-Cookie'] = schwabAuth.setCookie;
    if (!schwabAuth.session && !process.env.TRADIER_TOKEN) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify({ status: schwabOauth.configured() ? 'authorization_required' : 'manual', error: schwabOauth.configured() ? 'Connect Schwab to load the MSTR chain.' : 'Automatic options data is not configured. Use manual broker quotes.', connectUrl: schwabOauth.configured() ? '/api/schwab/login' : null }));
      return;
    }
    if (parsed.query.probe === '1') {
      res.writeHead(200, responseHeaders);
      res.end(JSON.stringify({ status: 'ok', provider: schwabAuth.session ? 'Schwab' : 'Tradier', delayed: schwabAuth.session ? false : process.env.TRADIER_SANDBOX === 'true', configured: true, connected: Boolean(schwabAuth.session), marketDataOnly: true }));
      return;
    }
    try {
      const data = schwabAuth.session
        ? await buildSchwabMstrChain({ accessToken: schwabAuth.session.accessToken, minDte: parsed.query.minDte, maxDte: parsed.query.maxDte, minStrike: parsed.query.minStrike })
        : await buildMstrChain({ request: tradierGet, minDte: parsed.query.minDte, maxDte: parsed.query.maxDte, minStrike: parsed.query.minStrike });
      res.writeHead(200, responseHeaders);
      res.end(JSON.stringify({ status: 'ok', provider: schwabAuth.session ? 'Schwab' : 'Tradier', delayed: schwabAuth.session ? false : process.env.TRADIER_SANDBOX === 'true', retrievedAt: new Date().toISOString(), ...data }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify({ status: 'unavailable', error: err.message }));
    }
    return;
  }
  if (parsed.pathname === '/api/market') {
    try {
      const data = await getMarketPayload();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unavailable', error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/watchlist') {
    try {
      const data = await getWatchlistPayload();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/journal') {
    try {
      await backfillJournalOutcomes(fetchYahooHistory);
      const journal = getJournal();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify({ journal, count: journal.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/backtest') {
    try {
      await backfillJournalOutcomes(fetchYahooHistory);
      const summary = buildBacktestSummary();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify(summary));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/health') {
    const feedQuality = getFeedQuality(feedHealth);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), feedHealth, feedQuality }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`SIBT API running on port ${PORT}`));
