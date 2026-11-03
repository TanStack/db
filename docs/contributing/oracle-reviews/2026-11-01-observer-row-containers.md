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

The last materialized row cache is an ordered capture kept unchanged through the
readonly API; its arrays and Maps are not runtime-frozen. It supplies the
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

## 2026-11-03: nine-finding follow-up and record-shape decision

This evaluates the second high-effort review of `71bb4c659`. The task-local
append-only ledger preserves all nine raw findings and three supplementary
claims. Production and oracle repairs follow that ledger's whole-review plan.
The user approved publishing prototype changes on 2026-11-03, after discussing
cost. This changes change-event equality for record-shaped objects; it does
not revise draft reconstruction or the specialized built-in value comparisons.

### Laws, experiment, and inference

**Fresh captures.** Collection's `_deferPublication()` promises to defer delivery
while rows and indexes commit normally. `_stateRevision` promises monotonic
invalidation. A detached snapshot read during a deferral must not retain that
capture after another committed write. The old discard rewound both clocks;
a later write could reuse the cached numbers. Keeping the committed row clock
fixes value captures. When restoring a discarded layout clock, advancing the
row clock also fences the old layout capture. Failed facade flushes still
restore rows and publish neither events nor a layout revision.

The primary snapshot owner's capture-path grammar now generates `discard-write`
and `discard-move`, including one or two nested deferrals, both observer modes,
ordered/findOne projections, hydration, and optional reattachment. It captures
inside the hold, discards it, then writes again without an intervening read.
It compares public rows, containers, layout and retained snapshots after the
query's queued publication. These additions expose the real counter reuse;
assigning arbitrary numbers to private counters is unnecessary.

**Record shape.** The approved rule distinguishes plain, class and null-prototype
records even when their enumerable fields match. Fresh equal values of one
prototype still suppress changes. `live-query-observer.record-shape` models a
shape name and one numeric leaf independently of production equality. Each
history runs through both a direct Collection and a projected live query.
Records, arrays, Map values and Set members carry that nested value. Both modes
cross refresh, replacement, attachment and health. At every applied checkpoint,
`data` and `state`, and an attached granular mirror, match the model's exact
prototype and numeric value; all retained snapshots are checked again.

The utility equality owner updates the prior explicit class/plain equivalence
under this maintainer decision. Each of its 100 generated cases per campaign
reaches same-class, plain/class and null/plain comparisons, with a per-case
minimum of one for each construction. The draft-revert owner remains unchanged
and passes: a draft's serialized plain representation still reconstructs a
class instance under its separate equality domain.

**Distinct APIs.** An observer snapshot retains a row revision's capture.
Granular listeners receive raw Collection changes. Equal re-enrichment can
produce distinct objects under those two contracts; neither contract promises
cross-API reference identity. The new receiving lane enforces agreement on
shape and values, while the existing sharing lane keeps the old equal capture.
The raw-change distinction is now explicit in the observer interface.

### Evidence block

- **Law:** monotonic capture invalidation and committed reads, from Collection's
  revision/deferral API; retained snapshots and metadata sharing, from the
  existing observer contract; record-prototype publication, from the user's
  2026-11-03 decision. The architecture's failed-facade layout law is preserved.
- **Reach:** row-sharing keeps 24 examples plus 40 generated histories per
  campaign. Capture paths keep 16 examples plus 40 generated histories; fixed
  seed 2346 reaches all 27 states, including 21 nested-discard histories and
  7–14 histories in each of the eight discarded-change/mode/reattachment cells.
  Shape uses 16 examples plus 40 generated histories per campaign, each with
  both receiving drivers. Fixed seed 234602 reaches source/query granular in
  27 histories each and source/query wholesale in 29 each; plain→class and
  class→plain each reach 18, plain→null 20, and equal-shape copies 33. Record,
  array, Map and Set carriers reach 18/11/16/11. Both fresh campaigns also pass
  all declared minima and fixed-example reach. No run budget decreases.
- **RED:** on unchanged `71bb4c659` production, the five-owner pre-edit gate has
  8 assertion failures and 296 passes. The new snapshot cases reject both
  discarded value and layout captures. Seed 2346/path `0` keeps version 2 where
  version 3 is owed. Shape seed 234602/path `0:1:0:2:2` rejects plain→class with
  equal leaf 0 in **both** direct and query receiving paths. The utility owner
  rejects its newly approved shape expectation in both campaigns. Draft revert,
  facade rollback and Collection lifecycle publication pass before production
  changes. Earlier CLI-option and concurrent-coverage setup errors are excluded.
