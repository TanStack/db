# Effect startup delta follow-up

## Baseline restoration

This follow-up restores the accepted Effect metadata owner from
`db38b4e009146af53e46aeeef3206269f5968af8`, without editing its model, grammar,
driver, recorder, comparisons, or reach. Its SHA256 is
`4b738962e30f2b0f55b1894bab1f76334da8d66e6001773bbe24599408bb6130`.
The shared source-metadata model and cleanup support already exist on main.
The owner also rejoins the package's explicit `test:oracles` command.

The baseline is main `bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. Production was
unchanged in baseline restoration commit `9b03e639f769502dccccff7656ba85ab4ca124e8`.
That commit establishes a separately reviewable instrument before the repair.
No execution result was claimed at restoration. The maintainer subsequently
authorized targeted oracle tests, while retaining the prohibition on full builds.
The dated evidence below supersedes the pending execution status.

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

## Baseline repair plan (completed below)

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

## Executed repair evidence (2026-10-29)

Review identity: baseline restoration `9b03e639f769502dccccff7656ba85ab4ca124e8`,
with production still identical to main
`bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. The repaired
`packages/db/src/query/effect.ts` has SHA256
`b9ea784afe07e156507079224885c73bd21e8633116c3344af809c09971b0879`.
The owner retains the restoration fingerprint above. No model, history,
recorder, comparison, reach requirement, or run budget changed after RED.
This record accompanies the production repair in PR #2301.

### Law, diagnosis, and repair

An Effect update describes a changed row that stays in the result. For a
preloaded LEFT join with a matched row and an unmatched anchor, startup owes
only the two entering occurrences. It owes no update for an intermediate
unmatched occurrence that never entered. The public Effect guide's delta
sections and `DeltaEvent.previousValue` establish this judgment independently
of the graph output.

The original classifier treated any insert plus delete as an unordered update.
Startup emits and retracts an intermediate unmatched row within one graph run.
Its inserted and deleted scalar projections are equal. The callback nevertheless
received that row as an update, followed by the two legitimate enters.
The update's previous and current values were identical, with all right fields
undefined. The independent before/after model rejected the extra event and the
absence of its prior enter in both callback channels.

The repair applies the existing `deepEquals` update condition to unordered
Effects too. Ordered Effects already use this condition. It preserves genuine
changed-value updates without retaining every unordered result row. Equality
uses the existing change-event equality domain, not D2 hash identity.
This evidence checks scalar projections, not every value in either domain.

The earlier Effect examples lacked this exact startup delta comparison. The
restored owner checks the complete emitted delta and active key intervals,
rather than inferring correctness from final rows or selected event counts.
No missing-input hypothesis remains for this witness: both source Collections
finish preload before Effect creation, and the correct matched and anchor
enters arrive in the same startup ledger as the extra update.

### Results

The pre-edit inventory comprises structured and functional projections through
actual core `createEffect`, with onBatch and named handlers. Single sources,
LEFT joins and both populated-union orders receive the same source model.
There is no real-provider or framework claim requiring another receiving host.
The unchanged-production neighboring run preceded the production edit.

| Run | Passed / failed tests | Declared reach | Passing checkpoint comparisons |
| --- | --- | --- | --- |
| Unchanged production RED | 152 / 64 | All 5,512 cells: count 1 each | 2,692 / 2,756 |
| Repaired owner GREEN | 216 / 0 | All 5,512 cells: count 1 each | 2,756 / 2,756 |
| Original production restored as mutant | 152 / 64 | All 5,512 cells: count 1 each | 2,692 / 2,756 |
| Suppress all unordered updates mutant | 16 / 200 | All 5,512 cells: count 1 each | Later changed-value comparisons fail |
| Final restored repair plus neighboring suites | 1,906 / 0 | Effect cells unchanged: count 1 each | 2,756 / 2,756 Effect comparisons |

