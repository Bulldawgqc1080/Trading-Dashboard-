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
    date: j.date,
    ts: j.ts || Date.now(),
    modelVersion: j.modelVersion || 'market-v1',
    decision: j.decision ?? null,
    score: j.score ?? null,
    confidenceScore: j.confidenceScore ?? null,
    status: j.status ?? 'ok',
    spyEntry: j.spyEntry ?? null,
    qqqEntry: j.qqqEntry ?? null,
    vixEntry: j.vixEntry ?? null,
    breadthMode: j.breadthMode ?? null,
    topReasons: j.topReasons ?? [],
    blockers: j.blockers ?? [],
    dataQuality: j.dataQuality ?? null,
    inputsSnapshot: j.inputsSnapshot ?? {},
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
  const today = new Date().toISOString().split('T')[0];
  await loadJournal();
  const existing = journal.find(j => j.date === today);
  const normalized = normalizeJournalEntry({ date: today, ...entry });
  if (existing) Object.assign(existing, normalized);
  else journal.push(normalized);
  if (journal.length > 180) journal = journal.slice(-180);
  await saveJournal();
  return journal;
}

function getJournal() {
  return journal.map(normalizeJournalEntry);
}

module.exports = { loadJournal, saveJournal, logJournalEntry, getJournal, normalizeJournalEntry };
