const API_URL = '/api/market';
const WATCHLIST_URL = '/api/watchlist';
const BACKTEST_URL = '/api/backtest';
const JOURNAL_URL = '/api/journal';

function scoreColor(s){return s>=70?'var(--green)':s>=45?'var(--amber)':'var(--red)'}
function scoreTone(s){return s>=70?'good':s>=45?'warn':'bad'}
function pill(text, cls){return `<span class="pill ${cls}">${text}</span>`}
function trustTone(score){return score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad'}
function decisionBadgeText(data){
  if (data.status === 'unavailable') return 'No trustworthy read';
  if (data.permissionLabel === 'FAVORABLE') return 'Conditions support active trading';
  if (data.permissionLabel === 'SELECTIVE') return 'Be selective and stay disciplined';
  return 'Patience has the edge right now';
}
function todayCallText(data){
  if (data.status === 'unavailable') return 'Stand down until live market data is healthy again.';
  if (data.permissionLabel === 'FAVORABLE') return 'You can be involved, but still favor clean setups and follow-through.';
  if (data.permissionLabel === 'SELECTIVE') return 'Trade only your best names and avoid forcing mediocre setups.';
  return 'Do less, wait for cleaner conditions, and protect decision quality.';
}

function renderUnavailable(data) {
  document.getElementById('statusBanner').innerHTML = `<div class="banner err">Live market data unavailable — do not use this tool until data integrity is restored. ${data?.systemStatus?.reason || ''}</div>`;
  document.getElementById('decision').textContent = 'UNAVAILABLE';
  document.getElementById('decision').className = 'decision UNAVAILABLE';
  document.getElementById('decisionBadge').textContent = decisionBadgeText({ status: 'unavailable' });
  document.getElementById('decisionBadge').className = 'decision-badge bad';
  document.getElementById('score').textContent = '--';
  document.getElementById('confidence').textContent = '--';
  document.getElementById('todayCall').textContent = todayCallText({ status: 'unavailable' });
  document.getElementById('summary').textContent = 'The system does not currently have enough trustworthy data to issue a market permission read.';
  document.getElementById('guidance').textContent = 'Wait for live market data and healthy critical feeds before using SIBT for decisions.';
  document.getElementById('reasons').innerHTML = '';
  document.getElementById('blockers').innerHTML = pill('critical data unavailable', 'bad');
  document.getElementById('categoryGrid').innerHTML = '';
  document.getElementById('quality').innerHTML = `<div class="kv"><span>Status</span><span class="subtle">UNAVAILABLE</span></div>`;
  document.getElementById('modelTrust').innerHTML = `<div class="kv"><span>Trust level</span><span class="subtle">LOW</span></div><div class="trust-note">The model is intentionally suppressed because critical feeds are unavailable.</div>`;
  document.getElementById('snapshot').innerHTML = '';
}

function decisionDisplay(data) {
  if (data.permissionLabel === 'FAVORABLE') return 'FAVORABLE';
  if (data.permissionLabel === 'SELECTIVE') return 'SELECTIVE';
  return 'LOW PERMISSION';
}

function renderMarket(data) {
  const bannerClass = data.status === 'ok' ? 'ok' : 'warn';
  const bannerText = data.status === 'ok'
    ? 'System healthy — permission read allowed.'
    : `System degraded — use reduced confidence. ${data.systemStatus?.reason || ''}`;
  document.getElementById('statusBanner').innerHTML = `<div class="banner ${bannerClass}">${bannerText}</div>`;
  document.getElementById('decision').textContent = decisionDisplay(data);
  document.getElementById('decision').className = `decision ${data.decision || 'NO'}`;
  document.getElementById('decisionBadge').textContent = decisionBadgeText(data);
  document.getElementById('decisionBadge').className = `decision-badge ${scoreTone(data.score)}`;
  document.getElementById('score').textContent = data.score;
  document.getElementById('score').style.color = scoreColor(data.score);
  document.getElementById('confidence').textContent = `${data.confidenceLabel} (${data.confidenceScore})`;
  document.getElementById('confidence').style.color = scoreColor(data.confidenceScore);
  document.getElementById('todayCall').textContent = todayCallText(data);
  document.getElementById('timestamp').textContent = data.timestamp ? `Updated ${new Date(data.timestamp).toLocaleTimeString()}` : '';
  document.getElementById('summary').textContent = data.summary || '';
  document.getElementById('guidance').textContent = `${data.guidance || ''} ${data.interpretation || ''}`.trim();
  document.getElementById('reasons').innerHTML = (data.topReasons || []).map(r => pill(r, 'good')).join('') || '<span class="muted">—</span>';
  document.getElementById('blockers').innerHTML = (data.blockers || []).map(r => pill(r, 'bad')).join('') || '<span class="muted">—</span>';
  const cats = data.categoryScores || {};
  document.getElementById('categoryGrid').innerHTML = Object.entries(cats).map(([k,v]) => `<div class="card score-row score-row-${scoreTone(v)}"><div class="metric-label">${k.toUpperCase()}</div><div class="score-number" style="color:${scoreColor(v)}">${v}</div><div class="track"><div class="fill" style="width:${v}%;background:${scoreColor(v)}"></div></div></div>`).join('');
  const dq = data.dataQuality || {};
  document.getElementById('quality').innerHTML = `<div class="kv"><span>Quality</span><span>${dq.label || '—'}</span></div><div class="kv"><span>Proxy inputs</span><span class="subtle">${(dq.proxyInputs || []).join(', ') || 'none'}</span></div><div class="kv"><span>Missing inputs</span><span class="subtle">${(dq.missingInputs || []).join(', ') || 'none'}</span></div><div class="kv"><span>Stale feeds</span><span class="subtle">${(dq.staleFeeds || []).join(', ') || 'none'}</span></div><div class="kv"><span>Feed errors</span><span class="subtle">${(dq.errors || []).join(', ') || 'none'}</span></div><div style="margin-top:8px;font-size:10px;color:var(--text3);">This is a market permission tool, not a directional prediction engine.</div>`;
  const warnings = data.validationWarnings || [];
  document.getElementById('modelTrust').innerHTML = `<div class="kv"><span>Confidence</span><span class="trust-label ${trustTone(data.confidenceScore)}">${data.confidenceLabel} (${data.confidenceScore})</span></div><div class="kv"><span>Model version</span><span class="subtle">${data.modelVersion || '—'}</span></div><div class="kv"><span>Warnings</span><span class="subtle">${warnings.length}</span></div><div class="trust-list">${warnings.length ? warnings.map(w => pill(w, 'warn')).join('') : pill('no active trust warnings', 'good')}</div><div class="trust-note">Trust the read more when data is direct, current, and validated by enough samples.</div>`;
  const m = data.market || {};
  document.getElementById('snapshot').innerHTML = `<div class="kv"><span>SPY</span><span>${m.spy?.price ?? '—'} (${m.spy?.chg ?? '—'}%)</span></div><div class="kv"><span>QQQ</span><span>${m.qqq?.price ?? '—'} (${m.qqq?.chg ?? '—'}%)</span></div><div class="kv"><span>VIX</span><span>${m.vix?.price ?? '—'}</span></div><div class="kv"><span>DXY</span><span>${m.dxy?.price ?? '—'}</span></div><div class="kv"><span>10Y</span><span>${m.tnx?.price ?? '—'}</span></div>`;
}

function renderWatchlist(data) {
  const statusEl = document.getElementById('watchlistStatus');
  const grid = document.getElementById('watchlistGrid');
  if (!data || !data.stocks || !data.stocks.length) { statusEl.textContent = 'No watchlist data available.'; grid.innerHTML = ''; return; }
  statusEl.textContent = data.cached ? 'Watchlist loaded (cached).' : 'Watchlist loaded.';
  grid.innerHTML = data.stocks.map(s => `<div class="wl-card ${s.verdict}"><div class="wl-row"><div><div class="wl-sym">${s.symbol}</div><div class="wl-price">$${Number(s.price).toFixed(2)} <span style="font-size:11px;color:${s.changePct >= 0 ? 'var(--green)' : 'var(--red)'}">${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%</span></div></div><div class="wl-badge ${s.verdict}">${s.verdict}</div></div><div class="wl-note">${s.signal?.shortReason || '—'}</div><div class="wl-levels"><div class="kv"><span>Setup</span><span style="color:${scoreColor(s.setupScore)}">${s.setupScore}</span></div><div class="kv"><span>Momentum</span><span style="color:${scoreColor(s.momentumScore)}">${s.momentumScore}</span></div><div class="kv"><span>RS vs SPY</span><span>${s.relStrength >= 0 ? '+' : ''}${s.relStrength.toFixed(1)}%</span></div><div class="kv"><span>Support / 20D</span><span>${s.support ?? '—'} / ${s.resistance ?? '—'}</span></div></div><div><div class="wl-section-title">WHY IT SCORES THIS WAY</div><div class="wl-list">${(s.why || []).slice(0,3).map(r => pill(r, 'good')).join('') || '<span class="muted">—</span>'}</div></div><div><div class="wl-section-title">WHAT NEEDS TO IMPROVE</div><div class="wl-list">${(s.needs || []).slice(0,2).map(r => pill(r, 'warn')).join('') || '<span class="muted">—</span>'}</div></div></div>`).join('');
}

function renderBacktest(data) {
  const status = document.getElementById('backtestStatus');
  const panel = document.getElementById('backtestPanel');
  const validation = data?.validation || {};
  const validationPanel = document.getElementById('validationPanel');
  if (!data || !data.buckets) { status.textContent = 'No backtest data available.'; panel.innerHTML = ''; validationPanel.innerHTML = ''; return; }
  status.textContent = data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Ready';
  const sampleTone = validation.sampleQuality === 'better' ? 'good' : validation.sampleQuality === 'thin' ? 'warn' : 'bad';
  validationPanel.innerHTML = `<div class="validation-shell"><div class="validation-header"><div><div class="metric-label">VALIDATION READ</div><div class="validation-title ${sampleTone}">${(validation.sampleQuality || 'unknown').replace('_',' ')}</div></div><div class="validation-samples">${validation.evaluatedSamples ?? 0} eval samples</div></div><div class="validation-grid"><div class="validation-stat"><span>Forward edge 5D</span><strong>${validation.forwardEdge5d != null ? validation.forwardEdge5d + '%' : '—'}</strong></div><div class="validation-stat"><span>Caution avg 5D</span><strong>${validation.cautionAvg5d != null ? validation.cautionAvg5d + '%' : '—'}</strong></div></div><div class="trust-list">${(validation.warnings || []).length ? validation.warnings.map(w => pill(w, sampleTone === 'good' ? 'warn' : 'bad')).join('') : pill('validation sample in decent shape', 'good')}</div></div>`;
  const buckets = ['YES', 'CAUTION', 'NO'];
  panel.innerHTML = `<div class="bt-grid">${buckets.map(key => { const b = data.buckets[key] || {}; const col = key === 'YES' ? 'var(--green)' : key === 'CAUTION' ? 'var(--amber)' : 'var(--red)'; return `<div class="bt-card"><div class="kv"><span style="color:${col};font-weight:700">${key}</span><span class="muted">${b.count || 0} entries</span></div><div class="kv"><span>Avg 1D</span><span>${b.avg1d != null ? b.avg1d + '%' : '—'}</span></div><div class="kv"><span>Avg 5D</span><span>${b.avg5d != null ? b.avg5d + '%' : '—'}</span></div><div class="kv"><span>Avg 10D</span><span>${b.avg10d != null ? b.avg10d + '%' : '—'}</span></div><div class="kv"><span>Win 1D</span><span>${b.winRate1d != null ? b.winRate1d + '%' : '—'}</span></div><div class="kv"><span>Win 5D</span><span>${b.winRate5d != null ? b.winRate5d + '%' : '—'}</span></div><div class="kv"><span>Win 10D</span><span>${b.winRate10d != null ? b.winRate10d + '%' : '—'}</span></div></div>`; }).join('')}</div><div style="margin-top:8px;font-size:10px;color:var(--text3);">Interpret this as a permission study, not a directional market forecast. A NO bucket can still include positive forward returns if broad conditions were poor for clean entries but index drift stayed positive.</div>`;
}

function renderJournal(data) {
  const status = document.getElementById('journalStatus');
  const panel = document.getElementById('journalPanel');
  if (!data || !data.journal || !data.journal.length) { status.textContent = 'No journal data available.'; panel.innerHTML = ''; return; }
  status.textContent = `${data.count} total entries`;
  panel.innerHTML = `<div class="journal-list">${data.journal.slice(-6).reverse().map(j => { const col = j.decision === 'YES' ? 'var(--green)' : j.decision === 'CAUTION' ? 'var(--amber)' : 'var(--red)'; return `<div class="journal-item"><div class="kv"><span style="color:${col};font-weight:700">${j.date} · ${j.decision || '—'}</span><span>score ${j.score ?? '—'}</span></div><div class="kv"><span>Confidence</span><span>${j.confidenceScore ?? '—'}</span></div><div class="kv"><span>SPY</span><span>${j.spyEntry ?? '—'}</span></div><div class="kv"><span>1D / 5D / 10D</span><span>${j.outcome1d ?? '—'} / ${j.outcome5d ?? '—'} / ${j.outcome10d ?? '—'}</span></div><div>${(j.topReasons || []).map(r => pill(r, 'good')).join('')}</div></div>`; }).join('')}</div><div style="margin-top:8px;font-size:10px;color:var(--text3);">Older journal rows may have incomplete fields because they were logged before the current schema.</div>`;
}

async function loadJson(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadAll() {
  try { const market = await loadJson(API_URL); if (market.status === 'unavailable') renderUnavailable(market); else renderMarket(market); } catch (err) { renderUnavailable({ systemStatus: { reason: err.message } }); }
  try { renderWatchlist(await loadJson(WATCHLIST_URL)); } catch (err) { document.getElementById('watchlistStatus').textContent = `Watchlist failed: ${err.message}`; }
  try { renderBacktest(await loadJson(BACKTEST_URL)); } catch (err) { document.getElementById('backtestStatus').textContent = `Backtest failed: ${err.message}`; }
  try { renderJournal(await loadJson(JOURNAL_URL)); } catch (err) { document.getElementById('journalStatus').textContent = `Journal failed: ${err.message}`; }
  document.getElementById('footerTime').textContent = new Date().toLocaleString();
}

loadAll();
setInterval(loadAll, 45000);
