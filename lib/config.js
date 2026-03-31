module.exports = {
  MODEL_VERSION: 'market-v1',
  PORT: process.env.PORT || 3001,
  CACHE_TTL: 30_000,
  CRYPTO_CACHE_TTL: 60_000,
  WATCHLIST_CACHE_TTL: 60_000,
  BREADTH_CACHE_TTL: 5 * 60_000,
  STALE_THRESHOLD: 5 * 60_000,
  WATCHLIST: ['TSLA', 'NVDA', 'PYPL', 'MSTR', 'HD'],
  BREADTH_UNIVERSE: [
    'AAPL','MSFT','NVDA','AMZN','GOOGL','GOOG','META','BRK-B','LLY','AVGO',
    'JPM','XOM','UNH','V','MA','COST','JNJ','PG','HD','ABBV',
    'BAC','KO','MRK','PEP','CVX','ADBE','NFLX','CRM','AMD','WMT',
    'ACN','CSCO','TMO','MCD','ABT','DHR','LIN','INTU','CMCSA','WFC',
    'TXN','AMGN','PM','DIS','NEE','INTC','RTX','UNP','IBM','QCOM',
    'CAT','SPGI','NOW','GE','LOW','ISRG','HON','VRTX','GS','PFE',
    'BLK','BKNG','AXP','SYK','TJX','PLD','AMAT','SCHW','MDT','LMT',
    'DE','ADP','GILD','C','MMC','MO','CB','T','SO','DUK',
    'CI','MDLZ','REGN','ADI','PANW','ETN','ELV','ZTS','CL','BDX'
  ],
  DECISION_BANDS: {
    YES: 70,
    CAUTION: 45
  },
  CRITICAL_FEEDS: ['SPY', 'QQQ', 'VIX']
};
