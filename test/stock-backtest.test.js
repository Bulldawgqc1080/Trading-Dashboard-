const assert=require('assert');
const store=require('../lib/journal/stock-store');
const {backfill,summary}=require('../lib/journal/stock-backtest');
const {STOCK_MODEL_VERSION}=require('../lib/config');
(async()=>{
  const entries=[];
  for(let i=0;i<10;i++)entries.push({key:`a${i}`,date:`2026-01-${String(i+2).padStart(2,'0')}`,symbol:'TEST',modelVersion:STOCK_MODEL_VERSION,verdict:'ACTIONABLE',entryPrice:100,validationEligible:true});
  entries.push({key:'old',date:'2026-01-02',symbol:'TEST',modelVersion:'stock-v1',verdict:'ACTIONABLE',entryPrice:100,validationEligible:true});
  store.replace(entries);
  const series=Array.from({length:25},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,close:100+i}));
  await backfill(async()=>series);
  const result=summary();
  assert.equal(result.modelVersion,STOCK_MODEL_VERSION);
  assert.equal(result.buckets.ACTIONABLE.count,10,'old stock model must be isolated');
  assert.equal(result.buckets.ACTIONABLE.avg5d,10.5);
  assert.equal(result.buckets.WATCH.avg5d,null,'thin buckets stay hidden');
  console.log('stock-backtest.test.js passed');
})().catch(error=>{console.error(error);process.exit(1);});
