'use strict';

// Published 2026 dates from the Federal Reserve and U.S. Bureau of Labor Statistics.
// Keep the explicit coverage date visible to the UI so an expired calendar never looks complete.
const COVERAGE_THROUGH = '2026-12-31';
const EVENTS = [
  { at:'2026-09-16T18:00:00Z', type:'FOMC', label:'FOMC rate decision', source:'Federal Reserve' },
  { at:'2026-10-02T12:30:00Z', type:'JOBS', label:'Employment Situation', source:'U.S. BLS' },
  { at:'2026-10-14T12:30:00Z', type:'CPI', label:'Consumer Price Index', source:'U.S. BLS' },
  { at:'2026-10-28T18:00:00Z', type:'FOMC', label:'FOMC rate decision', source:'Federal Reserve' },
  { at:'2026-11-06T13:30:00Z', type:'JOBS', label:'Employment Situation', source:'U.S. BLS' },
  { at:'2026-11-10T13:30:00Z', type:'CPI', label:'Consumer Price Index', source:'U.S. BLS' },
  { at:'2026-12-04T13:30:00Z', type:'JOBS', label:'Employment Situation', source:'U.S. BLS' },
  { at:'2026-12-09T19:00:00Z', type:'FOMC', label:'FOMC rate decision', source:'Federal Reserve' },
  { at:'2026-12-10T13:30:00Z', type:'CPI', label:'Consumer Price Index', source:'U.S. BLS' }
];

const MARKET_HOLIDAYS = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'
]);
const EARLY_CLOSES = new Set(['2026-11-27','2026-12-24']);

function nyDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const map = Object.fromEntries(parts.map(part => [part.type,part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isMarketHoliday(now = Date.now()) { return MARKET_HOLIDAYS.has(nyDate(now)); }
function getMarketCloseMinutes(now = Date.now()) { return EARLY_CLOSES.has(nyDate(now)) ? 13 * 60 : 16 * 60; }

function getMarketEventRisk(now = Date.now()) {
  const upcoming = EVENTS.filter(event => Date.parse(event.at) >= now)
    .map(event => ({...event,hoursAway:Math.round((Date.parse(event.at) - now) / 3600000 * 10) / 10}))
    .slice(0,5);
  const nearest = upcoming[0] || null;
  const within72h = Boolean(nearest && nearest.hoursAway >= 0 && nearest.hoursAway <= 72);
  const highImpact24hr = Boolean(nearest && nearest.hoursAway >= 0 && nearest.hoursAway <= 24);
  return {
    nearest, upcoming, within72h, highImpact24hr,
    fomc72hr:Boolean(upcoming.find(event => event.type === 'FOMC' && event.hoursAway >= 0 && event.hoursAway <= 72)),
    coverageThrough:COVERAGE_THROUGH,
    sources:[
      {name:'Federal Reserve',url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'},
      {name:'U.S. BLS',url:'https://www.bls.gov/schedule/2026/'}
    ]
  };
}

module.exports = { EVENTS, MARKET_HOLIDAYS, EARLY_CLOSES, COVERAGE_THROUGH, nyDate, isMarketHoliday, getMarketCloseMinutes, getMarketEventRisk };
