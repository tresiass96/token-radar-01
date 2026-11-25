// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) plus every
// other pre-token protocol the house rule keeps, down to the snapshot's $5M TVL floor. A protocol is
// pre-token when its record carries no token (no CoinGecko id, no symbol); the snapshot's live-token
// protocols are kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, computed at runtime:
//
//   comparable_multiple(category)  median mcap/tvl of tokened protocols in the same category,
//                                  shrunk toward the global median and capped (see below)
//   momentumFactor(change_7d)      1 + clamp(change_7d, -60, 120) / 100 x 0.5, clamped to [0.8, 1.5];
//                                  null change_7d -> 1.0 (neutral, stated on the page)
//   maturityFactor(age)            0.8 + min(age, 1095) / 1095 x 0.2; age = as_of - listed_at in days;
//                                  null listed_at -> 513 days (the pre-token median age, factor 0.8937)
//   concentrationFactor            the adjustment that turns a category's raw median into the
//                                  effective multiple: shrink toward the global median with weight
//                                  n/(n+5), then cap to [0.02, 1.00]; a category with fewer than 3
//                                  comparables falls back to the global median outright.
//   implied = round(tvl x comparable_multiple x momentumFactor x maturityFactor),
//             clamped to [1,000,000, 100,000,000,000,000]
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
  /** Momentum weight on the clamped 7-day change. */
  momentum_weight: number;
  /** The 7-day change is clamped to this range (per cent) before the momentum weight applies. */
  growth_floor: number;
  growth_cap: number;
  /** The momentum factor itself is clamped to this range. */
  momentum_lo: number;
  momentum_hi: number;
  /** Momentum factor when change_7d is null. */
  momentum_null: number;
  /** Maturity floor and range: factor = floor + min(age, maturity_days)/maturity_days x range. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
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
}

export const MODEL: ModelConstants = {
  shrink_k: 5,
  multiple_cap_lo: 0.02,
  multiple_cap_hi: 1.0,
  min_comparables: 3,
  momentum_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  momentum_lo: 0.8,
  momentum_hi: 1.5,
  momentum_null: 1.0,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 1095,
  unknown_age_days: 513,
  implied_min: 1_000_000,
  implied_max: 100_000_000_000_000,
  farm_now_min: 50_000_000,
  farm_now_growth_gate: -15,
  farm_now_age_gate: 90,
  watch_min: 10_000_000,
  watch_growth_gate: -30,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The global median mcap/tvl, computed from the snapshot at runtime (not a hardcoded price). */
export interface Comparables {
  /** Median mcap/tvl over all tokened protocols with both figures, and how many there are. */
  global: { median: number; count: number };
  /** Per category: median mcap/tvl and count, only for categories with at least one comparable. */
  byCategory: Map<string, { median: number; count: number }>;
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
  implied_value_usd: number;
  verdict: 'Farm now' | 'Watch' | 'Skip';
  verdict_reason: string;
  model: {
    comparable_multiple: number;
    category_median: number | null;
    comparables_count: number;
    comparable_source: 'category' | 'global';
    concentration_factor: number;
    growth_pct: number;
    momentum_factor: number;
    maturity_factor: number;
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
  verdict: 'Farm now' | 'Watch' | 'Skip';
  verdict_reason: string;
  watchlist: boolean;
  comparable_multiple: number;
  category_median: number | null;
  comparables_count: number;
  comparable_source: 'category' | 'global';
  concentration_factor: number;
  momentum_factor: number;
  maturity_factor: number;
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
  comparables: { category: string; median: number; count: number }[];
  rows: RadarRow[];
  live: LiveRow[];
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
 * The momentum factor for a 7-day TVL change: 1 + the clamped change (per cent) times the weight,
 * clamped to [momentum_lo, momentum_hi]. A null change is neutral (1.0), stated on the page.
 */
export function momentumFactor(change7d: number | null, model: ModelConstants = MODEL): { factor: number; growthPct: number } {
  if (change7d === null || !Number.isFinite(change7d)) return { factor: model.momentum_null, growthPct: 0 };
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, change7d));
  const factor = Math.min(model.momentum_hi, Math.max(model.momentum_lo, 1 + (growthPct / 100) * model.momentum_weight));
  return { factor, growthPct };
}

