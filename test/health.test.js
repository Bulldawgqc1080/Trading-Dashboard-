const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getFeedQuality, buildSystemStatus } = require('../lib/health');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function run() {
  const stale = getFeedQuality(fixture('health-stale.json'));
  assert.ok(['stale', 'degraded', 'bad'].includes(stale.quality));

  const critical = getFeedQuality(fixture('health-critical-down.json'));
  assert.strictEqual(critical.quality, 'bad');

  const status = buildSystemStatus({
    marketData: { spy: { price: 0 }, qqq: { price: 1 }, vixLevel: 20 },
    feedQuality: critical
  });
  assert.strictEqual(status.status, 'unavailable');
  assert.strictEqual(status.suppressDecision, true);

  console.log('health.test.js passed');
}

run();
