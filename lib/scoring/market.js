const { DECISION_BANDS, MODEL_VERSION } = require('../config');

function estimateVixPercentile(vix) {
  if (vix < 12) return 5; if (vix < 14) return 12; if (vix < 16) return 22;
  if (vix < 18) return 32; if (vix < 20) return 42; if (vix < 22) return 52;
  if (vix < 25) return 62; if (vix < 30) return 75; if (vix < 35) return 85;
  if (vix < 40) return 92; return 98;
}

function scoreVolatility(d) {
  const vixPct = d.vixPercentile ?? estimateVixPercentile(d.vixLevel);
  let vix = d.vixLevel < 15 ? 90 : d.vixLevel < 18 ? 80 : d.vixLevel < 20 ? 72 : d.vixLevel < 23 ? 58 : d.vixLevel < 27 ? 42 : d.vixLevel < 32 ? 28 : 12;
  if (d.vixSlope < -0.5) vix = Math.min(100, vix + 8);
  if (d.vixSlope > 0.5) vix = Math.max(0, vix - 8);
  if (vixPct < 30) vix = Math.min(100, vix + 5);
  if (vixPct > 70) vix = Math.max(0, vix - 10);
  return Math.round(vix);
}

function scoreTrend(d) {
  let trend = 0;
  if (d.spyVs200 === 'above') trend += 25;
  if (d.spyVs50 === 'above') trend += 20;
  if (d.spyVs20 === 'above') trend += 15;
  if (d.qqqVs50 === 'above') trend += 15;
  if (d.regime === 'uptrend') trend += 10;
  if (d.spyEma21AboveSma89) trend += 8;
  if (d.spySma89AboveSma233) trend += 7;
  if (d.spyRSI > 30 && d.spyRSI < 70) trend = Math.min(100, trend + 8);
  if (d.spyRSI >= 75) trend = Math.max(0, trend - 12);
  if (d.spyRSI <= 25) trend = Math.max(0, trend - 18);
  return Math.round(trend);
}

function scoreBreadth(d) {
  let breadth = 0;
  breadth += Math.min(40, d.pctAbove50 * 0.55);
  breadth += Math.min(20, d.pctAbove200 * 0.35);
  breadth += d.adRatio > 1.2 ? 18 : d.adRatio > 1.0 ? 10 : 0;
  breadth += d.nasdaqHL > 65 ? 10 : d.nasdaqHL > 50 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(breadth)));
}

function scoreMomentum(d) {
  const upS = d.sectors.filter(s => s.chg > 0).length;
  const top3 = (d.sectors[0].chg + d.sectors[1].chg + d.sectors[2].chg) / 3;
  const btm3 = (d.sectors[8].chg + d.sectors[9].chg + d.sectors[10].chg) / 3;
  const spread = top3 - btm3;
  let momentum = Math.min(50, upS * 5) + Math.min(35, spread * 8);
  if (d.sectors[0].sym === 'XLK' || d.sectors[1].sym === 'XLK') momentum += 10;
  if (d.sectors[0].sym === 'XLU' || d.sectors[0].sym === 'XLP') momentum -= 12;
  return Math.max(0, Math.min(100, Math.round(momentum)));
}

function scoreMacro(d) {
  let macro = d.tenYrLevel < 4.0 ? 35 : d.tenYrLevel < 4.3 ? 25 : d.tenYrLevel < 4.7 ? 15 : d.tenYrLevel < 5.2 ? 5 : -10;
  macro += d.tenYrTrend === 'falling' ? 18 : d.tenYrTrend === 'rising' ? -12 : 0;
  macro += d.dxyTrend === 'falling' ? 15 : d.dxyTrend === 'rising' ? -5 : 0;
  macro += d.fedStance === 'dovish' ? 20 : d.fedStance === 'neutral' ? 5 : -18;
  if (d.fomc72hr) macro -= 18;
  return Math.max(0, Math.min(100, Math.round(macro)));
}

