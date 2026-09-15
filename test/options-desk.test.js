const assert = require('assert');
const { evaluate, rankCandidates, closePaper } = require('../public/covered-call');
const { buildMstrChain, normalizeOption } = require('../lib/options/tradier');
const { getEarningsRisk, parseNasdaqEarnings } = require('../lib/events/nasdaq');

const position = { shares: 200, reserved: 0, contracts: 1, cost: 110, spot: 140, minStrike: 150, source: 'paper broker', asOf: '2026-09-14T14:00:00Z', marketStatus:'MARKET OPEN', minDte: 7, maxDte: 45, maxSpread: 20, minOi: 100, minPremium: 100, fee: 1, standard: true };
const calls = [{ expiration: '2026-10-02', strike: 150, bid: 5, ask: 5.5, oi: 1000 }];
const result = evaluate(position, calls, Date.parse('2026-09-14T14:10:00Z'));
assert.equal(result.eligibleCount, 1);
assert.equal(result.rows[0].metrics.netPremium, 499);
assert.equal(result.rows[0].metrics.maxPnlNow, 1499);
assert.equal(result.rows[0].metrics.maxPnlCost, 4499);
assert.equal(result.rows[0].metrics.scenarios.find(x => x.price === 168).difference, -1301);
assert.equal(evaluate({...position, shares:99}, calls, Date.parse('2026-09-14T14:10:00Z')).eligibleCount, 0);
assert.equal(evaluate(position, calls, Date.parse('2026-09-14T14:21:00Z')).eligibleCount, 0);
assert.equal(evaluate({...position,marketStatus:'AFTER-HOURS',asOf:'2026-09-14T14:09:00Z'},calls,Date.parse('2026-09-14T14:10:00Z')).eligibleCount,0);
assert.equal(evaluate(position, [{...calls[0], quoteAsOf:'2026-09-14T13:00:00Z'}], Date.parse('2026-09-14T14:10:00Z')).eligibleCount, 0);
assert.equal(evaluate(position, [{...calls[0], quoteAsOf:'2026-09-14T14:05:00Z'}], Date.parse('2026-09-14T14:10:00Z')).eligibleCount, 1);
const rankedInput = [
  {...calls[0],strike:150,bid:5,ask:5.2,oi:2000,volume:500,delta:.18,quoteAsOf:'2026-09-14T14:05:00Z'},
  {...calls[0],strike:145,bid:8,ask:8.2,oi:3000,volume:800,delta:.34,quoteAsOf:'2026-09-14T14:05:00Z'}
];
const rankedEval = evaluate({...position,minStrike:140}, rankedInput, Date.parse('2026-09-14T14:10:00Z'));
const ranking = rankCandidates(rankedEval, {...position,minStrike:140});
assert.equal(ranking.status, 'ok');
assert.equal(ranking.profiles.length, 3);
assert.equal(ranking.profiles[0].winner.strike, 150);
assert.equal(ranking.profiles[2].winner.strike, 145);
assert(Number.isInteger(ranking.profiles[1].winner.decisionScore));
const beforeEvent = evaluate({...position,eventDate:'2026-10-10',eventSource:'test',eventEstimated:true,avoidEvent:true}, calls, Date.parse('2026-09-14T14:10:00Z'));
assert.equal(beforeEvent.eligibleCount, 1);
assert.equal(beforeEvent.rows[0].eventRisk.crosses, false);
const crossesEvent = evaluate({...position,eventDate:'2026-09-30',eventSource:'test',eventEstimated:true,avoidEvent:true}, calls, Date.parse('2026-09-14T14:10:00Z'));
assert.equal(crossesEvent.eligibleCount, 0);
assert(crossesEvent.rows[0].reasons.some(reason => reason.includes('earnings/company-event')));
const allowedEvent = evaluate({...position,minStrike:140,eventDate:'2026-09-30',avoidEvent:false}, rankedInput, Date.parse('2026-09-14T14:10:00Z'));
const penalizedRanking = rankCandidates(allowedEvent, position);
assert.equal(penalizedRanking.status, 'ok');
assert.equal(penalizedRanking.profiles[0].winner.eventPenalty, 25);
assert.equal(evaluate(position, [{...calls[0], strike:149}], Date.parse('2026-09-14T14:10:00Z')).eligibleCount, 0);
const entry = { position, metrics: result.rows[0].metrics };
const closed = closePaper(entry, 130, 1, 1);
assert.equal(closed.stockPnl, -1000);
assert.equal(closed.optionPnl, 398);
assert.equal(closed.totalPnl, -602);

const option = normalizeOption({ symbol:'MSTRX', expiration_date:'2026-10-02', strike:150, bid:5, ask:5.5, last:5.2, open_interest:500, contract_size:100, bid_date:1, ask_date:2, option_type:'call', greeks:{delta:.3,mid_iv:.7} });
assert.equal(option.quoteAsOf, '1970-01-01T00:00:00.002Z');
assert.equal(option.delta, .3);

(async () => {
  const parsedEvent = parseNasdaqEarnings('MSTR', {data:{announcement:'Earnings announcement* for MSTR: Oct 29, 2026',reportText:'The upcoming earnings date is derived from an algorithm based on historical reporting dates.'}}, '2026-09-14T12:00:00.000Z');
  assert.equal(parsedEvent.date, '2026-10-29');
  assert.equal(parsedEvent.estimated, true);
  const unknownEvent = await getEarningsRisk('SPY', {request:async () => ({data:null}),now:Date.parse('2026-09-14T12:00:00Z')});
  assert.equal(unknownEvent.status, 'unknown');
  assert.equal(unknownEvent.date, null);
  const request = async (path, params) => {
    if (path.endsWith('expirations')) return { expirations:{date:['2026-09-18','2026-10-02','2027-01-01']} };
    if (path.endsWith('quotes')) return { quotes:{quote:{symbol:'MSTR',last:140,bid:139.9,ask:140.1,bid_date:Date.parse('2026-09-14T14:00:00Z')}} };
    return { options:{option:[{...option, option_type:'call', expiration_date:params.expiration, contract_size:100, strike:150, bid:5, ask:5.5, open_interest:500}]} };
  };
  const chain = await buildMstrChain({ request, symbol:'AAPL', minDte:7, maxDte:45, now:Date.parse('2026-09-14T12:00:00Z') });
  assert.deepEqual(chain.expirations, ['2026-10-02']);
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.underlying.symbol, 'AAPL');
  assert.equal(chain.underlying.price, 140);
  console.log('options-desk.test.js passed');
})().catch(err => { console.error(err); process.exit(1); });
