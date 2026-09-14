'use strict';

const DAY = 86400000;
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value + 'T00:00:00Z') : NaN;

function nyDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function quoteTime(option) {
  const stamps = [option.bid_date, option.ask_date, option.trade_date].map(Number).filter(x => Number.isFinite(x) && x > 0);
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

function normalizeOption(option) {
  return {
    symbol: option.symbol,
    expiration: option.expiration_date,
    strike: Number(option.strike),
    bid: Number(option.bid),
    ask: Number(option.ask),
    last: Number(option.last),
    oi: Number(option.open_interest),
    contractSize: Number(option.contract_size),
    quoteAsOf: quoteTime(option),
    delta: option.greeks?.delta == null ? null : Number(option.greeks.delta),
    iv: option.greeks?.mid_iv == null ? null : Number(option.greeks.mid_iv)
  };
}

async function buildMstrChain({ request, minDte = 7, maxDte = 45, minStrike = 0, now = Date.now(), maxExpirations = 8 }) {
  if (typeof request !== 'function') throw new Error('Tradier request function is required');
  minDte = Math.max(1, Number(minDte) || 7);
  maxDte = Math.min(120, Math.max(minDte, Number(maxDte) || 45));
  minStrike = Math.max(0, Number(minStrike) || 0);
  const today = dateOnly(nyDate(now));
  const [expirationData, quoteData] = await Promise.all([
    request('/markets/options/expirations', { symbol: 'MSTR', includeAllRoots: 'false' }),
    request('/markets/quotes', { symbols: 'MSTR', greeks: 'false' })
  ]);
  const rawDates = expirationData?.expirations?.date;
  const expirations = array(rawDates).filter(date => {
    const dte = (dateOnly(date) - today) / DAY;
    return Number.isFinite(dte) && dte >= minDte && dte <= maxDte;
  }).slice(0, maxExpirations);
  if (!expirations.length) return { underlying: null, expirations: [], calls: [] };
  const chainData = await Promise.all(expirations.map(expiration => request('/markets/options/chains', { symbol: 'MSTR', expiration, greeks: 'true' })));
  const calls = chainData.flatMap(data => array(data?.options?.option))
    .filter(option => option?.option_type === 'call' && Number(option.contract_size) === 100 && Number(option.strike) >= minStrike)
    .map(normalizeOption)
    .filter(option => Number.isFinite(option.strike) && Number.isFinite(option.bid) && Number.isFinite(option.ask))
    .sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike);
  const quote = array(quoteData?.quotes?.quote)[0] || {};
  const underlying = { symbol: 'MSTR', price: Number(quote.last || quote.close), bid: Number(quote.bid), ask: Number(quote.ask), quoteAsOf: quoteTime(quote) };
  return { underlying, expirations, calls };
}

module.exports = { buildMstrChain, normalizeOption, nyDate };
