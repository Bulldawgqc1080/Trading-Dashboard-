const assert = require('assert');
const { buildConfidence } = require('../lib/scoring/confidence');

function run() {
  const low = buildConfidence({
    marketData: { breadthMode: 'proxy', macroMode: 'partial', putCallMode: 'unavailable', marketOpen: false, fedStance: 'neutral' },
    feedQuality: { stale: ['DXY'], errors: [] },
    systemStatus: { status: 'degraded' }
  });
  assert.ok(low.confidenceScore < 80);
  assert.ok(['MEDIUM', 'LOW'].includes(low.confidenceLabel));

  const unavailable = buildConfidence({
    marketData: { breadthMode: 'proxy', macroMode: 'partial', putCallMode: 'unavailable' },
    feedQuality: { stale: [], errors: ['SPY'] },
    systemStatus: { status: 'unavailable' }
  });
  assert.strictEqual(unavailable.confidenceScore, 0);
  assert.strictEqual(unavailable.confidenceLabel, 'LOW');

  console.log('confidence.test.js passed');
}

run();
