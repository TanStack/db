# LocalStorage same-tab publication audit

Reviewed implementation and oracle head: `5383fe9d1532bbd23805135420d462a85dca3586`.
The user approved same-tab synchronization for active LocalStorage Collections
that share one Storage object and key. This record supersedes the open R8
product decision in the earlier external-review record; it does not rewrite
that historical review of `8abbf5b14`.

## Law and loss audit

The [peer oracle](../../../packages/db/tests/local-storage-peer-oracle.test.ts)
uses authored rows as its expected snapshot. Its production driver starts two
Collections with fresh options on one controlled Storage object/key and withholds
browser events. At each successful persistence receipt, durable rows and both
active public snapshots must equal the authored fold, apart from a pending
optimistic overlay. A failed Storage write must not add its row. A delayed
storage event must preserve the result. Cleanup ends the receiving sync run;
restart restores durable rows and receives later same-tab writes.

| Path and history | Observation cut | Evidence |
| --- | --- | --- |
| Two disjoint automatic inserts, typed number/string keys | Each receipt, delayed event, fresh restore | The old event-only adapter failed at the first peer receipt for both key orders; the repaired adapter passes. |
| Automatic insert, manual same-key update, automatic update, automatic delete | Each receipt and delayed event | Both public snapshots and durable rows follow `1 → 2 → 3 → absent`. A mutant omitting delete notification fails at `automatic delete peer`. |
| `clearStorage()` after a shared row, then a new insert | Clear return, insert receipt, delayed event, fresh restore | A mutant omitting clear notification fails at `peer clear without event`. |
| Held local same-key insert, accepted peer insert, then local settlement | Peer and local receipts | The held optimistic row stays visible locally; the peer follows the accepted durable row at each receipt. |
| Rejected Storage write | Rejected receipt | Durable and both public snapshots retain only the prior accepted row. |
| Cleanup, peer write, restart, peer write | Restart restore and later receipt | The restarted Collection restores the first peer row and receives the second without an event. |
| Default `window.localStorage` in jsdom | First writer receipt | A second Collection created with fresh default options observes the row without a synthetic storage event. |

The new no-event assertions failed seven of 22 controlled tests on parent
`ac2c9ed3b726355939528361c47ef833d3cdaea6` at public snapshot cuts.
The repaired head passes 23 of 23 peer-oracle tests. The full `@tanstack/db`
suite passed 270 files and 11,641 tests with no type errors on implementation
commit `c28b94ae4`; the later `5383fe9d1` commit only extends the already
passing update/delete oracle, which passed its focused run. Package build,
changed-file lint, formatting and whitespace checks passed.

The production addition is 46 lines and removes three lines in
`local-storage.ts`. It is a Storage-object/key registry: each active sync run
registers its refresh callback, and a successful write or clear publishes to
that key. Cleanup unregisters. This state is needed because the browser does
not deliver a storage event to the tab that performed the write. No retry,
second write queue or persisted metadata was added.

The bounded claim covers compatible active Collections that can read the stored
snapshot, one Storage object identity and one key. It does not establish
atomic simultaneous cross-tab read-modify-write, distinct custom Storage
wrappers over the same bytes, direct raw Storage edits in the writing tab,
native multi-window scheduling, arbitrary long histories, or a no-allocation
resource proof for the same-tab listener after cleanup. The peer oracle owns
the latter resource witness if a stable observable seam becomes available;
the code directly unregisters and the public restart path is covered. Parser
or source-application failure in a receiving peer remains under the existing
failed-read contract, not a successful-convergence claim.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The opening prose names the approved same-tab receipt law and limits it by Storage identity, pending overlays, valid reads and non-atomic cross-tab writes. |
| ORC-002 | Expected rows are authored independently of version keys, parser output, cache and registry. |
| ORC-003 | Opening contract, authored-row model, finite histories, real Collection driver and named receipt/clear/event comparisons are visible beside the code. |
| ORC-004 | Not triggered: the extension uses finite enumerations and named histories, not an important generated property. Number/string typed keys are both exercised. |
| ORC-005 | The driver reaches automatic mutation methods, manual acceptance, `clearStorage()`, cleanup/restart and default DOM Storage; it compares public and durable observations at the promised cuts. |
| ORC-006 | The original event-only implementation failed seven intended snapshot comparisons. The skip-delete and skip-clear mutants failed their respective public checkpoints, not setup or timeout. |
| ORC-007 | Not triggered: no generated property was added or changed. |
| ORC-008 | No reference state was added: the independent fold retains only authored accepted rows. Pending intent is distinguished by a held production transaction and checked separately. |
| ORC-009 | “Authored row” is model-only accepted data; persistence receipt, sync run, public snapshot and cleanup use the glossary meanings. No production registry state enters the model. |
| ORC-010 | `withHistoryCleanup` releases held gates and Collections while preserving the primary assertion failure. No shrinking occurs. |
| ORC-011 | No separate shared-fault classifier is identified. The old implementation and two path-selective mutants challenge the primary authored-row account. |
| ORC-012 | This table records each applicable outcome and the remaining bounded cells above, tied to the reviewed head. |
| ORC-013 | No-event receipt versus delayed event distinguishes the old event-only rule. Update/delete and clear mutants demonstrate distinct consequences at their own cuts. |
| ORC-014 | jsdom's default DOM Storage receives the controlled no-event premise. Native browser scheduling is explicitly unclaimed. |

## Readiness-boundary follow-up

Reviewed source and oracle head: `69ef5690a7db8f10b692462c70fc1ad2d43159b2`.
The preceding audit's receipt histories began after both Collections preloaded.
A newly ready Collection can invoke application status listeners before its
sync function returns. One such listener started a write through an already
ready peer. On prior head `d28d748da`, the write reached durable Storage and
fulfilled its receipt while the newly ready Collection stayed empty: same-tab
registration followed `markReady()`. The new oracle's `newly ready peer at
receipt` comparison failed with `[]` instead of the authored row.

The sync run now registers its same-tab listener before publishing readiness.
If `markReady()` or browser-listener registration throws, it removes that
listener before propagating the startup error. The new history passes, as do
all 24 peer-oracle tests and the full package suite: 270 files, 11,642 tests,
no type errors. Build, changed-file lint, formatting and whitespace checks
pass. This extends ORC-001's active-run boundary, ORC-005's production path,
ORC-006's old-implementation kill, ORC-010's startup cleanup, and ORC-013's
distinguishing readiness witness. The other outcomes and limits above remain.
