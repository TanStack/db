# Issue #2085: leader close during a source commit

Review date: 2026-10-08. Source: [issue #2085](https://github.com/TanStack/db/issues/2085), including its setup, result, and three proposed responses. Baseline commit: `f6aba314e44afdfa413d6d70bf8e272dfa67af85`. This record describes the uncommitted `codex/issue-2085-repro` worktree diff against that commit. The source has no file/line references or severity labels and no visible comments. The claim ledger was written before testing and retains source order.

## Reviewer assessment

This is an issue report, not a pull-request review. Its stack trace and failing phase accurately identify the coordinator and persisted wrapper boundaries. The six-run count and proposed remedies are useful hypotheses, but they do not decide the recovery contract. One report does not support a hiring recommendation.

## Lossless claim ledger

`confirmed-open` means the reported symptom or a valuable question remains open; it does not imply that every variant was reproduced. `accepted-design` cites existing contract behavior. No item is deferred or called fixed.

| ID | Source-order claim or proposal | Technical verdict and evidence | Disposition and durable value |
| --- | --- | --- | --- |
| I01 | A normal leader-tab close can leave surviving Collections in permanent error; the reporter saw 3/6 runs. | Confirmed for one Collection in the controlled and real Chromium/OPFS after-durable close history. Frequency and seven-Collection topology untested. | `confirmed-open`; candidate survival law and browser host owner below. |
| I02 | A follower's Electric-sourced `rpc:applyCommittedTx` waits 10 seconds, crosses leadership, and rejects with `IndeterminateCommitError`. | The real browser manual source commit waited for the 10-second RPC deadline and rejected with that exact error across term 1→2. Electric delivery itself was not run. Existing coordinator oracle already pins the direct RPC result. | `accepted-design` for the RPC-level result under #1845; I01 remains open at the Collection level. |
| I03 | Other Collections fail similarly, sometimes through `flushQueuedHydrationTransactionsUnsafe`. | Code has that route, but neither new witness entered it. No seven-Collection or queued-hydration claim follows from this run. | `confirmed-open`; browser composed owner needs a held hydration history. |
| I04 | The Collection stays in `error`, later `update()` throws, and live rows stop. | Both new witnesses saw `error` and a rejected later source commit carrying the same indeterminate error. They did not call `update()` or drive later server rows. | `confirmed-open`; public status and later source-commit subclaims reproduced, mutation/server subclaims need witnesses. |
| I05 | The closing leader logs `PersistedCollectionDurabilityError` about its SQLite connection closing. | The host witness closes after the durable write, so no pending leader SQLite call emits this diagnostic. Its causal role is unknown. | `confirmed-open`; OPFS page lifecycle owner needs an active-write close witness. |
| I06 | In other runs the follower takes all locks and continues sending/receiving. | The real idle-close control elects the follower and accepts its next source commit. The reported 3/6 frequency and all-lock scope are untested. | `accepted-design`; keep the idle-close control beside the crossing case. |
| I07 | A sync source can deliver the same changes again from a durable resume offset. | Electric stages `electric:resume` metadata with its source transaction; the existing live Electric resume oracle covers reopen histories. This run used a manual source, so it cannot prove same-run redelivery or safe automatic reconciliation. | `design-decision`; source-backed recovery needs an Electric receiving witness and policy. |
| I08 | The closing leader could reject or drain pending RPCs, perhaps on `pagehide`, avoiding the wait. | OPFS already aborts its own worker calls on `pagehide`; the coordinator does not notify remote RPC requesters before its timeout. Faster rejection alone leaves a committed, unanswered write indeterminate. | `design-decision`; latency policy and a separate timing law if adopted. |
| I09 | The runtime could rehydrate and resume sync-sourced work itself instead of fail-stopping. | This conflicts with the documented #1845 application-reconciliation policy for uncertain mutating RPCs. The host witness proves the durable-success branch but not the durable-failure branch. | `design-decision`; choose ownership and reconciliation checkpoints before changing production. |
| I10 | If the application owns reconciliation, document whether cleanup followed by a new Collection is supported. | The guide says to check durable state before retrying, but supplies no source-Collection recovery sequence. This experiment did not execute cleanup/recreation as recovery. | `confirmed-open`; documentation and executable application recovery witness. |
| I11 | No standalone reproduction existed; the reporter offered to reduce the app case. | The controlled and Chromium/OPFS fixtures now reproduce the public failure without the app. They manually drive the source and do not run Electric. | `stale` for the absence of a standalone reproduction; an Electric receiving witness remains open under I07 and I11. |

Accounting: 11 raw items = 5 `confirmed-open` + 2 `accepted-design` + 3 `design-decision` + 1 `stale`. There are no duplicates, refutations, fixes, or agreed deferrals.

## Law discovery and tension

**Existing law, approved:** After a mutating RPC loses transport, the requester retries only when it still knows the same non-null leader ID and term. Unknown or changed leadership yields `IndeterminateCommitError`; the application reconciles. The [browser README](../../../packages/browser-db-sqlite-persistence/README.md) and [core README](../../../packages/db-sqlite-persistence-core/README.md) state this. The existing `fails indeterminate when a committed success is lost across leader change` test enforces it. A closed leader can have committed without answering, as the host durable snapshot confirmed; retrying the mutation blindly against the new leader would violate the uncertain-outcome boundary.

**Candidate law from the issue:** For a source-backed Collection in a surviving tab, a normal close of another tab should not make the surviving sync run permanently unusable. The first source receipt may reject as uncertain. After leadership transfer and reconciliation, a later source commit should settle and the Collection should be `ready`. This candidate is not an approved product contract. The new assertions intentionally stay RED pending a decision.

The rival policy is application-led reconciliation. It permits the current terminal `error` and requires the application to inspect durable state and restart or recreate the Collection. The issue's source-backed premise could justify a different owner because the source cursor is durable with the rows, but that does not itself specify who restarts the sync run, whether a public snapshot may remain visible while checking durable state, or how pending applied receipts settle. Both policies agree that the original RPC must not be blindly resent to a replacement leader.

The smallest distinguishing history is the one tested: the leader finishes a durable `PersistedTx`, its answer is held, the page closes, and the follower takes leadership. The idle-close control keeps all other setup similar and shows that ordinary takeover succeeds. A second necessary branch is close before durability; it remains open. The source of policy authority, rather than the test harness, must choose between automatic and application-led recovery.

## Oracle chain and RED evidence

| Layer | Controlled owner | Real host receiver |
| --- | --- | --- |
| Contract and model | Candidate later-usability rule stated beside the new test in `browser-coordinator-oracle.test.ts`; it permits either first-receipt outcome. | `expectedSurvivor()` predicts `ready` and a fulfilled later source receipt without consulting production. |
| Legal history | One follower source commit; leader applies durably; mock response is dropped; leader is disposed; follower takes leadership; second source commit. | Same ordering with two Chromium tabs, real BroadcastChannel, Web Locks, OPFS workers, and SQLite. The leader's regular scoped adapter holds after durable apply; `page.close()` supplies the host event. An idle-close control omits the first commit. |
| Production path | `persistedCollectionOptions` wrapped sync → `BrowserCollectionCoordinator.requestApplyCommittedTx` → transport timeout → wrapped receipt and Collection status. | Same wrapper and coordinator through actual browser host and SQLite adapter. This fixture manually drives sync; it does not run the Electric SDK. |
| Observation cuts | Dropped successful response and leader adapter call before disposal; follower election before RPC timeout; Collection status and later receipt after timeout. | Leader hold after durable apply before close; follower election; first receipt after deadline; status, later receipt, public IDs and durable IDs after the later attempt. |
| Calibration | Baseline implementation reaches the public comparison and fails. Existing direct-RPC test passes its expected indeterminate result. | Idle close passes. In-flight close reaches the same public comparison and fails after 10.6 seconds; durable IDs still contain `crossing`. |

Exact results on baseline `f6aba314e44afdfa413d6d70bf8e272dfa67af85`:

- The existing direct-RPC indeterminate test passed: 1 passed, 153 skipped.
- The new controlled candidate test failed at `collectionStatus`: expected `ready`, actual `error`; later source receipt expected fulfilled, actual rejected.
- The new Chromium/OPFS pair yielded 1 passed idle-close control and 1 failed in-flight case. The failed case recorded `firstOutcome.errorName = IndeterminateCommitError`, term 1→2, `collectionStatus = error`, the later receipt rejected with the same error, public IDs `[crossing]`, and durable IDs `[crossing]`. Cleanup completed without secondary failure.
- Browser package TypeScript check passed after installing the relevant locked dependencies from the local cache. The full workspace offline install could not complete because an unrelated Electron tarball was absent; the filtered browser and Electric/e2e dependencies sufficed for these checks.

This is a source-backed *manual* sync witness and a real host transport witness. It is not an Electric redelivery witness. It does not reproduce the reported nondeterministic 3/6 rate, on-demand hydration, seven Collections, `update()`, or the leader's active-write error. Those cells remain assigned to the Browser composed owner, persisted-history owner, and live Electric OPFS receiver as stated above.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Candidate authority and conflict with #1845 are explicit in each new oracle and this record. No approved automatic-recovery law is claimed. |
| ORC-002 | The later-usability expectation comes from the issue's proposed caller behavior, not the coordinator's route classifier or persisted runtime branches. |
| ORC-003 | Opening prose states the law and limits. The model, two legal schedules, production driver, public observations, and comparison cut are adjacent in the controlled and host tests. |
| ORC-004 | Not triggered: these are fixed, bounded histories, not a generated-property coverage claim. |
| ORC-005 | Both tests exercise the named production entry points. Host reach witnesses show the held durable adapter call, page close, follower election, and final public comparison. |
| ORC-006 | The baseline's terminal fail-stop is a concrete wrong result for the candidate law; both comparisons reject it at the intended public checkpoint. The idle host history passes. The direct-RPC accepted law remains green. |
| ORC-007 | Not triggered: no important generated property was added. |
| ORC-008 | Not triggered: the candidate expected result is stateless and does not introduce reference-model state. |
| ORC-009 | `Collection status`, `sync transaction`, `applied receipt`, `publication`, and `cleanup` follow the project glossary. The model's later-usability projection combines status and a later receipt; it claims no durable-content model. |
| ORC-010 | The controlled test and host test preserve a primary mismatch with separate cleanup diagnostics and release their resources. The host page intentionally closes without graceful application cleanup in the crossing history. |
| ORC-011 | A second semantic formulation of Electric cursor recovery is needed if that policy is chosen. The manual source and controlled route can share an assumption that the real SDK does not meet. |
| ORC-012 | This exact-head record accounts for each applicable requirement and names open law × history × path × observation cells. It does not claim bug-class closure. |
| ORC-013 | The idle host case rejects the overbroad rule that every leader close breaks the survivor. The in-flight case reaches the conditional premise and rejects terminal fail-stop under the candidate law. |
| ORC-014 | Real Chromium/OPFS supplies the held-after-durable close premise used by the controlled seam. Electric SDK delivery of an equivalent in-flight source transaction remains unproved and is not credited. |

The candidate law is encoded for these two finite host histories and enforced at the named public cut; baseline production proves sensitivity. It is not fully encoded for before-durable loss, queued hydration, Electric restart, or all Collections. Under the current approved application-reconciliation contract, RED demonstrates the requested symptom and a policy conflict, not an authorized production defect repair.

## Next design decision

Choose whether a surviving source-backed Collection automatically reconciles an uncertain coordinator commit or whether the application must explicitly restart it. For automatic recovery, specify the durable snapshot and cursor read, first-receipt result, public snapshot during recovery, retry scope, and when the Collection becomes `ready`; then add before/after-durable and Electric receiver histories before changing production. For application-led recovery, document and test a supported cleanup/recreation sequence that checks durable state and resumes source delivery. A faster page-close rejection can be evaluated separately after the outcome policy is set.

## Follow-up: exact-ID source reconciliation

The preceding ledger and RED observations are the original baseline audit.
They are retained in source order. The follow-up chose same-run reconciliation
for a source sync transaction when the elected SQLite adapter can certify its
outcome. A direct mutating RPC still rejects as indeterminate after an unknown
or changed route. The persisted wrapper holds the source applied receipt while
the replacement leader checks the immutable `txId` under the writer lock. An
existing ID fulfills the receipt at its original durable position. An absent
ID permits one application only when the durable row version and reset epoch
still equal the pre-send anchor. An intervening durable write, reset, pruned ID,
or unavailable proof retains the original indeterminate error. The bounded
recovery keeps the source Collection and mounted live query in the same sync
run. The published row and opaque source cursor are one durable transaction.

### Updated claim ledger

The following dispositions supersede the baseline ledger; the original 11
source claims above remain unchanged for loss accounting.

| ID | Current technical verdict and evidence | Current disposition and destination |
| --- | --- | --- |
| I01 | The original terminal source Collection is repaired for controlled and Chromium/OPFS manual-source before/after-durable closes. A live Electric delivery of that exact crossing remains unobserved. | `confirmed-open` for the reported Electric path; Browser Electric receiver owns that witness. |
| I02 | Direct RPC still rejects with `IndeterminateCommitError` on changed leadership; the wrapper alone invokes exact-ID reconciliation. | `accepted-design` under the #1845 RPC contract; coordinator oracle retains the direct-RPC check. |
| I03 | The wrapper oracle now drives a receipt queued behind persisted hydration through an exact-ID decision and later work. The real-host queued case and seven-Collection topology remain unobserved. | `confirmed-open` for the host receiving schedule; Browser hydration owner. |
| I04 | Controlled and OPFS witnesses assert `ready`, one sync run, mounted live-query rows, and a fulfilled later source receipt. A direct `update()` call and later Electric row were not driven. | `confirmed-open` for those reported entry points; Browser Electric receiver and mutation-path owner. |
| I05 | No new active-write page-close witness reproduces the closing leader's SQLite diagnostic. The after-durable hold closes after its SQLite call. | `confirmed-open`; Browser OPFS page-lifecycle owner. |
| I06 | Idle close still transfers leadership and accepts later work. | `accepted-design`; retained host control. |
| I07 | Durable source cursor metadata is atomic with each manual source row, and exact-ID reconciliation prevents a blind replay. The installed Electric SDK was not driven through the crossing. | `confirmed-open` for the real provider receiving path; Browser Electric receiver. |
| I08 | Earlier page-close rejection could reduce the 10-second wait but cannot decide a committed, unanswered write. | `design-decision` about latency, separate from the certified outcome law. |
| I09 | The chosen source-backed policy holds the first receipt through certification and stays in the same sync run on a certified result. Unknown results still fail closed. | `fixed-now` for the bounded source/SQLite policy; wrapper, adapter, coordinator, and OPFS owners below. |
| I10 | Automatic source reconciliation replaces the proposed application cleanup/recreation sequence for certified source transactions. Direct mutating RPC callers still own reconciliation, as both package guides say. | `stale` for this source-recovery alternative; retain the direct-RPC documentation question under I02. |
| I11 | The controlled and OPFS standalone fixtures remain executable. | `already-fixed`; the missing Electric provider witness is retained under I01 and I07. |

Accounting: 11 original items = 5 `confirmed-open` + 2 `accepted-design` +
1 `design-decision` + 1 `fixed-now` + 1 `stale` + 1 `already-fixed`.
There are no refutations, duplicates, or agreed deferrals. The open rows name
unproved receiving paths; they are not claims that the bounded repair failed.

### Adversarial oracle review ledger

Two independent reviewers attacked the model, production driver, and receiving
schedules. This ledger retains their distinct findings and challenges rather
than merging them into the issue ledger.

| ID | Reviewer claim or challenge | Verdict, action, and durable value |
| --- | --- | --- |
| R01 | The replacement coordinator could release its writer lock before advancing its stream position. | Confirmed and fixed inside the lock; the Browser coordinator oracle checks a queued later write. |
| R02 | A reconciliation wire request without a durable anchor could apply an uncertain transaction. | Confirmed and fixed at RPC and SQLite boundaries; malformed-anchor assertions reject before storage work. |
| R03 | A newly elected peer may miss the original committed-row notification. | Confirmed by the OPFS after-durable history and fixed with a reconciliation reload notification. |
| R04 | An absent ID after a peer write could overwrite a newer same-key row and opaque cursor. | Confirmed design constraint: fail closed. The SQLite oracle retains the same-key/cursor witness; no late apply is claimed. |
| R05 | Reconciliation reload after the original notification could duplicate public change events. | Confirmed and fixed by skipping only an unchanged reconciliation replacement. The wrapper and passive OPFS observer assert exact event counts. |
| R06 | A local SQLite failure during reconciliation could be replaced with the original indeterminate error. | Confirmed and fixed; remote and local durability classifications have separate wrapper checks. |
| R07 | `NOT_LEADER` during reconciliation could fail although a newer route is available. | Confirmed and fixed with bounded exact-ID rerouting; the Browser coordinator oracle drives the route change. |
| R08 | The SQLite exact-ID test reused a transaction ID with a different payload. | Confirmed test-integrity flaw and fixed; the test now keeps the immutable payload while changing only proposed stream position. |
| R09 | A peer-write host history could reconcile before the peer became durable. | Confirmed test-integrity flaw and fixed with a gate before the requester enters the writer lock; the host asserts durable version 2 before release. |
| R10 | Skipping an equal snapshot might fail to reorder Collection keys. | Unconfirmed. A direct Collection probe truncated and reinserted equal rows in reverse order without changing public key order. The new skip is limited to reconciliation reloads. |
| R11 | Equal row values can hide row metadata for a missing key, so the shortcut might skip required cleanup. | Confirmed by a RED wrapper oracle: `ghost` metadata remained after reload. A Collection internal delegation now finds orphan metadata; reconciliation removes it without republishing unchanged rows. |
| R12 | The old coverage map still described a RED candidate and missing before/after schedules. | Confirmed and corrected in the coverage map; this addendum preserves the historical RED record. |
| R13 | Mixed-version tabs may not understand the new reconciliation reload marker. | Valid coverage limit. Both guides scope same-run recovery to same-version tabs; no cross-version behavior is claimed. |
| R14 | A controlled queued-hydration witness and manual source driver do not prove real-host queued hydration or Electric SDK delivery. | Valid receiving gaps, owned by the Browser hydration and Electric suites. |

The reviewers separated product failures, test-integrity defects, a refuted
ordering concern, and real receiving gaps. Their high-signal findings changed
the oracle and repair. Both would receive a positive reviewer recommendation;
neither claimed a passing finite suite proved arbitrary histories.

### Law chain, checkpoints, and calibration

| Law | Independent expectation and legal histories | Production path and asserted cut | Sensitivity |
| --- | --- | --- | --- |
| Certified source receipt | One immutable source payload is either already durable by ID or may be applied once against an unchanged anchor. Before/after-durable, queued hydration, and later source work are authored independently of the coordinator classifier. | Wrapped `commit()` through Browser coordination and SQLite. At the uncertain cut its receipt is pending; after certification it fulfills with Collection/live query ready in the same run; a later receipt fulfills. | Original baseline failed at Collection `error` and later receipt rejection. Repaired controlled and OPFS histories pass. |
| Durable exclusion | An absent ID with a changed row version or reset epoch cannot authorize late application. Same-key row and opaque cursor distinguish unsafe overwrite. | SQLite transaction checks ID and anchor under the writer lock; adapter oracle compares result, rows, cursor, version, and exact applied IDs. | The original blind late-apply design would add or overwrite an applied row; the unknown-result and unchanged-anchor controls distinguish the rule. |
| Peer publication | A peer that missed the original notification reloads rows even at an equal stream position, while a peer that already published them emits no duplicate batch. | Three real OPFS tabs at the passive public source/live-query checkpoint; `after-peer` holds before reconciliation until peer version 2 is durable. `after-notify` records exact passive event keys. | Removing only `reconciliationReload: true` reached the peer's durable version 2 gate, then failed at the passive checkpoint: public and live IDs were `[peer]` instead of `[crossing, peer]`. Marker restored; both histories pass. |
| Metadata cleanup without row republish | Equal loaded rows can coexist with metadata for a missing key; a reconciliation reload removes that orphan while keeping equal row events empty. | Wrapper oracle records `metadata.row.get('ghost')`, source/live change batches, and row sets after the reload. | Before the cleanup fix, `ghost` remained; after the first guard-only fix, `crossing` republished. The final targeted metadata deletion passes both assertions. |
| Failure classification | An unprovable outcome retains indeterminate source failure; a known local or remote SQLite failure keeps its durability class and path. | Wrapper oracle checks first receipt and later source admission at terminal cuts for unknown, remote durability, and local durability. | The local broad-catch design lost the durability class; the refined branch preserves it. |

The controlled wrapper oracle is the primary source-lifecycle owner. The
SQLite adapter oracle supplies an independent durable ledger. The Browser
coordinator oracle owns route and writer-lock order. The OPFS host test is the
receiving witness for real browser transport and storage; its manual source is
not the Electric SDK. `source-reconciliation-repeat` also tests orphan metadata
through the real Collection sync implementation. The orphan key is absent from
loaded rows, so full replacement would clear it. The added internal delegation
finds that exact mismatch without exposing the state map to the persistence
package.

### Verification and remaining boundary

The focused SQLite CLI contract passed 43 tests; the wrapper suite passed 653
with one existing todo; the Browser coordinator suite passed 158 after its
local `better-sqlite3` binary was restored from the matching package version.
Chromium/OPFS passed all five schedules. Core and Browser TypeScript checks
passed. The new orphan-metadata assertion was RED before the fix and GREEN
after it. The reconciliation-marker mutant was killed at the first passive
public row checkpoint after the peer-before-reconciliation gate and restored.
Vitest printed unrelated missing Expo tsconfig diagnostics; its test results
above completed.

These are finite same-version, manual-source histories. A live Electric
receiving witness, a real-host queued-hydration close, and an active-write
leader diagnostic remain outside this evidence. They are recorded in the
coverage map with receiving owners. The implementation deliberately keeps an
absent ID after another durable write indeterminate, because no contiguous
ledger proof can establish that a late source payload will not regress a
newer row or cursor. That valid history does not enter same-run recovery.

## Follow-up: Electric receiving and prep review

The preceding verification paragraph records its earlier manual-source cut.
The new `electric-leader-close.opfs.spec.ts` supplies the installed Electric
SDK at the reported after-durable boundary. PostgreSQL authors one
`crossing` row. The follower's Electric sync creates its source transaction,
and the leader's collection-specific scoped adapter holds only after SQLite
applies it. The page then closes without an RPC answer. At the first receipt
checkpoint, the original Electric applied receipt has fulfilled in sync run
one; the source Collection and mounted live query are ready with the row; the
durable row and the exact applied transaction ID agree. The source transaction
itself contains the `electric:resume` set. Its kind, offset, handle, and
shape ID equal the first durable resume identity, whose offset has advanced
from the empty baseline. A later PostgreSQL row
advances the offset again and reaches public, live, and durable rows in the
same run. The direct coordinator RPC still reports
`IndeterminateCommitError`. A manual-source Collection owns only the first
leader term; this does not model two Electric streams contending in both tabs
or seven concurrent Collections.

The first two Electric attempts timed out before the held boundary because
the fixture intercepted the root adapter rather than the Collection-specific
adapter; the unmounted live query also cleaned itself up. They are setup
failures, not RED evidence. The corrected driver reaches the held durable
boundary and passes. The complete Electric OPFS suite passed 16 tests with
the new witness.

### Electric oracle attack ledger

Two independent oracle reviewers inspected the new receiving law and driver.
Each raw suggestion remains distinct even where it overlaps another.

| ID | Reviewer claim | Technical verdict, PR action, and durable value |
| --- | --- | --- |
| EL01 | RPC rejection and reconciliation booleans do not prove the Electric `commit()` applied receipt settles. | Confirmed gap; `fixed-now`. The source sync wrapper observes the crossing receipt pending at the hold and fulfilled at the first checkpoint, with one sync run. |
| EL02 | A resume marker after crossing might be the empty stream's earlier marker. | Confirmed gap; `fixed-now`. Baseline and first durable offsets are compared. |
| EL03 | Comparing resume objects after the later row can pass from `updatedAt` churn at the same offset. | Confirmed gap; `fixed-now`. The test compares offsets at all three checkpoints. |
| EL04 | A manual first-term leader does not prove two Electric streams or seven Collections. | Valid limit; `fixed-now` in the executable opening prose and coverage map. The first-term source choice does not weaken the follower's installed SDK path. |
| EL05 | Distinct durable offsets alone do not show that the crossing row and cursor were in the same source transaction. | Confirmed gap; `fixed-now`. The follower records the crossing `PersistedTx.collectionMetadataMutations` and compares its resume offset with the first durable offset. |
| EL06 | The Electric resume handle and shape ID could differ even at the same offset. | Confirmed precision gap; `fixed-now`. The source transaction and first durable marker compare kind, offset, handle, and shape ID; `updatedAt` is intentionally excluded. |
| ED01 | The first durable marker could predate the crossing row. | `duplicate` of EL02; retained as the driver's missing baseline observation. |
| ED02 | Retaining only the first crossing `txId` could hide a second logical crossing commit with a fresh ID. | Confirmed gap; `fixed-now`. The driver records every crossing ID and the spec requires exactly one before and after the later row. |
| ED03 | Status and later rows do not prove the original receipt or one sync run. | `duplicate` of EL01; retained as the driver's required `write`/`commit` observation. |
| ED04 | Reconciliation success booleans do not identify which transaction was certified. | Confirmed precision gap; `fixed-now`. Successful reconciliation IDs must equal the authored crossing ID at the first checkpoint. |

The reviewers correctly separated a setup path, receipt settlement, cursor
provenance, and a valid receiving limit. Their findings improved the test
without changing the product law. Both would receive a positive reviewer
recommendation: the findings were technically accurate, specific, and
prioritized by false-green risk.

Electric review loss audit: 10 raw items = 8 `fixed-now` + 2 `duplicate`.
No Electric review item remains open inside the declared one-provider
after-durable history.

### Prep review ledger

The correctness review and simplifier review were read-only. Their raw items
appear in source order within each review; `C03` and `S01` intentionally
overlap.

| ID | Raw review claim or proposal | Technical verdict, PR action, and durable value |
| --- | --- | --- |
| C01 | Ordinary `deepEquals` can call a sparse public array equal to SQLite's dense `null` array, suppressing a needed reload; an enumerable extra array property is another lost shape. P2 at `persisted.ts` snapshot comparison. | Confirmed by two RED wrapper histories. `fixed-now` with `deepEqualsStrict` and the two GREEN histories. Law: a skipped replacement must preserve complete durable row shape at the reconciliation checkpoint. The old oracle observed rows and duplicate events but lacked this value-shape axis. |
| C02 | The OPFS host read exact applied IDs but asserted only their count. P3 coverage idea. | Confirmed host false-green gap. `fixed-now`: authored IDs now equal the complete durable ID sequence at the first and later checkpoints; SQLite's independent adapter oracle also compares exact IDs. |
| C03 | The reconciliation response's `current` field was never read by the wrapper. P4 cleanup. | Confirmed; `fixed-now`. Removed only the wire field, retaining the coordinator-local current position for peer publication. Typechecks and the wrapper/coordinator suites pass. |
| S01 | Remove the unused `current` wire field and mock fields. | `duplicate` of C03; the same cleanup was applied. |
| S02 | Put optional `reconcileCommittedTx` in `CoordinatorAdapter`'s `Pick` union. | Confirmed safe type cleanup; `fixed-now`. Runtime behavior is unchanged and package typechecks pass. |
| S03 | Name and reuse the common reset-epoch predicate inside SQLite's locked anchor branch. | Confirmed small clarity improvement; `fixed-now` as `sameResetEpoch`. The direct adapter guard remains independent of wire validation. |
| S04 | Do not merge the host expected-result computation with driver wait values merely to save lines. | `already-fixed`: the independent expected history and production driver remain separate under ORC-002/003. |
| S05 | Do not share an anchor validator across untrusted RPC and direct SQLite boundaries. | `already-fixed`: both checks remain at their respective trust boundaries. |
| S06 | Do not remove unchanged-snapshot and orphan-metadata handling for a broad line reduction. | `already-fixed`: the passive duplicate-event and orphan-metadata witnesses require both behaviors. |
| S07 | Keep `alreadyApplied` in the new response even though the wrapper does not read it. | `already-fixed`: coordinator oracle assertions retain the explicit exact-ID outcome. |

Prep loss audit: 10 raw items = 5 `fixed-now` + 1 `duplicate` +
4 `already-fixed`. There are no omitted footnotes, unagreed deferrals, or
remaining prep-review findings. The correctness reviewer found one P2 product
bug and one host assertion gap; its proposed narrow repairs were accurate.
The simplifier's two wire/type reductions and reset-epoch name were safe, and
its four rejected reductions preserved real oracle or trust-boundary value.
Both reviews had high signal and would receive positive reviewer
recommendations.

### Updated law coverage and limits

The repaired claim is bounded by source-backed immutable transaction IDs,
same-version tabs, exact-ID certification under SQLite's writer lock, and an
unchanged durable anchor for an absent ID. The wrapper's legal histories cover
before/after durability, held receipt, queued hydration, unknown result,
local/remote durability failures, later work, equal-row reload, orphan
metadata, sparse arrays, and extra array properties. SQLite owns the ledger,
version, reset, and cursor decision. Browser coordination owns route and lock
order. The five manual-source OPFS schedules observe real transport,
publication, live rows, event counts, and exact IDs. The Electric receiver
adds the reported provider path for one after-durable crossing and later row.
Each owner asserts its promised public observation at the named held,
certified, and later checkpoints.

ORC-001/002/003: the contract and its limits appear beside independent
models; the Electric expected rows come from PostgreSQL, and no production
classifier computes them. ORC-004/007/008: the new host history is fixed and
adds no generated grammar or stateful reference model. ORC-005: the held
scoped-adapter apply, SDK-authored transaction, original receipt, exact ID,
public/live rows, and durable cursor are reached and compared. ORC-006:
baseline manual-source terminal failure, the peer-publication mutant, the
orphan-metadata shortcut, and sparse-array comparison failure reject
plausible wrong designs at their respective checkpoints. A temporary
Electric-path mutant that threw the original indeterminate error after a
successful exact-ID response reached the first receipt checkpoint and failed:
the applied receipt rejected and source/live status became `error` despite
the durable row. The mutant was restored; the Electric test passed again.
ORC-009: source
transaction, applied receipt, sync run, and publication follow the glossary.
ORC-010: the host preserves a primary mismatch separately from cleanup
failures and closes its pages and PostgreSQL connection. ORC-011/014: the
installed Electric SDK is a second provider formulation and supplies the
after-durable premise previously controlled manually. ORC-012/013: the review
record names the original crossing, idle/before-durable neighboring
histories, hostile wrong designs, and remaining owner cells.

The remaining receiving limits are a real-host queued-hydration close, an
active-write leader diagnostic, two Electric streams in both tabs, the
reported seven-Collection topology, and other browsers. Direct application
`update()` after recovery is also unobserved because this fixture has no
application mutation handler; the later installed Electric row proves source
continuation. These are named coverage cells, not evidence of a reachable
in-scope counterexample to the certified source receipt law. An absent ID
after an intervening durable write still fails closed by design.

### Final integrated verification

The exact reviewed executable head is
`013aa2cb788f562e87ffa0bbc10c1a1073dead43`. It includes the
`362be03006baa210461ce31ba2cf134f3243596b` merge of `origin/main`.
The later review-record and changeset commit changes no executable code.
At this head, the real SQLite adapter oracle passed 43 tests. The persisted
wrapper oracle passed 655 tests with one existing todo. The Browser
coordinator oracle passed 158 tests. All five manual-source Chromium/OPFS
leader-close schedules passed. The full Electric OPFS suite passed 16 tests.
TypeScript checks passed for `@tanstack/db`, SQLite persistence core, and
Browser persistence after the final fixture type correction. The earlier
Vitest Expo tsconfig warnings did not fail these suites.

## Follow-up: CodeRabbit evaluation and Electron receiving path

This addendum evaluates CodeRabbit review `5463528038` at reviewed commit
`613dbc9e001f6a2b93076375e1fcb05932078eda`. Its four inline comments,
subclaims, and optional CLI suggestion yield ten source-order items. The exact
executable follow-up commit is
`a1a3dd8c1cecc6761e93f2c7feaf946bc0830b45`; this addendum changes no
executable code. The earlier verification paragraphs remain historical records
for their named commits.

| ID | Original claim or proposal | Verdict, PR action, and durable value |
| --- | --- | --- |
| CR-1 | Fence reconciliation on `state.leaderId !== this.nodeId`, like ordinary apply. | The inconsistency was real, but the proposed fence fails after a legal no-write Web Lock takeover: the former owner's same-term heartbeat can overwrite the successor's route. `fixed-now`: a local Web Lock leader ignores peer heartbeats. The Browser oracle retains both the queued exact-ID check and a later source write. |
| CR-2a | Alphabetize the `IndeterminateCommitError` import. | `already-fixed` at `6a64f4c67`; affected lint passes. |
| CR-2b | Alphabetize the `ReconciledCommittedTx` import. | `already-fixed` at `6a64f4c67`; affected lint passes. |
| CR-2c | Order `PersistedTx` before `PersistenceAdapter`. | `already-fixed` at `6a64f4c67`; affected lint passes. |
| CR-2d | Keep both defensive anchor guards and correct the nullable SQL type rather than suppressing lint broadly. | `already-fixed` at `6a64f4c67`: RPC and SQLite each validate before work, and `reset_epoch` is nullable at the SQL boundary. |
| CR-3a | Make the first cursor lookup `string \| undefined` before `?? null`. | `already-fixed` at `6a64f4c67`; the nullable fallback remains typed. |
| CR-3b | Apply the same type correction at the second cursor lookup. | `already-fixed` at `6a64f4c67`; this distinct site is retained. |
| CR-4a | Wait for orphan metadata cleanup rather than relying on one async flush. | `fixed-now`: the wrapper oracle holds the reload, checks pending metadata and event state, then waits for cleanup and checks settled public rows and events. |
| CR-4b | Wait for the durable array shape at the second reload site. | `fixed-now`: sparse-slot and enumerable-array-property histories check authored shape during the hold and durable public shape after release. |
| CR-5 | Consider `coderabbit review --agent` after changes. | `refuted` as a required action: this is an optional process suggestion, not a defect claim. Raw comments, independent oracle attacks, mutants, lint, types, and affected suites supplied direct review evidence. The optional idea remains recorded here. |

The review had high signal: its lint and timing findings were accurate, and
CR-1 exposed a real route inconsistency. Its suggested ownership fence was
wrong for a legal same-term history. Fix quality was mixed; the reviewer earns
a positive recommendation with that caveat. The final loss audit is ten raw
items = three `fixed-now` + six `already-fixed` + one `refuted` as a required
process action. No CodeRabbit item is deferred or omitted.

### Law, history, path, and checkpoint audit

For CR-1, exclusive per-Collection Web Lock ownership is the route authority.
The Browser oracle captures a real former-owner heartbeat before a no-write
release, elects the successor at the same term, queues exact-ID reconciliation
behind the writer lock, then delivers the captured heartbeat. It observes the
successor's route at the queued cut, an applied-once exact-ID result after
release, and the next sequence on a later source write; the former adapter
applies nothing. The original handler let reconciliation succeed but made that
later write fail. CodeRabbit's fence made reconciliation fail. Both RED runs
reached their intended comparisons; the repaired handler passes. The existing
queued-transfer history separately checks genuine ownership loss. These are
bounded controlled Browser histories, not arbitrary browser scheduling.

For CR-4a/b, the established reconciliation-reload law removes orphan row
metadata without duplicate row events and publishes durable value shape even
when ordinary change-event equality equates sparse and dense arrays. The
wrapper oracle controls `loadSubset` entry and release. At the held cut,
metadata and authored array shapes remain public. At the settled cut, orphan
metadata is absent, source and live-query rows have the durable shape, and
unchanged rows emitted no duplicate events. The old single-flush assertions
failed before reload completion. A skip-publication mutant reached the
positive settled comparisons and failed all three cases. The OPFS passive-tab
history remains the separate real-browser publication receiver.

CI uncovered a separate Electron receiving gap: the renderer/main IPC bridge
did not expose `reconcileCommittedTx`, so the shared SQLite adapter contract
failed at its explicit operation assertion. The bridge now transports the
immutable transaction and durable anchor, returns the complete result, and
requires protocol v3. The registered SQLite contract exercises exact-ID
reconciliation through both in-process handlers and a real Electron main
process. A resolved-adapter witness checks distinct Collection modes and
schema versions in the reconciliation envelopes; dropping resolution fails at
that assertion. An adapter without the optional operation returns `unknown`
without a durable write; a temporary blind-apply-then-unknown mutant changed
the durable row and version and failed at the no-write assertion. Tests also
reject v1 and v2 peers in both directions and preserve durability error code
and path over IPC. The Electron correctness review found the missing error
path; its fix passed a test that was RED at the path assertion. The simplifier's
only remaining proposal was a shorter forwarding method with no behavior or
clarity gain, so the explicit method remains.

The full Electron package passed 163 tests with no type errors. The exact-ID
contract passed through a real Electron main process in isolation. The full
Browser coordinator suite passed 263 tests, the persisted wrapper suite
passed 876 tests with two existing todos, and all five real Chromium/OPFS
leader-close schedules passed on the named executable commit. The final
affected-file ESLint check had no errors and 37 existing `require-await`
warnings in the large Browser and wrapper oracle files. Electron TypeScript,
formatting, and `git diff --check` passed. An optional broader real-process
Electron run had
five other failures: two multi-Collection leadership checks and three
function-bearing collation cases, so that broader run is not claimed green.

The real-process witness executes the renderer adapter in Vitest and sends its
envelope through IPC to Electron main. It does not execute that adapter inside
an Electron renderer or cover concurrent requests from multiple renderers in
one live main process. A delayed reconciliation IPC reply after main applies
is an untested transport history, recorded with the Electron receiving owner
in the coverage map. Passing prompt-reply histories do not establish general
Electron same-run recovery. The Browser and Electron coverage boundaries stay
separate from the original source-backed Collection law.

## Follow-up: CodeRabbit review 5463932998

CodeRabbit reviewed `b25d83b50cb24308b793b858bc25eb4918975c6b` and
reported one inline documentation defect. Its review body also repeated an
optional CLI suggestion. The checkbox, run metadata, file inventory, and
skipped-file list contained no other findings.

| ID | Claim | Evidence and disposition |
| --- | --- | --- |
| CR2-1 | The unescaped union pipe split the CR-3a audit cell. Escape it inside the code span. | `fixed-now`. Local GFM rendering split the original code span and omitted the verdict from the visible row. The escaped pipe renders three intact cells, including the `string \| undefined` code span and verdict. Prettier and `git diff --check` pass. This is a documentation rendering defect, so a product oracle is not applicable. |
| CR2-2 | Consider running `coderabbit review --agent` locally. | `refuted` as a required action. The raw review, local rendering check, and formatting check supplied direct evidence. The optional process idea remains here. |

The reviewer made one accurate, precise finding with a minimal correct fix.
This is a positive recommendation for targeted documentation review. This
review does not establish product-law review depth. The final loss audit is two
raw items = one `fixed-now` + one `refuted` as a required process action. No
item remains open or deferred.


## Follow-up: medium-effort review at b4a46a4fe

The user supplied ten code-reading findings against
`b4a46a4fe5d3b08edfa4084dc7a46299857f6c60`; the review reported no
executed checks. The executable repair is
`d6e2493b17b3f023b30ddef0482bae88f9f674ee`. The earlier review records
above remain evidence for their named commits. This addendum accounts for each
new claim and the oracle attack that followed the repair.

### Laws, experiments, and inference

| Law and authority | What the earlier oracle proved | Decisive experiment and inference | Enforcement at d6e2493b1 |
| --- | --- | --- | --- |
| **One durable term per election; passive followers retain the newer route** (M01, M02). The Browser coordinator's Web Lock and routing contract requires a successor's identity to order after its predecessor, even after a no-write term. | The old controlled history protected the new lock holder from a delayed former-owner heartbeat. It had no passive C after B's heartbeat, and its stub did not persist an empty election. | A/B/C histories were RED at C's route after the delayed A heartbeat. A temporary `Math.max(memory, durable) + 1` repair passed when B had heard A, but failed for a cold B. The downstream RPC timeout in the review was not inevitable in the controlled probe. | Browser histories reach known and cold successors, compare C's route after both notices, and check later routed work. The SQLite adapter reserves a term inside a transaction before announcement; its real SQLite owner sees two empty elections with distinct durable terms. Six Chromium/OPFS leader-close histories, including a cold successor, passed on the repair. A combined real-host missed-notice, empty-election, passive-row history remains with the Chromium/OPFS owner. |
| **Only the elected local owner may allocate the next stream position** (M03). The ordinary apply guard and fail-fast invariant rule are the authority. | Normal apply checked both `isLeader` and `leaderId`; reconcile checked only `isLeader`. No legal trace was found that gives a Web Lock holder the contradictory identity. | A controlled contradictory-state witness rejects reconciliation before adapter entry. This is an invariant gap, not a demonstrated public route failure. | One `nextPersistedTxIfLeader` function now performs the identity, term, disposal, and Collection-state checks and position allocation for both paths. The Browser coordinator oracle passes after the extraction. |
| **An exact ID acknowledges its original committed position, while later durable writes can invalidate owned resume evidence** (M04). The core README defines the original-position receipt and fail-closed anchor. | SQLite already reports committed version 1 and latest version 2 for an earlier ID followed by a peer write. A separate wrapper witness rejects a resume generation advanced outside its owner. | The review correctly saw the old position but inferred a stale-resume bug from it. Returning the peer's later position as X's commit would misattribute that write. No same-path RED supports that proposed change. | The original committed position stays. A composed exact-ID, peer-write, wrapper-binding witness remains with the persisted wrapper owner in the coverage map. |
| **A settled reconciliation reload publishes durable row shape** (M09). The glossary's persisted-snapshot equality is the skip condition. | The wrapper covered sparse slots and enumerable array properties, but omitted equal-keyed nested class versus plain record. Ordinary `deepEquals` can equate those shapes. | A source write followed by a controlled durable plain-record reload was RED at the public nested prototype; a prototype-sensitive mutant passed. The repaired wrapper case checks both source and mounted live-query rows. | `equalPersistedSnapshotValues` distinguishes nested prototypes and preserves the existing array, Map, and Set shape rules. The newly introduced `deepEqualsStrict` root export is replaced. A real SQLite serialization and wrapper publication witness remains with the Node SQLite receiving owner. |
| **A reset starts a new row-version series; a position-only read does not publish rows** (oracle attack after M09). The SQLite schema-reset contract and publicly applied row-version distinction are the authority. | The wrapper had no history joining reset, delayed pre-reset notice, and a new post-reset commit. Its position watermark could falsely certify rows loaded before a later metadata read. | The lower-version and old-notice histories were RED on the first repair. Two reviewers then found both delayed-notice orders and a commit between reset reload and position read. A temporary no-fence mutant failed both notice orders; a mutant that set the public version from the metadata read failed at the missing public row. These were assertion failures at the intended cuts. | Three reset witnesses cover lower version, both notice orders, and the between-reads race. The wrapper rebases the durable version, keeps an old-term fence, and conservatively starts the new public version at zero. Its full oracle passes. The controlled reset premise is separately shown by real SQLite; a combined real-adapter wrapper reset and notice remains with the persisted SQLite receiving owner. |

The model, history, path, and observation boundaries are explicit in those
owners. The term model keeps durable term state because a later cold election
distinguishes two histories with the same caller memory. The reset checks keep
durable position and publicly applied position distinct because the next
notification can distinguish them. The controlled Browser channel supplies
notice ordering; the real coordinator supplies route transitions. The wrapper
adapter supplies held read cuts; the real wrapper supplies Collection and live
query publication. These bounded histories establish their asserted cuts, not
all browser schedules or arbitrary reset interleavings.

### Lossless finding ledger

| ID | Original claim and proposed action | Technical verdict and evidence | PR action and durable value |
| --- | --- | --- | --- |
| M01 | Followers accept a closed leader's late equal-term heartbeat, reroute to A, then RPCs time out and source/subset work can fail. | Confirmed route defect at passive C; claimed downstream timeout is conditional. A/B/C controlled RED, later repaired route and real OPFS host GREEN. | `fixed-now`. Passive-route law in Browser coordinator and OPFS owner. |
| M02 | Election overwrites a heartbeat-learned term from SQLite and reuses T; use `Math.max` and remove the leader-only special case. | Confirmed reuse. The proposed memory-only maximum failed the cold-successor RED. | `fixed-now`. Reserve each election in the durable `leader_term` ledger. Browser/Electron require the capability; Electron IPC uses protocol v4. |
| M03 | Reconcile omits the local `leaderId` guard and duplicates next-position logic. | Guard mismatch and duplication confirmed; legal user-visible contradiction unproved. Invariant witness reaches adapter-entry cut. | `fixed-now`. Shared guard and next-position function rejects contradictory state before write. |
| M04 | Already-applied reports X's old version instead of the latest peer version, allegedly corrupting resume generation. | Old-position report is real and required by the README's exact-ID receipt. Existing SQLite and wrapper evidence supports fail-closed ownership; composed wrapper witness remains. | `accepted-design`. Preserve original ID identity; coverage map owns the joined witness. |
| M05 | Reconcile and normal source-success branches duplicate lifecycle, stream-position, and resume-generation bookkeeping. | Confirmed from source; no divergent public behavior was shown. | `fixed-now`. Both paths call `recordDurableSourceCommit`; wrapper oracle pins the receipt and row cuts. |
| M06 | Nested three-by-three retry loops can hold the apply mutex for about 90 seconds; cap attempts. | A controlled transport seam reached nine sends only when each outer round first lost two answers and then returned NOT_LEADER. Pure transport failure stopped after three sends. A proposed three-send cap failed the legal lost-answer/later-route witness, which requires a fourth send. No 90-second host latency or contract limit was established. | `accepted-design`. Keep the bounded existing reroute policy required for exact-ID liveness. Its possible work cost remains recorded; a latency budget or measured host violation would reopen optimization. |
| M07 | Exact `tx_id` lookup scans retained per-Collection rows because the primary key orders by term/seq; add a composite index. | Confirmed by real SQLite plan: the old plan sought only `collection_id`; the new plan seeks both predicates. No elapsed-time claim is made. | `fixed-now`. Add `idx_applied_tx_collection_tx_id` and a plan assertion in the SQLite adapter owner. |
| M08 | An older tab ignores the new reload marker because BroadcastChannel remains protocol v1; rolling deploy may leave stale public rows. | Cross-version mechanism is real. The Browser same-run recovery contract explicitly assumes the same protocol version; a version bump alone cannot make old code reload. | `accepted-design`. Keep the same-version boundary. A future cross-version guarantee needs negotiation or forced refresh and its own receiving oracle. |
| M09 | Newly exported `deepEqualsStrict` is misleading: class/plain values can compare equal and Map/Set ordering is significant, so reload may retain stale shape. | Confirmed for nested class/plain public rows. Map/Set order is conservative inequality, not the stale-row cause. Controlled source/live RED and repaired GREEN. | `fixed-now`. Use the qualified persisted-snapshot comparator and remove that new export name. |
| M10 | Every exact-ID reconciliation reloads and compares active rows, even after the original notification. | Work cost confirmed; the review overstated its frequency as every leadership handoff. A missed original notice makes a same-position reload necessary under the current contract. | `accepted-design`. Retain the correctness tradeoff. Any shortcut needs independent already-published evidence and must pass the missed-notice OPFS receiver. |

The four accepted designs preserve observations or limits already in the
README, glossary, and coverage map. None is a deferred in-scope repair. The
remaining receiving cells have named owners above; no reachable counterexample
to the repaired laws was left known at this head.

### Oracle-guide audit for the follow-up

- ORC-001 to ORC-003: the README, glossary, and opening oracle prose state the
  laws and bounds; independent durable-term, authored-row, and value-shape
  ledgers sit beside their grammars, production drivers, public observations,
  and checkpoints. No production comparator computes the expected prototype.
- ORC-004 and ORC-007: this follow-up adds fixed, controlled histories, not a
  new important generated property. Existing generated campaigns and replay
  interfaces are unchanged.
- ORC-005 and ORC-006: the Browser coordinator, real SQLite adapter, persisted
  wrapper, and Chromium host run production paths. The original route and
  nested-shape RED checks and the reset fence/public-version mutants fail at
  public comparisons. Setup and timeout failures are not counted as kills.
- ORC-008 and ORC-009: the durable-term ledger retains state distinguishable
  by a cold successor; durable and publicly applied positions remain separate.
  New cross-subsystem terms appear in the glossary.
- ORC-010: controlled gates release in cleanup; the wrapper and host preserve
  primary failure separately from cleanup diagnostics.
- ORC-011 and ORC-014: real SQLite supplies the durable no-write reservation
  and version-zero reset premises; Chromium supplies the Web Lock/OPFS election.
  The joined real-adapter reset/publication and nested-serialization receiving
  cells remain explicitly open with their owners in the coverage map.
- ORC-012 and ORC-013: this revision-bound record states outcomes and
  non-applicable generated triggers, original and neighboring histories,
  hostile wrong designs, and remaining cells. Known/cold successors and both
  reset notice orders distinguish the reusable boundaries.

### Verification and reviewer assessment

On `d6e2493b1`, the persisted wrapper oracle passed 662 tests with one
existing todo. Its six focused reset tests passed separately. Both reset
mutants failed the intended public-row assertions and were restored. The
Browser coordinator oracle passed 164 tests after the shared guard extraction.
Earlier on the same repair, the DB utils oracle passed 132 tests, Browser
coordinator suites 320, Electron suites 128, Node SQLite adapter contract 36,
and all six real Chromium/OPFS leader-close histories. Four affected packages
typechecked. Changed files passed Prettier and `git diff --check`; ESLint had
zero errors and 52 warnings in test fixtures. Vitest's optional package
typecheck emitted workspace `rootDir` source errors when run alongside tests;
standalone package TypeScript checks passed. The tests above ran with that
Vitest typecheck disabled. The production source diff at the executable commit
is 330 added and 102 deleted lines; tests and contract documentation are
reported separately in the commit diff.

The reviewer had high discovery value: passive routing, the missing index,
shared bookkeeping, and nested public shape were all useful findings.
Proposed fixes were less reliable: memory-only term maximum missed the cold
successor, and the retry cap sacrificed a legal reroute. The resume-generation
and 90-second claims exceeded the evidence. Recommend hiring for code review,
with adversarial history checks before treating a proposed mechanism as the
cure.

Final accounting: ten raw findings = six `fixed-now` (M01, M02, M03, M05,
M07, M09) plus four `accepted-design` (M04, M06, M08, M10). Zero items were
dropped, deferred, or left as confirmed-open. Accounting and authorized repairs
are complete at the named executable commit; the bounded receiving gaps above
remain in the coverage map.

## Follow-up: collections CI and CodeRabbit review 5472852817

This addendum evaluated the complete CodeRabbit review of `3d7bd9e73` and the
failed `Test (collections)` job on that head. The executable repair is
`ef287d8464e3cbd640ab60098a838ac4384751ab`. Earlier entries remain
versioned evidence for their own heads. In particular, the earlier sentence
that called Electron IPC protocol v3 is superseded: the reviewed and repaired
protocol is v4. The Electron README and changeset now say v4, and both
directions of the IPC version test reject v3 as well as v1 and v2.

### Laws, experiments, and inference

| Law and authority | Earlier oracle reach | Decisive experiment and inference | Enforcement and remaining limit |
| --- | --- | --- | --- |
| **A row-version gap without `pullSince` replaces one complete durable public snapshot.** The persisted wrapper's complete-publication and accepted-source laws require readers to see an earlier permitted snapshot or the durable replacement at each change callback. | The wrapper had a term-jump row check but no change-callback trace for its no-`pullSince` fallback. | A legal baseline at version 1, missed version 2, and received version 3 were RED when the old fallback published `[]` between the baseline and durable rows. The replacement path passed with no empty or partial cut. The failure was at a public event, not only a final-row mismatch. | The wrapper oracle records each Collection change callback and permits only the baseline or all three durable rows. `reloadActiveSubsetsUnsafe` replaces the snapshot in one publication. Real lost-notice delivery through Electric/OPFS remains with the Browser receiver in the coverage map. |
| **An ordinary peer notice describes an already durable, contiguous commit.** The Electric recovery owner's peer/stream grammar requires the row, metadata marker, and reported position to describe one committed peer step before delivery. | The old fixture changed durable Maps directly, left the adapter position at zero, and announced row version 101. A new gap detector treated that as a missed 100-version history. | CI had eleven Electric recovery failures, including an empty intermediate event and an unexpected subset load. Committing each peer transaction through the fixture adapter before its notice, with the next durable row version, made all 60 recovery tests and all 629 Electric package tests pass without weakening the public-row or marker assertions. | The bounded Electric owner still checks complete intermediate rows, marker reach, deletion, full reload, and peer/stream pairs. Its mock SDK and adapter do not establish real cross-tab delivery. The original impossible notice remains a calibration for fixture legality, not a product RED for an ordinary peer commit. |
| **After a reset, an unlabelled same-term notice cannot publish old-epoch rows.** `CollectionReset` carries an epoch; `TxCommitted` does not. The reset/public-row law requires a durable reread for an ambiguous notice. | Earlier reset histories moved to a newer term. They did not count work after multiple same-term notices. | A controlled history now sends new-epoch commit A, delayed old-epoch notice, then new-epoch commit B under term 1. All public cuts contain only durable rows. It counts three subset reloads. A temporary no-fence mutant was RED at the public cut: `[first, stale]` instead of `[first]`. Restored production is GREEN. | CodeRabbit's hidden H1 cost observation is true at this controlled receive boundary. Its proposed one-reload cap lacks an epoch distinction and would permit the stale row. There is no bounded-work promise for this envelope, and the built-in coordinator currently has no `collection:reset` sender. A real same-term reset sender, or an epoch-bearing fast path with its receiving witness, remains with the Browser/OPFS owner. |
| **Coordinated Electron elections reserve a durable term before publishing a route.** The coordinator checks for `reserveLeadershipTerm` when an adapter is registered and the Electron main handler rejects a missing capability during reservation. | The generic `PersistenceAdapter` type keeps the method optional because `SingleProcessCoordinator` does not elect. The renderer IPC proxy exposes it; the main adapter is resolved per Collection. | Source inspection reaches the exact boundary: a missing main capability produces `InvalidPersistedCollectionConfigError` before `state.isLeader` and route heartbeat. The review's request to let such a custom adapter complete a coordinated election conflicts with the durable-term law. | The README now states the conditional main-adapter requirement and the supported single-renderer case. No new election algorithm was introduced. The existing Browser/Electron election and IPC oracles remain the production owners; an absent-main-capability real-process witness is outside this documentation correction. |

The reset experiment tests a controlled envelope accepted by the wrapper, not
an emitted built-in reset. Its work count is measured, but no elapsed latency
or host-size bound follows. The older same-version protocol limit and the
separate real SQLite reset premise still apply. The new gap witness is bounded
to eager active rows and a recording adapter without `pullSince`; the Electric
fixture repair covers ordinary contiguous peer histories, not the same
lost-notice schedule.

### Lossless CodeRabbit ledger

| ID | Original claim and proposed action | Technical verdict and evidence | PR action and durable value |
| --- | --- | --- | --- |
| CR3-H1 | After `collection:reset`, a same-term leader causes every later `tx:committed` notice to reload, skip position observation, and miss the hydrated fast path. Add at least two same-term commits and make only the first or neither reload, perhaps by carrying an epoch or reserving a new term. The review marked this unverified and hidden. | Confirmed three reloads for three controlled ambiguous notices. The no-fence mutant publishes a stale row. No built-in `collection:reset` sender, latency bound, or work contract was identified. | `accepted-design` for the current conservative receive cost. The new same-term oracle and coverage map preserve the safety law and the condition for a future epoch-aware optimization; a one-reload cap is not a correct standalone fix. |
| CR3-I1 | `PersistenceAdapter.reserveLeadershipTerm` is optional, so a custom Electron main adapter without it cannot elect. Require it for Electron main adapters or return an unsupported result that the coordinator handles. | The inability to elect is real and deliberate. The shared type is optional for single-process use; the coordinated path already rejects before route publication. No successful election without durable reservation is a supported history. | `fixed-now` documentation: the Electron README states the conditional capability and the supported single-renderer path. Existing fail-fast runtime behavior stays. |
| CR3-I2 | Protocol constant is v4, but README and review record say v3; add a v3 rejection test only if that build was published. | Confirmed stale prose. v3 existed in earlier PR commits; main was v2. Both peers already reject any mismatched version, but the test omitted v3. | `fixed-now`: README and changeset say v4, this append-only entry corrects the earlier review record, and the two version-rejection loops include v3. |
| CR3-P1 | Consider running `coderabbit review --agent` locally. | Optional process suggestion in the review body and agent prompt. The raw review and local tests supplied the needed evidence; it is not a product or PR requirement. | `refuted` as a required action. The idea is preserved here. |

The remaining 17 hidden file comments say LGTM and contain no additional
change request. The autofix checkbox and repeated agent prompts add no distinct
technical claim. Four raw claims are accounted for: two `fixed-now`, one
`accepted-design`, and one `refuted` as a required process action. No item is
deferred or silently dropped.

### Verification and reviewer assessment

The original persisted gap witness was RED at an exposed empty Collection and
GREEN after the atomic replacement. The no-fence mutant failed the new
same-term test at the stale public row. On the executable repair, the full
Electric package passed 629 tests, the persisted wrapper oracle passed 664
tests with one existing todo, and Electron IPC passed 58 tests. All three
affected packages passed standalone TypeScript checks after the Electric
package declarations were built. Affected-file ESLint had zero errors and
pre-existing `require-await` warnings in the large wrapper test; Prettier and
`git diff --check` passed. These local checks do not substitute for the pending
required CI checks on the pushed head.

CodeRabbit found a real documentation mismatch and a useful reset-work
observation. It assigned major severity to a synthetic receive path without
establishing a built-in reset sender, and its one-reload suggestion would lose
the old-epoch safety witness. It also treated a deliberately optional generic
capability as a supported coordinated-election fallback. Recommend hiring for
review work with explicit protocol-history and oracle calibration before
accepting proposed fixes. The accounting is complete at the reviewed head;
the executable repair is complete for the bounded laws above, with real-host
receiving limits retained in the coverage map.

## Design grammar and TLC addendum (2026-10-09)

The new bounded model, runner, case inventory, and exact TLC receipts are in
`review-evidence/issue-2085-tla/`. This is a design experiment, not a
TypeScript/SQLite refinement check. The model abstracts one source transaction
X, one same-key peer write Y, A/B leadership, passive C, one reset, optional
exact-ID pruning, lost and reordered notices, position-only observation, and
receipt settlement. The README states legal actions, exclusions, fairness, and
public checkpoints; the mapping names each production boundary.

### Laws and rival predictions

| Law and authority | Rival prediction | TLC and receiving result |
| --- | --- | --- |
| Every election reserves a greater durable term before announcing B. Coordinator README and glossary. | Reuse term 1 after a no-write A term; C accepts B then A's delayed equal-term heartbeat. | `DurableTermUnique` fails at election. With that law omitted, `SuccessorRouteStable` fails at C's route. The existing Browser and OPFS owners supply production election evidence. |
| A present exact X acknowledges X's original committed position even after Y; an absent X needs the unchanged row version and reset epoch. Coordinator README. | Check anchor before ID, report Y's position as X's, apply absent X after Y, or ignore reset epoch. | `PresentIdAcknowledged`, `OriginalPositionReceipt`, and `AbsentApplyNeedsAnchor` each reject the respective fault at the intended cut. Real SQLite already owns the exact-ID decision. |
| A pruned X cannot become a replay authorization. SQLite retention and anchor contract. | Treat absent/pruned X as safe merely because ID lookup missed. | A reachability control finds X applied, pruned, then unknown; the anchor fault is rejected. The model has no pruning age or capacity clock. |
| A reconciliation reload repairs missed rows despite an equal observed position, and a position-only read cannot publish rows. Coordinator contract and glossary. | Drop equal-position reload or publish observed durable rows from metadata alone. | `CertifiedDelivery` and `PositionReadIsNotPublication` reject the faults. The persisted wrapper and OPFS owners supply separate production receiving witnesses. |
| After a reset signal, an old-epoch notice cannot republish old rows. Controlled wrapper reset contract. | Trust the delayed old payload. | `CertifiedDelivery` rejects the fault. The model's reset-known premise matches the existing controlled wrapper histories. |

TLC exhausted 8 route, 2,866 exact-ID, and 22,746 reset states with no safety
error. The same graphs passed the explicitly fair local-progress properties.
Thirteen wrong-design cases failed at their named invariant, and six negated
reachability controls found the intended lawful histories. The runner rejects
a different invariant or a TLC/tool error as a mutant kill.

Two control repairs mattered. A first lost-notice witness marked X lost after
C had already reloaded; the retained witness records loss at reconciliation
and then a later reload. Pruning initially allowed A to apply the same
original request twice; the grammar now excludes that illegal history. Neither
was a production defect.

### Wrapper receiving witness

The persisted wrapper oracle now composes X's version-1 exact-ID
acknowledgment with a same-key Y at durable version 2, then runs owned resume
certification. Its source receipt fulfills in one sync run; public X and
durable Y/cursor are both observed; the later snapshot makes key-set evidence
`incompatible`. A temporary collaborator mutant that reported Y's position
as X's made that last assertion fail: it returned `consistent` evidence.
The mutation was restored. This covers the wrapper boundary with a controlled
coordinator. A real SQLite adapter plus wrapper in one receiving path remains
open; the adapter's exact-ID result is separately checked against SQLite.

### Candidate law outside the established cut

A separate TLC challenge deliberately asserts that no old row can be
published after durable reset *before* C has received a reset signal. It
fails in seven states: A commits X; B reserves term 2 and resets to empty
epoch 1; C receives A's version-1 notice before B's reset signal and
publishes X while durable rows are empty. The signal and commit messages
come from different owners and may be reordered. C has no new-epoch
knowledge at that cut. The built-in coordinator currently has no
`collection:reset` sender, so this is an unresolved proposed cross-tab reset
law, not a confirmed PR #2088 product regression. A future sender must define
the pre-signal public guarantee and add a real Browser/OPFS receiving witness.

The model is exhaustive only within its stated small grammar. One real host
join of missed notice, empty election, and passive public rows remains open.
Cross-version peers, concurrent source transactions, multiple Collections,
provider cursor semantics, physical crash durability, and Electron IPC reply
loss remain outside this TLC claim.

## CI follow-up: no-write term reservation during Electric resume (2026-10-09)

The browser E2E workflow on `bfa09cc8a5b010473e4bb31065ebb1870caba057`
failed twice in `electric-hydration-straddle.opfs.spec.ts` after reopening the
last tab. Both runs reported `Electric persisted resume baseline could not be
certified` at the preloading checkpoint. The host log recorded the error and
public row, but not the generation tuple. The following controlled histories
test a specific explanation; the new-head browser run is still required to
confirm the host repair.

**Law and authority.** The atomic-resume contract in the persistence README
certifies rows, source cursor, stream position, key set, and reset epoch from
one snapshot. A no-write election may reserve a greater durable term with
sequence zero while row version and reset epoch remain fixed. That transition
does not change rows or the source cursor, so an already certified on-demand
baseline remains usable. A committed write or schema reset does change the
baseline generation and cannot inherit that certification.

**Competing predictions.** The old exact `(term, seq, rowVersion, resetEpoch)`
guard marks the harmless election incompatible. The repaired guard accepts a
greater term at sequence zero only while row version and reset epoch equal the
owned baseline. It continues to reject a changed row version or reset epoch.

**Experiments.** A focused persisted-wrapper test gives its recording adapter
`(1, 1, 1, 0)` and then `(2, 0, 1, 0)` during on-demand certification. The
old guard was RED at `getKeySetEvidence()`: `incompatible` instead of
`consistent`. A second held-snapshot test composes the real SQLite adapter,
the persisted wrapper, and a mocked Electric stream. SQLite reserves term 2
at sequence zero, keeps row version 1 and the reset epoch, and retains
consistent key-set evidence. With the old guard restored temporarily, this
receiving test was RED at the post-up-to-date Collection checkpoint: `error`
instead of `ready`. Restoring the narrow guard made both GREEN. The existing
held-snapshot committed-write and schema-reset tests remain negative controls.

**Scope and verification.** The full persisted wrapper oracle passed 666 tests
with one existing todo; the full Electric package passed 630 tests. Both
affected packages passed standalone TypeScript checks. ESLint reported zero
errors after removing an unnecessary optional-method guard, with 24 existing
fixture warnings in the large persisted oracle. The local Electric witness
uses real in-memory SQLite and a mocked ShapeStream. It does not enact the
Chromium/OPFS restart, Web Lock election, or live Electric delivery; the new
head's browser E2E owns that receiving result. The coverage map records this
join and its remaining host limit.