The 200 native histories comprise 8 single-source, 64 LEFT-join and 128 union
histories. The other 16 tests calibrate the shared judgment. Both structured and
functional LEFT-join startup cuts fail in RED. Every later cut continues and
passes, so startup failure does not hide settlement or next-use evidence.
The original mutant restores the entire production file byte-for-byte to the
baseline and reproduces the same startup assertion failures. The second mutant
requires `publishedRows` for updates, wrongly dropping all unordered updates.
It fails the intended changed-value comparisons in all 200 native histories.
Both outcomes are assertion failures at the shared comparison, not setup errors
or timeouts. Neither mutant remains in the source.

Neighboring suites pass 1,690 tests both before and after the production edit:
`effect.test.ts` (74), `effect-disposal-oracle.test.ts` (12), and
`query/virtual-row-fields-oracle.test.ts` (1,604). These retain skipInitial,
previous values, object-valued Set updates, source failure, ordered Effects,
disposal and root metadata observations within their existing bounds.
The baseline remote DB-1 job also fails the same 64 startup cases:
[run 40930211146](https://github.com/TanStack/db/actions/runs/40930211146/job/123646325441).

All local tests use Node 24.19.0 and installed Vitest 3.2.4 on macOS arm64.
The manifest requests Vitest 4.1.12. No dependencies or lockfiles changed.
Full builds remain unrun by maintainer instruction.

Commands run from `packages/db` using the worktree's installed binary:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 ../../node_modules/.bin/vitest run \
  --coverage.enabled=false tests/query/virtual-row-fields-effect-oracle.test.ts

../../node_modules/.bin/vitest run --coverage.enabled=false \
  tests/effect.test.ts tests/effect-disposal-oracle.test.ts \
  tests/query/virtual-row-fields-oracle.test.ts

TANSTACK_DB_ORACLE_STATISTICS=1 ../../node_modules/.bin/vitest run \
  --coverage.enabled=false tests/query/virtual-row-fields-effect-oracle.test.ts \
  tests/effect.test.ts tests/effect-disposal-oracle.test.ts \
  tests/query/virtual-row-fields-oracle.test.ts
```

Each executed command also uses default and JSON reporters. Full logs and JSON
reports remain in `/private/tmp/effect-startup-delta/` under `baseline-red`,
`baseline-neighbors`, `repaired-green`, `repaired-neighbors`, `original-mutant`,
`overcorrection-mutant`, and `final-green`. The finite owner reports every named
reach cell, so the table's count 1 applies to each lane/channel/cut separately.
It does not aggregate away a missing path. No random seed applies to this
exhaustive finite grammar. Running the whole owner reconstructs every witness.

### Self-review against the oracle rubric

The accepted chunk-16 audit remains applicable to the unchanged owner. This
follow-up adds executed evidence on the restored baseline and repaired source.
The review here is a self-review, not a fresh independent review.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001 | Public delta law and bounded closure are stated above. |
| ORC-002 | Independent source projection and array differencing remain unchanged. No production classifier computes expected deltas. |
| ORC-003 | Restored literate owner keeps contract, model, grammar, driver and comparison together. |
| ORC-004 | All 200 finite histories run. Accepted reconstruction, ablation, range and exclusion controls remain unchanged. |
| ORC-005 | Actual core Effect callbacks supply both ledgers at every action cut. Preloaded inputs and complete startup output resolve the concrete input-sufficiency question. |
| ORC-006 | Original and overcorrection mutants fail the intended comparisons. All 16 checker controls pass on repaired production. |
| ORC-007 | Not triggered by a random property. This grammar exhausts its finite domain and has direct reconstruction. |
| ORC-008 | No reference-model state changes. Existing source visibility and active key intervals retain their accepted distinguishing actions. |
| ORC-009 | Existing source rows, optimistic state, source origins and active event-key intervals retain their documented mapping. |
| ORC-010 | Primary and cleanup errors remain distinguishable through the shared cleanup wrapper. The owner continues after mismatches and drains after disposal. |
| ORC-011 | No new concrete shared semantic fault requires a second formulation. The matched/unmatched startup result follows directly from the public delta contract. |
| ORC-012 | This versioned record identifies baseline and repaired source fingerprints, results, limits and every requirement. |
| ORC-013 | Equal intermediate startup values distinguish suppression. Later changed values, both settlements and next use reject suppress-all-updates. |
| ORC-014 | No real-provider or framework handoff claim. Sources are controlled core Collections. |
| ORC-015 | Every one of the 5,512 declared cells reaches count 1 in RED, GREEN and both mutant runs. |
| ORC-016 | The restored owner contains shared model/driver comparisons and checker calibrations. No independent expected-answer regression was added. |

### Closure and remaining limits

P09 is repaired within this contract × history × production-path × observation
boundary: exact scalar deltas for eager preloaded core Effects, the 200 stated
histories, both projection forms and both callback channels, at every declared
action cut. No known counterexample remains inside those exercised cells.
This does not establish arbitrary join multiplicity or scheduling, changing join
keys, same-source overlap, ordered repair, real providers/frameworks, or
callback-input sanitization. P10, P11/P12 and the other deferred runtime,
retention and public-type findings remain open under their existing owners.
No broader metadata or general delta-classifier closure follows.

## Subsequent prep-pr review

Review of `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba` found a newly exposed
factorial object-Set comparison path. The [Set-work repair](set-equality-work.md)
records its independent model, pre-edit RED, receiving paths, GREEN and mutants.
The scalar startup owner's native model and histories still pass all 216 cases.
Its separate opaque-key calibration repair is recorded below; startup and work
evidence alone would not close that test-integrity gap.

### Key-interval checker calibration

CodeRabbit review `5703351893` on `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba`
identified a compound-fault calibration. The `key-collision` and `key-change`
controls changed only batch keys. Named callbacks retained their original keys,
so cross-channel disagreement rejected the ledger even without the interval
judgment. The checker still enforced continuity; these controls did not isolate
it. ORC-006 requires sensitivity at the intended judgment.

The maintainer accepted this repair. Both controls now put the same bad key in
the matching named entry. `events()` constructs named entries directly from the
batch, preserving their order. No production behavior, independent model,
native history, assertion, exclusion, run budget or reach requirement changed.

Before repair, deleting the interval judgment leaves both controls passing:
the checker mutant survives. After coherent mutation, that deletion causes
exactly two expected-to-throw assertion failures. Removing only the key-stability
assertion from the full repaired owner gives **214 passes and those same two
failures**, with zero skipped tests. Cross-channel agreement therefore cannot
substitute for continuity enforcement.

The repaired owner passes all **216 tests**. Combined equality, Collection/Effect
receiving, proxy-revert and startup checks pass **619/619**. All 5,512 startup
reach cells still count 1; Set-work reach is unchanged. Targeted TypeScript,
ESLint, oracle lint and formatting pass. Tests use at most two workers; no full
build ran. Other applicable rubric outcomes above remain unchanged.

This is a test-integrity repair with a checker mutant, not a new production RED.
These update faults calibrate continuity for a live occurrence. They do not
independently mutate the distinct-key condition on a fresh enter, or establish
arbitrary graph, provider, framework or rich named-callback coverage.

The restoration and execution fingerprints above remain historical evidence.
The current owner intentionally changes only key-fault setup and its explanation.
Its SHA256 is `56de9e93892c6a4772f71846e25fc9e3700359b2cadbe3d6d9b359d7b9bcd46f`.
Review identity is parent `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba` plus that
fingerprint and the Set-work fingerprints. The combined command is recorded in
the Set-work review. Raw checker variants, reports and logs remain under
`/private/tmp/effect-startup-delta/prep-pr/key-calibration/accepted-cr1/`.