- **GREEN:** all 1,423 tests in 15 relevant suites pass, including all observer
  owners, snapshot and order-only tests, window controller, utilities, draft
  revert, facade rollback, Collection publication/reentrancy, change-message
  reconstruction and replay manifest. Focused TypeScript, ESLint, changed-file
  oracle lint, minified build/API checks and the 434-name mangle cache pass.
- **Mutant:** restoring the original Collection changes manager fails at the
  second post-discard value capture. Keeping row monotonicity but omitting the
  discarded-layout fence passes that value case and fails the following
  order comparison. Restoring class/plain equality fails both shape receivers.
  These are assertion failures at the intended comparisons. Guarded direct
  replay reproduces each clock/shape defect and passes after restoration, with
  one requested witness per replay. No mutant remains installed.
- **Limits:** one/two nested deferrals, two/three query rows, bounded generated
  actions and specified queued-publication cuts. Shape checks cover sync writes
  with keyed record prototypes and four carriers; they do not establish exotic
  built-in subclasses, descriptors, arbitrary cycles, optimistic draft
  assignment policy, intermediate query publications, or host/provider timing.
  Cleanup/reset sharing and infinite page-array identity remain outside this
  PR's promise. The new combined tree with Angular #2327 has not been rerun.

The gate runs from `packages/db` with `pnpm exec vitest run
--coverage.enabled=false --maxWorkers=2` over the snapshot, utility, draft,
facade-rollback and Collection lifecycle publication owners. The final gate adds
ordinary observer/snapshot/order/window, hydration/history, Collection reentrancy,
change-event history and replay tests. Guarded replay uses the existing
`tests/oracle-replay.ts` interface with property, seed and path. The new manifest
selector isolates `live-query-observer.record-shape`'s random test.

### Lossless dispositions

| ID | Technical verdict and evidence | Action | Durable value |
| --- | --- | --- | --- |
| SR-01 | Confirmed: a real discard/read/write history reuses clocks and retains stale rows. | fixed-now at Collection invalidation, with generated value/layout histories and two clock mutants. | Revision monotonicity must include rollback of delivery, independent of event publication. |
| SR-02 | Confirmed observation; the old equality oracle deliberately allowed it. Nested rather than root prototypes provide the actual witness. | fixed-now under the explicit record-shape decision; both source and query receivers reject the original and pass. | Keep change-event and draft equality domains distinct. |
| SR-03 | Confirmed object divergence, but no cross-API reference-identity guarantee was established. Content and virtual values agree, and raw changes match Collection reads. | accepted-design under raw granular delivery and approved per-revision snapshot sharing. Clarify the interface and enforce shape/value agreement. | Do not repair identity divergence by reintroducing equal-write snapshot churn. |
| SR-04 | Confirmed unsupported compatibility machinery: all typed inputs are concrete Collections; the original rationale was cross-copy support forbidden by AGENTS.md. | fixed-now: remove optional clocks/channel and structural fallback. | State supported inputs explicitly. |
| SR-05 | Refuted as duplicate storage: live capture and last materialized visible capture differ after ordinary writes, as well as with seeds. They are references, not duplicate arrays. | Keep both references; document their distinction. Removing unsupported fallback also removes the second comparison loop. | Preserve materialization and hydration boundaries when simplifying. |
| SR-06 | Confirmed redundant enumeration. Before/after deterministic granular attach counts are 2→1; wholesale stays 0. The remaining granular scan is subscription bootstrap. | fixed-now: check both clocks before enumerating an unchanged capture. | Preserve a fresh capture for each queued newer publication. No elapsed-time or universal complexity claim follows. |
| SR-07 | Confirmed duplicate client cache update, 2→1 at real hydration handoff. | fixed-now: queued flush applies the capture once. Existing reentrant/hydration owners pass. | Avoid pre-applying a later queued publication during listener delivery. |
| SR-08 | Confirmed ambiguous ownership wording. | fixed-now: snapshots retain a captured view and metadata snapshots may share its readonly containers. | Separate capture-time isolation from exclusive container ownership. |
| SR-09 | Partly valid: the synthetic input is unsupported. Its hidden row clock did execute the structural branch, contrary to “never run”; the remaining layout channel did not prevent that branch. | fixed-now: replace the invented axis with real initial attachment, retaining both campaign budgets and 16 examples. The ordinary fake-Collection test now checks committed writes and retained rows through a real Collection. | Executing a branch cannot establish a supported production input. |
| SR-10 | Supplementary common-cause claim overlaps SR-01/02/03, but conflates clock rollback, an intentional equality policy and an unpromised identity relation. | duplicate, with these distinctions retained. | Mechanism overlap is not shared contract authority. |
| SR-11 | The review reported 119 passing tests and no parent RED in its own run. That report is historical, not current evidence; it does not erase the prior review's recorded RED. | stale; the new unchanged-production gate and final checks replace it. | Preserve tested head and whether a reviewer actually calibrated the instrument. |
| SR-12 | The earlier spurious-dirty repair works; the new findings target freshness premises exposed by trusting clocks. | duplicate of SR-01/02, preserving the before/after explanation. | Repair upstream invalidation rather than restore unconditional recapture. |

