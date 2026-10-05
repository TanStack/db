# IndexedDB oracle contract and audit

This suite replaces the original CRUD and cross-tab examples. Its design follows
the local-storage rejection/successful-suffix tests, SQLite persistence ledger
and restore oracles, and offline-transactions IndexedDB settlement owner.
Their laws inform this suite; their host guarantees do not transfer to fake-IDB.

## Owners and checkpoints

| Owner                               | Independent judgment                                                                                               | Production path and checkpoint                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| persistence-oracle.test.ts          | Two arrays of authored rows, keyed by store and typed key                                                          | Automatic CRUD, manual acceptance, clear/import, cleanup/restart and fresh restore. Compare public, subscription, peer, export, raw durable rows and version ownership after settlement and explicit message delivery.                           |
| settlement-oracle.test.ts           | Before/after snapshots selected by application decision; source deletion survives removal of an optimistic overlay | Held handlers, resolve/reject, clone failures at either position in a batch, IDB aborts, populated restore, remote delete/clear during pending local deletion. Observe handler entry, settlement, source delivery, successful suffix and reopen. |
| transport-oracle.test.ts            | Union of disjoint accepted writes; exclusion of self/foreign messages                                              | Two writers, duplicated FIFO/reversed notifications, delayed CRUD, special keys and cleanup before initial load completes. Compare both Collections and fresh restore.                                                                           |
| wrapper.test.ts                     | Callback success AND native transaction completion are separate obligations                                        | Request success followed by abort; callback settlement after transaction completion; exact error identity, multi-store rollback, request values, upgrades and deletion.                                                                          |
| api.test.ts and indexeddb.test-d.ts | Configuration, schema and type contracts                                                                           | Synchronous validation, reserved metadata store, transformed import inputs, duplicate rejection, utilities and precise API types.                                                                                                                |

harness.ts owns setup, raw IDB requests, controlled transport and cleanup. It
supplies the provider and transport, never expected product results. It removes
only the five documented virtual fields. Row comparisons preserve multiplicity,
typed keys, values and extra user fields. An absent optional property and the
same property with value undefined are equal in this model's value domain.
Object-property presence is not claimed.

The model combines source and optimistic snapshots only at settled checkpoints.
The boundary owner keeps the unresolved decision separate because resolve/reject
distinguishes it. Store and typed-key identity cannot be combined: same-key manual
transactions distinguish ownership. Versions are durable observations, not a
second version generator. Changed values require a new version; unrelated keys
preserve theirs. An authored no-op may preserve or refresh a version; no public
law specifies which.

## Grammar, reconstruction and calibration

Histories have 0–20 actions, one initially populated store and one empty store.
Keys are numeric 0/1 and string "0"/"1"; values range from -2 to 2; an optional
field is present or removed. Actions are write, delete, clear, import, reopen,
and manual acceptance. Write chooses a legal insert/update using model
membership. Empty-store delete first inserts. Import chooses empty or one-row
replacement. Manual acceptance writes overlapping keys with distinct values in
two stores. Every history ends with fresh restores.

The authored reconstruction history visits every action in both stores.
Pinned cases retain generated update/clear and repeated no-op histories.
Matrices reconstruct CRUD × decision, persistence-entry × bad-row-position,
and remote delete/clear × local rollback/commit. Transport cases retain the old
rapid/concurrent and routing coverage. Missing-key updates and duplicate imported
keys have explicit rejection witnesses.

Each axis contributes independently:

- Typed keys distinguish number/string identity.
- Two stores distinguish ownership and clear isolation.
- Changed fields distinguish update/version and source-value laws.
- Replacement distinguishes empty/nonempty stores, reused keys and stale rows.
- Reopen distinguishes hydration and rejected-write leakage.
- Held decisions distinguish premature durability and broadcasts.
- Later bad rows distinguish atomic rollback from prefix commit.
- Pending local deletes distinguish source deletion from optimistic visibility.
- Raw durable reads reject optimistic-only false greens.
- Request/transaction cuts distinguish request success from persistence success.

Permanent checker controls reject missing/duplicate rows, wrong key types and
extra user values. Original-source witnesses fail at public/durable checkpoints.
A per-row-transaction mutant reaches clone failure and fails durable-prefix
assertions for automatic and manual writes. A partial-row sync mutant survives:
Collection edits represent removal with undefined, so partial and full updates
are equivalent for those bounded inputs. This survival is not proof for arbitrary
partial-row compatibility. The adapter declares full rows because it reads and
confirms whole durable snapshots.

