# Second high review of SSR preparation — 2026-10-23

Reviewed production: `f374bdbb12c626a393c920a111ab892e905646f9`, PR #2229.
Repair production and tests: `44ee3f002f4db8b4c6b3987d8c821047762c4a1a`.
This record reviews that repair without changing its production or test blobs.
The raw review contains ten findings: seven correctness, one test-integrity,
one efficiency, and one simplification. The reporting user did not verify them.
No proposed fixes accompanied the findings. This evaluation verified each one.

## Laws, experiments, and inference

The server render and the first browser view must agree in projected rows and
observable readiness. The SSR guide supplies that promise. The maintainer chose
programming-error rejection for server reads without reproducible transport.
Browser writes, source-loading rows, and a preload before browser hydration are
valid operations. They cannot become SSR programming errors. Runtime source
errors keep their ordinary error surface. Active-cleanup rejection retains the
separate approved contract.

Prepared ready data must also let non-streaming Suspense finish. The old model
forced source-prepared queries to report loading. That protected one transport
mechanism but contradicted prepared Suspense completion. Before production edits,
the independent model changed its prediction for a prepared ready source:

| Case | Old prediction | Joint contract prediction |
| --- | --- | --- |
| Prepared ready source, no query capture | Server and browser loading | Render captures ready query rows/status. Server and browser ready. |
| Prepared loading source | Loading rows | Loading rows, captured at render. A later explicit preload still waits. |
| Normalized rows in a browser without query capture | Loading | Loading. Source rows alone do not prove query readiness. |

The repaired model does not infer browser Collection readiness from normalized
rows. It requires a query-result capture of the actual server view. React and
Svelte both rejected the previous implementation under this model before any
production repair. This is a repair of the joint contract, not an assertion
rewrite to accept new production output.

| Law and findings | Previous evidence gap | Decisive experiment | Repair and neighboring guarantee |
| --- | --- | --- | --- |
| Initial-view equality, SR03/SR08/SR09 | Missing server-write/browser-write dimensions and a false Svelte receiving path. | Real React hydration rejected browser activity. Real Svelte hydration returned later source rows. Browser-guard-only mutants still failed both hosts. | Capture query rows/status at render in existing DbClient query records. Preserve first hydration view across a same-query local preload. Commit can publish later live rows. |
| Prepared Suspense and portable identity, SR01/SR02 | Forced-loading model and a warm-result identity bypass. | Source-prepared non-streaming Suspense stayed suspended. Warm opaque unkeyed streaming rendered without transport identity. | Preserve captured readiness. Streaming admission runs even for warm rows. Empty/nonempty, query/source preparation, cold/warm and keyed/unkeyed controls remain. |
| Selected query/window identity, SR06/SR07 | Callback Collection selection and explicit-key windows were absent. | Replacement displayed old rows. Bounded and unbounded hashes aliased. | Recompute selected Collection hash and include limit/offset with explicit keys. Matching builder and supplied Collection windows share identity. |
| Ownership retirement, SR04/SR10 | No retry after a throwing release. Active-resource accounting hid duplicate calls. | Observer retry acquired zero channels. Pooled status release ran twice. | Retire observer attachment before invoking release handles. Remove redundant pooled release. All acquired channels still release and errors propagate. |
| Unchanged getter work, SR05 | Identity tests did not observe traversal or lazy Map work. | Eleven admission walks for eleven unchanged reads. | First capture supplies later reads without another admission walk or keyed Map build. This is a deterministic measured improvement. |

### Primary owners and checkpoints

`packages/db/tests/ssr-snapshot-admission-oracle.ts` owns the preparation judgment
and history grammar. It uses authored rows and caller preparation actions. It
imports no production admission or identity classifier to compute expectations.
React's descriptor owner drives ordinary and infinite hooks separately. It uses
actual `renderToString` and `hydrateRoot`, and compares server markup, initial
browser rows/status flags, recoverable errors, and committed browser output.

The new Svelte handoff driver loads the real fixture with Vite SSR compilation.
Only JSON-serialized HTML and dehydration data cross into browser-compiled
`hydrate()`. The component records its first public hook rows/status before
effects. The driver derives expectations from the same shared judgment. The old
Svelte owner now states its narrower server-reconstruction scope honestly.
A normal warm-browser control remains separate from server admission.

The shared grammar covers no/source/query/pending-query preparation, idle/loading/
ready sources, zero to three rows, and writes on both sides of transport. A
same-query browser preload may finish before hydration. Idle sources contain no
rows. Completed query preparation requires ready sources. Pending preparation
requires loading sources. Those exclusions describe legal starting histories.
Ablating either write axis loses its distinct timing violation. Removing the
same-query preload axis loses replacement of the initial loading view. Removing
ready-empty cases loses readiness without row evidence. Named witnesses rebuild
the reported traces. Empty and three-row bounds remain in the random grammar.

