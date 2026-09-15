const API_URL = '/api/market';
const WATCHLIST_URL = '/api/watchlist';
const BACKTEST_URL = '/api/backtest';
const JOURNAL_URL = '/api/journal';
const STOCK_BACKTEST_URL = '/api/stock-backtest';
const WATCHLIST_STORAGE_KEY = 'sibt.watchlist.symbols.v1';
const WATCHLIST_RISK_KEY = 'sibt.watchlist.risk.v1';
const DEFAULT_WATCHLIST = ['TSLA', 'NVDA', 'PYPL', 'MSTR', 'HD'];
let lastMarketData = null;
let lastWatchlistData = null;

function esc(value){return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function quoteStamp(value){return value && !isNaN(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }) : 'unavailable'}
function scoreColor(s){return s>=70?'var(--green)':s>=45?'var(--amber)':'var(--red)'}
function scoreTone(s){return s>=70?'good':s>=45?'warn':'bad'}
function pill(text, cls){return `<span class="pill ${cls}">${text}</span>`}
function trustTone(score){return score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad'}
function statDisplay(value, fallback = '—'){return value != null ? `${value}%` : fallback}
function money(value){return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}) : '—'}
function compactMoney(value){return Number.isFinite(Number(value)) ? `$${Number(value).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:1})}` : '—'}
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

function permissionTone(label){
  return label === 'ALLOWED' ? 'good' : ['SELECTIVE','PLANNING'].includes(label) ? 'warn' : 'bad';
}
function setBriefPermission(id, item){
  const label = item?.label || '—';
  const value = document.getElementById(id);
  value.textContent = label;
  value.className = permissionTone(label);
  document.getElementById(`${id}Note`).textContent = item?.note || 'Waiting for permission';
}
function bestEligibleSetup(data){
  const stocks = data?.stocks || [];
  const eligible = stocks.filter(stock => stock.signal?.label === 'FAVORABLE').sort((a,b) => Number(b.combinedScore)-Number(a.combinedScore));
  if (eligible.length) return {label:`${eligible[0].symbol} · ${eligible[0].combinedScore}`, note:'Highest-scoring FAVORABLE entry posture in the current watchlist'};
  const highest = [...stocks].sort((a,b) => Number(b.combinedScore)-Number(a.combinedScore))[0];
  return highest
    ? {label:'NO ELIGIBLE SETUP', note:`Highest raw setup: ${highest.symbol} · ${highest.combinedScore} · ${highest.signal?.label || highest.verdict}`}
    : {label:'—', note:'Waiting for watchlist'};
}
function biggestVisibleRisk(data){
  const nearest = data?.scheduledEvents?.nearest;
  if (nearest?.at) {
    const eventTime = Date.parse(nearest.at), days = (eventTime-Date.now())/86400000;
    if (Number.isFinite(days) && days >= 0 && days <= 7) return {label:nearest.label, note:new Date(nearest.at).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})};
  }
  if (data?.blockers?.length) return {label:data.blockers[0], note:'Highest-priority active model blocker'};
  return {label:'NO MAJOR SCHEDULED RISK', note:'Within published calendar coverage; unscheduled news remains unknowable'};
}
function renderMorningBrief(){
  const data = lastMarketData;
  if (!data || data.status === 'unavailable' || !data.regimePlan) {
    document.getElementById('briefHeadline').textContent = 'NO TRUSTWORTHY DECISION';
    document.getElementById('briefSubtitle').textContent = 'Wait for healthy live data before using the dashboard.';
    document.getElementById('briefRegime').textContent = 'REGIME UNKNOWN';
    document.getElementById('briefSize').textContent = '0.00×';
    ['briefStocks','briefPuts','briefCalls'].forEach(id=>setBriefPermission(id,{label:'PAUSED',note:'Live market read unavailable.'}));
    return;
  }
  const plan = data.regimePlan;
  const call = data.permissionLabel === 'FAVORABLE' ? 'TRADE DISCIPLINED' : data.permissionLabel === 'SELECTIVE' ? 'TRADE SELECTIVELY' : 'STAND DOWN';
  document.getElementById('briefHeadline').textContent = `${data.score}/100 — ${call}`;
  document.getElementById('briefSubtitle').textContent = `${data.permissionLabel.replace('_',' ')} market permission · ${plan.modelVersion}`;
  document.getElementById('briefRegime').textContent = plan.regime;
  document.getElementById('briefRegime').className = `regime-badge ${plan.regime.includes('BULL')?'good':plan.regime === 'NEUTRAL'?'warn':'bad'}`;
  document.getElementById('briefSize').textContent = `${Number(plan.sizeMultiplier).toFixed(2)}×`;
  document.getElementById('briefSize').className = permissionTone(plan.sizeMultiplier >= .75 ? 'ALLOWED' : plan.sizeMultiplier > 0 ? 'SELECTIVE' : 'PAUSED');
  document.getElementById('briefSizeNote').textContent = !plan.marketOpen ? 'Market closed; planning only' : plan.eventCapActive ? 'Scheduled-event cap active' : plan.sizeMultiplier ? 'Applied to browser-only risk sizing' : 'Fresh-position sizing paused';
  setBriefPermission('briefStocks',plan.strategies?.newPositions);
  setBriefPermission('briefPuts',plan.strategies?.cashSecuredPuts);
  setBriefPermission('briefCalls',plan.strategies?.coveredCalls);
  const best = bestEligibleSetup(lastWatchlistData);
  document.getElementById('briefBest').textContent = best.label;
  document.getElementById('briefBest').className = best.label === 'NO ELIGIBLE SETUP' ? 'warn' : 'good';
  document.getElementById('briefBestNote').textContent = best.note;
  const risk = biggestVisibleRisk(data);
  document.getElementById('briefRisk').textContent = risk.label;
  document.getElementById('briefRisk').className = risk.label === 'NO MAJOR SCHEDULED RISK' ? 'good' : 'warn';
  document.getElementById('briefRiskNote').textContent = risk.note;
}

