// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) plus every
// other pre-token protocol the house rule keeps, down to the snapshot's $5M TVL floor. A protocol is
// pre-token when its record carries no token (no CoinGecko id, no symbol); the snapshot's live-token
// protocols are kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, computed at runtime:
//
//   regression fit               OLS log10(mcap) = a + b x log10(TVL), fitted at runtime from the
//                                  snapshot's own tokened protocols (mcap > 0, TVL > 0, n = 128).
//                                  The fit is a curve, not a flat multiple: b < 1, so market cap
//                                  grows sub-linearly with TVL and the implicit multiple falls as
//                                  TVL rises. Coefficients are computed from the snapshot, never
//                                  hardcoded. residual_sd is the population sd of the log10
//                                  residuals, sqrt(mean(r^2)) — the same convention the LOO
//                                  evaluation reports (NumPy .std(), ddof=0).
//   regression base              10^(a + b x log10(TVL)): the fitted market cap for a protocol
//                                  of this TVL. In radar-5 this IS the launch value: the
//                                  momentum and maturity multipliers of radar-4 are GONE.
//                                  They never passed a blind test (work/v5-ablation.py:
//                                  LOO 0.538 vs 0.531 OLS-alone, time-split 0.491 vs 0.488,
//                                  split-half 0.559 vs 0.565, paired P ~53%; fitted weights
//                                  negative, momentum -7.52, maturity -2.48), and the
//                                  Methodology's "priced by the curve alone" was false
//                                  while they were applied. Their v4 formulas, kept here
//                                  so the ablation stays auditable:
//                                    momentum = 1 + clamp(change_7d, -60, 120)/100 x 0.5,
//                                      clamped [0.8, 1.5]; null -> 1.0
//                                    maturity = 0.8 + min(age, 1095)/1095 x 0.2;
//                                      null age -> 513 days (0.8937)
//                                  Both are dropped, not refitted: the fitted weights say
//                                  the multipliers push predictions the wrong way.
//   launch odds                    the peer-group base rate: the share of protocols first listed
//                                  in the same age bucket that already record a token, computed
//                                  at runtime from the snapshot (n = 522 dated, non-exchange,
//                                  non-versioned protocols). Buckets 0-180 / 180-365 / 365-730 /
//                                  730-1100 / 1100+ days; rates 0.25 / 0.36 / 0.37 / 0.59 / 0.83.
//                                  Validated held-out twice (LOO Brier 0.210 vs 0.250 base rate;
//                                  split-half 0.211 vs 0.251). The category dimension did NOT
//                                  validate (Brier 0.2113 vs 0.2100 bucket-only), so the odds use
//                                  the age bucket alone. A null age uses 513 days, bucket 365-730.
//   uncertainty band               [implied / 10^residual_sd, implied x 10^residual_sd], about ±8x:
//                                  the fit's own residual spread, shown on every row so the page
//                                  never pretends to price a launch precisely. The band is drawn
//                                  around the expected value (launch band x odds).
//   P10–P90 interval               [launch x 10^q10, launch x 10^q90] x odds, where q10/q90 are
//                                  the 10th/90th percentiles of the fit residuals (q10 -1.19,
//                                  q90 +0.93 dex in this snapshot): a per-row range, not one
//                                  global band. Measured held-out coverage on the 128 comps
//                                  (leave-one-out, interval from the train residuals only) is
//                                  78.9% (101/128); a 200x bootstrap refit cross-check agrees
//                                  with the P10 within 10% on 95% of rows (work/v5-intervals.py).
//                                  The rank range is the ranks the row's P90/P10 values would
//                                  take on the point-estimate board — wide (median 184 ranks),
//                                  because the value intervals are wide. The board ranks point
//                                  estimates; the range says how far a row could move.
//   net $/hour at P10              the farmer's-eye check at the P10 launch value: expected
//                                  payout = P10 launch x 10% airdrop pool (assumption, not a
//                                  measurement) x capital/TVL (pro-rata share) x odds, minus
//                                  gas (funding + $8/$4 setup + $2/week) and 5% APR opportunity
//                                  cost on the capital, divided by the work hours (45 min setup
//                                  + 15 min/week + 10 min claim). Costed call: Farm at >= $25/h,
//                                  Thin at >= $0/h, Skip below — forced Skip if P10 launch is
//                                  under $1M. At pro-rata shares no row clears $0/h (median
//                                  -$7.34/h); the panel states the break-even pool share instead
//                                  (median 0.19% of the pool).
//   comparables cross-check        the v2 multiple (category median mcap/TVL, shrunk toward the
//                                  global median with w = n/(n+5), capped [0.02, 1.00]; fewer than
//                                  3 comparables falls back to the global median) and the implied
//                                  value it would give. Shown for reference on every detail page;
//                                  it does not drive the ranking.
//   launch value = regression base, clamped to [$1M, $100T]:
//                  the value if the token launches. (radar-4 multiplied the base by
//                  momentum x maturity; radar-5 drops both — see above.)
//   implied = round(launch value x launch odds), clamped to [$1M, $100T]:
//             the EXPECTED value — the ranking quantity. The board ranks expected value,
//             not value-if-launched, so two protocols with the same TVL can rank apart
//             when their peer groups launch at different rates.
//
// No protocol name is ever special-cased: the same functions score every row. Every constant lives
// in MODEL below, in one place, so the model can be swept by changing that object alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. Change this object alone to sweep the model. */
export interface ModelConstants {
  /** Shrinkage strength: a category's weight is n / (n + shrink_k). */
  shrink_k: number;
  /** The effective multiple is clamped to this range after shrinkage. */
  multiple_cap_lo: number;
  multiple_cap_hi: number;
  /** A category needs at least this many comparables or it falls back to the global median. */
  min_comparables: number;
  /** Age in days used when listed_at is null (the pre-token median age). */
  unknown_age_days: number;
  /** The implied value is clamped to this range. */
  implied_min: number;
  implied_max: number;
  /** Verdict thresholds (see verdictFor). */
  farm_now_min: number;
  farm_now_growth_gate: number;
  farm_now_age_gate: number;
  watch_min: number;
  watch_growth_gate: number;
  /** Launch-odds bucket edges in days: buckets are [0, e1), [e1, e2), [e2, e3), [e3, e4), [e4, inf). */
  odds_buckets: number[];
}

