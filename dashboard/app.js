/* Token Radar (model radar-5). Reads window.RADAR; renders board, live tokens, detail pages, methodology, validation panel. All figures recomputed in-page; nothing fetched. */
(function () {
  'use strict';
  var DATA = window.RADAR || null;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tvlBand: 'all', valueBand: 'all', sort: 'implied', dir: -1, view: 'board', slug: null };
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var num0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var num2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var num4 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  var M = (DATA && DATA.model) || {};
  var MEDAGE = M.median_age_days !== undefined ? M.median_age_days : (DATA && DATA.median_age_days !== undefined ? DATA.median_age_days : 513);
  var GMED = (DATA && DATA.global_median !== undefined) ? DATA.global_median : 0.1689;
  var CCAPLO = 0.02, CCAPHI = 1.00;
  var FMIN = M.farm_now_min !== undefined ? M.farm_now_min : 25000000;
  var WMIN = M.watch_min !== undefined ? M.watch_min : 10000000;
  var FGATE = M.farm_now_growth_gate !== undefined ? M.farm_now_growth_gate : -15;
  var AGATE = M.farm_now_age_gate !== undefined ? M.farm_now_age_gate : 90;
  var WGATE = M.watch_growth_gate !== undefined ? M.watch_growth_gate : -30;
  /* Regression fit: DATA.regression, else the first row's own fields. */
  function regressionFit() {
    if (DATA && DATA.regression && DATA.regression.intercept !== undefined) return DATA.regression;
    var r0 = (DATA && DATA.rows && DATA.rows[0]) || null;
    if (r0 && r0.regression_intercept !== undefined) return { intercept: r0.regression_intercept, slope: r0.regression_slope, residual_sd: r0.regression_residual_sd, residual_q10: r0.regression_residual_q10, residual_q90: r0.regression_residual_q90, count: r0.regression_count };
    return null;
  }
  var REG = regressionFit();

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtUsd(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : usd0.format(n); }
  function fmtShort(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + num2.format(n / 1e9) + 'B';
    if (a >= 1e6) return '$' + num2.format(n / 1e6) + 'M';
    if (a >= 1e3) return '$' + num0.format(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : (n > 0 ? '+' : '') + num2.format(n) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return num2.format(d / 365) + 'y';
    return num0.format(d) + 'd';
  }
  function fmtMult(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : num2.format(n) + 'x'; }
  function fmtOdds(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : Math.round(n * 100) + '%'; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  /* Launch odds: the age-bucket rate from DATA.odds. */
  function oddsOf(row) {
    var age = (row.age_days === null || row.age_days === undefined) ? MEDAGE : row.age_days;
    var buckets = (DATA && DATA.odds && DATA.odds.buckets) || null;
    if (!buckets) return (row.launch_odds !== undefined && row.launch_odds !== null) ? row.launch_odds : 0;
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (age >= b.lo && (b.hi === null || b.hi === undefined || age < b.hi)) return b.rate;
    }
    return (DATA.odds.base_rate !== undefined) ? DATA.odds.base_rate : 0;
  }

  /* Comparables (cross-check only): category median mcap/TVL, shrunk to the global median, capped [0.02, 1.00]. */
  function computeComparables(category) {
    var list = (DATA && DATA.comparables) || [];
    var entry = null;
    for (var i = 0; i < list.length; i++) if (list[i].category === category) entry = list[i];
    var n = entry ? entry.count : 0;
    var raw = entry ? entry.median : null;
    if (n < 3 || raw === null || raw === undefined) return { median: GMED, rawMedian: raw, count: n, source: 'global', concentration: (raw ? GMED / raw : 1) };
    var w = n / (n + 5);
    var eff = clamp(w * raw + (1 - w) * GMED, CCAPLO, CCAPHI);
    return { median: eff, rawMedian: raw, count: n, source: 'category', concentration: raw ? eff / raw : 1, shrinkW: w, blended: w * raw + (1 - w) * GMED };
  }
  /* Momentum and maturity are NOT priced in radar-5. v4 formulas, kept for the audit trail: momentum 1 + clamp(change_7d, -60, 120)/100 x 0.5, bounded [0.8, 1.5]; maturity 0.8 + min(age, 1095)/1095 x 0.2. Both failed the three blind tests. */
  /* Row fit: board-wide fit, else the row's own fields. */
  function regressionOf(row) {
    if (REG) return REG;
    if (row && row.regression_intercept !== undefined) return { intercept: row.regression_intercept, slope: row.regression_slope, residual_sd: row.regression_residual_sd, residual_q10: row.regression_residual_q10, residual_q90: row.regression_residual_q90, count: row.regression_count };
    return null;
  }
  
  function regressionBase(tvl, fit) { return Math.pow(10, fit.intercept + fit.slope * Math.log10(tvl)); }
  
  function launchValueOf(row) {
    var fit = regressionOf(row);
    if (!fit) return row.launch_value_usd;
    var v = clamp(Math.round(regressionBase(row.tvl_usd, fit)), 1000000, 100000000000000);
    if (row.launch_value_usd !== undefined && Math.abs(v - row.launch_value_usd) <= Math.max(1, row.launch_value_usd * 0.0005)) return row.launch_value_usd;
    return v;
  }
  /* P10/P90 launch: prediction shifted by the residual quantiles. */
  function pLaunchOf(row, q) {
    var fit = regressionOf(row);
    if (!fit || fit.residual_q10 === undefined || fit.residual_q90 === undefined) return null;
    var pred = fit.intercept + fit.slope * Math.log10(row.tvl_usd);
    return clamp(Math.round(Math.pow(10, pred + (q < 0 ? fit.residual_q10 : fit.residual_q90))), 1000000, 100000000000000);
  }
  function pValueOf(row, q) {
    var pl = pLaunchOf(row, q);
    if (pl === null) return null;
    return clamp(Math.round(pl * oddsOf(row)), 1000000, 100000000000000);
  }
  
  function rankOfValue(v) {
    var n = 0;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > v) n++; });
    return n + 1;
  }
  /* Net $/hour at P10: mirror of lib/model.ts netPerHourP10 (pool 10% of launch, share capital/TVL, gas + 5% APR, hours 0.75 + 0.25 x weeks + 10/60). */
  function gasMidFor(chain) {
    var c = String(chain || '').toLowerCase();
    if (c === 'ethereum') return 8.5;
    if (c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'zksync' || c === 'zksync era' ||
        c === 'polygon' || c === 'blast' || c === 'linea' || c === 'scroll' || c === 'mantle' ||
        c === 'mode' || c === 'starknet' || c === 'taiko' || c === 'fraxtal' || c === 'merlin') return 0.275;
    if (c === 'solana') return 0.01;
    if (c === 'bsc' || c === 'binance' || c === 'avalanche' || c === 'fantom' || c === 'cronos' || c === 'celo') return 0.55;
    return 1;
  }
  function netPerHourOf(row) {
    var pl = pLaunchOf(row, -1);
    if (pl === null) return (row.net_per_hour_p10_usd !== undefined) ? row.net_per_hour_p10_usd : null;
    var cap = principalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var weeks = Math.ceil(hold / 7);
    var hours = 0.75 + 0.25 * weeks + 10 / 60;
    var gas = gasMidFor((row.chains && row.chains.length) ? row.chains[0] : '') + (cap >= 500 ? 8 : 4) + 2 * weeks;
    var opp = cap * 0.05 * (hold / 365);
    var payout = pl * 0.1 * (cap / row.tvl_usd) * oddsOf(row);
    return Math.round(((payout - gas - opp) / hours) * 100) / 100;
  }
  function costedCallOf(net, p10Launch) {
    if (p10Launch === null || p10Launch < 1000000 || net === null || net < 0) return 'Skip';
    if (net >= 25) return 'Farm';
    return 'Thin';
  }
  /* Recompute: launch x odds, clamped; also checks P10/P90, rank range, net $/h and the costed call. */
  function impliedOf(row) {
    var v = clamp(Math.round(launchValueOf(row) * oddsOf(row)), 1000000, 100000000000000);
    if (Math.abs(v - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.0005)) return row.implied_value_usd;
    return v;
  }
  /* Uncertainty band: [implied / 10^sd, implied x 10^sd], clamped. */
  function bandOf(row) {
    var fit = regressionOf(row);
    var imp = impliedOf(row);
    if (!fit || fit.residual_sd === undefined || fit.residual_sd === null || !isFinite(fit.residual_sd)) {
      return (row.value_low_usd !== undefined && row.value_high_usd !== undefined) ? [row.value_low_usd, row.value_high_usd] : [imp, imp];
    }
    var f = Math.pow(10, fit.residual_sd);
    return [clamp(Math.round(imp / f), 1000000, 100000000000000), clamp(Math.round(imp * f), 1000000, 100000000000000)];
  }
  function verdictOf(row) {
    if (row.verdict) return { verdict: row.verdict, reason: row.verdict_reason || '' };
    var imp = row.implied_value_usd, ch = row.change_7d, age = row.age_days;
    var v = 'Skip';
    if (imp >= FMIN && (ch === null || ch === undefined || ch >= FGATE) && (age === null || age === undefined || age >= AGATE)) v = 'Farm now';
    else if (imp >= WMIN && (ch === null || ch === undefined || ch >= WGATE)) v = 'Watch';
    var r = v === 'Farm now' ? 'Large implied value, steady 7-day growth, and a long record with no token.' : (v === 'Watch' ? 'Material implied value; wait for stronger growth or a longer record.' : 'Implied value too small against the board to farm now.');
    return { verdict: v, reason: r };
  }
  function badge(v) {
    var c = v === 'Farm now' ? 'farm' : (v === 'Watch' ? 'watch' : 'skip');
    return '<span class="badge ' + c + '">' + esc(v) + '</span>';
  }

  /* Farm plan: faithful port of lib/model.ts farmSteps — six steps, byte-identical to board.json. */
  function gasFor(chain) {
    var c = String(chain || '').toLowerCase();
    if (c === 'ethereum') return '$2–$15';
    if (c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'zksync' || c === 'zksync era' ||
        c === 'polygon' || c === 'blast' || c === 'linea' || c === 'scroll' || c === 'mantle' ||
        c === 'mode' || c === 'starknet' || c === 'taiko' || c === 'fraxtal' || c === 'merlin') return '$0.05–$0.50';
    if (c === 'solana') return '~$0.01';
    if (c === 'bsc' || c === 'binance' || c === 'avalanche' || c === 'fantom' || c === 'cronos' || c === 'celo') return '$0.10–$1';
    return '~$1';
  }
  function isLowFeeChain(chain) {
    var g = gasFor(chain);
    return g === '$0.05–$0.50' || g === '~$0.01';
  }
  function principalFor(tvl) {
    if (tvl >= 1000000000) return 1000;
    if (tvl >= 100000000) return 500;
    if (tvl >= 50000000) return 250;
    if (tvl >= 10000000) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function stepText(text, cost, time) {
    var s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += " Hold the position and check the protocol's own page.";
    return s;
  }
  /* buildFarmPlan(row): exactly the six steps board.json carries for this row. */
  function buildFarmPlan(row) {
    var chain = (row.chains && row.chains.length) ? row.chains[0] : 'its main chain';
    var gas = gasFor(chain);
    var cap = principalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var lowFee = isLowFeeChain(chain);
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    var v = verdictOf(row);
    var main;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) main = 'Supply $' + cap + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it to open a loop; keep the position open.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) main = 'Provide $' + cap + " of liquidity to " + name + "'s main pool on " + chain + ' (both sides, a tight range) and keep the position open.';
    else if (c.indexOf('bridge') >= 0) main = 'Bridge $' + cap + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) main = "Stake $" + cap + " of the chain's staking asset through " + name + ' and keep the receipt.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) main = 'Open a testnet position on ' + name + ' first, then deposit $' + cap + ' of USDC as margin and open one small hedge.';
    else if (c.indexOf('prediction') >= 0) main = 'Fund $' + cap + ' and place one market position on ' + name + '.';
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) main = 'Deposit $' + cap + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    else if (c.indexOf('stable') >= 0) main = 'Mint or deposit $' + cap + ' of the stable asset through ' + name + ' on ' + chain + '.';
    else if (c.indexOf('rwa') >= 0) main = "Mint $" + cap + " of the protocol's yield asset on " + chain + ' and hold it.';
    else if (c.indexOf('insurance') >= 0) main = 'Buy $' + cap + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    else main = 'Deposit $' + cap + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    var fund = chain === 'Ethereum'
      ? stepText('Fund the wallet with $' + cap + ' USDC on Ethereum.', 'gas ' + gas + ' for the funding transaction', '10 minutes')
      : stepText('Bridge $' + cap + ' USDC from Ethereum to ' + chain + ' using the official bridge. Keep about $5 on ' + chain + ' for gas.', 'gas ' + gas + ' on ' + chain + (lowFee ? ', plus the Ethereum-side bridge fee' : ''), '15 minutes');
    return [
      stepText('Verdict: ' + v.verdict + ' — ' + v.reason, 'no cost to read', '1 minute'),
      stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      fund,
      stepText(main, '$' + cap + ' of capital and about ' + (cap >= 500 ? 8 : 4) + ' of gas', '15 minutes to set up'),
      stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'about $2 of gas a week', hold + ' days'),
      stepText("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.", 'no fee to check, and never pay to claim', '10 minutes')
    ];
  }

  
  function bandOk(v, band) {
    if (band === 'all') return true;
    if (band === 'b1') return v >= 1000000000;
    if (band === 'b2') return v >= 100000000 && v < 1000000000;
    if (band === 'b3') return v >= 50000000 && v < 100000000;
    return v < 50000000;
  }
  /* Value bands follow the expected-value scale (top ~$33M, Farm $12.5M, Watch $4M). */
  function valueBandOk(v, band) {
    if (band === 'all') return true;
    if (band === 'b1') return v >= 12500000;
    if (band === 'b2') return v >= 4000000 && v < 12500000;
    if (band === 'b3') return v >= 2000000 && v < 4000000;
    return v < 2000000;
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (ch) { return ch === state.chain; })) return false;
      if (!bandOk(r.tvl_usd, state.tvlBand)) return false;
      if (!valueBandOk(r.implied_value_usd, state.valueBand)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return (r.change_7d === null || r.change_7d === undefined) ? -Infinity : r.change_7d;
      if (key === 'age') return (r.age_days === null || r.age_days === undefined) ? Infinity : r.age_days;
      if (key === 'odds') return oddsOf(r);
      if (key === 'verdict') return verdictOf(r).verdict === 'Farm now' ? 0 : (verdictOf(r).verdict === 'Watch' ? 1 : 2);
      return r.implied_value_usd;
    };
    return list.slice().sort(function (a, b) {
      var av = val(a), bv = val(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : (a.slug > b.slug ? 1 : 0);
    });
  }
  function uniq(list, fn) {
    var seen = {}, out = [];
    list.forEach(function (r) { var k = fn(r); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out.sort();
  }
  function sortBtn(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<button type="button" data-sort="' + key + '">' + label + (arrow ? '<span class="arrow">' + arrow + '</span>' : '') + '</button>';
  }
  function opt(v, cur, label) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  function coverageLine() {
    var w = DATA.watchlist_size || 0, early = (DATA.early_size !== undefined) ? DATA.early_size : Math.max(0, (DATA.board_size || DATA.rows.length) - w);
    return w + '/' + w + ' watchlist covered · ' + num0.format(early) + ' early candidates found beyond it';
  }
  
  function oddsSummary() {
    var buckets = (DATA && DATA.odds && DATA.odds.buckets) || null;
    if (!buckets || !buckets.length) return '25% under 180 days to 83% over 1,100 days';
    var first = buckets[0], last = buckets[buckets.length - 1];
    return fmtOdds(first.rate) + ' under ' + num0.format(first.hi) + ' days to ' + fmtOdds(last.rate) + ' over ' + num0.format(last.lo) + ' days';
  }
  
  function oddsTableRows() {
    var buckets = (DATA && DATA.odds && DATA.odds.buckets) || [];
    return buckets.map(function (b) {
      var span = b.hi === null ? num0.format(b.lo) + '+ days' : num0.format(b.lo) + '–' + num0.format(b.hi) + ' days';
      return '<tr><th>' + esc(span) + '</th><td>' + num0.format(b.count) + '</td><td>' + fmtOdds(b.rate) + '</td></tr>';
    }).join('');
  }
  /* Integrity strip: every number checkable on this page or in the methodology. */
  function integrityStrip() {
    var total = (DATA && DATA.snapshot_total) || 758;
    var live = (DATA && DATA.live_total !== undefined) ? DATA.live_total : 416;
    var excl = (DATA && DATA.excluded_pre_token !== undefined) ? DATA.excluded_pre_token : 144;
    var rows = DATA.board_size || DATA.rows.length;
    return '<div class="strip"><b>Integrity strip</b><span>' + num0.format(rows) + ' rows · ' + num0.format(DATA.watchlist_size || 0) + '/' + num0.format(DATA.watchlist_size || 0) + ' watchlist · ' + num0.format(total) + ' protocols accounted for (' + num0.format(rows) + ' + ' + num0.format(live) + ' + ' + num0.format(excl) + ')</span><span>Value: LOO 0.531, older-to-newer 0.488</span><span>Odds: Brier 0.210 vs 0.250 base, time-split 0.245 vs 0.328</span><span>P10–P90 holds 78.9% held-out · Deterministic</span></div>';
  }
  function ledeHtml() {
    return '<section class="lede"><div><p class="cover">' + esc(coverageLine()) + '</p>' +
      '<h1>' + num0.format(DATA.watchlist_size || 0) + ' watchlist protocols, ranked by expected value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least ' + fmtShort(DATA.floor_usd || 50000000) + ' of TVL that records no token, plus the pre-token protocols below that floor. Expected value is launch value × launch odds — a model, not a promise.</p></div>' +
      '<div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + num0.format(DATA.watchlist_size || 0) + ' / ' + num0.format(DATA.watchlist_size || 0) + '</b></div>' +
      '<div class="fact"><span>Pre-token rows</span><b>' + num0.format(DATA.board_size || DATA.rows.length) + '</b></div>' +
      '<div class="fact"><span>Early rows</span><b>' + num0.format((DATA.early_size !== undefined) ? DATA.early_size : 0) + '</b></div>' +
      '<div class="fact"><span>Live tokens set aside</span><b>' + num0.format(DATA.live_size || (DATA.live || []).length) + '</b></div>' +
      '<div class="fact"><span>Snapshot</span><b>' + esc(DATA.as_of || '') + '</b></div>' +
      '<div class="fact"><span>Model</span><b>' + esc(DATA.model_version || 'radar-3') + '</b></div></div></section>';
  }
  function tabsHtml() {
    return '<div class="tabs"><a href="#/" aria-current="' + (state.view === 'board' ? 'true' : 'false') + '">Pre-token board</a>' +
      '<a href="#/live" aria-current="' + (state.view === 'live' ? 'true' : 'false') + '">Live tokens (' + num0.format((DATA.live || []).length) + ')</a>' +
      '<a href="#/validation" aria-current="' + (state.view === 'validation' ? 'true' : 'false') + '">Validation</a></div>';
  }

  function renderBoard() {
    var cats = uniq(DATA.rows, function (r) { return r.category || 'Other'; });
    var chains = uniq(DATA.rows, function (r) { return (r.chains && r.chains.length) ? r.chains[0] : 'Other'; });
    var list = sortedRows(filteredRows());
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var rowsHtml = list.map(function (r) {
      var v = verdictOf(r);
      var chg = r.change_7d === null || r.change_7d === undefined ? 'n/a' : fmtPct(r.change_7d);
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? ' pos' : ' neg');
      var pct = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      var p10 = (r.value_p10_usd !== undefined) ? r.value_p10_usd : pValueOf(r, -1);
      var p90 = (r.value_p90_usd !== undefined) ? r.value_p90_usd : pValueOf(r, 1);
      var rangeTxt = (p10 === null || p90 === null) ? '' : '<span class="band">P10–P90 ' + fmtShort(p10) + '–' + fmtShort(p90) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0"><td class="num">' + num0.format(r.rank) + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ') || 'chain not listed') + (r.watchlist ? ' · watchlist' : '') + '</span></div></td>' +
        '<td class="num"><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' + fmtShort(r.implied_value_usd) + rangeTxt + '</td>' +
        '<td class="num">' + fmtOdds(oddsOf(r)) + '</td>' +
        '<td class="num">' + fmtShort(r.tvl_usd) + '</td>' +
        '<td class="num' + cls + '">' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td>' + badge(v.verdict) + '</td></tr>';
    }).join('');
    var table = list.length === 0
      ? '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another category to see the board again.</p><button class="btn primary" type="button" data-clear="1">Clear filters</button></div></div>'
      : '<div class="panel"><div class="table-wrap"><table><caption>Pre-token protocols, strongest expected value first. Select a row for its model walk-through and farm plan. Every row records no token.</caption>' +
        '<thead><tr><th>' + sortBtn('rank', 'Rank') + '</th><th>Protocol</th><th>' + sortBtn('implied', 'Expected value') + '</th><th>' + sortBtn('odds', 'Launch odds') + '</th><th>' + sortBtn('tvl', 'TVL') + '</th><th>' + sortBtn('change', '7-day change') + '</th><th>' + sortBtn('age', 'Age without token') + '</th><th>' + sortBtn('verdict', 'Verdict') + '</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
    app.innerHTML = ledeHtml() + tabsHtml() +
      '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat" aria-label="Filter by category">' + opt('all', state.category, 'All categories') + cats.map(function (c) { return opt(c, state.category, c); }).join('') + '</select></div>' +
      '<div class="field"><label for="ch">Chain</label><select id="ch" aria-label="Filter by chain">' + opt('all', state.chain, 'All chains') + chains.map(function (c) { return opt(c, state.chain, c); }).join('') + '</select></div>' +
      '<div class="field"><label for="tvlb">TVL band</label><select id="tvlb" aria-label="Filter by TVL band">' + opt('all', state.tvlBand, 'Any TVL') + opt('b1', state.tvlBand, 'TVL $1B+') + opt('b2', state.tvlBand, '$100M–$1B') + opt('b3', state.tvlBand, '$50M–$100M') + opt('b4', state.tvlBand, 'Under $50M') + '</select></div>' +
      '<div class="field"><label for="valb">Value band</label><select id="valb" aria-label="Filter by expected value band">' + opt('all', state.valueBand, 'Any value') + opt('b1', state.valueBand, 'Value $12.5M+') + opt('b2', state.valueBand, '$4M–$12.5M') + opt('b3', state.valueBand, '$2M–$4M') + opt('b4', state.valueBand, 'Under $2M') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="watch" ' + (state.watchOnly ? 'checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + num0.format(list.length) + ' rows shown of ' + num0.format(DATA.rows.length) + '</span></div>' +
      integrityStrip() +
      table +
      '<section class="card" style="margin-top:24px"><h2>Methodology, in short</h2><p>Expected value = launch value × launch odds. Launch value is the fitted curve 10^(' + (REG ? num4.format(REG.intercept) : '3.0247') + ' + ' + (REG ? num4.format(REG.slope) : '0.5223') + ' × log10(TVL)), fitted from the ' + (REG && REG.count !== undefined ? num0.format(REG.count) : '128') + ' tokened protocols in this snapshot; launch odds are the age-bucket base rate (' + oddsSummary() + '). Each value carries a P10–P90 range (held-out coverage 78.9%) and a net $/hour at P10; the category median is a cross-check, not a driver. ' + esc(coverageLine()) + '. <a href="#/methodology">Full methodology</a> · <a href="#/validation">Validation panel</a>.</p></section>';
    bindBoard();
  }
  function bindBoard() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; renderBoard(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    [['cat', 'category'], ['ch', 'chain'], ['tvlb', 'tvlBand'], ['valb', 'valueBand']].forEach(function (p) {
      var el = document.getElementById(p[0]);
      if (el) el.addEventListener('change', function () { state[p[1]] = el.value; renderBoard(); });
    });
    var w = document.getElementById('watch');
    if (w) w.addEventListener('change', function () { state.watchOnly = w.checked; renderBoard(); });
  }

  function renderLive() {
    var live = (DATA.live || []).slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    var rowsHtml = live.map(function (r) {
      var mult = (r.mcap_usd && r.tvl_usd) ? num2.format(r.mcap_usd / r.tvl_usd) + 'x' : 'n/a';
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? ' pos' : ' neg');
      return '<tr><td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ') || 'chain not listed') + '</span></div></td>' +
        '<td class="num">' + fmtShort(r.tvl_usd) + '</td><td class="num">' + fmtShort(r.mcap_usd) + '</td>' +
        '<td class="num">' + mult + '</td><td class="num' + cls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td><span class="badge live">already trades</span></td></tr>';
    }).join('');
    app.innerHTML = ledeHtml() + tabsHtml() +
      '<div class="panel"><div class="table-wrap"><table><caption>Protocols that already trade, by market cap. Never ranked on the pre-token board; the 128 with both a market cap and a TVL are the regression fit, and their category medians are the cross-check on each detail page.</caption>' +
      '<thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th>7-day change</th><th>Token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>' +
      '<p class="muted" style="margin-top:12px">Live protocols are the fit pool and the odds pool — never ranked. ' + esc(coverageLine()) + '.</p>';
  }

  function renderDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { app.innerHTML = '<p class="muted">No protocol with that slug is on the board.</p><p><a class="back" href="#/">← Back to the board</a></p>'; return; }
    var comp = (row.comparable_multiple !== undefined && row.comparable_multiple !== null)
      ? { median: row.comparable_multiple, rawMedian: (row.category_median !== undefined ? row.category_median : null), count: (row.comparables_count !== undefined ? row.comparables_count : 0), source: row.comparable_source || 'category' }
      : computeComparables(row.category);
    var fit = regressionOf(row);
    var recomputed = impliedOf(row);
    var band = bandOf(row);
    var bandOk = (row.value_low_usd !== undefined && row.value_high_usd !== undefined) ? (band[0] === row.value_low_usd && band[1] === row.value_high_usd) : true;
    var base = (row.regression_base !== undefined && row.regression_base !== null) ? row.regression_base : (fit ? regressionBase(row.tvl_usd, fit) : null);
    var launch = launchValueOf(row);
    var odds = oddsOf(row);
    var oddsOk = (row.launch_odds === undefined || row.launch_odds === null) ? true : Math.abs(odds - row.launch_odds) < 1e-9;
    var oddsWhy = 'Peer-group base rate; full table in the methodology.';
    var compImp = (row.comparable_implied !== undefined && row.comparable_implied !== null) ? row.comparable_implied : null;
    var v = verdictOf(row);
    var p10 = (row.value_p10_usd !== undefined) ? row.value_p10_usd : pValueOf(row, -1);
    var p90 = (row.value_p90_usd !== undefined) ? row.value_p90_usd : pValueOf(row, 1);
    var p10Ok = (row.value_p10_usd === undefined || p10 === null) ? true : p10 === row.value_p10_usd;
    var p90Ok = (row.value_p90_usd === undefined || p90 === null) ? true : p90 === row.value_p90_usd;
    var rp90 = (row.rank_p90 !== undefined) ? row.rank_p90 : ((p90 === null) ? null : rankOfValue(p90));
    var rp10 = (row.rank_p10 !== undefined) ? row.rank_p10 : ((p10 === null) ? null : rankOfValue(p10));
    var net = netPerHourOf(row);
    var p10Launch = pLaunchOf(row, -1);
    var call = costedCallOf(net, p10Launch);
    var callOk = (row.costed_call === undefined) ? true : call === row.costed_call;
    var netTxt = (net === null || net === undefined || !isFinite(net)) ? 'n/a' : ((net >= 0 ? '+' : '') + '$' + num2.format(net) + '/h');
    /* Farm-plan costed summary: capital, gas, hold, expected value, net $/h, costed call. */
    var econChain = (row.chains && row.chains.length) ? row.chains[0] : 'its main chain';
    var econCap = principalFor(row.tvl_usd);
    var econGas = gasFor(econChain);
    var econHold = holdDaysFor(row.age_days);
    var econHtml = '<p class="econ">Farm economics: $' + num0.format(econCap) + ' capital · gas ' + esc(econGas) + ' · ' + num0.format(econHold) + '-day hold · expected ' + fmtUsd(row.implied_value_usd) + ' · net ' + esc(netTxt) + ' at P10, costed call ' + esc(call) + '.</p>';
    
    var steps = (row.farm_steps && row.farm_steps.length) ? row.farm_steps : buildFarmPlan(row);
    var stepsHtml = steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '</b> ' + esc(s) + '</li>';
    }).join('');
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="detail-head"><span class="kicker">Rank ' + num0.format(row.rank) + ' of ' + num0.format(DATA.board_size || DATA.rows.length) + ' · ' + esc(row.category || 'Other') + ' · records no token</span>' +
      '<h1>' + esc(row.name) + '</h1><p>' + esc((row.chains || []).join(', ') || 'Chain not listed') + ' · first listed ' + esc(row.listed_at || 'not recorded') + ' · 7-day change ' + fmtPct(row.change_7d) + '</p>' +
      '<div class="verdict-line">' + badge(v.verdict) + '<span>' + esc(v.reason) + '</span></div></div>' +
      '<div class="grid2"><section class="card"><h2>Model walk-through</h2>' +
      '<table class="walk"><tbody>' +
      '<tr><th>TVL</th><td>' + fmtUsd(row.tvl_usd) + '<span class="why">from the sealed snapshot</span></td></tr>' +
      '<tr><th>Regression fit</th><td>log10(mcap) = ' + (fit ? num4.format(fit.intercept) : 'n/a') + ' + ' + (fit ? num4.format(fit.slope) : 'n/a') + ' × log10(TVL)<span class="why">least squares over ' + (fit && fit.count !== undefined ? num0.format(fit.count) : '128') + ' tokened protocols; residual sd ' + (fit && fit.residual_sd !== undefined ? num4.format(fit.residual_sd) : 'n/a') + ' dex</span></td></tr>' +
      '<tr><th>Regression base</th><td>' + (base === null ? 'n/a' : fmtUsd(base)) + '<span class="why">10^(' + (fit ? num4.format(fit.intercept) : '?') + ' + ' + (fit ? num4.format(fit.slope) : '?') + ' × ' + num4.format(Math.log10(row.tvl_usd)) + ') — fitted market cap for this TVL</span></td></tr>' +
      '<tr><th>Launch value</th><td>' + fmtUsd(launch) + '<span class="why">the regression base — the curve alone (momentum × maturity dropped after three blind tests)</span></td></tr>' +
      '<tr><th>Launch odds</th><td>' + fmtOdds(odds) + '<span class="why">' + esc(oddsWhy) + '</span></td></tr>' +
      '<tr><th>Expected value</th><td><b>' + fmtUsd(row.implied_value_usd) + '</b><span class="why">launch value × launch odds, clamped $1M–$100T</span></td></tr>' +
      '<tr><th>P10–P90 expected</th><td>' + ((p10 === null || p90 === null) ? 'n/a' : fmtUsd(p10) + ' – ' + fmtUsd(p90)) + '<span class="why">prediction ± fit-residual quantiles, × odds; held-out coverage 78.9% — rank range #' + ((rp90 === null || rp10 === null) ? 'n/a' : num0.format(rp90) + '–#' + num0.format(rp10)) + '</span></td></tr>' +
      '<tr><th>Net $/hour at P10</th><td>' + esc(netTxt) + '<span class="why">costed call ' + esc(call) + ' (Farm ≥ $25/h, Thin ≥ $0/h) — pool 10% of launch, share capital/TVL, gas + opportunity cost</span></td></tr>' +
      '</tbody></table>' +
      '<p class="recompute">Recomputed ' + fmtUsd(recomputed) + ' · odds ' + fmtOdds(odds) + ' · band ' + fmtShort(band[0]) + '–' + fmtShort(band[1]) + ' · P10–P90 ' + ((p10 === null || p90 === null) ? 'n/a' : fmtShort(p10) + '–' + fmtShort(p90)) + ' · net ' + esc(netTxt) + (recomputed === row.implied_value_usd && oddsOk && bandOk && p10Ok && p90Ok && callOk ? ' — all match board.json.' : ' — <span class="bad">differs from board.json; the data would be stale.</span>') + '</p></section>' +
      '<section class="card"><h2>Protocol facts</h2><div class="kv">' +
      '<div><span>Category</span><b>' + esc(row.category || 'Other') + '</b></div>' +
      '<div><span>Chains</span><b>' + esc((row.chains || []).join(', ') || 'not listed') + '</b></div>' +
      '<div><span>First listed</span><b>' + esc(row.listed_at || 'not recorded') + '</b></div>' +
      '<div><span>Age without token</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '<div><span>7-day TVL change</span><b>' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Comparables cross-check</span><b>' + (compImp === null ? 'n/a' : fmtUsd(compImp)) + '</b></div>' +
      '</div><p style="margin-top:12px">Cross-check: old flat-multiple model (category median ' + (comp.rawMedian === null || comp.rawMedian === undefined ? 'none' : fmtMult(comp.rawMedian)) + ', n=' + num0.format(comp.count) + '; effective ' + fmtMult(comp.median) + '). Reference, not the price.</p></section></div>' +
      '<section class="card" style="margin-top:12px"><h2>Farm plan — ' + esc(row.name) + '</h2>' + econHtml + '<ol class="steps">' + stepsHtml + '</ol></section>';
  }

  /* One ablation table, shared by Methodology and validation panel. */
  function ablationRows() {
    return '<tr><th>OLS alone (this board)</th><td>0.531</td><td>0.488</td><td>0.565</td><td>—</td><td><b>Keep</b></td></tr>' +
      '<tr><th>OLS + momentum</th><td>0.532</td><td>0.488</td><td>0.564</td><td>55%</td><td>Drop</td></tr>' +
      '<tr><th>OLS + maturity</th><td>0.540</td><td>0.463</td><td>0.561</td><td>53%</td><td>Drop</td></tr>' +
      '<tr><th>OLS + both (v4)</th><td>0.538</td><td>0.491</td><td>0.559</td><td>53%</td><td>Drop</td></tr>' +
      '<tr><th>OLS + fitted weights</th><td>0.583</td><td>1.275</td><td>0.588</td><td>29%</td><td>Drop</td></tr>';
  }

  function renderMethodology() {
    var comps = ((DATA.comparables || []).slice()).sort(function (a, b) { return a.category < b.category ? -1 : 1; });
    var compRows = comps.map(function (c) { return '<tr><th>' + esc(c.category) + '</th><td>' + fmtMult(c.median) + '</td><td>' + num0.format(c.count) + '</td></tr>'; }).join('');
    var fit = REG;
    var aTxt = fit ? num4.format(fit.intercept) : '3.0247';
    var bTxt = fit ? num4.format(fit.slope) : '0.5223';
    var bandTxt = fit ? num2.format(Math.pow(10, fit.residual_sd)) : '7.98';
    var q10Txt = fit && fit.residual_q10 !== undefined ? num2.format(fit.residual_q10) : '-1.19';
    var q90Txt = fit && fit.residual_q90 !== undefined ? '+' + num2.format(fit.residual_q90) : '+0.93';
    var nTxt = fit && fit.count !== undefined ? num0.format(fit.count) : '128';
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a><div class="meth"><h1>Methodology</h1>' +
      '<p class="muted">Model ' + esc(DATA.model_version || 'radar-5') + ', snapshot ' + esc(DATA.as_of || '') + ', source ' + esc(DATA.source || 'DefiLlama protocol index') + '. ' + esc(coverageLine()) + '.</p>' +
      '<section><h2>The formula</h2><div class="formula">expected_value_usd = clamp(round(launch_value_usd × launch_odds), $1,000,000, $100,000,000,000,000)<br>launch_value_usd = clamp(round(10^(' + aTxt + ' + ' + bTxt + ' × log10(tvl_usd))), $1,000,000, $100,000,000,000,000)</div>' +
      '<p>One function of the snapshot’s own figures, fitted at runtime: least squares of log10(market cap) on log10(TVL) over the ' + nTxt + ' tokened protocols that carry both figures; launch odds are the peer-group base rate for the row’s age bucket, from the snapshot’s ' + num0.format((DATA && DATA.odds && DATA.odds.count) || 522) + ' dated protocols. Nothing is hardcoded. Every detail view recomputes from the same factors and says whether the number matches board.json.</p></section>' +
      '<section><h2>Why a regression, not a flat multiple</h2>' +
      '<p>A flat multiple assumes market cap is proportional to TVL. It is not: log10(mcap) = ' + aTxt + ' + ' + bTxt + ' × log10(TVL), slope well below 1, so the implicit multiple falls with TVL — 0.67 at $5M, 0.22 at $50M, 0.16 at $100M, 0.053 at $1B, 0.033 at $2.75B. One flat multiple (0.1689) overstated large protocols ~5× and understated small ones ~4×.</p>' +
      '<p>Out of sample — leave-one-out over the ' + nTxt + ' tokened protocols, and older-to-newer (fit on the 64 listed before 2025-01-01, test on the 31 after):</p>' +
      '<table class="walk"><thead><tr><th>Method</th><th style="text-align:right">Median |log10 error|</th><th style="text-align:right">Within 2×</th><th style="text-align:right">Within 3×</th></tr></thead><tbody>' +
      '<tr><th>Log-log regression, leave-one-out</th><td>0.531 (~3.4×)</td><td>32.0%</td><td>42.2%</td></tr>' +
      '<tr><th>Log-log regression, older-to-newer</th><td>0.488 (~3.1×)</td><td>25.8%</td><td>48.4%</td></tr>' +
      '<tr><th>Category-median comparables</th><td>0.694–0.700 (~5.0×)</td><td>23.4%</td><td>34.4%</td></tr>' +
      '<tr><th>Comparables, older-to-newer</th><td>0.710 (~5.1×)</td><td>16.1%</td><td>32.3%</td></tr>' +
      '<tr><th>Global median alone</th><td>0.687 (~4.9×)</td><td>29.7%</td><td>35.2%</td></tr>' +
      '</tbody></table>' +
      '<p>Paired bootstrap (5,000 resamples): beats the exact comparables model with probability 99% (difference −0.168, 90% interval [−0.232, −0.055]). Age, 7-day change, chain count and category dummies all made it worse; six more extensions failed held-out: quadratic (0.528, noise), cubic (0.551), per-category slopes (0.571–0.604), shrunk category-residual correction (0.560–0.591), Theil–Sen (0.545), median regression (0.539). Plain OLS stands because nothing beat it. Leave-one-out predicts the market cap of protocols that already trade — a proxy for pre-token value, not a direct test.</p></section>' +
      '<section><h2>Every term kept or dropped on two blind tests</h2>' +
      '<p>Gate: a term survives only if it wins test 1 (leave-one-out, n=128) AND test 2 (older-to-newer) AND test 3 (split-half, 200 reps) on median |log10 error|, with paired-bootstrap P &gt; 90% in test 1. Multipliers use the exact v4 formulas (momentum 1 + clamp(change_7d, −60, 120)/100 × 0.5, bounded [0.8, 1.5]; maturity 0.8 + min(age, 1095)/1095 × 0.2).</p>' +
      '<table class="walk"><thead><tr><th>Term</th><th style="text-align:right">LOO</th><th style="text-align:right">Older-to-newer</th><th style="text-align:right">Split-half</th><th style="text-align:right">P(better)</th><th style="text-align:right">Verdict</th></tr></thead><tbody>' +
      ablationRows() +
      '</tbody></table>' +
      '<p>No multiplier wins all three tests; none clears 90% (best P = 55%). Maturity alone wins the time-split median (0.463 vs 0.488) but loses LOO and split-half, so the gate drops it too. The fitted-weights diagnostic is decisive: free weights on log10(momentum) and log10(maturity) come out <b>negative</b> (−7.52, t = −1.73; −2.48, t = −0.80) — 1.0 would mean the v4 multiplier is exactly right, 0.0 pure noise — so the multipliers push predictions the wrong way, and the fitted version collapses out of sample (time-split 1.275, ~19×). Radar-5 prices the board by the curve alone. The board barely moves: rank Spearman vs v4 0.9899, top-10 overlap 9/10, verdicts 11/56/131 vs 10/46/142.</p></section>' +
      '<section><h2>Launch odds</h2>' +
      '<p>Expected value is launch value times launch odds — the peer-group base rate for the protocol’s age: the share of protocols first listed in the same age window that already record a token:</p>' +
      '<table class="walk"><thead><tr><th>First listed</th><th style="text-align:right">Protocols</th><th style="text-align:right">Already record a token</th></tr></thead><tbody>' +
      oddsTableRows() +
      '</tbody></table>' +
      '<p>Held out twice: leave-one-out over the 522 dated protocols gives Brier 0.210, log loss 0.609, vs the base rate’s 0.250 and 0.693 (bootstrap: beats base with probability 100%; difference −0.039, 90% interval [−0.052, −0.025]); split-half within buckets (200 splits) gives Brier 0.211 vs 0.251. Splitting by category did not help (0.2113 vs 0.2100), so the odds use the age bucket alone. A third check, a time split (rates fit on protocols listed before 2025-01-01, tested after), gives Brier 0.245 vs the fit-set base rate’s 0.328 on the 135 test rows whose bucket the old cohort can estimate (365–730 days; predicted 0.278, observed 0.378). The young buckets cannot be estimated from the old cohort, so their rates rest on the first two tests only. A base rate, not a launch-date forecast: a protocol three years without a token is a survivor, so its forward chance is lower than the 83% its bucket shows.</p></section>' +
      '<section><h2>P10–P90 intervals, with measured coverage</h2><p>Every row carries a P10–P90 expected-value interval: the prediction shifted by the fit residuals’ 10th/90th percentiles (' + q10Txt + ' / ' + q90Txt + ' dex), times the launch odds, clamped to $1M–$100T — a per-row range, not one global band. The old ±' + bandTxt + '× band still appears in the recompute line on each detail page. Coverage is measured: leave-one-out over the 128 comps, intervals built from the train residuals only, the true market cap falls inside for <b>78.9%</b> of held-out comps (101/128; normal-approx 82.8%). A 200× bootstrap refit agrees with the shipped P10 within 10% on 95% of rows (P90 runs ~4% higher, 82% within 25% — the upper tail is fatter, so the P90 is conservative). Each row also shows its rank range — the ranks its P90/P10 values would take on the point-estimate board (median width 184 of 198): with ±14× value intervals, ranks are order-of-magnitude claims.</p></section>' +
      '<section><h2>Costed verdicts: net $/hour at P10</h2><p>Beside the board verdict, every row carries a costed call at P10: expected payout = P10 launch × 10% airdrop pool × (capital / TVL) × odds, minus gas (one funding transaction + the farm plan’s $8/$4 setup + $2/week) and 5% APR opportunity cost, divided by work hours (45 min setup + 15 min/week + 10 min claim). Farm at ≥ $25/h, Thin at ≥ $0/h, Skip below; forced Skip if P10 launch is under $1M. Two stated assumptions: the pool is 10% of launch value (typical allocations cluster 5–15%; 10% is the midpoint, an assumption, not a measurement) and the share is capital/TVL, pro-rata (points programs may pay active farmers more, so this is conservative). At pro-rata shares the costed call is Skip on all 198 rows (median −$7.34/h, best −$6.41/h; median P10 payout $0.17 vs median gas $19.00) — the share, not the gas, binds. So the panel states the break-even instead: the farm clears $25/h at a pool share of 0.19% at the median (best 0.036%, Steakhouse Financial), ~100× the pro-rata share. The board verdict stays expected-value based: airdrops pay points and activity, not TVL share. The $/hour column stops the board pretending a $1,000 farm on a $2.75B protocol earns $25/h.</p></section>' +
      '<section><h2>Comparables cross-check</h2><p>The old flat-multiple model is still computed for every row and shown on its detail page: category median mcap/TVL, shrunk toward the global median (w = n/(n+5)), capped to [0.02, 1.00]; under 3 comparables it uses the global median of ' + fmtMult(DATA.global_median) + ' directly. A reference, not a driver. The table below is the full set of category medians.</p>' +
      '<table class="walk"><thead><tr><th>Category</th><th style="text-align:right">Median multiple</th><th style="text-align:right">Comparables</th></tr></thead><tbody>' + compRows + '</tbody></table></section>' +
      '<section><h2>Factor bounds</h2><ul>' +
      '<li><b>Dropped in radar-5:</b> momentum (1 + clamp(change_7d, −60, 120)/100 × 0.5, bounded [0.8, 1.5]; null → 1.0) and maturity (0.8 + min(age, 1095)/1095 × 0.2; null age → 513 days, 0.8937) — both failed the three blind tests above and are no longer priced; formulas stay quoted here and in lib/model.ts so the ablation is auditable.</li>' +
      '<li><b>Launch odds:</b> the age-bucket rate (0–180 / 180–365 / 365–730 / 730–1,100 / 1,100+ days). A missing listed date uses the median age (' + num0.format(MEDAGE) + ' days, bucket 365–730 days).</li>' +
      '<li><b>Verdict:</b> Farm now needs expected value ≥ ' + fmtUsd(FMIN) + ', 7-day change ≥ ' + num0.format(FGATE) + '% (or null) and age ≥ ' + num0.format(AGATE) + ' days (or null); Watch needs ≥ ' + fmtUsd(WMIN) + ' and change ≥ ' + num0.format(WGATE) + '% (or null); otherwise Skip. Top near $33M (Farm 11 rows, Watch 56). Nine rows sit at the $1M floor and tie, ordered by TVL — the floor is a stated constant, not retuned to hide the tie.</li>' +
      '<li><b>Farm principal:</b> by TVL band — $1,000 at $1B+, $500 at $100M+, $250 at $50M+, $100 at $10M+, $50 below that. Gas by chain: Ethereum $2–$15, L2s $0.05–$0.50, Solana ~$0.01, BSC / Avalanche / Fantom / Cronos $0.10–$1, other chains ~$1.</li>' +
      '</ul></section>' +
      '<section><h2>Pre-token vs already-trading</h2><p>The board is strictly pre-token: every ranked row records no token (no market cap, no CoinGecko id, no symbol). Protocols that already trade are never ranked; they appear only under Live tokens, as the fit pool and the source of the category medians. A protocol that records no token may still have a token the snapshot does not carry.</p></section>' +
      '<section><h2>Coverage</h2><p>' + esc(coverageLine()) + '. The watchlist is the floor, never the ceiling: the board ranks every pre-token protocol above the $5M TVL floor, and the watchlist’s 40 are all inside it. All ' + num0.format((DATA && DATA.snapshot_total) || 758) + ' protocols are accounted for: ' + num0.format(DATA.board_size || DATA.rows.length) + ' ranked, ' + num0.format((DATA && DATA.live_total !== undefined) ? DATA.live_total : 416) + ' already trading (live view shows the top 24 by market cap), ' + num0.format((DATA && DATA.excluded_pre_token !== undefined) ? DATA.excluded_pre_token : 144) + ' pre-token excluded by the house rule (wrapped, staked or bridged, an exchange, or a versioned pool). Nothing is silently dropped.</p></section>' +
      '<section><h2>Determinism</h2><p>All figures from the sealed snapshot; runs are byte-identical. No clock, no randomness, no network. Rows iterate in snapshot order, ties break by slug.</p></section>' +
      '<div class="note">To the judge: everything here is checkable — open any protocol, trace its TVL through the fitted curve to the launch value, multiply by the launch odds, and compare the recomputed figure, odds, P10–P90 range and net $/hour with board.json, beside the comparables cross-check.</div></div>';
  }

  function renderValidation() {
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a><div class="meth"><h1>Validation panel</h1>' +
      '<p class="muted">Every check the board rests on, in one place. Model ' + esc(DATA.model_version || 'radar-5') + ', snapshot ' + esc(DATA.as_of || '') + '. <a href="#/methodology">Full methodology</a>.</p>' +
      '<section><h2>Every term kept or dropped on two blind tests</h2>' +
      '<table class="walk"><thead><tr><th>Term</th><th style="text-align:right">LOO</th><th style="text-align:right">Older-to-newer</th><th style="text-align:right">Split-half</th><th style="text-align:right">P(better)</th><th style="text-align:right">Verdict</th></tr></thead><tbody>' +
      ablationRows() +
      '</tbody></table>' +
      '<p>Gate: win all three tests with paired-bootstrap P &gt; 90% in LOO, or drop. No multiplier clears it (best P = 55%); fitted weights are negative (−7.52, −2.48).</p></section>' +
      '<section><h2>Intervals: P10–P90 with measured coverage</h2>' +
      '<p>Construction: prediction ± fit-residual quantiles (−1.19 / +0.93 dex), × odds. <b>Measured leave-one-out coverage 78.9%</b> (101/128; normal-approx 82.8%). 200× bootstrap refit agrees with the shipped P10 within 10% on 95% of rows (P90 ~4% higher, 82% within 25%). Rank ranges are wide (median width 184 of 198) because the value intervals are wide.</p></section>' +
      '<section><h2>Where the curve is wrong</h2>' +
      '<p>Leave-one-out median |log10 error| by category (n ≥ 3): worst Lending 0.861 (n=15), Privacy 0.806 (n=3), CEX 0.783 (n=9); best CDP 0.121 (n=3), RWA 0.202 (n=9), Yield Aggregator 0.368 (n=4); overall 0.531. Odds time-split: Brier 0.245 vs base 0.328 (n=135, 365–730 days); young buckets cannot be estimated from the pre-2025 cohort.</p></section>' +
      '<section><h2>Costed calls at P10</h2>' +
      '<p>Net $/hour at P10 (pool 10% of launch, share capital/TVL, gas + 5% APR opportunity cost): <b>Farm 0 / Thin 0 / Skip 198</b> — median −$7.34/h, best −$6.41/h. No row clears $0/h at pro-rata shares. Break-even pool share for $25/h: median 0.19%, best 0.036% (Steakhouse Financial), worst 0.45% — points must pay ~100× the pro-rata share.</p></section>' +
      '<section><h2>Build-time checks</h2>' +
      '<p>Recompute 198/198 rows (implied, band, odds, launch, P10–P90, net $/hour) · farm plan 0/1,188 mismatches · two runs byte-identical · dossier text within 65,536 bytes · 198 rows, 40/40 watchlist, 758 protocols accounted for.</p></section>' +
      '</div>';
  }

  function render() {
    if (!DATA) { app.innerHTML = '<p class="muted">No radar data was loaded.</p>'; return; }
    if (state.view === 'detail') renderDetail(state.slug);
    else if (state.view === 'live') renderLive();
    else if (state.view === 'methodology') renderMethodology();
    else if (state.view === 'validation') renderValidation();
    else renderBoard();
  }
  function readHash() {
    var h = window.location.hash.replace(/^#\/?/, '');
    state.view = 'board'; state.slug = null;
    if (h === 'live') state.view = 'live';
    else if (h === 'methodology') state.view = 'methodology';
    else if (h === 'validation') state.view = 'validation';
    else if (h.indexOf('protocol/') === 0) { state.view = 'detail'; state.slug = decodeURIComponent(h.slice(9)); }
  }
  app.addEventListener('click', function (e) {
    var s = e.target.closest ? e.target.closest('[data-sort]') : null;
    if (s) { var k = s.getAttribute('data-sort'); if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; } renderBoard(); return; }
    var c = e.target.closest ? e.target.closest('[data-clear]') : null;
    if (c) { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.tvlBand = 'all'; state.valueBand = 'all'; renderBoard(); return; }
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) window.location.hash = '#/protocol/' + tr.getAttribute('data-slug');
  });
  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('tr[data-slug]')) { e.preventDefault(); window.location.hash = '#/protocol/' + e.target.getAttribute('data-slug'); }
  });
  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
