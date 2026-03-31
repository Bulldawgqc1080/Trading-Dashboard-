function calcSMA(data, period) {
  if (!data || data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return Math.round(ema * 100) / 100;
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

function calcSlope(arr, n = 5) {
  const slice = arr.slice(-n);
  if (slice.length < 2) return 0;
  return Math.round(((slice[slice.length - 1] - slice[0]) / slice[0]) * 1000) / 10;
}

function calcTrend(closes, shortN, longN) {
  if (!closes || closes.length < longN) return 'flat';
  const shortAvg = closes.slice(-shortN).reduce((a,b) => a+b, 0) / shortN;
  const longAvg = closes.slice(-longN).reduce((a,b) => a+b, 0) / longN;
  const pctDiff = ((shortAvg - longAvg) / longAvg) * 100;
  if (pctDiff > 0.3) return 'rising';
  if (pctDiff < -0.3) return 'falling';
  return 'flat';
}

module.exports = { calcSMA, calcEMA, calcRSI, calcSlope, calcTrend };
