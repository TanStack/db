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
