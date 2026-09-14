'use strict';

const https = require('https');

function schwabGet(pathname, params, accessToken) {
  if (!accessToken) throw new Error('Schwab access token is missing');
  const reqUrl = new URL(pathname, 'https://api.schwabapi.com');
  for (const [key, value] of Object.entries(params || {})) reqUrl.searchParams.set(key, value);
  return new Promise((resolve, reject) => {
    const req = https.get(reqUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Schwab market data returned HTTP ${res.statusCode}`));
        if (!parsed) return reject(new Error('Schwab returned invalid market data'));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Schwab market data timed out')); });
  });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function quoteTime(option) {
  const value = Number(option.quoteTimeInLong || option.quoteTime || option.tradeTimeInLong || option.tradeTime);
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

function normalizeSchwabOption(option, expiration, strike) {
  const rawExpiration = option.expirationDate || expiration;
  return {
    symbol: option.symbol,
    expiration: String(rawExpiration).slice(0, 10),
    strike: Number(option.strikePrice ?? strike),
    bid: Number(option.bid),
    ask: Number(option.ask),
    last: Number(option.last),
    oi: Number(option.openInterest),
    contractSize: Number(option.multiplier || 100),
    quoteAsOf: quoteTime(option),
    delta: option.delta == null ? null : Number(option.delta),
    iv: option.volatility == null ? null : Number(option.volatility)
  };
}

function standardContract(option) {
  const multiplier = Number(option.multiplier || 100);
  const adjusted = option.nonStandard === true || String(option.nonStandard).toLowerCase() === 'true';
  return !adjusted && multiplier === 100 && option.mini !== true;
}

function flattenCalls(map = {}, minStrike = 0) {
  const calls = [];
  for (const [expirationKey, strikes] of Object.entries(map || {})) {
    const expiration = expirationKey.split(':')[0];
    for (const [strike, contracts] of Object.entries(strikes || {})) {
      for (const option of Array.isArray(contracts) ? contracts : [contracts]) {
        if (!option || String(option.putCall).toUpperCase() !== 'CALL' || !standardContract(option)) continue;
        const normalized = normalizeSchwabOption(option, expiration, strike);
        if (normalized.strike < minStrike || !Number.isFinite(normalized.bid) || !Number.isFinite(normalized.ask)) continue;
        calls.push(normalized);
      }
    }
  }
  return calls.sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike);
}

async function buildSchwabMstrChain({ request = schwabGet, accessToken, minDte = 7, maxDte = 45, minStrike = 0, now = Date.now() }) {
  minDte = Math.max(1, Number(minDte) || 7);
  maxDte = Math.min(120, Math.max(minDte, Number(maxDte) || 45));
  minStrike = Math.max(0, Number(minStrike) || 0);
  const from = new Date(now + minDte * 86400000);
  const to = new Date(now + maxDte * 86400000);
  const [data, quoteData] = await Promise.all([
    request('/marketdata/v1/chains', {
      symbol: 'MSTR', contractType: 'CALL', strategy: 'SINGLE', includeUnderlyingQuote: 'true',
      fromDate: isoDate(from), toDate: isoDate(to)
    }, accessToken),
    request('/marketdata/v1/quotes', { symbols: 'MSTR', fields: 'quote,reference' }, accessToken)
  ]);
  const calls = flattenCalls(data.callExpDateMap, minStrike);
  const expirations = [...new Set(calls.map(call => call.expiration))];
  const quoteEnvelope = quoteData.MSTR || quoteData.mstr || {};
  const underlyingQuote = quoteEnvelope.quote || data.underlying || {};
  const underlyingPrice = Number(underlyingQuote.lastPrice || data.underlyingPrice || underlyingQuote.last || underlyingQuote.mark || underlyingQuote.closePrice || underlyingQuote.close);
  const underlying = {
    symbol: 'MSTR',
    price: underlyingPrice,
    bid: Number(underlyingQuote.bidPrice || underlyingQuote.bid),
    ask: Number(underlyingQuote.askPrice || underlyingQuote.ask),
    quoteAsOf: quoteTime(underlyingQuote)
  };
  return { underlying, expirations, calls };
}

module.exports = { schwabGet, normalizeSchwabOption, standardContract, flattenCalls, buildSchwabMstrChain };
