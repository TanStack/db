# Observer row-container sharing evidence

This independent PR starts from upstream main at
`15d2d2d328db6f5a4ea0f1a48528c6c5137a1716`. It contains no Angular source or
framework-version change. Observer source SHA-256:
`abb037706e51c05174cb61170afc314f4ac804f611d8da4bc6b7edc6bc20e120`.
The primary owner is `live-query-observer-snapshot-oracle.property.test.ts`.

- **Law:** metadata-only status/health changes replace the full snapshot while
  retaining its data array and lazy state Map. Writes still replace containers,
  and retained snapshots keep their capture-time rows. The maintainer approved
  this optimization on 2026-11-01; LiveQuerySnapshot documents the new guarantee.
- **Reach:** `live-query-observer.row-container-sharing` executes 12 shared
  examples and 40 generated histories per fixed/random campaign. Both campaigns
  reach status-only and health-only transitions in 52 histories each. The fixed
  campaign reaches attached/detached 26/26, granular/wholesale 31/21, empty rows
  in 11 histories, and same-key value writes in 40. Read order varies between
  data-first and state-first. Every history becomes ready before health reports.
- **RED:** from `packages/db`, run
  `../../node_modules/.bin/vitest --run --coverage.enabled=false tests/live-query-observer-snapshot-oracle.property.test.ts -t 'metadata snapshots'`
  with unchanged production. Both campaigns reject a fresh empty array at the
  loading-to-ready transition; fixed seed 1101, shrink path `0:0:0:0`.
  A first fixture attempted health reporting before readiness and failed setup;
  the grammar was corrected with a legal readiness prefix before recording RED.
- **GREEN:** the observer ordinary/history/hydration/retained-snapshot suites
  pass 100 tests. The unchanged Angular adapter also passes 89 tests with one
  existing TODO against this observer. ESLint, oracle lint, focused TypeScript,
  private-member mangle validation, and package build pass on the independent
  branch with Node 24.8.0 and pnpm 11.1.0. The documentation snippet check reports
  no new failures across 804 examples. Full-workspace pnpm test is not claimed.
- **Mutant:** reusing containers solely by row count fails on two writes to key
  `a`: the second value stays stale despite unchanged membership (seed 1101,
  path `0:0:1:2`). The shared model's row assertion rejects it. The final code is
  restored and the same oracle passes. Earlier point-in-time calibration also
  rejects a getter that reads current Collection rows instead of captured rows.
- **Limits:** the new lane covers synchronous direct Collections, zero through
  three string-keyed rows, both observer modes and attach states. Existing
  ordered/findOne histories and hydration tests protect neighboring behavior;
  order-only changes retain the existing observer layout witnesses. No new
  framework, browser-rendering, SSR-scheduler, or external-provider claim.

## Implementation and release impact

One bounded row cache contains captured entries, their array, and a lazy Map.
Full snapshots capture that cache rather than forwarding through old snapshots,
so metadata updates neither rebuild row containers nor retain an unbounded chain
of full snapshots. Unchanged entry recaptures preserve identity. When a row
revision is unchanged, entry comparison still notices layout-only changes and
supports the existing revisionless-input path. Value-only writes cannot hide
behind layout identity. The private-member mangle cache includes the new field.

The size comparison reports db +28 gzip bytes and -21 brotli bytes against the
same upstream production source. The one row cache is necessary to preserve a
lazy Map without forwarding chains; the entry-update branch was simplified
alongside it. Tests and this evidence are development-only. A patch Changeset
releases the shared observer optimization independently of the Angular PR.

The Angular branch separately projects row-state identity before copying its
Map. Both changes together were tested through Angular's generated metadata
receiving histories before the split. That integration evidence does not turn
this core-only PR into a framework contract: Angular's independent PR owns its
receiving behavior and can merge in either order.

