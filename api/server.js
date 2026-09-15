const http = require('http');
const { normalizeQuote } = require('../lib/quotes');
const https = require('https');

const { MODEL_VERSION, STOCK_MODEL_VERSION, PORT, CACHE_TTL, WATCHLIST, WATCHLIST_CACHE_TTL } = require('../lib/config');
const { calcSMA, calcEMA, calcRSI, calcSlope, calcTrend, calcATR } = require('../lib/indicators');
const { buildMarketScore, estimateVixPercentile } = require('../lib/scoring/market');
const { buildConfidence } = require('../lib/scoring/confidence');
const { buildStockVerdict, buildWatchlistSignal } = require('../lib/scoring/watchlist');
const { getFeedQuality, buildSystemStatus } = require('../lib/health');
const { loadJournal, logJournalEntry, getJournal } = require('../lib/journal/store');
const { backfillJournalOutcomes, buildBacktestSummary } = require('../lib/journal/backtest');
const stockJournal = require('../lib/journal/stock-store');
const stockBacktest = require('../lib/journal/stock-backtest');
const { buildOptionChain } = require('../lib/options/tradier');
const { buildSchwabChain } = require('../lib/options/schwab');
const { getEarningsRisk } = require('../lib/events/nasdaq');
const { getMarketEventRisk, isMarketHoliday, getMarketCloseMinutes } = require('../lib/calendar/market-events');
const { normalizeWatchlistSymbols } = require('../lib/watchlist/symbols');
const schwabOauth = require('../lib/schwab/oauth');

let marketCache = { data: null, ts: 0, spyHistory: null };
const watchlistCache = new Map();
let feedHealth = {};
loadJournal().catch(() => {});
stockJournal.load().catch(() => {});

function nyDateString(now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

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

async function fetchYahooBars(symbol, days) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - (days * 24 * 3600);
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const data = await httpsGet(u);
  const result = data?.chart?.result?.[0] || {};
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  return timestamps.map((ts, index) => ({
    date:new Date(Number(ts) * 1000).toISOString().slice(0,10),
    close:Number(quote.close?.[index]), high:Number(quote.high?.[index]), low:Number(quote.low?.[index]),
    volume:Number(quote.volume?.[index])
  })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.close));
}

async function fetchYahooSeries(symbol, days) {
  return (await fetchYahooBars(symbol, days)).map(({date, close}) => ({date, close}));
}

async function fetchYahooHistory(symbol, days) {
  return (await fetchYahooSeries(symbol, days)).map(row => row.close);
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

function getMarketStatus() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const weekday = map.weekday;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const minuteOfDay = hour * 60 + minute;
  if (weekday === 'Sat' || weekday === 'Sun') return { open: false, label: 'WEEKEND' };
  if (isMarketHoliday(now)) return { open:false, label:'MARKET HOLIDAY' };
  if (minuteOfDay < 9 * 60 + 30) return { open: false, label: 'PRE-MARKET' };
  if (minuteOfDay >= getMarketCloseMinutes(now)) return { open: false, label: 'AFTER-HOURS' };
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
  const scheduledEvents = getMarketEventRisk();
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
      breadthMode: 'not_scored',
      pctAbove20: null,
      pctAbove50: null,
      pctAbove200: null,
      adRatio: null,
      nasdaqHL: null,
      participation: null,
      tenYrLevel: tnxLevel,
      tenYrTrend,
      dxyTrend,
      fedStance: 'not_scored',
      macroMode: 'rates-and-official-calendar',
      putCallMode: 'not_scored',
      fomc72hr: scheduledEvents.fomc72hr,
      scheduledEvents,
      marketOpen: marketStatus.open,
      marketStatus: marketStatus.label,
      sectors,
      lastUpdated: new Date().toISOString(),
      dataSource: 'Yahoo Finance (live)'
    },
    spyHistory
  };
}