export const MODEL: ModelConstants = {
  shrink_k: 5,
  multiple_cap_lo: 0.02,
  multiple_cap_hi: 1.0,
  min_comparables: 3,
  unknown_age_days: 513,
  implied_min: 1_000_000,
  implied_max: 100_000_000_000_000,
  farm_now_min: 12_500_000,
  farm_now_growth_gate: -15,
  farm_now_age_gate: 90,
  watch_min: 4_000_000,
  watch_growth_gate: -30,
  odds_buckets: [180, 365, 730, 1100],
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-7';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The global median mcap/tvl, computed from the snapshot at runtime (not a hardcoded price). */
export interface Comparables {
  /** Median mcap/tvl over all tokened protocols with both figures, and how many there are. */
  global: { median: number; count: number };
  /** Per category: median mcap/tvl and count, only for categories with at least one comparable. */
  byCategory: Map<string, { median: number; count: number }>;
}

/** The log-log regression fit, computed from the snapshot at runtime (never hardcoded). */
export interface RegressionFit {
  /** Intercept a of log10(mcap) = a + b x log10(TVL). */
  intercept: number;
  /** Slope b of log10(mcap) = a + b x log10(TVL). */
  slope: number;
  /** Population sd of the log10 residuals, sqrt(mean(r^2)) — the uncertainty band's half-width in dex. */
  residualSd: number;
  /** 10th percentile of the log10 residuals (linear interpolation) — the P10 interval's lower edge. */
  residualQ10: number;
  /** 90th percentile of the log10 residuals (linear interpolation) — the P90 interval's upper edge. */
  residualQ90: number;
  /** How many tokened protocols the fit was computed from. */
  count: number;
}

/** One launch-odds bucket: the peer-group base rate for protocols first listed in this age window. */
export interface OddsBucket {
  /** Lower age edge in days (inclusive). */
  lo: number;
  /** Upper age edge in days (exclusive); null for the last, open-ended bucket. */
  hi: number | null;
  /** Share of protocols in this bucket that already record a token. */
  rate: number;
  /** How many dated protocols the rate was computed from. */
  count: number;
}

/** The launch odds, computed from the snapshot itself at runtime (never hardcoded). */
export interface LaunchOdds {
  buckets: OddsBucket[];
  /** How many dated, non-exchange, non-versioned protocols the rates were computed from. */
  count: number;
  /** Overall token rate over that pool (the base rate the odds beat held-out). */
  baseRate: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  /** The EXPECTED value: launch value x launch odds, clamped — the ranking quantity. */
  implied_value_usd: number;
  /** The value if the token launches: the regression base, clamped. */
  launch_value_usd: number;
  /** The peer-group base rate for this row's age bucket. */
  launch_odds: number;
  /** The uncertainty band's lower end: implied / 10^residual_sd, clamped to the value range. */
  value_low_usd: number;
  /** The uncertainty band's upper end: implied x 10^residual_sd, clamped to the value range. */
  value_high_usd: number;
  /** The P10 expected value: P10 launch value x launch odds, clamped. */
  value_p10_usd: number;
  /** The P90 expected value: P90 launch value x launch odds, clamped. */
  value_p90_usd: number;
  /** The rank the row's P90 value would take on the point-estimate board (best case). */
  rank_p90: number;
  /** The rank the row's P10 value would take on the point-estimate board (worst case). */
  rank_p10: number;
  /** Net $/hour at the P10 launch value (see netPerHourP10): the costed check, not the verdict. */
  net_per_hour_p10_usd: number;
  /** The costed call at P10: Farm at >= $25/h, Thin at >= $0/h, Skip below (forced Skip if P10 launch < $1M). */
  costed_call: 'Farm' | 'Thin' | 'Skip';
  verdict: 'Farm now' | 'Watch' | 'Skip';
  verdict_reason: string;
  model: {
    regression_intercept: number;
    regression_slope: number;
    regression_residual_sd: number;
    regression_residual_q10: number;
    regression_residual_q90: number;
    regression_count: number;
    regression_base: number;
    launch_odds: number;
    comparable_multiple: number;
    category_median: number | null;
    comparables_count: number;
    comparable_source: 'category' | 'global';
    concentration_factor: number;
    comparable_implied: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan and the model walk-through. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  launch_odds: number;
  value_low_usd: number;
  value_high_usd: number;
  value_p10_usd: number;
  value_p90_usd: number;
  rank_p90: number;
  rank_p10: number;
  net_per_hour_p10_usd: number;
  costed_call: 'Farm' | 'Thin' | 'Skip';
  verdict: 'Farm now' | 'Watch' | 'Skip';
  verdict_reason: string;
  watchlist: boolean;
  regression_intercept: number;
  regression_slope: number;
  regression_residual_sd: number;
  regression_residual_q10: number;
  regression_residual_q90: number;
  regression_count: number;
  regression_base: number;
  launch_value: number;
  comparable_multiple: number;
  category_median: number | null;
  comparables_count: number;
  comparable_source: 'category' | 'global';
  concentration_factor: number;
  comparable_implied: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  median_age_days: number;
  regression: { intercept: number; slope: number; residual_sd: number; residual_q10: number; residual_q90: number; count: number };
  odds: { buckets: { lo: number; hi: number | null; rate: number; count: number }[]; count: number; base_rate: number };
  comparables: { category: string; median: number; count: number }[];
  rows: RadarRow[];
  live: LiveRow[];
  /** The 758-protocol audit: every protocol in the snapshot, filed in exactly one lane. */
  snapshot_total: number;
  /** Protocols that already trade (live-token view shows the top 24 by market cap). */
  live_total: number;
  /** Pre-token protocols the house rule excludes from the board. */
  excluded_pre_token: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The ordinary median of a sorted array: the middle value, or the mean of the two middles. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The comparables: the median mcap/tvl of tokened protocols, per category and global, computed
 * from the snapshot itself at runtime. A comparable is a protocol with both mcap_usd and tvl_usd.
 * The median is the ordinary median of the sorted ratios; the global median is over all categories.
 */
export function computeComparables(snapshot: Snapshot): Comparables {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio)) continue;
    all.push(ratio);
    const key = p.category ?? '';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  all.sort((a, b) => a - b);
  const global = { median: medianOf(all), count: all.length };
  const out = new Map<string, { median: number; count: number }>();
  for (const [category, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    ratios.sort((a, b) => a - b);
    out.set(category, { median: medianOf(ratios), count: ratios.length });
  }
  return { global, byCategory: out };
}

/**
 * The log-log regression fit, computed from the snapshot itself at runtime: ordinary least squares
 * of log10(mcap_usd) on log10(tvl_usd) over every tokened protocol with both figures positive
 * (n = 128 in this snapshot). Closed-form least squares, no dependency. The residual sd is the
 * population sd of the log10 residuals, sqrt(mean(r^2)) — the same convention the LOO evaluation
 * reports (NumPy .std(), ddof=0), so the runtime fit reproduces its a ≈ 3.025, b ≈ 0.522,
 * sd ≈ 0.902. A fit that lands far from those numbers means the pool or the formula is wrong.
 */
export function fitRegression(snapshot: Snapshot): RegressionFit {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    xs.push(Math.log10(p.tvl_usd));
    ys.push(Math.log10(p.mcap_usd));
  }
  const n = xs.length;
  if (n < 2) throw new SnapshotError('regression needs at least 2 tokened protocols with mcap and TVL');
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) throw new SnapshotError('regression needs TVL variation in the fit pool');
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ss = 0;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = ys[i]! - (intercept + slope * xs[i]!);
    ss += r * r;
    residuals.push(r);
  }
  residuals.sort((a, b) => a - b);
  return {
    intercept,
    slope,
    residualSd: Math.sqrt(ss / n),
    residualQ10: quantileOf(residuals, 0.1),
    residualQ90: quantileOf(residuals, 0.9),
    count: n,
  };
}

