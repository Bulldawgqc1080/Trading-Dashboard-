const http = require('http');
const https = require('https');
const url = require('url');

const { PORT, CACHE_TTL, WATCHLIST, WATCHLIST_CACHE_TTL } = require('../lib/config');
const { calcSMA, calcEMA, calcRSI, calcSlope, calcTrend } = require('../lib/indicators');
const { buildMarketScore, estimateVixPercentile } = require('../lib/scoring/market');
const { buildConfidence } = require('../lib/scoring/confidence');
const { buildStockVerdict, buildWatchlistSignal } = require('../lib/scoring/watchlist');
const { getFeedQuality, buildSystemStatus } = require('../lib/health');

let cache = { data: null, ts: 0 };
let watchlistCache = { data: null, ts: 0, marketDecision: null };
let feedHealth = {};

function httpsGet(reqUrl) {
  return new Promise((resolve, reject) => {
    const opts = new URL(reqUrl);
    const options = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
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
    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const timestamps = result.timestamp || [];
    const validCloses = closes.filter(c => c !== null && !isNaN(c));
    const price = meta.regularMarketPrice || validCloses[validCloses.length - 1] || 0;
    const todayTs = new Date(); todayTs.setHours(0,0,0,0);
    const todayEpoch = todayTs.getTime() / 1000;
    let prev = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] < todayEpoch && closes[i] !== null && !isNaN(closes[i])) {
        prev = closes[i]; break;
      }
    }
    if (!prev) prev = meta.chartPreviousClose || validCloses[validCloses.length - 2] || price;
    const change = price - prev;
    const changePct = prev > 0 ? (change / prev) * 100 : 0;
    feedHealth[feedKey] = { status: 'ok', ts: Date.now(), latency: Date.now() - start, price };
    return {
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      prev: Math.round(prev * 100) / 100,
      closes: validCloses
    };
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
  const adRatioProxy = Math.round((0.8 + (upSectors / sectorCount) * 0.8) * 100) / 100;
  const highsLowsProxy = Math.round(30 + (upSectors / sectorCount) * 50);
  return { mode: 'proxy', pctAbove20: Math.round(pctAboveEma21), pctAbove50: Math.round(pctAboveSma89), pctAbove200: Math.round(pctAboveSma233), adRatio: adRatioProxy, nasdaqHL: highsLowsProxy, mcclellan: null, participation: Math.round(participation) };
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
    fetchYahooHistory('SPY', 300), fetchYahooHistory('QQQ', 120), fetchYahooHistory('^VIX', 30), fetchYahooHistory('^TNX', 20), fetchYahooHistory('DX-Y.NYB', 20),
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
    spy: { price: spyPrice, chg: spy?.changePct ?? 0, dollar: spy?.change ?? 0 }, qqq: { price: qqqPrice, chg: qqq?.changePct ?? 0, dollar: qqq?.change ?? 0 },
    vix: { price: vixLevel, chg: vix?.changePct ?? 0 }, dxy: { price: dxyPrice, chg: dxy?.changePct ?? 0 }, tnx: { price: tnxLevel, chg: tnx?.changePct ?? 0 },
    spyVs20: spyEma21 && spyPrice > spyEma21 ? 'above' : 'below', spyVs50: spySma89 && spyPrice > spySma89 ? 'above' : 'below', spyVs200: spySma233 && spyPrice > spySma233 ? 'above' : 'below',
    spyEma21AboveSma89: !!(spyEma21 && spySma89 && spyEma21 > spySma89), spySma89AboveSma233: !!(spySma89 && spySma233 && spySma89 > spySma233), qqqVs50: qqqSma89 ? (qqqPrice > qqqSma89 ? 'above' : 'below') : 'unknown',
    spyRSI, regime, vixLevel, vixSlope, vixPercentile: estimateVixPercentile(vixLevel), breadthMode: breadth.mode,
    pctAbove20: breadth.pctAbove20, pctAbove50: breadth.pctAbove50, pctAbove200: breadth.pctAbove200, adRatio: breadth.adRatio, nasdaqHL: breadth.nasdaqHL, participation: breadth.participation,
    tenYrLevel: tnxLevel, tenYrTrend, dxyTrend, fedStance: 'neutral', macroMode: 'partial', putCallMode: 'unavailable', fomc72hr: false, marketOpen: marketStatus.open, marketStatus: marketStatus.label,
    sectors, lastUpdated: new Date().toISOString(), dataSource: 'Yahoo Finance (live)', spyHistory
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
    const verdictData = buildStockVerdict({ price, ema8, ema21, sma89, sma233, rsi, relStrength, changePct: quote.changePct, history, spyHistory, marketDecision });
    const reasons = [];
    if (sma233) reasons.push(price > sma233 ? 'Above SMA 233' : 'Below SMA 233');
    if (relStrength > 2) reasons.push(`Outperforming SPY +${relStrength.toFixed(1)}%`); else if (relStrength < -2) reasons.push(`Underperforming SPY ${relStrength.toFixed(1)}%`);
    if (rsi > 50 && rsi < 70) reasons.push(`RSI healthy (${rsi})`);
    const signal = buildWatchlistSignal({ ...verdictData, vs20: ema21 ? (price > ema21 ? 'above' : 'below') : 'unknown', vs50: sma89 ? (price > sma89 ? 'above' : 'below') : 'unknown', vs200: sma233 ? (price > sma233 ? 'above' : 'below') : 'unknown', rsi, relStrength }, marketDecision);
    return {
      symbol, price, changePct: quote.changePct, change: quote.change, ema8, ema21, sma89, sma233,
      vs20: ema21 ? (price > ema21 ? 'above' : 'below') : 'unknown', vs50: sma89 ? (price > sma89 ? 'above' : 'below') : 'unknown', vs200: sma233 ? (price > sma233 ? 'above' : 'below') : 'unknown',
      rsi, relStrength, reasons: reasons.slice(0, 3), signal, ...verdictData
    };
  }));
  return stocks.filter(Boolean).sort((a, b) => b.combinedScore - a.combinedScore);
}

