# PR #2069 native SQLite index receiving audit

Oracle code and coverage-map commit: `b4d57ced63d513dd0dcb794b8e8bb2a840577758`.
This record audits two fixed histories added to
`packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`.
It does not claim arbitrary host scheduling or a new product behavior.

**Subsequent review correction:** At this recorded code commit, the durable
assertion polled after recovery settlement and checked the index name without
checking its table. Its cleanup path also discarded secondary failures. Those
claims below were too broad for this exact code commit. The
[follow-up audit](issue-2069-native-ddl-review-followup-b42b94b73.md) records
the repaired checkpoint, target-table assertion, and failure handling at
`b42b94b73ddba79a6a87fa93e71787dd126ea1bd`.

## Law and receiving boundary

The Collection's current index declaration determines whether a successful
index operation on its claimed persisted cache should leave a physical index.
The Collection index registry and the persisted wrapper's index lifecycle are
the authority. The controlled owner in `persisted-oracle.test.ts` already held
new-generation bootstrap ensure behind removal and held reconciliation removal
behind re-add. Its Map did not establish how SQLite's registry and physical DDL
behave in those orders.

The new receiver uses the real persisted wrapper and `node:sqlite` adapter. It
holds the first new-generation `ensureIndex` before native DDL, lets removal
settle, then releases ensure. One history ends with no declaration; after
rotation the registry row must be removed and its named index absent from
`sqlite_master`. The neighboring history holds the reconciliation removal,
re-adds the same signature, lets the replacement ensure finish, then releases
that removal. After recovery, the registry row must be active and the named
physical index present. Both compare the Collection's public index metadata
at the same final checkpoint. The fixture serializes transactions on its one
`DatabaseSync` handle; the holds control the order of adapter calls, while
SQLite executes the actual registry writes, `CREATE INDEX`, and `DROP INDEX`.

The two histories are independent of the wrapper's reconciliation branch in
their expected result: absence or presence comes solely from the final public
declaration. The observed registry state and `sqlite_master` are distinct
durable facts. The test checks that rotation actually changed the storage ID.

## Hostile calibration

Two temporary production mutants were run and then removed:

- Returning early from reconciliation when a declaration was removed left the
  late native index active. The no-declaration history failed its registry
  assertion (`removed` was `0`, expected `1`).
- Returning success without re-ensuring a re-added declaration let the held
  native removal win. The re-add history failed its registry assertion
  (`removed` was `1`, expected `0`).

Both were assertion failures at the intended durable checkpoint, not timeouts
or setup failures. The restored production code passed both histories and the
full SQLite persistence suite.

## Oracle-guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The Collection index declaration is the law's authority; these two orders and Node SQLite are the limit. |
| ORC-002 | Expected presence is derived from public index metadata, not the wrapper's reconciliation result or SQLite registry. |
| ORC-003 | The existing owner's opening law and local receiving comment name the contract, two legal orders, real production path, public/durable observations, and final comparison. |
| ORC-004 | Not applicable: the addition is two fixed histories, not a generated-history claim. |
| ORC-005 | The persisted wrapper reaches real SQLite DDL; storage-ID change, public declaration, registry row, and physical index are observed after recovery. |
| ORC-006 | Both temporary wrong designs failed at the registry comparison as recorded above. |
| ORC-007 | Not applicable: no important generated property was added or changed. The owner's existing generated campaigns remain in the package suite. |
| ORC-008 | Not applicable: the independent reference rule adds no stateful model state. |
| ORC-009 | The history uses Collection declaration, persisted cache generation, claim, and recovery in the glossary's senses. The transaction queue is fixture scheduling, not a product state. |
| ORC-010 | Every hold is released in `finally`; cleanup preserves the primary assertion failure if it also fails. No shrink or replay mechanism was added. |
| ORC-011 | Real `node:sqlite` registry and physical DDL provide a second formulation beside the controlled Map; other hosts remain unproved. |
| ORC-012 | This versioned record ties the audit and mutant outcomes to the exact code commit. |
| ORC-013 | The absent and re-added declarations are neighboring legal outcomes. Each rejects a plausible wrong final state at the durable checkpoint. |
| ORC-014 | The controlled call-order premise is reproduced at the wrapper-to-real-SQLite boundary. Native Browser, Electron, and other host scheduling are still separate receiving cuts. |

Verification on the restored code: the focused owner passed 89 tests; the full
SQLite persistence package passed 965 tests with one existing todo. Package
TypeScript, changed-file ESLint, Prettier, and `git diff --check` passed. The
change added tests and contract documentation only; production code changed by
zero lines. The coverage map retains host-specific DDL scheduling as an open
limit rather than claiming exhaustive concurrency coverage.
