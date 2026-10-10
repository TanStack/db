# Core SQLite persistence oracle gaps

The reviewed code and oracle head is `dc42f42e9`, based on `origin/main` at
`f7ac2c63a`. This record covers direct persisted-options ownership, an on-demand
full reload with no active subset demand, and two-source persisted readiness
across one source restart. The executable owners are
`packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` and
`persisted-readiness-oracle.test.ts`. The coverage map states their remaining
limits.

## Laws and distinguishing histories

**One runtime, one Collection.** A persistence receipt belongs to the
Collection whose mutation produced it. Reusing one direct options descriptor,
or a spread copy that retains its closures, cannot transfer that ownership to a
second Collection. A second `createCollection` now rejects at admission. The
first Collection still writes visibly and durably. Cleanup does not make its
captured runtime reusable. Fresh options materialized for separate DbClients
remain legal. The old implementation let both second creations succeed; a
diagnostic history observed the first writer's durable receipt fulfill while
the row appeared in the second Collection. Both new rejection witnesses failed
before the repair and pass afterward. The invariant guard in `setCollection`
also rejects a manually copied sync closure that bypasses the descriptor hook.

A follow-up oracle at `0b10fa44e` exercises the same-object and spread-copy
cases with a wrapped upstream sync source. After the second creation rejects,
the first source commits a row that remains public and durable. Temporarily
removing the sync-present claim made both cases fail at the intended admission
assertion; the restored code passes. This checks both option-construction
branches for this bounded ownership history.

**Demand controls persisted row reads.** The public SQLite persistence guide
says an on-demand Collection loads rows for active query demand. A plausible
rival rule treated every coordinator full-reload notice as an implicit
unconstrained demand. With a stored row and no subset owner, that rival called
`loadSubset({})` and exposed the row. The new witness checks zero adapter row
loads and no unsolicited public row after a full-reload notice, then checks
that a later unconstrained demand loads the row. It also observes a collection
metadata read, so an ignored notification cannot make the zero-load assertion
pass. The corrected witness failed on `origin/main` at the row-load assertion.
Its first draft was falsely green because the coordinator fixture's default
Collection ID differed from the test Collection's ID; the driver now sends the
exact ID.

The old source-precedence matrix had encoded the rival rule in its on-demand,
no-demand full-reload cells. Eighteen such cells now derive separate public and
durable snapshots. The public snapshot retains accepted source rows but does
not acquire unrelated persisted rows. Durable storage still retains those rows.
Insert, update, delete, truncate replay, and queued or serial source changes
all pass. Three older failure/metadata fixtures now establish an active subset
before expecting a full-reload row read. This preserves their original failure
and metadata laws under a legal premise.

**Readiness belongs to the current sync run of every source.** The glossary and
readiness owner require all opted-in eager sources to complete persisted restore
in their current runs. A completed restore in source A's old run cannot satisfy
the joined query after A cleans up and restarts, even if source B then restores.
The new controlled history checks `loading` and an unsettled initial-render
wait while A's second read is held, then `ready` and joined rows after release.
It passed unchanged production. A temporary stale-`ready` wrong-answer control
failed at the intended comparison (`ready` versus `loading`) and was removed.
The old live query is not expected to survive source cleanup; the driver creates
a new query after restart.

## Instrument outcomes and limits

Law discovery separated a descriptor's per-Collection ownership from DbClient's
fresh materialization. It also separated a full-reload notification from an
active subset demand. The on-demand model has zero or one demand for this
witness; the existing matrix supplies adjacent source histories. A tension scan
found a different reset obligation: `collection:reset` truncates the public
snapshot, while the established accepted-source law requires a compatible
durable baseline reread to retain an earlier accepted row in the controlled
matrix. The repair therefore keeps reset's existing unconstrained fallback and
narrows the new no-demand law to ordinary full-reload notices. Avoiding the reset
read needs an authority decision and a model for post-reset row provenance.

An adversarial enforcement check caught the wrong-ID false green before the
production edit. The corrected fixture reached the metadata-read boundary and
failed on the original unbounded row read. The original direct-reuse behavior
failed both ownership cases. These are assertion failures at the intended
checkpoints, not setup failures or timeouts. No native SQLite or cross-tab host
claim follows from these controlled adapters. Previously loaded rows after
demand retirement, reset without demand, atomic multi-subset reload, and
arbitrary provider schedules remain open under the persisted wrapper and host
owners named in the coverage map.

## Oracle-guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The ownership, demand, and current-run laws above cite the Collection receipt boundary, public guide, and glossary. Their scopes and omissions are explicit. |
| ORC-002 | Expected ownership is a one-owner admission rule; demand is a zero/one logical-owner rule; readiness uses the independent all-source outcome model. None imports the runtime's queue or classifier. |
| ORC-003 | Law prose sits beside the new histories and model distinctions. The tests separate legal setup, production entry, public observation, and comparison checkpoint. |
| ORC-004 | The new cases and changed matrix are finite enumerations, not a generated-history coverage claim. The existing generated campaigns are unchanged. |
| ORC-005 | Direct `createCollection`, coordinator notification with exact Collection ID, later subset load, and a restarted source through a new observer all ran. The checks observe rejection, rows, durable writes, adapter reads, and readiness at their named cuts. |
| ORC-006 | The original ownership and unbounded-read designs failed their new comparisons. The temporary stale-readiness result failed at `loading`; the test was restored before review. |
| ORC-007 | No important generated property was added or edited. Existing fixed/random campaigns and replay interfaces remain unchanged. |
| ORC-008 | One-owner claimed/unclaimed and zero/one demand distinctions each permit a different next creation or row read. The readiness model already distinguishes each source's current outcome; the new history adds no production-generation mirror. |
| ORC-009 | The tests use Collection, subset demand, sync run, persisted restore, and persisted readiness as in the glossary. `claimed` is the descriptor's model-only admission bit. |
| ORC-010 | Ownership and no-demand witnesses use `cleanupPersistedOracle`; readiness uses `checkWithCleanup`. Primary mismatches remain visible while cleanup attempts every resource. |
| ORC-011 | The named shared-fault risk was a notification treated as demand by both production and the old matrix. The public guide and a separate zero/one-demand formulation exposed it; the matrix now keeps public and durable snapshots distinct. |
| ORC-012 | This record binds the review to the code head above and gives the law, old failure, adjacent controls, verification, and open cells. |
| ORC-013 | Same-object versus spread-copy, zero versus one demand, and old versus current restore each distinguish a plausible wrong boundary at a public checkpoint. |
| ORC-014 | The coordinator and storage adapter are controlled. The claim ends at those premises; real host delivery and native SQLite generation are assigned to existing receiving owners. |

Verification on the reviewed code: 707 persistence/readiness oracle tests passed,
with one pre-existing todo; 209 DB client and LocalStorage regression tests
passed. Standalone TypeScript checks for both packages, both package builds,
changed-file lint, formatting, and whitespace checks passed. Lint reported only
existing `require-await` warnings in the large persistence oracle. Production
code adds 38 lines and removes 6; oracle tests add 271 and remove 6, counted
separately from coverage documentation.

The `0b10fa44e` follow-up passed the full core package suite: 1,228 tests,
two existing todos, and no type errors. Changed-file lint and formatting passed;
lint retained only existing `require-await` warnings. The sync-present
wrong-answer control failed both new runtime cases before it was removed.