The React stream-cut owner separately varies zero to three rows and zero to three
microtask publications between startup and preload settlement. It compares the
transported result with the view actually rendered, including empty and unchanged
controls. It does not infer this ordering from a delayed return promise.

The observer release owner varies granular/wholesale mode, Error/undefined
failures and one to three release/retry cycles. Its controlled wrapper retires a
real Collection subscription and then throws synchronously. It compares thrown
identity, zero channels after release, a fresh channel on explicit retry, and a
later public update. Real Collection event listeners report failures
asynchronously and do not supply this premise. No first-party callback-failure
claim receives credit from this controlled witness.

The pooled owner counts every release invocation, preserving duplicate evidence.
The work probe counts admission calls and lazy keyed-state accesses. These
observations do not establish an elapsed-time budget or universal complexity law.

## Pre-edit RED and calibration

All required receiving paths ran on unchanged `f374bdbb1` before initial
production edits. Logs remained under `/tmp/tanstack-ssr-review2` during the task.
The durable results below preserve their useful evidence without depending on
those temporary files remaining available.

| Experiment | Observed result |
| --- | --- |
| React receiving gate, revised ready law | 11 assertion failures, 13 passes. Source readiness was loading, late source rows changed markup, and browser activity threw the SSR-only error. |
| Actual Svelte handoff gate | Six assertion failures, six passes. First browser hook rows/status disagreed with the render-time model. |
| React Suspense/identity gate | Eight assertion failures, eight passes. Prepared Suspense did not finish, warm opaque identity bypassed admission, callback replacement retained old rows, and bounded/unbounded hashes matched. |
| Corrected observer release gate | Two generated-property failures. Explicit retry acquired zero channels instead of one. |
| Pooled release gate | Two generated-property failures. One status handle received two release invocations. |
| Work and explicit-preload neighbor | One failure, one pass. Eleven unchanged server reads repeated admission eleven times. A separate unchanged-production work probe also recorded twelve lazy state-getter accesses. Explicit preload control passed. |
| Narrow mutant: browser guard without render capture | React: one intended mismatch and one neighbor pass. Svelte: first-browser rows contained a late server row and failed. |
| Browser-only Svelte corruption | Old server-only test passed. Actual browser comparison failed at first hook rows/status. This directly demonstrates SR09's false green. |

Earlier Svelte setup failures receive no RED credit. An initial observer premise
used a `subscribers:change` callback that reports errors asynchronously. Its
failure to throw was a fixture error, not production evidence. The corrected
controlled-release gate above supplies SR04 evidence. The first narrow-mutant
build also failed setup. Only the corrected build and value-assertion failures
receive calibration credit. All temporary mutants were restored.

### Sibling defects found during the repair

These are additional witnesses, not replacements for any original finding.
Each received a failing test before its subsequent production repair.

| ID | Repair-attempt counterexample | RED and final enforcement |
| --- | --- | --- |
| N01 | A ready streaming component rendered before queued source updates, but its preload later transported the updated rows. | Four failures, one unchanged pass. Stream-cut property captures the rendered view. |
| N02 | A loading capture caused a second preload to replace an established pending stream. | Promise identity assertion failed. Pending records now remain reusable while carrying an initial snapshot. |
| N03 | A provisional result admitted a conflicting same-hash source before acquisition. | Rejection assertion failed. Source claims now check before replacement/startup. |
| N04 | A non-streaming loading capture carried a Promise into JSON transport. | Non-streaming promise-presence assertion failed, streaming neighbor passed. Default non-streaming transport retains its snapshot only. |
| N05 | A browser preload completed before hydration and replaced the original loading view. | React: six failures, 25 passes. Svelte: three failures, ten passes. Initial snapshot survives local preload replacement. |
| N06 | Matching explicit-key builder preload and supplied window disagreed. | Both direct and callback supplied Collection inputs failed. Window metadata now participates across these input forms. |
| N07 | Window inspection invoked an unrelated source utility named getWindow. | Two focused cases failed: an invented window changed identity and a utility threw. Hashing now reads registered live-query builder metadata. The finite invocation boundary has no independent generated-history owner. |
| N08 | The retained-snapshot helper erased its row type through generic ReturnType. | Parent CI and a direct full-package compiler run reported the same four errors. The helper retains its inferred observer type. Both the direct owner check and the final full-package compiler then passed. |

The callback-returned Collection path in SR06/N06 is supported by current runtime
resolution, but has no TypeScript overload. Tests invoke this JavaScript path with
`Reflect.apply`. This repair adds no new typed public input form.

## Lossless source-order findings

Each quoted claim below is the original review text. File/line references name
the reviewed commit. All ten dispositions are `fixed-now`; SR04's confirmed
premise has the controlled-boundary limit stated above.

### SR01 — correctness, `packages/react-db/src/useLiveQuery.ts:1058`