Raw explicit findings: **9 = 7 fixed-now + 1 accepted-design + 1 refuted**.
Including supplementary claims: **12 = 7 fixed-now + 1 accepted-design +
1 refuted + 1 stale + 2 duplicates**. No deferrals or known accepted-contract
counterexamples remain within the stated boundary. The reviewer found two real
freshness hazards and useful work/scope cleanup, but promoted identity divergence
to correctness without authority and misstated fallback execution. Recommendation:
hire with reservations for adversarial discovery; require contract and execution
verification before treating every label as a defect.

### Size, provenance, and conformance

Against merge-base `15d2d2d328db6f5a4ea0f1a48528c6c5137a1716`,
`pnpm size:compare --packages db --files` reports observer **−338** minified
bytes, Collection changes **−7**, utility **+6**, net **−339**. DB gzip is
**−130** and brotli **−171**. All eight app scenarios also shrink: gzip
−109…−142, brotli −15…−119. The prototype distinction adds no traversal;
its cost is a predicate on prototypes the record comparison already reads.

Reviewed production SHA256: observer
`ba784a54a5b28d79c98e2a39783dbd00782d9584a85717a793b60c0863cd2c7a`,
Collection changes `2824f649107b52a3b24a911b3d3c62baabd5b38f00da083ba51432a8d96551c0`,
utility `9605eb9c38a7c759e2acc757856685d2f46081d161b271c854271563e68f6188`.

ORC-001/002/003 use the stated authority, small independent version/rank and
shape/number models, and adjacent executable prose. ORC-004 reconstruction adds
both reported traces, ablation separates row versus layout clocks and shape
versus numeric change, and range includes empty earlier sharing cases plus
2/3-row query captures and all record carriers; unsupported clockless objects
and cross-copy Collections are excluded by API/AGENTS authority, rather than
quiet test narrowing. ORC-005 checks the real source and query paths at named
cuts; no concrete missing-input hypothesis remains there. ORC-006/007 have three
mutant assertion failures and guarded RED/GREEN replay. ORC-008/009 retain
version/rank separation and add a model-only shape name, declared above; nested
holds belong to the driver schedule, not copied cache state. ORC-010 preserves
failure/cleanup fidelity with finishHistory and AggregateError. ORC-011 adds no
second reference algorithm: the named shared-fault hypothesis is precisely
class/plain equality, challenged independently by constructor tags and a numeric
model through both production paths. ORC-012 is this versioned record.
ORC-013 uses equal and changed same-prototype neighbors plus an independent
layout-only mutant. ORC-014 transfers the controlled sync premise to actual
projected queries; it claims no external host/provider contract. ORC-015 reports
all changed reach states; ORC-016 retains fixed examples on the shared model,
driver and comparison. Whole-workspace local testing did not run. Final-head CI
and readiness are reported separately; the green checks on `71bb4c659` are only
previous-head evidence after this semantic change.


## 2026-11-03: integration with current main

After pushing `e5c2d6d3c`, GitHub reported a conflict with main at
`1443dc92e`. A normal merge retains main's comparison-mode refactor, signed-zero
row fidelity, and Effect publication identity policy. The only conflict was in
the generic record predicate: preserve this PR's prototype distinction and
main's separate `PUBLICATION` condition. Main already moved cycle detection
above the value-class dispatch, so the old duplicate check is unnecessary.
The glossary now names `sameRowValue` as Collection's change-event comparison.
No framework adapter production edits belong to this PR's diff against main.