## Oracle rubric assessment

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Maintainer-approved structural sharing and the LiveQuerySnapshot contract; limits above. |
| ORC-002 | The existing key/version model changes only on writes; metadata references are compared through a metamorphic relation. |
| ORC-003 | Contract prose, modelRows, grammar, real observer driver, and checkRead remain visible in the existing owner. |
| ORC-004 | Shared examples reconstruct metadata, empty rows, and same-key updates. Removing mode, attachment, cardinality, read order, or action kinds loses a distinct cache/laziness path. Health reports before readiness are excluded by the prefix. |
| ORC-005 | Actual observer getSnapshot before/after each metadata or write receipt, followed by retained-snapshot reads. |
| ORC-006 | Unchanged production and the same-cardinality mutant fail at the intended reference/value checks. |
| ORC-007 | Fixed seed 1101 and unseeded campaigns use identical examples, grammar, budget, and checker; shared replay variables select the property and shrink path. |
| ORC-008 | No production cache state is mirrored; the model retains only key/version rows. |
| ORC-009 | Snapshot explicitly projects data/state across direct and virtual query rows; glossary terms are preserved. |
| ORC-010 | finishHistory preserves primary and cleanup failures. |
| ORC-011 | No additional named shared semantic fault; retained old snapshots independently reject in-place Map mutation. |
| ORC-012 | This record identifies the production source and independent branch boundary. |
| ORC-013 | Metadata transitions require sharing, while same-key value writes require replacement. |
| ORC-014 | Core-only synchronous Collection boundary; no unverified host/provider transfer is claimed. |
| ORC-015 | Eight declared reach states, including metadata transitions and value-only changes. |
| ORC-016 | Fixed and generated histories use the same model and comparison; ordinary examples remain in the ordinary test file. |


## 2026-11-03: review repairs and smaller production cache

This entry supersedes the original reach counts and size measurements above.
The reviewed working tree starts at PR head
`62d15faa1295671b176b7736118d29a4865c805a`. SHA-256 identities for this revision:

- Observer: `047ddcb95c44eed8338c2cb7d3e6e38e18cddbd6b0132c52d740f8dd5a7c71f2`.
- Snapshot oracle: `6aa5be1bdc005ed5d2001cb3ef0c52b8dff005d4937eb56cbefae518d70519e8`.
- Replay manifest: `ff0f9da90a4ee739e2664dd4185eb67bc999ee45f02b6e6c9f5eb1302b9609a3`.

### Law, repair, and pre-edit gate

The authority remains the maintainer's 2026-11-01 row-container decision and
`LiveQuerySnapshot`. Within one row revision, status/health updates preserve
both containers. Value writes replace them. Subscribe/unsubscribe changes
observer ownership without changing rows or ending the sync run. Cleanup/reset
can discard a row revision, even for an empty Collection; sharing across that
boundary is not promised. The interface now states that limit explicitly.

The old sharing grammar chose attachment once. It could not reconstruct a
ready detached read followed by attach and a health report. Unconditionally
replacing cached entries therefore survived all 14 tests in the old snapshot
owner. The extended grammar includes subscribe/unsubscribe. Its shared examples
force nonempty attach, detach, and reattach in both modes. Repeated subscription
actions are idempotent in this single-subscriber driver. Every action ends with
a public snapshot comparison, and retained snapshots are read again at the end.

The old health-only reach classifier counted loading-to-ready when the health
tree identity also changed. The new classifier requires unchanged status and
rows. An independent failure-list model checks health freshness and predicts
the exact number of report/clear transitions. The shared comparison checks that
count against observed health-only transitions. Twelve readiness-only examples
exercise the exclusion through the same driver and judgment as every other
history. The other twelve examples exercise ownership transitions and health.
Health reports before readiness remain excluded by the legal readiness prefix.

Before editing production, the expanded oracle and neighboring observer suites
passed all 100 tests on the PR implementation. The unchanged original observer
and the attachment and reach-classifier mutants then failed the expanded
comparison. Thus the test path and neighboring guarantees were established
before simplifying production.

### Reach

Each fixed/random campaign runs 24 shared examples plus 40 generated histories.
Seed 1101 remains the fixed seed. The grammar, budget, examples, driver, and
comparison are identical across campaigns. All declared states must occur in a
fixed example as well as meet their minimum count of one history.
The final five-suite normal run recorded:

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| attached | 49 | 49 |
| detached | 49 | 49 |
| granular | 37 | 38 |
| wholesale | 27 | 26 |
| empty | 15 | 21 |
| health-only | 34 | 39 |
| status-only | 64 | 64 |
| value-only | 35 | 30 |
| attach-granular | 15 | 11 |
| attach-wholesale | 6 | 8 |
| detach-granular | 16 | 12 |
| detach-wholesale | 8 | 7 |
| reattach-granular | 8 | 7 |
| reattach-wholesale | 5 | 5 |

