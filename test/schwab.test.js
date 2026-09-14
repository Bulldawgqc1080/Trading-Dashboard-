'use strict';

const assert = require('assert');
const oauth = require('../lib/schwab/oauth');
const { flattenCalls, buildSchwabChain, standardContract } = require('../lib/options/schwab');

const env = {
  SCHWAB_CLIENT_ID: 'test-client',
  SCHWAB_CLIENT_SECRET: 'test-secret',
  SCHWAB_SESSION_SECRET: 'a-long-random-test-session-secret',
  SCHWAB_REDIRECT_URI: 'https://example.test/api/schwab/callback'
};

const encrypted = oauth.encrypt({ accessToken: 'not-real', expiresAt: 123 }, env.SCHWAB_SESSION_SECRET);
assert.deepEqual(oauth.decrypt(encrypted, env.SCHWAB_SESSION_SECRET), { accessToken: 'not-real', expiresAt: 123 });
assert.equal(oauth.decrypt(encrypted + 'tampered', env.SCHWAB_SESSION_SECRET), null);
assert.equal(oauth.configured(env), true);
const auth = oauth.startAuthorization(env);
const authUrl = new URL(auth.url);
assert.equal(authUrl.origin + authUrl.pathname, oauth.AUTHORIZE_URL);
assert.equal(authUrl.searchParams.get('client_id'), 'test-client');
assert.equal(authUrl.searchParams.get('redirect_uri'), env.SCHWAB_REDIRECT_URI);
assert.equal(authUrl.searchParams.get('response_type'), 'code');
assert(authUrl.searchParams.get('state'));
assert(auth.setCookie.includes('HttpOnly'));
assert(auth.setCookie.includes('Secure'));
assert(auth.setCookie.includes('SameSite=Lax'));

const standard = { putCall:'CALL', symbol:'MSTR  261002C00150000', strikePrice:150, bid:5, ask:5.5, last:5.2, openInterest:500, multiplier:100, nonStandard:false, expirationDate:'2026-10-02', quoteTimeInLong:Date.parse('2026-09-14T14:00:00Z'), delta:.3, volatility:70 };
assert.equal(standardContract(standard), true);
assert.equal(standardContract({...standard, deliverableNote:'100 MSTR'}), true);
assert.equal(standardContract({...standard, nonStandard:true}), false);
assert.equal(standardContract({...standard, nonStandard:'true'}), false);
assert.equal(standardContract({...standard, multiplier:10}), false);
assert.equal(standardContract({...standard, mini:true}), false);
const calls = flattenCalls({'2026-10-02:18': {'150.0': [standard], '155.0': [{...standard,strikePrice:155,nonStandard:true}]}}, 140);
assert.equal(calls.length, 1);
assert.equal(calls[0].strike, 150);
assert.equal(calls[0].quoteAsOf, '2026-09-14T14:00:00.000Z');
assert.equal(calls[0].delta, .3);

(async () => {
  const captured = [];
  const request = async (path, params, token) => {
    captured.push({path,params,token});
    if (path.endsWith('/quotes')) return {AAPL:{quote:{lastPrice:140,bidPrice:139.9,askPrice:140.1,quoteTime:Date.parse('2026-09-14T14:05:00Z')}}};
    return {underlyingPrice:139,callExpDateMap:{'2026-10-02:18':{'150.0':[standard]}}};
  };
  const chain = await buildSchwabChain({request,accessToken:'access-test',symbol:'AAPL',minDte:7,maxDte:45,minStrike:140,now:Date.parse('2026-09-14T12:00:00Z')});
  assert.equal(captured.length, 2);
  assert.equal(captured[0].path, '/marketdata/v1/chains');
  assert.equal(captured[0].params.symbol, 'AAPL');
  assert.equal(captured[0].params.contractType, 'CALL');
  assert.equal(captured[1].path, '/marketdata/v1/quotes');
  assert.equal(captured[1].token, 'access-test');
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.underlying.symbol, 'AAPL');
  assert.equal(chain.underlying.price, 140);
  assert.equal(chain.underlying.quoteAsOf, '2026-09-14T14:05:00.000Z');
  console.log('schwab.test.js passed');
})().catch(err => { console.error(err); process.exit(1); });