The merged gate passes **1,868 tests in 16 files**, including the original
15-suite gate plus the Effect metadata/callback owner. Both fixed and random
snapshot campaigns meet every declared reach minimum. The three hostile
mutants were repeated against the merged tree: row rollback fails at version
freshness, the layout-fence omission fails ordering after that value step passes,
and the old prototype predicate fails both direct and projected-query shape
comparisons. Guarded replay passes after each restoration. Focused TypeScript,
changed-file oracle lint, ESLint, minified public API validation and the
433-name mangle cache pass. The earlier minified API invocation during mutation
correctly rejected a stale dist; rebuilding after restoration supplies the
successful result. Production utility SHA256 is now
`0aef2b8fdfd4cbbf78eb348ca2bd245dec6e5ca85e98709e382e5bcf2b3b32ab`;
observer and Collection changes hashes above remain unchanged.

The rebuilt comparison against exact current main `1443dc92e` still yields
**−339 minified production bytes** (observer −338, Collection changes −7,
utility +6). DB gzip is **−126** and brotli **−27**. All eight app scenarios
shrink in gzip, by 104–141 bytes. Brotli ranges from −240 to +23 bytes: the
group-by scenario grows 23 bytes, while the other seven shrink. These current
compression results supersede the earlier baseline's measurements for the
merged tree. Full workspace local testing and the combined Angular #2327 tree
remain unverified. Exact pushed-head CI is tracked separately.


## 2026-11-03: CodeRabbit Set work and pooled receiving paths

This section records changes on parent `f66d68490e827393d18d67ba8e3f6ce9e003138a`.
It supplements the merged-head evidence above. The implementation in this commit
uses candidate-pair comparisons and augmenting paths for object-valued Sets,
and restores optional layout-channel registration for supported pooled views.
No framework adapter production source changes. The historical cache description
above now explicitly distinguishes readonly access from runtime freezing.

### Law, experiment, inference, and limits

An unordered Set comparison needs a bijection of structurally equal members:
separate equal objects still occupy separate positions. The approved prototype
policy distinguishes plain, class, and null-prototype records. AGENTS.md's
Algorithm Efficiency rule rejects combinatorial assignment enumeration. For
scalar record members the new utility lane enforces a generous cubic field-read
ceiling, `4 * (maxSize + 1)^3`. This observation bounds comparison work for that
grammar; it promises no wall-clock latency or global bound for nested values.
Primitive Set and draft comparison paths retain their existing policies.

The primary utility owner now counts authored shape/value tokens independently
of production. Generated widths 6–12, values 1–5, and rotations 0–12 construct
reordered equal bags, late unmatched class/null records, and multiplicity
deficits where every member has a candidate. Derived empty and singleton bags
use that same model. Each pair runs through `deepEquals` and `sameRowValue`, in
both directions, with acyclic members and members that link back to the compared
Set. No alternate matching algorithm supplies the expected answer. Equal-field
records may duplicate structural value, but every Set member is a distinct object.

**Reach:** normal fixed and random campaigns each run 100 histories. Their
combined measured counts are 200 for each of twelve states: empty, singleton,
wide, equal, unmatched, deficit, cyclic, acyclic, general-forward,
general-reverse, row-forward, and row-reverse. Every generated input constructs
all these regimes and receiving comparisons. The registered property is
`utils.42`; the registry increases from 41 to 42 without renumbering old IDs.

**RED:** with production restored to f66, the extended utility lane fails at
scalar read 2049 against ceiling 2048. Fixed seed `20260911`, shrink path
`0:0:0`, reaches width 6/value 1/rotation 0; random seed `10715839`, path
`0:0:0:0`, reaches the same input. The renewed baseline gate preserves failures
from both comparators and directions in an AggregateError. It preceded the
final matcher repair. The earlier generic-only RED did not prove row-path RED;
production was restored before extending that receiving driver and rerunning.

**GREEN:** the final five-file source gate passes 190 tests, including utility,
pooled, snapshot, observer and facade owners. The preceding broader eight-file
gate passed 786 tests. The built-dist lane passes 357 tests in six files;
Preact conformance passes 136 tests in two files. Types, ESLint, changed-file
oracle lint, minified public API and mangle checks are recorded with the final
verification. These are focused gates; the full workspace suite did not run
locally.

