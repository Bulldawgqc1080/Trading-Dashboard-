function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function buildWatchlistSignal(stock, marketDecision) {
  const triggers = [];
  let level = 'favorable';

  if (marketDecision === 'NO') { triggers.push('Overall market permission is low'); level = 'avoid'; }
  if (stock.verdict === 'AVOID') { triggers.push('Stock setup is AVOID'); level = 'avoid'; }
  if (stock.vs20 === 'below' && stock.vs50 === 'below' && stock.vs200 === 'below') { triggers.push('Below EMA21/89/233'); level = 'avoid'; }
  if (stock.rsi >= 78) { triggers.push(`RSI overbought (${stock.rsi})`); level = 'avoid'; }
  if (stock.relStrength < -8) { triggers.push('RS collapsing vs SPY'); level = 'avoid'; }
  if (marketDecision === 'NO' && stock.verdict === 'AVOID') triggers.push('Stock setup is also weak');

  if (level === 'favorable') {
    if (stock.verdict === 'WATCH') { triggers.push('Stock setup is still WATCH'); level = 'caution'; }
    if (stock.vs20 === 'below' && stock.vs50 === 'above') { triggers.push('Lost EMA 21'); level = 'caution'; }
    if (stock.rsi > 70 && stock.rsi < 78) { triggers.push(`RSI extended (${stock.rsi})`); level = 'caution'; }
    if (stock.relStrength < -3 && stock.relStrength >= -8) { triggers.push('RS weakening vs SPY'); level = 'caution'; }
    if (stock.momentumScore < 35 && stock.setupScore > 50) { triggers.push('Momentum fading'); level = 'caution'; }
    if (Number.isFinite(stock.extensionAtr) && stock.extensionAtr > 2) { triggers.push(`Extended ${stock.extensionAtr.toFixed(1)} ATR above EMA 21`); level = 'caution'; }
    if (Number.isFinite(stock.daysToEarnings) && stock.daysToEarnings >= 0 && stock.daysToEarnings <= 7) { triggers.push(`Earnings risk in ${stock.daysToEarnings} day${stock.daysToEarnings === 1 ? '' : 's'}`); level = 'caution'; }
    if (marketDecision === 'CAUTION') { triggers.push('Market in caution zone'); level = 'caution'; }
  }

  const labels = { favorable: 'FAVORABLE', caution: 'CAUTION', avoid: 'NOT ELIGIBLE' };
  return {
    level,
    label: labels[level],
    reason: triggers.slice(0, 2).join(' · ') || (level === 'favorable' ? 'Structure acceptable' : 'Conditions weak'),
    shortReason: triggers[0] || (level === 'favorable' ? 'Structure acceptable' : 'Conditions weak')
  };
}