async function getMarketPayload() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;
  const marketData = await buildMarketData();
  const feedQuality = getFeedQuality(feedHealth);
  const systemStatus = buildSystemStatus({ marketData, feedQuality });
  const confidence = buildConfidence({ marketData, feedQuality, systemStatus });
  let payload;
  if (systemStatus.suppressDecision) {
    payload = { status: 'unavailable', timestamp: new Date().toISOString(), modelVersion: 'market-v1', systemStatus, confidenceScore: confidence.confidenceScore, confidenceLabel: confidence.confidenceLabel, confidenceReasons: confidence.confidenceReasons, dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors, proxyInputs: marketData.breadthMode === 'proxy' ? ['breadth'] : [], missingInputs: ['putCall'] }, market: { spy: marketData.spy, qqq: marketData.qqq, vix: marketData.vix, dxy: marketData.dxy, tnx: marketData.tnx } };
  } else {
    const score = buildMarketScore(marketData);
    payload = { status: systemStatus.status, timestamp: new Date().toISOString(), modelVersion: score.modelVersion, decision: score.decision, score: score.weightedScore, summary: score.summary, guidance: score.guidance, topReasons: score.topReasons, blockers: score.blockers, categoryScores: score.categoryScores, vetoFlags: score.vetoFlags, confidenceScore: confidence.confidenceScore, confidenceLabel: confidence.confidenceLabel, confidenceReasons: confidence.confidenceReasons, systemStatus, dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors, proxyInputs: marketData.breadthMode === 'proxy' ? ['breadth'] : [], missingInputs: ['putCall'] }, market: { spy: marketData.spy, qqq: marketData.qqq, vix: marketData.vix, dxy: marketData.dxy, tnx: marketData.tnx }, spyHistory: marketData.spyHistory };
  }
  cache = { data: payload, ts: now };
  return payload;
}

async function getWatchlistPayload() {
  const now = Date.now();
  const market = await getMarketPayload();
  if (watchlistCache.data && now - watchlistCache.ts < WATCHLIST_CACHE_TTL && watchlistCache.marketDecision === market.decision) return { stocks: watchlistCache.data, cached: true };
  if (!market.spyHistory) throw new Error('Missing SPY history for watchlist');
  const stocks = await buildWatchlistData(market.spyHistory, market.decision || 'NO');
  watchlistCache = { data: stocks, ts: now, marketDecision: market.decision };
  return { stocks, cached: false };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/api/market') {
    try { const data = await getMarketPayload(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' }); res.end(JSON.stringify(data)); }
    catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'unavailable', error: err.message })); }
    return;
  }

  if (parsed.pathname === '/api/watchlist') {
    try { const data = await getWatchlistPayload(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' }); res.end(JSON.stringify(data)); }
    catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
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