**Mutants:** restoring permutation enumeration fails the work assertion in both
comparators/directions. Adding only CodeRabbit's unmatched-element precheck
still fails on multiplicity deficit; that witness distinguishes complete repair
from a one-trace fix. Allowing candidate reuse fails exact bag equality in both
comparators. These three are intended assertion failures, not timeout or setup
failures. Guarded replay of `utils.42`, seed `20260911`, path `0:0:0`, executes
the selected comparison and passes after restoration. Earlier attempts selecting
`utils.43`, or selecting IDs shifted by a top-level registration, were setup
failures and supply no mutant evidence. The trailing describe registration keeps
all earlier replay IDs stable. Replay machinery reports four internal runs for
this shrink path; it is not evidence of four independent histories.

A second CI finding concerns supported pooled views, which have authoritative
row/layout clocks but intentionally no separate layout subscription channel.
Their normal change stream carries layout changes. Treating that optional
channel as mandatory throws during observer subscription. The pooled owner
already generated this path; the previous local gate omitted that owner.
The repair keeps clock authority and registers the extra channel only when
available. It adds no clockless or cross-copy compatibility branch.

The pooled owner now declares successful wholesale, granular, and detached
comparisons. Both normal 80-history campaigns reach each mode in all 160
histories; cleanup with a detached reader holding rows reaches 32 histories,
and an unwatched detached reader holding rows reaches 10. The unchanged
independent membership model and live-query Collection second formulation judge
rows, order, status and change payloads after every legal step.

**Pooled RED:** before the production repair, all 13 owner tests fail with
`_subscribeLayoutChanges is not a function`. The extended reach gate reproduces
that failure with fixed seed `44502001`, path `0:0:0:0:0:0`, on an empty source
and one peer. This is a production runtime failure at subscription, before the
refinement checkpoint, not an assertion kill. Current-head CI's Preact
`eq-filter-peers` and `pooled-param-change` cases fail on that same path before
the repair; the repaired real Preact receiving suite is GREEN.

**Pooled calibration:** a silent fallback that returns from attach when the
channel is absent fails the existing granular comparison. Seed `44502001`,
path `1:0:0:0:3:2:2`, starts empty and optimistically inserts one matching row
before cleanup/rollback. At the pending checkpoint the granular mirror has no
row while the model requires it. This is an intended assertion failure after
setup. The restored owner passes. Thus merely avoiding the throw without
subscribing to changes does not satisfy the law.

CI also exposed two ordinary facade tests that expected private row clocks to
rewind after a failed flush. The failed-flush architecture law restores public
rows, indexes and layout and emits no publication; it does not require clock
reuse. The tests now require monotonic invalidation and one subsequent row
advance. All public row, ordering, index, event, truncate and layout assertions
remain. Both source and built-dist suites pass these tests.

### Review ledger and reviewer assessment

Review `5756078957` covers `e5c2d6d3c`; inline `4457695586` and mutable summary
version `4d967a8643c3` were frozen before experiments. The merge retained the
matcher, so its finding still applied at f66.

| ID | Original claim or sibling | Verdict and action | Durable destination |
| --- | --- | --- | --- |
| CR-E5-01 | Late unmatched Set member causes factorial search; precheck it | Confirmed, fixed with polynomial matching | Utility work lane and this evidence |
| CR-E5-02 | Precheck does not bound multiplicity deficits | Confirmed sibling, fixed and generated | Utility bag model and precheck mutant |
| CR-E5-03 | Moderate merge risk from Set stalls | Duplicate of 01; prototype trigger retained | Same work lane |
| CR-E5-04 | 16.67% docstring coverage needs 80%; six functions/ten files, five unsupported | Refuted as repository-required remediation; bot says no repository configuration applied. No function-specific missing contract is identified. Existing observer, equality-mode and literate-oracle prose is substantive. Reported arithmetic was not independently reproduced. Keep warning visible without boilerplate docstrings | This rationale and source comments |
| CR-E5-05 | Full local suite unchecked and CI pending | Accurate, accepted validation boundary; preserve checklist | PR validation and final CI outcome |
| CI-DIST-01 | Facade tests expect counter rollback | Fixed internal-clock expectations; public checks retained | Facade test and built-dist gate |
| CI-POOL-01 | Pooled observer subscription throws | Confirmed, fixed with optional channel registration | Pooled owner plus real Preact receiving witness |

