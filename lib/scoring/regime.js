const { REGIME_MODEL_VERSION } = require('../config');

const REGIMES = {
  TRENDING_BULL: 'TRENDING BULL',
  CHOPPY_BULL: 'CHOPPY BULL',
  NEUTRAL: 'NEUTRAL',
  CHOPPY_BEAR: 'CHOPPY BEAR',
  TRENDING_BEAR: 'TRENDING BEAR',
  PANIC: 'PANIC'
};

function classifyRegime(d) {
  const above20 = d.spyVs20 === 'above';
  const above50 = d.spyVs50 === 'above';
  const above200 = d.spyVs200 === 'above';
  const below20 = d.spyVs20 === 'below';
  const below50 = d.spyVs50 === 'below';
  const below200 = d.spyVs200 === 'below';
  const risingVolatility = Number(d.vixSlope) > 0.5;
  const elevatedVolatility = Number(d.vixLevel) >= 28;

  if ((Number(d.vixLevel) >= 32 && risingVolatility) || (elevatedVolatility && below50 && below200)) {
    return REGIMES.PANIC;
  }
  if (below20 && below50 && below200 && !d.spyEma21AboveSma89 && !d.spySma89AboveSma233) {
    return REGIMES.TRENDING_BEAR;
  }
  if (above20 && above50 && above200 && d.spyEma21AboveSma89 && d.spySma89AboveSma233 && Number(d.spyRSI) >= 48 && Number(d.spyRSI) <= 72 && Number(d.vixLevel) < 24) {
    return REGIMES.TRENDING_BULL;
  }
  if (above200 && (above20 || above50)) return REGIMES.CHOPPY_BULL;
  if (below200 || (below20 && below50)) return REGIMES.CHOPPY_BEAR;
  return REGIMES.NEUTRAL;
}

function permission(label, note) {
  return { label, note };
}

function buildRegimePlan(d, marketScore) {
  const regime = classifyRegime(d);
  const marketPermission = marketScore.permissionLabel;
  const nearEvent = Boolean(d.scheduledEvents?.highImpact24hr || d.scheduledEvents?.fomc72hr);
  let sizeMultiplier = marketPermission === 'FAVORABLE' ? 1 : marketPermission === 'SELECTIVE' ? 0.5 : 0;

  if (regime === REGIMES.CHOPPY_BULL) sizeMultiplier = Math.min(sizeMultiplier, 0.75);
  if (regime === REGIMES.NEUTRAL) sizeMultiplier = Math.min(sizeMultiplier, 0.5);
  if (regime === REGIMES.CHOPPY_BEAR) sizeMultiplier = Math.min(sizeMultiplier, 0.25);
  if ([REGIMES.TRENDING_BEAR, REGIMES.PANIC].includes(regime)) sizeMultiplier = 0;
  if (nearEvent) sizeMultiplier = Math.min(sizeMultiplier, 0.5);
  if (d.marketOpen === false) sizeMultiplier = 0;

  const newPositions = sizeMultiplier >= 0.75
    ? permission('ALLOWED', 'Use normal setup standards and the displayed risk ceiling.')
    : sizeMultiplier > 0
      ? permission('SELECTIVE', `Cap new-position risk at ${sizeMultiplier.toFixed(2)}× normal.`)
      : permission('PAUSED', d.marketOpen === false ? 'Market is closed; planning only.' : 'Regime and market permission do not support fresh entries.');

  let cashSecuredPuts = marketPermission === 'LOW_PERMISSION' || [REGIMES.TRENDING_BEAR, REGIMES.PANIC].includes(regime)
    ? permission('PAUSED', 'Bullish acquisition risk is not supported by the current regime.')
    : regime === REGIMES.TRENDING_BULL && !nearEvent
      ? permission('ALLOWED', 'Screen only strikes you would willingly own with full cash reserved.')
      : permission('SELECTIVE', 'Require stronger downside cushion and avoid event-crossing expirations.');

  let coveredCalls = regime === REGIMES.PANIC
    ? permission('SELECTIVE', 'Premium does not protect against severe stock downside; manage existing shares carefully.')
    : nearEvent
      ? permission('SELECTIVE', 'Scheduled-event risk can distort premium and assignment exposure.')
      : permission('ALLOWED', 'Screen existing eligible shares; acceptable sale price remains the hard constraint.');

  if (d.marketOpen === false) {
    cashSecuredPuts = permission('PLANNING', 'Market is closed; screen scenarios only and reload live quotes during regular hours.');
    coveredCalls = permission('PLANNING', 'Market is closed; screen scenarios only and reload live quotes during regular hours.');
  }

  return {
    modelVersion: REGIME_MODEL_VERSION,
    regime,
    sizeMultiplier,
    eventCapActive: nearEvent,
    marketOpen: d.marketOpen !== false,
    strategies: { newPositions, cashSecuredPuts, coveredCalls }
  };
}

module.exports = { REGIMES, classifyRegime, buildRegimePlan };
