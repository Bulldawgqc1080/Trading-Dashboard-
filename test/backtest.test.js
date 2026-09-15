const assert = require('assert');
const { backfillJournalOutcomes, buildBacktestSummary, buildValidationReport, summarizeConfidenceBuckets } = require('../lib/journal/backtest');
const { getJournal, replaceJournal } = require('../lib/journal/store');

async function run() {
  const entries = [
    { modelVersion:'market-v4', decision: 'YES', confidenceScore: 86, confidenceLabel: 'HIGH', outcome5d: 2.1, breadthMode: 'proxy', outcomeMethod:'trading-date-v1', validationEligible:true },
    { modelVersion:'market-v4', decision: 'YES', confidenceScore: 82, confidenceLabel: 'HIGH', outcome5d: 1.4, breadthMode: 'proxy', outcomeMethod:'trading-date-v1', validationEligible:true },
    { modelVersion:'market-v4', decision: 'CAUTION', confidenceScore: 61, confidenceLabel: 'MEDIUM', outcome5d: 0.6, breadthMode: 'proxy', outcomeMethod:'trading-date-v1', validationEligible:true },
    { modelVersion:'market-v4', decision: 'NO', confidenceScore: 43, confidenceLabel: 'LOW', outcome5d: -1.2, breadthMode: 'proxy', outcomeMethod:'trading-date-v1', validationEligible:true },
    { modelVersion:'market-v4', decision: 'NO', confidenceScore: 40, confidenceLabel: 'LOW', outcome5d: -0.4, breadthMode: 'proxy', outcomeMethod:'trading-date-v1', validationEligible:true },
    { decision: 'YES', confidenceScore: 90, confidenceLabel: 'HIGH', outcome5d: 99, breadthMode: 'proxy', outcomeMethod:null, validationEligible:null }
  ];

  const validation = buildValidationReport(entries);
  assert.strictEqual(validation.forwardEdge5d, null);
  assert.ok(validation.warnings.includes('small forward sample size'));

  const confidenceBuckets = summarizeConfidenceBuckets(entries);
  assert.strictEqual(confidenceBuckets.HIGH.count, 3);
  assert.strictEqual(confidenceBuckets.LOW.count, 2);

  replaceJournal([
    { modelVersion:'market-v4', date:'2026-09-10', marketStatus:'MARKET OPEN', decision:'YES', spyEntry:100 },
    { modelVersion:'market-v4', date:'2026-09-11', marketStatus:'AFTER-HOURS', decision:'NO', spyEntry:101 }
  ]);
  await backfillJournalOutcomes(async () => [
    {date:'2026-09-10',close:100}, {date:'2026-09-11',close:101}, {date:'2026-09-14',close:105},
    {date:'2026-09-15',close:106}, {date:'2026-09-16',close:107}, {date:'2026-09-17',close:108},
    {date:'2026-09-18',close:109}, {date:'2026-09-21',close:110}, {date:'2026-09-22',close:111},
    {date:'2026-09-23',close:112}, {date:'2026-09-24',close:113}, {date:'2026-09-25',close:114},
    {date:'2026-09-28',close:115}, {date:'2026-09-29',close:116}, {date:'2026-09-30',close:117}
  ]);
  const written = getJournal();
  assert.strictEqual(written[0].outcomeMethod, 'trading-date-v1');
  assert.strictEqual(written[0].validationEligible, true);
  assert.strictEqual(written[0].outcome5d, 8);
  assert.strictEqual(written[1].validationEligible, false);
  assert.strictEqual(buildBacktestSummary().buckets.YES.avg5d, null, 'thin buckets must not publish performance percentages');

  console.log('backtest.test.js passed');
}

run().catch(err => { console.error(err); process.exit(1); });