> With SSR streaming off, useLiveSuspenseQuery now reads getServerSnapshot. That method forces status `loading` for every result that has no hydration seed, so a query whose sources were explicitly preloaded can never reach ready on the server.

Confirmed. Forced-loading model confused normalized source readiness with captured query readiness.

Repair evidence: react-remaining-red.log: prepared non-streaming output suspended; react-final-red.log: source-ready status loading rather than ready. Original implementation rejects the intended readiness comparison.

Owner and durable value: shared SSR judgment and React descriptor receiving owner. Histories: source/query preparation; 0 or 2 rows; streaming on/off.
Checkpoint: completed server markup before browser work.

### SR02 — correctness, `packages/react-db/src/useLiveQuery.ts:1054`

> The streaming-Suspense branch returns observer.getSnapshot() and skips SSR admission even when the query has no queryHash, so warm rows render on the server with nothing that transfers them to the browser.

Confirmed. Warm Suspense bypassed discovery and the missing-identity branch ran only while loading.

Repair evidence: react-remaining-red.log: warm unkeyed opaque result rendered without an identity error. Original warm bypass fails; cold and explicit-key neighbors remain legal controls.

Owner and durable value: React descriptor receiving owner. Histories: warm/cold opaque logic; explicit key present/absent.
Checkpoint: server markup and error callbacks; dehydrated query presence.

### SR03 — correctness, `packages/db/src/live-query-observer.ts:352`

> The admission check also runs in the browser, because React calls getServerSnapshot during hydrateRoot. Rows produced by browser-side activity therefore throw the 'SSR cannot render server-only rows' error during hydration.

Confirmed. Hydration driver cleared window during its browser pass and never received browser-local writes.

Repair evidence: react-final-red.log: browser activity threw SSR programming error. narrow-mutant-react.log: browser-only guard still fails render-time equality.

Owner and durable value: shared SSR judgment, React ordinary/infinite and actual Svelte handoff drivers. Histories: browser writes and same-query preload before hydration.
Checkpoint: first public browser rows/status, React recoverable errors, committed browser output.

### SR04 — correctness, `packages/db/src/live-query-observer.ts:682`

> Re-attachment is now decided by `!this.attached` instead of `subscriptions.size === 1`. detach() resets `attached` only after collectionUnsub() returns, and that call now rethrows via runAllCallbacks. A throwing release therefore leaves the observer marked attached but with no channels.

Confirmed. Final channel counts missed a failed release followed by fresh explicit ownership.

Repair evidence: observer-release-red.log: retry subscriber count 0 instead of 1. Original detach ordering fails retry assertion. Controlled synchronous release only; first-party event callbacks report asynchronously.

Owner and durable value: observer history owner. Histories: granular/wholesale; Error/undefined; 1–3 release/retry cycles.
Checkpoint: release error identity, zero channels after release, fresh channel and later publication.

### SR05 — efficiency, `packages/db/src/live-query-observer.ts:350`

> getServerSnapshot repeats the full source walk (getSourceInfo plus recursive _hasSsrCollectionSnapshot with builder lookups) on every call, and calls `snapshot.state?.size`, which forces the lazy Map build just to test whether there are any rows.

Confirmed. Snapshot identity checks did not count admission walks or lazy Map getter accesses.

Repair evidence: work-and-preload-red.log: 11 admission walks where one suffices. Original implementation fails work counter; capture removes repeated admission and lazy Map materialization.

Owner and durable value: observer snapshot owner. Histories: prepared unchanged revision; repeated server getters; explicit preload neighbor.
Checkpoint: deterministic admission and lazy state-access counters.

### SR06 — correctness, `packages/react-db/src/useLiveInfiniteQuery.ts:357`

> When the query function returns a Collection (input.kind === 'collection'), queryHash keeps the stale committed?.queryHash from the previous query and is never recomputed, because inputIsCollection is false on that path.

Confirmed. Callback-returned Collection input was absent from replacement coverage.

Repair evidence: react-remaining-red.log: replacement showed old rows instead of new. Original stale-hash branch fails replacement assertion. Callback-returned Collections are JavaScript runtime coverage, not a new TypeScript overload.

Owner and durable value: React descriptor receiving owner. Histories: builder to callback-returned Collection; derived/explicit identity.
Checkpoint: replacement rendered rows and current query hash.

### SR07 — correctness, `packages/react-db/src/useLiveInfiniteQuery.ts:377`

> With a queryKey, the windowed query's transport hash is just hash(queryKey) and ignores the limit/offset window. An infinite query therefore shares a hydration record with any non-windowed preload that uses the same key.

Confirmed. Explicit keys erased limit/offset; supplied Collection windows were absent from input-form coverage.

Repair evidence: react-remaining-red.log: bounded/unbounded hashes equal; supplied-window-red.log: matching supplied forms rejected. Unbounded alias and matching-window rejection provide opposite boundary controls.

