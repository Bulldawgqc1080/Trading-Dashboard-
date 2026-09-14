const assert = require('assert');
const { evaluate, closePaper } = require('../public/covered-call');
const { buildMstrChain, normalizeOption } = require('../lib/options/tradier');

const position = { shares: 200, reserved: 0, contracts: 1, cost: 110, spot: 140, minStrike: 150, source: 'paper broker', asOf: '2026-09-14T14:00:00Z', minDte: 7, maxDte: 45, maxSpread: 20, minOi: 100, minPremium: 100, fee: 1, standard: true };
const calls = [{ expiration: '2026-10-02', strike: 150, bid: 5, ask: 5.5, oi: 1000 }];
const result = evaluate(position, calls, Date.parse('2026-09-14T14:10:00Z'));
assert.equal(result.eligibleCount, 1);
assert.equal(result.rows[0].metrics.netPremium, 499);
assert.equal(result.rows[0].metrics.maxPnlNow, 1499);
assert.equal(result.rows[0].metrics.maxPnlCost, 4499);
assert.equal(result.rows[0].metrics.scenarios.find(x => x.price === 168).difference, -1301);
assert.equal(evaluate({...position, shares:99}, calls, Date.parse('2026-09-14T14:10:00Z')).eligibleCount, 0);
assert.equal(evaluate(position, calls, Date.parse('2026-09-14T14:21:00Z')).eligibleCount, 0);
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
  const request = async (path, params) => {
    if (path.endsWith('expirations')) return { expirations:{date:['2026-09-18','2026-10-02','2027-01-01']} };
    if (path.endsWith('quotes')) return { quotes:{quote:{symbol:'MSTR',last:140,bid:139.9,ask:140.1,bid_date:Date.parse('2026-09-14T14:00:00Z')}} };
    return { options:{option:[{...option, option_type:'call', expiration_date:params.expiration, contract_size:100, strike:150, bid:5, ask:5.5, open_interest:500}]} };
  };
  const chain = await buildMstrChain({ request, minDte:7, maxDte:45, now:Date.parse('2026-09-14T12:00:00Z') });
  assert.deepEqual(chain.expirations, ['2026-10-02']);
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.underlying.price, 140);
  console.log('options-desk.test.js passed');
})().catch(err => { console.error(err); process.exit(1); });
