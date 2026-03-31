function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function buildWatchlistSignal(stock, marketDecision) {
  const triggers = [];
  let level = 'favorable';

  if (stock.vs20 === 'below' && stock.vs50 === 'below' && stock.vs200 === 'below') { triggers.push('Below EMA21/89/233'); level = 'avoid'; }
  if (stock.rsi >= 78) { triggers.push(`RSI overbought (${stock.rsi})`); level = 'avoid'; }
  if (stock.relStrength < -8) { triggers.push('RS collapsing vs SPY'); level = 'avoid'; }
  if (marketDecision === 'NO' && stock.verdict === 'AVOID') { triggers.push('Market NO + stock AVOID'); level = 'avoid'; }

  if (level === 'favorable') {
    if (stock.vs20 === 'below' && stock.vs50 === 'above') { triggers.push('Lost EMA 21'); level = 'caution'; }
    if (stock.rsi > 70 && stock.rsi < 78) { triggers.push(`RSI extended (${stock.rsi})`); level = 'caution'; }
    if (stock.relStrength < -3 && stock.relStrength >= -8) { triggers.push('RS weakening vs SPY'); level = 'caution'; }
    if (stock.momentumScore < 35 && stock.setupScore > 50) { triggers.push('Momentum fading'); level = 'caution'; }
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

function buildStockVerdict({ symbol, price, ema8, ema21, sma89, sma233, rsi, relStrength, changePct, history, marketDecision }) {
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
  setupScore = clamp(setupScore);

  const slope10 = history.length >= 10 ? ((history[history.length - 1] - history[history.length - 10]) / history[history.length - 10]) * 100 : 0;
  const slope20 = history.length >= 20 ? ((history[history.length - 1] - history[history.length - 20]) / history[history.length - 20]) * 100 : 0;

  let momentumScore = 0;
  momentumScore += relStrength > 8 ? 35 : relStrength > 3 ? 26 : relStrength > 0 ? 18 : relStrength > -3 ? 8 : 0;
  momentumScore += changePct > 4 ? 22 : changePct > 2 ? 16 : changePct > 0.5 ? 10 : changePct > 0 ? 6 : 0;
  momentumScore += slope10 > 4 ? 20 : slope10 > 1 ? 12 : slope10 > 0 ? 6 : 0;
  momentumScore += slope20 > 8 ? 15 : slope20 > 3 ? 10 : slope20 > 0 ? 4 : 0;
  momentumScore += rsi >= 50 && rsi <= 70 ? 8 : 0;
  momentumScore = clamp(momentumScore);

  const combinedScore = Math.round(setupScore * 0.6 + momentumScore * 0.4);
  let verdict = 'AVOID';
  const structuralOk = (!sma89 || price >= sma89 * 0.98) && (!ema21 || price >= ema21 * 0.98);
  const canBeActionable = combinedScore >= 68 && relStrength >= 0 && structuralOk;

  if (canBeActionable) verdict = 'ACTIONABLE';
  else if (combinedScore >= 42) verdict = 'WATCH';

  if (marketDecision === 'NO' && verdict === 'ACTIONABLE') verdict = 'WATCH';
  if (marketDecision === 'NO' && combinedScore < 58) verdict = 'AVOID';
  if (marketDecision === 'CAUTION' && verdict === 'ACTIONABLE' && combinedScore < 78) verdict = 'WATCH';

  const support = ema21 ? Number(ema21.toFixed(2)) : (sma89 ? Number(sma89.toFixed(2)) : null);
  const resistance = history.length >= 20 ? Number(Math.max(...history.slice(-20)).toFixed(2)) : null;

  const why = [];
  if (sma233) why.push(price > sma233 ? 'Holding above long-term trend' : 'Below long-term trend');
  if (sma89) why.push(price > sma89 ? 'Near or above SMA 89' : 'Still below SMA 89');
  if (relStrength > 2) why.push(`Outperforming SPY +${relStrength.toFixed(1)}%`);
  else if (relStrength < -2) why.push(`Lagging SPY ${relStrength.toFixed(1)}%`);
  if (rsi >= 45 && rsi <= 68) why.push(`RSI healthy (${rsi})`);
  else if (rsi < 38) why.push(`RSI weak (${rsi})`);
  if (changePct > 2) why.push('Strong day momentum');

  const needs = [];
  if (ema21 && price < ema21) needs.push('Reclaim EMA 21');
  if (sma89 && price < sma89) needs.push('Reclaim SMA 89');
  if (relStrength < 0) needs.push('Improve relative strength vs SPY');
  if (rsi < 45) needs.push('Momentum needs to improve');

  return {
    symbol,
    setupScore,
    momentumScore,
    combinedScore,
    verdict,
    support,
    resistance,
    why: why.slice(0, 3),
    needs: needs.slice(0, 3)
  };
}

module.exports = { buildStockVerdict, buildWatchlistSignal };