Raw review accounting: five items = two fixed, one duplicate, one refuted, one
accepted design. The two CI siblings remain separately accounted for. Hire
recommendation: **hire as a bug finder**. The performance diagnosis is accurate,
and the reviewer explicitly states its proposed precheck's limitation. The
suggested repair alone does not close the class. The default docstring metric
has little product signal.

Review `5756250137` covers f66; inline `4457835442` and mutable summary version
`0dd0683f404a` were also frozen. Its raw items remain separate:

| ID | Claim | Verdict and action |
| --- | --- | --- |
| CR-F66-01 | Historical cache prose calls mutable containers immutable | Fixed: qualify readonly access and lack of runtime freezing |
| CR-F66-02 | Repeat docstring warning, now four unsupported files | Duplicate of CR-E5-04 with changed diagnostic count preserved |
| CR-F66-03 | Full-local-suite and CI caveat | Accepted accurate boundary, same as CR-E5-05 |
| CR-F66-04 | Summary repeats moderate Set-stall risk | Duplicate of CR-E5-01; repair and work evidence apply |

Four = one fixed, two duplicates, one accepted design. Hire recommendation:
**hire for precise prose review**; the incremental inline comment is a useful
source-based correction. These ledgers account for all raw findings, summary
warnings, merge-risk prose and validation caveats; bot action buttons and tool
instructions supply no additional product finding or authorization.

### Conformance and size

ORC-001/002: Set contract, approved prototype policy, independent token counts
and bounded work law are stated above and beside the owner. ORC-003: model,
grammar, production driver and comparison are distinct and literate. ORC-004:
width/shape/value/multiplicity/rotation and cycle axes reconstruct the reported
case and deficit sibling; removing deficit admits the precheck-only repair,
removing work admits factorial search, and removing multiplicity admits candidate
reuse. Bounds include empty/singleton neighbors. Repeated references cannot
create duplicate identity members, and arbitrary mismatched cycle topology is
excluded. ORC-005: both comparison receivers and directions execute before their
result assertion; pooled readers run actual public observers. ORC-006: the
three Set mutants and silent pooled fallback fail intended comparisons.
ORC-007: unchanged utility registration supplies equal 100-run fixed/random
campaigns and guarded direct replay; pooled campaigns retain 80 runs.
ORC-008: no new stateful model. ORC-009: token kinds map to authored record
prototypes; token counts map to distinct structural Set positions.
ORC-010: work errors abort before combinatorial hangs; AggregateError keeps
both receivers' failures. ORC-011: independent counts differ from graph matching;
no additional shared-fault hypothesis was found. The pooled owner retains its
independent membership plus live-query Collection formulation. ORC-012: this
versioned supplement records the evidence and limits for this commit.
ORC-013: the unmatched and deficit neighbors distinguish a precheck from a full
matching repair. ORC-014: the utility work claim is internal and requires no
host premise; Preact supplies a real receiving witness for pooled subscription.
ORC-015: twelve utility and five pooled states have measured reach above.
ORC-016: generated inputs and replays use shared judgment with no separate
handwritten expected answer.

Against exact main `1443dc92e`, production is **−285 minified bytes**: observer
−311, Collection changes −7, utility +33. DB gzip is **−124** and brotli **−162**.
All eight app gzip scenarios shrink by 91–116 bytes. Brotli spans −211 to +25:
group-by grows 25 bytes; the other seven shrink. These measurements supersede
the preceding −339 and interim −312 values. Unbounded nested comparison cost,
arbitrary cycle topology, and the latest combined tree with Angular #2327
remain outside this evidence. Final pushed-head CI and the newest CodeRabbit
covered commit are tracked separately from these local results.


Reproduce the new owners from `packages/db`:

```sh
pnpm exec vitest run tests/utils-oracle.property.test.ts tests/query/pooled-live-query-oracle.property.test.ts --coverage.enabled=false --maxWorkers=2
TANSTACK_DB_ORACLE_PROPERTY=utils.42 TANSTACK_DB_ORACLE_SEED=20260911 TANSTACK_DB_ORACLE_PATH=0:0:0 node --import tsx tests/oracle-replay.ts tests/utils-oracle.property.test.ts --coverage.enabled=false --maxWorkers=1
```

After mutant restoration, this two-owner gate passes 100 tests, with each new
utility reach at 200 and each pooled receiving comparison at 160. The separate
pooled GC owner passes 21 tests. The final TypeScript, ESLint, changed-file oracle
lint, 433-name mangle cache and minified public API commands all exit zero.


