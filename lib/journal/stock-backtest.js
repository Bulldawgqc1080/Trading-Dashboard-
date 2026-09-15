'use strict';
const store=require('./stock-store');
const {STOCK_MODEL_VERSION}=require('../config');
const avg=values=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100:null;
const winRate=values=>values.length?Math.round(values.filter(value=>value>0).length/values.length*100):null;
function summarize(entries){
  const metric=key=>entries.map(entry=>entry[key]).filter(Number.isFinite);
  const o1=metric('outcome1d'),o5=metric('outcome5d'),o10=metric('outcome10d');
  return {count:entries.length,avg1d:avg(o1),avg5d:avg(o5),avg10d:avg(o10),winRate1d:winRate(o1),winRate5d:winRate(o5),winRate10d:winRate(o10)};
}
async function backfill(fetchSeries) {
  const journal=store.get();
  const symbols=[...new Set(journal.filter(entry=>entry.validationEligible&&entry.symbol).map(entry=>entry.symbol))];
  const seriesBySymbol=Object.fromEntries(await Promise.all(symbols.map(async symbol=>[symbol,await fetchSeries(symbol,500)])));
  let changed=false;
  for(const entry of journal){
    const series=seriesBySymbol[entry.symbol]||[];
    const index=entry.validationEligible?series.findIndex(row=>row.date===entry.date):-1;
    const outcome=offset=>index<0||!series[index+offset]||!Number.isFinite(entry.entryPrice)?null:Math.round((series[index+offset].close-entry.entryPrice)/entry.entryPrice*10000)/100;
    const next={outcomeMethod:'trading-date-v1',validationEligible:entry.validationEligible&&index>=0,outcome1d:outcome(1),outcome5d:outcome(5),outcome10d:outcome(10)};
    if(Object.entries(next).some(([key,value])=>entry[key]!==value))changed=true;
    Object.assign(entry,next);
  }
  if(changed){store.replace(journal);await store.save();}
  return journal;
}
function summary(){
  const verified=store.get().filter(entry=>entry.modelVersion===STOCK_MODEL_VERSION&&entry.validationEligible&&entry.outcomeMethod==='trading-date-v1');
  const publishable=entries=>entries.length>=10?summarize(entries):{count:entries.length,avg1d:null,avg5d:null,avg10d:null,winRate1d:null,winRate5d:null,winRate10d:null};
  const completed=verified.filter(entry=>Number.isFinite(entry.outcome5d));
  const groups=Object.fromEntries(['ACTIONABLE','WATCH','AVOID'].map(verdict=>[verdict,completed.filter(entry=>entry.verdict===verdict)]));
  const evaluated=completed.length;
  return {modelVersion:STOCK_MODEL_VERSION,updatedAt:new Date().toISOString(),evaluatedSamples:evaluated,minimumPerBucket:10,buckets:Object.fromEntries(Object.entries(groups).map(([key,entries])=>[key,publishable(entries)])),warning:evaluated<30?'Stock setup results are not yet proven; metrics remain hidden until each bucket has 10 verified samples.':'Treat observed outcomes as evidence, not a guarantee.'};
}
module.exports={backfill,summary,summarize};
