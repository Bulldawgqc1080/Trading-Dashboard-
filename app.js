const API_URL = '/api/market';

function scoreColor(s){return s>=70?'var(--green)':s>=45?'var(--amber)':'var(--red)'}
function pill(text, cls){return `<span class="pill ${cls}">${text}</span>`}

function renderUnavailable(data) {
  document.getElementById('statusBanner').innerHTML = `<div class="banner err">Live market data unavailable — do not use this tool until data integrity is restored. ${data?.systemStatus?.reason || ''}</div>`;
  document.getElementById('decision').textContent = 'UNAVAILABLE';
  document.getElementById('decision').className = 'decision UNAVAILABLE';
  document.getElementById('score').textContent = '--';
  document.getElementById('confidence').textContent = '--';
  document.getElementById('summary').textContent = 'The system does not currently have enough trustworthy data to issue a market verdict.';
  document.getElementById('guidance').textContent = 'Wait for live market data and healthy critical feeds before using SIBT for decisions.';
  document.getElementById('reasons').innerHTML = '';
  document.getElementById('blockers').innerHTML = pill('critical data unavailable', 'bad');
  document.getElementById('categoryGrid').innerHTML = '';
  document.getElementById('quality').innerHTML = `<div class="kv"><span>Status</span><span class="subtle">UNAVAILABLE</span></div>`;
  document.getElementById('snapshot').innerHTML = '';
}

function renderMarket(data) {
  const decision = data.decision || 'NO';
  const decisionText = decision === 'YES' ? 'FAVORABLE' : decision === 'CAUTION' ? 'SELECTIVE' : 'NOT FAVORABLE';
  const bannerClass = data.status === 'ok' ? 'ok' : 'warn';
  const bannerText = data.status === 'ok'
    ? 'System healthy — verdict allowed.'
    : `System degraded — use reduced confidence. ${data.systemStatus?.reason || ''}`;

  document.getElementById('statusBanner').innerHTML = `<div class="banner ${bannerClass}">${bannerText}</div>`;
  document.getElementById('decision').textContent = decisionText;
  document.getElementById('decision').className = `decision ${decision}`;
  document.getElementById('score').textContent = data.score;
  document.getElementById('score').style.color = scoreColor(data.score);
  document.getElementById('confidence').textContent = `${data.confidenceLabel} (${data.confidenceScore})`;
  document.getElementById('confidence').style.color = scoreColor(data.confidenceScore);
  document.getElementById('timestamp').textContent = data.timestamp ? `Updated ${new Date(data.timestamp).toLocaleTimeString()}` : '';
  document.getElementById('summary').textContent = data.summary || '';
  document.getElementById('guidance').textContent = data.guidance || '';
  document.getElementById('reasons').innerHTML = (data.topReasons || []).map(r => pill(r, 'good')).join('') || '<span class="muted">—</span>';
  document.getElementById('blockers').innerHTML = (data.blockers || []).map(r => pill(r, 'bad')).join('') || '<span class="muted">—</span>';

  const cats = data.categoryScores || {};
  document.getElementById('categoryGrid').innerHTML = Object.entries(cats).map(([k,v]) => `
    <div class="card score-row">
      <div class="metric-label">${k.toUpperCase()}</div>
      <div style="font-size:24px;font-weight:700;color:${scoreColor(v)}">${v}</div>
      <div class="track"><div class="fill" style="width:${v}%;background:${scoreColor(v)}"></div></div>
    </div>
  `).join('');

  const dq = data.dataQuality || {};
  document.getElementById('quality').innerHTML = `
    <div class="kv"><span>Quality</span><span>${dq.label || '—'}</span></div>
    <div class="kv"><span>Proxy inputs</span><span class="subtle">${(dq.proxyInputs || []).join(', ') || 'none'}</span></div>
    <div class="kv"><span>Missing inputs</span><span class="subtle">${(dq.missingInputs || []).join(', ') || 'none'}</span></div>
    <div class="kv"><span>Stale feeds</span><span class="subtle">${(dq.staleFeeds || []).join(', ') || 'none'}</span></div>
    <div class="kv"><span>Feed errors</span><span class="subtle">${(dq.errors || []).join(', ') || 'none'}</span></div>
  `;

  const m = data.market || {};
  document.getElementById('snapshot').innerHTML = `
    <div class="kv"><span>SPY</span><span>${m.spy?.price ?? '—'} (${m.spy?.chg ?? '—'}%)</span></div>
    <div class="kv"><span>QQQ</span><span>${m.qqq?.price ?? '—'} (${m.qqq?.chg ?? '—'}%)</span></div>
    <div class="kv"><span>VIX</span><span>${m.vix?.price ?? '—'}</span></div>
    <div class="kv"><span>DXY</span><span>${m.dxy?.price ?? '—'}</span></div>
    <div class="kv"><span>10Y</span><span>${m.tnx?.price ?? '—'}</span></div>
  `;
}

async function load() {
  try {
    const res = await fetch(`${API_URL}?t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.status === 'unavailable') renderUnavailable(data);
    else renderMarket(data);
  } catch (err) {
    renderUnavailable({ systemStatus: { reason: err.message } });
  }
  document.getElementById('footerTime').textContent = new Date().toLocaleString();
}

load();
setInterval(load, 45000);