Owner and durable value: React descriptor receiving owner. Histories: matching window versus unbounded preload; builder/direct Collection/callback input.
Checkpoint: distinct or matching transport hash and server window rows.

### SR08 — correctness, `packages/db/src/client.ts:707`

> _hasSsrCollectionSnapshot admits a normalized source that is still loading. Rows it receives between server render and dehydrate() change the transported rows, so the first browser snapshot no longer matches the markup.

Confirmed. Transport sampled mutable source rows at dehydrate instead of retaining rendered query view.

Repair evidence: react-final-red.log and svelte-final-red.log: late source rows changed initial browser output. narrow-mutant-react.log and narrow-mutant-svelte.log: guard-only repair admits late rows and fails.

Owner and durable value: shared SSR judgment; React ordinary/infinite and actual Svelte handoff. Histories: loading/ready source; server writes after render; browser writes before hydration.
Checkpoint: rendered rows/status versus first browser hook result.

### SR09 — test-coverage, `packages/svelte-db/tests/ssr-snapshot-admission-oracle.svelte.test.ts:106`

> False green: the 'initial browser' render uses svelte/server render() under @vitest-environment node. typeof window is undefined there, so it goes through getServerSnapshot, and the real browser branch (getSnapshot, useLiveQuery.svelte.ts:455) is never compared with the server markup.

Confirmed. Node server render was incorrectly credited as an initial browser witness.

Repair evidence: svelte-browser-mutant.log: old server-only test green while real browser comparison red. Browser-only corruption survives old test and fails new receiving assertion.

Owner and durable value: shared SSR judgment and actual Svelte handoff driver. Histories: real SSR compilation followed by browser compilation/hydrate; same timing grammar.
Checkpoint: first public hook values before effects.

### SR10 — simplification, `packages/db/src/query/pooled-live-query.ts:160`

> The new early `this.stopStatusEvents = stopStatus` overlaps the terminated branch below it. In the re-entrant cleanup case, terminate() already calls stopStatus via release(), and then `if (this.terminated) { stopStatus(); ... }` calls it again.

Confirmed. Resource balance tracked active handles but normalized duplicate release calls away.

Repair evidence: ownership-red.log: two pooled status releases for one handle. Original redundant call fails invocation counter. The observer failures in this initial log used an invalid event-listener premise and receive no credit.

Owner and durable value: pooled live-query GC owner. Histories: synchronous cleanup registration; callback return/throw and undefined cause.
Checkpoint: every status release invocation, not only remaining resources.

## Final GREEN and declared reach

The final React package run passed 517 tests in 23 files. The Svelte package run
passed 163 tests in 11 files. Both reported no type errors. The final scoped core run
passed 346 tests in ten files with no type errors. It selected DbClient source
identity/hydration, observer history/snapshots/API, pooled GC, and window control.
This includes the error-message owner. Manifest/reporting checks have separate
results below. Earlier assertion-only framework runs reported type-check errors in test
drivers. Those runs receive no clean-GREEN credit. The corrected runs do.

The full DB test compiler also passed on `44ee3f002`:
`pnpm exec tsc -p packages/db/tsconfig.test.json --noEmit --incremental false`.
It exited zero with no diagnostics.

Normal campaigns use seed 2229 and an unsupplied seed with identical budgets.
Counts below are histories reaching each declared state, not total events.

| Path, fixed/random budget | State counts, fixed / random |
| --- | --- |
| React ordinary, 120/120 | cold-loading 19/25; unbacked-ready-empty 5/6; unbacked-rows 43/34; query-result 18/15; normalized-ready 12/18; normalized-partial 23/22; pending-query 19/17; server-write 29/30; browser-write 27/34; same-query-preload 14/17 |
| React infinite, 120/120 | cold-loading 19/26; unbacked-ready-empty 5/3; unbacked-rows 43/36; query-result 18/18; normalized-ready 12/19; normalized-partial 23/18; pending-query 19/20; server-write 29/30; browser-write 27/41; same-query-preload 14/19 |
| Actual Svelte handoff, 120/120 | cold 19/15; query 18/16; source-ready 12/26; source-loading 23/16; rejected 48/47; server-write 29/34; browser-write 27/36; same-query-preload 14/13 |
| React stream cut, 40/40 | empty 11/14; nonempty 29/26; later-publication 31/29; unchanged 9/11 |
| Observer release, 40/40 | granular 22/22; wholesale 18/18; release-error 40/40; retry 40/40; undefined-cause 18/21 |
| Pooled late cleanup, 40/40 | return 22/18; throw 18/22; undefined-cause 18/15 |

Each owner enforces declared minima. Fixed examples add replayable witnesses but
do not replace these campaigns. Six guarded final replays use seed 2229 and captured failure paths. Each
reported one completed execution with nonzero runs and `failed:false`:

| Property | Package | Path | Runs |
| --- | --- | --- | --- |
| react.ssr-ordinary | react-db | 4 | 120 |
| react.ssr-infinite | react-db | 4 | 120 |
| svelte.ssr-handoff | svelte-db | 4 | 120 |
| react.ssr-stream-cut | react-db | 0:0:1 | 1 |
| live-query-observer.release-failure | db | 0:0 | 1 |
| pooled-live-query.late-cleanup | db | 0:0 | 1 |

For example, from `packages/react-db`:

```sh
TANSTACK_DB_ORACLE_SEED=2229 \
TANSTACK_DB_ORACLE_PATH=4 \
TANSTACK_DB_ORACLE_PROPERTY=react.ssr-ordinary \
pnpm exec node --import tsx ../db/tests/oracle-replay.ts \
  tests/descriptor-query-binding-oracle.test.tsx \
  --coverage.enabled=false --maxWorkers=2
```

The manifest selects the named random lane and excludes fixed campaigns.
Direct `tsx` launch failed at a sandbox IPC socket before test execution.
`node --import tsx` ran the intended properties successfully. A broad core plus
replay-protocol run stopped reporting progress and was terminated. It receives
no GREEN credit. The separate scoped core run, six direct guarded replays and
six manifest/reporting tests passed. The error-message owner passed 19 tests. No replay-protocol implementation changed.

The production build, 419-name mangle check, scoped ESLint, formatting,
error-doc generation and whitespace checks passed. ESLint retained one existing
require-await warning in the pooled GC file, with zero errors. The minified public consumer
check passed 107 error names, index metadata, query rows and live updates.
Production error checks erased 248 literals, including 20 shared literals, in
ESM and CommonJS while retaining development text.

## Shipped weight and alternatives

Compared with merged main `65d9ada508114f199464f753d50eb3447eb0eaf9`,
`pnpm size:compare --packages db,react-db --files` measured:

| Output | Gzip change | Brotli change |
| --- | ---: | ---: |
| db package | +660 bytes | +646 bytes |
| react-db package | +107 bytes | +119 bytes |
| Typical app | +396 bytes | +410 bytes |
| Other app scenarios | +363 to +392 bytes | +250 to +476 bytes |

These are whole-branch changes, not only this follow-up. Production source in
this follow-up grows by 70 net lines. Tests and fixtures grow by 1,326 net lines before this review record.
Documentation and metadata grow separately and do not enter shipped-byte figures.

The repair removed the separate observer WeakMap and forced-loading snapshot
copies. It reused DbClient query-result records instead of adding a second
snapshot cache or lifecycle. A browser-only admission guard was tried as a narrow
mutant. It fixed browser rejection but still failed late-server-write equality
in both hosts. Counting a loading capture as a completed preload failed the
explicit-demand law. Replacing a pending record failed stream-promise identity.
Omitting the retained initial snapshot failed same-query preloads in both hosts.
Omitting window metadata from supplied Collection hashing failed matching
preload/hook identity. Reading arbitrary utils was also rejected: registered
builder metadata is both narrower and five production lines smaller. These experiments justify the remaining transport fields
and branches. No retries, generations, or separate recovery state machine were
added for a programming error.

## Oracle conformance self-review

This is a self-review. No independent agent or new external review ran.

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority/limits | SSR guide, prepared Suspense API, ownership contracts and maintainer policy supply authority. Finite limits appear beside owners and below. |
| ORC-002 independence | Shared judgment uses authored rows and preparation actions. Ownership uses token/channel counts. Production classifiers do not compute expected values. |
| ORC-003 literate responsibilities | Shared owner states the law, grammar and judgment. Directly named host owners explain drivers, recordings and checkpoints. |
| ORC-004 grammar controls | Named reconstructions, axis ablations, zero/three row bounds and idle/pending exclusions appear above. Window identity has matching/unbounded and selected-input controls. |
| ORC-005 path/observations | Actual React hydrateRoot and browser-compiled Svelte hydrate receive serialized state. First hook values, status flags and errors are observed before commit repair. Render captures provide information the browser otherwise lacks. |
| ORC-006 calibration | Original assertion failures, browser-guard-only mutants and browser-only Svelte corruption reach their intended comparisons. Setup failures receive no credit. |
| ORC-007 campaigns/replay | Equal fixed/random budgets and six completed guarded replays, including exact seed/path witnesses. No command-model replayPath is applicable. |
| ORC-008 model minimality | Preparation and source state remain distinct: ready-empty and source-loading predict different status. Later server/browser writes cannot change the modeled initial view. No new reference lifecycle state machine was added. |
| ORC-009 vocabulary | Model sourceState combines startup/readiness for the stated synchronous eager grammar. Preparation describes caller actions. Canonical Collection, cleanup, readiness and publication terms retain their glossary meaning. |
| ORC-010 failure fidelity | Observer driver retains thrown undefined, primary assertion and secondary cleanup diagnostics through withOracleCleanup. Host drivers release clients, mounts and compiler resources. The intended assertion failures survive shrinking. |
| ORC-011 second formulation | The named shared-fault concern was an incorrect readiness policy and a fake browser premise. Contract reconciliation and actual receiving drivers distinguish them. A second structurally similar model would not add independent evidence. No other concrete shared semantic fault was identified. |
| ORC-012 evidence/closure | This versioned record identifies reviewed and repaired commits, lossless findings, calibration, reach and finite limits. It does not claim universal proof. |
| ORC-013 nearby boundaries | Ready-empty versus cold-empty; prepared versus incidental rows; keyed versus opaque-unkeyed; matching versus unbounded windows; empty versus nonempty stream updates; and successful retry after throwing release distinguish plausible wrong rules. |
| ORC-014 handoff | React and Svelte real host APIs receive the shared law at the named cuts. jsdom supplies browser globals and DOM. This is no claim about a deployed Start/Electric host. SR04 remains explicitly controlled. |
| ORC-015 reach | Each generated path has minimum reach assertions. The table above reports actual normal-run counts separately for both hosts and both React hooks. |