Counts are histories entering a state, not action counts. Attachment reaches
require a nonempty result. Health-only reach excludes writes and status changes.
The separate per-history transition-count assertion also rejects a readiness
transition being counted as health-only. The original 52/52 health-only counts
included readiness and must not be cited as measured health-only evidence.

### RED, mutants, and direct replay

From `packages/db`, the normal sharing command is:

```sh
pnpm exec vitest run tests/live-query-observer-snapshot-oracle.property.test.ts --coverage.enabled=false -t 'metadata snapshots'
```

All four controls below fail assertions at the intended comparison, rather
than failing setup or timing out:

- **Original implementation RED:** observer source from merge-base
  `15d2d2d328db6f5a4ea0f1a48528c6c5137a1716` fails `metadata keeps data` at
  loading-to-ready. Seed 1101, path `0:0:0:0`, reduced input: granular, detached,
  empty rows, state-first, commands `[report]` after the readiness prefix.
- **Attachment mutant RED:** replace cached entries unconditionally while
  retaining the original dirty-flag condition. Seed 1101, path
  `2:3:1:6:4:3`, reduced input: granular, detached, one row, state-first,
  commands `[subscribe, report]`. The fresh health snapshot exposes replaced
  row containers and fails `metadata keeps data`. This is the mutant that
  survived the old owner. It also fails guarded replay with one executed
  property and one failed witness.
- **Same-cardinality mutant RED:** replace the row cache only when its length
  changes. Seed 1101, path `0:0:1:0:2`, reduced input: granular, detached, empty
  rows, state-first, commands `[write, write]`. The second write leaves version
  zero visible when the model requires one; `step 2: state rows` rejects it.
- **Reach-classifier mutant RED:** remove the unchanged-status condition.
  Seed 1101, path `0:0:0:0`. The model expects one health-only transition,
  while the observation counter records two; the transition-count comparison
  rejects the extra readiness credit.

The guarded owner/selector repair is checked with:

```sh
TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.row-container-sharing \
TANSTACK_DB_ORACLE_SEED=1101 TANSTACK_DB_ORACLE_PATH=2:3:1:6:4:3 \
node --import tsx tests/oracle-replay.ts tests/live-query-observer-snapshot-oracle.property.test.ts --coverage.enabled=false
```

This command runs only the requested random campaign: one test passes, thirteen
are skipped, and the wrapper records `executions: 1`, `numRuns: 1`, and
`failed: false` after restoration. With the attachment mutant, the same command
records `failed: true` and rejects the same identity violation. Using
`node --import tsx` avoids the CLI's sandbox-restricted IPC listener.

### GREEN and production size

The row cache now supplies the previous ordered entries for layout comparison.
This removes `lastLayoutKeys` and its allocation. Metadata-only rebuilds skip
key scanning when the capture is unchanged. The snapshot's state getter lazily
fills the shared row cache directly, removing the second getter and closure.
The single entry-comparison call is inlined, entry capture returns its array
without a redundant result wrapper, and identical notification capture branches
are combined. Both removed private names leave the mangle cache.

The last materialized row cache is an immutable ordered capture. It supplies the
same key sequence that the removed key array held. Value-only writes retain
layoutRevision; membership and order changes advance it. The initial empty
capture still advances it once. Older snapshots retain their own cache, with no
chain of snapshot references. No contract or model expectation was weakened to
permit these reductions.

Validation on the restored final source:

- Five observer suites: **112 tests pass**, including ordinary layout/order,
  hydration, retained-snapshot, health, and history checks.
- Replay-manifest checks: **6 tests pass**; the new guarded replay also passes.
- Focused TypeScript compilation and ESLint, minified package build, `pnpm check:mangle`
  (436 names), `pnpm test:minified-db`, and `pnpm lint:changed` pass.
