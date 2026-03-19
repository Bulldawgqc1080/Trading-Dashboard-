const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const CACHE_TTL = 30000;
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const JOURNAL_FILE = path.join('/tmp', 'sibt_journal.json');

let cache = { data: null, ts: 0 };
let scoreHistory = [];
let feedHealth = {};
let journal = [];

// Load journal from disk if exists
try {
  if (fs.existsSync(JOURNAL_FILE)) {
    journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
  }
} catch(e) { journal = []; }

function saveJournal() {
  try { fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal)); } catch(e) {}
}

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
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
    const data = await httpsGet(u);
    const result = data?.chart?.result?.[0];
    if (!result) {
      feedHealth[feedKey] = { status: 'error', error: 'No result', ts: Date.now(), latency: Date.now()-start };
      return null;
    }
    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter(c => c !== null && !isNaN(c));
    const price = meta.regularMarketPrice || validCloses[validCloses.length - 1] || 0;
    const prev = meta.chartPreviousClose || meta.previousClose || validCloses[validCloses.length - 2] || price;
    const change = price - prev;
    const changePct = prev > 0 ? (change / prev) * 100 : 0;
    feedHealth[feedKey] = { status: 'ok', ts: Date.now(), latency: Date.now()-start, price };
    return {
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      prev: Math.round(prev * 100) / 100,
      closes: validCloses
    };
  } catch(e) {
    feedHealth[feedKey] = { status: 'error', error: e.message, ts: Date.now(), latency: Date.now()-start };
    return null;
  }
}

