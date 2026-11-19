# Convex lazy baseline neighbor gate

This record covers new controlled receiving tests before the second production
repair. It does not approve a production repair or close persisted-prefix work.
The independent enforcement reviewer approved oracle `6c225af0`, driver
`2ab9dfdb`, helper `d7c89a88`, log `9609a8e6`, and evidence `d1614b13` in this
bounded role. The persisted peer receiver has a separate pre-edit gate.

## Evidence block

- **Law:** reload keeps its accepted baseline before source evidence. A finite
  lazy answer establishes its requested prefix after actual application.
  Coherent callback revisions remain legal while prior complete proposals await
  durable handoff. An updated retained range removes its previously supplied
  keys even when its new returned bound contracts. Authority: the glossary's
  reload, source snapshot, accepted/deferred sync transaction definitions;
  `LoadSubsetFn`, `SyncAppliedReceipt`, `whenSyncAccepted`; and the Convex lazy
  pagination contract.
- **Reach:** three generated properties, each with matching fixed-seed and
  random 12-history campaigns and randomized constructed histories. The first
  property constructs all eight applied/held × equal/changed/omitting/empty
  cells. Each cell and both SDK shapes reaches its required states at least
  once per campaign. The deferred and contracted-range properties reach every
  declared state in all 12 generated histories and their construction in both
  campaigns. Their check also verifies required reach for each generated output;
  missing-state controls reject removed receiving-state observations.
- **RED:** no new semantic RED is claimed for these neighboring laws. The current
  first-attempt production satisfies them. Earlier scratch runs failed at
  fixture premises or setup and are not defect evidence. In particular, core
  permits a truncate to apply immediately despite a persisting optimistic
  transaction; the final instrument respects its actual receipt.
  The existing `lazy-paging-oracle.property.test.ts` was also rerun with this
  final driver against the same frozen production: **16 failed / 24 passed**,
  retaining the earlier unrelated-successor work counterexample. Log
  `.review-2377/lazy-baseline-existing-neighbor-red.log`, SHA-256
  `e0f5e73788666dc289163ca6ec3a0c101c187c0cf479fd05540c732acdef480c`.
- **GREEN:** from `packages/convex-db-collection`,
  `pnpm exec vitest run tests/lazy-paging-baseline-oracle.property.test.ts --coverage.enabled=false`:
  **51/51 passed**. Log `.review-2377/lazy-baseline-neighbors-first-attempt.log`,
  SHA-256 `9609a8e6ce1e3533e3ed55dcb3cca167249bba63fc587f3d42d2576e1d6f59f2`. The
  [evidence manifest](2026-11-18-convex-lazy-baseline-neighbors-evidence.json)
  pins all source/model hashes and the recorded campaign seeds.
- **Mutant/control:** the production path reaches each comparison before a
  deliberately wrong observation is supplied. The first comparison rejects an
  invented applied row. The deferred comparison rejects loss of the reinserted
  key. The contracted-range version comparison rejects a stale omitted high key
  in a public callback, even when final production rows are correct. These are
  semantic comparison calibrations, not production mutant kills. Actual source
  mutants for a later repair remain part of its separate evidence gate.
- **Limits:** controlled JavaScript/React subscription shapes and real core;
  unique finite numeric ranks, bounded strings, successful deferred acceptance,
  no commit reentry. No real SQLite, real SDK transport, unknown saved-suffix
  retention, concurrent hydration or source-suffix eviction policy is claimed.

## The instrument

The existing independent `expectedLazyRows`, `assertLazyCoverage`,
`assertLazyPublications` and `LazyVersionModel` supply the judgments.
`lazy-paging-driver.ts` adds ordinary source writes that establish a controlled
baseline. Their actual core receipts distinguish applied from accepted-held
rows. Independent keyed equality against the authored rows verifies actual
accepted baseline reach before and after reload. It also accepts an optional sync wrapper; the unchanged default path
continues to serve the older lazy families.

`lazy-paging-deferred-acceptance.ts` buffers each complete proposal before any
core `begin` or `write`. Release hands the proposals to core in FIFO order.
Acceptance and visibility have different receipts. This differs materially from
holding only `commit()` after staging writes, since such writes can already
appear in core's pending projection.

The deferred history starts from an authored full relation, then adds, updates,
deletes and reinserts an initially absent key. It also deletes and reinserts an
initially present key while every proposal remains outside core. The public
source keeps its original rows until release. Each actual source publication
then receives the shared version model, and the final exact relation comparison
runs before the separate no-error comparison.

The retained-range history initially acquires ranks 0, 1, 100 and 101 while ranks
1000 and 1001 remain unread. Its fixed bounded range then receives ranks 0–5.
The old keys at 100 and 101 are absent from that range's new authoritative
answer, although their old ranks exceed its current maximum. Generated scaling
and reversed order preserve the distinction. This is different from a newly
restored key that has never been supplied by this run's provider range.

The baseline history retires the fixture's old unfiltered source observer before
reload. A surviving observer could legitimately ask for a whole-source replay
and erase the intended finite-work premise. A fresh observer records the new
run. Actual receipts select held or immediately applied observations; no
expected hold is inferred from the presence of an optimistic transaction.

## Guide outcomes

- **ORC-001–003:** authority and controlled limits appear beside each property;
  models remain existing independent row/window/version judgments. Driver,
  grammar, judgments and promised cuts are described in the executable file.
- **ORC-004:** all eight baseline cells reconstruct the reported neighboring
  cases. Removing the held axis loses unseen accepted keys; removing omission
  loses deletion; removing empty loses exhausted absence. Removing deferred
  add/delete/reinsert loses the required presence/tombstone transitions.
  Removing the unread suffix makes contraction a full-source answer instead.
  Ranks, strings, relation size and scale are bounded. Unsupported orders and
  arbitrary source filters are excluded by the unchanged lazy grammar.
- **ORC-005–006:** real Collection controls and public base publications supply
  values, receipts and errors. Semantic wrong-observation controls reject at
  their intended comparison. No SDK/storage handoff claim is made.
- **ORC-007:** each property uses the pinned `oracleProperty` fixed/random
  campaigns and standard seed/path/unit replay. Seed is 20261118. No new
  production failure replay is claimed by this neighbor gate.
- **ORC-008–009:** no new semantic state machine is introduced. The shared
  version model retains monotone authored revisions; driver proposals map to
  complete deferred sync transactions rather than core acceptance.
- **ORC-010:** `withTestCleanup` preserves the primary mismatch and aggregates
  distinguishable cleanup errors. Releases run before Collection cleanup.
- **ORC-011:** the named strict-bound-only shared-fault hypothesis is challenged
  by the independent retained-range revision relation. Unknown saved-suffix
  authority requires the separate persisted receiving witness.
- **ORC-012–016:** this record binds a bounded instrument gate. Per-generated
  reach and missing-state controls run. Wrong observations pass through the
  shared comparisons. No ordinary unit tests, fixed expected-answer table,
  production-first repair, or universal closure claim is introduced.