/**
 * A quantile of a sorted array by linear interpolation — the same rule NumPy's
 * percentile uses, so the runtime fit reproduces the evaluation scripts'
 * q10/q90 exactly (in this snapshot q10 -1.1916, q90 +0.9286 dex).
 */
export function quantileOf(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[pos]!;
  return sorted[lo]! * (1 - (pos - lo)) + sorted[hi]! * (pos - lo);
}

/**
 * The launch odds, computed from the snapshot itself at runtime: for each age bucket, the share
 * of dated, non-exchange, non-versioned protocols that already record a token. Exchanges and
 * versioned pools are excluded because they are not launch candidates — the same rule the odds
 * pool's own write-up uses. A protocol counts as tokened when it carries a CoinGecko id or a
 * symbol (its market cap need not be reported: 262 of the 522 dated protocols record a token).
 * The bucket edges come from MODEL.odds_buckets; the rates are computed, never hardcoded.
 * The category dimension is deliberately NOT used: splitting the buckets by category did not
 * beat the bucket-only rate held-out (LOO Brier 0.2113 vs 0.2100), so the odds are the age
 * bucket alone.
 */
export function fitOdds(snapshot: Snapshot, model: ModelConstants = MODEL): LaunchOdds {
  const edges = model.odds_buckets;
  const buckets: OddsBucket[] = [];
  for (let i = 0; i <= edges.length; i++) {
    buckets.push({ lo: i === 0 ? 0 : edges[i - 1]!, hi: i === edges.length ? null : edges[i]!, rate: 0, count: 0 });
  }
  let total = 0;
  let tokened = 0;
  for (const p of snapshot.protocols) {
    if (p.listed_at === null) continue;
    if (p.category === 'CEX' || EXCHANGE_PREFIX.test(p.name) || VERSIONED.test(p.name)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age === null) continue;
    let bi = buckets.length - 1;
    for (let i = 0; i < buckets.length; i++) {
      if (age >= buckets[i]!.lo && (buckets[i]!.hi === null || age < buckets[i]!.hi!)) { bi = i; break; }
    }
    const has = p.gecko_id !== null || p.symbol !== null;
    buckets[bi]!.count += 1;
    if (has) buckets[bi]!.rate += 1;
    total += 1;
    if (has) tokened += 1;
  }
  for (const b of buckets) b.rate = b.count === 0 ? 0 : b.rate / b.count;
  return { buckets, count: total, baseRate: total === 0 ? 0 : tokened / total };
}

