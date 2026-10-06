# IndexedDB TLA+ refinement and loss audit

The maintainer requested executable translation, a loss audit, assertion-level
RED against production, and implementation. This record supersedes the open
XH-07 design disposition in the October 5 law audit. The selected contract is
**finish admitted writes and preserve accepted sync work, while closed managed
Collections remain errored**. Database deletion is administrative by name and has
no Collection row-publication authority. No database identity is persisted.

## Frozen sources and oracle owners

Formal sources, unchanged from the executed TLC run, are
`review-evidence/deletion-tla/retirement_oracle.tla` and
`review-evidence/deletion-tla/deletion_queue_oracle.tla`. The finish graph had
333,984 distinct states; the deletion graph had 22. The original 21 TLC
configurations include deliberate domain faults, challenged stronger claims, and
checker controls. Their hashes/results remain with those artifacts.

Three executable owners translate those laws:

- `packages/indexeddb-db-collection/tests/retirement-oracle.test.ts`: independent
  authored row fold, native outcomes, per-Collection confirmation, caller-time
  source snapshots, native-success observation and complete retired status traces.
- `packages/indexeddb-db-collection/tests/deletion-queue-oracle.test.ts`: native
  name targeting and deletion receipt authority, separately observed from caller
  delivery, retained public rows and fresh storage.
- `packages/db/tests/truncate-readiness-oracle.test.ts`: independent replacement
  and readiness intents across loading/ready/error, held optimistic work, and
  repeated/reentrant replacements. Default truncate still recovers readiness.

The native receiving owner is
`packages/indexeddb-db-collection/e2e/cross-tab-oracle.spec.ts`. The driver records
actual IDB transaction completion/abort and source rows at the caller callback.

## Loss audit and disposition

The first oracle draft was frozen before two fresh scanners received one formal
source apiece, with sibling sources hidden. Their unedited source reports and
frozen inputs are retained under `review-evidence/deletion-refinement/`. The
following dispositions are subsequent implementation work, not scanner claims.

| Recovered distinction | Resolution |
| --- | --- |
| R1: joint final observations lose caller-time truth | Capture base rows and native state inside each caller continuation. Successful settlement requires an already observed native commit. |
| R2: separate scenarios lose mixed operation phases | Cross two different Collections' deciding/rejected/native-active/accepted/settled prefixes, all mutation paths and three closure reasons. Mixed active work also commits or aborts; the separate active-pair matrix crosses both native orders and all outcome pairs. |
| R3: rejection only after closure | Add open-connection rejection prefixes for insert/update/delete, including accepted or active siblings. Utility paths explicitly have no asynchronous user-handler decision. |
| R4: no-ready is weaker than always-error | Record the full status suffix beginning at retirement, including late startup. Every later state must be error. |
| R5: native admission before error notification | Reenter from a public error-status listener with a utility call and late Collection startup. Neither may admit native work. |
| R6: eventual rows can hide false publication | Record authoritative base at each pair-publication event and compare it against native commitment. Keep caller-time source and raw durable checks. Add initial restore overlapped with an admitted local insert. |
| L1: late invocation does not test queued name targeting | Issue delete A / open B / delete B while A still exists. B receives the second native deletion. Keep this queue-target projection separate from the model's combined settled Recreate abstraction. |
| L2: delayed callbacks mask premature native success | Record native success independently from callback gates; check both while unmanaged blockers remain. Transfer the transaction-only hold to real engines because fake-indexeddb violates it. |
| L3: release-before-announcement omitted | Add a prefix completing both old obligations before deletion, and retain ordinary unblocked managed upgrade/delete paths. Native release order is also crossed independently. |
| L4: receipt order and transient observations omitted | Add old receipt after B's native success but before B's caller, retain the reverse receipt order, and record every status/publication on A and B. |
| R/L calibration omission | Execute ten production mutants; each fails an assertion. Original-source and native RED evidence is retained separately. |

These repairs preserve every modeled product law and give each transition a
production path/checkpoint. They do **not** enumerate every interleaving in the
333,984-state graph. The suite declares its finite history language instead of
claiming that a transition checklist or random green exhausts that graph.

## Formal-to-executable mapping

