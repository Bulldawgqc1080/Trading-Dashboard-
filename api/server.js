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
  if (d.spyVs200 === 'above') trend += 25;  // above SMA 233
  if (d.spyVs50 === 'above') trend += 20;   // above SMA 89
  if (d.spyVs20 === 'above') trend += 15;   // above EMA 21
  if (d.qqqVs50 === 'above') trend += 15;   // QQQ above SMA 89
  if (d.regime === 'uptrend') trend += 10;
  // Bonus: orderly MA stack (EMA21 > SMA89 > SMA233)
  if (d.spyEma21AboveSma89) trend += 8;
  if (d.spySma89AboveSma233) trend += 7;
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

async function logJournalEntry(spyPrice, score, decision) {
  const today = new Date().toISOString().split('T')[0];
  const exists = journal.find(j => j.date === today);
  if (!exists) {
    // Try to load latest from KV first in case another instance wrote
    const stored = await kvGet('sibt:journal');
    if (stored && Array.isArray(stored)) journal = stored;
    if (!journal.find(j => j.date === today)) {
      journal.push({ date: today, score, decision, spyEntry: spyPrice, spyExit: null, outcome: null, ts: Date.now() });
      if (journal.length > 90) journal = journal.slice(-90);
      await saveJournal();
    }
  }
}

function addToScoreHistory(score, decision) {
  const today = new Date().toISOString().split('T')[0];
  if (!scoreHistory.find(h => h.date === today)) {
    scoreHistory.push({ date: today, score, decision });
    if (scoreHistory.length > 30) scoreHistory = scoreHistory.slice(-30);
  }
}

