// api/data.js — PTR Over-$1M Dashboard serverless data function
//
// On every visit, this fetches live current prices from Yahoo Finance,
// pairs them with each transaction's fixed acquisition-date close, computes
// the performance %, and returns the complete payload the dashboard renders.
// Result is edge-cached for 1 hour (same pattern as the Seasonality Dashboard).
//
// There is no separate price file to maintain — the transaction list and the
// historical txn-date closes are fixed ground truth (the 278-T filing never
// changes); only the live "current price" leg is fetched fresh each time.

// ─────────────────────────────────────────────────────────────────────────
// GROUND TRUTH — all 54 transactions disclosed over $1,000,000 in the 278-T.
// Each row carries its FIXED acquisition-date close (tc) + close date (tcd),
// captured once from historical data. Only `cp` (current price) is fetched
// live. e=entry, n=name, t=ticker, td=txn date, tp=type, sz=size bracket.
// ─────────────────────────────────────────────────────────────────────────
const TXNS = [
  // ---- PURCHASES, $1M-$5M (entries 1-36) ----
  { e:1,  n:'Vanguard S&P 500 ETF',                             t:'VOO',  td:'2026-03-02', tp:'Purchase', sz:'$1M-$5M', tc:629.29,  tcd:'2026-03-02' },
  { e:2,  n:'iShares Russell 1000 ETF',                         t:'IWB',  td:'2026-03-27', tp:'Purchase', sz:'$1M-$5M', tc:347.95,  tcd:'2026-03-27' },
  { e:3,  n:'ServiceNow Inc',                                   t:'NOW',  td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:106.48,  tcd:'2026-02-10' },
  { e:4,  n:'NVIDIA Corp',                                      t:'NVDA', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:188.53,  tcd:'2026-02-10' },
  { e:5,  n:'Invesco S&P 500 Equal Weight ETF',                 t:'RSP',  td:'2026-02-20', tp:'Purchase', sz:'$1M-$5M', tc:203.22,  tcd:'2026-02-20' },
  { e:6,  n:'Adobe Inc',                                        t:'ADBE', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:264.67,  tcd:'2026-02-10' },
  { e:7,  n:'Workday Inc Cl A',                                 t:'WDAY', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:153.23,  tcd:'2026-02-10' },
  { e:8,  n:'Oracle Corp',                                      t:'ORCL', td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:154.15,  tcd:'2026-03-17' },
  { e:9,  n:'Microsoft Corp',                                   t:'MSFT', td:'2026-03-19', tp:'Purchase', sz:'$1M-$5M', tc:389.02,  tcd:'2026-03-19' },
  { e:10, n:'Broadcom Inc',                                     t:'AVGO', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:339.73,  tcd:'2026-02-10' },
  { e:11, n:'Synopsys Inc',                                     t:'SNPS', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:437.45,  tcd:'2026-02-10' },
  { e:12, n:'CDW Corp',                                         t:'CDW',  td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:142.13,  tcd:'2026-02-10' },
  { e:13, n:'Procter & Gamble Co',                              t:'PG',   td:'2026-01-12', tp:'Purchase', sz:'$1M-$5M', tc:141.38,  tcd:'2026-01-12' },
  { e:14, n:'Cadence Design Systems Inc',                       t:'CDNS', td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:293.75,  tcd:'2026-03-17' },
  { e:15, n:'Trane Technologies PLC',                           t:'TT',   td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:425.36,  tcd:'2026-03-17' },
  { e:16, n:'Texas Instruments Inc',                            t:'TXN',  td:'2026-01-12', tp:'Purchase', sz:'$1M-$5M', tc:186.89,  tcd:'2026-01-12' },
  { e:17, n:'Fidelity National Information Services',           t:'FIS',  td:'2026-01-12', tp:'Purchase', sz:'$1M-$5M', tc:65.68,   tcd:'2026-01-12' },
  { e:18, n:'Motorola Solutions Inc',                           t:'MSI',  td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:418.58,  tcd:'2026-02-10' },
  { e:19, n:'Eaton Corp PLC',                                   t:'ETN',  td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:362.95,  tcd:'2026-03-17' },
  { e:20, n:'Industrial Select Sector SPDR ETF',                t:'XLI',  td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:166.03,  tcd:'2026-03-17' },
  { e:21, n:'TransDigm Group Inc',                              t:'TDG',  td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:1311.95, tcd:'2026-02-10' },
  { e:22, n:'Amazon.com Inc',                                   t:'AMZN', td:'2026-03-19', tp:'Purchase', sz:'$1M-$5M', tc:208.76,  tcd:'2026-03-19' },
  { e:23, n:'Jabil Inc',                                        t:'JBL',  td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:258.85,  tcd:'2026-02-10' },
  { e:24, n:'Costco Wholesale Corp',                            t:'COST', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:969.82,  tcd:'2026-02-10' },
  { e:25, n:'Axon Enterprise Inc',                              t:'AXON', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:446.97,  tcd:'2026-02-10' },
  { e:26, n:'iShares GSCI Commodity Dynamic Roll Strategy ETF', t:'COMT', td:'2026-03-05', tp:'Purchase', sz:'$1M-$5M', tc:30.17,   tcd:'2026-03-05' },
  { e:27, n:'Kura Sushi USA Inc Cl A',                          t:'KRUS', td:'2026-02-02', tp:'Purchase', sz:'$1M-$5M', tc:69.29,   tcd:'2026-02-02' },
  { e:28, n:'Dell Technologies Inc Cl C',                       t:'DELL', td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:125.62,  tcd:'2026-02-10' },
  { e:29, n:'Boeing Company',                                   t:'BA',   td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:242.59,  tcd:'2026-02-10' },
  { e:30, n:'Uber Technologies Inc',                            t:'UBER', td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:77.79,   tcd:'2026-03-17' },
  { e:31, n:'iShares Core MSCI Emerging Markets ETF',           t:'IEMG', td:'2026-01-29', tp:'Purchase', sz:'$1M-$5M', tc:74.09,   tcd:'2026-01-29' },
  { e:32, n:'Apple Inc',                                        t:'AAPL', td:'2026-03-02', tp:'Purchase', sz:'$1M-$5M', tc:264.48,  tcd:'2026-03-02' },
  { e:33, n:'Vanguard S&P 500 ETF',                             t:'VOO',  td:'2026-02-13', tp:'Purchase', sz:'$1M-$5M', tc:624.92,  tcd:'2026-02-13' },
  { e:34, n:'Comcast Corp New Class A',                         t:'CMCSA',td:'2026-01-12', tp:'Purchase', sz:'$1M-$5M', tc:28.39,   tcd:'2026-01-12' },
  { e:35, n:'PTC Inc',                                          t:'PTC',  td:'2026-02-10', tp:'Purchase', sz:'$1M-$5M', tc:162.72,  tcd:'2026-02-10' },
  { e:36, n:'Schwab Government Money Fund',                     t:'SNVXX',td:'2026-03-17', tp:'Purchase', sz:'$1M-$5M', tc:1.00,    tcd:'2026-03-17' },
  // ---- SALES, $1M-$5M (page 111, entries 3624-3628) ----
  { e:3624, n:'Walt Disney Company',                           t:'DIS',  td:'2026-03-17', tp:'Sale', sz:'$1M-$5M', tc:100.30,  tcd:'2026-03-17' },
  { e:3625, n:'UnitedHealth Group Inc',                        t:'UNH',  td:'2026-03-17', tp:'Sale', sz:'$1M-$5M', tc:287.57,  tcd:'2026-03-17' },
  { e:3626, n:'Oracle Corp',                                   t:'ORCL', td:'2026-01-06', tp:'Sale', sz:'$1M-$5M', tc:192.57,  tcd:'2026-01-06' },
  { e:3627, n:'CDW Corp',                                      t:'CDW',  td:'2026-03-17', tp:'Sale', sz:'$1M-$5M', tc:117.44,  tcd:'2026-03-17' },
  { e:3628, n:'Netflix Inc',                                   t:'NFLX', td:'2026-02-10', tp:'Sale', sz:'$1M-$5M', tc:82.21,   tcd:'2026-02-10' },
  // ---- SALES, $1M-$5M (page 112, entries 3629-3637) ----
  { e:3629, n:'Palantir Technologies Inc Cl A',                t:'PLTR', td:'2026-02-10', tp:'Sale', sz:'$1M-$5M', tc:139.51,  tcd:'2026-02-10' },
  { e:3630, n:'Communication Services Select Sector SPDR ETF', t:'XLC',  td:'2026-03-05', tp:'Sale', sz:'$1M-$5M', tc:118.06,  tcd:'2026-03-05' },
  { e:3631, n:'Vanguard High Dividend Yield ETF',              t:'VYM',  td:'2026-01-23', tp:'Sale', sz:'$1M-$5M', tc:146.83,  tcd:'2026-01-23' },
  { e:3632, n:'Accenture PLC',                                 t:'ACN',  td:'2026-03-17', tp:'Sale', sz:'$1M-$5M', tc:196.99,  tcd:'2026-03-17' },
  { e:3633, n:'iShares Core S&P 500 ETF',                      t:'IVV',  td:'2026-01-23', tp:'Sale', sz:'$1M-$5M', tc:690.40,  tcd:'2026-01-23' },
  { e:3634, n:'SPDR S&P 500 ETF Trust',                        t:'SPY',  td:'2026-03-05', tp:'Sale', sz:'$1M-$5M', tc:679.45,  tcd:'2026-03-05' },
  { e:3635, n:'SPDR S&P 500 ETF Trust',                        t:'SPY',  td:'2026-01-29', tp:'Sale', sz:'$1M-$5M', tc:692.15,  tcd:'2026-01-29' },
  { e:3636, n:'Vanguard S&P 500 ETF',                          t:'VOO',  td:'2026-01-06', tp:'Sale', sz:'$1M-$5M', tc:634.21,  tcd:'2026-01-06' },
  { e:3637, n:'Vanguard S&P 500 ETF',                          t:'VOO',  td:'2026-03-19', tp:'Sale', sz:'$1M-$5M', tc:604.84,  tcd:'2026-03-19' },
  // ---- SALES, $5M-$25M (page 112, entries 3638-3641) — filing's largest bracket ----
  { e:3638, n:'Vanguard Dividend Appreciation ETF',            t:'VIG',  td:'2026-01-12', tp:'Sale', sz:'$5M-$25M', tc:224.73, tcd:'2026-01-12' },
  { e:3639, n:'Meta Platforms Inc',                            t:'META', td:'2026-02-10', tp:'Sale', sz:'$5M-$25M', tc:670.15, tcd:'2026-02-10' },
  { e:3640, n:'Amazon.com Inc',                                t:'AMZN', td:'2026-02-10', tp:'Sale', sz:'$5M-$25M', tc:206.96, tcd:'2026-02-10' },
  { e:3641, n:'Microsoft Corp',                                t:'MSFT', td:'2026-02-10', tp:'Sale', sz:'$5M-$25M', tc:412.33, tcd:'2026-02-10' },
];