/**
 * The maturity factor for an age without a token: floor + min(age, maturity_days)/maturity_days x
 * range. A null age uses unknown_age_days (the pre-token median age), stated on the page.
 */
export function maturityFactor(ageDaysValue: number | null, model: ModelConstants = MODEL): number {
  const age = ageDaysValue ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  rawMedian: number | null;
  count: number;
  source: 'category' | 'global';
  concentrationFactor: number;
  growthPct: number;
  momentum: number;
  maturity: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const comp = comparableMultiple(protocol.category, comparables, model);
  const mom = momentumFactor(protocol.change_7d, model);
  const maturity = maturityFactor(age, model);
  const raw = protocol.tvl_usd * comp.multiple * mom.factor * maturity;
  const implied = Math.min(model.implied_max, Math.max(model.implied_min, Math.round(raw)));
  return { implied, multiple: comp.multiple, rawMedian: comp.rawMedian, count: comp.count, source: comp.source, concentrationFactor: comp.concentrationFactor, growthPct: mom.growthPct, momentum: mom.factor, maturity, age };
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
      reason: `Implied ${fmtUsd(implied)} on ${fmtUsd(tvl)} of TVL, ${age === null ? 'age unlisted' : `${age} days`} with no token recorded — the strongest claim on this board.`,
    };
  }
  if (implied >= model.watch_min && (change7d === null || change7d >= model.watch_growth_gate)) {
    if (implied >= model.farm_now_min && !growthOk) {
      return { verdict: 'Watch', reason: `Implied ${fmtUsd(implied)} is strong, but TVL fell ${change7d!.toFixed(1)}% in 7 days — wait for the decline to stop.` };
    }
    if (implied >= model.farm_now_min && !ageOk) {
      return { verdict: 'Watch', reason: `Implied ${fmtUsd(implied)} is strong, but only ${age} days with no token recorded — too young to trust one snapshot.` };
    }
    return { verdict: 'Watch', reason: `Implied ${fmtUsd(implied)} clears the $10M Watch line but not the $50M Farm now line.` };
  }
  return { verdict: 'Skip', reason: `Implied ${fmtUsd(implied)} is below the $10M Watch line — low priority for now.` };
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
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comparables = computeComparables(snapshot);
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
    const v = impliedValue(p, snapshot.as_of, comparables, model);
    const verdict = verdictFor(v.implied, p.change_7d, v.age, p.tvl_usd, model);
    return { p, v, verdict };
  });
  // Strongest implied value first; the $1M floor ties break by TVL, then by slug, so the order is
  // deterministic and a tied tail still ranks the larger protocol first.
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
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
    verdict: s.verdict.verdict,
    verdict_reason: s.verdict.reason,
    model: {
      // Full precision, not rounded: the dashboard recomputes the implied value from these
      // factors and must land on exactly the number board.json carries.
      comparable_multiple: s.v.multiple,
      category_median: s.v.rawMedian,
      comparables_count: s.v.count,
      comparable_source: s.v.source,
      concentration_factor: s.v.concentrationFactor,
      growth_pct: s.v.growthPct,
      momentum_factor: s.v.momentum,
      maturity_factor: s.v.maturity,
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
    verdict: row.verdict,
    verdict_reason: row.verdict_reason,
    watchlist: watchlist.has(row.slug),
    comparable_multiple: row.model.comparable_multiple,
    category_median: row.model.category_median,
    comparables_count: row.model.comparables_count,
    comparable_source: row.model.comparable_source,
    concentration_factor: row.model.concentration_factor,
    momentum_factor: row.model.momentum_factor,
    maturity_factor: row.model.maturity_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comparables = computeComparables(snapshot);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug) && r.tvl_usd < snapshot.floor_usd).length;
  const comparablesList = [...comparables.byCategory.entries()]
    .map(([category, v]) => ({ category, median: v.median, count: v.count }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
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
    comparables: comparablesList,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
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
  }
  return null;
}

/** A compact zz-data.js: the dashboard's whole dataset as one minified line, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
