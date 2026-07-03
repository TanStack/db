# Autoresearch run — TanStack DB vs Rindle benchmark performance

[autoresearch] mode: classic

## Goal
~~Make TanStack DB faster on the query shapes in samwillis/rindle-db-bench~~
**Updated 2026-07-02 (user directive): don't stop until TanStack DB is faster
than Rindle on every benchmark row.**

Predicate: in the unmodified rindle-db-bench harness run locally with
@rindle/wasm@0.2.0 from npm and @tanstack/db swapped to the candidate dist,
every speedup cell (13 hydrate + 13 incremental rows, SCALE=large) is ≥ 1.0×
in TanStack's favor.

## Scope
- packages/db (query compiler, live query collection, collection state/read paths)
- packages/db-ivm (operators, indexes, multiset)
- No public API changes. No behavior changes (test suites must stay green).

## Metric
Interleaved A/B benchmark, baseline = origin/main @ 95e25bd1 (built in
`.worktrees/perf-baseline`), candidate = this worktree's build:

    caffeinate -dims node .tmp/bench/ab-compare.mjs 3

Primary: geomean hydrate speedup across the 13 Rindle queries (higher is better).
Secondary: geomean incremental speedup; no single query regressing > 10%.

## Verify (correctness gate — required for keep)
    pnpm --filter @tanstack/db-ivm --filter @tanstack/db build
    pnpm --filter @tanstack/db-ivm --filter @tanstack/db test

## Iterations
15 (bounded)

## Log
- `iterations.md` — per-iteration hypothesis, change, metric result, keep/discard
- `autoresearch-results.tsv` — final A/B table