/** The launch odds for an age: the bucket rate for that age; a null age uses unknown_age_days. */
export function launchOdds(ageDaysValue: number | null, odds: LaunchOdds, model: ModelConstants = MODEL): number {
  const age = ageDaysValue ?? model.unknown_age_days;
  for (const b of odds.buckets) {
    if (age >= b.lo && (b.hi === null || age < b.hi)) return b.rate;
  }
  return odds.baseRate;
}

/** The fitted market cap for a protocol of this TVL: the launch value itself in radar-5. */
export function regressionBase(tvlUsd: number, fit: RegressionFit): number {
  return 10 ** (fit.intercept + fit.slope * Math.log10(tvlUsd));
}

/** The uncertainty band for an implied value: [implied / 10^sd, implied x 10^sd], clamped to the value range. */
export function uncertaintyBand(implied: number, fit: RegressionFit, model: ModelConstants = MODEL): { low: number; high: number } {
  const factor = 10 ** fit.residualSd;
  const low = Math.min(model.implied_max, Math.max(model.implied_min, Math.round(implied / factor)));
  const high = Math.min(model.implied_max, Math.max(model.implied_min, Math.round(implied * factor)));
  return { low, high };
}

/**
 * The effective comparable multiple for a category, and the concentration adjustment behind it.
 * A category with at least min_comparables comparables is shrunk toward the global median with
 * weight n/(n+shrink_k) and then capped; anything else falls back to the global median outright.
 * concentration_factor is the ratio effective / raw, so the walk-through can show the adjustment:
 * 1.0 when the global median is used directly, below 1 when a high category median is pulled down,
 * above 1 when a low category median is pulled up toward the global.
 */
