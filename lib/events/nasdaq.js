'use strict';

const https = require('https');
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

function nasdaqGet(symbol) {
  const url = new URL(`/api/analyst/${encodeURIComponent(symbol)}/earnings-date`, 'https://api.nasdaq.com');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (compatible; SIBT-Covered-Call-Desk/1.0)'
    } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Nasdaq earnings calendar returned HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Nasdaq earnings calendar returned invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Nasdaq earnings calendar timed out')); });
  });
}

function parseNasdaqEarnings(symbol, payload, retrievedAt = new Date().toISOString()) {
  const announcement = String(payload?.data?.announcement || '');
  const reportText = String(payload?.data?.reportText || '');
  const match = announcement.match(/:\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s*$/);
  if (!match) return {
    symbol, status:'unknown', date:null, estimated:false, source:'Nasdaq earnings calendar',
    note:'No upcoming earnings estimate was returned for this symbol.', retrievedAt
  };
  const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const date = `${match[3]}-${months[match[1]]}-${String(match[2]).padStart(2, '0')}`;
  const valid = !date.includes('undefined') && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
  if (!valid) return { symbol, status:'unknown', date:null, estimated:false, source:'Nasdaq earnings calendar', note:'The returned earnings date could not be validated.', retrievedAt };
  return {
    symbol, status:'estimated', date, estimated:true, source:'Nasdaq / Zacks estimate', retrievedAt,
    note: reportText.includes('derived from an algorithm')
      ? 'Estimated from historical reporting dates; the company may revise or confirm it.'
      : 'Estimated earnings date; verify it with the company before trading.'
  };
}

async function getEarningsRisk(symbol, { request = nasdaqGet, now = Date.now() } = {}) {
  symbol = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('Use a valid stock or ETF ticker');
  const existing = cache.get(symbol);
  if (request === nasdaqGet && existing && now - existing.ts < CACHE_TTL) return existing.value;
  let value;
  try { value = parseNasdaqEarnings(symbol, await request(symbol), new Date(now).toISOString()); }
  catch (err) {
    value = { symbol, status:'unavailable', date:null, estimated:false, source:'Nasdaq earnings calendar', note:err.message, retrievedAt:new Date(now).toISOString() };
  }
  if (request === nasdaqGet) cache.set(symbol, {ts:now,value});
  return value;
}

module.exports = { getEarningsRisk, parseNasdaqEarnings };
