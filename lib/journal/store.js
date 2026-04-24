const https = require('https');

const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;

let journal = [];

function httpsGetWithAuth(reqUrl, token) {
  return new Promise((resolve, reject) => {
    const opts = new URL(reqUrl);
    const options = { hostname: opts.hostname, path: opts.pathname + opts.search, headers: { Authorization: 'Bearer ' + token } };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('KV timeout')); });
  });
}

async function kvGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await httpsGetWithAuth(UPSTASH_URL + '/get/' + key, UPSTASH_TOKEN);
    return res && res.result ? JSON.parse(res.result) : null;
  } catch (e) { return null; }
}

async function kvSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    await httpsGetWithAuth(UPSTASH_URL + '/set/' + key + '/' + encoded, UPSTASH_TOKEN);
  } catch (e) {}
}

function normalizeJournalEntry(j) {
  return {
    entryKey: j.entryKey || null,
    date: j.date,
    ts: j.ts || Date.now(),
    recordedAt: j.recordedAt || new Date(j.ts || Date.now()).toISOString(),
    modelVersion: j.modelVersion || 'market-v2',
    decision: j.decision ?? null,
    permissionLabel: j.permissionLabel ?? null,
    score: j.score ?? null,
    confidenceScore: j.confidenceScore ?? null,
    confidenceLabel: j.confidenceLabel ?? null,
    status: j.status ?? 'ok',
    marketStatus: j.marketStatus ?? null,
    spyEntry: j.spyEntry ?? null,
    qqqEntry: j.qqqEntry ?? null,
    vixEntry: j.vixEntry ?? null,
    breadthMode: j.breadthMode ?? null,
    topReasons: j.topReasons ?? [],
    blockers: j.blockers ?? [],
    dataQuality: j.dataQuality ?? null,
    validationWarnings: j.validationWarnings ?? [],
    inputsSnapshot: j.inputsSnapshot ?? {},
    matchedCloseIndex: j.matchedCloseIndex ?? null,
    spyExit: j.spyExit ?? null,
    outcome1d: j.outcome1d ?? null,
    outcome5d: j.outcome5d ?? null,
    outcome10d: j.outcome10d ?? null
  };
}

async function loadJournal() {
  const stored = await kvGet('sibt:journal');
  if (stored && Array.isArray(stored)) journal = stored.map(normalizeJournalEntry);
  return journal;
}

async function saveJournal() {
  await kvSet('sibt:journal', journal.map(normalizeJournalEntry));
}

async function logJournalEntry(entry) {
  const now = Date.now();
  const today = new Date(now).toISOString().split('T')[0];
  await loadJournal();
  const normalized = normalizeJournalEntry({
    date: today,
    ts: now,
    recordedAt: new Date(now).toISOString(),
    entryKey: entry.entryKey || `${today}:${entry.marketStatus || 'UNKNOWN'}:${entry.decision || 'NA'}:${Math.round(entry.score ?? -1)}`,
    ...entry
  });

  const recent = [...journal].reverse().find(j => {
    const sameKey = j.entryKey === normalized.entryKey;
    const sameShape = j.date === normalized.date && j.decision === normalized.decision && j.score === normalized.score && j.confidenceScore === normalized.confidenceScore;
    const closeInTime = Math.abs((j.ts || 0) - normalized.ts) < 90 * 60 * 1000;
    return closeInTime && (sameKey || sameShape);
  });

  if (recent) Object.assign(recent, { ...recent, ...normalized });
  else journal.push(normalized);

  journal.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (journal.length > 500) journal = journal.slice(-500);
  await saveJournal();
  return journal;
}

function getJournal() {
  return journal.map(normalizeJournalEntry);
}

module.exports = { loadJournal, saveJournal, logJournalEntry, getJournal, normalizeJournalEntry };
