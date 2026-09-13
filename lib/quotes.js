// Compare against the session before the quote, not the server's current day.
function normalizeQuote(result) {
  const meta = result.meta || {};
  const closes = result.indicators?.quote?.[0]?.close || [];
  const bars = (result.timestamp || []).map((ts, i) => ({ ts, close: closes[i] }))
    .filter(b => Number.isFinite(b.close) && b.close > 0);
  const quoteTime = meta.regularMarketTime || bars.at(-1)?.ts;
  const price = meta.regularMarketPrice || bars.at(-1)?.close || 0;
  const day = ts => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const previous = quoteTime ? bars.filter(b => day(b.ts) < day(quoteTime)).at(-1)?.close : null;
  const prev = previous ?? meta.previousClose ?? null;
  const change = prev > 0 ? price - prev : null;
  const round = n => n == null ? null : Math.round(n * 100) / 100;
  return { price: round(price), prev: round(prev), change: round(change),
    changePct: prev > 0 ? round(change / prev * 100) : null,
    quoteAsOf: quoteTime ? new Date(quoteTime * 1000).toISOString() : null,
    closes: bars.map(b => b.close) };
}
module.exports = { normalizeQuote };
