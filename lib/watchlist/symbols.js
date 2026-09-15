'use strict';

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MAX_SYMBOLS = 12;

function normalizeWatchlistSymbols(value, fallback = []) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
  const symbols = [...new Set(raw.map(item => String(item || '').trim().toUpperCase()).filter(item => SYMBOL_RE.test(item)))];
  if (symbols.length) return symbols.slice(0, MAX_SYMBOLS);
  return [...new Set(fallback.map(item => String(item || '').trim().toUpperCase()).filter(item => SYMBOL_RE.test(item)))].slice(0, MAX_SYMBOLS);
}

module.exports = { SYMBOL_RE, MAX_SYMBOLS, normalizeWatchlistSymbols };
