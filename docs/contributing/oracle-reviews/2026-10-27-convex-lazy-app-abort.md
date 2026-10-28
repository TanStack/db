# Convex: application writes, load outcome equivalence and obsolete replay work

Starting head: `8c24922026fb4a714cb54b992ac85faa2e876742`.
The changes remain local. This record supplies the current source bindings for
the files in its [manifest](2026-10-27-convex-lazy-app-abort-source.json).
Earlier versioned records and frozen evidence remain unchanged. No new TLA+
execution or independent delegated review is claimed; the final review is a
self-review under the oracle-review skill.

## Law and authority

The [#2269 maintainer decision](https://github.com/TanStack/db/issues/2269#issuecomment-6448490334)
motivates these three additions. Collection mutation handlers in
`packages/db/src/types.ts`, `optimistic-history-oracle.ts`, LoadSubsetFn,
SyncAppliedReceipt and live-query architecture laws 7, 9 and 14 supply this
checkout's receiving contracts. The task-local `laws-before-edits.md` records
the rival predictions before implementation and before the composition repair.

1. A confirmed application operation reaches the backend and the source key is
   correct when its application promise settles. A rejected atomic backend
   operation changes neither source truth nor the final promised window.
   Independently authored remote operations remain visible on both sides.
2. A synchronous throw and a rejected load promise give equivalent failed-load
   public observations and subsequent recovery. Their acquisition leases have
   different lifetimes; raw unload/status-event schedules need not agree.
3. Without accepted writes, native cancellation cannot wait for an absent
   provider response. Late transport success/error cannot corrupt a later
   successful replay or resurrect rows it excludes. Accepted writes retain
   their existing application/cleanup obligations.

Version reconciliation is explicit. #2168 remained open at
`2bc79fc7c416ac0e2d691c0b622f1364e4eb5c12`; its types and this checkout still
describe waiting for uncancelable baselines. The later maintainer comment ends
core request bookkeeping on abort. This change exercises cancellable native
preacceptance work, which satisfies both accounts. It does not relax the older
receipt/replay models or claim the prospective immediate-core-publication law
for an arbitrary adapter that ignores abort. That remains #2168 integration.

## Scientific model and receiving boundaries

`LazyWriteModel` holds authored rows and one optimistic operation. The ledger
predicts backend truth independently of every backend read. Its publication
relation combines a monotone source revision, a monotone requested window and
the current optimistic operation. It keeps all compatible explanations when an
operation hides source changes. Acknowledging backend work and dropping a local
optimistic operation are distinguishable: a rejected delete can restore an
older applied source while a newer remote edit still waits. Once the newer
source is public, the older source cannot return. Pages, caches, queues and
commit partitions never enter this model.

An initial flat list of optimistic/source windows rejected that legal restored
view under held SDK notifications. The old/new predictions and authority were
recorded before replacing that formulation. This was a model-scope gap, not a
production-defect RED. The existing source-only version model remains unchanged.
Comparator controls preserve lawful optimistic rollback and reject source
rollback, atomic mixing, lost confirmations and leaked atomic rejections.

The real-backend receiver uses actual Collection insert/update/delete handlers,
both SDKs and an independently queried backend. Every history has all six
operation/outcome cells. Each handler is held before the server call and after
its response; independent visible and unread rows change during its optimistic
operation. The first insert overlaps larger demand and an actual held receipt.
Later, real SDK caches advance while their notifications are withheld. The
source-key comparison runs at application settlement before notifications are
released. Every graph callback reaches the scientific publication relation;
quiet checkpoints additionally require the exact latest window and backend.
The server rejection throws after attempted edits, so remote rollback is real.

The outcome receiver uses the same generated replay history for throw/rejection
and for direct/live-query observation. Failed replacement and ordinary later
writes retain the old publication; retry succeeds with the original failure
identity preserved. Adapter-owned partial resources are released before a
throw; accepted acquisitions release on unload or cleanup.

The abort receiver uses both controlled native SDK shapes. It proves a response
is still withheld, aborts before any native acceptance, observes rejection,
then delivers with no demand and checks that no rows/receipts were accepted.
A fresh graph then receives two same-run core truncate replays with disjoint
source keys. Retired callbacks deliver both success and error after each replay.
Every graph callback and every retained sync error is checked. The test driver
supplies truncate through real controls; production Convex does not initiate it.
Core may lawfully request a full-source repair, so this profile makes no bounded
work claim. An early fixture permission was too narrow and was corrected; its
rejection was a harness error, not product evidence.

## Grammar, reach and validation

The app grammar varies 12–16 initial rows, page sizes 2–3, growth from width two
to 5–6, short text and all permutations of the five-cell suffix after confirmed
insert. Each normal fixed/random campaign has four histories; both SDKs receive
every history: sixteen backend episodes, 96 application operations. Every one
of the fourteen declared reach states reaches four histories per campaign.
The multiplier-three campaign reaches twelve histories per state per campaign:
48 SDK/backend episodes, 288 application operations.

The outcome grammar varies 1–4 rows, short text, partial/no failed writes and
1–4 rejection turns. Its normal campaigns each have thirty histories and four
receivers per history: 240 direct/query/outcome episodes. The abort grammar
varies 12–18 rows, page sizes 2–3, windows 2–4, short text and both stale callback
and delivery orders; thirty histories per campaign, both SDKs: 120 episodes.
Every declared state reaches thirty histories in each normal campaign. Their
multiplier-three campaigns use ninety histories per campaign. Campaign helpers
enforce nonzero reach and retain both SDK failures.

Reconstruction: minimal row/page/window forms reconstruct each captured shrink.
The fixed constructive sequences guarantee failure/retry, cancellation/replay
and all write outcomes; the generators vary the relevant neighboring values and
orders. Ablations lose independent distinctions: no ledger permits shared lost
writes, no rejection loses rollback, no notification hold loses exact settlement,
no growth loses held acquisition, no partial failed write loses unauthorized
publication, and no disjoint replay loses stale-key resurrection. Nearby invalid
histories include overlapping app operations, local settlement before backend
acknowledgment and publication without any authored source/optimistic explanation.

Final commands/results are preserved in the frozen evidence directory. The
package suite, full backend regression suite, deeper new campaigns, TypeScript,
ESLint, oracle lint and diff checks are the validation boundaries. Individual
runner cases are not counted as independent oracle owners.

## Calibration and direct replay

All correct production sources passed before calibration; no product-defect
RED or production repair is claimed. The calibration script saves the current
bytes, applies one semantic mutant, shrinks/replays the failure, restores the
exact bytes in `finally`, verifies the hash, and reruns the direct replay GREEN.
Backend calibrations run serially against isolated local deployments.

| Calibration | Boundary rejected | Seed/path |
| --- | --- | --- |
| Remove handler source-acceptance wait | Actual source key is stale at application settlement, both SDKs | `20261030` / `0:0:0` |
| Swallow a synchronous load throw as success | Failed replay fulfills instead of rejecting with its original error | `20261030` / `0:0:0:0` |
| Leave a retired SDK subscription active | Late error poisons current sync / retired React cache is read, both SDKs | `20261030` / `0:0:0:0` |
| Misdirect the handler's backend key | Actual backend differs from independently authored ledger, both SDKs | `20261030` / `0:0:0` |

The first three are production-decision mutants. The fourth is a hostile driver
behavior at the actual write boundary. Each failure is a semantic assertion,
not a timeout/setup failure. Permanent model controls separately challenge the
publication and two-sided comparisons. Calibration JSON records commands,
source hashes, exit codes and checked replay paths.

Run from `packages/convex-db-collection` using the installed Vitest binary or
`pnpm --config.verify-deps-before-run=warn exec vitest`. That command option
avoids an automatic reinstall of the existing local dependency workaround.
Normal selectors are `CONVEX_LAZY_APP_ORACLE_SEED/PATH`,
`CONVEX_LOAD_OUTCOME_ORACLE_SEED/PATH` and `CONVEX_ABORT_REPLAY_ORACLE_SEED/PATH`.
Backend commands additionally set
`CONVEX_TEST_BACKEND_VERSION=precompiled-2026-10-10-72ce13c`.

## Self-review against the oracle guide

| Requirement | Evidence / limit |
| --- | --- |
| ORC-001 | Authorities and version difference above; scoped executable prose. |
| ORC-002 | Authored ledger, independent projection and explanation relation; no production semantic imports. |
| ORC-003 | Laws, models, grammars, drivers and public cuts remain distinguishable beside executable code. |
| ORC-004 | Reconstruction, ablation, bounded ranges and nearby invalid histories above. |
| ORC-005 | Real Collection APIs, original error identity, callback observations, source at settlement and independent backend reads. SDK cache/notification premise is explicitly witnessed. |
| ORC-006 | Four semantic calibration failures and positive/negative model controls. |
| ORC-007 | Equal fixed/random budgets, three direct selectors, shrunk and checked replay; no commands arbitrary/replayPath is used. |
| ORC-008 | Source truth, optimistic operation, source/window explanations and settlement boundary each have a distinguishing next observation. |
| ORC-009 | Put combines insert/update; backend acknowledgment differs from optimistic settlement; no transport state in the model. |
| ORC-010 | Subscriber and handler failures are retained; every cleanup is attempted; both SDK failures survive aggregation. |
| ORC-011 | Throw/rejection metamorphism, independently queried backend versus ledger, and atomic-mixing controls challenge shared-fault hypotheses. |
| ORC-012 | This record, source manifest, calibration classifications and explicit limits. Self-review only. |
| ORC-013 | Zero accepted work versus existing receipt owners' accepted work; held receipt versus application; failed replay versus successful retry; optimistic rollback versus forbidden source rollback. |
| ORC-014 | App mutations/rollback/cache advancement are received through both real SDKs/backend. Adversarial stale callbacks stay a controlled-boundary claim. |
| ORC-015 | Every named state is declared and its fixed/random/deep counts are captured. |

Limits: one app operation at a time, unique ascending finite ranks, bounded
strings, one source, finite responsive schedules. Rich values/schema variation,
reload/snapshot/resume and new health APIs retain their existing/deferred owners.
Initial-load outcome equivalence and arbitrary callback reentry remain with the
core lifecycle owners. No arbitrary nonquiescent temporal progress, real SDK
adversarial-callback emission or immediate core cancellation of uncooperative
work is established. Generalized field/backend normalization and the public
cross-adapter kit remain outside this change.