export function comparableMultiple(
  category: string | null,
  comparables: Comparables,
  model: ModelConstants = MODEL,
): { multiple: number; rawMedian: number | null; count: number; source: 'category' | 'global'; concentrationFactor: number } {
  const entry = category === null ? undefined : comparables.byCategory.get(category);
  const count = entry === undefined ? 0 : entry.count;
  const rawMedian = entry === undefined ? null : entry.median;
  if (count < model.min_comparables || rawMedian === null) {
    // Fallback to the global median. When the category has a raw median (1-2 comparables),
    // the concentration factor is the honest ratio global/raw, so the walk-through still
    // multiplies out: raw x concentration = the global median actually used. When the category
    // has no comparables at all there is no raw median to adjust, so the factor is 1.
    const concentrationFactor = rawMedian === null || rawMedian === 0 ? 1 : comparables.global.median / rawMedian;
    return { multiple: comparables.global.median, rawMedian, count, source: 'global', concentrationFactor };
  }
  const w = count / (count + model.shrink_k);
  const shrunk = w * rawMedian + (1 - w) * comparables.global.median;
  const multiple = Math.min(model.multiple_cap_hi, Math.max(model.multiple_cap_lo, shrunk));
  const concentrationFactor = rawMedian === 0 ? 1 : multiple / rawMedian;
  return { multiple, rawMedian, count, source: 'category', concentrationFactor };
}

/**
 * The P10/P90 launch values for a protocol: the regression prediction shifted by the
 * fit residuals' 10th/90th percentiles, clamped to the value range. The P10/P90
 * expected values are these times the launch odds. This is the shipped interval
 * construction: per-row, from the fit's own residuals — no global band, no bootstrap
 * at runtime (the 200x bootstrap in work/v5-intervals.py only cross-checks it).
 */
export function intervalValues(
  tvlUsd: number,
  fit: RegressionFit,
  launchOddsValue: number,
  model: ModelConstants = MODEL,
): { p10Launch: number; p90Launch: number; p10: number; p90: number } {
  const pred = fit.intercept + fit.slope * Math.log10(tvlUsd);
  const clamp = (x: number): number => Math.min(model.implied_max, Math.max(model.implied_min, Math.round(x)));
  const p10Launch = clamp(10 ** (pred + fit.residualQ10));
  const p90Launch = clamp(10 ** (pred + fit.residualQ90));
  return { p10Launch, p90Launch, p10: clamp(p10Launch * launchOddsValue), p90: clamp(p90Launch * launchOddsValue) };
}

/** The gas midpoint for one transaction on a chain — the numeric twin of gasFor's ranges. */
export function gasMidFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8.5;
  if (
    c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'zksync' || c === 'zksync era' ||
    c === 'polygon' || c === 'blast' || c === 'linea' || c === 'scroll' || c === 'mantle' ||
    c === 'mode' || c === 'starknet' || c === 'taiko' || c === 'fraxtal' || c === 'merlin'
  ) return 0.275;
  if (c === 'solana') return 0.01;
  if (c === 'bsc' || c === 'binance' || c === 'avalanche' || c === 'fantom' || c === 'cronos' || c === 'celo') return 0.55;
  return 1;
}

/**
 * Net $/hour at the P10 launch value: the farmer's-eye check, computed from the same
 * inputs the farm plan uses (capital by TVL band, gas by chain, hold by age) plus two
 * stated assumptions — A1: the airdrop pool is 10% of the launch value (typical
 * allocations cluster 5–15%; 10% is the midpoint, an assumption, not a measurement);
 * A2: the farmer's share of the pool is capital/TVL, pro-rata on deposits (OlosLabs'
 * formula with deposits ~= TVL; points programs may pay active farmers more, so this
 * is a conservative, pro-rata share). Expected payout = P10 launch x 10% x share x
 * odds. Costs: one funding transaction at the gas midpoint + the farm plan's setup
 * figure ($8 if capital >= $500 else $4) + $2/week, plus 5% APR opportunity cost on
 * the capital over the hold. Hours: 45 min setup + 15 min/week + 10 min claim.
 * Returns dollars per hour, rounded to cents; the costed call thresholds ($25/$0)
 * are applied by costedCall.
 */