function buildStockVerdict({ symbol, price, ema8, ema21, sma89, sma233, rsi, relStrength, relStrength60 = 0, changePct, history, bars = [], atr14 = null, volumeTrend = null, marketDecision }) {
  let setupScore = 0;
  if (sma233 && price > sma233) setupScore += 20;
  if (sma89 && price > sma89) setupScore += 18;
  if (ema21 && price > ema21) setupScore += 14;
  if (ema8 && price > ema8) setupScore += 6;

  if (rsi >= 45 && rsi <= 68) setupScore += 18;
  else if (rsi >= 38 && rsi < 45) setupScore += 8;
  else if (rsi > 68 && rsi <= 75) setupScore += 5;

  if (ema21) {
    const dist21 = (price - ema21) / ema21;
    if (dist21 >= 0 && dist21 < 0.03) setupScore += 12;
    else if (dist21 >= -0.02 && dist21 < 0) setupScore += 5;
    else if (dist21 < -0.04) setupScore -= 10;
  }

  if (sma89) {
    const dist89 = (price - sma89) / sma89;
    if (dist89 >= 0 && dist89 < 0.03) setupScore += 10;
    else if (dist89 >= -0.02 && dist89 < 0) setupScore += 4;
    else if (dist89 < -0.05) setupScore -= 10;
  }

  if (ema8 && ema21 && ema8 < ema21) setupScore -= 5;
  if (ema21 && sma89 && ema21 < sma89) setupScore -= 7;
  if (sma89 && sma233 && sma89 < sma233) setupScore -= 8;
  if (sma233 && price < sma233) setupScore -= 10;
  const extensionAtr = atr14 && ema21 ? (price - ema21) / atr14 : null;
  if (Number.isFinite(extensionAtr) && extensionAtr > 2) setupScore -= 10;
  setupScore = clamp(setupScore);

  const slope10 = history.length >= 10 ? ((history[history.length - 1] - history[history.length - 10]) / history[history.length - 10]) * 100 : 0;
  const slope20 = history.length >= 20 ? ((history[history.length - 1] - history[history.length - 20]) / history[history.length - 20]) * 100 : 0;

  let momentumScore = 0;
  momentumScore += relStrength > 8 ? 24 : relStrength > 3 ? 18 : relStrength > 0 ? 12 : relStrength > -3 ? 5 : 0;
  momentumScore += relStrength60 > 15 ? 24 : relStrength60 > 7 ? 18 : relStrength60 > 0 ? 12 : relStrength60 > -5 ? 5 : 0;
  momentumScore += changePct > 4 ? 8 : changePct > 2 ? 6 : changePct > 0.5 ? 4 : changePct > 0 ? 2 : 0;
  momentumScore += slope10 > 4 ? 16 : slope10 > 1 ? 10 : slope10 > 0 ? 5 : 0;
  momentumScore += slope20 > 8 ? 14 : slope20 > 3 ? 9 : slope20 > 0 ? 4 : 0;
  momentumScore += rsi >= 50 && rsi <= 70 ? 8 : 0;
  momentumScore += volumeTrend > 1.25 ? 6 : volumeTrend > 1 ? 4 : volumeTrend > 0.8 ? 2 : 0;
  momentumScore = clamp(momentumScore);

  const combinedScore = Math.round(setupScore * 0.6 + momentumScore * 0.4);
  let verdict = 'AVOID';
  const structuralOk = (!sma89 || price >= sma89 * 0.98) && (!ema21 || price >= ema21 * 0.98);
  const canBeActionable = combinedScore >= 68 && relStrength >= 0 && structuralOk;

  if (canBeActionable) verdict = 'ACTIONABLE';
  else if (combinedScore >= 42) verdict = 'WATCH';

  const ema21Reference = ema21 ? Number(ema21.toFixed(2)) : null;
  const high20 = bars.length >= 20 ? Number(Math.max(...bars.slice(-20).map(bar => Number.isFinite(bar.high) ? bar.high : bar.close)).toFixed(2)) : history.length >= 20 ? Number(Math.max(...history.slice(-20)).toFixed(2)) : null;
  const high60 = bars.length >= 60 ? Number(Math.max(...bars.slice(-60).map(bar => Number.isFinite(bar.high) ? bar.high : bar.close)).toFixed(2)) : history.length >= 60 ? Number(Math.max(...history.slice(-60)).toFixed(2)) : null;
  const trendReferences = [ema21, sma89, sma233].filter(level => Number.isFinite(level) && level < price).sort((a, b) => b - a);
  const invalidationAnchor = trendReferences[0] || ema21 || sma89 || null;
  const invalidation = invalidationAnchor && atr14 ? Math.max(0.01, invalidationAnchor - atr14) : null;
  const riskPerShare = invalidation && invalidation < price ? price - invalidation : null;
  const zoneAnchor = ema21 || price;
  const buyZone = atr14 ? {
    low: Number(Math.max(0.01, zoneAnchor - atr14 * 0.25).toFixed(2)),
    high: Number((zoneAnchor + atr14 * 0.5).toFixed(2))
  } : null;
  const nextReference = [high20, high60].filter(level => Number.isFinite(level) && level > price).sort((a, b) => a - b)[0] || null;
  const rewardRisk = riskPerShare && nextReference ? (nextReference - price) / riskPerShare : null;

  const why = [];
  if (sma233) why.push(price > sma233 ? 'Holding above long-term trend' : 'Below long-term trend');
  if (sma89) why.push(price > sma89 ? 'Near or above SMA 89' : 'Still below SMA 89');
  if (relStrength > 2) why.push(`Outperforming SPY +${relStrength.toFixed(1)}%`);
  else if (relStrength < -2) why.push(`Lagging SPY ${relStrength.toFixed(1)}%`);
  if (rsi >= 45 && rsi <= 68) why.push(`RSI healthy (${rsi})`);
  else if (rsi < 38) why.push(`RSI weak (${rsi})`);
  if (changePct > 2) why.push('Strong day momentum');
  if (relStrength60 > 3) why.push(`60D strength vs SPY +${relStrength60.toFixed(1)}%`);

  const needs = [];
  if (!sma233 || !sma89 || !ema21) needs.push('Obtain complete moving-average history');
  if (sma233 && price < sma233) needs.push('Reclaim SMA 233');
  if (ema21 && price < ema21) needs.push('Reclaim EMA 21');
  if (sma89 && price < sma89) needs.push('Reclaim SMA 89');
  if (relStrength < 0) needs.push('Improve relative strength vs SPY');
  if (rsi < 45) needs.push('Momentum needs to improve');
  if (rsi > 68) needs.push('Wait for RSI extension to cool');
  if (Number.isFinite(extensionAtr) && extensionAtr > 2) needs.push('Wait for price to move closer to EMA 21');
  if (verdict === 'AVOID' && !needs.length) needs.push('Wait for stronger setup and momentum scores');

  return {
    symbol,
    setupScore,
    momentumScore,
    combinedScore,
    verdict,
    ema21Reference,
    high20,
    high60,
    extensionAtr,
    entryPlan: {
      buyZone,
      invalidation: invalidation ? Number(invalidation.toFixed(2)) : null,
      riskPerShare: riskPerShare ? Number(riskPerShare.toFixed(2)) : null,
      nextReference,
      rewardRisk: Number.isFinite(rewardRisk) ? Number(rewardRisk.toFixed(2)) : null,
      note: 'Technical planning references, not order instructions or guaranteed support.'
    },
    why: why.slice(0, 3),
    needs: needs.slice(0, 3)
  };
}

module.exports = { buildStockVerdict, buildWatchlistSignal };
