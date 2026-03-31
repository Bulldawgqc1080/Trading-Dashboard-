function scoreColBounds(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function buildWatchlistSignal(stock, marketDecision) {
  const triggers = [];
  let level = 'favorable';

  if (stock.vs20 === 'below' && stock.vs50 === 'below' && stock.vs200 === 'below') { triggers.push('Below EMA21/89/233'); level = 'avoid'; }
  if (stock.rsi > 78) { triggers.push(`RSI overbought (${stock.rsi})`); level = 'avoid'; }
  if (stock.relStrength < -8) { triggers.push('RS collapsing vs SPY'); level = 'avoid'; }
  if (marketDecision === 'NO' && stock.verdict === 'AVOID') { triggers.push('Market NO + stock AVOID'); level = 'avoid'; }

  if (level === 'favorable') {
    if (stock.vs20 === 'below' && stock.vs50 === 'above') { triggers.push('Lost EMA 21'); level = 'caution'; }
    if (stock.rsi > 70 && stock.rsi <= 78) { triggers.push(`RSI extended (${stock.rsi})`); level = 'caution'; }
    if (stock.relStrength < -3 && stock.relStrength >= -8) { triggers.push('RS weakening vs SPY'); level = 'caution'; }
    if (stock.momentumScore < 30 && stock.setupScore > 50) { triggers.push('Momentum fading'); level = 'caution'; }
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

function buildStockVerdict({ price, ema8, ema21, sma89, sma233, rsi, relStrength, changePct, history, spyHistory, marketDecision }) {
  let setupScore = 0;
  if (sma233 && price > sma233) setupScore += 25;
  if (sma89 && price > sma89) setupScore += 20;
  if (ema21 && price > ema21) setupScore += 15;
  if (ema8 && price > ema8) setupScore += 5;
  if (rsi > 40 && rsi < 70) setupScore += 20;
  if (rsi > 50) setupScore += 5;

  if (ema21) {
    const dist21 = (price - ema21) / ema21;
    if (dist21 >= 0 && dist21 < 0.03) setupScore += 10;
    else if (dist21 < -0.02) setupScore -= 8;
  }
  if (sma89) {
    const dist89 = (price - sma89) / sma89;
    if (dist89 >= 0 && dist89 < 0.03) setupScore += 8;
    else if (dist89 < -0.02) setupScore -= 10;
  }
  if (ema8 && ema21 && ema8 < ema21) setupScore -= 6;
  if (ema21 && sma89 && ema21 < sma89) setupScore -= 8;
  if (sma89 && sma233 && sma89 < sma233) setupScore -= 8;
  if (sma233 && price < sma233) setupScore -= 15;
  setupScore = scoreColBounds(setupScore);

  const slope = history.length >= 10 ? ((history[history.length - 1] - history[history.length - 10]) / history[history.length - 10]) * 100 : 0;
  let momentumScore = 0;
  momentumScore += relStrength > 5 ? 35 : relStrength > 0 ? 20 : relStrength > -5 ? 5 : 0;
  momentumScore += changePct > 2 ? 25 : changePct > 0.5 ? 15 : changePct > 0 ? 8 : 0;
  momentumScore += slope > 2 ? 25 : slope > 0.5 ? 15 : slope > 0 ? 5 : 0;
  momentumScore += rsi > 55 ? 15 : rsi > 45 ? 8 : 0;
  momentumScore = scoreColBounds(momentumScore);

  const combinedScore = Math.round(setupScore * 0.6 + momentumScore * 0.4);
  let verdict = 'AVOID';
  const canBeActionable = combinedScore >= 65 && relStrength >= 0 && (!sma89 || price >= sma89) && (!ema21 || price >= ema21);
  if (canBeActionable) verdict = 'ACTIONABLE';
  else if (combinedScore >= 45) verdict = 'WATCH';

  if (marketDecision === 'NO' && verdict === 'ACTIONABLE') verdict = 'WATCH';
  if (marketDecision === 'NO' && combinedScore < 55) verdict = 'AVOID';
  if (marketDecision === 'CAUTION' && verdict === 'ACTIONABLE' && combinedScore < 75) verdict = 'WATCH';

  return { setupScore, momentumScore, combinedScore, verdict };
}

module.exports = { buildStockVerdict, buildWatchlistSignal };