export function netPerHourP10(
  protocol: SnapshotProtocol,
  p10Launch: number,
  launchOddsValue: number,
  age: number | null,
  model: ModelConstants = MODEL,
): number {
  const capital = capitalFor(protocol);
  const chain = chainOf(protocol);
  const gasMid = gasMidFor(chain);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const hours = 0.75 + 0.25 * weeks + 10 / 60;
  const gas = gasMid + (capital >= 500 ? 8 : 4) + 2 * weeks;
  const opp = capital * 0.05 * (hold / 365);
  const payout = p10Launch * 0.1 * (capital / protocol.tvl_usd) * launchOddsValue;
  const net = payout - gas - opp;
  return Math.round((net / hours) * 100) / 100;
}

/** The costed call at P10: Farm at >= $25/h, Thin at >= $0/h, Skip below — forced Skip if the P10 launch value is under $1M. */
export function costedCall(netPerHour: number, p10Launch: number): 'Farm' | 'Thin' | 'Skip' {
  if (p10Launch < 1_000_000 || netPerHour < 0) return 'Skip';
  if (netPerHour >= 25) return 'Farm';
  return 'Thin';
}

/** The implied value one protocol gets under `model`. The value is priced by the
 * regression fit alone and weighted by the launch odds; the comparables multiple is
 * computed alongside as a cross-check and the implied value it would give is carried
 * so the dashboard can show both numbers side by side. `implied` is the EXPECTED
 * value (launch value x odds) — the ranking quantity. `launchValue` is the value if
 * the token launches, and in radar-5 it equals the regression base. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  fit: RegressionFit,
  odds: LaunchOdds,
  model: ModelConstants = MODEL,
): {
  implied: number;
  launchValue: number;
  launchOdds: number;
  base: number;
  valueLow: number;
  valueHigh: number;
  p10Launch: number;
  p90Launch: number;
  p10: number;
  p90: number;
  netPerHourP10: number;
  costedCall: 'Farm' | 'Thin' | 'Skip';
  comparableImplied: number;
  multiple: number;
  rawMedian: number | null;
  count: number;
  source: 'category' | 'global';
  concentrationFactor: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const comp = comparableMultiple(protocol.category, comparables, model);
  const base = regressionBase(protocol.tvl_usd, fit);
  const launchValue = Math.min(model.implied_max, Math.max(model.implied_min, Math.round(base)));
  const launchOddsValue = launchOdds(age, odds, model);
  const raw = launchValue * launchOddsValue;
  const implied = Math.min(model.implied_max, Math.max(model.implied_min, Math.round(raw)));
  const band = uncertaintyBand(implied, fit, model);
  const interval = intervalValues(protocol.tvl_usd, fit, launchOddsValue, model);
  const net = netPerHourP10(protocol, interval.p10Launch, launchOddsValue, age, model);
  const compRaw = protocol.tvl_usd * comp.multiple;
  const comparableImplied = Math.min(model.implied_max, Math.max(model.implied_min, Math.round(compRaw)));
  return { implied, launchValue, launchOdds: launchOddsValue, base, valueLow: band.low, valueHigh: band.high, p10Launch: interval.p10Launch, p90Launch: interval.p90Launch, p10: interval.p10, p90: interval.p90, netPerHourP10: net, costedCall: costedCall(net, interval.p10Launch), comparableImplied, multiple: comp.multiple, rawMedian: comp.rawMedian, count: comp.count, source: comp.source, concentrationFactor: comp.concentrationFactor, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: it records no token, it is not a wrapped, staked
 * or bridged product, it is not an exchange, and its name is not a versioned pool. This is the
 * house rule, generalized from the watchlist to every protocol in the snapshot.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A compact dollar figure for prose: $2.75B, $543M, $49.6M, $5.0M, $850K. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** The verdict and the single decisive reason for one scored row. */
