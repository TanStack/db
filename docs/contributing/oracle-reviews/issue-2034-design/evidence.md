# Frozen source basis for Temporal persistence design

Repository: /Users/kyle.mathews/.codex/worktrees/temporal-persistence-oracle/tanstack-db
Production revision: e21c280f3c4e56f6c0d05ec0eed87db29c623489 (origin/main fetched 2026-10-05).
Original reproduction revision: 84dc899bfc8d6a16487c1584dbb1cb177109aacc.
The new main commit is #2002, persisted Query write/refetch ordering.
Uncommitted reproduction is unchanged; rerun on e21c280f reports 21 tests,
13 pass / 8 fail. Runtime Node 24.19.0 / SQLite 3.53.3 / temporal-polyfill 0.3.0.

This is one source system: TanStack DB's current shared SQLite persistence,
its value consumers, and its declared oracle boundaries. No external survey.

E1 Observed implementation: sqlite-core-adapter.ts:327-425 recursively handles
Date/BigInt/nonfinite numbers, arrays and enumerable object properties. It has
no Temporal handling; the real adapter reproduction observes {} after reopen.
E2 Source contract: sqlite-core-adapter.ts:2440-2525 SQL-selects a candidate set,
then decodes, applies DB's expression evaluator, locally sorts, and paginates.
SQL may eliminate candidates before the residual evaluator can see them.
E3 Observed implementation: sqlite-core-adapter.ts:512-578 treats non-Date
objects by runtime identity for local ordering. db/src/utils/comparison.ts:228-255
uses Temporal kind plus string representation for equality normalization;
:310-349 orders supported Temporal kinds through their compare function.
Equality and ordering equivalence are distinct contracts.
E4 Source contract: sqlite-core-adapter.ts:681-707 shares normalized reference
SQL with runtime predicates and index expressions. :2038-2110 rebuilds a stale
physical index when normalized SQL differs. Literal-bearing serialized index
specifications pass through decodePersistedJsonValue at :1100-1135.
E5 Source contract: sqlite-core-adapter.ts:921-954 lowers runtime IN to json_each
with one binding; index-context IN is literal. :2434-2481 drops SQL pushdown
when the final statement exceeds the driver cap. Public results and the host
binding cap must both hold. Binding-capacity oracle starts at :2711 in
sqlite-core-adapter-oracle.test.ts; expression-index owner is in Node tests.
E6 Source contract: sqlite-core-adapter.ts:1597-1930 applies rows, tombstones,
row metadata, collection metadata, position and replay under one transaction.
Repeated-key folds validate superseded values (:1684; lastMetadataByKey).
ordinary-transaction-work-oracle.ts owns distinct-key bounded statement work
and rollback/invalid superseded action witnesses. A final valid value does not
excuse an earlier invalid action.
E7 Source contract: persisted-oracle.test.ts:58-95 requires publication before
durability, observable rejected wrapped receipt and fail-stop for durability
failure, and no admitted suffix. New #2002 preserves durable FIFO while an
immediate source commit releases an earlier waiting publication. Adapter
atomicity does not mean rollback of already published Collection state.
E8 Source contract: remote-subset-wire.ts:23-37 enumerates the transport domain;
:130-138 validates before local/remote route choice. Ordinary custom-prototype
values are rejected via projectWireRecord and assertExactPrototype. Temporal
has no listed transport case. persisted.ts:792 uses this projection even for
the SingleProcessCoordinator request path. No direct-core test proves this path.
E9 Source precedent only: offline-transactions/src/outbox/TransactionSerializer.ts
:9-78 recognizes an allowlist, resolves global Temporal constructors, invokes
brand-checking prototype methods, and rejects absent constructors. It is not
a SQLite support contract or a dependency to add blindly.
E10 Test evidence: sqlite-temporal-value-oracle.test.ts is a direct core/file
SQLite reproduction covering Instant/PlainDate and Date/ISO controls, insert/
update, metadata/replay, equality/range, one-row windows, index presence.
It is neither a provider-host test nor proof of index-plan use or all values.

Authority labels: E1-E10 are source facts/declared laws/test results. The user's
request establishes the target of correcting silent Temporal loss and meshing
with existing oracle work. Proposed support policies remain analyst inferences.


## Primary oracle ownership to retain

Paths below are relative to `packages/` at the frozen production revision.
They locate current executable contracts, not new independent lifecycle models.

| Law | Primary owner | Needed Temporal extension |
| --- | --- | --- |
| Kind/value after physical reopen, nested payloads and metadata/replay | `db-sqlite-persistence-core/tests/sqlite-temporal-value-oracle.test.ts` (new reproduction) | Real brand checks; precision/calendar domains; explicit constructor failure; data versus tag collisions. Current 16 cases plus 5 calibrations are narrow diagnostic evidence. |
| Ordered actions, atomic durable rollback, superseded-value validation and bounded statement work | `db-sqlite-persistence-core/tests/ordinary-transaction-work-oracle.ts:22`, invalid-overwrite witness at `:1445` | Add supported/rejected native-value dimensions to existing legal action histories. Its current Row type is string/number. |
| Atomic rows/metadata/position generations and schema fences | `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts:214` | Constructor/format failure at snapshot read and schema/index upgrade cuts; do not claim public rollback. |
| SQL truth before residual correction, matching index expressions and actual named-index use | `node-db-sqlite-persistence/tests/expression-index-oracle.test.ts:1`, normalized index replacement at `:1337` | Distinct equality/order keys, scalar/IN/index literals, precision/calendar, old physical index cases. |
| Statement-wide binding capacity and scoped-driver propagation | `db-sqlite-persistence-core/tests/sqlite-core-adapter-oracle.test.ts:2708` | Typed IN, Boolean composition and both cursor queries at existing cap boundaries. |
| Wrapped source receipts, fail-stop, publication/durability and FIFO | `db-sqlite-persistence-core/tests/persisted-oracle.test.ts:55` | Value-encoding failures before/after each existing cut, including queued immediate source writes. Precommit cancellation at `:3699` remains a different contract. |
| Query result ownership across refetch/write overlap | `query-db-collection/tests/ownership-lifecycle.oracle.test.ts` (#2002) | Receiving witness when a typed value or codec error enters accepted source commits; no second Query result controller. |
| Driver rollback/admission and receiving host execution | `db-sqlite-persistence-core/tests/contracts/sqlite-driver-contract.ts:5`; `node-db-sqlite-persistence/tests/node-persistence.test.ts:58` | Reuse driver harnesses. Direct node:sqlite cannot certify Expo/OPFS/Electron transport or scheduling. |
| Local/transported subset value admission | `db-sqlite-persistence-core/tests/persisted-oracle.test.ts` plus receiving coordinator suites | Decide and test typed wire transport. `SingleProcessCoordinator` also invokes the projection. |

The ordinary-work budget is explicitly described as a proposed deterministic
work contract, not browser latency evidence. The #2002 receiving Node test
checks immediate source writes; the committed map leaves the reported two-
refetch Node schedule and Expo scheduling open. None of these owner limits is
retired by the Temporal design.
