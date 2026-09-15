(() => {
  'use strict';
  const root = document.getElementById('putDesk');
  if (!root) return;
  const journalKey = 'sibt.puts.paper.v1';
  const settingsKey = 'sibt.puts.positions.v1';
  const callJournalKey = 'sibt.options.paper.v2';
  const lastSymbolKey = 'sibt.options.lastSymbol.v2';
  const esc = x => String(x ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = x => Number.isFinite(Number(x)) ? Number(x).toLocaleString('en-US',{style:'currency',currency:'USD'}) : '—';
  const ticker = value => String(value || '').trim().toUpperCase();
  const validTicker = value => /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker(value));
  let journal = [], settings = {}, callJournal = [], storageError = '';
  try {
    journal = JSON.parse(localStorage.getItem(journalKey) || '[]');
    settings = JSON.parse(localStorage.getItem(settingsKey) || '{}') || {};
    callJournal = JSON.parse(localStorage.getItem(callJournalKey) || '[]');
    if (!Array.isArray(journal)) journal = [];
    if (!Array.isArray(callJournal)) callJournal = [];
  } catch { storageError = 'Browser storage unavailable or unreadable. Export your journal before leaving.'; }
  let activeSymbol = validTicker(localStorage.getItem(lastSymbolKey)) ? ticker(localStorage.getItem(lastSymbolKey)) : 'MSTR';
  let eventState = {status:'unknown',date:null,estimated:false,source:'',note:'Load the put chain to check the earnings calendar.'};
  let entryState = {label:'UNKNOWN',level:'unknown',reason:'Load the put chain to check stock-entry posture.',setupScore:null,marketPermission:'UNKNOWN'};
  let lastResult = null;
  const fields = [
    ['symbol','Ticker','text',activeSymbol,'',''],['cash','Cash available for assignment ($)','number','','0.01','0'],
    ['committedCash','Cash already committed to real puts ($)','number','0','0.01','0'],['contracts','Contracts to evaluate','number','1','1','1'],
    ['maxStrike','Highest willing purchase price ($)','number','','0.01','0.01'],['spot','Stock quote price ($)','number','','0.01','0.01'],
    ['source','Quote source / broker','text','','',''],['asOf','Stock quote time (your local time)','datetime-local','','',''],
    ['minDte','Minimum days to expiration','number','7','1','1'],['maxDte','Maximum days to expiration','number','45','1','1'],
    ['maxSpread','Maximum spread / midpoint (%)','number','20','0.1','0.1'],['minOi','Minimum open interest','number','100','1','0'],
    ['minPremium','Minimum total net premium ($)','number','0','0.01','0'],['fee','Opening fee / contract ($)','number','0.65','0.01','0']
  ];
  root.innerHTML = `
    <div class="section-heading"><div><div class="metric-label"><span data-put-symbol>${esc(activeSymbol)}</span> · CASH-SECURED-PUT DESK</div><h2>Your cash. Your buy price. Your rules.</h2><p class="section-copy">Get paid while waiting to buy shares at an acceptable strike. Paper planning only—no brokerage orders.</p></div><span class="pill warn">MANUAL QUOTES</span></div>
    <p class="desk-note">One standard put can obligate you to buy 100 shares at the strike at any time before expiration. This desk requires the full strike value in cash and never treats premium as permission to exceed your purchase-price ceiling.</p>
    <form id="cspForm">
      <div class="desk-fields">${fields.map(([id,label,type,value,step,min]) => `<label>${label}<input name="${id}" type="${type}" value="${value}" ${step ? `step="${step}" min="${min}"` : ''} ${type === 'text' ? 'maxlength="120"' : ''} required></label>`).join('')}</div>
      <section class="subcard desk-event"><div><div class="metric-label">STOCK-ENTRY GATE</div><strong id="cspEntryStatus">UNKNOWN</strong><p id="cspEntryNote" class="desk-note">Load the put chain to evaluate the stock setup and broad-market permission.</p></div><div><div class="metric-label">SCHEDULED EVENT RISK</div><strong id="cspEventStatus">Not checked</strong><p id="cspEventNote" class="desk-note">Load the put chain to check the earnings calendar.</p></div></section>
      <label class="desk-check"><input type="checkbox" name="requireEligible" checked> Exclude puts when stock-entry posture is NOT ELIGIBLE or UNKNOWN. CAUTION remains eligible but loses 12 ranking points.</label>
      <label class="desk-check"><input type="checkbox" name="avoidEvent" checked> Exclude puts expiring on or after the known earnings/company-event date. If unchecked, crossing puts lose 25 ranking points.</label>
      <label class="desk-fields desk-single">Manual earnings/company-event date override<input name="manualEventDate" type="date"><small>Optional; browser-only when settings are remembered.</small></label>
      <div id="cspWheelSeed" class="desk-note"></div>
      <label class="desk-check"><input type="checkbox" name="rememberSettings"> Remember my cash limits and screening rules in this browser only. Live quotes and put rows are never saved.</label>
      <label class="desk-check"><input type="checkbox" name="standard" required> I checked that every row is a standard put representing exactly 100 shares—not an adjusted contract.</label>
      <div class="desk-table-wrap"><table class="desk-table"><caption>Broker put quotes · premiums in dollars per share</caption><thead><tr><th>Expiration</th><th>Strike ($)</th><th>Bid ($)</th><th>Ask ($)</th><th>Open interest</th><th></th></tr></thead><tbody id="cspRows"></tbody></table></div>
      <div class="desk-actions"><button type="button" id="cspLoad">Load ${esc(activeSymbol)} puts</button><a id="cspConnect" class="desk-connect" href="/api/schwab/login" hidden>Connect Schwab market data</a><button type="button" id="cspAdd">+ Add put manually</button><button type="submit" class="desk-primary">Check my puts</button></div><div id="cspFeed" class="desk-note" role="status">Checking automatic market-data connection…</div>
    </form>
    <div id="cspResults" aria-live="polite"><p class="desk-note">Enter your cash, purchase-price ceiling, and at least one put quote to start.</p></div>
    <details class="desk-details"><summary>How the put math works—and what it leaves out</summary><p>Cash required = strike × 100 × contracts. Net premium = bid × 100 × contracts − opening fees. Effective purchase price = strike − net premium per share. Maximum option profit is the net premium; maximum loss assumes assignment followed by the stock falling to zero.</p><p>Assignment may occur before expiration. Known earnings can be excluded or penalized, but estimates may change and unscheduled news cannot be predicted. Taxes, interest on reserved cash, dividends, corporate actions, assignment fees, and slippage are excluded.</p><p><a href="https://www.optionseducation.org/strategies/all-strategies/cash-secured-put" target="_blank" rel="noopener noreferrer">Cash-secured-put mechanics — Options Industry Council</a></p></details>
    <div class="desk-journal-heading"><h3><span data-put-symbol>${esc(activeSymbol)}</span> put / wheel paper journal</h3><button type="button" id="cspExport">Export journal</button></div>
    <p class="desk-note">Open paper puts reserve cash here. Called-away covered calls can seed the cash and ceiling fields, but nothing changes a brokerage account or real holding.</p><div id="cspStorage" role="status"></div><div id="cspJournal"></div>`;
  const form = document.getElementById('cspForm');
  const rows = document.getElementById('cspRows');
  const savedNames = ['cash','committedCash','contracts','maxStrike','source','minDte','maxDte','maxSpread','minOi','minPremium','fee','manualEventDate','requireEligible','avoidEvent'];
  function localDateTime(iso) { const d = new Date(iso); return Number.isFinite(d.getTime()) ? new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16) : ''; }
  function persistJournal() { try { localStorage.setItem(journalKey,JSON.stringify(journal)); storageError=''; } catch { storageError='Put journal could not be saved. Export it now.'; } }
  function persistSettings() {
    try {
      if (!form.elements.rememberSettings.checked) { delete settings[activeSymbol]; localStorage.setItem(settingsKey,JSON.stringify(settings)); return; }
      const saved = Object.fromEntries(savedNames.filter(n => !['requireEligible','avoidEvent'].includes(n)).map(n => [n,form.elements[n].value]));
      saved.requireEligible=form.elements.requireEligible.checked; saved.avoidEvent=form.elements.avoidEvent.checked;
      settings[activeSymbol]=saved; localStorage.setItem(settingsKey,JSON.stringify(settings));
    } catch { storageError='Put settings could not be saved in this browser.'; }
  }
  function restoreSettings(symbol=activeSymbol) {
    form.elements.spot.value=''; form.elements.asOf.value=''; form.elements.standard.checked=false;
    const saved=settings[symbol];
    if (!saved) {
      ['cash','maxStrike','spot','source','asOf','manualEventDate'].forEach(n => form.elements[n].value='');
      form.elements.committedCash.value='0'; form.elements.contracts.value='1'; form.elements.requireEligible.checked=true; form.elements.avoidEvent.checked=true; form.elements.rememberSettings.checked=false; return;
    }
    for (const n of savedNames) if (!['requireEligible','avoidEvent'].includes(n) && saved[n] != null) form.elements[n].value=saved[n];
    form.elements.requireEligible.checked=saved.requireEligible!==false; form.elements.avoidEvent.checked=saved.avoidEvent!==false; form.elements.rememberSettings.checked=true;
  }
  function renderLabels() { root.querySelectorAll('[data-put-symbol]').forEach(n => n.textContent=activeSymbol); document.getElementById('cspLoad').textContent=`Load ${activeSymbol} puts`; }
  function renderRisk() {
    document.getElementById('cspEntryStatus').textContent=`${entryState.label} · setup ${entryState.setupScore ?? '—'} · market ${entryState.marketPermission || 'UNKNOWN'}`;
    document.getElementById('cspEntryNote').textContent=entryState.reason || 'No entry signal available.';
    const manual=form.elements.manualEventDate.value, date=manual || eventState.date;
    document.getElementById('cspEventStatus').textContent=manual ? `${manual} · MANUAL OVERRIDE` : eventState.status==='estimated' && date ? `${date} · ESTIMATED EARNINGS` : eventState.status==='unavailable' ? 'Calendar unavailable' : 'No estimate returned';
    document.getElementById('cspEventNote').textContent=manual ? 'This browser-only date overrides the automatic earnings estimate.' : `${eventState.note || 'No known date.'}${date ? '' : ' Unknown does not mean event-free.'}`;
  }
  function latestCalledAway() { return callJournal.filter(j => ticker(j.symbol)===activeSymbol && j.closed?.type==='assigned').sort((a,b) => String(b.closed.at).localeCompare(String(a.closed.at)))[0] || null; }
  function renderWheelSeed() {
    const host=document.getElementById('cspWheelSeed'), seed=latestCalledAway();
    if (!seed) { host.innerHTML='No called-away paper shares recorded for this ticker.'; return; }
    const proceeds=Number(seed.call.strike)*Number(seed.position.contracts)*100;
    host.innerHTML=`Latest called-away paper entry: ${esc(seed.closed.at ? new Date(seed.closed.at).toLocaleString() : 'unknown time')} · ${esc(seed.position.contracts)} contract(s) at ${money(seed.call.strike)} · gross proceeds ${money(proceeds)}. <button type="button" id="cspUseSeed">Use these proceeds and strike</button>`;
    document.getElementById('cspUseSeed').addEventListener('click',()=>{ form.elements.cash.value=proceeds; form.elements.maxStrike.value=seed.call.strike; form.elements.contracts.value=seed.position.contracts; persistSettings(); invalidate(); });
  }
  function addRow(values={}) {
    if (rows.children.length>=30) return;
    const tr=document.createElement('tr'); tr.dataset.quoteAsOf=values.quoteAsOf||''; tr.dataset.delta=values.delta??''; tr.dataset.iv=values.iv??''; tr.dataset.volume=values.volume??'';
    tr.innerHTML=[['expiration','date',''],['strike','number','0.01'],['bid','number','0.01'],['ask','number','0.01'],['oi','number','1']].map(([name,type,step])=>`<td><input aria-label="${name}" data-field="${name}" type="${type}" ${step ? `step="${step}" min="0"` : ''} required></td>`).join('')+'<td><button type="button" aria-label="Remove put">×</button></td>';
    for (const input of tr.querySelectorAll('input')) if (values[input.dataset.field]!=null) input.value=values[input.dataset.field];
    tr.querySelector('button').addEventListener('click',()=>{tr.remove();invalidate();}); rows.appendChild(tr); invalidate();
  }
  function invalidate() { lastResult=null; document.getElementById('cspResults').textContent='Inputs changed. Check your puts to refresh the comparison.'; }
  function switchSymbol(value) {
    const next=ticker(value); if (!validTicker(next)) { document.getElementById('cspFeed').textContent='Enter a valid stock or ETF ticker.'; return; }
    activeSymbol=next; form.elements.symbol.value=next; localStorage.setItem(lastSymbolKey,next); eventState={status:'unknown',date:null,estimated:false,source:'',note:'Load the put chain to check the earnings calendar.'}; entryState={label:'UNKNOWN',level:'unknown',reason:'Load the put chain to check stock-entry posture.',setupScore:null,marketPermission:'UNKNOWN'};
    restoreSettings(next); renderLabels(); renderRisk(); renderWheelSeed(); rows.replaceChildren(); addRow(); renderJournal(); invalidate();
  }
  form.addEventListener('input',event=>{ if(event.target.name!=='symbol') persistSettings(); if(event.target.name==='manualEventDate') renderRisk(); invalidate(); renderJournal(); });
  form.elements.symbol.addEventListener('change',()=>switchSymbol(form.elements.symbol.value));
  document.getElementById('cspAdd').addEventListener('click',()=>addRow());
  async function loadChain({probe=false}={}) {
    const button=document.getElementById('cspLoad'), status=document.getElementById('cspFeed'), connect=document.getElementById('cspConnect'), symbol=ticker(form.elements.symbol.value);
    if (!probe && !validTicker(symbol)) { status.textContent='Enter a valid stock or ETF ticker.'; return; }
    const maxStrike=Number(form.elements.maxStrike.value); if(!probe && !(maxStrike>0)){status.textContent='Enter your highest willing purchase price before loading puts.';form.elements.maxStrike.focus();return;}
    if(!probe && symbol!==activeSymbol) switchSymbol(symbol);
    button.disabled=true; status.textContent=probe?'Checking automatic feed…':`Loading current ${symbol} puts and entry posture…`;
    try {
      const query=probe ? new URLSearchParams({probe:'1',symbol:activeSymbol,type:'put'}) : new URLSearchParams({symbol,type:'put',minDte:form.elements.minDte.value||'7',maxDte:form.elements.maxDte.value||'45',maxStrike:String(maxStrike)});
      const requests=[fetch(`/api/options/chain?${query}`)]; if(!probe) requests.push(fetch(`/api/watchlist?symbols=${encodeURIComponent(symbol)}`));
      const responses=await Promise.all(requests), data=await responses[0].json();
      if(!responses[0].ok||data.status!=='ok'){connect.hidden=!data.connectUrl;if(data.connectUrl)connect.href=data.connectUrl;throw new Error(data.error||`Feed returned HTTP ${responses[0].status}`);}
      connect.hidden=true;
      if(probe){root.querySelector('.pill').textContent=data.provider==='Schwab'?'SCHWAB CONNECTED':'AUTOMATIC DATA';root.querySelector('.pill').className='pill ok';status.textContent=`${data.provider} automatic market data is ready. Enter your cash and purchase ceiling, then load puts.`;return;}
      const watch=responses[1].ok?await responses[1].json():null, stock=watch?.stocks?.[0];
      entryState=stock ? {label:stock.signal?.label||'UNKNOWN',level:stock.signal?.level||'unknown',reason:stock.signal?.reason||stock.signal?.shortReason||'No reason returned.',setupScore:stock.setupScore,marketPermission:watch.marketPermission||'UNKNOWN'} : {label:'UNKNOWN',level:'unknown',reason:'Stock-entry data unavailable. Unknown is excluded by default.',setupScore:null,marketPermission:'UNKNOWN'};
      const selected=(data.puts||[]).filter(p=>p.strike<=maxStrike).sort((a,b)=>a.expiration.localeCompare(b.expiration)||b.strike-a.strike).slice(0,30);
      if(!selected.length) throw new Error(`No standard ${symbol} puts matched that price and expiration range.`);
      rows.replaceChildren(); selected.forEach(p=>addRow(p)); if(data.underlying?.price>0)form.elements.spot.value=data.underlying.price;
      form.elements.source.value=`${data.provider}${data.delayed?' sandbox (15-minute delayed)':' market-data API'}`; form.elements.asOf.value=data.underlying?.quoteAsOf?localDateTime(data.underlying.quoteAsOf):'';
      eventState=data.eventRisk||{status:'unknown',date:null,estimated:false,source:'',note:'No earnings-calendar result was returned.'}; renderRisk();
      status.textContent=`Loaded ${selected.length} standard puts across ${data.expirations.length} expiration(s). Retrieved ${new Date(data.retrievedAt).toLocaleString()}${data.marketStatus&&data.marketStatus!=='MARKET OPEN'?` · ${data.marketStatus}: planning only`:''}. Review every quote before checking.`;
    } catch(err){status.textContent=`Automatic put chain unavailable: ${err.message} Manual broker entry remains available.`;} finally{button.disabled=false;}
  }
  document.getElementById('cspLoad').addEventListener('click',()=>loadChain());
  function read() {
    const position=Object.fromEntries(new FormData(form)); position.symbol=ticker(position.symbol); position.standard=form.elements.standard.checked; position.avoidEvent=form.elements.avoidEvent.checked; position.requireEligible=form.elements.requireEligible.checked;
    position.entryLabel=entryState.label; position.eventDate=position.manualEventDate||eventState.date||''; position.eventSource=position.manualEventDate?'Manual override':eventState.source||''; position.eventEstimated=!position.manualEventDate&&eventState.estimated===true; position.asOf=position.asOf?new Date(position.asOf).toISOString():'';
    const openPaper=journal.filter(j=>!j.closed&&ticker(j.symbol)===position.symbol).reduce((sum,j)=>sum+Number(j.metrics.cashRequired),0); position.committedCash=position.committedCash===''?'':Number(position.committedCash)+openPaper;
    const puts=[...rows.children].map(tr=>({...Object.fromEntries([...tr.querySelectorAll('input')].map(i=>[i.dataset.field,i.value])),quoteAsOf:tr.dataset.quoteAsOf||'',delta:tr.dataset.delta===''?null:Number(tr.dataset.delta),iv:tr.dataset.iv===''?null:Number(tr.dataset.iv),volume:tr.dataset.volume===''?null:Number(tr.dataset.volume)}));
    return {position,puts};
  }
  function analyze() {
    const {position,puts}=read(), result=CashSecuredPut.evaluate(position,puts), ranking=CashSecuredPut.rankCandidates(result,position); lastResult={position,result,ranking};
    const target=document.getElementById('cspResults'), title=result.eligibleCount?`${result.eligibleCount} candidate(s) meet your entered filters`:'NO TRADE from these inputs';
    target.innerHTML=`<div class="banner ${result.eligibleCount?'ok':'warn'}"><strong>${title}</strong><p>${money(result.availableCash)} remains available after real and open paper obligations. Passing is not a recommendation.</p></div>${result.errors.length?`<ul class="desk-errors">${result.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:''}<p class="desk-note">${esc(position.symbol)} · Entry posture ${esc(position.entryLabel)} · Source ${esc(position.source||'missing')} · Assumed sale at bid · Assignment can occur early.</p>
      <section class="desk-engine"><h3>Put selection engine</h3><p class="desk-note">Scores rank only puts passing every hard filter. They are relative trade-off ratings—not confidence, expected return, or probability of profit.</p>${ranking.status==='ok'?`<div class="desk-rankings">${ranking.profiles.map(profile=>{const p=profile.winner;return `<article class="subcard desk-ranking"><div class="metric-label">${esc(profile.label)}</div><strong>${esc(p.expiration)} · ${money(p.strike)} put</strong><div class="engine-score">${p.decisionScore}<small>/100 decision score</small></div><div class="kv"><span>Delta</span><span>${Math.abs(Number(p.delta)).toFixed(2)}</span></div><div class="kv"><span>Effective buy price</span><span>${money(p.metrics.effectivePrice)}</span></div><div class="kv"><span>Annualized cash yield</span><span>${p.metrics.annualizedPremiumYieldPct.toFixed(1)}%</span></div><div class="kv"><span>Discount to spot</span><span>${p.metrics.discountToSpotPct.toFixed(1)}%</span></div><div class="kv"><span>Cash required</span><span>${money(p.metrics.cashRequired)}</span></div><div class="kv"><span>Disclosed penalties</span><span>${p.eventPenalty+p.entryPenalty} pts</span></div></article>`;}).join('')}</div>`:`<div class="banner warn"><strong>Ranking unavailable</strong><p>${esc(ranking.reason)}</p></div>`}</section>
      <div class="desk-candidates">${result.rows.map((p,i)=>`<article class="subcard desk-candidate"><h3>${esc(p.expiration||'Missing expiration')} · ${money(p.strike)} put</h3><p class="desk-note">${Number.isFinite(p.dte)?p.dte:'—'} calendar days · Spread ${p.spread==null?'—':p.spread.toFixed(1)+'%'} · ${p.eligible?'MEETS FILTERS':'DOES NOT QUALIFY'}${p.quoteAsOf?` · Quote ${esc(new Date(p.quoteAsOf).toLocaleString())}`:''}</p>${p.reasons.length?`<ul class="desk-errors">${p.reasons.filter(r=>!result.errors.includes(r)).map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}${p.metrics?`<div class="kv"><span>Cash reserved</span><strong>${money(p.metrics.cashRequired)}</strong></div><div class="kv"><span>Net premium / max profit</span><span>${money(p.metrics.netPremium)}</span></div><div class="kv"><span>Effective assignment price</span><span>${money(p.metrics.effectivePrice)}</span></div><div class="kv"><span>Maximum loss if stock reaches $0</span><span>${money(p.metrics.maxLoss)}</span></div><div class="kv"><span>Annualized yield on cash</span><span>${p.metrics.annualizedPremiumYieldPct.toFixed(1)}%</span></div><details class="desk-details"><summary>Expiration scenarios vs. buying ${p.metrics.shares} shares now</summary><div class="desk-table-wrap"><table class="desk-table"><thead><tr><th>${esc(position.symbol)} ends at</th><th>Put P&amp;L</th><th>Buy-now P&amp;L</th><th>Difference</th></tr></thead><tbody>${p.metrics.scenarios.map(s=>`<tr><td>${money(s.price)}</td><td>${money(s.put)}</td><td>${money(s.buyNow)}</td><td>${money(s.difference)}</td></tr>`).join('')}</tbody></table></div></details>`:''}<button type="button" data-log-put="${i}" ${p.eligible?'':'disabled'}>Log paper put at bid</button></article>`).join('')}</div>`;
    target.querySelectorAll('[data-log-put]').forEach(button=>button.addEventListener('click',()=>{const fresh=read(), candidate=CashSecuredPut.evaluate(fresh.position,fresh.puts).rows[Number(button.dataset.logPut)];if(!candidate?.eligible){analyze();return;}journal.push({id:crypto.randomUUID(),symbol:fresh.position.symbol,openedAt:new Date().toISOString(),position:fresh.position,put:fresh.puts[Number(button.dataset.logPut)],metrics:candidate.metrics,fillAssumption:'bid; simulated; not an execution'});persistJournal();renderJournal();analyze();}));
  }
  form.addEventListener('submit',event=>{event.preventDefault();analyze();}); setInterval(()=>{if(lastResult)analyze();},30000);
  function renderJournal() {
    document.getElementById('cspStorage').textContent=storageError; const items=journal.filter(j=>ticker(j.symbol)===activeSymbol), open=items.filter(j=>!j.closed), closed=items.filter(j=>j.closed);
    document.getElementById('cspJournal').innerHTML=`<p class="desk-note">${open.length} open · ${closed.length} closed/assigned · Open cash obligation ${money(open.reduce((s,j)=>s+Number(j.metrics.cashRequired),0))}. Closed option P&amp;L ${money(closed.filter(j=>j.closed.type==='closed').reduce((s,j)=>s+Number(j.closed.result.optionPnl),0))}; assigned shares remain exposed to stock risk.</p>${items.slice().reverse().map(j=>`<article class="subcard desk-candidate"><h4>${esc(j.symbol)} · ${esc(j.put.expiration)} · ${money(j.put.strike)} put · ${esc(j.position.contracts)} contract(s) · ${j.closed?j.closed.type.toUpperCase():'OPEN'}</h4><p class="desk-note">Paper entry ${esc(new Date(j.openedAt).toLocaleString())} · Net premium ${money(j.metrics.netPremium)} · Cash reserved ${money(j.metrics.cashRequired)}</p>${!j.closed?`<form data-close-put="${esc(j.id)}" class="desk-close"><div class="desk-fields"><label>Put buyback / share ($)<input name="buyback" type="number" min="0" step="0.01" required></label><label>Closing fee / contract ($)<input name="fee" type="number" min="0" step="0.01" value="0.65" required></label></div><button type="submit">Record paper close</button> <button type="button" data-assign-put="${esc(j.id)}">Record assignment</button></form>`:j.closed.type==='assigned'?`<div class="kv"><span>Shares acquired</span><span>${j.closed.result.shares}</span></div><div class="kv"><span>Effective basis</span><span>${money(j.closed.result.effectivePrice)}</span></div><div class="kv"><span>Marked P&amp;L at assignment</span><span>${money(j.closed.result.markedPnl)}</span></div>`:`<div class="kv"><span>Option P&amp;L</span><span>${money(j.closed.result.optionPnl)}</span></div>`}</article>`).join('')}`;
    const panel=document.getElementById('cspJournal');
    panel.querySelectorAll('[data-close-put]').forEach(close=>close.addEventListener('submit',event=>{event.preventDefault();const j=journal.find(x=>x.id===close.dataset.closePut);if(!j||j.closed)return;const data=Object.fromEntries(new FormData(close));j.closed={type:'closed',at:new Date().toISOString(),inputs:data,result:CashSecuredPut.closePaper(j,data.buyback,data.fee)};persistJournal();renderJournal();if(lastResult)analyze();}));
    panel.querySelectorAll('[data-assign-put]').forEach(button=>button.addEventListener('click',()=>{const j=journal.find(x=>x.id===button.dataset.assignPut);if(!j||j.closed)return;const stock=prompt(`Current ${j.symbol} price at assignment:`,String(j.put.strike));if(stock===null)return;try{j.closed={type:'assigned',at:new Date().toISOString(),result:CashSecuredPut.assignPaper(j,stock)};persistJournal();renderJournal();if(lastResult)analyze();}catch(err){storageError=err.message;renderJournal();}}));
  }
  document.getElementById('cspExport').addEventListener('click',()=>{const href=URL.createObjectURL(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),putJournal:journal,calledAwayCalls:callJournal.filter(j=>j.closed?.type==='assigned')},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=href;a.download='wheel-paper-journal.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});
  window.addEventListener('sibt:call-assigned',()=>{try{callJournal=JSON.parse(localStorage.getItem(callJournalKey)||'[]');}catch{callJournal=[];}renderWheelSeed();});
  restoreSettings(); renderLabels(); renderRisk(); renderWheelSeed(); addRow(); renderJournal(); loadChain({probe:true});
})();