function renderUnavailable(data) {
  lastMarketData = data;
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
  renderMorningBrief();
}

function decisionDisplay(data) {
  if (data.permissionLabel === 'FAVORABLE') return 'FAVORABLE';
  if (data.permissionLabel === 'SELECTIVE') return 'SELECTIVE';
  return 'LOW PERMISSION';
}

function renderMarket(data) {
  lastMarketData = data;
  const limited = data.status !== 'ok' || (data.dataQuality?.proxyInputs || []).length || (data.dataQuality?.missingInputs || []).length;
  const bannerClass = limited ? 'warn' : 'ok';
  const bannerText = limited
    ? 'Analysis limited — some inputs are estimated or missing. Feed connectivity does not establish signal accuracy.'
    : 'Feeds responding — review input quality and validation below.';
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
  document.getElementById('timestamp').textContent = data.timestamp ? `Dashboard refreshed ${new Date(data.timestamp).toLocaleString()} · SPY quote as of ${quoteStamp(data.market?.spy?.quoteAsOf)}` : '';
  document.getElementById('summary').textContent = data.summary || '';
  document.getElementById('guidance').textContent = `${data.guidance || ''} ${data.interpretation || ''}`.trim();
  document.getElementById('reasons').innerHTML = (data.topReasons || []).map(r => pill(r, data.decision === 'YES' ? 'good' : 'warn')).join('') || '<span class="muted">—</span>';
  document.getElementById('blockers').innerHTML = (data.blockers || []).map(r => pill(r, 'bad')).join('') || '<span class="muted">—</span>';
  const cats = data.categoryScores || {};
  document.getElementById('categoryGrid').innerHTML = Object.entries(cats).map(([k,v]) => `<div class="card score-row score-row-${scoreTone(v)}"><div class="metric-label">${k.toUpperCase()}</div><div class="score-number" style="color:${scoreColor(v)}">${v}</div><div class="track"><div class="fill" style="width:${v}%;background:${scoreColor(v)}"></div></div></div>`).join('');
  const dq = data.dataQuality || {};
  document.getElementById('quality').innerHTML = `<div class="kv"><span>Feed connectivity</span><span>${dq.label || '—'}</span></div><div class="kv"><span>Proxy inputs</span><span class="subtle">${(dq.proxyInputs || []).join(', ') || 'none'}</span></div><div class="kv"><span>Missing inputs</span><span class="subtle">${(dq.missingInputs || []).join(', ') || 'none'}</span></div><div class="kv"><span>Stale feeds</span><span class="subtle">${(dq.staleFeeds || []).join(', ') || 'none'}</span></div><div class="kv"><span>Feed errors</span><span class="subtle">${(dq.errors || []).join(', ') || 'none'}</span></div><div style="margin-top:8px;font-size:10px;color:var(--text3);">This is a market permission tool, not a directional prediction engine.</div>`;
  const warnings = data.validationWarnings || [];
  document.getElementById('modelTrust').innerHTML = `<div class="kv"><span>Input confidence</span><span class="trust-label ${trustTone(data.confidenceScore)}">${data.confidenceLabel} (${data.confidenceScore})</span></div><div class="kv"><span>Model version</span><span class="subtle">${data.modelVersion || '—'}</span></div><div class="kv"><span>Warnings</span><span class="subtle">${warnings.length}</span></div><div class="trust-list">${warnings.length ? warnings.map(w => pill(w, 'warn')).join('') : pill('no active trust warnings', 'good')}</div><div class="trust-note">Rule-based input-quality score, not probability of profit or forecast accuracy. Starts at 100 and deducts for proxies, missing inputs, closed markets and feed issues. Deductions: ${(data.confidenceReasons || []).join('; ') || 'none'}. Predictive validation is shown separately below.</div>`;
  const m = data.market || {};
  const events = data.scheduledEvents || {};
  const nearest = events.nearest;
  const eventText = nearest ? `${nearest.label} · ${new Date(nearest.at).toLocaleString('en-US', {timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})}` : 'None in published coverage';
  document.getElementById('snapshot').innerHTML = `<div class="kv"><span>SPY</span><span>${m.spy?.price ?? '—'} (${m.spy?.chg ?? '—'}%)</span></div><div class="kv"><span>QQQ</span><span>${m.qqq?.price ?? '—'} (${m.qqq?.chg ?? '—'}%)</span></div><div class="kv"><span>VIX</span><span>${m.vix?.price ?? '—'}</span></div><div class="kv"><span>DXY</span><span>${m.dxy?.price ?? '—'}</span></div><div class="kv"><span>10Y</span><span>${m.tnx?.price ?? '—'}</span></div><div class="market-event ${events.highImpact24hr || events.fomc72hr ? 'near' : ''}"><div class="metric-label">NEXT HIGH-IMPACT EVENT</div><strong>${esc(eventText)}</strong><small>Official Fed/BLS calendar · coverage through ${esc(events.coverageThrough || 'unknown')}</small></div>`;
  renderMorningBrief();
}

