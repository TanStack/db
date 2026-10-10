# PR #2069 native SQLite oracle review follow-up

Reviewed oracle code: `b42b94b73ddba79a6a87fa93e71787dd126ea1bd`.
Two independent oracle reviewers read the preceding `b4d57ced6` receiver and
found three enforcement gaps, not production defects. This append-only record
corrects the earlier [native DDL audit](issue-2069-native-ddl-receiver-b4d57ced6.md).

| Finding | Why the prior check could pass wrongly | Correction and observation |
| --- | --- | --- |
| Recovery-settlement cut | `vi.waitFor` could observe a late DDL repair after recovery returned. | The registry and physical index are read synchronously after the recovery promise settles. A later repair cannot satisfy this checkpoint. |
| Claimed physical table | Looking up `sqlite_master` by index name alone allowed the expected name on a different table. | The present-index branch now requires both that exact name and `tbl_name = createPersistedTableName(current physical ID, 'c')`. The absent branch requires no index with that name. |
| Failure fidelity | Construction and signature validation preceded the cleanup guard; `Promise.allSettled` and a broad cleanup catch discarded secondary failures. | Construction and validation now occur inside the guard. Cleanup releases both holds, observes recovery rejection with a bounded checkpoint, preserves distinct secondary failures, closes SQLite, and retains the original failure. |

The reference relation remains: at recovery settlement, the final public
Collection index declaration predicts whether SQLite has an active index on
the current claimed row table. The two legal schedules still exercise removal
before late ensure and re-add before a held reconciliation removal. The first
mutant skipped removal after late ensure; the second skipped re-ensure after
re-add. Both failed the durable registry comparison at the earlier code commit.
The stronger current comparison additionally rejects a wrong target table or
a repair that occurs only after recovery settles by construction. A separate
wrong-table production mutant was not run; this remains a calibration limit.

| Requirement | Outcome at the follow-up code commit |
| --- | --- |
| ORC-001 | Collection index declaration is authoritative for these two Node SQLite schedules; other hosts and arbitrary timing remain outside the claim. |
| ORC-002 | Expected presence and table identity come from the public declaration and current claimed storage ID, not the reconciliation branch or SQLite registry state. |
| ORC-003 | Opening and local prose identify the law, legal schedules, real adapter path, public/durable observations, and exact recovery-settlement comparison. |
| ORC-004 | Not applicable: two fixed histories, no generated grammar claim. |
| ORC-005 | The real wrapper and `node:sqlite` perform DDL; the final check sees the correct registry state and physical table at recovery settlement. |
| ORC-006 | The two reconciliation mutants failed at the intended durable assertion; no wrong-table mutant was run. |
| ORC-007 | Not applicable: no important generated property changed. |
| ORC-008 | Not applicable: no stateful reference-model state changed. |
| ORC-009 | Collection declaration, claim, persisted cache generation, and recovery follow the glossary; the transaction queue is test scheduling only. |
| ORC-010 | The guard covers construction through teardown, releases held calls, and preserves secondary recovery/cleanup failures beside the primary mismatch. |
| ORC-011 | Real SQLite DDL is the second formulation for the controlled Map schedule, with host-specific receiving work still open. |
| ORC-012 | This record names the exact corrected code commit, the findings, and outcomes for every numbered requirement. |
| ORC-013 | Absent and re-added declarations distinguish the two legal final states. Each reconciliation mutant fails its neighboring history. |
| ORC-014 | The controlled order is reproduced at the wrapper-to-SQLite boundary. Browser, Electron, and other host scheduling remain unproved. |

The corrected owner passed all 89 tests. TypeScript, changed-file ESLint, and
Prettier passed. The full SQLite persistence package passed 965 tests and one
existing todo before this test-only correction; the package was not rerun
afterward because the corrected owner, containing every changed test, passed.
Production code remains unchanged.