async function buildWatchlistData(spyHistory, marketDecision, symbols = WATCHLIST) {
  const stocks = await Promise.all(symbols.map(async (symbol) => {
    const [bars, quote, earnings] = await Promise.all([fetchYahooBars(symbol, 400), fetchSingleQuote(symbol, 'WL_' + symbol), getEarningsRisk(symbol)]);
    const history = bars.map(row => row.close);
    if (!quote || history.length < 20) return null;
    const price = quote.price;
    const ema8 = calcEMA(history, 8), ema21 = calcEMA(history, 21), sma89 = calcSMA(history, 89), sma233 = calcSMA(history, 233), rsi = calcRSI(history, 14), atr14 = calcATR(bars, 14);
    const stockPerf20 = history.length >= 20 ? ((history[history.length - 1] - history[history.length - 20]) / history[history.length - 20]) * 100 : 0;
    const spyPerf20 = spyHistory.length >= 20 ? ((spyHistory[spyHistory.length - 1] - spyHistory[spyHistory.length - 20]) / spyHistory[spyHistory.length - 20]) * 100 : 0;
    const relStrength = Math.round((stockPerf20 - spyPerf20) * 100) / 100;
    const stockPerf60 = history.length >= 60 ? ((history.at(-1) - history.at(-60)) / history.at(-60)) * 100 : 0;
    const spyPerf60 = spyHistory.length >= 60 ? ((spyHistory.at(-1) - spyHistory.at(-60)) / spyHistory.at(-60)) * 100 : 0;
    const relStrength60 = Math.round((stockPerf60 - spyPerf60) * 100) / 100;
    const completed = bars.slice(0, -1).filter(row => Number.isFinite(row.volume) && row.volume > 0);
    const last20 = completed.slice(-20);
    const last5 = completed.slice(-5);
    const avgVolume20 = last20.length ? last20.reduce((sum,row) => sum + row.volume,0) / last20.length : null;
    const avgVolume5 = last5.length ? last5.reduce((sum,row) => sum + row.volume,0) / last5.length : null;
    const avgDollarVolume20 = avgVolume20 ? avgVolume20 * price : null;
    const volumeTrend = avgVolume20 && avgVolume5 ? avgVolume5 / avgVolume20 : null;
    const daysToEarnings = earnings.date ? Math.ceil((Date.parse(`${earnings.date}T00:00:00Z`) - Date.now()) / 86400000) : null;
    const verdictData = buildStockVerdict({ symbol, price, ema8, ema21, sma89, sma233, rsi, relStrength, relStrength60, changePct: quote.changePct, history, bars, atr14, volumeTrend, marketDecision });
    const signalInput = { ...verdictData, vs20: ema21 ? (price > ema21 ? 'above' : 'below') : 'unknown', vs50: sma89 ? (price > sma89 ? 'above' : 'below') : 'unknown', vs200: sma233 ? (price > sma233 ? 'above' : 'below') : 'unknown', rsi, relStrength, daysToEarnings };
    const signal = buildWatchlistSignal(signalInput, marketDecision);
    return { symbol, stockModelVersion:STOCK_MODEL_VERSION, price, changePct: quote.changePct, change: quote.change, quoteAsOf:quote.quoteAsOf, ema8, ema21, sma89, sma233, vs20: signalInput.vs20, vs50: signalInput.vs50, vs200: signalInput.vs200, rsi, atr14, volatilityPct:atr14 ? Math.round(atr14 / price * 1000) / 10 : null, relStrength, relStrength60, avgDollarVolume20, volumeTrend, earnings:{...earnings,daysToEarnings}, signal, ...verdictData };
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
      modelVersion: MODEL_VERSION,
      systemStatus,
      confidenceScore: confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel,
      confidenceReasons: confidence.confidenceReasons,
      dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors, proxyInputs: [], missingInputs: [] },
      market: { spy: marketData.spy, qqq: marketData.qqq, vix: marketData.vix, dxy: marketData.dxy, tnx: marketData.tnx },
      scheduledEvents: marketData.scheduledEvents
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
      dataQuality: { label: feedQuality.label, staleFeeds: feedQuality.stale, errors: feedQuality.errors, proxyInputs: [], missingInputs: [] },
      market: { spy: marketData.spy, qqq: marketData.qqq, vix: marketData.vix, dxy: marketData.dxy, tnx: marketData.tnx },
      scheduledEvents: marketData.scheduledEvents
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
      inputsSnapshot: { spy: marketData.spy.price, qqq: marketData.qqq.price, vix: marketData.vix.price, topSector: marketData.sectors[0]?.sym || null, nearestScheduledEvent: marketData.scheduledEvents?.nearest || null }
    });
  }

  marketCache = { data: payload, ts: now, spyHistory };
  return payload;
}

