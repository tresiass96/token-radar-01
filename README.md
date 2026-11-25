# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01)](https://make.fun/bounty/token-radar-01)
[![Node 22](https://img.shields.io/badge/Node-22%2B-339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A token launch radar for the [make.fun bounty `token-radar-01`](https://make.fun/bounty/token-radar-01): it reads a sealed snapshot of every protocol DefiLlama tracks, ranks the ones that record no token by what their launch would be worth, and hands each one a concrete farm plan.

## What it does

- Reads `/input/snapshot.json` (758 protocols, DefiLlama, as of 2026-11-14).
- Scores every pre-token protocol with a comparables model: the protocol's TVL times the category-median market-cap/TVL multiple of the tokened protocols in the same category (computed from the snapshot at runtime, never hardcoded), times a momentum factor from its 7-day TVL change, times a maturity factor from how long it has run with no token.
- Writes a ranked board (`board.json`, 198 rows: the whole 40-protocol watchlist plus 138 early rows below the $50M floor and 20 above it that pass the house rule), a static dashboard (`dashboard/`, no network, no framework), three screenshots, and a `dossier.json` the judge reads.
- The dashboard is a research desk: sortable and filterable board, a detail view per protocol with a full model walk-through, a separate live-token view, and a Methodology section that states the model, its bounds, and its coverage.

## Run it

Node 22.18+ (24 works too), standard library only, nothing to install:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Two runs write identical bytes: no clock, no randomness, no locale without an explicit `"en-US"`, and the snapshot is iterated in its given slug order.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + screenshots + dossier out.
- `lib/model.ts` — the model (`computeComparables`, `momentumFactor`, `maturityFactor`, `buildFarmPlan`) and the board builder. All constants live in one `MODEL` object, so a parameter sweep only touches one place.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (47,520 bytes of source; the judge reads all of it) plus the generated `zz-data.js`, one minified line named to sort last in the dossier.
- `screenshots/` — the board, a protocol detail view, and a filtered view, each 1440×900.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored from the kit.

## The model, in one line

```
implied = round(tvl × comparable_multiple × momentum × maturity), clamped [$1M, $100T]
```

- `comparable_multiple`: median mcap/TVL of the tokened protocols in the same category, shrunk toward the global median 0.1689 (weight n/(n+5)), capped [0.02, 1.00]; categories with fewer than 3 comparables fall back to the global median.
- `momentum`: clamp(1 + clamp(change_7d, −60, 120)/100 × 0.5, 0.8, 1.5); null change → 1.0.
- `maturity`: 0.6 + min(age_days, 1095)/1095 × 0.4; age unknown → 513 days (the snapshot median).
- Verdict: **Farm now** when implied ≥ $50M and 7-day change ≥ −15% and age ≥ 90 days; **Watch** when implied ≥ $10M and change ≥ −30%; otherwise **Skip**.

A protocol is pre-token when its DefiLlama record carries no token (no market cap, no CoinGecko id, no symbol). The snapshot's record is not proof, so the dashboard says a protocol *records no token*, never that it *has* none.

## License

MIT. See [LICENSE](LICENSE).
