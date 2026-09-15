const assert = require('assert');
const { normalizeQuote } = require('../lib/quotes');
const { calcATR } = require('../lib/indicators');
const { getFeedQuality, buildSystemStatus } = require('../lib/health');
const { buildStockVerdict, buildWatchlistSignal } = require('../lib/scoring/watchlist');
const { normalizeWatchlistSymbols } = require('../lib/watchlist/symbols');
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
assert(stock.needs.includes('Reclaim SMA 233'));
assert.deepEqual(normalizeWatchlistSymbols('aapl, MSTR bad$ AAPL', ['TSLA']), ['AAPL','MSTR']);
assert.deepEqual(normalizeWatchlistSymbols('', ['TSLA']), ['TSLA']);
assert.equal(buildWatchlistSignal({verdict:'ACTIONABLE',vs20:'above',vs50:'above',vs200:'above',rsi:55,relStrength:5,momentumScore:70,setupScore:75}, 'NO').label, 'NOT ELIGIBLE');
assert.equal(buildWatchlistSignal({verdict:'WATCH',vs20:'above',vs50:'above',vs200:'above',rsi:55,relStrength:5,momentumScore:55,setupScore:55}, 'YES').label, 'CAUTION');
assert.equal(buildWatchlistSignal({verdict:'AVOID',vs20:'above',vs50:'above',vs200:'above',rsi:55,relStrength:1,momentumScore:35,setupScore:35}, 'YES').label, 'NOT ELIGIBLE');
assert.equal(calcATR([
  {high:10,low:8,close:9},{high:12,low:9,close:11},{high:13,low:10,close:12}
],2),3);
const calmHistory=Array.from({length:233},(_,index)=>100+index*.1);
const calmBars=calmHistory.map(close=>({high:close+1,low:close-1,close}));
const noChase=buildStockVerdict({symbol:'TEST',price:123.2,ema8:122.8,ema21:122,sma89:118,sma233:110,rsi:60,relStrength:5,relStrength60:8,changePct:8,history:calmHistory,bars:calmBars,atr14:2,volumeTrend:1,marketDecision:'YES'});
const flatDay=buildStockVerdict({symbol:'TEST',price:123.2,ema8:122.8,ema21:122,sma89:118,sma233:110,rsi:60,relStrength:5,relStrength60:8,changePct:0,history:calmHistory,bars:calmBars,atr14:2,volumeTrend:1,marketDecision:'YES'});
assert(noChase.momentumScore-flatDay.momentumScore<=8,'one-day jump must not dominate stock-v2 momentum');
assert(noChase.entryPlan.riskPerShare>0);
console.log('reliability.test.js passed');