- Two independent follow-up reviewers found no new actionable issue in the
  oracle repair or layout/cache simplification.

`pnpm size:compare --packages db --files` compares against the same merge-base,
with production defines and identical minification/compression:

| Measurement | Delta from original baseline |
| --- | ---: |
| Observer module, minified | -75 bytes |
| DB export bundle, gzip | -34 bytes |
| DB export bundle, brotli | -111 bytes |
| Typical app, gzip | -27 bytes |
| Typical app, brotli | +79 bytes |

All eight measured app scenarios decrease in gzip by 26–30 bytes. Brotli
scenario deltas vary from -117 to +79 bytes; the reduction is not universal
across compressed applications. This is net-negative shipped observer code and
DB package bytes, without relying on source comments or formatting.

### Limits and rubric update

The closure boundary is metadata sharing across legal same-run row, readiness,
health, and single-subscriber attachment histories at the synchronous direct
Collection's post-action snapshot cut. Zero through three initial string-keyed
rows and same-key writes are covered. The existing query/retained and hydration
owners still cover their stated paths; this lane adds no framework scheduling,
SSR, provider, arbitrary subscriber concurrency, cleanup/restart sharing, or
universal performance claim. Layout/order-only behavior retains its ordinary
observer witnesses; the new lane additionally checks layout stability on
metadata and value-only writes and advancement on insertion.

The original ORC table remains applicable with these corrections: ORC-004 now
reconstructs attachment transitions and readiness-only exclusion; ORC-006 adds
the attachment and classifier kills; ORC-007 adds the guarded owner and selector;
ORC-015 now has fourteen states with fixed-example reach. ORC-008's only new
model state is the failure list and its transition count: report/clear actions
can distinguish clear from nonempty failure frames, independently of row state.
ORC-010 retains `finishHistory` for primary failure and cleanup fidelity.
ORC-012 uses this source-identified append-only record. ORC-013 distinguishes
unchanged rows across attach from changed values with identical keys. ORC-014
remains explicitly core-only, so it transfers no controlled premise to a host.
ORC-016's readiness-only and attachment regressions are inputs to the shared
model and checker. ORC-001/002/003/009/011 retain their original evidence and
limits; no new shared semantic fault requiring a second formulation was found.

## 2026-11-03: equal-revision capture and ten-finding review

This entry supersedes earlier statements about equal-revision entry comparison,
reach, and size. The external review covered PR head
`e02e09c70ada77d5bbc52b51ebcdd4ee801fe028`. The repair is identified by these
SHA-256 source identities, so a later documentation commit cannot obscure the
tested implementation:

- Observer: `ef53f61c31e43ee6a35d48fbf19024c98ee6890c17954a3eecf60359ba378cef`.
- Snapshot oracle: `89dd68d82c8d355b63ea10aa5f111537fc0e974600456c91d9cdb1743ed411c9`.
- Replay manifest: `df193e11916eacb35c2ff980cc481a6464b61ff1e60308bfc7eee306009acec1`.

### Law, experiment, and inference

The authority remains `LiveQuerySnapshot` and the maintainer's 2026-11-01
sharing decision. Unchanged public rows preserve containers across metadata
and same-run ownership changes. Changes to values or ordered keys remain
visible. An action that changes no public fact also preserves full-snapshot
identity. Retained snapshots continue to expose their captured rows.

The reviewed code compared wrapper identities even when the Collection's row
revision was unchanged. An equal-content sync write can discard a virtual-row
wrapper without advancing that revision. A later granular attachment captured
the new wrapper. A health report then exposed newly allocated containers for
unchanged rows. The old grammar had no equal-content source write, and its
sharing assertions omitted full-snapshot identity on no-op actions.

Before any production edit, the primary owner gained a generated `refresh`
action and no-op identity comparison. A second driver in that same owner added
real ordered projection and findOne paths, provisional hydration-seed handoff,
optional row-clock absence, and rank-only source writes. It uses the existing
`modelRows` and `checkRead` judgment. Source ranks independently determine order
but are absent from the selected public Row. The independent version map changes
only on value writes. Both maps are necessary: a move distinguishes equal
versions at different ranks, while a value write distinguishes equal ranks.