Atomic failed replacement is an explicit repair decision: import preserves the
existing snapshot and versions if validation or persistence fails, strengthening
the original clear-then-write implementation. The test and README carry that
decision together. Separate per-Collection acceptance calls are not atomic
across Collections.

## Campaigns and direct replay

The normal test command runs the same property, generator, recorder, driver and
30-run budget twice: fixed seed 1179001, then no supplied seed. Each campaign
reports its actual seed, run count and outcome. Fast-check reports counterexample
and shrink path; verbose output retains failed histories. A reduced trace proves
its reported checkpoint; do not label a reduction a reproduction of a different
facet without replaying both.

From this package directory:

```sh
INDEXEDDB_ORACLE_SEED=1179001 INDEXEDDB_ORACLE_PATH=0:1:0:0:2:2 \
  pnpm exec vitest run tests/persistence-oracle.test.ts \
  -t 'replay histories' --coverage.enabled=false --typecheck.enabled=false
```

Replay selects only that campaign without fixed/random execution first. This
uses an array arbitrary, not fc.commands, so command replayPath does not apply.
Those coordinates reproduced the original clear failure at the public snapshot
checkpoint and pass with the repair. The update/clear counterexample is also a
permanent authored case. Cleanup captures the primary error before releasing
Collections and database handles; secondary failures use AggregateError with
the primary as cause.

## Guide audit

| Requirement | Evidence                                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001     | Contracts and limits precede mechanics in executable owners. Authorities: Collection settlement, package APIs and IDB transaction semantics. Atomic failed replacement is documented above.                           |
| ORC-002     | Authored arrays, decision-selected snapshots, disjoint union and separate settlement obligations do not reuse production semantic machinery. Raw IDB observes durability independently.                               |
| ORC-003     | Each owner explains contract, model, grammar, driver and refinement cuts; the mechanical companion is directly named.                                                                                                 |
| ORC-004     | Bounded domains, reconstruction witnesses, axis ablations and nearby rejected inputs appear above and in tests.                                                                                                       |
| ORC-005     | Exact rows, handler/message counts, transaction outcomes, status and durable versions are observed at named cuts. Each generated action plus startup reaches a checkpoint.                                            |
| ORC-006     | Permanent wrong-snapshot controls, original red tests and assertion-killed prefix-commit mutant. Partial-row survival is explicitly scoped, not called a kill.                                                        |
| ORC-007     | Fixed/random 30-run parity, actual completed-campaign output and checked direct seed/path replay.                                                                                                                     |
| ORC-008     | Settled source/optimistic state collapses only where indistinguishable. Held decisions, source deletion, store and typed-key identity retain distinguishing next actions.                                             |
| ORC-009     | Shared vocabulary follows the glossary. Model projections are mapped in executable prose and above.                                                                                                                   |
| ORC-010     | Cleanup preserves primary and secondary errors. Verbose histories retain original/reduced inputs; evidence distinguishes actual replay from setup errors and does not credit changed facets as the same failure.      |
| ORC-011     | Named shared-fault risk: trusting adapter export as proof of storage. Raw native reads and fresh Collection restore are separately observed formulations of the same unordered keyed values, preserving multiplicity. |
| ORC-012     | This audit and ORACLE-EVIDENCE.md identify the reviewed snapshot, red/green observations, mutants and remaining cells. No universal bug-class closure is claimed.                                                     |
| ORC-013     | Held versus released/rejected, request success versus abort/complete, first versus later bad row, and populated versus empty startup distinguish the bounded laws.                                                    |
| ORC-014     | Claims stop at fake-IDB and controlled transport. Native browser scheduling, failure shapes and crash durability remain unresolved under this package's coverage-map ownership.                                       |

## Remaining boundaries

Not proved: same-key concurrent-writer conflict resolution; arbitrary delayed
clear/import interleavings; cleanup during writes or remote reads; native quota,
blocked upgrade and versionchange events; process crashes; downstream queries;
every transient subscription batch; and timing guarantees. The cleanup witness
covers initial load followed by restart only. Cross-Collection atomicity is not
promised.

These are coverage limits, not retired obligations. Native handoff needs a
multi-page browser driver with real IndexedDB/BroadcastChannel at the same cuts.
Pending cleanup/write and delayed replacement histories belong in this package's
boundary/transport owners before stronger closure claims.
