const { normalizeJournalEntry, getJournal, saveJournal } = require('./store');

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
  const yes = entries.filter(j => j.decision === 'YES' && typeof j.outcome5d === 'number');
  const caution = entries.filter(j => j.decision === 'CAUTION' && typeof j.outcome5d === 'number');
  const no = entries.filter(j => j.decision === 'NO' && typeof j.outcome5d === 'number');
  const yesAvg5d = avg(yes.map(j => j.outcome5d).filter(v => typeof v === 'number'));
  const noAvg5d = avg(no.map(j => j.outcome5d).filter(v => typeof v === 'number'));
  const cautionAvg5d = avg(caution.map(j => j.outcome5d).filter(v => typeof v === 'number'));
  const evaluated = entries.filter(j => typeof j.outcome5d === 'number').length;
  const proxyCount = entries.filter(j => j.breadthMode === 'proxy').length;

  return {
    evaluatedSamples: evaluated,
    sampleQuality: evaluated >= 100 ? 'better' : evaluated >= 40 ? 'thin' : 'very_thin',
    forwardEdge5d: yesAvg5d != null && noAvg5d != null ? Math.round((yesAvg5d - noAvg5d) * 100) / 100 : null,
    cautionAvg5d,
    warnings: [
      evaluated < 40 ? 'small forward sample size' : null,
      proxyCount > 0 ? 'journal contains proxy breadth periods' : null,
      yes.length < 10 ? 'YES bucket still thin' : null,
      no.length < 10 ? 'NO bucket still thin' : null
    ].filter(Boolean)
  };
}

async function backfillJournalOutcomes(fetchYahooHistory) {
  const journal = getJournal().map(normalizeJournalEntry);
  if (!journal.length) return journal;
  const closes = await fetchYahooHistory('SPY', 260);
  if (!closes || closes.length < 15) return journal;

  let changed = false;
  let cursor = 0;
  for (const j of journal) {
    if (!Number.isFinite(j.spyEntry) || (j.outcome1d != null && j.outcome5d != null && j.outcome10d != null)) continue;
    let entryIdx = -1;
    let bestDiff = Infinity;
    for (let k = cursor; k < closes.length; k++) {
      const diff = Math.abs(closes[k] - j.spyEntry) / j.spyEntry;
      if (diff < bestDiff) {
        bestDiff = diff;
        entryIdx = k;
      }
      if (diff < 0.003) break;
    }
    if (entryIdx === -1 || bestDiff > 0.015) continue;
    const calcRet = offset => !closes[entryIdx + offset] ? null : Math.round((((closes[entryIdx + offset] - j.spyEntry) / j.spyEntry) * 100) * 100) / 100;
    j.outcome1d = calcRet(1);
    j.outcome5d = calcRet(5);
    j.outcome10d = calcRet(10);
    j.spyExit = closes[entryIdx + 1] ? Math.round(closes[entryIdx + 1] * 100) / 100 : null;
    j.matchedCloseIndex = entryIdx;
    cursor = Math.max(cursor, entryIdx);
    changed = true;
  }
  if (changed) {
    const store = require('./store');
    store.getJournal().splice(0, store.getJournal().length, ...journal);
    await saveJournal();
  }
  return journal;
}

function buildBacktestSummary() {
  const normalized = getJournal().map(normalizeJournalEntry);
  const yes = normalized.filter(j => j.decision === 'YES');
  const caution = normalized.filter(j => j.decision === 'CAUTION');
  const no = normalized.filter(j => j.decision === 'NO');
  return {
    updatedAt: new Date().toISOString(),
    totalEntries: normalized.length,
    confidenceBuckets: summarizeConfidenceBuckets(normalized),
    validation: buildValidationReport(normalized),
    buckets: {
      YES: summarizeDecisionBucket(yes),
      CAUTION: summarizeDecisionBucket(caution),
      NO: summarizeDecisionBucket(no)
    },
    recent: normalized.slice(-10)
  };
}

module.exports = { backfillJournalOutcomes, buildBacktestSummary, summarizeDecisionBucket, summarizeConfidenceBuckets, buildValidationReport };