export function verdictFor(
  implied: number,
  change7d: number | null,
  age: number | null,
  tvl: number,
  model: ModelConstants = MODEL,
): { verdict: 'Farm now' | 'Watch' | 'Skip'; reason: string } {
  const growthOk = change7d === null || change7d >= model.farm_now_growth_gate;
  const ageOk = age === null || age >= model.farm_now_age_gate;
  if (implied >= model.farm_now_min && growthOk && ageOk) {
    return {
      verdict: 'Farm now',
      reason: `Expected value ${fmtUsd(implied)} on ${fmtUsd(tvl)} of TVL, ${age === null ? 'age unlisted' : `${age} days`} with no token recorded — the strongest claim on this board.`,
    };
  }
  if (implied >= model.watch_min && (change7d === null || change7d >= model.watch_growth_gate)) {
    if (implied >= model.farm_now_min && !growthOk) {
      return { verdict: 'Watch', reason: `Expected value ${fmtUsd(implied)} is strong, but TVL fell ${change7d!.toFixed(1)}% in 7 days — wait for the decline to stop.` };
    }
    if (implied >= model.farm_now_min && !ageOk) {
      return { verdict: 'Watch', reason: `Expected value ${fmtUsd(implied)} is strong, but only ${age} days with no token recorded — too young to trust one snapshot.` };
    }
    return { verdict: 'Watch', reason: `Expected value ${fmtUsd(implied)} clears the ${fmtUsd(model.watch_min)} Watch line but not the ${fmtUsd(model.farm_now_min)} Farm now line.` };
  }
  return { verdict: 'Skip', reason: `Expected value ${fmtUsd(implied)} is below the ${fmtUsd(model.watch_min)} Watch line — low priority for now.` };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The gas profile of one chain, as a cost range for a single transaction. */
export function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$2–$15';
  if (
    c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'zksync' || c === 'zksync era' ||
    c === 'polygon' || c === 'blast' || c === 'linea' || c === 'scroll' || c === 'mantle' ||
    c === 'mode' || c === 'starknet' || c === 'taiko' || c === 'fraxtal' || c === 'merlin'
  ) return '$0.05–$0.50';
  if (c === 'solana') return '~$0.01';
  if (c === 'bsc' || c === 'binance' || c === 'avalanche' || c === 'fantom' || c === 'cronos' || c === 'celo') return '$0.10–$1';
  return '~$1';
}

/** Whether a chain is a low-fee chain (an L2 or Solana), for the bridge step's wording. */
function isLowFeeChain(chain: string): boolean {
  const gas = gasFor(chain);
  return gas === '$0.05–$0.50' || gas === '~$0.01';
}

