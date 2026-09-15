const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildMarketScore } = require('../lib/scoring/market');
const { getMarketEventRisk, isMarketHoliday, getMarketCloseMinutes } = require('../lib/calendar/market-events');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function run() {
  const bullish = buildMarketScore(fixture('bullish-market.json'));
  assert.strictEqual(bullish.permissionLabel, 'FAVORABLE');
  assert.ok(bullish.weightedScore >= 70);

  const caution = buildMarketScore(fixture('caution-market.json'));
  assert.strictEqual(caution.permissionLabel, 'LOW_PERMISSION');
  assert.ok(caution.weightedScore < 45);

  const riskoff = buildMarketScore(fixture('riskoff-market.json'));
  assert.strictEqual(riskoff.permissionLabel, 'LOW_PERMISSION');
  assert.ok(riskoff.weightedScore < 45);

  const eventRisk = getMarketEventRisk(Date.parse('2026-09-14T18:00:00Z'));
  assert.strictEqual(eventRisk.nearest.type, 'FOMC');
  assert.strictEqual(eventRisk.fomc72hr, true);
  assert.strictEqual(isMarketHoliday(Date.parse('2026-11-26T17:00:00Z')), true);
  assert.strictEqual(getMarketCloseMinutes(Date.parse('2026-11-27T17:00:00Z')), 780);

  console.log('market-score.test.js passed');
}

run();