## Reviewer assessment, loss audit and readiness

**Hire.** All ten claims supplied useful, reproducible evidence. The reviewer
connected hydration timing, Suspense readiness, identity and lifecycle ownership
instead of relying only on local code style. Prioritization was sound. The work
finding distinguishes unnecessary traversal from latency. The simplification
exposed duplicate release evidence that resource-balance checks had erased.
SSR row/readiness mismatches have high user impact. Callback replacement and
window identity have medium impact. Work and duplicate idempotent release are
low severity. SR04 needed a narrower synchronous-release premise than a real event-listener
failure. The review supplied counterexamples, not a complete transport design.
The repair still needed neighboring-law experiments to avoid new stream and
preload defects.

Loss accounting: **10 raw = 10 fixed-now**. No original item is merged away,
refuted, deferred or left as an accepted-design exception. The additional
repair-attempt witnesses also pass. Accounting and the authorized repair for
this review are complete within the boundaries above.

Known limits remain in the [coverage map](../oracle-coverage.md): synchronous eager
sources with zero to three authored rows, initial infinite windows, and the
named microtask schedules. Arbitrary asynchronous providers, persistence
readiness, later page-shape changes during hydration streams, mixed ordinary/
Suspense streaming schedules, custom filters, and deployed Start/Electric hosts
remain unexercised paths. No known reachable counterexample remains in this
review's repaired scope. Finite green histories are not a proof for all histories.

Parent CI had two failing unit shards from N08 and a canceled browser E2E job.
The aggregate test jobs reflected those results. Local assertion counts did not
erase those failures. N08 now has direct owner and full-package compiler evidence.

Whole-PR readiness remains **unproven** until final pushed-head CI and the earlier
evidence gaps receive their own decisive evidence. The prior migration audit
retains H04 (legal recoverable pooled subscription throw), H08 (permanently
stranded demand after notification failure), and F07 (Date assignment and exact
dependency versions). This review neither closes those reports nor invents a
recovery state machine for them. CodeRabbit remains paused. No external review
request was sent.


## Follow-up: mixed streaming readers — 2026-10-23

Starting head: `a0991825ea326fcdbfadbeb61c2029ff130b1a88`.
Production repair: `10e0e6fed7f127d515144e1a14c4e69805425cc2`.
Final oracle instrumentation: `ce8f99d350556cf461cca059db41e4f490eea74d`.
This is a self-review. No independent agent or external review ran.
The earlier record remains historical. This section supersedes its exclusion
of the mixed-reader schedules exercised below.

### Joint law and the missing experiment

Each reader's first browser rows and readiness must reproduce that reader's
server-rendered view. Keeping an ordinary loading view cannot prevent explicit
Suspense preparation from completing. One committed reader cannot consume a
later boundary's server view. The SSR guide supplies initial-view equality and
explicit preload completion. React's hydration API supplies the receiving cut.
The maintainer's programming-error policy does not permit a crash for these
legal schedules. Active Collection cleanup retains its separately approved rule.

The old stream-cut property compared one Suspense render with its transported
rows. It omitted an ordinary sibling and never hydrated this mixed tree. Its
narrower green result did not establish the joint promise. The expanded
metamorphic judgment retains each server reader's projected primitive values
and status, then compares that same reader's first browser result. It imports
no production classification to predict equality.

The grammar varies zero to three authored rows and zero to three microtask
publications. An ordinary reader appears before Suspense, after Suspense, or
not at all. Browser startup may publish different rows under the same key.
An async React act cut and a synchronous act cut distinguish hydration together
from ordinary commit before Suspense hydration. Snapshots and resolved Promise
values cross through JSON. The real Router adapter supplies the stream under
controlled SSR callbacks. Actual renderToPipeableStream and hydrateRoot supply
the React receiving path. Suspense-only histories compare server markup and
transport. Only mixed histories receive browser-hydration credit.