The initial receiving fixture supplied an invalid two-row seed to findOne. It
was corrected to one selected row before the production gate. That setup failure
is not RED evidence. The corrected receiving campaigns passed on unchanged
production. The six-suite pre-edit gate recorded 116 passes and two failures,
both at the sharing comparison described below, with no type errors.

The repair uses the captured row and layout clocks together for revisioned
inputs. Equal clocks preserve the existing capture despite re-enriched wrappers.
A changed layout clock still replaces the capture on an order-only move. Only
inputs without the optional row clock need key/value identity comparison.
Queued delivery uses the clocks captured with its entries. The update method
stores both clocks and sets the dirty flag, removing redundant assignments in
detached refresh and attachment. No expectation or run budget was weakened.

### Reach and grammar controls

The sharing property retains 24 examples plus 40 generated histories in each
campaign, fixed seed 1101. Its added `refresh` action reconstructs the reported
trace and can cross reports and arbitrary attachment changes. Its bounds remain
zero through three initial rows and at most twelve suffix actions. Equal writes
change no model fact. A legal readiness prefix excludes health reporting before
readiness. Removing refresh loses wrapper re-enrichment; removing ownership
transitions loses its later recapture; removing the no-op assertion admits the
snapshot-cloning mutant below. Existing axes retain their prior justification.

The capture-path property runs 16 examples plus 40 generated histories in each
campaign, fixed seed 2346. It generates two or three rows, string keys a..c,
and at most twelve actions. The two-row case is the smallest order-only witness;
three rows challenge a larger reordered tail. A move changes rank between -1
and 100, crossing the other rows. Rank ties and invalid multirow findOne seeds
are outside this grammar. Removing query shape loses the single-result
projection, mode loses a subscription path, clock absence loses structural
fallback, hydration loses seed/live capture separation, and read order loses
one lazy Map path. Move, write, refresh, metadata and ownership actions each
distinguish a neighboring layout, row, identity or attachment rule.

Checks follow each direct Collection action or the real query's queued
publication, then reread every retained seed/live snapshot. The query driver
checks row values/order, state/data identity, full-snapshot no-ops,
layoutRevision and health freshness. Its task-boundary wait is calibrated by
the order-only mutant, which reaches and fails that post-publication comparison.
It establishes no intermediate-publication timing guarantee.

Every declared state must also occur in a shared example. Counts below are
histories, from the final normal run on restored production:

| Sharing state | Fixed | Random |
| --- | ---: | ---: |
| attached | 51 | 50 |
| detached | 45 | 44 |
| granular | 37 | 31 |
| wholesale | 27 | 33 |
| empty | 15 | 20 |
| health-only | 34 | 34 |
| status-only | 64 | 64 |
| value-only | 34 | 31 |
| attach-granular | 13 | 11 |
| attach-wholesale | 8 | 11 |
| detach-granular | 12 | 8 |
| detach-wholesale | 10 | 10 |
| reattach-granular | 6 | 7 |
| reattach-wholesale | 5 | 8 |
| noop-granular | 37 | 26 |
| noop-wholesale | 27 | 31 |
| equal-revision-reenrichment | 30 | 23 |

| Capture-path state | Fixed | Random |
| --- | ---: | ---: |
| ordered-granular | 13 | 12 |
| ordered-wholesale | 16 | 14 |
| single-granular | 17 | 19 |
| single-wholesale | 10 | 11 |
| revisionless-granular | 14 | 17 |
| revisionless-wholesale | 12 | 13 |
| hydrated-ordered | 12 | 13 |
| hydrated-single | 17 | 14 |
| layout-only-granular-attached | 4 | 3 |
| layout-only-granular-detached | 2 | 3 |
| layout-only-wholesale-attached | 3 | 2 |
| layout-only-wholesale-detached | 5 | 3 |
| metadata-ordered-granular | 6 | 10 |
| metadata-ordered-wholesale | 9 | 8 |
| metadata-single-granular | 12 | 13 |
| metadata-single-wholesale | 5 | 9 |

### RED, GREEN, and calibration

From `packages/db`, the six-suite gate command is:

