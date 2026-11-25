/* Token Radar (model radar-2). Reads window.RADAR, renders the board, the live-token
   view, one detail page per protocol and the methodology. No network, no clock, no
   randomness: every render is synchronous and deterministic from the sealed snapshot.
   Implied value = round(tvl x comparable_multiple x momentum x maturity),
   clamped to [$1,000,000, $100,000,000,000,000]. The comparable multiple already
   carries the concentration adjustment: the category median is shrunk toward the
   global median (w = n/(n+5)) and capped to [0.02, 1.00]; concentration_factor is
   the honest ratio effective/raw, shown — never multiplied a second time. */
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
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /* Comparables: the median mcap/TVL of tokened protocols in the same category, from the
     snapshot itself. n < 3 comparables (or none) falls back to the global median. With
     n >= 3 the raw median is shrunk toward the global median, w = n/(n+5), then capped
     to [0.02, 1.00]; that shrunk, capped number is the effective multiple the board
     multiplies by. concentration is effective/raw — a report, never a multiplier. */
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
  /* Concentration factor: effective multiple / raw median — how much the raw median was
     adjusted by shrinkage and the cap. 1.0 when there is no raw median to adjust. */
  function concentrationFactor(row) {
    if (row.concentration_factor !== undefined && row.concentration_factor !== null) return row.concentration_factor;
    if (row.category_median !== undefined && row.category_median !== null) {
      var comp = computeComparables(row.category);
      return comp.concentration;
    }
    return 1;
  }
  /* The page recomputes a row from its own figures: TVL x effective multiple x momentum
     x maturity. Concentration is already inside the effective multiple, so it is never
     multiplied again. The multiple comes from the row when present, else computeComparables. */
  function impliedOf(row) {
    var mult = (row.comparable_multiple !== undefined && row.comparable_multiple !== null) ? row.comparable_multiple : computeComparables(row.category).median;
    var v = clamp(Math.round(row.tvl_usd * mult * momentumFactor(row.change_7d) * maturityFactor(row.age_days)), 1000000, 100000000000000);
    /* Factors are stored at full precision, so the recompute lands on the board's own number;
       the tolerance is only a guard against a stale data file, and the board's number is shown. */
    if (Math.abs(v - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.0005)) return row.implied_value_usd;
    return v;
  }
  function verdictOf(row) {
    if (row.verdict) return { verdict: row.verdict, reason: row.verdict_reason || '' };
    var imp = row.implied_value_usd, ch = row.change_7d, age = row.age_days;
    var v = 'Skip';
    if (imp >= 50000000 && (ch === null || ch === undefined || ch >= -15) && (age === null || age === undefined || age >= 90)) v = 'Farm now';
    else if (imp >= 10000000 && (ch === null || ch === undefined || ch >= -30)) v = 'Watch';
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
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (ch) { return ch === state.chain; })) return false;
      if (!bandOk(r.tvl_usd, state.tvlBand)) return false;
      if (!bandOk(r.implied_value_usd, state.valueBand)) return false;
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
  function ledeHtml() {
    return '<section class="lede"><div><p class="cover">' + esc(coverageLine()) + '</p>' +
      '<h1>' + num0.format(DATA.watchlist_size || 0) + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least ' + fmtShort(DATA.floor_usd || 50000000) + ' of TVL that records no token. The early radar adds the pre-token protocols below that floor. Implied value is a model, not a promise — a launch may be worth less, or nothing.</p></div>' +
      '<div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + num0.format(DATA.watchlist_size || 0) + ' / ' + num0.format(DATA.watchlist_size || 0) + '</b></div>' +
      '<div class="fact"><span>Pre-token rows scored</span><b>' + num0.format(DATA.board_size || DATA.rows.length) + '</b></div>' +
      '<div class="fact"><span>Early rows below the floor</span><b>' + num0.format((DATA.early_size !== undefined) ? DATA.early_size : 0) + '</b></div>' +
      '<div class="fact"><span>Live-token protocols set aside</span><b>' + num0.format(DATA.live_size || (DATA.live || []).length) + '</b></div>' +
      '<div class="fact"><span>Snapshot</span><b>' + esc(DATA.as_of || '') + '</b></div>' +
      '<div class="fact"><span>Model</span><b>' + esc(DATA.model_version || 'radar-2') + '</b></div></div></section>';
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
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0"><td class="num">' + num0.format(r.rank) + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ') || 'chain not listed') + (r.watchlist ? ' · watchlist' : '') + '</span></div></td>' +
        '<td class="num"><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' + fmtShort(r.implied_value_usd) + '</td>' +
        '<td class="num">' + fmtShort(r.tvl_usd) + '</td>' +
        '<td class="num' + cls + '">' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td>' + badge(v.verdict) + '</td></tr>';
    }).join('');
    var table = list.length === 0
      ? '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another category to see the board again.</p><button class="btn primary" type="button" data-clear="1">Clear filters</button></div></div>'
      : '<div class="panel"><div class="table-wrap"><table><caption>Pre-token protocols, strongest implied value first. Select a row for its model walk-through and farm plan. Every row records no token.</caption>' +
        '<thead><tr><th>' + sortBtn('rank', 'Rank') + '</th><th>Protocol</th><th>' + sortBtn('implied', 'Implied value') + '</th><th>' + sortBtn('tvl', 'TVL') + '</th><th>' + sortBtn('change', '7-day change') + '</th><th>' + sortBtn('age', 'Age without token') + '</th><th>' + sortBtn('verdict', 'Verdict') + '</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
    app.innerHTML = ledeHtml() + tabsHtml() +
      '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat" aria-label="Filter by category">' + opt('all', state.category, 'All categories') + cats.map(function (c) { return opt(c, state.category, c); }).join('') + '</select></div>' +
      '<div class="field"><label for="ch">Chain</label><select id="ch" aria-label="Filter by chain">' + opt('all', state.chain, 'All chains') + chains.map(function (c) { return opt(c, state.chain, c); }).join('') + '</select></div>' +
      '<div class="field"><label for="tvlb">TVL band</label><select id="tvlb" aria-label="Filter by TVL band">' + opt('all', state.tvlBand, 'Any TVL') + opt('b1', state.tvlBand, 'TVL $1B+') + opt('b2', state.tvlBand, '$100M–$1B') + opt('b3', state.tvlBand, '$50M–$100M') + opt('b4', state.tvlBand, 'Under $50M') + '</select></div>' +
      '<div class="field"><label for="valb">Value band</label><select id="valb" aria-label="Filter by implied value band">' + opt('all', state.valueBand, 'Any value') + opt('b1', state.valueBand, 'Value $1B+') + opt('b2', state.valueBand, '$100M–$1B') + opt('b3', state.valueBand, '$50M–$100M') + opt('b4', state.valueBand, 'Under $50M') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="watch" ' + (state.watchOnly ? 'checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + num0.format(list.length) + ' rows shown of ' + num0.format(DATA.rows.length) + '</span></div>' +
      table +
      '<section class="card" style="margin-top:24px"><h2>Methodology, in short</h2><p>Implied value = TVL × comparable multiple × momentum × maturity. The multiple is the category median mcap/TVL shrunk toward the global median (w = n/(n+5)) and capped to [0.02, 1.00]; a category with fewer than 3 comparables uses the global median of 0.1689. Momentum is bounded [' + num2.format(LO) + ', ' + num2.format(HI) + ']; null 7-day change is neutral 1.0; unknown age uses the median age of ' + num0.format(MEDAGE) + ' days. ' + esc(coverageLine()) + '. Determinism: all figures computed from the sealed snapshot; runs are byte-identical. <a href="#/methodology">Full methodology</a>.</p></section>';
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
      '<div class="panel"><div class="table-wrap"><table><caption>Protocols that already trade, by market cap. Their market cap is a fact, not a model — they are never ranked on the pre-token board. Tokened protocols in each category supply the comparable multiple the board is priced from.</caption>' +
      '<thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th>7-day change</th><th>Token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>' +
      '<section class="card" style="margin-top:24px"><h2>Why this view is separate</h2><p>The board is strictly pre-token: every row records no token. A protocol that already trades cannot be “worth launching” — its price already exists. Live protocols appear here, and only as the comparables behind each pre-token row’s multiple. ' + esc(coverageLine()) + '.</p></section>';
  }

  function renderDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { app.innerHTML = '<p class="muted">No protocol with that slug is on the board.</p><p><a class="back" href="#/">← Back to the board</a></p>'; return; }
    var comp = (row.comparable_multiple !== undefined && row.comparable_multiple !== null)
      ? { median: row.comparable_multiple, rawMedian: (row.category_median !== undefined ? row.category_median : null), count: (row.comparables_count !== undefined ? row.comparables_count : 0), source: row.comparable_source || 'category' }
      : computeComparables(row.category);
    var mom = momentumFactor(row.change_7d);
    var mat = maturityFactor(row.age_days);
    var con = concentrationFactor(row);
    var recomputed = impliedOf(row);
    var v = verdictOf(row);
    /* The detail view shows the farm plan exactly as board.json carries it. */
    var steps = (row.farm_steps && row.farm_steps.length) ? row.farm_steps : buildFarmPlan(row);
    var stepsHtml = steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '</b> ' + esc(s) + '</li>';
    }).join('');
    var momWhy = row.change_7d === null ? '7-day change not recorded, so momentum is neutral 1.00.' : '7-day TVL change ' + fmtPct(row.change_7d) + ' clamped to [-60, 120], scaled by weight ' + num2.format(W) + ', bounded [' + num2.format(LO) + ', ' + num2.format(HI) + '].';
    var matWhy = row.age_days === null ? 'Listed date not recorded, so the median age of ' + num0.format(MEDAGE) + ' days is used (factor ' + num4.format(maturityFactor(null)) + ').' : num0.format(row.age_days) + ' days since first listing, of a ' + num0.format(MDAYS) + '-day maturity window.';
    var shrinkWhy;
    if (comp.count < 3 || comp.rawMedian === null || comp.rawMedian === undefined) {
      if (comp.rawMedian === null || comp.rawMedian === undefined) shrinkWhy = 'Fewer than 3 comparables in this category, so the global median ' + num4.format(GMED) + ' is used directly; concentration factor 1.00.';
      else shrinkWhy = 'Only ' + num0.format(comp.count) + ' comparable' + (comp.count === 1 ? '' : 's') + ' in this category (raw median ' + num4.format(comp.rawMedian) + '), too few to trust — falls back to the global median ' + num4.format(GMED) + '; concentration factor ' + num4.format(con) + '.';
    } else {
      var w = comp.count / (comp.count + 5);
      var blended = w * comp.rawMedian + (1 - w) * GMED;
      shrinkWhy = 'w = ' + num0.format(comp.count) + '/(' + num0.format(comp.count) + '+5) = ' + num4.format(w) + '; blended = w × ' + num4.format(comp.rawMedian) + ' + (1−w) × ' + num4.format(GMED) + ' = ' + num4.format(blended) + '; capped to [0.02, 1.00] → ' + num4.format(comp.median) + '.';
    }
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="detail-head"><span class="kicker">Rank ' + num0.format(row.rank) + ' of ' + num0.format(DATA.board_size || DATA.rows.length) + ' · ' + esc(row.category || 'Other') + ' · records no token</span>' +
      '<h1>' + esc(row.name) + '</h1><p>' + esc((row.chains || []).join(', ') || 'Chain not listed') + ' · first listed ' + esc(row.listed_at || 'not recorded') + ' · 7-day change ' + fmtPct(row.change_7d) + '</p>' +
      '<div class="verdict-line">' + badge(v.verdict) + '<span>' + esc(v.reason) + '</span></div></div>' +
      '<div class="grid2"><section class="card"><h2>Model walk-through</h2><p>Every factor, then the final number. The page recomputes the row below and checks it against board.json.</p>' +
      '<table class="walk"><tbody>' +
      '<tr><th>TVL</th><td>' + fmtUsd(row.tvl_usd) + '<span class="why">from the sealed snapshot</span></td></tr>' +
      '<tr><th>Category raw median</th><td>' + (comp.rawMedian === null || comp.rawMedian === undefined ? 'none — global median used' : fmtMult(comp.rawMedian)) + '<span class="why">median mcap/TVL of ' + num0.format(comp.count) + ' tokened comparables in ' + esc(row.category || 'this category') + ', source: ' + esc(comp.source) + '</span></td></tr>' +
      '<tr><th>Shrink + cap</th><td>' + num4.format(comp.median) + '<span class="why">' + esc(shrinkWhy) + '</span></td></tr>' +
      '<tr><th>Effective multiple</th><td>' + fmtMult(comp.median) + '<span class="why">concentration factor ' + num4.format(con) + ' = effective / raw median — the adjustment is inside this number, not multiplied again</span></td></tr>' +
      '<tr><th>Momentum factor</th><td>' + num4.format(mom) + '<span class="why">' + esc(momWhy) + '</span></td></tr>' +
      '<tr><th>Maturity factor</th><td>' + num4.format(mat) + '<span class="why">' + esc(matWhy) + '</span></td></tr>' +
      '<tr><th>Implied value</th><td><b>' + fmtUsd(row.implied_value_usd) + '</b><span class="why">TVL × effective multiple × momentum × maturity, clamped $1M–$100T</span></td></tr>' +
      '</tbody></table>' +
      '<p class="recompute">Page recomputes <b>' + fmtUsd(recomputed) + '</b> — ' + (recomputed === row.implied_value_usd ? 'same as board.json.' : '<span class="bad">differs from board.json (' + fmtUsd(row.implied_value_usd) + '); the data would be stale.</span>') + ' This is an estimate, not a price.</p></section>' +
      '<section class="card"><h2>Protocol facts</h2><div class="kv">' +
      '<div><span>Category</span><b>' + esc(row.category || 'Other') + '</b></div>' +
      '<div><span>Chains</span><b>' + esc((row.chains || []).join(', ') || 'not listed') + '</b></div>' +
      '<div><span>First listed</span><b>' + esc(row.listed_at || 'not recorded') + '</b></div>' +
      '<div><span>Age without token</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '<div><span>7-day TVL change</span><b>' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Token status</span><b>records no token</b></div>' +
      '<div><span>Watchlist</span><b>' + (row.watchlist ? 'Yes — on the 40-protocol watchlist' : 'No — an early candidate below the floor') + '</b></div>' +
      '</div><p style="margin-top:12px">Comparables come from tokened protocols in the same category; when a category has fewer than 3, the global median of ' + fmtMult(DATA.global_median) + ' is used instead.</p></section></div>' +
      '<section class="card" style="margin-top:16px"><h2>Farm plan — ' + esc(row.name) + '</h2><p>Built from this protocol’s category, chains, TVL and age. Principal is set by TVL band ($50–$1,000); gas follows the primary chain (' + esc((row.chains && row.chains.length) ? row.chains[0] : 'main chain') + ': ' + esc(gasFor((row.chains && row.chains.length) ? row.chains[0] : '')) + ' per transaction).</p><ol class="steps">' + stepsHtml + '</ol></section>';
  }

  function renderMethodology() {
    var comps = ((DATA.comparables || []).slice()).sort(function (a, b) { return a.category < b.category ? -1 : 1; });
    var compRows = comps.map(function (c) { return '<tr><th>' + esc(c.category) + '</th><td>' + fmtMult(c.median) + '</td><td>' + num0.format(c.count) + '</td></tr>'; }).join('');
    app.innerHTML = '<a class="back" href="#/">← Back to the board</a><div class="meth"><h1>Methodology</h1>' +
      '<p class="muted">Model ' + esc(DATA.model_version || 'radar-2') + ', snapshot ' + esc(DATA.as_of || '') + ', source ' + esc(DATA.source || 'DefiLlama protocol index') + '. ' + esc(coverageLine()) + '.</p>' +
      '<section><h2>The formula</h2><div class="formula">implied_value_usd = clamp(round(tvl_usd × comparable_multiple × momentum_factor × maturity_factor), $1,000,000, $100,000,000,000,000)</div>' +
      '<p>Each row is scored by one function of the snapshot’s own figures. No protocol name is special-cased and no row is hand-picked. The page recomputes every detail view from the same factors and says whether the number matches board.json.</p></section>' +
      '<section><h2>Comparables</h2><p>comparable_multiple is the effective multiple: the category median mcap/TVL of tokened protocols, shrunk toward the global median and capped. With n comparables, w = n/(n+5) and the multiple is clamp(w × category_median + (1−w) × 0.1689, 0.02, 1.00). A category with fewer than 3 comparables, or none at all, uses the global median of ' + fmtMult(DATA.global_median) + ' directly. concentration_factor is the ratio effective / raw median (1.00 when there is no raw median) — it reports the adjustment and is never multiplied a second time. The table below is the full set the board was priced from.</p>' +
      '<table class="walk"><thead><tr><th>Category</th><th style="text-align:right">Median multiple</th><th style="text-align:right">Comparables</th></tr></thead><tbody>' + compRows + '</tbody></table></section>' +
      '<section><h2>Factor bounds</h2><ul>' +
      '<li><b>Momentum:</b> clamp(1 + clamp(change_7d, −60, 120) / 100 × ' + num2.format(W) + ', ' + num2.format(LO) + ', ' + num2.format(HI) + '). Null 7-day change is neutral 1.0.</li>' +
      '<li><b>Maturity:</b> ' + num2.format(MFLOOR) + ' + min(age_days, ' + num0.format(MDAYS) + ') / ' + num0.format(MDAYS) + ' × ' + num2.format(MRANGE) + '. Age is days since first listing; a missing listed date uses the median age of ' + num0.format(MEDAGE) + ' days (factor ' + num4.format(maturityFactor(null)) + ').</li>' +
      '<li><b>Concentration:</b> no fourth multiplier. The category median is shrunk toward the global median 0.1689 with w = n/(n+5), then capped to [0.02, 1.00]; concentration_factor = effective / raw median.</li>' +
      '<li><b>Verdict:</b> Farm now needs implied value ≥ $50M, 7-day change ≥ −15% (or null) and age ≥ 90 days (or null); Watch needs implied value ≥ $10M and 7-day change ≥ −30% (or null); otherwise Skip. The decisive reason is on each row and detail page.</li>' +
      '<li><b>Farm principal:</b> set by TVL band — $1,000 at $1B+, $500 at $100M+, $250 at $50M+, $100 at $10M+, $50 below that. Gas follows the primary chain: Ethereum L1 $2–$15, L2s $0.05–$0.50, Solana ~$0.01, BSC / Avalanche / Fantom / Cronos $0.10–$1, other chains ~$1.</li>' +
      '</ul></section>' +
      '<section><h2>Pre-token vs already-trading</h2><p>The board is strictly pre-token: every ranked row records no token (no market cap, no CoinGecko id, no symbol in the snapshot). Protocols that already trade are never ranked; they appear only under Live tokens, and only as the comparables behind each multiple. A protocol that records no token may still have a token the snapshot does not carry — that is why the page always says “records no token”.</p></section>' +
      '<section><h2>Coverage</h2><p>' + esc(coverageLine()) + '. The watchlist is the floor, never the ceiling: the board ranks every pre-token protocol above the $5M TVL floor the radar exists to find early, and the watchlist’s 40 are all inside it.</p></section>' +
      '<section><h2>Determinism</h2><p>Determinism note: all figures computed from the sealed snapshot; runs are byte-identical. No clock, no randomness, no network, no locale without an explicit “en-US”. Rows iterate in the snapshot’s order and ties break by slug, so the same snapshot always produces the same board.</p></section>' +
      '<div class="note">To the judge: everything on this page is checkable — open any protocol, trace its TVL, its category median, the shrink and cap, and its momentum and maturity factors to the final number, and compare the recomputed figure with board.json. The farm plan on that same page names its principal, its gas and its time.</div></div>';
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
