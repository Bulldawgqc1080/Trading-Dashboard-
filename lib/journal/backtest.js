const { normalizeJournalEntry, getJournal, replaceJournal, saveJournal } = require('./store');
const { MODEL_VERSION } = require('../config');

function avg(vals) {
  return vals.length ? Math.round((vals.reduce((a,b) => a+b, 0) / vals.length) * 100) / 100 : null;
}

function winRate(vals) {
  return vals.length ? Math.round((vals.filter(v => v > 0).length / vals.length) * 100) : null;
}

function summarizeDecisionBucket(entries) {
  const nums = (arr, key) => arr.map(x => x[key]).filter(v => typeof v === 'number');
  const o1 = nums(entries, 'outcome1d');
  const o5 = nums(entries, 'outcome5d');
  const o10 = nums(entries, 'outcome10d');
  return {
    count: entries.length,
    avg1d: avg(o1), avg5d: avg(o5), avg10d: avg(o10),
    winRate1d: winRate(o1), winRate5d: winRate(o5), winRate10d: winRate(o10)
  };
}

function summarizeConfidenceBuckets(entries) {
  const buckets = { HIGH: [], MEDIUM: [], LOW: [] };
  entries.forEach(entry => {
    const label = entry.confidenceLabel || (entry.confidenceScore >= 80 ? 'HIGH' : entry.confidenceScore >= 55 ? 'MEDIUM' : 'LOW');
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(entry);
  });
  return Object.fromEntries(Object.entries(buckets).map(([key, vals]) => [key, summarizeDecisionBucket(vals)]));
}

function buildValidationReport(entries) {
  const verified = entries.filter(j => j.modelVersion === MODEL_VERSION && j.outcomeMethod === 'trading-date-v1' && j.validationEligible === true);
  const yes = verified.filter(j => j.decision === 'YES' && typeof j.outcome5d === 'number');
  const caution = verified.filter(j => j.decision === 'CAUTION' && typeof j.outcome5d === 'number');
  const no = verified.filter(j => j.decision === 'NO' && typeof j.outcome5d === 'number');
  const yesAvg5d = avg(yes.map(j => j.outcome5d).filter(v => typeof v === 'number'));
  const noAvg5d = avg(no.map(j => j.outcome5d).filter(v => typeof v === 'number'));
  const cautionAvg5d = avg(caution.map(j => j.outcome5d).filter(v => typeof v === 'number'));
  const evaluated = verified.filter(j => typeof j.outcome5d === 'number').length;
  const proxyCount = verified.filter(j => j.breadthMode === 'proxy').length;

  return {
    evaluatedSamples: evaluated,
    sampleQuality: evaluated >= 100 ? 'better' : evaluated >= 40 ? 'thin' : 'very_thin',
    forwardEdge5d: yes.length >= 10 && no.length >= 10 && yesAvg5d != null && noAvg5d != null ? Math.round((yesAvg5d - noAvg5d) * 100) / 100 : null,
    cautionAvg5d: caution.length >= 10 ? cautionAvg5d : null,
    warnings: [
      evaluated < 40 ? 'small forward sample size' : null,
      proxyCount > 0 ? 'journal contains proxy breadth periods' : null,
      `performance uses current ${MODEL_VERSION} records only`,
      'outcomes use exact trading dates; closed-market snapshots are excluded',
      yes.length < 10 ? 'YES bucket still thin' : null,
      no.length < 10 ? 'NO bucket still thin' : null
    ].filter(Boolean)
  };
}

async function backfillJournalOutcomes(fetchYahooSeries) {
  const journal = getJournal().map(normalizeJournalEntry);
  if (!journal.length) return journal;
  const series = await fetchYahooSeries('SPY', 500);
  if (!series || series.length < 15) return journal;

  let changed = false;
  for (const j of journal) {
    const eligible = j.marketStatus === 'MARKET OPEN' && Number.isFinite(j.spyEntry);
    const entryIdx = eligible ? series.findIndex(row => row.date === j.date) : -1;
    const calcRet = offset => entryIdx < 0 || !series[entryIdx + offset] ? null : Math.round((((series[entryIdx + offset].close - j.spyEntry) / j.spyEntry) * 100) * 100) / 100;
    const next = {
      validationEligible: eligible && entryIdx >= 0,
      outcomeMethod: 'trading-date-v1',
      matchedCloseIndex: entryIdx >= 0 ? entryIdx : null,
      spyExit: entryIdx >= 0 && series[entryIdx + 1] ? Math.round(series[entryIdx + 1].close * 100) / 100 : null,
      outcome1d: calcRet(1), outcome5d: calcRet(5), outcome10d: calcRet(10)
    };
    if (Object.entries(next).some(([key,value]) => j[key] !== value)) changed = true;
    Object.assign(j, next);
  }
  if (changed) {
    replaceJournal(journal);
    await saveJournal();
  }
  return journal;
}

function buildBacktestSummary() {
  const normalized = getJournal().map(normalizeJournalEntry);
  const verified = normalized.filter(j => j.modelVersion === MODEL_VERSION && j.outcomeMethod === 'trading-date-v1' && j.validationEligible === true);
  const yes = verified.filter(j => j.decision === 'YES');
  const caution = verified.filter(j => j.decision === 'CAUTION');
  const no = verified.filter(j => j.decision === 'NO');
  const publishable = entries => entries.length >= 10 ? summarizeDecisionBucket(entries) : { count:entries.length, avg1d:null, avg5d:null, avg10d:null, winRate1d:null, winRate5d:null, winRate10d:null };
  return {
    updatedAt: new Date().toISOString(),
    totalEntries: normalized.length,
    confidenceBuckets: summarizeConfidenceBuckets(verified),
    validation: buildValidationReport(normalized),
    buckets: {
      YES: publishable(yes),
      CAUTION: publishable(caution),
      NO: publishable(no)
    },
    recent: normalized.slice(-10)
  };
}

module.exports = { backfillJournalOutcomes, buildBacktestSummary, summarizeDecisionBucket, summarizeConfidenceBuckets, buildValidationReport };
