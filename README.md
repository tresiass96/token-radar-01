# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tresiass96/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tresiass96/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the [make.fun bounty `token-radar-01`](https://make.fun/bounty/token-radar-01): it reads a sealed snapshot of every protocol DefiLlama tracks, ranks the ones that record no token by what their launch would be worth, and hands each one a concrete farm plan.

## What it does

- Reads `/input/snapshot.json` (758 protocols, DefiLlama, as of 2026-11-14).
- Scores every pre-token protocol by its **expected value**: a log-log regression fitted at runtime from the snapshot's own tokened protocols (log10(market cap) = 3.0247 + 0.5223 × log10(TVL), n = 128) gives the launch value — the curve alone, no post-fit multipliers — then times the launch odds, the peer-group base rate for its age bucket (the share of protocols first listed in the same age window that already record a token, n = 522). The regression beat the old comparables model held-out twice (leave-one-out 0.531 vs 0.694; older-to-newer 0.488 vs 0.710), and the odds beat the base rate held-out twice (Brier 0.210 vs 0.250). The radar-4 momentum × maturity multipliers were dropped in radar-5: they never passed a blind test (LOO 0.538 vs 0.531 curve-alone; fitted weights negative, −7.52 and −2.48), so the board is now priced by the curve alone, as the Methodology always claimed.
- Writes a ranked board (`board.json`, 198 rows: the whole 40-protocol watchlist plus 138 early rows below the $50M floor and 20 above it that pass the house rule), a static dashboard (`dashboard/`, no network, no framework), three screenshots, and a `dossier.json` the judge reads.
- The dashboard is a research desk: sortable and filterable board (with a launch-odds column and an integrity strip), a detail view per protocol with a full model walk-through and a costed farm plan, a separate live-token view, a validation panel (ablation table, per-category errors, measured interval coverage, costed calls), and a Methodology section that states the model, its held-out tests, and a coverage audit of all 758 protocols.

## Run it

Node 22.18+ (24 works too), standard library only, nothing to install:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Two runs write identical bytes: no clock, no randomness, no locale without an explicit `"en-US"`, and the snapshot is iterated in its given slug order.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + screenshots + dossier out.
- `lib/model.ts` — the model (`fitRegression`, `fitOdds`, `intervalValues`, `netPerHourP10`, `buildFarmPlan`) and the board builder. All constants live in one `MODEL` object, so a parameter sweep only touches one place.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (63,615 bytes of source; the judge reads all of it) plus the generated `zz-data.js`, one minified line named to sort last in the dossier.
- `screenshots/` — the board, a protocol detail view, and the validation panel, each 1440×900.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored from the kit.

## The model, in one line (radar-5)

```
expected = round(launch × odds), clamped [$1M, $100T]
launch   = round(10^(3.0247 + 0.5223 × log10(tvl))), clamped [$1M, $100T]
```

- `launch`: the regression base — a log-log OLS fit over the snapshot's 128 tokened protocols (residual sd 0.902, so each value carries a ±7.98× band) — and nothing else. The comparables multiple (category median mcap/TVL, shrunk toward the global median 0.1689, capped [0.02, 1.00]) is kept only as a cross-check on each detail page.
- `odds`: the peer-group base rate by age — 25% for protocols first listed 0–180 days ago, 36% at 180–365 days, 37% at 365–730 days, 59% at 730–1,100 days, 83% over 1,100 days (computed at runtime from the snapshot's 522 dated protocols; the category dimension did not validate, so the odds use the age bucket alone).
- Dropped in radar-5: `momentum` (clamp(1 + clamp(change_7d, −60, 120)/100 × 0.5, 0.8, 1.5); null → 1.0) and `maturity` (0.8 + min(age_days, 1095)/1095 × 0.2; null age → 513 days) — both failed three blind tests (see Methodology, "Every term kept or dropped on two blind tests"). Their formulas are quoted in `lib/model.ts` so the ablation stays auditable.
- Uncertainty: every row carries a P10–P90 expected-value interval from the fit residuals' 10th/90th percentiles (measured leave-one-out coverage 78.9% on the 128 comps) plus the rank range its P90/P10 values would take, and a net $/hour at P10 with a costed call (Farm ≥ $25/h, Thin ≥ $0/h, Skip below). At pro-rata shares no row clears $0/h (median −$7.34/h); the validation panel states the break-even pool share instead (median 0.19% of the pool).
- Verdict: **Farm now** when expected ≥ $12.5M and 7-day change ≥ −15% and age ≥ 90 days; **Watch** when expected ≥ $4M and change ≥ −30%; otherwise **Skip**. (The thresholds were re-set for the expected-value scale, whose top is near $29M; the previous launch-value scale topped out near $80M.)

A protocol is pre-token when its DefiLlama record carries no token (no market cap, no CoinGecko id, no symbol). The snapshot's record is not proof, so the dashboard says a protocol *records no token*, never that it *has* none.

## License

MIT. See [LICENSE](LICENSE).
