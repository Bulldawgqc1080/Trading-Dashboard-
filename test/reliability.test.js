const assert = require('assert');
const { normalizeQuote } = require('../lib/quotes');
const { getFeedQuality, buildSystemStatus } = require('../lib/health');
const { buildStockVerdict } = require('../lib/scoring/watchlist');
const epoch = s => Date.parse(s) / 1000;
const quote = normalizeQuote({
  meta: { regularMarketPrice: 105, regularMarketTime: epoch('2026-09-11T20:00:00Z') },
  timestamp: [epoch('2026-09-10T13:30:00Z'), epoch('2026-09-11T13:30:00Z')],
  indicators: { quote: [{ close: [100, 105] }] }
});
assert.equal(quote.changePct, 5, 'Weekend quote must retain last-session change');
assert.equal(quote.quoteAsOf, '2026-09-11T20:00:00.000Z');
assert.equal(normalizeQuote({ meta: { regularMarketPrice: 10 } }).changePct, null);
const feedQuality = getFeedQuality({ DXY: { status: 'error', ts: Date.now() } });
assert.equal(feedQuality.quality, 'degraded');
assert.deepEqual(feedQuality.errors, ['DXY']);
assert.equal(buildSystemStatus({ marketData: { spy: { price: 100 }, qqq: { price: 100 }, vixLevel: 20, indicatorHistoryComplete: false }, feedQuality }).suppressDecision, true);
const stock = buildStockVerdict({ symbol: 'TEST', price: 100, ema8: 99, ema21: 98, sma89: 97, sma233: 120, rsi: 80, relStrength: 10, changePct: 0, history: Array(233).fill(100), marketDecision: 'NO' });
assert(stock.needs.includes('Wait for market permission to improve'));
assert(stock.needs.includes('Reclaim SMA 233'));
console.log('reliability.test.js passed');