function calcSMA(data, period) {
  if (!data || data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period) {
  period = period || 14;
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

function calcSlope(arr, n) {
  n = n || 5;
  const slice = arr.slice(-n);
  if (slice.length < 2) return 0;
  return Math.round(((slice[slice.length - 1] - slice[0]) / slice[0]) * 1000) / 10;
}

function calcTrend(closes, shortN, longN) {
  if (!closes || closes.length < longN) return 'flat';
  const shortAvg = closes.slice(-shortN).reduce((a,b) => a+b, 0) / shortN;
  const longAvg = closes.slice(-longN).reduce((a,b) => a+b, 0) / longN;
  const pctDiff = ((shortAvg - longAvg) / longAvg) * 100;
  if (pctDiff > 0.3) return 'rising';
  if (pctDiff < -0.3) return 'falling';
  return 'flat';
}

function estimateVixPercentile(vix) {
  if (vix < 12) return 5; if (vix < 14) return 12; if (vix < 16) return 22;
  if (vix < 18) return 32; if (vix < 20) return 42; if (vix < 22) return 52;
  if (vix < 25) return 62; if (vix < 30) return 75; if (vix < 35) return 85;
  if (vix < 40) return 92; return 98;
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
  return { pctAbove20: Math.round(pctAbove20), pctAbove50: Math.round(pctAbove50),
    pctAbove200: Math.round(pctAbove200), adRatio, nasdaqHL,
    mcclellan: Math.round((adRatio - 1) * 120) };
}

function getFomcDays() {
  const fomcDates = [
    new Date('2026-03-19'), new Date('2026-05-06'), new Date('2026-06-17'),
    new Date('2026-07-29'), new Date('2026-09-16'), new Date('2026-11-04'), new Date('2026-12-16'),
  ];
  const now = new Date();
  const next = fomcDates.find(d => d > now);
  if (!next) return 99;
  return Math.ceil((next - now) / (1000 * 60 * 60 * 24));
}

function getMarketStatus() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const month = now.getUTCMonth() + 1;
  const isDST = month >= 3 && month <= 11;
  const et = new Date(utc + 3600000 * (isDST ? -4 : -5));
  const day = et.getDay();
  const timeNum = et.getHours() * 100 + et.getMinutes();
  if (day === 0 || day === 6) return { open: false, label: 'WEEKEND' };
  if (timeNum < 930) return { open: false, label: 'PRE-MARKET' };
  if (timeNum >= 1600) return { open: false, label: 'AFTER-HOURS' };
  return { open: true, label: 'MARKET OPEN' };
}

function getFeedQuality() {
  const now = Date.now();
  const criticalFeeds = ['SPY', 'QQQ', 'VIX'];
  const errors = Object.entries(feedHealth).filter(([k,v]) => v.status === 'error');
  const stale = Object.entries(feedHealth).filter(([k,v]) => v.status === 'ok' && (now - v.ts) > STALE_THRESHOLD);
  const criticalDown = criticalFeeds.filter(f => feedHealth[f] && feedHealth[f].status === 'error');
  if (criticalDown.length > 0) return { quality: 'bad', label: 'DATA QUALITY: BAD', errors: errors.map(([k])=>k), stale: stale.map(([k])=>k) };
  if (errors.length > 2 || stale.length > 3) return { quality: 'degraded', label: 'DATA QUALITY: DEGRADED', errors: errors.map(([k])=>k), stale: stale.map(([k])=>k) };
  if (stale.length > 0) return { quality: 'stale', label: 'SOME FEEDS STALE', errors: [], stale: stale.map(([k])=>k) };
  return { quality: 'good', label: 'ALL FEEDS OK', errors: [], stale: [] };
}

function calcScoresServer(d) {
  const vixRaw = d.vixLevel < 15 ? 90 : d.vixLevel < 18 ? 80 : d.vixLevel < 20 ? 72 :
    d.vixLevel < 23 ? 58 : d.vixLevel < 27 ? 42 : d.vixLevel < 32 ? 28 : 12;
  let vix = vixRaw;
  if (d.vixSlope < -0.5) vix = Math.min(100, vix + 8);
  if (d.vixSlope > 0.5) vix = Math.max(0, vix - 8);
  if (d.vixPercentile < 30) vix = Math.min(100, vix + 5);
  if (d.vixPercentile > 70) vix = Math.max(0, vix - 10);

  let trend = 0;
  if (d.spyVs200 === 'above') trend += 30;
  if (d.spyVs50 === 'above') trend += 25;
  if (d.spyVs20 === 'above') trend += 20;
  if (d.qqqVs50 === 'above') trend += 15;
  if (d.regime === 'uptrend') trend += 10;
  if (d.spyRSI > 30 && d.spyRSI < 70) trend = Math.min(100, trend + 8);
  if (d.spyRSI >= 75) trend = Math.max(0, trend - 12);
  if (d.spyRSI <= 25) trend = Math.max(0, trend - 18);

  let breadth = 0;
  breadth += Math.min(35, d.pctAbove50 * 0.6);
  breadth += Math.min(25, d.pctAbove200 * 0.45);
  breadth += d.adRatio > 1.3 ? 20 : d.adRatio > 1.0 ? 10 : -10;
  if (d.nasdaqHL > 70) breadth += 10;
  if (d.mcclellan > 20) breadth += 10;
  else if (d.mcclellan < -20) breadth -= 10;
  breadth = Math.max(0, Math.min(100, breadth));

  const upS = d.sectors.filter(s => s.chg > 0).length;
  const top3 = (d.sectors[0].chg + d.sectors[1].chg + d.sectors[2].chg) / 3;
  const btm3 = (d.sectors[8].chg + d.sectors[9].chg + d.sectors[10].chg) / 3;
  const spread = top3 - btm3;
  let momentum = Math.min(50, upS * 5) + Math.min(35, spread * 8);
  if (d.sectors[0].sym === 'XLK' || d.sectors[1].sym === 'XLK') momentum += 10;
  if (d.sectors[0].sym === 'XLU' || d.sectors[0].sym === 'XLP') momentum -= 12;
  momentum = Math.max(0, Math.min(100, momentum));

  let macro = d.tenYrLevel < 4.0 ? 35 : d.tenYrLevel < 4.3 ? 25 : d.tenYrLevel < 4.7 ? 15 : d.tenYrLevel < 5.2 ? 5 : -10;
  macro += d.tenYrTrend === 'falling' ? 18 : d.tenYrTrend === 'rising' ? -12 : 0;
  macro += d.dxyTrend === 'falling' ? 15 : d.dxyTrend === 'rising' ? -5 : 0;
  macro += d.fedStance === 'dovish' ? 20 : d.fedStance === 'neutral' ? 5 : -18;
  if (d.fomc72hr) macro -= 18;
  macro = Math.max(0, Math.min(100, macro));

  const total = Math.round(vix*0.25 + momentum*0.25 + trend*0.20 + breadth*0.20 + macro*0.10);

  // Top 3 reasons
  const factors = [
    { name: 'Elevated VIX', impact: -1, active: d.vixLevel > 25 },
    { name: 'VIX falling', impact: 1, active: d.vixSlope < -0.5 },
    { name: 'VIX rising', impact: -1, active: d.vixSlope > 0.5 },
    { name: 'SPY above 200d MA', impact: 1, active: d.spyVs200 === 'above' },
    { name: 'SPY below 200d MA', impact: -1, active: d.spyVs200 === 'below' },
    { name: 'SPY above 50d MA', impact: 1, active: d.spyVs50 === 'above' },
    { name: 'SPY below 50d MA', impact: -1, active: d.spyVs50 === 'below' },
    { name: 'Confirmed uptrend', impact: 1, active: d.regime === 'uptrend' },
    { name: 'Downtrend confirmed', impact: -1, active: d.regime === 'downtrend' },
    { name: 'Oversold RSI', impact: -1, active: d.spyRSI < 30 },
    { name: 'Overbought RSI', impact: -1, active: d.spyRSI > 75 },
    { name: 'Healthy breadth', impact: 1, active: d.pctAbove50 > 60 },
    { name: 'Weak breadth', impact: -1, active: d.pctAbove50 < 40 },
    { name: 'A/D line positive', impact: 1, active: d.adRatio > 1.3 },
    { name: 'A/D line negative', impact: -1, active: d.adRatio < 0.9 },
    { name: 'Strong sector spread', impact: 1, active: spread > 1.5 },
    { name: 'Narrow sector spread', impact: -1, active: spread < 0.5 },
    { name: 'Tech leading', impact: 1, active: d.sectors[0].sym === 'XLK' || d.sectors[1].sym === 'XLK' },
    { name: 'Defensives leading', impact: -1, active: d.sectors[0].sym === 'XLU' || d.sectors[0].sym === 'XLP' },
    { name: 'Rates supportive', impact: 1, active: d.tenYrLevel < 4.2 },
    { name: 'Rates headwind', impact: -1, active: d.tenYrLevel > 4.7 },
    { name: 'Yields falling', impact: 1, active: d.tenYrTrend === 'falling' },
    { name: 'Yields rising', impact: -1, active: d.tenYrTrend === 'rising' },
    { name: 'Dollar falling', impact: 1, active: d.dxyTrend === 'falling' },
    { name: 'FOMC imminent', impact: -1, active: d.fomc72hr },
    { name: 'Most sectors green', impact: 1, active: upS >= 8 },
    { name: 'Most sectors red', impact: -1, active: upS <= 3 },
  ].filter(f => f.active);

  const negFactors = factors.filter(f => f.impact < 0).slice(0, 3).map(f => f.name);
  const posFactors = factors.filter(f => f.impact > 0).slice(0, 3).map(f => f.name);
  const topReasons = total >= 60
    ? posFactors.slice(0, 3)
    : negFactors.slice(0, 3);

  return { vix: Math.round(vix), trend: Math.round(trend), breadth: Math.round(breadth),
    momentum: Math.round(momentum), macro: Math.round(macro), total, topReasons };
}

function logJournalEntry(spyPrice, score, decision) {
  const today = new Date().toISOString().split('T')[0];
  const exists = journal.find(j => j.date === today);
  if (!exists) {
    journal.push({ date: today, score, decision, spyEntry: spyPrice, spyExit: null, outcome: null, ts: Date.now() });
    if (journal.length > 90) journal = journal.slice(-90);
    saveJournal();
  }
}

function addToScoreHistory(score, decision) {
  const today = new Date().toISOString().split('T')[0];
  if (!scoreHistory.find(h => h.date === today)) {
    scoreHistory.push({ date: today, score, decision });
    if (scoreHistory.length > 30) scoreHistory = scoreHistory.slice(-30);
  }
}

async function buildMarketData() {
  const sectorSyms = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];

  const [spyData, qqqData, vixData, dxyData, tnxData, spyHistory, vixHistory, tnxHistory, dxyHistory, ...sectorResults] = await Promise.all([
    fetchSingleQuote('SPY', 'SPY'),
    fetchSingleQuote('QQQ', 'QQQ'),
    fetchSingleQuote('^VIX', 'VIX'),
    fetchSingleQuote('DX-Y.NYB', 'DXY'),
    fetchSingleQuote('^TNX', 'TNX'),
    fetchYahooHistory('SPY', 300),
    fetchYahooHistory('^VIX', 30),
    fetchYahooHistory('^TNX', 20),
    fetchYahooHistory('DX-Y.NYB', 20),
    ...sectorSyms.map(s => fetchSingleQuote(s, s))
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
  const vixLevel = Math.round((vixQ.price || 20) * 100) / 100;
  const tnxLevel = Math.round((tnx.price || 4.5) * 100) / 100;
  const dxyPrice = Math.round((dxy.price || 104) * 100) / 100;
  const spyPrice = spy.price || (spyHistory[spyHistory.length - 1] || 500);
  const qqqPrice = qqq.price || 0;

  const sectorNames = { XLK:'Technology', XLF:'Financials', XLE:'Energy', XLV:'Health Care',
    XLI:'Industrials', XLY:'Cons Discret', XLP:'Cons Staples', XLU:'Utilities',
    XLB:'Materials', XLRE:'Real Estate', XLC:'Comm Services' };

  const sectors = sectorSyms.map((sym, i) => ({
    sym, name: sectorNames[sym],
    price: sectorResults[i]?.price || 0,
    chg: sectorResults[i]?.changePct || 0,
    score: Math.min(100, Math.max(0, Math.round(50 + (sectorResults[i]?.changePct || 0) * 10)))
  })).sort((a, b) => b.chg - a.chg);

  const sectorChanges = sectors.map(s => s.chg);
  const breadth = estimateBreadth(spy.changePct || 0, sectorChanges);
  const tenYrTrend = calcTrend(tnxHistory, 3, 10);
  const dxyTrend = calcTrend(dxyHistory, 3, 10);
  const regime = (spyPrice > spy50 && spyPrice > spy200 && spyRSI > 45) ? 'uptrend'
    : (spyPrice < spy50 && spyPrice < spy200) ? 'downtrend' : 'chop';
  const fomcDays = getFomcDays();
  const marketStatus = getMarketStatus();
  const feedQuality = getFeedQuality();

  const marketData = {
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
    qqqVs50: qqqPrice > (spy50 || 999) ? 'above' : 'below',
    spyRSI, regime, vixLevel, vixSlope,
    vixPercentile: estimateVixPercentile(vixLevel),
    putCallRatio: 0.85,
    ...breadth,
    tenYrLevel: tnxLevel, tenYrTrend, dxyTrend,
    fedStance: 'neutral', fomcDays, fomc72hr: fomcDays <= 3,
    marketOpen: marketStatus.open, marketStatus: marketStatus.label,
    feedHealth, feedQuality, sectors, scoreHistory,
    lastUpdated: new Date().toISOString(),
    dataSource: 'Yahoo Finance (live)'
  };

  // Calculate scores server-side for journal
  const scores = calcScoresServer(marketData);
  marketData.serverScores = scores;
  marketData.topReasons = scores.topReasons;

  const decision = scores.total >= 80 ? 'YES' : scores.total >= 60 ? 'CAUTION' : 'NO';
  addToScoreHistory(scores.total, decision);
  logJournalEntry(Math.round(spyPrice * 100) / 100, scores.total, decision);

  return marketData;
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

  if (parsed.pathname === '/api/journal') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ journal, count: journal.length }));
    return;
  }

  if (parsed.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), feedHealth }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`SIBT API running on port ${PORT}`));