```sh
pnpm exec vitest run tests/live-query-observer-snapshot-oracle.property.test.ts tests/live-query-observer-history-oracle.property.test.ts tests/live-query-observer-hydration-oracle.property.test.ts tests/live-query-observer.test.ts tests/live-query-observer-snapshot.test.ts tests/live-query-order-only-move.test.ts --coverage.enabled=false --maxWorkers=2
```

- **Parent RED:** reviewed observer e02e09c70 fails `metadata keeps data`, seed
  1101, path `2:4:5:6:8:5`. Reduced history: granular, detached, one row,
  state-first, `[refresh, subscribe, report]` after readiness. This is also the
  original-defect mutant, rerun after repair and rejected at the same comparison.
- **Narrow-repair mutant:** ignore the layout clock while trusting the row
  clock. The new capture-path checker rejects stale ordered rows after one
  `move`: ordered, granular, revisioned, unhydrated, two rows, state-first.
  Seed 2346, path `0:2:0:1:1:0`. This distinguishes the repair from a patch
  that fixes wrapper churn but loses layout-only changes.
- **No-op mutant:** return a fresh shallow full-snapshot object on every read.
  It passes the original sharing lane. The extended lane rejects it at
  `no-op keeps snapshot`, seed 1101, path `0:0:1:0:0:0:2`, granular, detached,
  empty, state-first, `[healthy, report]` after readiness.
- **Repaired GREEN:** restored production passes all 118 tests in the six
  suites, with no reported type errors. The intended comparisons, not a setup
  error or timeout, reject all three mutants. No mutants remain installed.

Both recorded production failures were also checked through guarded direct
replay. Each runs exactly one random property witness: it fails with its
mutant and passes with repaired production. Substitute the capture-path
property, seed 2346 and path `0:2:0:1:1:0` for the second replay:

```sh
TANSTACK_DB_ORACLE_PROPERTY=live-query-observer.row-container-sharing \
TANSTACK_DB_ORACLE_SEED=1101 TANSTACK_DB_ORACLE_PATH=2:4:5:6:8:5 \
node --import tsx tests/oracle-replay.ts tests/live-query-observer-snapshot-oracle.property.test.ts --coverage.enabled=false
```

### Lossless review dispositions

The user supplied ten findings in source order. The task-local ledger preserves
their exact text and initial experiment plan. This table preserves each claim's
judgment, action and useful remainder without merging overlapping IDs.

| ID | Claim and evidence | Disposition and action | Durable value |
| --- | --- | --- | --- |
| HR-01 | Equal-revision re-enrichment invalidates containers. Parent RED and guarded replay confirm it. | fixed-now: authoritative row/layout clocks preserve unchanged captures. | Generated refresh/attachment/metadata histories and declared reach. |
| HR-02 | The sharing lane omitted layout-only, revisionless, hydration handoff and findOne paths. Existing neighboring tests did not cross the changed identity law. | fixed-now: capture-path driver adds each boundary before production edits. | Real-query receiving comparison, sixteen reach states and narrow-mutant kill. |
| HR-03 | Metadata snapshots share mutable JS containers. The probe confirms sharing. Calling Map.delete through a cast affects the peer. | accepted-design: LiveQuerySnapshot and window snapshots expose ReadonlyMap/ReadonlyArray. Caller mutation violates that API, while same-revision sharing is explicitly approved. | Retained-snapshot checks reject production mutation. Runtime freezing or hostile caller isolation is a separate API proposal. |
| HR-04 | Ordered-key and key/value loops look similar. | refuted as a useful shared semantic helper: layout depends only on ordered keys, while revisionless capture also depends on values. Keep the short separate comparisons. | Value-only histories require stable layoutRevision. The clock repair removes the second loop entirely for revisioned sources. |
| HR-05 | Detached refresh redundantly sets snapshotDirty after captureEntries. | fixed-now as simplification. No independent wrong public result was demonstrated. | updateCachedEntries owns capture invalidation and both clocks. |
| HR-06 | The two capture references differ only during hydration. A probe finds them different after an ordinary published value write before getSnapshot. | refuted: cachedEntries is the live capture and cachedRows.entries is the last materialized visible capture. They reference arrays, rather than duplicate them. | Preserve pending materialization and seed/live distinctions when simplifying. |
| HR-07 | Equal-clock captures add a linear key/value scan. A deterministic tuple-value probe records 3n reads before and n after, at n=1/8/32. | fixed-now: revisioned comparison uses clocks. Entry capture itself remains O(n), so the total path did not change from O(1) to O(n). | Work-count evidence separates redundant work from an asymptotic or elapsed-time claim. |
| HR-08 | No-op full-snapshot identity was unasserted. The cloning mutant passes the old lane and fails the extended one. | fixed-now: shared comparison checks ownership and repeated metadata no-ops. | Generated no-op actions and reach in both modes. |
| HR-09 | Fixed-history attribution could count shrink/replay runs as examples. | refuted for installed fast-check 3.23.2: examples run first, a failed campaign throws before aggregate reach, and path replay disables aggregate reach. | Successful, failing, shrinking and replay probes preserve the assumption. A code comment documents it. |
| HR-10 | Window data/pages are recopied on metadata. A real window-controller probe confirms fresh arrays and shared state. | accepted-design under this PR's observer-only promise: its Changeset explicitly names live-query observer containers. The infinite contract requires page contents and metadata, not page-array identity across metadata. | Window page sharing remains a separate potential optimization. No infinite-container sharing claim is made here. |

