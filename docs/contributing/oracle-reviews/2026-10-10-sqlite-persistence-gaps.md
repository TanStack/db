# Core SQLite persistence oracle gaps

The initial reviewed code and oracle head was `dc42f42e9`; the final code and
oracle follow-up is `dc34b91f6`, based on `origin/main` at `f7ac2c63a`.
This record covers direct persisted-options ownership, an on-demand
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
demand retirement remained open at this review head. The follow-up below
closes the controlled peer-notice history. Reset without demand, atomic
multi-subset reload, and arbitrary provider schedules remain with the owners
named in the coverage map.

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

## Copied sync config and control ownership

CodeRabbit's comment on `75e265ac3` identified a path outside the descriptor
claim: a caller can select the exposed wrapped `sync` field into a second
Collection without copying the claim symbol. Both wrapped sync functions called
`setSyncControls` before `setCollection` rejected that second owner. The
independent law is that rejected admission leaves the first owner's sync run,
controls, public rows, and durability path unchanged.

The primary owner now runs that selected-field history through the local-only
loopback and upstream-sync paths. On the pre-fix code, the local-only first
owner's subsequent durable insert disappeared from its public Collection; an
upstream transaction opened before the rejected second start aborted at commit.
These were assertion and receipt failures after the rejection was reached. The
repair checks owner identity before registering the new controls, while keeping
registration before coordinator subscription for a valid owner. Both histories
then retain the first owner's public and durable row. Ordinary same-owner sync
restart remains covered by the existing lifecycle histories. Controlled
Collections and adapters do not prove behavior in every native host.

After the repair, the full core package passed 1,231 tests with two existing
todos and no type errors. The package build, changed-file lint, formatting,
and whitespace checks passed; lint retained only existing warnings. The
repair is production-line neutral: it combines the two control/binding calls
into one guarded operation without adding lifecycle state.

## Prep review follow-up at `0108e5f2a`

The prep review found one invalid Electric oracle fixture and three persisted
runtime gaps. The following table preserves the claims in source order.

| ID | Review claim and proposed action | Result |
| --- | --- | --- |
| S1 | Name the arguments to `reloadActiveSubsetsUnsafe` for readability. | Refuted as a useful change: it adds a new shape without reducing state or branches. |
| R1 | One Electric descriptor fixture reuses a persisted wrapper and fails CI. Create a fresh wrapper per Collection. | Fixed in the oracle fixture. |
| R2 | A row stays public after demand retirement and a peer full-reload deletion. Validate already public rows at the notice. | Fixed in production and the primary oracle. |
| R3 | A selected wrapped `sync` field can bind another Collection after cleanup. Retain the original owner identity. | Fixed in production and the primary oracle. |
| R4 | A constrained reacquisition still leaves a deleted public row visible. Validate its scope or cached rows against durable state. | Fixed by R2's immediate validation and asserted after reacquisition. |

**R1, Electric fixture.** The Electric descriptor law permits the same Electric
descriptor to create independent Collections. The fixture reused one *persisted*
wrapper around that descriptor, which contradicted the wrapper's single-owner
law and failed CI. The oracle now creates a fresh persisted wrapper for each
Collection while reusing the Electric descriptor. Its first-only
acknowledgement assertion remains. The repaired 30-test descriptor suite and
630-test Electric package suite pass.

**R3, selected sync ownership.** Cleanup ends a sync run but does not transfer
the runtime's Collection owner. A caller could copy only the wrapped `sync`
field, omitting the public claim hook, then bind another Collection after the
first cleaned up. The two new histories select that field in local-only and
upstream-sync modes. Both failed at second-owner admission before the repair.
They now pass: the second Collection rejects, and the first restarts and writes
publicly and durably. The permanent owner identity outlives cleanup.

**R2 and R4, peer notice after demand retirement.** The user confirmed that
a row which remains public after a peer deletes it is wrong, even with no
active subset demand. Demand retirement stops future acquisition work. It does
not make already public rows exempt from peer changes. A full-reload notice
with no public rows still reads collection metadata only. If public rows exist,
the wrapper reads one durable snapshot and corrects only those public keys.
It deletes missing rows, updates changed rows, and removes obsolete row
metadata in one sync transaction with collection metadata. It does not expose
unrelated durable rows without demand.

The primary oracle reaches initial zero demand, an unconstrained demand that
retires, peer deletion, and a later unconstrained demand. A second history
reaches peer deletion, row update, and row-metadata removal after demand
retirement, then acquires a constrained demand. Both histories failed on the
old metadata-only notification at the intended snapshot-read checkpoint.
The earlier no-demand history had no previously public row. That missing
history dimension let the stale-row behavior pass while the narrower law held.
The final code passes their notice and later-acquisition assertions. The
constrained continuation needs no second validation read. The existing
18-cell source-precedence matrix still passes: accepted source transactions
retain precedence over persisted reads. The full persistence-core suite passes
879 tests with one existing todo. Standalone TypeScript, the package build,
changed-file lint, formatting, and whitespace checks pass. Lint reports only
24 existing `require-await` warnings in the large oracle file.

The controlled adapter proves this law for its emitted notices and the
observed Collection checkpoints. Browser and Electron delivery remain with
their host oracles. Arbitrary overlapping retired subsets, live host
scheduling, and performance with large durable snapshots remain outside these
bounded histories. A full snapshot is the available adapter read that proves
absence of an already public key; the wrapper publishes only previously
visible keys from that read.

The loss audit accounts for all five source-order items: R1–R4 are fixed, and
S1 was not adopted. The fixed-history and controlled-adapter evidence closes
these review findings within their stated scope. Final-head CI and host-level
delivery remain separate PR readiness checks.
