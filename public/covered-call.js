(function (root) {
  'use strict';
  const number = x => x === '' || x == null || typeof x === 'boolean' ? NaN : Number(x);
  const finite = x => Number.isFinite(number(x));
  const positive = x => finite(x) && number(x) > 0;
  const nonnegative = x => finite(x) && number(x) >= 0;
  const whole = x => nonnegative(x) && Number.isInteger(number(x));
  const day = 86400000;
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
  function dateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
    const t = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value ? t : NaN;
  }
  function nyDate(now) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function economics(p, c) {
    const qty = number(p.contracts), shares = qty * 100;
    const netPremium = (number(c.bid) * 100 - number(p.fee)) * qty;
    const spot = number(p.spot), cost = number(p.cost), strike = number(c.strike);
    const pnl = (end, basis) => (Math.min(end, strike) - basis) * shares + netPremium;
    return {
      shares, netPremium, breakevenCost: cost - netPremium / shares,
      maxPnlCost: pnl(strike, cost), maxPnlNow: pnl(strike, spot),
      lossAtZeroNow: spot * shares - netPremium,
      scenarios: [0.5, 0.8, 1, 1.2, 1.5].map(f => {
        const price = spot * f;
        const hold = (price - spot) * shares;
        const covered = pnl(price, spot);
        return { price, hold, covered, difference: covered - hold };
      })
    };
  }
  function evaluate(p, calls, now = Date.now()) {
    const errors = [];
    for (const [key, label] of [['shares','Owned shares'], ['reserved','Already committed shares']]) {
      if (!whole(p[key])) errors.push(`${label} must be a nonnegative whole number.`);
    }
    for (const [key, label] of [['cost','Cost basis'], ['spot','Stock price'], ['minStrike','Minimum sale price']]) {
      if (!positive(p[key])) errors.push(`${label} must be greater than zero.`);
    }
    if (!whole(p.contracts) || number(p.contracts) < 1) errors.push('Enter a positive whole number of contracts.');
    if (!nonnegative(p.fee) || !nonnegative(p.minPremium)) errors.push('Fees and minimum net premium must be zero or greater.');
    if (!whole(p.minDte) || !whole(p.maxDte) || number(p.minDte) < 1 || number(p.maxDte) < number(p.minDte)) errors.push('Use an expiration range of at least 1 day, with maximum ≥ minimum.');
    if (!positive(p.maxSpread) || number(p.maxSpread) > 100 || !whole(p.minOi)) errors.push('Spread limit must be 0–100% (above zero); open interest must be a nonnegative whole number.');
    if (number(p.reserved) > number(p.shares)) errors.push('Committed shares exceed owned shares.');
    const capacity = Math.max(0, Math.floor((number(p.shares) - number(p.reserved)) / 100));
    if (number(p.contracts) > capacity) errors.push(`Only ${capacity} covered contract(s) available. Never sell uncovered calls here.`);
    if (p.standard !== true) errors.push('Confirm these are standard calls delivering 100 shares each, not adjusted contracts.');
    if (!String(p.source || '').trim()) errors.push('Name the broker or source of the quotes.');
    const age = (now - Date.parse(p.asOf)) / 60000;
    if (!Number.isFinite(age) || age < 0) errors.push('Enter a valid quote timestamp that is not in the future.');
    else if (age > 20) errors.push('Quotes are older than 20 minutes. Refresh both stock and option quotes before qualifying a candidate.');
    const today = dateOnly(nyDate(now));
    const rows = calls.map(c => {
      const reasons = [...errors];
      if (c.quoteAsOf) {
        const optionAge = (now - Date.parse(c.quoteAsOf)) / 60000;
        if (!Number.isFinite(optionAge) || optionAge < 0) reasons.push('Option quote timestamp is invalid or in the future.');
        else if (optionAge > 20) reasons.push('This option quote is older than 20 minutes.');
      }
      const dte = (dateOnly(c.expiration) - today) / day;
      if (!Number.isFinite(dte) || dte < 1) reasons.push('Expiration must be a future calendar date; same-day calls are excluded.');
      else if (dte < number(p.minDte) || dte > number(p.maxDte)) reasons.push('Expiration is outside your day range.');
      if (!positive(c.strike)) reasons.push('Strike must be greater than zero.');
      else if (number(c.strike) < number(p.minStrike)) reasons.push('Strike is below your minimum acceptable sale price.');
      const validQuote = positive(c.bid) && positive(c.ask) && number(c.ask) >= number(c.bid);
      if (!validQuote) reasons.push('Need a positive bid and ask, with ask ≥ bid.');
      const spread = validQuote ? (number(c.ask) - number(c.bid)) / ((number(c.ask) + number(c.bid)) / 2) * 100 : null;
      if (spread != null && spread > number(p.maxSpread)) reasons.push('Bid/ask spread exceeds your limit.');
      if (!whole(c.oi) || number(c.oi) < number(p.minOi)) reasons.push('Open interest is missing or below your minimum.');
      const canCalculate = validQuote && positive(c.strike) && positive(p.cost) && positive(p.spot) && whole(p.contracts) && number(p.contracts) > 0 && nonnegative(p.fee);
      const metrics = canCalculate ? economics(p, c) : null;
      if (metrics && Number.isFinite(dte) && dte > 0) {
        metrics.premiumYieldPct = metrics.netPremium / (number(p.spot) * metrics.shares) * 100;
        metrics.annualizedPremiumYieldPct = metrics.premiumYieldPct * 365 / dte;
        metrics.upsideCushionPct = (number(c.strike) / number(p.spot) - 1) * 100;
        metrics.returnIfAssignedPct = metrics.maxPnlCost / (number(p.cost) * metrics.shares) * 100;
      }
      if (metrics && (metrics.netPremium <= 0 || metrics.netPremium < number(p.minPremium))) reasons.push('Net premium is nonpositive or below your minimum.');
      return { ...c, dte, spread, metrics, reasons, eligible: reasons.length === 0 };
    });
    return { errors, capacity, rows, eligibleCount: rows.filter(x => x.eligible).length };
  }
  function rangeScore(values, value) {
    const finiteValues = values.filter(Number.isFinite);
    if (!finiteValues.length || !Number.isFinite(value)) return 0;
    const min = Math.min(...finiteValues), max = Math.max(...finiteValues);
    return max === min ? 50 : clamp((value - min) / (max - min) * 100);
  }
  function fitScore(value, target, width) {
    return Number.isFinite(value) ? clamp(100 - Math.abs(value - target) / width * 100) : 0;
  }
  function liquidityScore(call, p) {
    const spreadLimit = Math.max(0.01, number(p.maxSpread));
    const spread = Number.isFinite(call.spread) ? clamp(100 - call.spread / spreadLimit * 100) : 0;
    const oiFloor = Math.max(1, number(p.minOi));
    const oi = Number.isFinite(number(call.oi)) ? clamp(50 + Math.log10(Math.max(1, number(call.oi) / oiFloor)) * 25) : 0;
    const volume = Number.isFinite(number(call.volume)) ? clamp(50 + Math.log10(Math.max(1, number(call.volume) / 100)) * 25) : 50;
    return spread * .6 + oi * .3 + volume * .1;
  }
  function rankCandidates(evaluation, p) {
    const eligible = evaluation.rows.filter(call => call.eligible && call.metrics && Number.isFinite(number(call.delta)) && Math.abs(number(call.delta)) <= 1);
    if (!eligible.length) return { status:'unavailable', reason: evaluation.eligibleCount ? 'Eligible calls lack usable delta data.' : 'No calls passed the hard filters.', profiles:[] };
    const yields = eligible.map(call => call.metrics.annualizedPremiumYieldPct);
    const cushions = eligible.map(call => call.metrics.upsideCushionPct);
    const definitions = [
      {id:'conservative',label:'Conservative',targetDelta:.15,targetDte:30,weights:{delta:35,cushion:30,liquidity:20,yield:10,dte:5}},
      {id:'balanced',label:'Balanced',targetDelta:.25,targetDte:30,weights:{delta:30,cushion:20,liquidity:15,yield:25,dte:10}},
      {id:'income',label:'Income focused',targetDelta:.35,targetDte:21,weights:{delta:25,cushion:10,liquidity:20,yield:35,dte:10}}
    ];
    const profiles = definitions.map(profile => {
      const scored = eligible.map(call => {
        const components = {
          delta: fitScore(Math.abs(number(call.delta)), profile.targetDelta, .25),
          cushion: rangeScore(cushions, call.metrics.upsideCushionPct),
          liquidity: liquidityScore(call, p),
          yield: rangeScore(yields, call.metrics.annualizedPremiumYieldPct),
          dte: fitScore(call.dte, profile.targetDte, 30)
        };
        const score = Object.entries(profile.weights).reduce((sum,[key,weight]) => sum + components[key] * weight / 100, 0);
        return {...call, decisionScore:Math.round(score), scoreComponents:components};
      }).sort((a,b) => b.decisionScore - a.decisionScore || b.scoreComponents.liquidity - a.scoreComponents.liquidity || a.dte - b.dte || a.strike - b.strike);
      return {...profile,winner:scored[0]};
    });
    return { status:'ok', reason:null, profiles };
  }
  function closePaper(entry, stockPrice, callBuyback, closingFee) {
    if (!nonnegative(stockPrice) || !nonnegative(callBuyback) || !nonnegative(closingFee)) throw new Error('All closing prices and fees must be zero or greater.');
    const p = entry.position;
    const shares = number(p.contracts) * 100;
    const optionPnl = entry.metrics.netPremium - (number(callBuyback) * 100 + number(closingFee)) * number(p.contracts);
    const stockPnl = (number(stockPrice) - number(p.spot)) * shares;
    return { optionPnl, stockPnl, totalPnl: stockPnl + optionPnl, holdPnl: stockPnl, advantage: optionPnl,
      totalPnlCost: (number(stockPrice) - number(p.cost)) * shares + optionPnl };
  }
  const api = { evaluate, economics, rankCandidates, closePaper };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoveredCall = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
