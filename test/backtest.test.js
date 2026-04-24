const assert = require('assert');
const { buildValidationReport, summarizeConfidenceBuckets } = require('../lib/journal/backtest');

function run() {
  const entries = [
    { decision: 'YES', confidenceScore: 86, confidenceLabel: 'HIGH', outcome5d: 2.1, breadthMode: 'proxy' },
    { decision: 'YES', confidenceScore: 82, confidenceLabel: 'HIGH', outcome5d: 1.4, breadthMode: 'proxy' },
    { decision: 'CAUTION', confidenceScore: 61, confidenceLabel: 'MEDIUM', outcome5d: 0.6, breadthMode: 'proxy' },
    { decision: 'NO', confidenceScore: 43, confidenceLabel: 'LOW', outcome5d: -1.2, breadthMode: 'proxy' },
    { decision: 'NO', confidenceScore: 40, confidenceLabel: 'LOW', outcome5d: -0.4, breadthMode: 'proxy' }
  ];

  const validation = buildValidationReport(entries);
  assert.strictEqual(validation.forwardEdge5d, 2.55);
  assert.ok(validation.warnings.includes('small forward sample size'));

  const confidenceBuckets = summarizeConfidenceBuckets(entries);
  assert.strictEqual(confidenceBuckets.HIGH.count, 2);
  assert.strictEqual(confidenceBuckets.LOW.count, 2);

  console.log('backtest.test.js passed');
}

run();
