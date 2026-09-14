'use strict';

const crypto = require('crypto');
const https = require('https');

const AUTHORIZE_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';
const SESSION_COOKIE = 'sibt_schwab';
const STATE_COOKIE = 'sibt_schwab_state';

const base64url = value => Buffer.from(value).toString('base64url');
const keyFor = secret => crypto.createHash('sha256').update(String(secret)).digest();

function encrypt(value, secret) {
  if (!secret) throw new Error('SCHWAB_SESSION_SECRET is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [base64url(iv), base64url(cipher.getAuthTag()), base64url(encrypted)].join('.');
}

function decrypt(value, secret) {
  if (!value || !secret) return null;
  try {
    const [iv, tag, encrypted] = String(value).split('.').map(part => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part, ''] : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
  }));
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function config(env = process.env) {
  return {
    clientId: env.SCHWAB_CLIENT_ID,
    clientSecret: env.SCHWAB_CLIENT_SECRET,
    sessionSecret: env.SCHWAB_SESSION_SECRET,
    redirectUri: env.SCHWAB_REDIRECT_URI || 'https://trading-dashboard-chi-vert.vercel.app/api/schwab/callback'
  };
}

function configured(env = process.env) {
  const c = config(env);
  return Boolean(c.clientId && c.clientSecret && c.sessionSecret && c.redirectUri);
}

function startAuthorization(env = process.env) {
  const c = config(env);
  if (!configured(env)) throw new Error('Schwab OAuth is not configured');
  const state = crypto.randomBytes(24).toString('base64url');
  const stateValue = encrypt({ state, createdAt: Date.now() }, c.sessionSecret);
  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('client_id', c.clientId);
  authorize.searchParams.set('redirect_uri', c.redirectUri);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('state', state);
  return { url: authorize.toString(), setCookie: cookie(STATE_COOKIE, stateValue, 600) };
}

function requestToken(form, env = process.env) {
  const c = config(env);
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const endpoint = new URL(TOKEN_URL);
    const req = https.request({
      hostname: endpoint.hostname,
      path: endpoint.pathname,
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = {}; }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Schwab authorization returned HTTP ${res.statusCode}`));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Schwab authorization timed out')); });
    req.end(body);
  });
}

function sessionFromToken(token) {
  const expiresIn = Math.max(60, Number(token.expires_in) || 1800);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    connectedAt: Date.now()
  };
}

function sessionCookie(session, env = process.env) {
  return cookie(SESSION_COOKIE, encrypt(session, config(env).sessionSecret), 7 * 86400);
}

function readSession(req, env = process.env) {
  const cookies = parseCookies(req.headers.cookie);
  return decrypt(cookies[SESSION_COOKIE], config(env).sessionSecret);
}

function validateState(req, receivedState, env = process.env) {
  const cookies = parseCookies(req.headers.cookie);
  const stored = decrypt(cookies[STATE_COOKIE], config(env).sessionSecret);
  return Boolean(stored && receivedState && stored.state === receivedState && Date.now() - stored.createdAt < 600000);
}

async function exchangeCode(code, env = process.env) {
  const c = config(env);
  const token = await requestToken({ grant_type: 'authorization_code', code, redirect_uri: c.redirectUri }, env);
  if (!token.access_token || !token.refresh_token) throw new Error('Schwab did not return the required tokens');
  return sessionFromToken(token);
}

async function refreshSession(session, env = process.env) {
  if (!session?.refreshToken) throw new Error('Schwab session is not connected');
  const token = await requestToken({ grant_type: 'refresh_token', refresh_token: session.refreshToken }, env);
  if (!token.access_token) throw new Error('Schwab did not refresh the access token');
  return sessionFromToken({ ...token, refresh_token: token.refresh_token || session.refreshToken });
}

async function validSession(req, env = process.env) {
  const session = readSession(req, env);
  if (!session?.accessToken) return { session: null, setCookie: null };
  if (session.expiresAt > Date.now() + 60000) return { session, setCookie: null };
  const refreshed = await refreshSession(session, env);
  return { session: refreshed, setCookie: sessionCookie(refreshed, env) };
}

function clearCookies() {
  return [cookie(SESSION_COOKIE, '', 0), cookie(STATE_COOKIE, '', 0)];
}

module.exports = {
  AUTHORIZE_URL, SESSION_COOKIE, STATE_COOKIE, encrypt, decrypt, parseCookies, config, configured,
  startAuthorization, validateState, exchangeCode, readSession, validSession, sessionCookie, clearCookies
};
