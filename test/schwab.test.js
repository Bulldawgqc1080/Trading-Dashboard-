'use strict';

const assert = require('assert');
const oauth = require('../lib/schwab/oauth');
const { flattenCalls, buildSchwabMstrChain, standardContract } = require('../lib/options/schwab');

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
assert.equal(standardContract({...standard, nonStandard:true}), false);
assert.equal(standardContract({...standard, multiplier:10}), false);
assert.equal(standardContract({...standard, deliverableNote:'Adjusted'}), false);
const calls = flattenCalls({'2026-10-02:18': {'150.0': [standard], '155.0': [{...standard,strikePrice:155,nonStandard:true}]}}, 140);
assert.equal(calls.length, 1);
assert.equal(calls[0].strike, 150);
assert.equal(calls[0].quoteAsOf, '2026-09-14T14:00:00.000Z');
assert.equal(calls[0].delta, .3);

(async () => {
  let captured;
  const request = async (path, params, token) => {
    captured = {path,params,token};
    return {underlyingPrice:140,underlying:{bid:139.9,ask:140.1,quoteTimeInLong:Date.parse('2026-09-14T14:00:00Z')},callExpDateMap:{'2026-10-02:18':{'150.0':[standard]}}};
  };
  const chain = await buildSchwabMstrChain({request,accessToken:'access-test',minDte:7,maxDte:45,minStrike:140,now:Date.parse('2026-09-14T12:00:00Z')});
  assert.equal(captured.path, '/marketdata/v1/chains');
  assert.equal(captured.params.symbol, 'MSTR');
  assert.equal(captured.params.contractType, 'CALL');
  assert.equal(captured.token, 'access-test');
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.underlying.price, 140);
  console.log('schwab.test.js passed');
})().catch(err => { console.error(err); process.exit(1); });
