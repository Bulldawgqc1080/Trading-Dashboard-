const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const CACHE_TTL = 30000;
const STALE_THRESHOLD = 5 * 60 * 1000;

let cache = { data: null, ts: 0 };
let cryptoCache = { data: null, ts: 0 };
const CRYPTO_CACHE_TTL = 60000;
let scoreHistory = [];
let feedHealth = {};
let journal = [];

// Upstash Redis REST API
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

function httpsGetWithAuth(reqUrl, token) {
  return new Promise((resolve, reject) => {
    const opts = new URL(reqUrl);
    const options = {
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: { 'Authorization': 'Bearer ' + token }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('KV timeout')); });
  });
}

async function kvGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await httpsGetWithAuth(UPSTASH_URL + '/get/' + key, UPSTASH_TOKEN);
    return res && res.result ? JSON.parse(res.result) : null;
  } catch(e) { return null; }
}

async function kvSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    await httpsGetWithAuth(UPSTASH_URL + '/set/' + key + '/' + encoded, UPSTASH_TOKEN);
  } catch(e) {}
}

async function loadJournal() {
  const stored = await kvGet('sibt:journal');
  if (stored && Array.isArray(stored)) journal = stored;
}

async function saveJournal() {
  await kvSet('sibt:journal', journal);
}

loadJournal().catch(() => {});

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
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=true&indicators=adjclose&events=div,splits`;
    const data = await httpsGet(u);
    const result = data?.chart?.result?.[0];
    if (!result) {
      feedHealth[feedKey] = { status: 'error', error: 'No result', ts: Date.now(), latency: Date.now()-start };
      return null;
    }
    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const timestamps = result.timestamp || [];
    const validCloses = closes.filter(c => c !== null && !isNaN(c));
    const price = meta.regularMarketPrice || validCloses[validCloses.length - 1] || 0;
    // Find yesterday's official close using timestamps to avoid including today's intraday
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
    const ma200raw = meta.twoHundredDayAverage || meta.regularMarketDayLow || 0;
    const ma50raw = meta.fiftyDayAverage || 0;
    feedHealth[feedKey] = { status: 'ok', ts: Date.now(), latency: Date.now()-start, price };
    // Extended hours from chart meta
    const n2 = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    const postPrice = n2(meta.postMarketPrice);
    const prePrice = n2(meta.preMarketPrice);
    const hasPost = postPrice != null;
    const hasPre = prePrice != null && !hasPost;
    const extPrice = hasPost ? postPrice : hasPre ? prePrice : null;
    const extChange = hasPost ? n2(meta.postMarketChange) : hasPre ? n2(meta.preMarketChange) : null;
    const extChangePct = hasPost ? n2(meta.postMarketChangePercent) : hasPre ? n2(meta.preMarketChangePercent) : null;
    const extType = hasPost ? 'POST' : hasPre ? 'PRE' : null;

    return {
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      prev: Math.round(prev * 100) / 100,
      ma200: Math.round(ma200raw * 100) / 100,
      ma50: Math.round(ma50raw * 100) / 100,
      closes: validCloses,
      extPrice, extChange, extChangePct, extType
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

function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Math.round(ema * 100) / 100;
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
  // Proxy only: sector participation + SPY day tone. Do not treat as true exchange breadth.
  const upSectors = sectorChanges.filter(c => c > 0).length;
  const sectorCount = sectorChanges.length || 1;
  const participation = (upSectors / sectorCount) * 100;
  const spyFactor = spyChgPct > 1 ? 12 : spyChgPct > 0.5 ? 6 : spyChgPct > 0 ? 2 : spyChgPct > -0.5 ? -4 : -10;
  const pctAboveEma21 = Math.max(20, Math.min(80, participation + spyFactor));
  const pctAboveSma89 = Math.max(15, Math.min(75, pctAboveEma21 - 6));
  const pctAboveSma233 = Math.max(10, Math.min(70, pctAboveSma89 - 6));
  const adRatioProxy = Math.round((0.8 + (upSectors / sectorCount) * 0.8) * 100) / 100;
  const highsLowsProxy = Math.round(30 + (upSectors / sectorCount) * 50);

  return {
    mode: 'proxy',
    pctAbove20: Math.round(pctAboveEma21),
    pctAbove50: Math.round(pctAboveSma89),
    pctAbove200: Math.round(pctAboveSma233),
    adRatio: adRatioProxy,
    nasdaqHL: highsLowsProxy,
    mcclellan: null,
    participation: Math.round(participation)
  };
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

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
  if (d.spyVs200 === 'above') trend += 25;
  if (d.spyVs50 === 'above') trend += 20;
  if (d.spyVs20 === 'above') trend += 15;
  if (d.qqqVs50 === 'above') trend += 15;
  if (d.regime === 'uptrend') trend += 10;
  if (d.spyEma21AboveSma89) trend += 8;
  if (d.spySma89AboveSma233) trend += 7;
  if (d.spyRSI > 30 && d.spyRSI < 70) trend = Math.min(100, trend + 8);
  if
...(truncated)...
