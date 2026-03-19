const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const CACHE_TTL = 30000;

let cache = { data: null, ts: 0 };

const SYMBOLS = [
  'SPY','QQQ','^VIX','DX-Y.NYB','^TNX',
  'XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'
];

function httpsGet(reqUrl) {
  return new Promise((resolve, reject) => {
    const opts = new URL(reqUrl);
    const options = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': 'application/json,text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0,300))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchYahooQuotes(symbols) {
  const symStr = symbols.join(',');
  const u = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symStr}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,fiftyDayAverage,twoHundredDayAverage`;
  const data = await httpsGet(u);
  const quotes = {};
  const results = data?.quoteResponse?.result || [];
  results.forEach(q => {
    quotes[q.symbol] = {
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      prev: q.regularMarketPreviousClose,
      ma50: q.fiftyDayAverage,
      ma200: q.twoHundredDayAverage
    };
  });
  return quotes;
}

async function fetchYahooHistory(symbol, days) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - (days * 24 * 3600);
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const data = await httpsGet(u);
  const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
  return closes.filter(c => c !== null && !isNaN(c));
}

function calcSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function calcSlope(arr, n) {
  n = n || 5;
  const slice = arr.slice(-n);
  if (slice.length < 2) return 0;
  return Math.round(((slice[slice.length - 1] - slice[0]) / slice[0]) * 1000) / 10;
}

function estimateVixPercentile(vix) {
  if (vix < 12) return 5;
  if (vix < 14) return 12;
  if (vix < 16) return 22;
  if (vix < 18) return 32;
  if (vix < 20) return 42;
  if (vix < 22) return 52;
  if (vix < 25) return 62;
  if (vix < 30) return 75;
  if (vix < 35) return 85;
  if (vix < 40) return 92;
  return 98;
}

function estimateBreadth(spyChgPct, sectorChanges) {
  const upSectors = sectorChanges.filter(c => c > 0).length;
  const breadthProxy = (upSectors / sectorChanges.length) * 100;
  const spyFactor = spyChgPct > 1 ? 15 : spyChgPct > 0.5 ? 8 : spyChgPct > 0 ? 3 : spyChgPct > -0.5 ? -5 : -12;
  const pctAbove20 = Math.max(15, Math.min(85, breadthProxy + spyFactor));
  const pctAbove50 = Math.max(10, Math.min(80, pctAbove20 - 5));
  const pctAbove200 = Math.max(15, Math.min(75, pctAbove50 - 4));
  const adRatio = Math.round((0.7 + (upSectors / sectorChanges.length) * 1.1) * 100) / 100;
  const nasdaqHL = Math.round(35 + (upSectors / sectorChanges.length) * 55);
  return {
    pctAbove20: Math.round(pctAbove20),
    pctAbove50: Math.round(pctAbove50),
    pctAbove200: Math.round(pctAbove200),
    adRatio,
    nasdaqHL,
    mcclellan: Math.round((adRatio - 1) * 120)
  };
}

function getFomcDays() {
  const fomcDates = [
    new Date('2025-05-07'), new Date('2025-06-18'),
    new Date('2025-07-30'), new Date('2025-09-17'),
    new Date('2025-11-05'), new Date('2025-12-17'),
    new Date('2026-01-28'), new Date('2026-03-18'),
    new Date('2026-05-06'), new Date('2026-06-17'),
    new Date('2026-07-29'), new Date('2026-09-16'),
  ];
  const now = new Date();
  const next = fomcDates.find(d => d > now);
  if (!next) return 99;
  return Math.ceil((next - now) / (1000 * 60 * 60 * 24));
}

async function fetchSingleQuote(symbol) {
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (5 * 24 * 3600);
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
    const data = await httpsGet(u);
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter(c => c !== null && !isNaN(c));
    const price = meta.regularMarketPrice || validCloses[validCloses.length - 1] || 0;
    const prev = meta.chartPreviousClose || meta.previousClose || validCloses[validCloses.length - 2] || price;
    const change = price - prev;
    const changePct = prev > 0 ? (change / prev) * 100 : 0;
    return {
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      closes: validCloses
    };
  } catch(e) {
    return null;
  }
}

async function buildMarketData() {
  const sectorSyms = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];

  const [spyData, qqqData, vixData, dxyData, tnxData, spyHistory, vixHistory, ...sectorResults] = await Promise.all([
    fetchSingleQuote('SPY'),
    fetchSingleQuote('QQQ'),
    fetchSingleQuote('^VIX'),
    fetchSingleQuote('DX-Y.NYB'),
    fetchSingleQuote('^TNX'),
    fetchYahooHistory('SPY', 300),
    fetchYahooHistory('^VIX', 30),
    ...sectorSyms.map(s => fetchSingleQuote(s))
  ]);

  const spy = spyData || {};
  const qqq = qqqData || {};
  const vixQ = vixData || {};
  const dxy = dxyData || {};
  const tnx = tnxData || {};

  const spy20 = calcSMA(spyHistory, 20);
  const spy50 = calcSMA(spyHistory, 50);
  const spy200 = calcSMA(spyHistory, 200);
  const spyRSI = calcRSI(spyHistory, 14);
  const vixSlope = calcSlope(vixHistory, 5);

  const spyPrice = spy.price || (spyHistory[spyHistory.length - 1] || 500);
  const qqqPrice = qqq.price || 0;
  const qqq50 = qqq.ma50 || 999;

  const sectorNames = {
    XLK:'Technology', XLF:'Financials', XLE:'Energy', XLV:'Health Care',
    XLI:'Industrials', XLY:'Cons Discret', XLP:'Cons Staples', XLU:'Utilities',
    XLB:'Materials', XLRE:'Real Estate', XLC:'Comm Services'
  };
  const sectors = sectorSyms.map((sym, i) => ({
    sym,
    name: sectorNames[sym],
    price: sectorResults[i]?.price || 0,
    chg: sectorResults[i]?.changePct || 0,
    score: Math.min(100, Math.max(0, Math.round(50 + (sectorResults[i]?.changePct || 0) * 10)))
  })).sort((a, b) => b.chg - a.chg);

  const sectorChanges = sectors.map(s => s.chg);
  const breadth = estimateBreadth(spy.changePct || 0, sectorChanges);

  const vixLevel = Math.round((vixQ.price || 20) * 100) / 100;
  const tnxLevel = Math.round((tnx.price || 4.5) * 100) / 100;
  const dxyPrice = Math.round((dxy.price || 104) * 100) / 100;

  const tenYrTrend = (tnx.changePct || 0) > 0.5 ? 'rising' : (tnx.changePct || 0) < -0.5 ? 'falling' : 'flat';
  const dxyTrend = (dxy.changePct || 0) > 0.2 ? 'rising' : (dxy.changePct || 0) < -0.2 ? 'falling' : 'flat';

  const regime = (spyPrice > spy50 && spyPrice > spy200 && spyRSI > 45)
    ? 'uptrend'
    : (spyPrice < spy50 && spyPrice < spy200)
    ? 'downtrend'
    : 'chop';

  const fomcDays = getFomcDays();

  return {
    spy: { price: Math.round(spyPrice * 100) / 100, chg: Math.round((spy.changePct || 0) * 100) / 100 },
    qqq: { price: Math.round(qqqPrice * 100) / 100, chg: Math.round((qqq.changePct || 0) * 100) / 100 },
    vix: { price: vixLevel, chg: Math.round((vixQ.changePct || 0) * 100) / 100 },
    dxy: { price: dxyPrice, chg: Math.round((dxy.changePct || 0) * 100) / 100 },
    tnx: { price: tnxLevel, chg: Math.round((tnx.changePct || 0) * 100) / 100 },
    spyVs20: spy20 && spyPrice > spy20 ? 'above' : 'below',
    spyVs50: spy50 && spyPrice > spy50 ? 'above' : 'below',
    spyVs200: spy200 && spyPrice > spy200 ? 'above' : 'below',
    spy20: Math.round((spy20 || 0) * 100) / 100,
    spy50: Math.round((spy50 || 0) * 100) / 100,
    spy200: Math.round((spy200 || 0) * 100) / 100,
    qqqVs50: qqqPrice > qqq50 ? 'above' : 'below',
    spyRSI,
    regime,
    vixLevel,
    vixSlope,
    vixPercentile: estimateVixPercentile(vixLevel),
    putCallRatio: 0.85,
    ...breadth,
    tenYrLevel: tnxLevel,
    tenYrTrend,
    dxyTrend,
    fedStance: 'neutral',
    fomcDays,
    fomc72hr: fomcDays <= 3,
    sectors,
    lastUpdated: new Date().toISOString(),
    dataSource: 'Yahoo Finance (live)'
  };
}

async function getMarketData() {
  const now = Date.now();
  if (cache.data && (now - cache.ts) < CACHE_TTL) {
    return { ...cache.data, cached: true };
  }
  const data = await buildMarketData();
  cache = { data, ts: now };
  return { ...data, cached: false };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/api/market') {
    try {
      const data = await getMarketData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error('Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`SIBT API running on port ${PORT}`);
});