function buildReasonsAndBlockers(d, decision, spread) {
  const topReasons = [];
  const blockers = [];

  if (d.spyVs200 === 'above') topReasons.push('SPY above SMA 233');
  else blockers.push('SPY below SMA 233');

  if (d.spyVs50 === 'above') topReasons.push('SPY above SMA 89');
  else blockers.push('SPY below SMA 89');

  if (d.vixSlope < -0.5) topReasons.push('VIX falling');
  if (d.vixSlope > 0.5) blockers.push('VIX rising');

  if (d.pctAbove50 > 60) topReasons.push('Breadth healthy');
  if (d.pctAbove50 < 40) blockers.push('Breadth weak');

  if (d.sectors[0].sym === 'XLK' || d.sectors[1].sym === 'XLK') topReasons.push('Tech leadership');
  if (d.sectors[0].sym === 'XLU' || d.sectors[0].sym === 'XLP') blockers.push('Defensive leadership');

  if (d.tenYrTrend === 'falling') topReasons.push('Yields falling');
  if (d.tenYrTrend === 'rising') blockers.push('Yields rising');

  if (d.dxyTrend === 'falling') topReasons.push('Dollar falling');
  if (d.fomc72hr) blockers.push('FOMC imminent');
  if (spread < 0.5) blockers.push('Narrow sector spread');

  return {
    topReasons: (decision === 'YES' ? topReasons : blockers.length ? blockers : topReasons).slice(0, 3),
    blockers: blockers.slice(0, 4)
  };
}

function buildMarketScore(d) {
  const volatility = scoreVolatility(d);
  const trend = scoreTrend(d);
  const breadth = scoreBreadth(d);
  const momentum = scoreMomentum(d);
  const macro = scoreMacro(d);

  let weightedScore = Math.round(volatility * 0.25 + momentum * 0.25 + trend * 0.20 + breadth * 0.20 + macro * 0.10);

  const vetoFlags = [];
  if (d.vixLevel > 28 && d.vixSlope > 0.5) vetoFlags.push('volatility shock');
  if (d.spyVs50 === 'below' && d.spyVs200 === 'below') vetoFlags.push('trend breakdown');
  if (d.pctAbove50 < 40 && d.adRatio < 1.0) vetoFlags.push('weak participation');
  if (d.sectors[0].sym === 'XLU' || d.sectors[0].sym === 'XLP') vetoFlags.push('defensive leadership');

  if (vetoFlags.length >= 2) weightedScore = Math.min(weightedScore, 44);
  else if (vetoFlags.length === 1) weightedScore = Math.min(weightedScore, 69);

  let decision = 'NO';
  if (weightedScore >= DECISION_BANDS.YES) decision = 'YES';
  else if (weightedScore >= DECISION_BANDS.CAUTION) decision = 'CAUTION';

  const top3 = (d.sectors[0].chg + d.sectors[1].chg + d.sectors[2].chg) / 3;
  const btm3 = (d.sectors[8].chg + d.sectors[9].chg + d.sectors[10].chg) / 3;
  const spread = top3 - btm3;
  const reasonData = buildReasonsAndBlockers(d, decision, spread);

  const summary = decision === 'YES'
    ? 'Conditions support new risk better than average.'
    : decision === 'CAUTION'
      ? 'Mixed environment. Selective risk only.'
      : 'Conditions are not supportive for clean new swing exposure.';

  const guidance = decision === 'YES'
    ? 'Favor strongest leadership and clean structure.'
    : decision === 'CAUTION'
      ? 'Smaller size, tighter standards, no forcing.'
      : 'Avoid pressing new swing risk until trend and participation improve.';

  return {
    modelVersion: MODEL_VERSION,
    categoryScores: { volatility, trend, breadth, momentum, macro },
    weightedScore,
    decision,
    vetoFlags,
    topReasons: reasonData.topReasons,
    blockers: reasonData.blockers,
    summary,
    guidance
  };
}

module.exports = { buildMarketScore, estimateVixPercentile };