| Formal action or law | Executable receiving observation |
| --- | --- |
| Close(upgrade/delete/explicit) | Managed factory versionchange or public descriptor close; all affected status observations become error before application reentry can admit work. |
| FinishRead; ReadAuthority | Held initial, replacement and targeted native reads finish after closure without source publication or ready. Startup/read crossed with admitted local write separates the obligations. |
| RegisterLate / FinishLateStartup | Actual `preload()` on a closed descriptor rejects, emits error, and admits no native transaction. |
| Decide / Admit; AdmissionAuthority | Real automatic handlers resolve/reject before/after closure; utility rejection and reentrant late startup are separate public paths. Native entry recording counts successful transaction admission. |
| FinishNative; NativeAdmissionAccounting | Actual queued IDB transactions, both admission orders, FIFO commits and independently aborted queued writes. Each accepted entry reaches one terminal native observation. The oracle does not duplicate the adapter's queue. |
| Confirm / FinishHandler | Ordinary manual acceptance leaves base queued while the handler persists; closure preserves it. Utility replacement publishes committed rows without changing error status. |
| SettleCaller; TruthfulSettlement | Capture source at callback entry. Success requires commit; rejected operations never contribute a committed durable effect. Native abort disposition and abort-event delivery are distinct (below). |
| AcceptedWorkIsAccountedFor / AcceptedWorkPrecedesCaller / FinishPolicyConfirms | Queued base before handler completion, exact authored base at caller success, settled public rows and independent raw storage; mixed siblings cannot discard another owner's accepted work. |
| OnlyCommittedWritesPublish | Every observed base publication must correspond to that operation's native commit; optimistic public rows are allowed before it. |
| ClosedConnectionsDoNotBecomeReady | Entire error suffix, not merely the final status, for ordinary/replacement/read/late-startup paths. Core positive controls preserve normal readiness recovery. |
| AnnounceDelete / FinishOldTransaction / ReleaseBlocker / FinishDelete | Native versionchange, held actual transaction, actual unmanaged handles, independently recorded native success; both release orders received in three engines. |
| Recreate | Native open/seed/Collection restore plus unmanaged B blocker. Queue-target projection separately covers both delete invocations while A exists without imposing artificial restore scheduling. |
| DeliverReceipt / CallerWaitsForNative | Actual wrapper callback can be delayed after native success; pending caller and native completion are independent checks. Both receipt orders and intermediate cuts are retained. |
| RecreatedRowsSurviveOldReceipt / ClosedConnectionsStayErrored | Exact B public and raw rows while its delete remains blocked; every A/B status and row-publication event; retained old snapshots after success and fresh empty restore. |
| TypeOK | TypeScript types and validated finite inputs provide model integrity. Ghost lifetime identifiers and internal formal queue fields are not added to production. |
| Conditional progress | Cooperative gates are released/rejected and all caller outcomes awaited. Held uncooperative decisions stay pending. No finite test or timeout proves unconditional browser liveness. |

The rejected stronger claims stay rejected: accepted publication may occur after
close; suppressing new confirmations cannot preserve finish-policy success
observations; delete-by-name is not bound to an old descriptor lifetime; arbitrary
uncooperative handlers/blockers need not finish. They are not missing features.

## Two abstraction corrections discovered by execution

1. A successful native `abort()` makes commit impossible before its asynchronous
   abort event is delivered. The wrapper's callback rejection may precede that
   event. The formal aborted disposition maps to irreversible rollback, not an
   event-delivery deadline. The oracle requires native commit before success,
   excludes commit on rejection, and independently awaits the final abort event
   and unchanged durable rows. This correction follows the formal truth law and
   IDB semantics; it does not accept a committed write reported as failed.
2. fake-indexeddb 6.2.5's `waitForOthersClosedDelete` treats close-pending handles
   as closed. The strengthened oracle observed native deletion success while its
   transaction was still active after the unmanaged blocker closed. The failing
   provider trace is preserved. The law remains unchanged and is enforced in
   Chromium, Firefox and WebKit for both release orders. Controlled tests retain
   the unmanaged blocker until native work ends. No production workaround was
   added for the nonconforming test provider.

## RED, implementation, and calibration

Before production edits, 884 adapter cases failed at intended assertions; the
core readiness matrix had 12 failures and 42 positive controls. Chromium also
failed the admitted-import/explicit-close readiness assertion. Later audit
expansions increase the history language; the original RED counts are not claims
that every added history was run against the old adapter.

Implementation removes `utils.deleteDatabase` and `database-deleted` transport
messages. The exported low-level administrative function remains. Managed
connections record closure before notifying current Collections. Read callbacks
are fenced by connection closure, while admitted write confirmation and accepted
core sync work survive. Core adds `truncate({ markReady: false })`, with normal
recovery as the default and the last replacement supplying a batch's intent.
The docs, types, test scripts and changesets carry the same contract.

The final replayable calibration runner injects and restores these faults:
missing closure notification, late-read publication, truncate readiness,
late-startup readiness, admission after close, notification before native close,
discarding accepted work, rejection after native commit, premature success,
and admitting the obsolete deletion protocol. All ten fail assertions rather
than setup, parser or timeout errors. The native-ignore-blocker formal control
is a provider-contract fault; its real receiving law is tested in browsers and
its fake-provider violation is reported above. The original stale-receipt bug
was reproduced before removal of its publication path, in controlled and all
three native engines; no stored identity was needed to remove that authority.

## Validation and bounds

Final validation receipts are retained under `review-evidence/deletion-refinement`.
The adapter suite, related core publication/settlement tests, external declaration
consumers, source typecheck, lint, formatting and native engine results are listed
in `validation.json`. The browser baseline passed 138 cases; its 18 clear/import
abort cases used an overstrong event-at-rejection assertion. All 18 passed after
the abstraction correction above, giving 156 covered native cases across the
three engines. Tests for both transaction/blocker release orders passed in each.

Vitest initially repeated one stale source diagnostic from its shared incremental
cache although standalone TypeScript passed. Clearing only its generated
`tsconfig.tmp.tsbuildinfo` produced a clean 24-case type-only run. No source type
contract was weakened to silence it.

Relative to pushed `34eb98b16`, production changes add 12 net core lines and
remove one net adapter line: **11 net production lines**. Tests, executable
models and documentation are counted separately. This includes the prior pending
adapter metadata cleanup; no retry queue, global deletion coordinator or persisted
database epoch is introduced.

XH-07 is closed for the declared administrative deletion and managed closure
language. The original 15-item ledger has no deferred item: XH-06's contract was
implemented and documented, XH-07's authority was removed and tested, and the
other thirteen retain their prior fixes and expanded laws. Cleanup/restart of
pending mutations, post-durable auxiliary failures, arbitrary same-key ordering
between Collections, lost notifications, quota/eviction and physical crash remain
separate pre-existing boundaries, not claims made by these formal models.