Removing placement loses the competing loading/ready views. Removing browser
variation permits local recomputation to conceal missing transport. Removing
the split cut permits an early commit to consume another boundary's view.
Empty rows distinguish readiness without row evidence. Microtask writes retain
the original rendered-view versus later-publication distinction. The grammar
reconstructs each known witness below. It permits one ordinary sibling, so the
mapping excludes both placement flags being true. Generated writes insert a
missing key and update an existing key, including the browser-only row.

### Additional findings and pre-edit evidence

These findings supplement N01–N08 and do not replace any raw SR item.

| ID | Finding and test gap | Decisive evidence | Disposition |
| --- | --- | --- | --- |
| N09 | Completing a shared Suspense query replaced an ordinary reader's initial loading view. The previous owner lacked the second reader and its first-browser observation. | On unchanged a0991825e, three failures and three passes. Fixed seed 2229, path 0:0:0, and random seed -1274793130, path 0:0:0, reduce to zero rows and ready instead of loading. | fixed-now, within the mixed grammar above. |
| N10 | Router suppressed every later record with an already-streamed hash. Core snapshot repair alone could not deliver the replacement. | The actual Router receiving test ran before production edits. Its second read reported done:true instead of forwarding the completed preload. | fixed-now. The same Router adapter also supplies the generated receiving path. |
| N11 | A split hydration cut used local rows before the stream delivered its result, or lost a result after a sibling consumed it. Async-only hydration hid this schedule. | The expanded owner ran before the retention/wait repair: three failures, five passes. Seed 2229, path 3:0:0:1, reduces to empty rows with incorrect readiness. Random seed -45443823, path 0:0, reaches the same mismatch. A retained-record-only attempt still failed all three comparisons. | fixed-now, including retained transport and waiting for missing rows. |
| N12 | CI rejected a dynamically spread one-run replay override as oracle/no-disabled. Local ESLint does not include that installed CI rule. | Lint at a0991825e failed while all unit shards passed. Shared replay options replace the override. Normal fixed/random campaigns still run 75 histories each, and direct seed 2233/path 1:0 passes. | Local repair complete. Final CI must supply rule-specific confirmation. |

N09 and N10 reached their receiving assertions on unchanged production before
its first edit. N11 reached its assertions on the first mixed-reader repair
before adding retained server records or the pending-result wait. These are
assertion failures at the promised first-view cuts, not timeout kills. The
retention-only attempt demonstrates why a narrower repair is insufficient.

Fixture mistakes receive separate treatment. One browser-row fixture attempted
a duplicate insert and produced four uncaught exceptions. The corrected fixture
passes but those exceptions supply no calibration credit. Another run passed
519 assertions but reported a private-option TypeCheckError. It was not clean
GREEN. The fixture now uses its known client identity. Initial bundle checks
stopped at their stale-dist guard before execution. Later checks used a fresh
build. An incorrectly addressed diagnostic command changed no test source and
supplies no scheduling evidence. Temporary diagnostics are absent from the final
oracle. Development multiple-renderer warnings remain distinguishable from
uncaught errors and recoverable hydration mismatches.

### Repair, alternatives, and cost

The transport reuses the record's existing initial snapshot field. It sends a
second view only when that view differs from the completed result. Ordinary
readers retain their earlier view. Suspense reads the completed result. Router
replaces its hash Set with a version Map so replacement records can arrive.

DbClient retains a reference to each transported query record until cleanup.
Only the server getter can recover that record after ordinary consumption.
Normal new browser observers continue to read live results. If hydration lacks
the server-rendered rows, its getter suspends on the stream Promise. Explicit
Suspense demand can still start local work. No retry timer, generation, queue,
or replacement lifecycle was added.

Reusing only the active record was smaller but failed the split schedule.
Retention alone also failed while the Promise still lacked its snapshot. Reader
counts cannot include a boundary React has not instantiated. A separate root
hydration-completion lifecycle would require an architectural signal this API
does not expose. The chosen map keeps references rather than copying rows.
Its memory cost lasts for the DbClient lifetime and grows with distinct hydrated
query hashes. cleanup clears it. Those costs earn their place through the
receiving law and the rejected narrower designs.

Compared with a0991825e, production grows by 45 net source lines. Tests grow by
225 net lines after correcting reach counters. Guide, coverage-map and changeset
text grow by 24 net lines, excluding this audit. The mangle cache adds two names
and drops none, for 421 names. Tests and documentation are separate from shipped
bytes. Against merged main 65d9ada508114f199464f753d50eb3447eb0eaf9,
size:compare over db, react-db and react-router-with-db reports:

