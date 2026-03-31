const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildMarketScore } = require('../lib/scoring/market');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function run() {
  const bullish = buildMarketScore(fixture('bullish-market.json'));
  assert.strictEqual(bullish.permissionLabel, 'FAVORABLE');
  assert.ok(bullish.weightedScore >= 70);

  const caution = buildMarketScore(fixture('caution-market.json'));
  assert.strictEqual(caution.permissionLabel, 'SELECTIVE');
  assert.ok(caution.weightedScore >= 45 && caution.weightedScore < 70);

  const riskoff = buildMarketScore(fixture('riskoff-market.json'));
  assert.strictEqual(riskoff.permissionLabel, 'LOW_PERMISSION');
  assert.ok(riskoff.weightedScore < 45);

  console.log('market-score.test.js passed');
}

run();