const UA = 'Mozilla/5.0 (compatible; PTRDashboard/1.0)';

// Fetch one ticker's current regular-market price from Yahoo Finance.
async function fetchOne(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [sym, null];
    const j = await r.json();
    const px = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return (typeof px === 'number' && px > 0) ? [sym, +px.toFixed(2)] : [sym, null];
  } catch (e) {
    return [sym, null];
  }
}

export default async function handler(req, res) {
  // edge-cache for 1 hour, same as the Seasonality Dashboard
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // SNVXX is a $1.00-NAV cash fund — no market series to fetch
  const liveSymbols = [...new Set(TXNS.map(t => t.t).filter(t => t !== 'SNVXX'))];

  try {
    const settled = await Promise.all(liveSymbols.map(fetchOne));
    const priceMap = {};
    settled.forEach(([sym, px]) => { if (px != null) priceMap[sym] = px; });
    priceMap['SNVXX'] = 1.00;

    const rows = TXNS.map(t => {
      const cp = priceMap[t.t];
      const hasLive = cp != null;
      const pct = (hasLive && t.tc)
        ? +(((cp - t.tc) / t.tc) * 100).toFixed(2)
        : null;
      return {
        e: t.e, n: t.n, t: t.t, td: t.td, tcd: t.tcd, tp: t.tp, sz: t.sz,
        tc: t.tc,
        cp: hasLive ? cp : null,
        pct,
      };
    });

    const missing = rows.filter(r => r.cp == null).map(r => r.t);

    return res.status(200).json({
      ok: true,
      filing: 'OGE Form 278-T — Donald J. Trump, filed 2026-05-08',
      scope: 'All transactions disclosed over $1,000,000',
      updatedAt: new Date().toISOString(),
      count: rows.length,
      purchases: rows.filter(r => r.tp === 'Purchase').length,
      sales: rows.filter(r => r.tp === 'Sale').length,
      live: liveSymbols.length - missing.filter(m => m !== 'SNVXX').length,
      missing,
      rows,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
}
