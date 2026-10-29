# Effect startup delta follow-up

## Baseline restoration

This follow-up restores the accepted Effect metadata owner from
`db38b4e009146af53e46aeeef3206269f5968af8`, without editing its model, grammar,
driver, recorder, comparisons, or reach. Its SHA256 is
`4b738962e30f2b0f55b1894bab1f76334da8d66e6001773bbe24599408bb6130`.
The shared source-metadata model and cleanup support already exist on main.
The owner also rejoins the package's explicit `test:oracles` command.

The baseline is main `bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. Production is
unchanged. The first commit establishes a separately reviewable instrument
before any production repair. No current-main execution result is claimed yet.
Local tests and builds remain unrun under the maintainer's release-session
restriction; current-main reproduction must precede production edits.

## Law and preserved evidence

Effect callbacks deliver the query's full before/after delta. An `update`
requires an occurrence that previously entered; a startup-only intermediate
change cannot invent such an occurrence. Explicitly selected source metadata,
previous values, event multiplicity, and active event-key intervals are part of
the comparison. Authority: public `EffectConfig` and `DeltaEvent`, the Effect
guide, `VirtualRowProps`, and the source settlement law. Batch partition is
unconstrained; the check allows empty batches and opaque event keys.

The reviewed pre-release owner has 200 finite histories across structured and
functional projections, single sources, LEFT joins, and both populated-union
orders. It varies independent optimistic outcomes, confirmations, settlement
order, remote followups, peer exit/reentry, and surviving-row next use. It checks
both batch and named callbacks at every declared action cut, continuing after
a mismatch so startup failure cannot erase later evidence.

The preserved review records 152 passes and 64 LEFT-join startup REDs, all
5,512 declared lane/channel/cut cells reached, and 2,692 of 2,756 checkpoint
comparisons passing. The failing checkpoint emits an update for a never-entered
unmatched occurrence. Five hostile callback overlays add intended comparison
failures; legal key renaming, fresh reentry keys and empty partitions retain the
baseline. These are historical results, not fresh results on this branch.

The complete applicable ORC-001 through ORC-016 evaluation, fingerprints,
calibrations, omission attacks and execution commands remain in
[chunk 16 of the accepted campaign record](2026-10-28-pr-2171-oracle-chunks.md#chunk-16-explicit-source-metadata-reaches-effect-deltas-reviewed).
The [release deferral](2026-10-29-pr-2171-deferred-oracles.md) retains the broader
P09–P12 and type-receiver scope. This restoration changes none of those verdicts.

## Required repair evidence

Before production changes, run the restored owner on unchanged main and retain
the actual callback mismatch and all per-cell reach. Then run the same owner
after the repair and with the original defect restored as a hostile mutant.
Preserve neighboring single-source/union behavior, both callback channels,
previous values, empty partitions, and later optimistic settlement/next use.

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm --filter @tanstack/db exec vitest run \
  tests/query/virtual-row-fields-effect-oracle.test.ts --coverage.enabled=false
```

Limits remain eager controlled core sources, scalar projections, one mutation
per source, and the named paths. This supplies no real-provider/framework,
arbitrary scheduling, ordered repair, same-source overlap, or callback-input
sanitization evidence. No GREEN, production repair, or bug-class closure is
claimed by this baseline restoration.