async function fetchV7Quotes(symbols) {
  try {
    const symStr = symbols.join(',');
    const u = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symStr}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,preMarketPrice,preMarketChange,preMarketChangePercent,postMarketPrice,postMarketChange,postMarketChangePercent,marketState`;
    const data = await httpsGet(u);
    const results = data?.quoteResponse?.result || [];
    const map = {};
    results.forEach(q => {
      // Calculate pct from price and prev close for maximum accuracy
      const n = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
      const state = q.marketState || 'REGULAR';
      const isPre = state === 'PRE' || state === 'PREPRE' || (state === 'REGULAR' && Number.isFinite(q.preMarketPrice) && !Number.isFinite(q.postMarketPrice));
      const isPost = state === 'POST' || state === 'POSTPOST' || (state === 'REGULAR' && Number.isFinite(q.postMarketPrice));
      map[q.symbol] = {
        price: n(q.regularMarketPrice),
        changePct: n(q.regularMarketChangePercent),
        change: n(q.regularMarketChange),
        prev: n(q.regularMarketPreviousClose),
        marketState: state,
        extPrice: isPre ? n(q.preMarketPrice) : isPost ? n(q.postMarketPrice) : null,
        extChange: isPre ? n(q.preMarketChange) : isPost ? n(q.postMarketChange) : null,
        extChangePct: isPre ? n(q.preMarketChangePercent) : isPost ? n(q.postMarketChangePercent) : null,
        extType: isPre ? 'PRE' : isPost ? 'POST' : null
      };
    });
    return map;
  } catch(e) { return {}; }
}

async function fetchFearAndGreed() {
  try {
    const data = await httpsGet('https://api.alternative.me/fng/?limit=1');
    const item = data?.data?.[0];
    if (!item) return null;
    return {
      value: parseInt(item.value, 10),
      label: item.value_classification,
      ts: item.timestamp
    };
  } catch(e) { return null; }
}

async function fetchCryptoData() {
  const now = Date.now();
  if (cryptoCache.data && now - cryptoCache.ts < CRYPTO_CACHE_TTL) {
    return { ...cryptoCache.data, cached: true };
  }

  const COINS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

  try {
    const [v7Data, fng] = await Promise.all([
      fetchV7Quotes([...COINS, 'SPY']),
      fetchFearAndGreed()
    ]);

    // Build coin cards — fallback to fetchSingleQuote if v7 price is null
    const coins = await Promise.all(COINS.map(async sym => {
      const q = v7Data[sym] || {};
      let price = q.price;
      let changePct = q.changePct;
      let change = q.change;
      let prev = q.prev;

      // Fallback: fetch via chart API if v7 didn't return price
      if (price == null) {
        try {
          const fallback = await fetchSingleQuote(sym, 'CRYPTO_' + sym.replace('-USD',''));
          if (fallback && fallback.price) {
            price = fallback.price;
            changePct = fallback.changePct;
            change = fallback.change;
            prev = fallback.prev;
          }
        } catch(e) {}
      }

      return {
        symbol: sym.replace('-USD', ''),
        price,
        changePct,
        change,
        prev,
        marketState: q.marketState
      };
    }));

    // BTC dominance from CoinGecko
    let btcDominance = null;
    try {
      const gcData = await httpsGet('https://api.coingecko.com/api/v3/global');
      btcDominance = gcData?.data?.market_cap_percentage?.btc
        ? Math.round(gcData.data.market_cap_percentage.btc * 10) / 10
        : null;
    } catch(e) {}

    // SPY 20d correlation with BTC (simplified: compare direction of last 20d)
    // Use changePct as a proxy since we don't store BTC history
    const spyQ = v7Data['SPY'] || {};
    const btcQ = v7Data['BTC-USD'] || {};
    let correlation = null;
    if (spyQ.changePct != null && btcQ.changePct != null) {
      // Simple same-direction correlation for today
      const sameDir = (spyQ.changePct >= 0) === (btcQ.changePct >= 0);
      correlation = sameDir ? 'POSITIVE' : 'NEGATIVE';
    }

    const result = {
      coins,
      fearGreed: fng,
      btcDominance,
      spyCorrelation1d: correlation,
      spyChg: spyQ.changePct,
      lastUpdated: new Date().toISOString(),
      cached: false
    };

    cryptoCache = { data: result, ts: now };
    return result;
  } catch(e) {
    return cryptoCache.data ? { ...cryptoCache.data, cached: true } : null;
  }
}

async function buildMarketData() {
  const sectorSyms = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];

  const [spyData, qqqData, vixData, dxyData, tnxData, spyHistory, vixHistory, tnxHistory, dxyHistory, v7Quotes, ...sectorResults] = await Promise.all([
    fetchSingleQuote('SPY', 'SPY'),
    fetchSingleQuote('QQQ', 'QQQ'),
    fetchSingleQuote('^VIX', 'VIX'),
    fetchSingleQuote('DX-Y.NYB', 'DXY'),
    fetchSingleQuote('^TNX', 'TNX'),
    fetchYahooHistory('SPY', 300),
    fetchYahooHistory('^VIX', 30),
    fetchYahooHistory('^TNX', 20),
    fetchYahooHistory('DX-Y.NYB', 20),
    fetchV7Quotes(['SPY','QQQ','^VIX','DX-Y.NYB','^TNX','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC']),
    ...sectorSyms.map(s => fetchSingleQuote(s, s))
  ]);

  const spy = spyData || {};
  const qqq = qqqData || {};
  const vixQ = vixData || {};
  const dxy = dxyData || {};
  const tnx = tnxData || {};

  // SPY trend structure — Fibonacci MA stack (permission model, not entry scoring)
  const spyEma21 = calcEMA(spyHistory, 21);
  const spySma89 = calcSMA(spyHistory, 89);
  const spySma233 = calcSMA(spyHistory, 233);
  // Keep legacy aliases for compatibility with return payload
  const spy20 = spyEma21;
  const spy50 = spySma89;
  const spy200 = spySma233;
  const spyRSI = calcRSI(spyHistory, 14);
  // SPY MA alignment flags (for trend scoring)
  const spyEma21AboveSma89 = spyEma21 && spySma89 && spyEma21 > spySma89;
  const spySma89AboveSma233 = spySma89 && spySma233 && spySma89 > spySma233;
  const vixSlope = calcSlope(vixHistory, 5);
  // vixLevel, tnxLevel, dxyPrice now set from v7 above
  // v7 as single source of truth — anchor % to prev+change from same quote packet
  const spyV7 = v7Quotes['SPY'] || {};
  const spyPrice = spyV7.price ?? spy.price ?? (spyHistory[spyHistory.length - 1] || 500);
  // AH/PRE fallback: use chart meta ext fields if v7 didn't return them
  const spyExtPrice = spyV7.extPrice ?? (spy && Number.isFinite(spy.extPrice) ? spy.extPrice : null);
  const spyExtChange = spyV7.extChange ?? (spy && Number.isFinite(spy.extChange) ? spy.extChange : null);
  const spyExtChangePct = spyV7.extChangePct ?? (spy && Number.isFinite(spy.extChangePct) ? spy.extChangePct : null);
  const spyExtType = spyV7.extType ?? spy.extType ?? null;
  // Use history array for prev close — avoids Yahoo's weekend/boundary stale prev bug
  const histPrev = spyHistory.length >= 2 ? spyHistory[spyHistory.length - 2] : 0;
  const spyPrev = (histPrev > 0 && Math.abs(spyPrice - histPrev) / histPrev < 0.10) ? histPrev : (spyV7.prev ?? spy.prev ?? 0);
  const spyChg = spyV7.change ?? (spyPrev > 0 ? spyPrice - spyPrev : 0);
  // Compute pct from history-derived prev for accuracy, fall back to v7
  const spyChgPct = spyPrev > 0 ? ((spyPrice - spyPrev) / spyPrev) * 100 : (spyV7.changePct ?? 0);

  const qqqV7 = v7Quotes['QQQ'] || {};
  const qqqPrice = qqqV7.price ?? qqq.price ?? 0;
  const qqqExtPrice = qqqV7.extPrice ?? (qqq && Number.isFinite(qqq.extPrice) ? qqq.extPrice : null);
  const qqqExtChange = qqqV7.extChange ?? (qqq && Number.isFinite(qqq.extChange) ? qqq.extChange : null);
  const qqqExtChangePct = qqqV7.extChangePct ?? (qqq && Number.isFinite(qqq.extChangePct) ? qqq.extChangePct : null);
  const qqqExtType = qqqV7.extType ?? qqq.extType ?? null;
  // Use QQQ history for prev close too
  const qqqHistory = await fetchYahooHistory('QQQ', 100);
  const qqqSma89 = calcSMA(qqqHistory, 89);
  const qqqHistPrev = qqqHistory.length >= 2 ? qqqHistory[qqqHistory.length - 2] : 0;
  const qqqPrev = (qqqHistPrev > 0 && Math.abs(qqqPrice - qqqHistPrev) / qqqHistPrev < 0.10) ? qqqHistPrev : (qqqV7.prev ?? qqq.prev ?? 0);
  const qqqChg = qqqPrice - qqqPrev;
  const qqqChgPct = qqqPrev > 0 ? ((qqqPrice - qqqPrev) / qqqPrev) * 100 : (qqqV7.changePct ?? 0);

  const vixV7 = v7Quotes['^VIX'] || {};
  const vixLevel = vixV7.price ?? Math.round((vixQ.price || 20) * 100) / 100;
  const vixPrev = vixV7.prev ?? vixQ.prev ?? 0;
  const vixChg = vixV7.change ?? (vixPrev > 0 ? vixLevel - vixPrev : 0);
  const vixChgPct = vixV7.changePct != null ? vixV7.changePct : (vixPrev > 0 ? (vixChg / vixPrev) * 100 : 0);

  const dxyV7 = v7Quotes['DX-Y.NYB'] || {};
  const dxyPrice = dxyV7.price ?? Math.round((dxy.price || 104) * 100) / 100;
  const dxyPrev = dxyV7.prev ?? dxy.prev ?? 0;
  const dxyChg = dxyV7.change ?? (dxyPrev > 0 ? dxyPrice - dxyPrev : 0);
  const dxyChgPct = dxyV7.changePct != null ? dxyV7.changePct : (dxyPrev > 0 ? (dxyChg / dxyPrev) * 100 : 0);

  const tnxV7 = v7Quotes['^TNX'] || {};
  const tnxLevel = tnxV7.price ?? Math.round((tnx.price || 4.5) * 100) / 100;
  const tnxPrev = tnxV7.prev ?? tnx.prev ?? 0;
  const tnxChg = tnxV7.change ?? (tnxPrev > 0 ? tnxLevel - tnxPrev : 0);
  const tnxChgPct = tnxV7.changePct != null ? tnxV7.changePct : (tnxPrev > 0 ? (tnxChg / tnxPrev) * 100 : 0);


  const sectorNames = { XLK:'Technology', XLF:'Financials', XLE:'Energy', XLV:'Health Care',
    XLI:'Industrials', XLY:'Cons Discret', XLP:'Cons Staples', XLU:'Utilities',
    XLB:'Materials', XLRE:'Real Estate', XLC:'Comm Services' };

  const sectors = sectorSyms.map((sym, i) => ({
    sym, name: sectorNames[sym],
    price: v7Quotes[sym]?.price ?? sectorResults[i]?.price ?? 0,
    chg: Math.round((v7Quotes[sym]?.changePct ?? sectorResults[i]?.changePct ?? 0) * 100) / 100,
    score: Math.min(100, Math.max(0, Math.round(50 + (v7Quotes[sym]?.changePct ?? sectorResults[i]?.changePct ?? 0) * 10)))
  })).sort((a, b) => b.chg - a.chg);

  const sectorChanges = sectors.map(s => s.chg);
  const breadth = estimateBreadth(spyChgPct, sectorChanges);
  const tenYrTrend = calcTrend(tnxHistory, 3, 10);
  const dxyTrend = calcTrend(dxyHistory, 3, 10);
  const regime = (spyPrice > spySma89 && spyPrice > spySma233 && spyRSI > 45) ? 'uptrend'
    : (spyPrice < spySma89 && spyPrice < spySma233) ? 'downtrend' : 'chop';
  const fomcDays = getFomcDays();
  const marketStatus = getMarketStatus();
  const feedQuality = getFeedQuality();

  const marketData = {
    spy: { price: Math.round(spyPrice * 100) / 100, chg: Math.round(spyChgPct * 100) / 100, dollar: Math.round(spyChg * 100) / 100, prev: Math.round(spyPrev * 100) / 100, extPrice: spyExtPrice, extChange: spyExtChange, extChangePct: spyExtChangePct, extType: spyExtType },
    qqq: { price: Math.round(qqqPrice * 100) / 100, chg: Math.round(qqqChgPct * 100) / 100, dollar: Math.round(qqqChg * 100) / 100, prev: Math.round(qqqPrev * 100) / 100, extPrice: qqqExtPrice, extChange: qqqExtChange, extChangePct: qqqExtChangePct, extType: qqqExtType },
    vix: { price: vixLevel, chg: Math.round(vixChgPct * 100) / 100 },
    dxy: { price: dxyPrice, chg: Math.round(dxyChgPct * 100) / 100 },
    tnx: { price: tnxLevel, chg: Math.round(tnxChgPct * 100) / 100 },
    spyVs20: spyEma21 && spyPrice > spyEma21 ? 'above' : 'below',
    spyVs50: spySma89 && spyPrice > spySma89 ? 'above' : 'below',
    spyVs200: spySma233 && spyPrice > spySma233 ? 'above' : 'below',
    spy20: spyEma21 ? Math.round(spyEma21 * 100) / 100 : null,
    spy50: spySma89 ? Math.round(spySma89 * 100) / 100 : null,
    spy200: spySma233 ? Math.round(spySma233 * 100) / 100 : null,
    spyEma21AboveSma89: !!spyEma21AboveSma89,
    spySma89AboveSma233: !!spySma89AboveSma233,
    qqqVs50: qqqSma89 ? (qqqPrice > qqqSma89 ? 'above' : 'below') : 'unknown',
    spyRSI, regime, vixLevel, vixSlope,
    vixPercentile: estimateVixPercentile(vixLevel),
    putCallRatio: 0.85,
    ...breadth,
    tenYrLevel: tnxLevel, tenYrTrend, dxyTrend,
    fedStance: 'neutral', fomcDays, fomc72hr: fomcDays <= 3,
    marketOpen: marketStatus.open, marketStatus: marketStatus.label,
    feedHealth, feedQuality, sectors, scoreHistory,
    marketState: v7Quotes['SPY']?.marketState || 'REGULAR',
    lastUpdated: new Date().toISOString(),
    dataSource: 'Yahoo Finance (live)'
  };

  // Calculate scores server-side for journal
  const scores = calcScoresServer(marketData);
  marketData.serverScores = scores;
  marketData.topReasons = scores.topReasons;

  const decision = scores.total >= 80 ? 'YES' : scores.total >= 60 ? 'CAUTION' : 'NO';
  addToScoreHistory(scores.total, decision);
  await logJournalEntry(Math.round(spyPrice * 100) / 100, scores.total, decision);

  // Pre-build watchlist data using already-fetched SPY history
  try {
    const wlData = await buildWatchlistData(spyHistory);
    watchlistCache = { data: wlData, ts: Date.now() };
    marketData.watchlist = wlData;
  } catch(e) {}

  return marketData;
}


const WATCHLIST = ['TSLA', 'NVDA', 'PYPL', 'MSTR', 'HD'];
let watchlistCache = { data: null, ts: 0 };
const WATCHLIST_CACHE_TTL = 60000; // 1 min cache



async function fetchStockData(symbol, spyHistory, wlV7Quotes) {
  try {
    const [history, quote] = await Promise.all([
      fetchYahooHistory(symbol, 400),
      fetchSingleQuote(symbol, 'WL_' + symbol)
    ]);
    if (!quote || history.length < 20) return null;

    const wlV7 = (wlV7Quotes && wlV7Quotes[symbol]) || {};
    const price = wlV7.price ?? quote.price;
    // Use history array for prev close — fixes Yahoo Monday boundary bug
    const histPrevWl = history.length >= 2 ? history[history.length - 2] : 0;
    const wlPrev = (histPrevWl > 0 && Math.abs(price - histPrevWl) / histPrevWl < 0.10)
      ? histPrevWl
      : (wlV7.prev ?? quote.prev ?? 0);
    const wlChg = price - wlPrev;
    const changePct = wlPrev > 0 ? ((price - wlPrev) / wlPrev) * 100 : (wlV7.changePct ?? quote.changePct ?? 0);
    // Fibonacci-based MAs
    const ema8 = calcEMA(history, 8);
    const ema21 = calcEMA(history, 21);
    const sma89 = calcSMA(history, 89);
    const sma233 = calcSMA(history, 233) || null; // requires 233 bars — no ma200 fallback
    // Keep legacy aliases for compatibility
    const ma20 = ema21;
    const ma50 = sma89;
    const ma200 = sma233;
    const rsi = calcRSI(history, 14);

    // Relative strength vs SPY (20d performance comparison)
    const stockPerf20 = history.length >= 20 ? ((history[history.length-1] - history[history.length-20]) / history[history.length-20]) * 100 : 0;
    const spyPerf20 = spyHistory.length >= 20 ? ((spyHistory[spyHistory.length-1] - spyHistory[spyHistory.length-20]) / spyHistory[spyHistory.length-20]) * 100 : 0;
    const relStrength = Math.round((stockPerf20 - spyPerf20) * 100) / 100;

    // Volume trend (avg last 5 vs avg last 20) - approximate from price action
    const recentVolatility = history.slice(-5).reduce((acc, v, i, arr) => {
      if (i === 0) return acc;
      return acc + Math.abs((v - arr[i-1]) / arr[i-1]);
    }, 0) / 4 * 100;

    // ATR-based volatility (14-day)
    const atr = recentVolatility;

    // Setup score (0-100)
    let setupScore = 0;
    // Trend structure — reward being above each MA
    if (sma233 && price > sma233) setupScore += 25;
    if (sma89 && price > sma89) setupScore += 20;
    if (ema21 && price > ema21) setupScore += 15;
    if (ema8 && price > ema8) setupScore += 5;
    // RSI health
    if (rsi > 40 && rsi < 70) setupScore += 20;
    if (rsi > 50) setupScore += 5;
    // Near-MA bonus — only valid when price is AT or ABOVE the MA (true pullback setup)
    if (ema21) {
      const dist21 = (price - ema21) / ema21;
      if (dist21 >= 0 && dist21 < 0.03) setupScore += 10;
      else if (dist21 < -0.02) setupScore -= 8;
    }
    if (sma89) {
      const dist89 = (price - sma89) / sma89;
      if (dist89 >= 0 && dist89 < 0.03) setupScore += 8;
      else if (dist89 < -0.02) setupScore -= 10;
    }
    // Trend alignment penalties — punish bearish MA stacking
    if (ema8 && ema21 && ema8 < ema21) setupScore -= 6;
    if (ema21 && sma89 && ema21 < sma89) setupScore -= 8;
    if (sma89 && sma233 && sma89 < sma233) setupScore -= 8;
    if (sma233 && price < sma233) setupScore -= 15;
    setupScore = Math.max(0, Math.min(100, setupScore));

    // Momentum score (0-100)
    let momentumScore = 0;
    momentumScore += relStrength > 5 ? 35 : relStrength > 0 ? 20 : relStrength > -5 ? 5 : 0;
    momentumScore += changePct > 2 ? 25 : changePct > 0.5 ? 15 : changePct > 0 ? 8 : 0;
    const slope = calcSlope(history, 10);
    momentumScore += slope > 2 ? 25 : slope > 0.5 ? 15 : slope > 0 ? 5 : 0;
    momentumScore += rsi > 55 ? 15 : rsi > 45 ? 8 : 0;
    momentumScore = Math.max(0, Math.min(100, momentumScore));

    const combinedScore = Math.round(setupScore * 0.6 + momentumScore * 0.4);

    // Verdict
    let verdict = 'AVOID';
    // Hard floor: ACTIONABLE requires price above EMA 21 + SMA 89 + positive RS
    const canBeActionable = combinedScore >= 65 &&
      relStrength >= 0 &&
      (!sma89 || price >= sma89) &&
      (!ema21 || price >= ema21);
    if (canBeActionable) verdict = 'ACTIONABLE';
    else if (combinedScore >= 45) verdict = 'WATCH';

    // Key levels
    const support = sma89 && price >= sma89 ? Math.round(sma89 * 100) / 100 : null;
    const resistance = ema21 && price < ema21 ? Math.round(ema21 * 100) / 100 : null;

    // Top reasons
    const reasons = [];
    if (ma200) {
      if (price > ma200) reasons.push('Above SMA 233');
      else reasons.push('Below SMA 233');
    }
    if (relStrength > 2) reasons.push('Outperforming SPY +'+relStrength.toFixed(1)+'%');
    else if (relStrength < -2) reasons.push('Underperforming SPY '+relStrength.toFixed(1)+'%');
    if (rsi > 70) reasons.push('RSI overbought ('+rsi+')');
    else if (rsi < 30) reasons.push('RSI oversold ('+rsi+')');
    else if (rsi > 50) reasons.push('RSI healthy ('+rsi+')');
    if (ma20 && price >= ma20 && (price - ma20) / ma20 < 0.03) reasons.push('Near EMA 21 support');
    if (ma50 && price >= ma50 && (price - ma50) / ma50 < 0.03) reasons.push('Near SMA 89 support');

    return {
      symbol,
      price,
      changePct: Math.round(changePct * 100) / 100,
      change: Math.round(wlChg * 100) / 100,
      ema8: ema8 ? Math.round(ema8 * 100) / 100 : null,
      ema21: ema21 ? Math.round(ema21 * 100) / 100 : null,
      sma89: sma89 ? Math.round(sma89 * 100) / 100 : null,
      sma233: sma233 ? Math.round(sma233 * 100) / 100 : null,
      ma20: ema21 ? Math.round(ema21 * 100) / 100 : null,
      ma50: sma89 ? Math.round(sma89 * 100) / 100 : null,
      ma200: sma233 ? Math.round(sma233 * 100) / 100 : null,
      vs20: ema21 ? (price > ema21 ? 'above' : 'below') : 'unknown',
      vs50: sma89 ? (price > sma89 ? 'above' : 'below') : 'unknown',
      vs200: sma233 ? (price > sma233 ? 'above' : 'below') : 'unknown',
      vsEma8: ema8 ? (price > ema8 ? 'above' : 'below') : 'unknown',
      rsi,
      relStrength,
      atr: Math.round(atr * 10) / 10,
      setupScore,
      momentumScore,
      combinedScore,
      verdict,
      support,
      resistance,
      reasons: reasons.slice(0, 3),
      perf20d: Math.round(stockPerf20 * 100) / 100
    };
  } catch(e) {
    console.error('Stock fetch error:', symbol, e.message);
    return null;
  }
}

async function buildWatchlistData(spyHistory) {
  // Batch fetch v7 quotes for all watchlist symbols at once (efficiency)
  const wlV7Quotes = await fetchV7Quotes(WATCHLIST);
  const results = await Promise.all(WATCHLIST.map(sym => fetchStockData(sym, spyHistory, wlV7Quotes)));
  return results.filter(r => r !== null).sort((a, b) => b.combinedScore - a.combinedScore);
}

async function getWatchlistData(spyHistory) {
  const now = Date.now();
  if (watchlistCache.data && (now - watchlistCache.ts) < WATCHLIST_CACHE_TTL) {
    return { stocks: watchlistCache.data, cached: true };
  }
  const stocks = await buildWatchlistData(spyHistory);
  watchlistCache = { data: stocks, ts: now };
  return { stocks, cached: false };
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
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
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
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ journal, count: journal.length }));
    return;
  }

  if (parsed.pathname === '/api/watchlist') {
    try {
      // Use cached spy history if available
      const spyHist = await fetchYahooHistory('SPY', 220);
      const data = await getWatchlistData(spyHist);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/crypto') {
    try {
      const data = await fetchCryptoData();
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (!data) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No crypto data available' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/health') {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), feedHealth }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`SIBT API running on port ${PORT}`));
