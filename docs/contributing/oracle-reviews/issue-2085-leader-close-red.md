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