/** How much capital one farm position needs, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 1000;
  if (p.tvl_usd >= 100_000_000) return 500;
  if (p.tvl_usd >= 50_000_000) return 250;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it to open a loop; keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} (both sides, a tight range) and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open a testnet position on ${name} first, then deposit $${capital} of USDC as margin and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age) and the verdict, never from a
 * hand-written list of names. Step 0 is the verdict line; the rest are the farming actions.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, verdict: string, reason: string): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const lowFee = isLowFeeChain(chain);
  const fundStep =
    chain === 'Ethereum'
      ? { text: `Fund the wallet with $${capital} USDC on Ethereum.`, cost: `gas ${gas} for the funding transaction`, time: '10 minutes' }
      : {
          text: `Bridge $${capital} USDC from Ethereum to ${chain} using the official bridge. Keep about $5 on ${chain} for gas.`,
          cost: `gas ${gas} on ${chain}${lowFee ? ', plus the Ethereum-side bridge fee' : ''}`,
          time: '15 minutes',
        };
  return [
    { text: `Verdict: ${verdict} — ${reason}`, cost: 'no cost to read', time: '1 minute' },
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    fundStep,
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${capital >= 500 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: 'about $2 of gas a week',
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit: RegressionFit | null = null, odds: LaunchOdds | null = null): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comparables = computeComparables(snapshot);
  const regression = fit ?? fitRegression(snapshot);
  const launchOddsFit = odds ?? fitOdds(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol, whatever its TVL — the house rule is the
  // only filter, so the board is the watchlist plus every rankable protocol the snapshot holds.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, comparables, regression, launchOddsFit, model);
    const verdict = verdictFor(v.implied, p.change_7d, v.age, p.tvl_usd, model);
    return { p, v, verdict };
  });
  // Strongest expected value first; the $1M floor ties break by TVL, then by slug, so the order is
  // deterministic and a tied tail still ranks the larger protocol first.
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // Rank ranges: the rank a row's P90/P10 expected value would take on this board
  // (count of rows with a strictly larger expected value, +1). Computed after the
  // sort, from the point-estimate board itself — no extra data, fully deterministic.
  const rankOfValue = (value: number): number => scored.reduce((n, s) => n + (s.v.implied > value ? 1 : 0), 0) + 1;
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    launch_value_usd: s.v.launchValue,
    launch_odds: s.v.launchOdds,
    value_low_usd: s.v.valueLow,
    value_high_usd: s.v.valueHigh,
    value_p10_usd: s.v.p10,
    value_p90_usd: s.v.p90,
    rank_p90: rankOfValue(s.v.p90),
    rank_p10: rankOfValue(s.v.p10),
    net_per_hour_p10_usd: s.v.netPerHourP10,
    costed_call: s.v.costedCall,
    verdict: s.verdict.verdict,
    verdict_reason: s.verdict.reason,
    model: {
      // Full precision, not rounded: the dashboard recomputes the implied value from these
      // factors and must land on exactly the number board.json carries.
      regression_intercept: regression.intercept,
      regression_slope: regression.slope,
      regression_residual_sd: regression.residualSd,
      regression_residual_q10: regression.residualQ10,
      regression_residual_q90: regression.residualQ90,
      regression_count: regression.count,
      regression_base: s.v.base,
      launch_value: s.v.launchValue,
      launch_odds: s.v.launchOdds,
      comparable_multiple: s.v.multiple,
      category_median: s.v.rawMedian,
      comparables_count: s.v.count,
      comparable_source: s.v.source,
      concentration_factor: s.v.concentrationFactor,
      comparable_implied: s.v.comparableImplied,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, s.verdict.verdict, s.verdict.reason).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for zz-data.js, with the farm plan and the model walk-through. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.launch_value_usd,
    launch_odds: row.launch_odds,
    value_low_usd: row.value_low_usd,
    value_high_usd: row.value_high_usd,
    value_p10_usd: row.value_p10_usd,
    value_p90_usd: row.value_p90_usd,
    rank_p90: row.rank_p90,
    rank_p10: row.rank_p10,
    net_per_hour_p10_usd: row.net_per_hour_p10_usd,
    costed_call: row.costed_call,
    verdict: row.verdict,
    verdict_reason: row.verdict_reason,
    watchlist: watchlist.has(row.slug),
    regression_intercept: row.model.regression_intercept,
    regression_slope: row.model.regression_slope,
    regression_residual_sd: row.model.regression_residual_sd,
    regression_residual_q10: row.model.regression_residual_q10,
    regression_residual_q90: row.model.regression_residual_q90,
    regression_count: row.model.regression_count,
    regression_base: row.model.regression_base,
    launch_odds: row.model.launch_odds,
    comparable_multiple: row.model.comparable_multiple,
    category_median: row.model.category_median,
    comparables_count: row.model.comparables_count,
    comparable_source: row.model.comparable_source,
    concentration_factor: row.model.concentration_factor,
    comparable_implied: row.model.comparable_implied,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const regression = fitRegression(snapshot);
  const odds = fitOdds(snapshot, model);
  const board = buildBoard(snapshot, model, regression, odds);
  const comparables = computeComparables(snapshot);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug) && r.tvl_usd < snapshot.floor_usd).length;
  const comparablesList = [...comparables.byCategory.entries()]
    .map(([category, v]) => ({ category, median: v.median, count: v.count }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  // The 758 audit: every protocol in the snapshot, filed in exactly one lane.
  const liveTotal = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const excludedPreToken = snapshot.protocols.filter((p) => isPreToken(p) && !isRankable(p)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median: comparables.global.median,
    median_age_days: model.unknown_age_days,
    regression: { intercept: regression.intercept, slope: regression.slope, residual_sd: regression.residualSd, residual_q10: regression.residualQ10, residual_q90: regression.residualQ90, count: regression.count },
    odds: { buckets: odds.buckets, count: odds.count, base_rate: odds.baseRate },
    comparables: comparablesList,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
    snapshot_total: snapshot.protocols.length,
    live_total: liveTotal,
    excluded_pre_token: excludedPreToken,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isSafeInteger(r.value_low_usd) || !Number.isSafeInteger(r.value_high_usd) || r.value_low_usd <= 0 || r.value_high_usd <= 0) {
      return `${r.slug} has a bad uncertainty band ${r.value_low_usd}–${r.value_high_usd}`;
    }
    if (r.value_low_usd > r.implied_value_usd || r.implied_value_usd > r.value_high_usd) {
      return `${r.slug} has implied value ${r.implied_value_usd} outside its band ${r.value_low_usd}–${r.value_high_usd}`;
    }
  }
  return null;
}

/** A compact zz-data.js: the dashboard's whole dataset as one minified line, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
