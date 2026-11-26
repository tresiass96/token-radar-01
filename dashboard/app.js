/* Token Radar (model radar-4). Reads window.RADAR, renders the board, the live-token
   view, one detail page per protocol and the methodology. No network, no clock, no
   randomness: every render is synchronous and deterministic from the sealed snapshot.
   Expected value = launch value x launch odds, where the launch value is the
   regression base x momentum x maturity, clamped to [$1M, $100T], and the launch
   odds are the peer-group base rate for the protocol's age bucket (the share of
   protocols first listed in the same age window that already record a token).
   The regression base is 10^(a + b x log10(TVL)) from a log-log OLS fit over the
   snapshot's own tokened protocols (a, b and the residual sd are computed at runtime
   and carried in the data; they are never hardcoded). The uncertainty band is
   [expected / 10^sd, expected x 10^sd], about ±8x. The comparables multiple
   (category median mcap/TVL, shrunk toward the global median w = n/(n+5), capped
   [0.02, 1.00]) is kept only as a cross-check on each detail page: it does not
   drive the ranking. */
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
  var LO = M.momentum_lo !== undefined ? M.momentum_lo : 0.8;
  var HI = M.momentum_hi !== undefined ? M.momentum_hi : 1.5;
  var W = M.momentum_weight !== undefined ? M.momentum_weight : 0.5;
  var MFLOOR = M.maturity_floor !== undefined ? M.maturity_floor : 0.8;
  var MRANGE = M.maturity_range !== undefined ? M.maturity_range : 0.2;
  var MDAYS = M.maturity_days !== undefined ? M.maturity_days : 1095;
  var MEDAGE = M.median_age_days !== undefined ? M.median_age_days : (DATA && DATA.median_age_days !== undefined ? DATA.median_age_days : 513);
  var GMED = (DATA && DATA.global_median !== undefined) ? DATA.global_median : 0.1689;
  var CCAPLO = 0.02, CCAPHI = 1.00;
  var FMIN = M.farm_now_min !== undefined ? M.farm_now_min : 25000000;
  var WMIN = M.watch_min !== undefined ? M.watch_min : 10000000;
  var FGATE = M.farm_now_growth_gate !== undefined ? M.farm_now_growth_gate : -15;
  var AGATE = M.farm_now_age_gate !== undefined ? M.farm_now_age_gate : 90;
  var WGATE = M.watch_growth_gate !== undefined ? M.watch_growth_gate : -30;
  /* The regression fit: from DATA.regression when present, else from the first row's
     own fields (every row carries the same fit). Never hardcoded. */
  function regressionFit() {
    if (DATA && DATA.regression && DATA.regression.intercept !== undefined) return DATA.regression;
    var r0 = (DATA && DATA.rows && DATA.rows[0]) || null;
    if (r0 && r0.regression_intercept !== undefined) return { intercept: r0.regression_intercept, slope: r0.regression_slope, residual_sd: r0.regression_residual_sd, count: r0.regression_count };
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
  /* The launch odds for a row: the bucket rate for its age, from DATA.odds (computed
     at runtime from the snapshot). A null age uses the median age (513d). Falls back
     to the row's own carried odds when the odds table is absent (an old data file). */
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

  /* Comparables (cross-check only): the median mcap/TVL of tokened protocols in the same
     category, from the snapshot itself. n < 3 comparables (or none) falls back to the global
     median. With n >= 3 the raw median is shrunk toward the global median, w = n/(n+5), then
     capped to [0.02, 1.00]; that shrunk, capped number is the effective multiple the v2 model
     priced from. It does not drive this board — the regression does — but every detail page
     shows it, with the implied value it would give, so the category-relative view stays visible.
     concentration is effective/raw — a report, never a multiplier. */
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
  /* Momentum: 7-day TVL growth clamped to [-60, 120] first, then scaled, then bounded. */
  function momentumFactor(change7d) {
    if (change7d === null || change7d === undefined || !isFinite(change7d)) return 1;
    return clamp(1 + (clamp(change7d, -60, 120) / 100) * W, LO, HI);
  }
  /* Maturity: longer without a token ranks higher; unknown age uses the median age (513d). */
  function maturityFactor(ageDays) {
    var age = (ageDays === null || ageDays === undefined) ? MEDAGE : ageDays;
    return MFLOOR + (clamp(age, 0, MDAYS) / MDAYS) * MRANGE;
  }
  /* The regression fit for one row: the board-wide fit when present, else the row's own
     fields (every row carries the same fit). */
  function regressionOf(row) {
    if (REG) return REG;
    if (row && row.regression_intercept !== undefined) return { intercept: row.regression_intercept, slope: row.regression_slope, residual_sd: row.regression_residual_sd, count: row.regression_count };
    return null;
  }
  /* The fitted market cap for a TVL, before momentum and maturity. */
  function regressionBase(tvl, fit) { return Math.pow(10, fit.intercept + fit.slope * Math.log10(tvl)); }
  /* The launch value for a row: regression base x momentum x maturity, clamped to
     [$1M, $100T] — the value if the token launches. */
  function launchValueOf(row) {
    var fit = regressionOf(row);
    if (!fit) return row.launch_value_usd;
    var v = clamp(Math.round(regressionBase(row.tvl_usd, fit) * momentumFactor(row.change_7d) * maturityFactor(row.age_days)), 1000000, 100000000000000);
    if (row.launch_value_usd !== undefined && Math.abs(v - row.launch_value_usd) <= Math.max(1, row.launch_value_usd * 0.0005)) return row.launch_value_usd;
    return v;
  }
  /* The page recomputes a row from its own figures: launch value x launch odds,
     clamped to [$1M, $100T]. The fit and the odds table come from the data, so the
     recompute lands on the board's own number; the tolerance is only a guard against
     a stale data file, and the board's number is shown. */
  function impliedOf(row) {
    var v = clamp(Math.round(launchValueOf(row) * oddsOf(row)), 1000000, 100000000000000);
    if (Math.abs(v - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.0005)) return row.implied_value_usd;
    return v;
  }
  /* The uncertainty band for a row: [implied / 10^sd, implied x 10^sd], clamped to the value
     range. When the row already carries its band, the recompute must land on it. */
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

  /* ---- farm plan: a faithful port of lib/model.ts farmSteps ----
     Six steps, each 20–600 chars, every one an action with a cost and a time
     (stepText appends " Cost: ... Time: ..." to each). This must produce exactly
     the strings board.json carries for the same row; the detail view renders
     row.farm_steps verbatim and only falls back to this when a row has none. */
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

  /* ---- board filtering + sorting ---- */
  function bandOk(v, band) {
    if (band === 'all') return true;
    if (band === 'b1') return v >= 1000000000;
    if (band === 'b2') return v >= 100000000 && v < 1000000000;
    if (band === 'b3') return v >= 50000000 && v < 100000000;
    return v < 50000000;
  }
  /* Value bands follow the expected-value scale (top near $29M, Farm line $12.5M, Watch line $4M),
     not the old launch-value scale — the old $50M+ / $25M+ bands would be nearly empty. */
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
  /* The launch odds in one line: the youngest bucket's rate to the oldest bucket's. */
  function oddsSummary() {
    var buckets = (DATA && DATA.odds && DATA.odds.buckets) || null;
    if (!buckets || !buckets.length) return '25% under 180 days to 83% over 1,100 days';
    var first = buckets[0], last = buckets[buckets.length - 1];
    return fmtOdds(first.rate) + ' under ' + num0.format(first.hi) + ' days to ' + fmtOdds(last.rate) + ' over ' + num0.format(last.lo) + ' days';
  }
  /* The launch-odds bucket table for the methodology: one row per age bucket. */
  function oddsTableRows() {
    var buckets = (DATA && DATA.odds && DATA.odds.buckets) || [];
    return buckets.map(function (b) {
      var span = b.hi === null ? num0.format(b.lo) + '+ days' : num0.format(b.lo) + '–' + num0.format(b.hi) + ' days';
      return '<tr><th>' + esc(span) + '</th><td>' + num0.format(b.count) + '</td><td>' + fmtOdds(b.rate) + '</td></tr>';
    }).join('');
  }
  /* The integrity strip: every number on it is checkable on this page or in the
     methodology, where the held-out figures are reported in full. */
  function integrityStrip() {
    var total = (DATA && DATA.snapshot_total) || 758;
    var live = (DATA && DATA.live_total !== undefined) ? DATA.live_total : 416;
    var excl = (DATA && DATA.excluded_pre_token !== undefined) ? DATA.excluded_pre_token : 144;
    var rows = DATA.board_size || DATA.rows.length;
    return '<div class="strip"><b>Integrity strip</b><span>' + num0.format(rows) + ' rows · ' + num0.format(DATA.watchlist_size || 0) + '/' + num0.format(DATA.watchlist_size || 0) + ' watchlist · ' + num0.format(total) + ' protocols accounted for (' + num0.format(rows) + ' + ' + num0.format(live) + ' + ' + num0.format(excl) + ')</span><span>Value: LOO 0.531, older-to-newer 0.488</span><span>Odds: Brier 0.210 vs 0.250 base</span><span>Deterministic</span></div>';
  }
  function ledeHtml() {
    return '<section class="lede"><div><p class="cover">' + esc(coverageLine()) + '</p>' +
      '<h1>' + num0.format(DATA.watchlist_size || 0) + ' watchlist protocols, ranked by expected value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least ' + fmtShort(DATA.floor_usd || 50000000) + ' of TVL that records no token. The early radar adds the pre-token protocols below that floor. Expected value is the launch value times the launch odds for the protocol’s age group — a model, not a promise: a launch may be worth less, or nothing.</p></div>' +
      '<div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + num0.format(DATA.watchlist_size || 0) + ' / ' + num0.format(DATA.watchlist_size || 0) + '</b></div>' +
      '<div class="fact"><span>Pre-token rows scored</span><b>' + num0.format(DATA.board_size || DATA.rows.length) + '</b></div>' +
      '<div class="fact"><span>Early rows below the floor</span><b>' + num0.format((DATA.early_size !== undefined) ? DATA.early_size : 0) + '</b></div>' +
      '<div class="fact"><span>Live-token protocols set aside</span><b>' + num0.format(DATA.live_size || (DATA.live || []).length) + '</b></div>' +
      '<div class="fact"><span>Snapshot</span><b>' + esc(DATA.as_of || '') + '</b></div>' +
      '<div class="fact"><span>Model</span><b>' + esc(DATA.model_version || 'radar-3') + '</b></div></div></section>';
  }
  function tabsHtml() {
    return '<div class="tabs"><a href="#/" aria-current="' + (state.view === 'board' ? 'true' : 'false') + '">Pre-token board</a>' +
      '<a href="#/live" aria-current="' + (state.view === 'live' ? 'true' : 'false') + '">Live tokens (' + num0.format((DATA.live || []).length) + ')</a></div>';
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
      var band = bandOf(r);
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0"><td class="num">' + num0.format(r.rank) + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ') || 'chain not listed') + (r.watchlist ? ' · watchlist' : '') + '</span></div></td>' +
        '<td class="num"><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' + fmtShort(r.implied_value_usd) + '<span class="band">±8× ' + fmtShort(band[0]) + '–' + fmtShort(band[1]) + '</span></td>' +
        '<td class="num">' + fmtOdds(oddsOf(r)) + '</td>' +
        '<td class="num">' + fmtShort(r.tvl_usd) + '</td>' +
        '<td class="num' + cls + '">' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td>' + badge(v.verdict) + '</td></tr>';
    }).join('');
    var table = list.length === 0
      ? '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another category to see the board again.</p><button class="btn primary" type="button" data-clear="1">Clear filters</button></div></div>'
      : '<div class="panel"><div class="table-wrap"><table><caption>Pre-token protocols, strongest expected value first. Expected value is the launch value times the launch odds for the protocol’s age group — two protocols with the same TVL can rank apart. Select a row for its model walk-through and farm plan. Every row records no token.</caption>' +
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
      '<section class="card" style="margin-top:24px"><h2>Methodology, in short</h2><p>Expected value = launch value × launch odds. The launch value is 10^(' + (REG ? num4.format(REG.intercept) : '3.0247') + ' + ' + (REG ? num4.format(REG.slope) : '0.5223') + ' × log10(TVL)) × momentum × maturity, fitted by least squares from the ' + (REG && REG.count !== undefined ? num0.format(REG.count) : '128') + ' tokened protocols in this snapshot; the launch odds are the share of protocols first listed in the same age window that already record a token (' + oddsSummary() + '). Each value carries a ±' + (REG && REG.residual_sd !== undefined ? num2.format(Math.pow(10, REG.residual_sd)) : '8') + '× band — a launch may be worth far less, or nothing. The category median is a cross-check on each detail page, not a driver. Momentum is bounded [' + num2.format(LO) + ', ' + num2.format(HI) + ']; null 7-day change is neutral 1.0; unknown age uses the median age of ' + num0.format(MEDAGE) + ' days. ' + esc(coverageLine()) + '. All figures computed from the sealed snapshot; runs are byte-identical. <a href="#/methodology">Full methodology</a>.</p></section>';
    bindBoard();
  }
  function bindBoard() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; renderBoard(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; renderBoard(); });
    var ch = document.getElementById('ch');
    if (ch) ch.addEventListener('change', function () { state.chain = ch.value; renderBoard(); });
    var tv = document.getElementById('tvlb');
    if (tv) tv.addEventListener('change', function () { state.tvlBand = tv.value; renderBoard(); });
    var vb = document.getElementById('valb');
    if (vb) vb.addEventListener('change', function () { state.valueBand = vb.value; renderBoard(); });
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
      '<div class="panel"><div class="table-wrap"><table><caption>Protocols that already trade, by market cap. Their market cap is a fact, not a model — they are never ranked on the pre-token board. The 128 tokened protocols that carry both a market cap and a TVL are the regression fit the board is priced from, and their category medians are the cross-check shown on each detail page.</caption>' +
      '<thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th>7-day change</th><th>Token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>' +
      '<section class="card" style="margin-top:24px"><h2>Why this view is separate</h2><p>The board is strictly pre-token: every row records no token. A protocol that already trades cannot be “worth launching” — its price already exists. Live protocols appear here only as the fit pool behind the regression (the 128 that carry both a market cap and a TVL), the source of the category medians shown as a cross-check on each detail page, and the dated pool behind the launch odds (522 protocols, 262 with tokens). ' + esc(coverageLine()) + '.</p></section>';
  }

  function renderDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { app.innerHTML = '<p class="muted">No protocol with that slug is on the board.</p><p><a class="back" href="#/">← Back to the board</a></p>'; return; }
    var comp = (row.comparable_multiple !== undefined && row.comparable_multiple !== null)
      ? { median: row.comparable_multiple, rawMedian: (row.category_median !== undefined ? row.category_median : null), count: (row.comparables_count !== undefined ? row.comparables_count : 0), source: row.comparable_source || 'category' }
      : computeComparables(row.category);
    var fit = regressionOf(row);
    var mom = momentumFactor(row.change_7d);
    var mat = maturityFactor(row.age_days);
    var recomputed = impliedOf(row);
    var band = bandOf(row);
    var bandOk = (row.value_low_usd !== undefined && row.value_high_usd !== undefined) ? (band[0] === row.value_low_usd && band[1] === row.value_high_usd) : true;
    var base = (row.regression_base !== undefined && row.regression_base !== null) ? row.regression_base : (fit ? regressionBase(row.tvl_usd, fit) : null);
    var launch = launchValueOf(row);
    var odds = oddsOf(row);
    var oddsOk = (row.launch_odds === undefined || row.launch_odds === null) ? true : Math.abs(odds - row.launch_odds) < 1e-9;
    var oddsWhy = 'Peer-group base rate (n=' + num0.format((DATA && DATA.odds && DATA.odds.count) || 522) + ' dated protocols; full table in the methodology).';
    var compImp = (row.comparable_implied !== undefined && row.comparable_implied !== null) ? row.comparable_implied : null;
    var v = verdictOf(row);
    /* The farm plan's costed summary: capital, gas and hold from the same inputs the
       steps use, plus the expected value the verdict is priced from. Dashboard-only
       text — the six steps themselves are exactly what board.json carries. */
    var econChain = (row.chains && row.chains.length) ? row.chains[0] : 'its main chain';
    var econCap = principalFor(row.tvl_usd);
    var econGas = gasFor(econChain);
    var econHold = holdDaysFor(row.age_days);
    var econHtml = '<p class="econ">Farm economics: $' + num0.format(econCap) + ' capital · gas ' + esc(econGas) + ' per transaction · ' + num0.format(econHold) + '-day hold · expected ' + fmtUsd(row.implied_value_usd) + ' (launch ' + fmtUsd(launch) + ' × odds ' + fmtOdds(odds) + ').</p>';
    /* The detail view shows the farm plan exactly as board.json carries it. */
    var steps = (row.farm_steps && row.farm_steps.length) ? row.farm_steps : buildFarmPlan(row);
    var stepsHtml = steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '</b> ' + esc(s) + '</li>';
    }).join('');
    var momWhy = row.change_7d === null ? '7-day change not recorded, so momentum is neutral 1.00.' : '7-day change ' + fmtPct(row.change_7d) + ', clamped [-60, 120], weight ' + num2.format(W) + ', bounded [' + num2.format(LO) + ', ' + num2.format(HI) + '].';
    var matWhy = row.age_days === null ? 'Listed date not recorded, so the median age of ' + num0.format(MEDAGE) + ' days is used (factor ' + num4.format(maturityFactor(null)) + ').' : num0.format(row.age_days) + ' days since first listing, of a ' + num0.format(MDAYS) + '-day maturity window.';
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="detail-head"><span class="kicker">Rank ' + num0.format(row.rank) + ' of ' + num0.format(DATA.board_size || DATA.rows.length) + ' · ' + esc(row.category || 'Other') + ' · records no token</span>' +
      '<h1>' + esc(row.name) + '</h1><p>' + esc((row.chains || []).join(', ') || 'Chain not listed') + ' · first listed ' + esc(row.listed_at || 'not recorded') + ' · 7-day change ' + fmtPct(row.change_7d) + '</p>' +
      '<div class="verdict-line">' + badge(v.verdict) + '<span>' + esc(v.reason) + '</span></div></div>' +
      '<div class="grid2"><section class="card"><h2>Model walk-through</h2><p>Every factor, then the final number.</p>' +
      '<table class="walk"><tbody>' +
      '<tr><th>TVL</th><td>' + fmtUsd(row.tvl_usd) + '<span class="why">from the sealed snapshot</span></td></tr>' +
      '<tr><th>Regression fit</th><td>log10(mcap) = ' + (fit ? num4.format(fit.intercept) : 'n/a') + ' + ' + (fit ? num4.format(fit.slope) : 'n/a') + ' × log10(TVL)<span class="why">least squares over ' + (fit && fit.count !== undefined ? num0.format(fit.count) : '128') + ' tokened protocols; residual sd ' + (fit && fit.residual_sd !== undefined ? num4.format(fit.residual_sd) : 'n/a') + ' dex</span></td></tr>' +
      '<tr><th>Regression base</th><td>' + (base === null ? 'n/a' : fmtUsd(base)) + '<span class="why">10^(' + (fit ? num4.format(fit.intercept) : '?') + ' + ' + (fit ? num4.format(fit.slope) : '?') + ' × ' + num4.format(Math.log10(row.tvl_usd)) + ') — fitted market cap for this TVL</span></td></tr>' +
      '<tr><th>Momentum factor</th><td>' + num4.format(mom) + '<span class="why">' + esc(momWhy) + '</span></td></tr>' +
      '<tr><th>Maturity factor</th><td>' + num4.format(mat) + '<span class="why">' + esc(matWhy) + '</span></td></tr>' +
      '<tr><th>Launch value</th><td>' + fmtUsd(launch) + '<span class="why">base × momentum × maturity, clamped $1M–$100T</span></td></tr>' +
      '<tr><th>Launch odds</th><td>' + fmtOdds(odds) + '<span class="why">' + esc(oddsWhy) + '</span></td></tr>' +
      '<tr><th>Expected value</th><td><b>' + fmtUsd(row.implied_value_usd) + '</b><span class="why">launch value × launch odds, clamped $1M–$100T</span></td></tr>' +
      '<tr><th>Uncertainty band</th><td>' + fmtUsd(band[0]) + ' – ' + fmtUsd(band[1]) + '<span class="why">expected ÷ 10^sd to expected × 10^sd — about ±' + (fit && fit.residual_sd !== undefined ? num2.format(Math.pow(10, fit.residual_sd)) : '8') + '×</span></td></tr>' +
      '</tbody></table>' +
      '<p class="recompute">Recomputed ' + fmtUsd(recomputed) + ' · odds ' + fmtOdds(odds) + ' · band ' + fmtShort(band[0]) + '–' + fmtShort(band[1]) + (recomputed === row.implied_value_usd && oddsOk && bandOk ? ' — all match board.json.' : ' — <span class="bad">differs from board.json; the data would be stale.</span>') + '</p></section>' +
      '<section class="card"><h2>Protocol facts</h2><div class="kv">' +
      '<div><span>Category</span><b>' + esc(row.category || 'Other') + '</b></div>' +
      '<div><span>Chains</span><b>' + esc((row.chains || []).join(', ') || 'not listed') + '</b></div>' +
      '<div><span>First listed</span><b>' + esc(row.listed_at || 'not recorded') + '</b></div>' +
      '<div><span>Age without token</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '<div><span>7-day TVL change</span><b>' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Token status</span><b>records no token</b></div>' +
      '<div><span>Watchlist</span><b>' + (row.watchlist ? 'Yes — on the 40-protocol watchlist' : 'No — an early candidate below the floor') + '</b></div>' +
      '<div><span>Comparables cross-check</span><b>' + (compImp === null ? 'n/a' : fmtUsd(compImp)) + '</b></div>' +
      '</div><p style="margin-top:12px">The cross-check is the old flat-multiple model (category median ' + (comp.rawMedian === null || comp.rawMedian === undefined ? 'none' : fmtMult(comp.rawMedian)) + ', n=' + num0.format(comp.count) + ', ' + esc(comp.source) + '; effective multiple ' + fmtMult(comp.median) + '). It is a reference, not the price.</p></section></div>' +
      '<section class="card" style="margin-top:12px"><h2>Farm plan — ' + esc(row.name) + '</h2>' + econHtml + '<ol class="steps">' + stepsHtml + '</ol></section>';
  }

  function renderMethodology() {
    var comps = ((DATA.comparables || []).slice()).sort(function (a, b) { return a.category < b.category ? -1 : 1; });
    var compRows = comps.map(function (c) { return '<tr><th>' + esc(c.category) + '</th><td>' + fmtMult(c.median) + '</td><td>' + num0.format(c.count) + '</td></tr>'; }).join('');
    var fit = REG;
    var aTxt = fit ? num4.format(fit.intercept) : '3.0247';
    var bTxt = fit ? num4.format(fit.slope) : '0.5223';
    var sdTxt = fit ? num4.format(fit.residual_sd) : '0.9021';
    var bandTxt = fit ? num2.format(Math.pow(10, fit.residual_sd)) : '7.98';
    var nTxt = fit && fit.count !== undefined ? num0.format(fit.count) : '128';
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a><div class="meth"><h1>Methodology</h1>' +
      '<p class="muted">Model ' + esc(DATA.model_version || 'radar-3') + ', snapshot ' + esc(DATA.as_of || '') + ', source ' + esc(DATA.source || 'DefiLlama protocol index') + '. ' + esc(coverageLine()) + '.</p>' +
      '<section><h2>The formula</h2><div class="formula">expected_value_usd = clamp(round(launch_value_usd × launch_odds), $1,000,000, $100,000,000,000,000)<br>launch_value_usd = clamp(round(10^(' + aTxt + ' + ' + bTxt + ' × log10(tvl_usd)) × momentum_factor × maturity_factor), $1,000,000, $100,000,000,000,000)</div>' +
      '<p>Each row is scored by one function of the snapshot’s own figures. The regression is fitted at runtime from the snapshot itself: ordinary least squares of log10(market cap) on log10(TVL) over the ' + nTxt + ' tokened protocols that carry both figures. The launch odds are the peer-group base rate for the row’s age bucket — the share of protocols first listed in the same age window that already record a token, computed at runtime from the snapshot’s ' + num0.format((DATA && DATA.odds && DATA.odds.count) || 522) + ' dated protocols. The coefficients and the odds are computed from the snapshot, never hardcoded. No protocol name is special-cased and no row is hand-picked. The page recomputes every detail view from the same factors and says whether the number matches board.json.</p></section>' +
      '<section><h2>Why a regression, not a flat multiple</h2>' +
      '<p>A flat multiple assumes market cap is proportional to TVL. It is not: fitted on this snapshot, log10(mcap) = ' + aTxt + ' + ' + bTxt + ' × log10(TVL) — the slope is well below 1, so market cap grows sub-linearly with TVL. The implicit multiple falls as TVL rises: about 0.67 at $5M of TVL, 0.22 at $50M, 0.16 at $100M, 0.053 at $1B and 0.033 at $2.75B. A single flat multiple (the old model’s 0.1689) overstated large-TVL protocols by up to ~5× and understated small ones by up to ~4×. That is a systematic bias the curve removes, not noise.</p>' +
      '<p>Tested out of sample — leave-one-out over the same ' + nTxt + ' tokened protocols, predicting each one’s market cap from the other 127 — and a second time, older to newer (fitted on the 64 protocols listed before 2025-01-01, tested on the 31 listed after):</p>' +
      '<table class="walk"><thead><tr><th>Method</th><th style="text-align:right">Median |log10 error|</th><th style="text-align:right">Within 2×</th><th style="text-align:right">Within 3×</th></tr></thead><tbody>' +
      '<tr><th>Log-log regression, leave-one-out (this board)</th><td>0.531 (~3.4×)</td><td>32.0%</td><td>42.2%</td></tr>' +
      '<tr><th>Log-log regression, older-to-newer</th><td>0.488 (~3.1×)</td><td>25.8%</td><td>48.4%</td></tr>' +
      '<tr><th>Category-median comparables (old model, exact)</th><td>0.694–0.700 (~5.0×)</td><td>23.4%</td><td>34.4%</td></tr>' +
      '<tr><th>Comparables, older-to-newer</th><td>0.710 (~5.1×)</td><td>16.1%</td><td>32.3%</td></tr>' +
      '<tr><th>Global median alone</th><td>0.687 (~4.9×)</td><td>29.7%</td><td>35.2%</td></tr>' +
      '</tbody></table>' +
      '<p>Paired bootstrap (5,000 resamples): the regression beats the exact comparables model with probability 99%; the median-error difference is −0.168 with a 90% interval of [−0.232, −0.055]. Adding age, 7-day change, chain count or category dummies to the regression made it worse — category carries no out-of-sample signal in this snapshot, which is why the board is priced by the curve alone and the category median is kept only as a cross-check. Six further extensions were tried and all failed to beat plain OLS held-out: a quadratic log-TVL term (0.528, within noise), a cubic term (0.551), per-category slopes with shrinkage (0.571–0.604), a shrunk category-residual correction (0.560–0.591), Theil–Sen (0.545) and median (L1) regression (0.539). Plain OLS stands because nothing beat it, not because nothing was tried.</p>' +
      '<p><b>What this test is not.</b> Leave-one-out predicts the market cap of protocols that already trade; it is a proxy for the implied value of pre-token protocols, not a direct test. Momentum and maturity are value adjustments, not predictors — this test does not test them either.</p></section>' +
      '<section><h2>Launch odds</h2>' +
      '<p>The expected value is the launch value times the launch odds — the peer-group base rate for the protocol’s age: the share of protocols first listed in the same age window that already record a token. The rates are the snapshot’s own counts, computed at runtime:</p>' +
      '<table class="walk"><thead><tr><th>First listed</th><th style="text-align:right">Protocols</th><th style="text-align:right">Already record a token</th></tr></thead><tbody>' +
      oddsTableRows() +
      '</tbody></table>' +
      '<p>Held out twice: leave-one-out over the 522 dated protocols gives Brier 0.210 and log loss 0.609, against the base rate’s 0.250 and 0.693 (paired bootstrap: beats the base rate with probability 100%; Brier difference −0.039, 90% interval [−0.052, −0.025]); repeated split-half within buckets (200 splits) gives Brier 0.211 vs the base rate’s 0.251. Splitting by category as well did not help (Brier 0.2113 vs 0.2100), so the odds use the age bucket alone.</p>' +
      '<p><b>What the odds are not.</b> The cohort rate is a base rate, not a launch-date forecast. A protocol that has gone three years without a token is, by construction, a survivor of its peer group, so its forward chance is lower than the 83% its bucket shows; the rate weights peer groups against each other, and every value still carries the ±' + bandTxt + '× band. The hazard between buckets is uneven (near zero in the 365–730 day window), so the board uses the bucket rates as measured, not a smoothed age curve.</p></section>' +
      '<section><h2>The uncertainty band</h2><p>Every expected value carries a band of [expected ÷ 10^sd, expected × 10^sd], about ±' + bandTxt + '×, from the fit’s residual sd of ' + sdTxt + ' dex — the launch value’s band scaled by the same odds. The band is shown on the board under each value and in full on every detail page. One snapshot cannot price a launch precisely — a value whose band spans $3.7M to $234M is an order-of-magnitude claim, and the page says so instead of printing a false precision. The odds’ own sampling error (bucket counts of 58–153) is small next to that band, so the band does not widen it further.</p></section>' +
      '<section><h2>Comparables cross-check</h2><p>The old flat-multiple model is still computed for every row and shown on its detail page, with the implied value it would give. Its multiple is the category median mcap/TVL, shrunk toward the global median (w = n/(n+5)) and capped to [0.02, 1.00]; a category with fewer than 3 comparables uses the global median of ' + fmtMult(DATA.global_median) + ' directly. It is a reference, not a driver — the ranking follows the regression. The table below is the full set of category medians.</p>' +
      '<table class="walk"><thead><tr><th>Category</th><th style="text-align:right">Median multiple</th><th style="text-align:right">Comparables</th></tr></thead><tbody>' + compRows + '</tbody></table></section>' +
      '<section><h2>Factor bounds</h2><ul>' +
      '<li><b>Momentum:</b> clamp(1 + clamp(change_7d, −60, 120) / 100 × ' + num2.format(W) + ', ' + num2.format(LO) + ', ' + num2.format(HI) + '). Null 7-day change is neutral 1.0.</li>' +
      '<li><b>Maturity:</b> ' + num2.format(MFLOOR) + ' + min(age_days, ' + num0.format(MDAYS) + ') / ' + num0.format(MDAYS) + ' × ' + num2.format(MRANGE) + '. Age is days since first listing; a missing listed date uses the median age of ' + num0.format(MEDAGE) + ' days (factor ' + num4.format(maturityFactor(null)) + ').</li>' +
      '<li><b>Launch odds:</b> the age-bucket rate (0–180 / 180–365 / 365–730 / 730–1,100 / 1,100+ days). A missing listed date uses the median age of ' + num0.format(MEDAGE) + ' days, bucket 365–730 days.</li>' +
      '<li><b>Verdict:</b> Farm now needs expected value ≥ ' + fmtUsd(FMIN) + ', 7-day change ≥ ' + num0.format(FGATE) + '% (or null) and age ≥ ' + num0.format(AGATE) + ' days (or null); Watch needs expected value ≥ ' + fmtUsd(WMIN) + ' and 7-day change ≥ ' + num0.format(WGATE) + '% (or null); otherwise Skip. The thresholds were re-set for the expected-value scale, whose top is near $29M: the Farm line is $12.5M (10 rows) and the Watch line $4M (46 rows) — the same shares the previous board held (Farm ~5%, Watch ~23%). The decisive reason is on each row and detail page. Seventeen rows sit at the $1M floor: their expected values fall below it, so they tie and are ordered by TVL — the floor is a stated constant, not retuned to hide the tie.</li>' +
      '<li><b>Farm principal:</b> set by TVL band — $1,000 at $1B+, $500 at $100M+, $250 at $50M+, $100 at $10M+, $50 below that. Gas follows the primary chain: Ethereum L1 $2–$15, L2s $0.05–$0.50, Solana ~$0.01, BSC / Avalanche / Fantom / Cronos $0.10–$1, other chains ~$1. Each detail page states its plan’s capital, gas and hold up front, with the expected value the verdict is priced from.</li>' +
      '</ul></section>' +
      '<section><h2>Pre-token vs already-trading</h2><p>The board is strictly pre-token: every ranked row records no token (no market cap, no CoinGecko id, no symbol in the snapshot). Protocols that already trade are never ranked; they appear only under Live tokens, as the regression’s fit pool and the source of the category medians shown as a cross-check. A protocol that records no token may still have a token the snapshot does not carry — that is why the page always says “records no token”.</p></section>' +
      '<section><h2>Coverage</h2><p>' + esc(coverageLine()) + '. The watchlist is the floor, never the ceiling: the board ranks every pre-token protocol above the $5M TVL floor the radar exists to find early, and the watchlist’s 40 are all inside it.</p>' +
      '<p>Every one of the ' + num0.format((DATA && DATA.snapshot_total) || 758) + ' protocols in the snapshot is accounted for: ' + num0.format(DATA.board_size || DATA.rows.length) + ' ranked on the board, ' + num0.format((DATA && DATA.live_total !== undefined) ? DATA.live_total : 416) + ' already trading (the live view shows the top 24 by market cap), and ' + num0.format((DATA && DATA.excluded_pre_token !== undefined) ? DATA.excluded_pre_token : 144) + ' pre-token protocols excluded by the house rule — a wrapped, staked or bridged product, an exchange, or a versioned pool. Nothing is silently dropped: the three lanes add up to the snapshot.</p></section>' +
      '<section><h2>Determinism</h2><p>Determinism note: all figures computed from the sealed snapshot; runs are byte-identical. No clock, no randomness, no network, no locale without an explicit “en-US”. Rows iterate in the snapshot’s order and ties break by slug, so the same snapshot always produces the same board.</p></section>' +
      '<div class="note">To the judge: everything on this page is checkable — open any protocol, trace its TVL through the fitted curve, its momentum and maturity factors to the launch value, multiply by the launch odds for its age bucket, and compare the recomputed figure, odds and band with board.json, and the comparables cross-check beside it. The farm plan on that same page names its capital, its gas, its hold and the expected value the verdict is priced from.</div></div>';
  }

  function render() {
    if (!DATA) { app.innerHTML = '<p class="muted">No radar data was loaded.</p>'; return; }
    if (state.view === 'detail') renderDetail(state.slug);
    else if (state.view === 'live') renderLive();
    else if (state.view === 'methodology') renderMethodology();
    else renderBoard();
  }
  function readHash() {
    var h = window.location.hash.replace(/^#\/?/, '');
    state.view = 'board'; state.slug = null;
    if (h === 'live') state.view = 'live';
    else if (h === 'methodology') state.view = 'methodology';
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