function readRiskSettings() {
  try {
    const saved=JSON.parse(localStorage.getItem(WATCHLIST_RISK_KEY)||'{}');
    return {portfolioValue:Number(saved.portfolioValue)||0,riskPct:Number(saved.riskPct)||0.5,maxPositionPct:Number(saved.maxPositionPct)||10};
  } catch { return {portfolioValue:0,riskPct:0.5,maxPositionPct:10}; }
}
function rememberedShares(symbol) {
  try { return Math.max(0,Number(JSON.parse(localStorage.getItem('sibt.options.positions.v2')||'{}')?.[symbol]?.shares)||0); }
  catch { return 0; }
}
function sizeEntry(stock) {
  const settings=readRiskSettings(), existingShares=rememberedShares(stock.symbol), portfolio=settings.portfolioValue;
  const multiplier=Math.max(0,Math.min(1,Number(lastMarketData?.regimePlan?.sizeMultiplier) || 0));
  const risk=Number(stock.entryPlan?.riskPerShare), price=Number(stock.price);
  if (!(portfolio>0&&risk>0&&price>0)) return {available:false,existingShares,multiplier};
  const riskBudget=portfolio*settings.riskPct/100*multiplier;
  const byRisk=Math.max(0,Math.floor(riskBudget/risk));
  const room=Math.max(0,portfolio*settings.maxPositionPct/100-existingShares*price);
  const byConcentration=Math.max(0,Math.floor(room/price));
  const shares=Math.min(byRisk,byConcentration);
  const postPct=(existingShares+shares)*price/portfolio*100;
  return {available:true,existingShares,riskBudget,byRisk,byConcentration,shares,postPct,settings,multiplier};
}
function earningsText(stock) {
  const earnings=stock.earnings||{}, days=earnings.daysToEarnings;
  if (earnings.date&&Number.isFinite(days)&&days>=0) return `${earnings.date} · ${days}d · ${earnings.estimated?'ESTIMATE':'SCHEDULED'}`;
  return earnings.status==='unavailable'?'CALENDAR UNAVAILABLE':'UNKNOWN — not event-free';
}
function renderWatchlist(data) {
  const statusEl = document.getElementById('watchlistStatus');
  const grid = document.getElementById('watchlistGrid');
  if (!data || !data.stocks || !data.stocks.length) { statusEl.textContent = 'No watchlist data available.'; grid.innerHTML = ''; return; }
  lastWatchlistData=data;
  renderMorningBrief();
  statusEl.textContent = `${data.cached ? 'Cached' : 'Fresh'} stock data · ${data.stockModelVersion||'stock model unknown'} · Overall market permission: ${(data.marketPermission || 'unknown').replace('_',' ')} · Regime size: ${Number(data.regimePlan?.sizeMultiplier ?? 0).toFixed(2)}×`;
  grid.innerHTML = data.stocks.map(s => {
    const sizing=sizeEntry(s), plan=s.entryPlan||{}, earnings=s.earnings||{};
    const eventNear=Number.isFinite(earnings.daysToEarnings)&&earnings.daysToEarnings>=0&&earnings.daysToEarnings<=7;
    const sizingLabel=sizing.available?(sizing.multiplier===0?'0 shares · regime paused':`${sizing.shares.toLocaleString()} shares${s.signal?.label==='FAVORABLE'?'':' · planning only'}`):'Enter portfolio value';
    const sizingNote=sizing.available
      ? `Regime-adjusted risk budget ${money(sizing.riskBudget)} (${sizing.multiplier.toFixed(2)}× normal) · remembered shares ${sizing.existingShares.toLocaleString()} · post-entry position ${sizing.postPct.toFixed(1)}%. Ceiling is the lower of risk and concentration limits.`
      : `${plan.note||'Technical references only.'} Sizing remains unavailable until portfolio value is entered.`;
    return `<div class="wl-card ${s.verdict}">
      <div class="wl-row"><div><div class="wl-sym">${esc(s.symbol)}</div><div class="wl-price">$${Number(s.price).toFixed(2)} <span style="font-size:11px;color:${s.changePct>=0?'var(--green)':'var(--red)'}">${s.changePct>=0?'+':''}${Number(s.changePct).toFixed(2)}%</span></div></div><div class="wl-badge ${s.verdict}">${esc(s.verdict)} SETUP</div></div>
      <div class="wl-posture"><span>Entry posture</span><strong class="${s.signal?.level||'caution'}">${esc(s.signal?.label||'CAUTION')}</strong><small>${esc(s.signal?.shortReason||'—')}</small></div>
      <div class="wl-levels"><div class="kv"><span>Stock setup</span><span style="color:${scoreColor(s.setupScore)}">${s.setupScore}</span></div><div class="kv"><span>Market permission</span><span>${esc((data.marketPermission||'unknown').replace('_',' '))}</span></div><div class="kv"><span>Momentum</span><span style="color:${scoreColor(s.momentumScore)}">${s.momentumScore}</span></div><div class="kv"><span>RS vs SPY · 20D / 60D</span><span>${s.relStrength>=0?'+':''}${Number(s.relStrength).toFixed(1)}% / ${s.relStrength60>=0?'+':''}${Number(s.relStrength60).toFixed(1)}%</span></div></div>
      <div class="wl-event ${eventNear?'near':''}"><span>Next earnings</span><strong>${esc(earningsText(s))}</strong><small>${esc(earnings.note||'Unknown does not mean event-free.')}</small></div>
      <div class="wl-entry-plan"><div class="wl-section-title">TECHNICAL ENTRY PLAN</div><div class="wl-levels"><div class="kv"><span>Buy zone</span><span>${plan.buyZone?`${money(plan.buyZone.low)}–${money(plan.buyZone.high)}`:'—'}</span></div><div class="kv"><span>Invalidation reference</span><span>${money(plan.invalidation)}</span></div><div class="kv"><span>Sizing ceiling</span><strong>${sizingLabel}</strong></div></div><small>${esc(sizingNote)}</small></div>
      <details class="wl-advanced"><summary>Advanced metrics and score details</summary><div class="wl-levels"><div class="kv"><span>ATR 14 / price</span><span>${money(s.atr14)} / ${s.volatilityPct??'—'}%</span></div><div class="kv"><span>EMA 21 / 20D high</span><span>${money(s.ema21Reference)} / ${money(s.high20)}</span></div><div class="kv"><span>20D dollar volume</span><span>${compactMoney(s.avgDollarVolume20)}</span></div><div class="kv"><span>5D / 20D volume</span><span>${Number.isFinite(s.volumeTrend)?s.volumeTrend.toFixed(2)+'×':'—'}</span></div><div class="kv"><span>Risk / share</span><span>${money(plan.riskPerShare)}</span></div><div class="kv"><span>Next price reference</span><span>${money(plan.nextReference)}</span></div><div class="kv"><span>Reward / risk</span><span>${plan.rewardRisk!=null?plan.rewardRisk.toFixed(2)+'×':'—'}</span></div></div><div class="wl-section-title">WHY THE STOCK SCORES THIS WAY</div><div class="wl-list">${(s.why||[]).slice(0,3).map(reason=>pill(esc(reason),'')).join('')||'<span class="muted">—</span>'}</div><div class="wl-section-title">WHAT THE STOCK NEEDS</div><div class="wl-list">${(s.needs||[]).map(reason=>pill(esc(reason),'warn')).join('')||'<span class="muted">—</span>'}</div></details>
      <div class="desk-actions"><button type="button" class="wl-options" data-options-symbol="${esc(s.symbol)}">Covered calls</button><button type="button" class="wl-options" data-puts-symbol="${esc(s.symbol)}">Cash-secured puts</button></div>
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-options-symbol]').forEach(button => button.addEventListener('click', () => {
    const symbolInput = document.querySelector('#ccForm [name="symbol"]');
    if (!symbolInput) return;
    symbolInput.value = button.dataset.optionsSymbol;
    symbolInput.dispatchEvent(new Event('change', {bubbles:true}));
    selectStrategy('call',{scroll:true});
  }));
  grid.querySelectorAll('[data-puts-symbol]').forEach(button => button.addEventListener('click', () => {
    const symbolInput = document.querySelector('#cspForm [name="symbol"]');
    if (!symbolInput) return;
    symbolInput.value = button.dataset.putsSymbol;
    symbolInput.dispatchEvent(new Event('change', {bubbles:true}));
    selectStrategy('put',{scroll:true});
  }));
}

function readSavedWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) || 'null');
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_WATCHLIST;
  } catch { return DEFAULT_WATCHLIST; }
}

function normalizeWatchlistInput(value) {
  return [...new Set(String(value || '').toUpperCase().split(/[,\s]+/).map(s => s.trim()).filter(s => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))].slice(0, 12);
}

let watchlistSymbols = readSavedWatchlist();
const watchlistEditor = document.getElementById('watchlistEditor');
watchlistEditor.elements.symbols.value = watchlistSymbols.join(', ');
const initialRisk=readRiskSettings();
watchlistEditor.elements.portfolioValue.value=initialRisk.portfolioValue||'';
watchlistEditor.elements.riskPct.value=initialRisk.riskPct;
watchlistEditor.elements.maxPositionPct.value=initialRisk.maxPositionPct;
function saveRiskSettings(){
  const settings={portfolioValue:Math.max(0,Number(watchlistEditor.elements.portfolioValue.value)||0),riskPct:Math.min(10,Math.max(.1,Number(watchlistEditor.elements.riskPct.value)||.5)),maxPositionPct:Math.min(100,Math.max(1,Number(watchlistEditor.elements.maxPositionPct.value)||10))};
  localStorage.setItem(WATCHLIST_RISK_KEY,JSON.stringify(settings));
  return settings;
}
watchlistEditor.addEventListener('submit', async event => {
  event.preventDefault();
  const next = normalizeWatchlistInput(watchlistEditor.elements.symbols.value);
  if (!next.length) { document.getElementById('watchlistStatus').textContent = 'Enter at least one valid ticker.'; return; }
  watchlistSymbols = next;
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
  saveRiskSettings();
  watchlistEditor.elements.symbols.value = next.join(', ');
  document.getElementById('watchlistStatus').textContent = 'Updating watchlist…';
  try { renderWatchlist(await loadJson(`${WATCHLIST_URL}?symbols=${encodeURIComponent(next.join(','))}`)); }
  catch (err) { document.getElementById('watchlistStatus').textContent = `Watchlist failed: ${err.message}`; }
});
['portfolioValue','riskPct','maxPositionPct'].forEach(name=>watchlistEditor.elements[name].addEventListener('change',()=>{saveRiskSettings();if(lastWatchlistData)renderWatchlist(lastWatchlistData);}));
document.getElementById('watchlistReset').addEventListener('click', () => {
  watchlistSymbols = [...DEFAULT_WATCHLIST];
  localStorage.removeItem(WATCHLIST_STORAGE_KEY);
  watchlistEditor.elements.symbols.value = watchlistSymbols.join(', ');
  watchlistEditor.requestSubmit();
});

function renderBacktest(data) {
  const status = document.getElementById('backtestStatus');
  const panel = document.getElementById('backtestPanel');
  const validation = data?.validation || {};
  const validationPanel = document.getElementById('validationPanel');
  if (!data || !data.buckets) { status.textContent = 'No backtest data available.'; panel.innerHTML = ''; validationPanel.innerHTML = ''; return; }
  status.textContent = data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Ready';
  const sampleTone = validation.sampleQuality === 'better' ? 'good' : validation.sampleQuality === 'thin' ? 'warn' : 'bad';
  const forwardEdgeFallback = validation.forwardEdge5d != null ? '—' : 'Not enough YES/NO outcomes yet';
  const cautionFallback = validation.cautionAvg5d != null ? '—' : 'Not enough CAUTION outcomes yet';
  validationPanel.innerHTML = `<div class="validation-shell"><div class="validation-header"><div><div class="metric-label">VALIDATION READ</div><div class="validation-title ${sampleTone}">${(validation.sampleQuality || 'unknown').replace('_',' ')}</div></div><div class="validation-samples">${validation.evaluatedSamples ?? 0} eval samples</div></div><div class="validation-grid"><div class="validation-stat"><span>Forward edge 5D</span><strong>${statDisplay(validation.forwardEdge5d, forwardEdgeFallback)}</strong></div><div class="validation-stat"><span>Caution avg 5D</span><strong>${statDisplay(validation.cautionAvg5d, cautionFallback)}</strong></div></div><div class="trust-list">${(validation.warnings || []).length ? validation.warnings.map(w => pill(w, sampleTone === 'good' ? 'warn' : 'bad')).join('') : pill('validation sample in decent shape', 'good')}</div></div>`;
  const buckets = ['YES', 'CAUTION', 'NO'];
  panel.innerHTML = `<div class="bt-grid">${buckets.map(key => { const b = data.buckets[key] || {}; const col = key === 'YES' ? 'var(--green)' : key === 'CAUTION' ? 'var(--amber)' : 'var(--red)'; return `<div class="bt-card"><div class="kv"><span style="color:${col};font-weight:700">${key}</span><span class="muted">${b.count || 0} entries</span></div><div class="kv"><span>Avg 1D</span><span>${b.avg1d != null ? b.avg1d + '%' : '—'}</span></div><div class="kv"><span>Avg 5D</span><span>${b.avg5d != null ? b.avg5d + '%' : '—'}</span></div><div class="kv"><span>Avg 10D</span><span>${b.avg10d != null ? b.avg10d + '%' : '—'}</span></div><div class="kv"><span>Win 1D</span><span>${b.winRate1d != null ? b.winRate1d + '%' : '—'}</span></div><div class="kv"><span>Win 5D</span><span>${b.winRate5d != null ? b.winRate5d + '%' : '—'}</span></div><div class="kv"><span>Win 10D</span><span>${b.winRate10d != null ? b.winRate10d + '%' : '—'}</span></div></div>`; }).join('')}</div><div style="margin-top:8px;font-size:10px;color:var(--text3);">Interpret this as a permission study, not a directional market forecast. A NO bucket can still include positive forward returns if broad conditions were poor for clean entries but index drift stayed positive.</div>`;
}

function renderStockValidation(data){
  const status=document.getElementById('stockValidationStatus'),panel=document.getElementById('stockValidationPanel');
  if(!data?.buckets){status.textContent='No stock validation data available.';panel.innerHTML='';return;}
  status.textContent=`${data.modelVersion||'stock model'} · ${data.evaluatedSamples||0} verified 5D outcomes · minimum ${data.minimumPerBucket||10} per bucket`;
  panel.innerHTML=`<div class="bt-grid">${['ACTIONABLE','WATCH','AVOID'].map(key=>{const bucket=data.buckets[key]||{};const color=key==='ACTIONABLE'?'var(--green)':key==='WATCH'?'var(--amber)':'var(--red)';return `<div class="bt-card"><div class="kv"><strong style="color:${color}">${key}</strong><span class="muted">${bucket.count||0} entries</span></div><div class="kv"><span>Avg 5D</span><span>${bucket.avg5d!=null?bucket.avg5d+'%':'—'}</span></div><div class="kv"><span>Win 5D</span><span>${bucket.winRate5d!=null?bucket.winRate5d+'%':'—'}</span></div><div class="kv"><span>Avg 10D</span><span>${bucket.avg10d!=null?bucket.avg10d+'%':'—'}</span></div></div>`;}).join('')}</div><p class="trust-note">${esc(data.warning||'Ticker outcomes use exact trading dates. Past results do not guarantee future performance.')}</p>`;
}

function renderJournal(data) {
  const status = document.getElementById('journalStatus');
  const panel = document.getElementById('journalPanel');
  if (!data || !data.journal || !data.journal.length) { status.textContent = 'No journal data available.'; panel.innerHTML = ''; return; }
  status.textContent = `${data.count} total entries`;
  panel.innerHTML = `<div class="journal-list">${data.journal.slice(-6).reverse().map(j => { const col = j.decision === 'YES' ? 'var(--green)' : j.decision === 'CAUTION' ? 'var(--amber)' : 'var(--red)'; return `<div class="journal-item"><div class="kv"><span style="color:${col};font-weight:700">${j.date} · ${j.decision || '—'}</span><span>score ${j.score ?? '—'}</span></div><div class="kv"><span>Input confidence</span><span>${j.confidenceScore ?? '—'}</span></div><div class="kv"><span>SPY</span><span>${j.spyEntry ?? '—'}</span></div><div class="kv"><span>1D / 5D / 10D</span><span>${j.outcome1d ?? '—'} / ${j.outcome5d ?? '—'} / ${j.outcome10d ?? '—'}</span></div><div>${(j.topReasons || []).map(r => pill(r, 'good')).join('')}</div></div>`; }).join('')}</div><div style="margin-top:8px;font-size:10px;color:var(--text3);">Older journal rows may have incomplete fields because they were logged before the current schema.</div>`;
}

async function loadJson(url) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadAll() {
  try { const market = await loadJson(API_URL); if (market.status === 'unavailable') renderUnavailable(market); else renderMarket(market); } catch (err) { renderUnavailable({ systemStatus: { reason: err.message } }); }
  try { renderWatchlist(await loadJson(`${WATCHLIST_URL}?symbols=${encodeURIComponent(watchlistSymbols.join(','))}`)); } catch (err) { document.getElementById('watchlistStatus').textContent = `Watchlist failed: ${err.message}`; }
  try { renderStockValidation(await loadJson(STOCK_BACKTEST_URL)); } catch (err) { document.getElementById('stockValidationStatus').textContent = `Stock validation failed: ${err.message}`; }
  try { renderBacktest(await loadJson(BACKTEST_URL)); } catch (err) { document.getElementById('backtestStatus').textContent = `Backtest failed: ${err.message}`; }
  try { renderJournal(await loadJson(JOURNAL_URL)); } catch (err) { document.getElementById('journalStatus').textContent = `Journal failed: ${err.message}`; }
  document.getElementById('footerTime').textContent = new Date().toLocaleString();
}

const strategyKey='sibt.options.activeStrategy.v1';
function selectStrategy(strategy,{scroll=false}={}) {
  strategy=strategy==='put'?'put':'call';
  const call=document.getElementById('optionsDesk'),put=document.getElementById('putDesk');
  call.hidden=strategy!=='call'; put.hidden=strategy!=='put';
  document.querySelectorAll('[data-strategy]').forEach(button=>{const active=button.dataset.strategy===strategy;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  try{localStorage.setItem(strategyKey,strategy);}catch{}
  if(scroll)(strategy==='put'?put:call).scrollIntoView({behavior:'smooth',block:'start'});
}
let initialStrategy=location.hash==='#putDesk'?'put':location.hash==='#optionsDesk'?'call':localStorage.getItem(strategyKey)||'call';
selectStrategy(initialStrategy);
document.querySelectorAll('[data-strategy]').forEach(button=>button.addEventListener('click',()=>selectStrategy(button.dataset.strategy)));
document.querySelectorAll('[data-strategy-link]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();selectStrategy(link.dataset.strategy,{scroll:true});history.replaceState(null,'',link.getAttribute('href'));}));
window.addEventListener('sibt:strategy-select',event=>selectStrategy(event.detail?.strategy,{scroll:true}));

loadAll();
setInterval(loadAll, 45000);
