'use strict';
const assert=require('assert');
const {sampleAcrossExpirations,wheelSummary}=require('../public/options-common');

const expirations=['2026-10-02','2026-10-09','2026-10-16','2026-10-23'];
const chain=expirations.flatMap((expiration,index)=>Array.from({length:10},(_,strike)=>({expiration,strike:100+index*20+strike})));
const sampled=sampleAcrossExpirations(chain,{limit:8,spot:125,strategy:'call'});
assert.equal(sampled.length,8);
for(const expiration of expirations)assert.equal(sampled.filter(option=>option.expiration===expiration).length,2);

const puts=[
  {id:'p1',symbol:'MSTR',closed:{type:'assigned',result:{markedPnl:100}}},
  {id:'p2',symbol:'MSTR',closed:{type:'assigned',result:{markedPnl:-50}}},
  {id:'p3',symbol:'MSTR',closed:{type:'closed',result:{optionPnl:200}}}
];
const calls=[
  {id:'c1',symbol:'MSTR',wheelOriginPutId:'p1',closed:{type:'assigned',result:{totalPnlCost:1000,totalPnl:800}}},
  {id:'c2',symbol:'MSTR',closed:{type:'assigned',result:{totalPnl:300}}}
];
puts.push({id:'p4',symbol:'MSTR',wheelOriginCallId:'c2',closed:{type:'closed',result:{optionPnl:50}}});
const summary=wheelSummary(calls,puts,'MSTR');
assert.equal(summary.completedCycles,2);
assert.equal(summary.standalonePutCloses,2);
assert.equal(summary.assignedOpen,1);
assert.equal(summary.realizedPnl,1550);
console.log('options-common.test.js passed');
