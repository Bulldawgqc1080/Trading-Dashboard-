function buildConfidence({ marketData, feedQuality, systemStatus }) {
  let score = 100;
  const reasons = [];

  if (marketData?.breadthMode === 'proxy') {
    score -= 15;
    reasons.push('breadth proxy in use');
  }
  if (marketData?.macroMode === 'partial') {
    score -= 10;
    reasons.push('macro model partial');
  }
  if (marketData?.putCallMode === 'unavailable') {
    score -= 10;
    reasons.push('put/call unavailable');
  }
  if ((feedQuality?.stale || []).length > 0) {
    score -= Math.min(25, feedQuality.stale.length * 8);
    reasons.push(`${feedQuality.stale.length} stale feed(s)`);
  }
  if ((feedQuality?.errors || []).length > 0) {
    score -= Math.min(30, feedQuality.errors.length * 10);
    reasons.push(`${feedQuality.errors.length} feed error(s)`);
  }
  if (systemStatus?.status === 'degraded') {
    score -= 10;
    reasons.push('system degraded');
  }
  if (systemStatus?.status === 'unavailable') {
    score = 0;
    reasons.push('system unavailable');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 80 ? 'HIGH' : score >= 55 ? 'MEDIUM' : 'LOW';

  return {
    confidenceScore: score,
    confidenceLabel: label,
    confidenceReasons: reasons
  };
}

module.exports = { buildConfidence };
