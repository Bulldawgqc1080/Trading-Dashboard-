(function (root) {
  'use strict';
  function sampleAcrossExpirations(options, {limit=30, spot=0, strategy='call'}={}) {
    const groups = new Map();
    for (const option of options || []) {
      const expiration = String(option?.expiration || '');
      if (!groups.has(expiration)) groups.set(expiration, []);
      groups.get(expiration).push(option);
    }
    const ordered = [...groups.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,items]) => items.sort((a,b) => {
      const aDistance = Number.isFinite(Number(spot)) && Number(spot) > 0 ? Math.abs(Number(a.strike)-Number(spot)) : 0;
      const bDistance = Number.isFinite(Number(spot)) && Number(spot) > 0 ? Math.abs(Number(b.strike)-Number(spot)) : 0;
      return aDistance-bDistance || (strategy === 'put' ? Number(b.strike)-Number(a.strike) : Number(a.strike)-Number(b.strike));
    }));
    const selected=[];
    for (let round=0; selected.length<limit; round++) {
      let added=false;
      for (const group of ordered) {
        if (group[round] && selected.length<limit) { selected.push(group[round]); added=true; }
      }
      if (!added) break;
    }
    return selected.sort((a,b) => String(a.expiration).localeCompare(String(b.expiration)) || Number(a.strike)-Number(b.strike));
  }
  function wheelSummary(callJournal=[],putJournal=[],symbol='') {
    const ticker=String(symbol||'').toUpperCase();
    const calls=callJournal.filter(j=>String(j.symbol||'').toUpperCase()===ticker);
    const puts=putJournal.filter(j=>String(j.symbol||'').toUpperCase()===ticker);
    const continuedCallIds=new Set(puts.map(j=>j.wheelOriginCallId).filter(Boolean));
    const completedPutToCall=calls.filter(j=>j.closed&&j.wheelOriginPutId&&puts.some(p=>p.id===j.wheelOriginPutId&&p.closed?.type==='assigned'));
    const completedCallToPut=puts.filter(j=>j.closed?.type==='closed'&&j.wheelOriginCallId&&calls.some(c=>c.id===j.wheelOriginCallId&&c.closed?.type==='assigned'));
    const standalonePutCloses=puts.filter(j=>j.closed?.type==='closed');
    const continuedOriginCalls=calls.filter(j=>j.closed&&continuedCallIds.has(j.id)&&!j.wheelOriginPutId);
    const realizedPnl=completedPutToCall.reduce((sum,j)=>sum+Number(j.closed?.result?.totalPnlCost||0),0)
      +continuedOriginCalls.reduce((sum,j)=>sum+Number(j.closed?.result?.totalPnl||0),0)
      +standalonePutCloses.reduce((sum,j)=>sum+Number(j.closed?.result?.optionPnl||0),0);
    const assignedOpen=puts.filter(p=>p.closed?.type==='assigned'&&!calls.some(c=>c.wheelOriginPutId===p.id&&c.closed));
    return {
      realizedPnl,
      completedCycles:completedPutToCall.length+completedCallToPut.length,
      standalonePutCloses:standalonePutCloses.length,
      assignedOpen:assignedOpen.length,
      assignedMarkedPnl:assignedOpen.reduce((sum,j)=>sum+Number(j.closed?.result?.markedPnl||0),0)
    };
  }
  const api={sampleAcrossExpirations,wheelSummary};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.OptionsCommon=api;
})(typeof globalThis!=='undefined'?globalThis:this);