| Output | Gzip change | Brotli change |
| --- | ---: | ---: |
| db | +799 bytes | +891 bytes |
| react-db | +117 bytes | +129 bytes |
| react-router-with-db | +25 bytes | +27 bytes |
| Package total | +941 bytes | +1,047 bytes |
| Typical app | +479 bytes | +527 bytes |
| Other app scenarios | +437 to +488 bytes | +329 to +443 bytes |

### Final evidence and self-review

The full React package passes 520 tests in 23 files with coverage and type
checks. Svelte passes 163 tests in 11 files. Core checks cover 379 distinct tests
in 13 files, including observer lifecycle, DbClient transport and identity,
pooled queries, windows, and errors. Router passes ten tests in two files.
The full DB test compiler passes. The final reach-only adjustment runs the
same eight stream-cut tests again without broadening unrelated testing.

Both normal stream campaigns retain a 40-history budget. Fixed seed 2229 and
the final unseeded run report these actual counts. Browser states count only
histories that reached hydrateRoot, not Suspense-only transport histories.

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| empty | 11 | 9 |
| nonempty | 29 | 31 |
| later-publication | 31 | 29 |
| unchanged | 9 | 11 |
| ordinary-first | 21 | 18 |
| suspense-first | 11 | 9 |
| suspense-only | 8 | 13 |
| browser-different | 12 | 18 |
| browser-same | 20 | 9 |
| split-hydration | 16 | 12 |
| together-hydration | 16 | 15 |

Every normal campaign asserts minimum reach. The guarded stream replay at seed
2229/path 3:0:0:1 completes one execution with two runs and failed:false. The
older replay-demand property's wrapper stops at no-named-owner before execution.
Its direct replay passes but receives no guarded-replay credit. No manifest
entry was invented for this lint repair.

Scoped ESLint has zero errors or warnings. Prettier, whitespace and the 421-name
mangle check pass. The minified consumer passes 107 error names, index metadata,
query rows and live updates. Production-error checks erase 248 literals,
including 20 shared literals, in production ESM and CommonJS while preserving
development text.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001 | SSR guide and hydration equality authorize the joint law. The finite source and host limits remain explicit. |
| ORC-002 | The relation compares each rendered primitive projection with that reader's first browser projection. Expected equality does not use the transport classifier. |
| ORC-003 | Local prose explains the law, placements, scheduling cuts, public observations and controlled Router premise beside the existing owner. |
| ORC-004 | The reconstruction, ablation, zero/three bounds and mutually exclusive placement mapping appear above. Duplicate inserts are invalid and no longer enter the fixture. |
| ORC-005 | Real React APIs receive actual Router adapter chunks. First hook rows/status and recoverable errors are compared. Suspense-only cases claim transport evidence only. Missing result data causes a wait rather than local substitution. |
| ORC-006 | Original mixed-reader and Router comparisons fail. The split comparison also rejects retention without waiting for the missing result. Setup/type failures receive no credit. |
| ORC-007 | The same grammar and comparison run 40 fixed and 40 unseeded histories. Named seed/path replay completes directly. No command-model replayPath applies. |
| ORC-008 | The relation needs a separate first view per reader: loading versus completed readiness predicts different hydration. It introduces no reference lifecycle state machine. |
| ORC-009 | Rows, Collection readiness, cleanup and publication retain glossary meanings. split-hydration names a host scheduling cut, not a new Collection state. |
| ORC-010 | Shrinking preserves the first-view mismatch. Diagnostics distinguish primary mismatches, fixture exceptions, compiler failures and cleanup. Roots, readers and clients are released. |
| ORC-011 | Browser-local variation challenges the concrete shared-fault hypothesis that both sides recompute from equal local rows. The relation needs no second copy of production semantics. |
| ORC-012 | This append-only section identifies production and final oracle commits, exact failures, reach, alternatives and finite limits. |
| ORC-013 | Empty readiness, both reader orders, async versus split hydration, and same/different browser rows distinguish nearby wrong consequences. |
| ORC-014 | Actual React supplies the split cut. Router callbacks remain controlled. This is not a deployed Start or real-provider claim. |
| ORC-015 | Each declared receiving state requires actual browser execution. The table records the final normal campaigns. |

The ten raw SR findings remain accounted for as ten fixed-now. This follow-up
adds N09–N11 repairs and the local N12 CI repair without losing earlier evidence.
It makes no independent-reviewer quality claim. The earlier reviewer assessment
remains historical.

Whole-PR readiness remains unproven. At a0991825e every unit shard passed, Lint
failed and browser E2E was canceled. Final pushed-head CI still needs inspection.
Earlier H04/H08/F07 evidence gaps remain in their migration audit. The coverage
map retains arbitrary asynchronous providers, persistence readiness, later
infinite-page changes, custom filters, concurrent-root schedules and deployed
Start/Electric receiving paths. No known counterexample remains in the exercised
mixed-reader scope. Passing these finite histories is not universal proof.
CodeRabbit remains paused. No new external review request was sent.
