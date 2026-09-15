'use strict';
const https = require('https');
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;
let journal = [];
let lastLoadOk = !UPSTASH_URL || !UPSTASH_TOKEN;

function kvCommand(command) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return Promise.resolve(null);
  return new Promise(resolve => {
    const url = new URL(UPSTASH_URL);
    const body = JSON.stringify(command);
    const req = https.request({hostname:url.hostname,path:url.pathname||'/',method:'POST',headers:{Authorization:`Bearer ${UPSTASH_TOKEN}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{try{resolve(JSON.parse(data));}catch{resolve(null);}});
    });
    req.on('error',()=>resolve(null));req.setTimeout(5000,()=>{req.destroy();resolve(null);});req.end(body);
  });
}
function normalize(entry={}) {
  return {
    key:entry.key||null,date:entry.date||null,ts:entry.ts||Date.now(),symbol:entry.symbol||null,
    modelVersion:entry.modelVersion||'stock-v1',verdict:entry.verdict||null,entryPosture:entry.entryPosture||null,
    setupScore:entry.setupScore??null,momentumScore:entry.momentumScore??null,marketDecision:entry.marketDecision||null,
    entryPrice:entry.entryPrice??null,quoteAsOf:entry.quoteAsOf||null,validationEligible:entry.validationEligible===true,
    outcomeMethod:entry.outcomeMethod||null,outcome1d:entry.outcome1d??null,outcome5d:entry.outcome5d??null,outcome10d:entry.outcome10d??null
  };
}
async function load() {
  const response=await kvCommand(['GET','sibt:stock-journal']);
  lastLoadOk=!UPSTASH_URL||!UPSTASH_TOKEN||Boolean(response&&Object.prototype.hasOwnProperty.call(response,'result'));
  if(response?.result){try{const parsed=JSON.parse(response.result);if(Array.isArray(parsed))journal=parsed.map(normalize);}catch{}}
  return get();
}
async function save(){await kvCommand(['SET','sibt:stock-journal',JSON.stringify(journal.map(normalize))]);}
async function log(entries) {
  await load();
  if(!lastLoadOk)return get();
  for(const raw of entries||[]){
    const entry=normalize(raw);
    if(!entry.key||journal.some(existing=>existing.key===entry.key))continue;
    journal.push(entry);
  }
  journal.sort((a,b)=>(a.ts||0)-(b.ts||0));
  if(journal.length>500)journal=journal.slice(-500);
  await save();return get();
}
function get(){return journal.map(normalize);}
function replace(entries){journal=Array.isArray(entries)?entries.map(normalize):[];return get();}
module.exports={load,save,log,get,replace,normalize};
