# Shared eager-reload recorder repair

This record covers the shared reload recorder at PR #2377 head
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`, with uncommitted receiving-test
work. The [snapshot](2026-11-18-shared-reload-recorder-snapshot.json) freezes
eight shared semantic/test files and records three informational supporting
fingerprints. The independent approval scopes are stated below; supporting
registry fingerprints do not supply runtime approval.

The runtime reviewer independently found the recorder defect, then authored its
repair at the coordinator's request. Post-repair verification by that reviewer
is self-review. A different enforcement reviewer independently approved the
four-file reload slice at the exact hashes in the snapshot. A later review
approved the shared cleanup/initial-receipt files, then retracted the cleanup
helper approval after finding another recorder defect. The repaired helper and
its exported formatter received fresh approval at their final hashes below.
All eight semantic/test files have independent approvals within these scopes;
initial-receipt and receiving adapter claims retain their separate evidence.

## Law and observation

A complete eager provider result determines the Collection's replacement rows,
including omissions and an empty result. Reload retains its previous rows
before new source entry. A pending optimistic transaction overlays the applied
source rows; settlement drops its unconfirmed row. Authority is the glossary's
`reload`, `snapshot transaction`, and `accepted sync transaction` contracts,
READY-3/PUB-7, and the optimistic-history owner's opening contract.

Provider completion, source commit acceptance, source application, and public
load settlement are separate observations. A recorder must reach comparison
when an adapter loses the public verdict under test. Waiting for that verdict
to establish the comparison premise hides the violation. This is an instrument
repair under ORC-005, ORC-010, and ORC-014; it changes no product contract.

## Finding and repair

The earlier recorder awaited either load settlement or a submitted commit with
enough rows before calling the optional provider barrier. A complete empty
provider whose adapter omitted both `commit()` and `markReady()` satisfied
neither condition. The recorder threw `Persisted startup driver did not reach
its premise`, never invoked the barrier, and never compared the raw result.
Both cleanup and SDK disposal still ran. The independent scratch observation
is retained in `.review-2377/shared-reload-independent-missing-ready-controls.log`.

`EagerReloadSDK.propagate()` is now required. The recorder calls it immediately
after actual target source entry, before awaiting receipt acceptance or
releasing an optimistic transaction. Its contract requires actual complete
provider-result delivery and SDK consumption independently of Collection
readiness, source commit calls, and receipt visibility. A synchronous receiver
may resolve immediately only with an argument about its synchronous source
path. A task delay alone supplies no provider-completion premise.

After that barrier, actual commit receipts establish acceptance. The recorder
releases and awaits the optimistic transaction, then awaits receipt
application. A second provider barrier and actual receipt drain capture work
unblocked by application. Four final task turns drain finite continuations;
they do not define a provider latency limit. The returned raw observation
contains `settledAfterSource: false` when the public load remains pending.

The model, history grammar, run budgets, and product code did not change in
this repair. Completed raw observations retain separate cleanup diagnostics
through `retainOracleCleanupObservation`.

## Evidence block

- **Law:** complete-result replacement and load settlement after actual source
  delivery/application, under the authority above. A missing verdict remains
  representable at the comparison checkpoint.
- **Reach:** the existing generated reload grammar still constructs all eleven
  states. The independent final Query, Convex, and RxDB runs reached every state in
  both fixed-seed and fresh-seed campaigns. Exact per-property counts are in
  the snapshot. The new ordinary controls calibrate the recorder; they do not
  claim new generated product coverage.
- **RED:** from `packages/db-adapter-conformance`,
  `node ../../node_modules/vitest/vitest.mjs run tests/eager-reload-projection.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot`
  with the old recorder and added controls produced **1 failed / 28 passed**.
  The empty-result control failed at the old premise wait. This is a recorder
  failure reproduction, not a semantic product RED or a semantic mutant kill.
- **GREEN:** the same command with the repaired recorder passed **29/29**.
  The controls observe pending empty/no-commit/no-readiness delivery, pending
  nonempty/no-readiness delivery, a valid provider completing after twelve
  task turns, and wrong rows with both source-cleanup and SDK-disposal failures.
- **Mutant:** omitting readiness and commits from the complete empty source
  now returns raw `pending`, zero submitted commits, and zero readiness calls.
  The unchanged shared checker rejects `load pending after complete source
  application` and `complete source submission not reached`. The valid delayed
  provider is the distinguishing neighbor. Restoring the old prewait rejects
  the recorder control by premise failure, which is classified separately.
- **Limits:** this record closes the identified shared recorder wait defect.
  It does not prove eventual progress for an incomplete provider, bound real
  network latency, or establish every receiver's barrier. Three source keys,
  numeric values, one fresh load or reload, and one disjoint optimistic insert
  remain the reload owner's stated domain. No product-wide closure is claimed.

The RED and GREEN logs are respectively
`.review-2377/shared-reload-empty-completion-red.log` and
`.review-2377/shared-reload-empty-completion-green.log`. Source hashes and log
hashes are retained in the snapshot. Later lint-only edits replaced needless
`async` fixture methods with resolved promises; the final 29-test run and
independent review use the frozen ordinary-test source.

## Receiving evidence

The runtime reviewer independently reran these actual receiving paths on the
required-barrier shared recorder. Each normal command used `--maxWorkers=1`.

| Path | Result | Completion premise |
| --- | --- | --- |
| Query cache / real QueryObserver | 133 passed, 4.05 seconds | Complete cache result is installed before target source entry; actual sync reads `observer.getCurrentResult()` synchronously. |
| Convex JavaScript, React, app wrapper | 318 passed, 48.31 seconds | Await actual staged SDK Transition delivery, then drain its finite callbacks. |
| RxDB memory storage | 106 passed, 14.87 seconds | Actual adapter storage query returns an exhausted empty page; fixture helper reads cannot supply that event. |

An additional independent actual Chromium run received all 24 existing
`eagerReloadHistories` through the final RxDB facade; every shared comparison
passed. A fresh-empty actual SDK fault suppressed both source callbacks and
returned raw pending, zero commits, and zero readiness calls. The shared checker
reported the two intended violations. The one scratch receiving test passed
in 3.12 seconds with no page errors. It reuses the unchanged model and recorder;
it adds no separate expected row model. The log is
`.review-2377/shared-reload-rxdb-final-browser.log`. The snapshot retains the
scratch receiving source hashes and the fault's raw observation.

The first RxDB amendment passed 106 tests, but its storage-query wrapper also
saw fixture replacement queries. Source inspection identified that premise
scope problem. The receiver author isolated adapter source queries with a
transparent RxCollection/storage facade passed only to the adapter. Fixture
replacement retains the original RxCollection and storage instance. The final
106-test run above uses source hash `5ea628e1`; the earlier green is superseded.

The receiver author also ran paired clean and missing-commit/missing-readiness
empty controls for all six receiver variants: Convex JavaScript, React, and
app wrapper, RxDB, TrailBase SDK, and LocalStorage. All six pairs reached the
shared comparison: clean passed; the source fault returned raw pending and the
two intended semantic violations. The run passed **6/6**, 1.99 seconds, in
`.review-2377/reload-provider-barrier-controls.log`. The independent enforcement
reviewer inspected the final barrier sources and paired controls and approved
the four adapter barriers. This is author-executed receiving evidence with
independent source review; it is separate from the runtime reviewer's reruns.

Electric's receiver author supplied Node and Chromium comparisons for the same
fresh-empty history. A wrapper suppressed actual adapter commit and readiness
calls; both hosts returned raw pending/zero calls and the shared checker
rejected them. The clean same-history neighbors passed. Logs are
`.review-2377/cross-electric-empty-liveness-{node,browser}.log` and
`.review-2377/cross-electric-empty-liveness-clean-{node,browser}.log`.
Source inspection confirms its barrier observes the actual installed
ShapeStream subscriber's up-to-date batch completion and returns the callback's
original result. These executions are author-reported here, separately from
the independent reviewer executions below.

Direct's barrier observes the target sync invocation's new protocol completion
and SDK `ready` state before its transport drain. It reads neither Collection
status nor public rows. The coordinator reported a 173-test Node run; final
real-host evidence remains in the Direct receiving record. Native PowerSync,
Neon, TrailBase, and LocalStorage barrier evidence belongs to their receiver
authors. No passing unrelated path substitutes for their completion premise.

## Independent review and guide conformance

The independent enforcement reviewer approved driver `3e178cd5`, model
`f77417e0`, suite `fea78064`, and ordinary controls `ca4e5e61`. That reviewer
independently ran all 29 controls and actual RxDB empty/nonempty missing-ready
controls. Raw semantic differences survived cleanup. It also checked actual
Electric empty/missing-commit/missing-readiness controls in Node and Chromium.
Those independent Electric logs are
`.review-2377/enforcement-electric-empty-liveness-{node,browser}.log`.
Per-receiver final barriers retain their own exact-source records.

An earlier independent enforcement review approved the following files. The
cleanup helper's approval was subsequently retracted by the finding below;
the initial-receipt approvals remain valid at their unchanged hashes.

| Shared file | SHA256 prefix | Approved scope |
| --- | --- | --- |
| `packages/db/tests/oracle-cleanup.ts` | `62e00759` | Primary failure and separate cleanup diagnostics; every cleanup is attempted. |
| `packages/db/tests/oracle-cleanup.test.ts` | `f60d1977` | Actual helper controls for failure fidelity and retained completed observations. |
| `packages/powersync-direct-collection/tests/initial-receipt-oracle.ts` | `c75895ab` | Declared applied/rejected receipt outcomes and their independent comparison. |
| `packages/powersync-direct-collection/tests/initial-receipt-oracle-suite.ts` | `5dad5ea2` | Product judgment precedes separate receiving cleanup diagnostics. |

The reviewer independently ran the actual cleanup helper tests: **3/3 passed**
in 483 milliseconds. Log `.review-2377/enforcement-shared-cleanup-four.log`
has SHA256 `bc841a7dcf40b5187c0250929d213badf124a87ad2e5dd35f2379f9a49c08f8e`.

A separate checker calibration used `initialReceiptModel(history, 'applied')`
for a held receipt and empty source. An otherwise matching raw observation had
`receiptRejected: false` and no `receiptSettled`. The shared comparison
rejected it with `receiptSettled`; adding `receiptSettled: true` passed.
This is model/checker calibration, not a production-driver fault or a new
production receipt mutation claim. Log
`.review-2377/enforcement-shared-receipt-applied-control.log` has SHA256
`a1eb79e6b44f8ca135a950ea6a9a2fed94311f622af2006b3360a4b919779c60`.
Existing Neon Node/Chromium receiving evidence remains in its separate record.
The earlier all-eight approval is superseded for the helper and its ordinary
tests by the repair below. Adapter integration and portfolio readiness remain
separate.

### Secondary diagnostic formatting repair

The independent reviewer ran a completed wrong raw observation whose later
cleanup threw `Object.create(null)`. The old helper called `String(error)`;
that conversion threw a new TypeError. Later release still ran, but completed
raw rows were lost before comparison. The reviewer retracted helper failure-
fidelity approval at source `62e00759`. This finding remains preserved in
`.review-2377/enforcement-shared-cleanup-undescribable.log`.

The violated instrument law is ORC-010: retain the primary observation,
distinguishable secondary diagnostics, and every teardown attempt. The runtime
reviewer authored the repair after ordinary controls reproduced it on the old
helper. Formatting now guards primitive conversion, prototype lookup, nested
error access, and aggregate traversal. An ancestor set detects cycles, and
depth 32 produces a stable truncation label. Ordinary aggregate reasons remain
expanded; an exotic formatting failure gets a stable fallback label. The raw
rows and prior diagnostics remain available independently of that description.

- **RED:** the added controls on helper `62e00759` produced **7 failed / 4
  passed**, log `.review-2377/shared-cleanup-total-format-red.log`. These are
  recorder failures or diagnostic-limit assertion failures, not semantic
  product mutant kills.
- **GREEN:** the amended helper tests passed **11/11**, log
  `.review-2377/shared-cleanup-total-format-final-green.log`. The ordinary
  reload controls also passed **29/29**, log
  `.review-2377/shared-cleanup-total-format-reload-controls.log`.
- **Distinguishing controls:** null-prototype object; throwing conversion
  proxy; throwing prototype lookup; throwing aggregate `errors` getter;
  self-containing aggregate; depth-40 aggregate; ordinary nested aggregate;
  and aggregate containing an unprintable reason. Every control retains wrong
  rows and prior diagnostics, reports a later cleanup failure separately,
  and observes all three teardown calls.
- **Limits:** this changes test machinery only. Product models, public APIs,
  provider premises, receiving histories, and run budgets stay unchanged.
  Diagnostic detail beyond depth 32 is summarized, preserving the completed
  raw observation and the separate cleanup entry. Broad provider runs are
  historical evidence under their recorded helper dependency, carried through
  this narrow formatter amendment only after independent review.

The intermediate repaired helper `23497e2b` received independent source review,
an independent **11/11 GREEN**, and a combined null-prototype/self-cyclic
aggregate control. That control retained wrong raw rows, prior diagnostics,
two separate cleanup diagnostics, and the later release. Logs are
`.review-2377/enforcement-shared-cleanup-total-format-green.log` and
`.review-2377/enforcement-shared-cleanup-total-format-hostile.log`.

The same formatter was then extracted as the one-argument export
`describeOracleCleanupError(reason: unknown): string` in
`packages/db/tests/oracle-cleanup.ts`, and the existing retainer calls it.
The final helper hash is
`15317e3871120de3840160b070d902e765989fe070112fbbf3d14d87b84bf6bc`;
ordinary tests remain
`3b9d62134f58bea524f1d0bba1ed89aa2a54ad606f3c0846d0f02a8a598cfb22`.
The independent reviewer approved that exact extraction and independently ran
**11/11 GREEN**, log
`.review-2377/enforcement-shared-cleanup-export-final-green.log`. The author
also reran those eleven controls at the final export. Scoped ESLint passed.

The reviewer permitted normal provider, reload, and receipt evidence to carry
across this error-formatting-only amendment with the final dependency hash.
Those original runs remain attributed to their actual older helper snapshots.
The newly found Direct main/cursor retainer and nested cleanup callers require
their own adoption and ordinary controls; their fixes and the bounded caller
audit remain owned by the receiving reviewers. This shared helper approval
does not close that caller inventory or claim adapter-wide readiness.

| Requirement | Outcome for this repair |
| --- | --- |
| ORC-001 | Existing product authority and reload limits remain; no new product promise. |
| ORC-002 | Independent complete-result model unchanged; provider barriers establish premises and compute no expected rows. |
| ORC-003 | Driver prose states provider completion, acceptance, application, and load-settlement cuts beside their code. |
| ORC-004 | Grammar unchanged; existing fresh/reload, masks, and mutation dimensions remain. New controls distinguish missing verdict from slow valid delivery. |
| ORC-005 | Raw pending load now reaches the shared comparison, including empty delivery with no source callbacks. |
| ORC-006 | Missing-verdict controls are rejected semantically after repair; old recorder RED is explicitly a premise failure. |
| ORC-007 | Existing seed 2367 and fresh-seed 80-history campaigns, direct replay, and normal comparisons remain. Executed run coordinates are in the snapshot. |
| ORC-008 | No reference-model state was introduced, removed, combined, or split. |
| ORC-009 | Provider completion is distinct from Collection readiness, acceptance, application, and public settlement. |
| ORC-010 | Missing verdict returns raw evidence; ordinary cleanup control retains wrong rows and separate cleanup/disposal diagnostics while attempting both releases. |
| ORC-011 | No new plausible fault shared by product semantic machinery and the independent row model was identified in this recorder repair; no second model was added. |
| ORC-012 | This versioned record and exact snapshot bound the authored repair and independent review separately. |
| ORC-013 | Empty missing verdict and delayed valid completion distinguish the hidden wait and an invented four-turn provider deadline. |
| ORC-014 | Required provider completion API states the premise; receiver-specific evidence is attributed above, with unresolved final freezes named. |
| ORC-015 | Existing eleven constructed states and generated-output reach checks remain. Every state appears in the final Query, Convex, and RxDB campaign counts. |
| ORC-016 | Added concrete recorder controls remain in the ordinary `eager-reload-projection.test.ts`; no ordinary example was placed in an oracle file. |

Scoped conformance TypeScript, changed-file ESLint, and global
`pnpm lint:changed` passed. The snapshot retains command logs and source hashes.
Repository-wide adapter readiness remains outside this report.