async function getWatchlistPayload(requestedSymbols) {
  const now = Date.now();
  const market = await getMarketPayload();
  const spyHistory = marketCache.spyHistory;
  const symbols = normalizeWatchlistSymbols(requestedSymbols, WATCHLIST);
  const cacheKey = `${market.decision || 'NO'}:${symbols.join(',')}`;
  const cached = watchlistCache.get(cacheKey);
  if (cached && now - cached.ts < WATCHLIST_CACHE_TTL) return { stocks: cached.data, symbols, stockModelVersion:STOCK_MODEL_VERSION, marketPermission: market.permissionLabel || 'LOW_PERMISSION', cached: true };
  if (!spyHistory) throw new Error('Missing SPY history for watchlist');
  const stocks = await buildWatchlistData(spyHistory, market.decision || 'NO', symbols);
  const marketStatus=getMarketStatus();
  if(marketStatus.open){
    const date=nyDateString(now);
    await stockJournal.log(stocks.map(stock=>({key:`${STOCK_MODEL_VERSION}:${date}:${stock.symbol}`,date,ts:now,symbol:stock.symbol,modelVersion:STOCK_MODEL_VERSION,verdict:stock.verdict,entryPosture:stock.signal?.label||null,setupScore:stock.setupScore,momentumScore:stock.momentumScore,marketDecision:market.decision||'NO',entryPrice:stock.price,quoteAsOf:stock.quoteAsOf,validationEligible:true})));
  }
  watchlistCache.set(cacheKey, { data: stocks, ts: now });
  if (watchlistCache.size > 24) watchlistCache.delete(watchlistCache.keys().next().value);
  return { stocks, symbols, stockModelVersion:STOCK_MODEL_VERSION, marketPermission: market.permissionLabel || 'LOW_PERMISSION', cached: false };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parsed = { pathname: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams) };
  if (parsed.pathname === '/api/market-status') {
    const marketStatus = getMarketStatus();
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store, max-age=0' });
    res.end(JSON.stringify({ status:'ok', ...marketStatus, retrievedAt:new Date().toISOString() }));
    return;
  }
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
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Schwab connection failed</title><body style="font:16px system-ui;background:#07111a;color:#d5e4f0;padding:40px;max-width:720px;margin:auto"><h1 style="color:#ffb86b">Schwab connection failed</h1><p>${String(err.message).replace(/[&<>"']/g, '')}</p><p><a style="color:#59d0ff" href="/?schwab=failed#optionsDesk">Return to the covered-call desk</a></p></body></html>`);
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

  if (parsed.pathname === '/api/options/chain' || parsed.pathname === '/api/options/mstr') {
    const symbol = parsed.pathname === '/api/options/mstr' ? 'MSTR' : String(parsed.query.symbol || '').trim().toUpperCase();
    const contractType = String(parsed.query.type || 'call').toUpperCase() === 'PUT' ? 'PUT' : 'CALL';
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify({ status: 'invalid_symbol', error: 'Enter a valid stock or ETF ticker.' }));
      return;
    }
    let schwabAuth = { session: null, setCookie: null };
    if (schwabOauth.configured()) {
      try { schwabAuth = await schwabOauth.validSession(req); } catch { schwabAuth = { session: null, setCookie: schwabOauth.clearCookies()[0] }; }
    }
    const responseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' };
    if (schwabAuth.setCookie) responseHeaders['Set-Cookie'] = schwabAuth.setCookie;
    if (!schwabAuth.session && !process.env.TRADIER_TOKEN) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify({ status: schwabOauth.configured() ? 'authorization_required' : 'manual', error: schwabOauth.configured() ? `Connect Schwab to load the ${symbol} chain.` : 'Automatic options data is not configured. Use manual broker quotes.', connectUrl: schwabOauth.configured() ? '/api/schwab/login' : null }));
      return;
    }
    if (parsed.query.probe === '1') {
      res.writeHead(200, responseHeaders);
      res.end(JSON.stringify({ status: 'ok', provider: schwabAuth.session ? 'Schwab' : 'Tradier', delayed: schwabAuth.session ? false : process.env.TRADIER_SANDBOX === 'true', configured: true, connected: Boolean(schwabAuth.session), marketDataOnly: true }));
      return;
    }
    try {
      const [data, eventRisk] = await Promise.all([
        schwabAuth.session
          ? buildSchwabChain({ accessToken: schwabAuth.session.accessToken, symbol, contractType, minDte: parsed.query.minDte, maxDte: parsed.query.maxDte, minStrike: parsed.query.minStrike, maxStrike: parsed.query.maxStrike })
          : buildOptionChain({ request: tradierGet, symbol, contractType, minDte: parsed.query.minDte, maxDte: parsed.query.maxDte, minStrike: parsed.query.minStrike, maxStrike: parsed.query.maxStrike }),
        getEarningsRisk(symbol)
      ]);
      res.writeHead(200, responseHeaders);
      res.end(JSON.stringify({ status: 'ok', provider: schwabAuth.session ? 'Schwab' : 'Tradier', delayed: schwabAuth.session ? false : process.env.TRADIER_SANDBOX === 'true', retrievedAt: new Date().toISOString(), marketStatus: getMarketStatus().label, eventRisk, ...data }));
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
      const data = await getWatchlistPayload(parsed.query.symbols);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/stock-backtest') {
    try {
      await stockJournal.load();
      await stockBacktest.backfill(fetchYahooSeries);
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store, max-age=0' });
      res.end(JSON.stringify(stockBacktest.summary()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({error:err.message}));
    }
    return;
  }

  if (parsed.pathname === '/api/journal') {
    try {
      await backfillJournalOutcomes(fetchYahooSeries);
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
      await backfillJournalOutcomes(fetchYahooSeries);
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
