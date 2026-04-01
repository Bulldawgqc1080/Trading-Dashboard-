const { normalizeJournalEntry, getJournal, saveJournal } = require('./store');

function summarizeDecisionBucket(entries) {
  const nums = (arr, key) => arr.map(x => x[key]).filter(v => typeof v === 'number');
  const avg = vals => vals.length ? Math.round((vals.reduce((a,b) => a+b, 0) / vals.length) * 100) / 100 : null;
  const winRate = vals => vals.length ? Math.round((vals.filter(v => v > 0).length / vals.length) * 100) : null;
  const o1 = nums(entries, 'outcome1d');
  const o5 = nums(entries, 'outcome5d');
  const o10 = nums(entries, 'outcome10d');
  return {
    count: entries.length,
    avg1d: avg(o1), avg5d: avg(o5), avg10d: avg(o10),
    winRate1d: winRate(o1), winRate5d: winRate(o5), winRate10d: winRate(o10)
  };
}

async function backfillJournalOutcomes(fetchYahooHistory) {
  const journal = getJournal().map(normalizeJournalEntry);
  if (!journal.length) return journal;
  const closes = await fetchYahooHistory('SPY', 260);
  if (!closes || closes.length < 15) return journal;

  let changed = false;
  for (const j of journal) {
    if (!Number.isFinite(j.spyEntry) || (j.outcome1d != null && j.outcome5d != null && j.outcome10d != null)) continue;
    let entryIdx = -1;
    for (let k = 0; k < closes.length; k++) {
      if (Math.abs(closes[k] - j.spyEntry) / j.spyEntry < 0.003) { entryIdx = k; break; }
    }
    if (entryIdx === -1) continue;
    const calcRet = offset => !closes[entryIdx + offset] ? null : Math.round((((closes[entryIdx + offset] - j.spyEntry) / j.spyEntry) * 100) * 100) / 100;
    j.outcome1d = calcRet(1);
    j.outcome5d = calcRet(5);
    j.outcome10d = calcRet(10);
    j.spyExit = closes[entryIdx + 1] ? Math.round(closes[entryIdx + 1] * 100) / 100 : null;
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
    buckets: {
      YES: summarizeDecisionBucket(yes),
      CAUTION: summarizeDecisionBucket(caution),
      NO: summarizeDecisionBucket(no)
    },
    recent: normalized.slice(-10)
  };
}

module.exports = { backfillJournalOutcomes, buildBacktestSummary };
