'use strict';
const assert = require('assert');
const {evaluate,rankCandidates,closePaper,assignPaper} = require('../public/cash-secured-put');

const position = {cash:30000,committedCash:0,contracts:1,spot:140,maxStrike:135,source:'paper broker',asOf:'2026-09-14T14:00:00Z',minDte:7,maxDte:45,maxSpread:20,minOi:100,minPremium:100,fee:1,standard:true,entryLabel:'FAVORABLE',requireEligible:true,avoidEvent:true};
const puts = [{expiration:'2026-10-02',strike:130,bid:5,ask:5.5,oi:1000,delta:-.18,volume:500,quoteAsOf:'2026-09-14T14:05:00Z'}];
const now = Date.parse('2026-09-14T14:10:00Z');
const result = evaluate(position,puts,now);
assert.equal(result.eligibleCount,1);
assert.equal(result.rows[0].metrics.cashRequired,13000);
assert.equal(result.rows[0].metrics.netPremium,499);
assert.equal(result.rows[0].metrics.effectivePrice,125.01);
assert.equal(result.rows[0].metrics.maxLoss,12501);
assert(result.rows[0].metrics.discountToSpotPct > 10);
assert.equal(evaluate({...position,cash:12000},puts,now).eligibleCount,0);
assert.equal(evaluate({...position,maxStrike:125},puts,now).eligibleCount,0);
assert.equal(evaluate({...position,entryLabel:'NOT ELIGIBLE'},puts,now).eligibleCount,0);
assert.equal(evaluate(position,puts,Date.parse('2026-09-14T14:21:00Z')).eligibleCount,0);
assert.equal(evaluate({...position,eventDate:'2026-09-30'},puts,now).eligibleCount,0);

const choices = [puts[0],{...puts[0],strike:135,bid:8,ask:8.2,oi:3000,volume:800,delta:-.34}];
const ranked = rankCandidates(evaluate(position,choices,now),position);
assert.equal(ranked.status,'ok');
assert.equal(ranked.profiles[0].winner.strike,130);
assert.equal(ranked.profiles[2].winner.strike,135);
const caution = rankCandidates(evaluate({...position,entryLabel:'CAUTION'},choices,now),{...position,entryLabel:'CAUTION'});
assert.equal(caution.profiles[0].winner.entryPenalty,12);
const eventAllowed = rankCandidates(evaluate({...position,eventDate:'2026-09-30',avoidEvent:false},choices,now),position);
assert.equal(eventAllowed.profiles[0].winner.eventPenalty,25);

const entry = {position,put:puts[0],metrics:result.rows[0].metrics};
assert.equal(closePaper(entry,2,1).optionPnl,298);
const assigned = assignPaper(entry,120);
assert.equal(assigned.shares,100);
assert.equal(assigned.acquisitionCost,13000);
assert.equal(assigned.effectivePrice,125.01);
assert.equal(assigned.markedPnl,-501);
console.log('cash-secured-put.test.js passed');
