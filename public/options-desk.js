(() => {
  'use strict';
  const root = document.getElementById('optionsDesk');
  const key = 'sibt.mstr.paper.v1';
  const positionKey = 'sibt.mstr.position.v1';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = x => Number.isFinite(x) ? x.toLocaleString('en-US', {style:'currency',currency:'USD'}) : '—';
  let journal = [], storageError = '';
  try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) journal = saved; } catch { storageError = 'Browser storage unavailable or unreadable. Export your journal before leaving.'; }
  const fields = [
    ['shares','MSTR shares owned','number','','1','0'],
    ['cost','Average cost / share ($)','number','','0.01','0.01'],
    ['reserved','Shares already committed to real calls','number','0','1','0'],
    ['contracts','Contracts to evaluate','number','1','1','1'],
    ['minStrike','Lowest willing sale price ($)','number','','0.01','0.01'],
    ['spot','MSTR quote price ($)','number','','0.01','0.01'],
    ['source','Quote source / broker','text','','',''],
    ['asOf','Oldest quote time (your local time)','datetime-local','','',''],
    ['minDte','Minimum days to expiration','number','7','1','1'],
    ['maxDte','Maximum days to expiration','number','45','1','1'],
    ['maxSpread','Maximum spread / midpoint (%)','number','20','0.1','0.1'],
    ['minOi','Minimum open interest','number','100','1','0'],
    ['minPremium','Minimum total net premium ($)','number','0','0.01','0'],
    ['fee','Opening fee / contract ($)','number','0.65','0.01','0']
  ];
  root.innerHTML = `
    <div class="section-heading"><div><div class="metric-label">MSTR · COVERED-CALL DESK</div><h2>Your shares. Your sale price. Your rules.</h2><p class="section-copy">Compare calls against holding your shares. Paper planning only—no brokerage orders.</p></div><span class="pill warn">MANUAL QUOTES</span></div>
    <p class="desk-note">Enter stock and call quotes from the same broker snapshot. No automatic options feed is connected. Quotes are user-entered, not independently verified; a bid is an estimate, not a guaranteed fill. Quotes over 20 minutes old cannot qualify.</p>
    <form id="ccForm">
      <div class="desk-fields">${fields.map(([id,label,type,value,step,min]) => `<label>${label}<input name="${id}" type="${type}" value="${value}" ${step ? `step="${step}" min="${min}"` : ''} ${type === 'text' ? 'maxlength="120"' : ''} required></label>`).join('')}</div>
      <p class="desk-note">Defaults are editable screening settings, not a recommendation. Quote time uses your device’s timezone; days to expiration use the New York calendar. Use the oldest timestamp across the stock and all option bids/asks.</p>
      <label class="desk-check"><input type="checkbox" name="rememberPosition"> Remember my holdings and screening rules in this browser only. Live quotes and option rows are never saved.</label>
      <label class="desk-check"><input type="checkbox" name="standard" required> I checked that every row is an MSTR call delivering exactly 100 MSTR shares—not an adjusted contract.</label>
      <div class="desk-table-wrap"><table class="desk-table"><caption>Broker call quotes · premiums in dollars per share</caption><thead><tr><th>Expiration</th><th>Strike ($)</th><th>Bid ($)</th><th>Ask ($)</th><th>Open interest</th><th></th></tr></thead><tbody id="ccRows"></tbody></table></div>
      <div class="desk-actions"><button type="button" id="ccLoad">Load MSTR chain</button><a id="ccConnect" class="desk-connect" href="/api/schwab/login" hidden>Connect Schwab market data</a><a id="ccDisconnect" class="desk-connect muted" href="/api/schwab/logout" hidden>Disconnect Schwab</a><button type="button" id="ccAdd">+ Add call manually</button><button type="submit" class="desk-primary">Check my calls</button></div><div id="ccFeed" class="desk-note" role="status">Checking automatic market-data connection…</div>
    </form>
    <div id="ccResults" aria-live="polite"><p class="desk-note">Add your holdings and at least one broker quote to start. Nothing is prefilled with assumed market prices.</p></div>
    <details class="desk-details"><summary>How the math works—and what it leaves out</summary><p>One standard call covers 100 shares. Calculations cover only the requested contracts; any remaining shares are excluded. Net premium = bid × 100 × contracts − opening fees. The strike itself must meet your sale-price floor: premium does not override it.</p><p>At expiration, covered-share value is capped at the strike. Scenario P&amp;L = (min(stock price, strike) − starting stock price) × covered shares + net premium. Stock can fall to zero. “Since cost basis” uses your entered average cost, not tax-lot accounting.</p><p>These are mechanical comparisons, not price forecasts or buy/sell advice. Early assignment is possible. Earnings, dividends, taxes, corporate actions, and assignment fees are not modeled. Verify broker option approval and account eligibility. A covered call gives up upside above the strike; a passing filter does not mean it is a good trade.</p><p><a href="https://www.optionseducation.org/strategies/all-strategies/covered-call-buy-write" target="_blank" rel="noopener noreferrer">Covered-call mechanics — Options Industry Council</a></p></details>
    <div class="desk-journal-heading"><h3>MSTR paper journal</h3><button type="button" id="ccExport">Export journal</button></div>
    <p class="desk-note">Entries stay in this browser only—not in the public repository or on a server. They do not sync across devices. Open paper calls reserve shares in this desk. Holdings and rules are saved only when “Remember” is checked; live quotes and option rows are never saved.</p>
    <div id="ccStorage" role="status"></div><div id="ccJournal"></div>`;
  const form = document.getElementById('ccForm');
  const rows = document.getElementById('ccRows');
  let lastResult = null;
  const savedFieldNames = ['shares','cost','reserved','contracts','minStrike','source','minDte','maxDte','maxSpread','minOi','minPremium','fee'];
  function restorePosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey) || 'null');
      if (!saved || typeof saved !== 'object') return;
      for (const name of savedFieldNames) if (saved[name] != null && form.elements[name]) form.elements[name].value = saved[name];
      form.elements.rememberPosition.checked = true;
    } catch { storageError = 'Saved position could not be read. Re-enter it and export any paper journal you need.'; }
  }
  function persistPosition() {
    try {
      if (!form.elements.rememberPosition.checked) { localStorage.removeItem(positionKey); return; }
      const saved = Object.fromEntries(savedFieldNames.map(name => [name, form.elements[name].value]));
      localStorage.setItem(positionKey, JSON.stringify(saved));
    } catch { storageError = 'Position settings could not be saved in this browser.'; }
  }
  restorePosition();
  function addRow(values = {}) {
    if (rows.children.length >= 30) return;
    const tr = document.createElement('tr');
    tr.dataset.quoteAsOf = values.quoteAsOf || '';
    tr.innerHTML = [['expiration','date',''],['strike','number','0.01'],['bid','number','0.01'],['ask','number','0.01'],['oi','number','1']].map(([name,type,step]) => `<td><input aria-label="${name}" data-field="${name}" type="${type}" ${step ? `step="${step}" min="0"` : ''} required></td>`).join('') + '<td><button type="button" aria-label="Remove call">×</button></td>';
    for (const input of tr.querySelectorAll('input')) if (values[input.dataset.field] != null) input.value = values[input.dataset.field];
    tr.querySelector('button').addEventListener('click', () => { tr.remove(); invalidate(); });
    rows.appendChild(tr); invalidate();
  }
  function invalidate() {
    lastResult = null;
    document.getElementById('ccResults').textContent = 'Inputs changed. Check your calls to refresh the comparison.';
  }
  form.addEventListener('input', () => { persistPosition(); invalidate(); renderJournal(); });
  document.getElementById('ccAdd').addEventListener('click', addRow);
  function localDateTime(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  async function loadChain({probe = false} = {}) {
    const button = document.getElementById('ccLoad');
    const status = document.getElementById('ccFeed');
    const connect = document.getElementById('ccConnect');
    const disconnect = document.getElementById('ccDisconnect');
    const minStrike = Number(form.elements.minStrike.value);
    if (!probe && !(minStrike > 0)) { status.textContent = 'Enter your lowest willing sale price before loading the chain.'; form.elements.minStrike.focus(); return; }
    button.disabled = true;
    status.textContent = probe ? 'Checking automatic feed…' : 'Loading current MSTR calls…';
    try {
      const query = probe ? new URLSearchParams({probe:'1'}) : new URLSearchParams({ minDte: form.elements.minDte.value || '7', maxDte: form.elements.maxDte.value || '45', minStrike: String(minStrike || 0) });
      const response = await fetch(`/api/options/mstr?${query}`);
      const data = await response.json();
      if (!response.ok || data.status !== 'ok') {
        connect.hidden = !data.connectUrl;
        if (data.connectUrl) connect.href = data.connectUrl;
        disconnect.hidden = true;
        throw new Error(data.error || `Feed returned HTTP ${response.status}`);
      }
      connect.hidden = true;
      disconnect.hidden = data.provider !== 'Schwab';
      if (probe) {
        root.querySelector('.pill').textContent = data.provider === 'Schwab' ? 'SCHWAB CONNECTED' : 'AUTOMATIC DATA';
        root.querySelector('.pill').className = 'pill ok';
        status.textContent = `${data.provider} automatic market data is ready${data.delayed ? ' (15-minute delayed sandbox)' : ''}. Enter your sale-price floor, then load the chain.`;
        return;
      }
      const selected = (data.calls || []).filter(c => c.strike >= minStrike).slice(0, 30);
      if (!selected.length) throw new Error('No standard MSTR calls matched that strike and expiration range.');
      rows.replaceChildren();
      selected.forEach(c => addRow({expiration:c.expiration,strike:c.strike,bid:c.bid,ask:c.ask,oi:c.oi,quoteAsOf:c.quoteAsOf}));
      if (data.underlying?.price > 0) form.elements.spot.value = data.underlying.price;
      form.elements.source.value = `${data.provider}${data.delayed ? ' sandbox (15-minute delayed)' : ' market-data API'}`;
      form.elements.asOf.value = data.underlying?.quoteAsOf ? localDateTime(data.underlying.quoteAsOf) : '';
      status.textContent = `Loaded ${selected.length} standard calls across ${data.expirations.length} expiration(s). Retrieved ${new Date(data.retrievedAt).toLocaleString()}${data.marketStatus && data.marketStatus !== 'MARKET OPEN' ? ` · ${data.marketStatus}: planning only` : ''}. Review every quote before checking.`;
      lastResult = null;
    } catch (err) {
      status.textContent = `Automatic chain unavailable: ${err.message} Manual broker entry remains available.`;
    } finally { button.disabled = false; }
  }
  document.getElementById('ccLoad').addEventListener('click', () => loadChain());
  function read() {
    const position = Object.fromEntries(new FormData(form));
    position.standard = form.elements.standard.checked;
    position.asOf = position.asOf ? new Date(position.asOf).toISOString() : '';
    position.reserved = position.reserved === '' ? '' : Number(position.reserved) + journal.filter(j => !j.closed).reduce((n,j) => n + Number(j.position.contracts) * 100, 0);
    const calls = [...rows.children].map(tr => ({...Object.fromEntries([...tr.querySelectorAll('input')].map(i => [i.dataset.field, i.value])), quoteAsOf: tr.dataset.quoteAsOf || ''}));
    return {position, calls};
  }
  function analyze() {
    const {position, calls} = read();
    const result = CoveredCall.evaluate(position, calls);
    lastResult = {position, result};
    const target = document.getElementById('ccResults');
    const title = result.eligibleCount ? `${result.eligibleCount} candidate(s) meet your entered filters` : 'No suitable trade from these inputs';
    target.innerHTML = `<div class="banner ${result.eligibleCount ? 'ok' : 'warn'}"><strong>${title}</strong><p>${result.capacity} covered contract(s) available after committed and open paper shares. Passing is not a recommendation.</p></div>
      ${result.errors.length ? `<ul class="desk-errors">${result.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      ${!calls.length ? '<p class="desk-note">Add at least one call quote.</p>' : ''}
      <p class="desk-note">Source: ${esc(position.source || 'missing')} · Quote time: ${esc(position.asOf || 'missing')} · Assumed sale at bid · No probability-of-profit estimates.</p>
      <div class="desk-candidates">${result.rows.map((c,i) => `<article class="subcard desk-candidate"><h3>${esc(c.expiration || 'Missing expiration')} · $${esc(c.strike || '—')} call</h3><p class="desk-note">${Number.isFinite(c.dte) ? c.dte : '—'} calendar days · Spread ${c.spread == null ? '—' : c.spread.toFixed(1) + '%'} · ${c.eligible ? 'MEETS FILTERS' : 'DOES NOT QUALIFY'}${c.quoteAsOf ? ` · Quote ${esc(new Date(c.quoteAsOf).toLocaleString())}` : ''}</p>
        ${c.reasons.length ? `<ul class="desk-errors">${c.reasons.filter(r => !result.errors.includes(r)).map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${c.metrics ? `<div class="kv"><span>Estimated net premium</span><strong>${money(c.metrics.netPremium)}</strong></div><div class="kv"><span>Max P&amp;L from quote price</span><span>${money(c.metrics.maxPnlNow)}</span></div><div class="kv"><span>Max P&amp;L since cost basis</span><span>${money(c.metrics.maxPnlCost)}</span></div><div class="kv"><span>Cost-basis breakeven / share</span><span>${money(c.metrics.breakevenCost)}</span></div><div class="kv"><span>Loss from quote price if stock hits $0</span><span>${money(c.metrics.lossAtZeroNow)}</span></div>
        <details class="desk-details"><summary>Expiration scenarios vs. holding ${c.metrics.shares} shares</summary><div class="desk-table-wrap"><table class="desk-table"><thead><tr><th>MSTR ends at</th><th>Hold P&amp;L</th><th>Covered P&amp;L</th><th>Difference</th></tr></thead><tbody>${c.metrics.scenarios.map(s => `<tr><td>${money(s.price)}</td><td>${money(s.hold)}</td><td>${money(s.covered)}</td><td>${money(s.difference)}</td></tr>`).join('')}</tbody></table></div><p>Measured from the entered stock quote, not cost basis. Hypothetical expiration prices—not predictions. Closing, assignment fees and taxes excluded.</p></details>` : ''}
        <button type="button" data-log="${i}" ${c.eligible ? '' : 'disabled'}>Log paper call at bid</button></article>`).join('')}</div>`;
    target.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => {
      const fresh = read();
      const candidate = CoveredCall.evaluate(fresh.position, fresh.calls).rows[Number(b.dataset.log)];
      if (!candidate?.eligible) { analyze(); return; }
      journal.push({id: crypto.randomUUID(), symbol:'MSTR', openedAt:new Date().toISOString(), position:fresh.position, call:fresh.calls[Number(b.dataset.log)], metrics:candidate.metrics, fillAssumption:'bid; simulated; not an execution'});
      persist(); renderJournal(); analyze();
    }));
  }
  form.addEventListener('submit', e => { e.preventDefault(); analyze(); });
  // Recheck age rather than leaving a qualifying quote green indefinitely.
  setInterval(() => { if (lastResult) analyze(); }, 30000);
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(journal)); storageError = ''; }
    catch { storageError = 'Journal could not be saved in this browser. Export it now to keep your entries.'; }
  }
  function renderJournal() {
    document.getElementById('ccStorage').textContent = storageError;
    const closed = journal.filter(j => j.closed);
    const open = journal.filter(j => !j.closed);
    const panel = document.getElementById('ccJournal');
    panel.innerHTML = `<p class="desk-note">${open.length} open · ${closed.length} closed · Closed-trade P&amp;L from entry: ${money(closed.reduce((sum,j) => sum + j.closed.result.totalPnl, 0))}. Open positions are unmarked and excluded; this is not total portfolio performance.</p>` + journal.slice().reverse().map(j => `<article class="subcard desk-candidate"><h4>${esc(j.call.expiration)} · $${esc(j.call.strike)} call · ${esc(j.position.contracts)} contract(s) · ${j.closed ? 'CLOSED' : 'OPEN (not marked)'}</h4><p class="desk-note">Paper entry ${esc(new Date(j.openedAt).toLocaleString())} · Source ${esc(j.position.source)} · Net entry premium ${money(j.metrics.netPremium)}</p>${j.closed ? `<div class="kv"><span>Stock P&amp;L from entry</span><span>${money(j.closed.result.stockPnl)}</span></div><div class="kv"><span>Option P&amp;L after fees</span><span>${money(j.closed.result.optionPnl)}</span></div><div class="kv"><strong>Combined P&amp;L from entry</strong><strong>${money(j.closed.result.totalPnl)}</strong></div><div class="kv"><span>Hold-only benchmark</span><span>${money(j.closed.result.holdPnl)}</span></div><div class="kv"><span>Combined P&amp;L since cost basis</span><span>${money(j.closed.result.totalPnlCost)}</span></div>` : `<form data-close="${esc(j.id)}" class="desk-close"><p class="desk-note">Simulate closing both legs at the same time. Enter the stock sale price and call buyback ask, even if the call is in the money. This does not model assignment or automatic expiry.</p><div class="desk-fields"><label>MSTR exit price ($)<input name="stock" type="number" min="0" step="0.01" required></label><label>Call buyback / share ($)<input name="buyback" type="number" min="0" step="0.01" required></label><label>Closing fee / contract ($)<input name="fee" type="number" min="0" step="0.01" value="0.65" required></label></div><button type="submit">Record paper close</button></form>`}</article>`).join('');
    panel.querySelectorAll('[data-close]').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const j = journal.find(x => x.id === f.dataset.close);
      if (!j || j.closed) return;
      const data = Object.fromEntries(new FormData(f));
      j.closed = {at:new Date().toISOString(), inputs:data, result:CoveredCall.closePaper(j, data.stock, data.buyback, data.fee)};
      persist(); renderJournal(); if (lastResult) analyze();
    }));
  }
  document.getElementById('ccExport').addEventListener('click', () => {
    const href = URL.createObjectURL(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),journal},null,2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = href; a.download = 'mstr-paper-journal.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  });
  addRow(); renderJournal(); loadChain({probe:true});
})();