Loss audit: **10 = 5 fixed-now + 3 refuted + 2 accepted-design**. There are no
deferred items, unresolved in-scope defects, or new sibling violations from
these experiments. The reviewer found a real subtle bug and two useful coverage
gaps. Several correctness labels instead described approved sharing, a redundant
assignment, or an unpromised downstream optimization. The work claim needed
asymptotic qualification. Recommendation: hire with reservations for adversarial
review, with a second reviewer for contract interpretation and prioritization.

### Production size and remaining limits

`pnpm size:compare --packages db --files` uses merge-base
`15d2d2d328db6f5a4ea0f1a48528c6c5137a1716`, matching production defines and
compression. Observer minified bytes decrease by **99**, DB gzip by **40**,
and DB brotli by **97**. The typical app decreases by 32 gzip bytes and
increases by 11 brotli bytes. All eight app scenarios decrease by 31–57 gzip
bytes; brotli deltas range from -78 to +125. Compression reductions are not
universal across applications.

The closure boundary is observer row sharing and no-op identity across the
declared direct-Collection and real-query histories, at the named snapshot cuts.
Existing queued listener, hydration-error and retained-snapshot owners protect
neighboring promises. The optional-clock seam stays within one DB instance.
This does not claim multiple-copy interoperability, arbitrary concurrency,
intermediate query publications, framework rendering, external-provider timing,
cleanup/reset sharing, runtime protection against caller mutation, or infinite
page-array identity. No accepted in-scope counterexample remains.

The ORC requirements retain prior evidence with these updates: ORC-001/002/003
use the same authority, independent version/rank model and visible shared
judgment; ORC-004 controls appear above; ORC-005 has real-query receiving paths
and explicit post-publication checks, with no concrete missing-input hypothesis
at those cuts; ORC-006 adds three assertion failures and old-lane survival;
ORC-007 adds guarded replay for both changed properties; ORC-008/009 justify
version/rank state and the clock-absence seam; ORC-010 retains finishHistory;
ORC-011 has no new named shared semantic fault needing a second formulation;
ORC-012 uses the source identities and this append-only audit; ORC-013 separates
equal-content refresh from value change and order-only move; ORC-014 transfers
the direct premise into actual query drivers but makes no host/provider claim;
ORC-015 reports all 33 reach states; ORC-016 keeps fixed witnesses on the shared
model, production driver and comparison. No run budget decreased.

Final local verification also passes focused TypeScript compilation, ESLint,
`pnpm lint:changed`, the 41-test `tests/oracle-replay.test.ts` suite,
`pnpm --filter @tanstack/db... build:minified`, `pnpm check:mangle` (436 names),
and `pnpm test:minified-db` (113 error names plus index/query/live-update checks).
The full workspace suite did not run locally. CI for the follow-up head must be
checked separately; previous-head CI is not evidence for this semantic change.