## 2026-11-03: current-head review and separate cleanup/restart limit

CodeRabbit summary `6606385727`, frozen version `b09f4de339ec`, reports covered
commit `162eebf398616c0c561b7472557b251ed1cc3a8d` with kind `reviewed`, no actionable
comments, and minimal merge risk. Its automatic-review pause takes effect after
that reviewed commit. It emits no new review ID or inline finding. The two
previous inline comments are marked addressed at this commit. No production
or oracle repair follows this summary; the changes in this supplement only
record review accounting and an unresolved lifecycle limit.

| ID | Summary claim | Disposition and evidence |
| --- | --- | --- |
| CR-162-01 | No concrete merge-blocking issue found; normal validation pending | Accepted bounded review result, not independent proof of general correctness or green CI |
| CR-162-02 | Docstrings 11.11%, nine functions/twelve files, three unsupported, threshold 80% | Duplicate of CR-E5-04; updated metric retained, default policy rationale unchanged |
| CR-162-03 | Full local workspace suite did not run and CI is pending | Duplicate of CR-E5-05; keep the validation boundary |
| CR-162-04 | Possibly related #2334; no claim that this PR fixes it | Confirmed-open lifecycle witness, recorded below and in the coverage map. No new defect in the declared metadata-sharing or discarded-delivery scope was established |

Four summary claims = one accepted bounded result, two duplicates, one
confirmed-open separate lifecycle case. Reviewer assessment: useful issue
navigation and accurate scoped change description. No new repair recommendation
was supplied. Its no-actionable-comments result does not erase the linked
counterexample when evaluating wider observer readiness.

Issue #2334 explicitly left production versus model correctness unresolved.
A temporary replay through the unchanged hydration model and driver reproduces
its exact input in granular and wholesale mode on `162eebf39`: empty seed;
attach; ready; write `b=0`; cleanup; restart; write `b=0` again. The source's
public rows contain `b=0`, but the observer shows none. The Collection row clock
advances from 2 to 3 while the observer capture stays at 2. A separate diagnostic
continuation omits only that loading checkpoint, then marks ready and performs
the original shared comparison: it still fails in both modes at the ready
checkpoint. That diagnostic is not a GREEN run or an oracle expectation change.
No production repair or permanent oracle exclusion was made.

This narrows the issue's uncertainty: the mismatch also exists after Collection
readiness. Source inspection points to subscription state retained across cleanup
versus the observer's cleared snapshot; a complete causal repair experiment is
still needed. The primary hydration/lifecycle owner and exact trace are now in
the coverage map, with #2334 as the durable issue. Its next work must generate
repeated-key cleanup/restart histories and reject a plausible wrong repair at a
ready checkpoint. This is a separate open lifecycle boundary, not closure
claimed by the metadata-sharing and discarded-publication laws above. The
previous statement that no accepted-contract counterexample remains is limited
to those declared laws; it does not establish general observer lifecycle
correctness. The PR description and final readiness report must retain this
qualification even if current-head CI is green.

## 2026-11-03: Set oracle counter overhead in CI

CI run `41682680312` on `c1fa115f5` passes 14,816 database-shard tests, but
both `utils.42` campaigns exceed Vitest's five-second timeout. The random
campaign reports seed `1430169919`; neither failure reports an equality or
scalar-work mismatch. A local run of those same campaigns passes before the
repair, with 3.58 seconds of test time. This local result does not reproduce
the CI timeout.

The scalar getter previously constructed a Vitest assertion on every read.
It now increments the same counter and throws only when that counter exceeds
the same cubic ceiling. The bag model, generated inputs, comparison paths,
100-run budgets, reach requirements, replay identifiers and test timeout stay
unchanged. No production code changes in this repair.

The same seeded local command after the change reports 0.313 seconds of test
time. The complete utility owner passes all 87 tests in 0.574 seconds of test
time. Each of the twelve Set reach states still records 200 histories across
the fixed and random campaigns. These elapsed measurements describe this local
run; they create no timing promise.

Restoring the original factorial matcher and replaying seed `20260911`, path
`0:0:0`, still fails at scalar read 2,049 against ceiling 2,048. This is the
intended work-observation failure, not a timeout or setup failure. Production
was restored byte-for-byte afterward. The unchanged bounded equality/work law
and its limits above continue to apply; this change only reduces checker
overhead.
