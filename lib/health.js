const { STALE_THRESHOLD, CRITICAL_FEEDS } = require('./config');

function getFeedQuality(feedHealth = {}) {
  const now = Date.now();
  const errors = Object.entries(feedHealth).filter(([, v]) => v.status === 'error');
  const stale = Object.entries(feedHealth).filter(([, v]) => v.status === 'ok' && (now - v.ts) > STALE_THRESHOLD);
  const criticalDown = CRITICAL_FEEDS.filter(f => feedHealth[f] && feedHealth[f].status === 'error');

  if (criticalDown.length > 0) {
    return { quality: 'bad', label: 'DATA QUALITY: BAD', errors: errors.map(([k]) => k), stale: stale.map(([k]) => k), criticalDown };
  }
  if (errors.length > 2 || stale.length > 3) {
    return { quality: 'degraded', label: 'DATA QUALITY: DEGRADED', errors: errors.map(([k]) => k), stale: stale.map(([k]) => k), criticalDown: [] };
  }
  if (stale.length > 0) {
    return { quality: 'stale', label: 'SOME FEEDS STALE', errors: [], stale: stale.map(([k]) => k), criticalDown: [] };
  }
  return { quality: 'good', label: 'ALL FEEDS OK', errors: [], stale: [], criticalDown: [] };
}

function buildSystemStatus({ marketData, feedQuality }) {
  const missingCritical = [];
  if (!marketData?.spy?.price) missingCritical.push('SPY');
  if (!marketData?.qqq?.price) missingCritical.push('QQQ');
  if (!marketData?.vixLevel) missingCritical.push('VIX');

  if (missingCritical.length || feedQuality.quality === 'bad') {
    return {
      status: 'unavailable',
      missingCritical,
      suppressDecision: true,
      reason: missingCritical.length ? `Missing critical feeds: ${missingCritical.join(', ')}` : 'Critical feed integrity failure'
    };
  }

  if (feedQuality.quality === 'degraded' || feedQuality.quality === 'stale') {
    return {
      status: 'degraded',
      missingCritical,
      suppressDecision: false,
      reason: 'Data integrity reduced'
    };
  }

  return {
    status: 'ok',
    missingCritical,
    suppressDecision: false,
    reason: 'System healthy'
  };
}

module.exports = { getFeedQuality, buildSystemStatus };
