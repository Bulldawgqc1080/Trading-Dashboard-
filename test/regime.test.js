const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildMarketScore } = require('../lib/scoring/market');
const { REGIMES, classifyRegime, buildRegimePlan } = require('../lib/scoring/regime');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

const bullish = fixture('bullish-market.json');
assert.equal(classifyRegime(bullish), REGIMES.TRENDING_BULL);
const bullishPlan = buildRegimePlan({...bullish, marketOpen:true, scheduledEvents:{}}, buildMarketScore(bullish));
assert.equal(bullishPlan.sizeMultiplier, 1);
assert.equal(bullishPlan.strategies.newPositions.label, 'ALLOWED');
assert.equal(bullishPlan.strategies.cashSecuredPuts.label, 'ALLOWED');

const riskoff = fixture('riskoff-market.json');
assert.equal(classifyRegime(riskoff), REGIMES.PANIC);
const riskoffPlan = buildRegimePlan({...riskoff, marketOpen:true, scheduledEvents:{}}, buildMarketScore(riskoff));
assert.equal(riskoffPlan.sizeMultiplier, 0);
assert.equal(riskoffPlan.strategies.newPositions.label, 'PAUSED');
assert.equal(riskoffPlan.strategies.cashSecuredPuts.label, 'PAUSED');

const closedPlan = buildRegimePlan({...bullish, marketOpen:false, scheduledEvents:{}}, buildMarketScore(bullish));
assert.equal(closedPlan.sizeMultiplier, 0);
assert.match(closedPlan.strategies.newPositions.note, /closed/i);
assert.equal(closedPlan.strategies.cashSecuredPuts.label, 'PLANNING');
assert.equal(closedPlan.strategies.coveredCalls.label, 'PLANNING');

const eventPlan = buildRegimePlan({...bullish, marketOpen:true, scheduledEvents:{highImpact24hr:true}}, buildMarketScore(bullish));
assert.equal(eventPlan.sizeMultiplier, 0.5);
assert.equal(eventPlan.strategies.coveredCalls.label, 'SELECTIVE');

console.log('regime.test.js passed');
