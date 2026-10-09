# LocalStorage peer and materialization review

Reviewed PR head: `ee0a03fd7ca1737e9f4bfd151c06243a92eec7d5`.
This review supplied ten findings, two carry-over observations, and three
CodeRabbit comments. The full intake and per-item evidence remain in the
task-local ledger at `/private/tmp/pr2074-ee0-review-ledger.md`. This record
keeps the durable laws, repair results, and limits beside their oracle owners.

## Findings

| ID | Verdict on reviewed head | Follow-up |
| --- | --- | --- |
| U1 | Confirmed: an outer refresh restored an older mirror after a nested peer write. | Move mirror promotion before `commit()`. A three-Collection history failed at the later update with `DuplicateKeySyncError`, then passed. |
| U2 | Confirmed: a throwing receiver rejected an already durable writer and stopped later receivers. | Isolate and report each receiver error. The failing-parser peer history now preserves the writer receipt and later peer snapshot. |
| U3 | Confirmed: module-level options accepted a DbClient mutation through a separate write queue. | Route acceptance to the materialized Collection that owns the mutation. The held automatic/manual history failed at the intermediate durable checkpoint, then passed through settlement and fresh restore. A before-preload witness passes. Unrelated equal-ID Collections with either the same or a different storage key now reject the wrong utility; the same-key case failed before the final ownership refinement. |
| U4 | True dependency cycle under the approved Collection-wide order. | Accepted design. A handler must not await a later same-Collection persistence receipt; the legal fire-and-forget neighbor remains covered. |
| U5 | Confirmed: a local confirmation error after `setItem` skipped peer notification. | Publish in `finally` after durability. A one-shot writer key-extraction fault now leaves the compatible peer at the durable snapshot while the writer receipt rejects. Recovery of that invalid writer is outside this law. |
| U6 | Confirmed: stored-row validation opened a sync transaction before failing startup. | Validate before retaining callbacks or calling `begin()`. The failed-run trigger stays inert; a valid restart restores rows. |
| U7 | The options claim remains consumed after cleanup or a failed construction attempt. | Accepted design under the approved one-options/one-Collection law. Fresh options are required for a new Collection. |
| U8a | A shallow spread carries the claim. | Accepted design. The copied options still contain the same mutable adapter state and must reject reuse. |
| U8b | The claim threw plain `Error`. | Use `LocalStorageCollectionError`; four direct/spread, pre/post-preload witnesses failed before and pass after. |
| U9 | Confirmed: a nonempty key with one writer and three peers caused five full parses per write. | Reuse the exact saved Map for the default JSON writer only while Storage still contains the same bytes. The writer now parses once; each peer parses once. A custom parser still reads back, and a nested newer write forces a fresh read. |
| U10 | Confirmed: clear refreshed the writer twice. | Publish once to the active listener set. The two-Collection clear history failed at three reads and passes at two, with both public snapshots empty at return. |
| F11 | Already fixed: un-awaited manual acceptance holds the transaction receipt through direct or queued success/failure. | Keep the prior order oracle; U3 added its missing DbClient route. |
| F12 | Empty stored bytes still fail strict restore. | Accepted malformed-data law: only `null` means absent; explicit clear permits repair. |
| CR1 | CodeRabbit's inline parser-failure report repeats U2. | The per-receiver warning preserves its separate error-reporting suggestion. |
| CR2 | CodeRabbit found awkward prose. | Changed “an already ready peer” to “a peer that was already ready.” |
| CR3 | CodeRabbit gave positive comments on existing oracle ranges. | No requested change or additional law. |

## Law coverage

The [peer oracle](../../../packages/db/tests/local-storage-peer-oracle.test.ts)
models authored durable rows independently of the adapter's version cache and
parser. It now reaches a receiver that fails validation, a synchronous nested
manual write during peer publication followed by a later update, a failure in
the writer after `setItem`, a failed startup validation with an adapter `begin`
counter, one writer plus three parsers, custom parser normalization, and clear
with two active receivers. It checks the exact writer or peer receipt, clear
return, later update, startup failure, and restart checkpoints. The pre-repair
implementation failed each new triggering witness at its intended comparison;
the repaired implementation passes them with the existing neighboring cases.

The [order oracle](../../../packages/db/tests/local-storage-order-oracle.test.ts)
folds accepted whole-row edits in author order. Its new DbClient history
materializes module-level options, holds an automatic update, and calls the
module-level `acceptMutations()` for a later manual update. It checks that
durable state and the manual receipt remain held before releasing the first
handler, then compares public rows, durable rows, and fresh restore. On the
reviewed head the later value reached Storage early. Routing to the owning
Collection's utility made the same history pass. A second history calls the
module-level utility before explicit preload and verifies the later restore.
The peer owner challenges the routing rule with an unrelated equal-ID Collection
using either the same or a different Storage key. It asserts rejection before
either store changes. The same-key case resolved successfully under the earlier
storage/key-only binding, so it killed that plausible wrong repair. The final
route recognizes only acceptance utilities created by this options object's
DbClient materialization factory.

The prior receipt and malformed-data witnesses also passed in the complete
peer/order run. The final focused run passed 87 peer, order, and error-code
tests with no type errors; the full package run passed 270 files and 11,653
tests with no type errors. Package build, changed-file lint, formatting, and
the production-error bundle check passed. A default-JSON writer's one-parse
bound is deliberately conditional: each custom parser reads its own bytes,
and a writer reads back when another write changes Storage before refresh.
Neither owner claims atomic simultaneous cross-tab read-modify-write,
cross-wrapper Storage identity, arbitrary long histories, or recovery from a
writer's invalid key extractor. Manual acceptance without a mutation Collection
owner remains outside these histories.

## Oracle guide check

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001–003 | The owner prose states the receipt, startup, and work laws, identifies the approved order and one-options decisions, keeps authored-row and read-count models independent of adapter queues, and places each finite history and checkpoint beside its driver. |
| ORC-004, ORC-007 | These additions use controlled finite histories, not an important generated property. |
| ORC-005 | The witnesses call real Collection mutations, module-level options utilities, DbClient materialization, clear, preload/restart, and same-tab publication; the assertions read public rows, durable bytes, receipts, or adapter `begin` at named cuts. |
| ORC-006, ORC-013 | Each triggering witness failed on reviewed production. The normal receiver, custom parser, legal fire-and-forget nesting, and later update distinguish the repairs from overbroad shortcuts. The original parser-work path failed the intended count, not setup or timeout. |
| ORC-008–009 | The authored-row model retains only accepted rows; Storage version keys and queues stay production-only. The read-count model is a separate work observation. Glossary terms identify sync run, persisted restore, public snapshot, and receipt. |
| ORC-010 | `withHistoryCleanup` retains primary assertion failures while releasing Collections and controlled gates. |
| ORC-011 | No shared semantic classifier was introduced. The custom-parser and nested-write neighbors provide a second challenge to the saved-snapshot shortcut. |
| ORC-012, ORC-014 | The table above accounts for all raw items. The controlled Storage host and jsdom default-Storage witness establish the same-tab premise; native multi-window scheduling remains unclaimed. |

The reviewer identified real reentrancy, isolation, ordering, lifecycle, and
work gaps without running the tests. Its proposed mirror move and listener
isolation were directionally correct. The repeated deadlock and options reuse
claims describe explicit product limits, while the typed error was a useful
small correction. This is a strong review with a good signal-to-noise ratio;
the reviewer should still distinguish accepted design limits from new bugs.
