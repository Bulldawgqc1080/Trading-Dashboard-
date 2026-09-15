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
  function economics(p, option, dte) {
    const qty = number(p.contracts), shares = qty * 100, strike = number(option.strike), spot = number(p.spot);
    const cashRequired = strike * shares;
    const netPremium = (number(option.bid) * 100 - number(p.fee)) * qty;
    const effectivePrice = strike - netPremium / shares;
    const putPnl = end => netPremium - Math.max(strike - end, 0) * shares;
    return {
      shares, cashRequired, netPremium, effectivePrice,
      maxProfit: netPremium,
      maxLoss: cashRequired - netPremium,
      premiumYieldPct: netPremium / cashRequired * 100,
      annualizedPremiumYieldPct: netPremium / cashRequired * 100 * 365 / dte,
      discountToSpotPct: (spot - effectivePrice) / spot * 100,
      scenarios: [0.5, 0.8, 1, 1.2, 1.5].map(f => {
        const price = spot * f;
        const put = putPnl(price);
        const buyNow = (price - spot) * shares;
        return { price, put, buyNow, difference: put - buyNow };
      })
    };
  }
  function evaluate(p, puts, now = Date.now()) {
    const errors = [];
    for (const [key, label] of [['cash','Cash available'], ['committedCash','Cash already committed']]) {
      if (!nonnegative(p[key])) errors.push(`${label} must be zero or greater.`);
    }
    for (const [key, label] of [['spot','Stock price'], ['maxStrike','Maximum willing purchase price']]) {
      if (!positive(p[key])) errors.push(`${label} must be greater than zero.`);
    }
    if (!whole(p.contracts) || number(p.contracts) < 1) errors.push('Enter a positive whole number of contracts.');
    if (!nonnegative(p.fee) || !nonnegative(p.minPremium)) errors.push('Fees and minimum net premium must be zero or greater.');
    if (!whole(p.minDte) || !whole(p.maxDte) || number(p.minDte) < 1 || number(p.maxDte) < number(p.minDte)) errors.push('Use an expiration range of at least 1 day, with maximum ≥ minimum.');
    if (!positive(p.maxSpread) || number(p.maxSpread) > 100 || !whole(p.minOi)) errors.push('Spread limit must be 0–100% (above zero); open interest must be a nonnegative whole number.');
    if (number(p.committedCash) > number(p.cash)) errors.push('Committed cash exceeds available cash.');
    if (p.standard !== true) errors.push('Confirm these are standard puts representing 100 shares each, not adjusted contracts.');
    if (!String(p.source || '').trim()) errors.push('Name the broker or source of the quotes.');
    if (String(p.marketStatus || '').toUpperCase() !== 'MARKET OPEN') errors.push(`Market status is ${String(p.marketStatus || 'UNKNOWN').toUpperCase()}. Closed-market and unknown-status quotes are planning-only.`);
    const entryLabel = String(p.entryLabel || 'UNKNOWN').toUpperCase();
    if (p.requireEligible === true && !['FAVORABLE','CAUTION'].includes(entryLabel)) errors.push(`Stock entry posture is ${entryLabel}; this desk requires FAVORABLE or CAUTION unless you deliberately override it.`);
    const eventDate = String(p.eventDate || '').trim();
    const eventTime = eventDate ? dateOnly(eventDate) : NaN;
    if (eventDate && !Number.isFinite(eventTime)) errors.push('Known earnings/company-event date must be a valid calendar date.');
    const age = (now - Date.parse(p.asOf)) / 60000;
    if (!Number.isFinite(age) || age < 0) errors.push('Enter a valid quote timestamp that is not in the future.');
    else if (age > 20) errors.push('Quotes are older than 20 minutes. Refresh both stock and option quotes before qualifying a candidate.');
    const today = dateOnly(nyDate(now));
    const availableCash = Math.max(0, number(p.cash) - number(p.committedCash));
    const rows = puts.map(option => {
      const reasons = [...errors];
      if (option.quoteAsOf) {
        const optionAge = (now - Date.parse(option.quoteAsOf)) / 60000;
        if (!Number.isFinite(optionAge) || optionAge < 0) reasons.push('Option quote timestamp is invalid or in the future.');
        else if (optionAge > 20) reasons.push('This option quote is older than 20 minutes.');
      }
      const dte = (dateOnly(option.expiration) - today) / day;
      const crossesEvent = Number.isFinite(eventTime) && Number.isFinite(dateOnly(option.expiration)) && dateOnly(option.expiration) >= eventTime;
      if (!Number.isFinite(dte) || dte < 1) reasons.push('Expiration must be a future calendar date; same-day puts are excluded.');
      else if (dte < number(p.minDte) || dte > number(p.maxDte)) reasons.push('Expiration is outside your day range.');
      if (!positive(option.strike)) reasons.push('Strike must be greater than zero.');
      else if (number(option.strike) > number(p.maxStrike)) reasons.push('Strike is above your maximum acceptable purchase price. Premium does not override this limit.');
      const validQuote = positive(option.bid) && positive(option.ask) && number(option.ask) >= number(option.bid);
      if (!validQuote) reasons.push('Need a positive bid and ask, with ask ≥ bid.');
      const spread = validQuote ? (number(option.ask) - number(option.bid)) / ((number(option.ask) + number(option.bid)) / 2) * 100 : null;
      if (spread != null && spread > number(p.maxSpread)) reasons.push('Bid/ask spread exceeds your limit.');
      if (!whole(option.oi) || number(option.oi) < number(p.minOi)) reasons.push('Open interest is missing or below your minimum.');
      const canCalculate = validQuote && positive(option.strike) && positive(p.spot) && whole(p.contracts) && number(p.contracts) > 0 && nonnegative(p.fee) && Number.isFinite(dte) && dte > 0;
      const metrics = canCalculate ? economics(p, option, dte) : null;
      if (metrics && metrics.cashRequired > availableCash) reasons.push(`This put requires more cash than the ${availableCash.toLocaleString('en-US', {style:'currency',currency:'USD'})} currently available.`);
      if (metrics && (metrics.netPremium <= 0 || metrics.netPremium < number(p.minPremium))) reasons.push('Net premium is nonpositive or below your minimum.');
      if (crossesEvent && p.avoidEvent === true) reasons.push(`Expiration is on or after the known ${eventDate} earnings/company-event date.`);
      return { ...option, dte, spread, metrics, eventRisk:{date:eventDate || null,crosses:crossesEvent,source:p.eventSource || null,estimated:p.eventEstimated === true}, reasons, eligible:reasons.length === 0 };
    });
    return { errors, availableCash, rows, eligibleCount:rows.filter(x => x.eligible).length };
  }
  function rangeScore(values, value) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length || !Number.isFinite(value)) return 0;
    const min = Math.min(...valid), max = Math.max(...valid);
    return max === min ? 50 : clamp((value - min) / (max - min) * 100);
  }
  function fitScore(value, target, width) { return Number.isFinite(value) ? clamp(100 - Math.abs(value - target) / width * 100) : 0; }
  function liquidityScore(option, p) {
    const spreadLimit = Math.max(.01, number(p.maxSpread));
    const spread = Number.isFinite(option.spread) ? clamp(100 - option.spread / spreadLimit * 100) : 0;
    const oiFloor = Math.max(1, number(p.minOi));
    const oi = Number.isFinite(number(option.oi)) ? clamp(50 + Math.log10(Math.max(1, number(option.oi) / oiFloor)) * 25) : 0;
    const volume = Number.isFinite(number(option.volume)) ? clamp(50 + Math.log10(Math.max(1, number(option.volume) / 100)) * 25) : 50;
    return spread * .6 + oi * .3 + volume * .1;
  }
  function rankCandidates(evaluation, p) {
    const eligible = evaluation.rows.filter(option => option.eligible && option.metrics && Number.isFinite(number(option.delta)) && Math.abs(number(option.delta)) <= 1);
    if (!eligible.length) return {status:'unavailable',reason:evaluation.eligibleCount ? 'Eligible puts lack usable delta data.' : 'No puts passed the hard filters.',profiles:[]};
    const yields = eligible.map(option => option.metrics.annualizedPremiumYieldPct);
    const discounts = eligible.map(option => option.metrics.discountToSpotPct);
    const definitions = [
      {id:'conservative',label:'Conservative',targetDelta:.15,targetDte:30,weights:{delta:35,discount:25,liquidity:20,yield:10,dte:10}},
      {id:'balanced',label:'Balanced',targetDelta:.25,targetDte:30,weights:{delta:30,discount:20,liquidity:15,yield:25,dte:10}},
      {id:'income',label:'Income focused',targetDelta:.35,targetDte:21,weights:{delta:25,discount:10,liquidity:20,yield:35,dte:10}}
    ];
    const entryLabel = String(p.entryLabel || 'UNKNOWN').toUpperCase();
    const entryPenalty = entryLabel === 'CAUTION' ? 12 : entryLabel === 'FAVORABLE' ? 0 : 30;
    const profiles = definitions.map(profile => {
      const scored = eligible.map(option => {
        const components = {
          delta:fitScore(Math.abs(number(option.delta)),profile.targetDelta,.25),
          discount:rangeScore(discounts,option.metrics.discountToSpotPct),
          liquidity:liquidityScore(option,p),
          yield:rangeScore(yields,option.metrics.annualizedPremiumYieldPct),
          dte:fitScore(option.dte,profile.targetDte,30)
        };
        const eventPenalty = option.eventRisk?.crosses ? 25 : 0;
        const score = Object.entries(profile.weights).reduce((sum,[key,weight]) => sum + components[key] * weight / 100,0) - eventPenalty - entryPenalty;
        return {...option,decisionScore:Math.round(clamp(score)),eventPenalty,entryPenalty,scoreComponents:components};
      }).sort((a,b) => b.decisionScore-a.decisionScore || b.scoreComponents.liquidity-a.scoreComponents.liquidity || a.dte-b.dte || b.strike-a.strike);
      return {...profile,winner:scored[0]};
    });
    return {status:'ok',reason:null,profiles};
  }
  function closePaper(entry, putBuyback, closingFee) {
    if (!nonnegative(putBuyback) || !nonnegative(closingFee)) throw new Error('Buyback price and closing fee must be zero or greater.');
    const qty = number(entry.position.contracts);
    const optionPnl = entry.metrics.netPremium - (number(putBuyback) * 100 + number(closingFee)) * qty;
    return {optionPnl,totalPnl:optionPnl};
  }
  function assignPaper(entry, stockPrice) {
    if (!nonnegative(stockPrice)) throw new Error('Assignment stock price must be zero or greater.');
    const shares = number(entry.position.contracts) * 100;
    const acquisitionCost = number(entry.put.strike) * shares;
    const markedPnl = (number(stockPrice) - number(entry.put.strike)) * shares + entry.metrics.netPremium;
    return {shares,acquisitionCost,effectivePrice:entry.metrics.effectivePrice,stockPrice:number(stockPrice),markedPnl};
  }
  const api = {evaluate,economics,rankCandidates,closePaper,assignPaper};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CashSecuredPut = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
