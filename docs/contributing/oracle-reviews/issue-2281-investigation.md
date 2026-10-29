# Issue #2281 investigation

Investigated on 2026-10-29 against production commit
`82c5f999b32c9db827dd74e3f172604dfda28013`. The working branch is
`codex/investigate-2281`.
The investigation sections below preserve the original findings. The appended
implementation evidence records the subsequent repair and supersedes their
open-work status.

This record describes an investigation, not a production repair or a claim
that the bug class is closed. Production and the generated campaign are
unchanged. The test additions retain two reduced counterexamples and four
passing controls through the existing model, driver, and comparison.

Read the [issue and both comments](https://github.com/TanStack/db/issues/2281).
There are two different accounts of the multi-tab failures:

1. The original reset/deploy trace reaches a premature convergence checkpoint.
   Its final deliveries fail the sources; the driver does not recover them
   afterward. Row 1 never leaves durable storage in this trace.
2. Both later multi-tab traces expose a production defect: a lagging source
   changes the shared rows, then another source stores a newer resume position
   without repairing those rows. A reopened source resumes beyond the missing
   change. This is a concrete extension of the ordering problem in
   [#2209](https://github.com/TanStack/db/issues/2209).

The separate sync-metadata trace also reproduces. Its root cause was not
investigated here; no evidence joins it to the source-position defect.

## Authority and observation

Law 2 in `multi-tab-electric-oracle.test.ts` promises that durable rows and
every open eager tab equal the server head after the streams catch up. Its
authority is the persisted multi-tab eventual-consistency contract recorded
in the coverage map and #2209. Temporary regressions during interleaving are
allowed. Permanent divergence after recovery and catch-up is a violation.

Law 5 in the same owner requires a peer reset to abandon older reservations.
Electric's next commit of such a transaction fails its source, and the app
recovers by restarting the tab. That maintainer decision on PR #2265 matters
to the original trace: a failed commit cannot establish catch-up.

All experiments use the existing production driver: one SQLite file, a
better-sqlite3 connection per tab, the real Browser coordinator with Node
BroadcastChannel/Web Locks, the Browser persistence factory, persisted
Collections, and Electric with a controlled ShapeStream. The existing check
compares durable rows, public rows, and Collection status after each step
and at the final checkpoint. Temporary instrumentation additionally read
`collection_metadata['electric:resume']` through an observer connection and
recorded each recovered stream's requested handle/offset.

## Original trace: the final delivery creates the failure

Seed `-1115798760`, path `1:4:3:3:3:3:3:3:3:3:3` reproduces the issue's exact
final mismatch. Both tabs stage row 1's delete without committing, then the
peer reset abandons both reservations. Durable rows remain the initial rows
1 and 2 through every numbered step. There is no durable deletion followed
by a durable resurrection in this execution.

The final loop checks `failedByReset` before `deliver()`. At that point it is
false: neither abandoned transaction has tried to commit yet. Delivery
encounters must-refetch and eventually attempts the abandoned transaction's
commit. It fails with `AbortError: Sync transaction was aborted before
application`. Both tabs stay ready with source errors, as Law 5 requires.
Only now does the model set `failedByReset = true`. The loop ends and checks
the server head, without restarting either failed source.

A temporary driver intervention added the following immediately after the
final loop's existing `await deliver(index, 'all', true)`:

```ts
if (models[index]!.failedByReset) {
  await recover(index, `restart`)
  await deliver(index, `all`, true)
}
```

With unchanged production, the original replay passes. The recorded original
history shows both restarted streams request offset `-1`; both accept the
fresh snapshot, and durable rows and both ready tabs contain only row 2,
with no source error. The intervention was removed after the experiment.
It establishes this trace's missing recovery, not a general driver repair.
A permanent checkpoint repair must retain the comparison of the failed
source state and then establish successful recovery before checking Law 2.

## Later traces: rows and the resume position describe different prefixes

The resurrection in the 2026-10-29 comment reproduces with seed `-699129038`,
path `78:2:0:3:9:12:12:13:12:13:13:13:13:14:14:14`:

| Step | Durable row 3 | Durable offset |
| --- | --- | --- |
| A commits insert(3), delete(3) | absent | `2_0` |
| B commits only the older insert(3) | `v1` | `1_0` |
| A commits delete(1), insert(1) | still `v1` | `4_0` |
| B reopens, then A reopens | still `v1` | both request `4_0` |
| Both streams catch up with no remaining changes | still `v1` | `4_0` |

The server deleted row 3 at offset `2_0`. B's late insert reintroduces it.
A's next batch touches only row 1, so it advances the global resume position
without removing row 3. Both new streams skip its delete. Unlike the original
reset trace, this reaches the final comparison with healthy, caught-up
streams and permanently wrong rows.

The row-loss comment reproduces with seed `-1660880085`, path
`55:0:1:4:4:4:1:1:1:1:3:4:4:4:4`. A commits delete(1) at `1_0`, then insert(1)
at `2_0`. B's older delete removes row 1 and sets the durable offset to `1_0`.
A then receives only up-to-date at its existing `2_0`: its metadata-only
transaction advances the durable offset to `2_0` while leaving row 1 absent.
Both tabs stop and restart from `2_0`, so neither receives the missing insert.
The loss happens at B's stale commit, before either stop.

## Six-step reductions and controls

After warming both tabs with rows 1 and 2, use this shared history:

```ts
[
  { kind: `server change`, key, pick: 0 },
  { kind: `server change`, key, pick: 0 },
  { kind: `catch up`, tab: 0, pick: 0 },
  { kind: `catch up`, tab: 1, pick: 1 },
  { kind: `catch up`, tab: 0, pick: 0 },
  { kind: `recover`, tab: 1, pick: 0 },
]
```

For initially present key 1, the server changes are delete then insert. For
initially absent key 3, they are insert then delete. In each case A commits
through `2_0`, B commits only `1_0`, A stores `2_0` with an empty row batch,
and B reopens from `2_0`. Both cases fail the unchanged final comparison:
key 1 is missing, or key 3 survives with `label: 'v1'`.

| Continuation after B's older commit | Key 1 | Key 3 |
| --- | --- | --- |
| A stores its cursor; B reopens | final assertion fails | final assertion fails |
| A stores its cursor; B drains its backlog before reopening | passes | passes |
| B reopens before A stores its cursor | passes | passes |

These six executions are retained in the owner as two `it.fails` replays and
four passing controls. They contain no independent expected answers. The
existing generated grammar already has the necessary actions; its minimum
length is eight, so the six-step diagnostic reduction is shorter than its
generated domain. The reported longer counterexamples demonstrate generated
reach of the defect. No new generated reach state or sampling guarantee is
claimed by these fixed replays.

## Production mechanism and repair boundary

Relevant source locations at the investigated production commit:

- `packages/electric-db-collection/src/electric.ts:2028`,
  `stageResumeMetadata`: writes the current stream's handle and offset.
- `packages/electric-db-collection/src/electric.ts:2531`: an up-to-date with
  no open row transaction still opens and commits a metadata transaction.
- `packages/db-sqlite-persistence-core/src/persisted.ts:4529`: forwards each
  external source transaction to the coordinator with a local stream position.
- `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts:2599`: orders
  application by durable row version. Row mutations and collection metadata
  are applied together, but no Electric server position fences stale copies.

Atomic rows and metadata within each commit are insufficient: commits from
different stream positions are still composed in local arrival order. The
key-set ledger follows those same row mutations, so agreement with that
ledger does not prove that the rows equal the prefix named by the cursor.

The accepted convergence law needs a production repair. #2209's proposed
source-position protocol is relevant: the writer must reject or reconcile
older source effects and associate a resumable cursor with the state that
actually establishes its prefix. Its design must also define source identity,
handle transitions, and settlement of a tab's dropped duplicate commits.
This investigation does not choose or implement that protocol.

Two smaller changes are insufficient by themselves:

- Keeping only the maximum cursor still allows B's stale row mutation. It
  can leave storage already inconsistent with that maximum cursor.
- Suppressing metadata-only commits removes the reduced trigger but does
  not repair the reported resurrection: A's ordinary row-1 transaction
  advances to `4_0` while row 3 remains wrong.

The primary oracle's per-step fold deliberately accepts the temporary stale
rows permitted by the contract. Its final server-head comparison correctly
rejects the later traces. Fixed campaigns did not force the combination of a
stale peer write, a later cursor advance, and recovery that skips the missing
change. Existing reach for durable rows behind the server does not establish
that combination. A repair needs a declared reach for that combination in
generated histories, including empty and disjoint-key advancing batches,
both membership directions, and the relevant public receiving paths.

## Separate metadata comment

The comment's seed-only command with `_PROPERTY` fails setup on this revision:
the replay parser also requires `_PATH`. That is not evidence of the metadata
law. Instead, the existing pinned replay was run by name. With `it.fails`
temporarily removed, it fails at step 6 (`peer`) with the exact reported law:

```text
history: begin seed(1,bare) insertOverSeed(1) begin reinsert(1) commit peer(2,reload)
law: source reads its row metadata (metadata.row.get)
expected: {"1":"<absent>","2":{"peer":{"s":6}}}
actual:   {"1":{"cached":true},"2":{"peer":{"s":6}}}
```

The test file was restored. The owning sync-metadata coverage entry already
records this gap. No production root cause or repair is claimed for it.

## Evidence and replay

- **Law:** eventual server-head convergence after actual catch-up (#2209 and
  the coverage map); reset-abandoned commits fail until restart (PR #2265).
- **Reach:** all three supplied multi-tab traces executed and reached the
  reported final mismatch. Six reduced/control histories executed: two
  rejected stale final rows and four converged. These are finite witnesses,
  not a new normal generated reach measurement.
- **RED:** all three supplied seed/path replays fail on unchanged production;
  the two six-step reductions fail through the same comparison.
- **GREEN:** the four neighboring controls pass. The original reset trace
  passes after temporary post-failure recovery in the driver. These are
  diagnostic greens, not a green production repair.
- **Mutant:** none run; no closure claim. The unchanged defective production
  supplies the two reduced wrong-result witnesses.
- **Limits:** eager mode, one Collection, one process, controlled Electric
  SDK messages, Node coordinator APIs, and native SQLite. No live Electric
  HTTP/SDK, Chromium OPFS scheduling, on-demand rows, optimistic mutations,
  source-position protocol, or arbitrary interleaving closure is established.
  The original checkpoint still needs repair; both production row defects
  remain open, as does the distinct metadata gap.

Dependencies installed successfully with `pnpm install --frozen-lockfile`;
no override or lockfile change was needed. Diagnostic runs disabled coverage
and typechecking. The final six replay cases also ran with package test
typechecking enabled: four runtime controls pass, two runtime cases are
expected failures, and typechecking reports no errors.

From the repository root, replay a reported multi-tab case by setting its seed
and path above:

```sh
TANSTACK_DB_ORACLE_PROPERTY=browser.multi-tab-reserved-history \
TANSTACK_DB_ORACLE_SEED=-699129038 \
TANSTACK_DB_ORACLE_PATH='78:2:0:3:9:12:12:13:12:13:13:13:13:14:14:14' \
pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest --run \
  tests/multi-tab-electric-oracle.test.ts -t 'random or replayed' \
  --coverage.enabled=false --typecheck.enabled=false

pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest --run \
  tests/multi-tab-electric-oracle.test.ts \
  -t 'cursor-only commit|lagging stream drains|reloads before the cursor advances' \
  --coverage.enabled=false

pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest --run \
  tests/sync-metadata-session-persisted.test.ts \
  -t 'a reload after an inner re-insert' --coverage.enabled=false \
  --typecheck.enabled=false
```

Raw diagnostic logs and the temporary instrumentation patch are local artifacts
under `notes/issue-2281/` (ignored by Git). The retained tests and this record
contain the essential witnesses independently of those local artifacts.

## Implementation pre-edit gate (2026-10-29)

The user authorized implementation after the investigation. No production file
has changed at this gate. The reset checkpoint now checks the failed source
before restarting it and comparing the successful catch-up. Its original
seed/path passes on the unchanged production head.

The selected repair preserves arrival-order application. An eager Electric
source supplies an opaque progress token and the token its transaction
continues. SQLite compares that predecessor under the same writer transaction
as the rows and resume metadata. A mismatch makes the existing resume key-set
evidence incompatible, sticky until an authoritative truncate. Reopen therefore
uses the existing full-snapshot repair. Tokens contain shape identity, opaque
handle, and offset; timestamps are not progress. No lexical handle ordering,
write suppression, new receipt outcome, or stronger live-ordering law is added.
The optional bridge is exposed only by adapters that implement the atomic check.

Pre-edit receiving inventory:

| Path | Observation cut and witness |
| --- | --- |
| Controlled Electric + Browser coordinator + native SQLite, leader/follower | Existing primary owner plus generated `browser.electric-source-prefix`: both membership directions, empty/disjoint advancement, swapped source roles, repeated toggles, reload/restart and draining control; final durable/public source-head equality. |
| Real installed Electric SDK + HTTP + PostgreSQL + Chromium OPFS + actual tab coordinator | New `electric-source-prefix-oracle.opfs.spec.ts`, using real responses held before delivery. It shares `sourceHeadViolation` with the primary owner. Every cell declares held older response, stale commit, later advancement and reopened comparison reach. Empty advancement requests an actual non-live catch-up from Electric. |
| SQLite atomic resume-evidence boundary | `sqlite-resume-snapshot-oracle.test.ts`, generated opaque predecessor edges, duplicate/empty commits and authoritative replacements. The model checks complete paths since the last replacement. Comparisons occur after every durable transaction. |
| Custom persistence adapter | Optional support flag and optional bridge method preserve compatibility; unsupported adapters do not advertise atomic progress checks. Their source-head repair is outside this SQLite claim. |

The core change uses the same SQLite adapter and transaction semantics on its
other hosts. No native-device, Electron-process, progressive, or on-demand
Electric claim is transferred from these eager Browser witnesses. Those paths
are limits, not additional evidence from Node APIs.

Pre-edit RED results on `82c5f999b`:

- `browser.electric-source-prefix`, fixed seed 2281, path `0:0:0:0`:
  present key, empty advancement, no drain, final source-head comparison loses
  row 1 while both Collections are ready.
- `sqlite-resume.source-progress`, seed 2281, path `0:0:0:0:0:0`:
  snapshot → advance → advance → stale predecessor still reports `consistent`.
- Real Chromium disjoint/lost-row cell: both Collections ready, no source error,
  actual rows only `anchor:advanced`; PostgreSQL also has `target:new`.
  Reopened SDK requests the later real LSN and the shared comparison rejects
  the missing row. This is a semantic RED; an earlier recorder setup failure
  was repaired before obtaining this result.

Commands and raw output are in the ignored `notes/issue-2281/` logs. The full
real-host defect/control matrix is running before any production edit.

The pre-edit real-host matrix completed: **4 semantic REDs and 4 GREEN controls**
(2.4 minutes). Every defect cell reached the final shared source-head comparison;
all draining controls declared each required state once and passed. Production
edits begin only after this completed gate. The matrix covered lost/resurrected
rows × empty/disjoint advancement × drain/no-drain.

## Implementation evidence (2026-10-29)

This entry supersedes the investigation-only status above. It preserves the
pre-edit gate and the earlier observations instead of rewriting their outcomes.
The reviewed executable state is identified by the manifest at the end of this
record; its parent is `82c5f999b32c9db827dd74e3f172604dfda28013`.

### Repair and preserved freedom

The optional bridge now supplies a predecessor token for each eager Electric
commit. Its next token is collection metadata in that same transaction.
Tokens encode shape identity, handle and offset; timestamp differences do not
create source progress. SQLite compares tokens under its writer transaction.
A matching predecessor or repeated complete endpoint preserves continuity.
A gap remains sticky across later commits until an authoritative truncate.
Startup resumes only when the stored token, resume record and atomic source
continuity evidence agree. Otherwise Electric requests a fresh full snapshot.

The first implementation reused key-set incompatibility. A subsequent random
history rejected that design at an intermediate public-row checkpoint: cached
rows disappeared during reload even though the physical key set was intact.
Seed `-781606242`, path
`82:0:3:0:1:7:7:9:10:20:23:19:14:14:15:13:12:12:12:12:12:12:12:12:12:12:12:12`
now passes and its reduced history remains in the shared driver. Production now
stores **separate** `source_progress_incompatible` evidence. It does not
quarantine cached rows or reinterpret physical key integrity. The additive
migration checks both the setup fast path and the new column's initialization.
The generated SQLite owner reconstructs the old schema before reopening it.

Arrival-order regressions, normal applied receipts and rows remain allowed.
No source ordering, write rejection, retry queue or new receipt outcome was
introduced. This repairs unsafe continuation after reopen, while #2209's
permanently closed lagging stream and #2267's resumed-update failure remain
tracked expected failures. The distinct seed-metadata failure also stays open.

### New comment checked during implementation

The [new comment](https://github.com/TanStack/db/issues/2281#issuecomment-6500845350)
adds seed `-1371495859`, path `75:0:0:0:0:0:0:1:1:0:0`. Its eight-step trace
reloads A, deletes row 1, advances both sources, posts a peer reset, advances
A again, then reinserts row 1. It has no deploy.

The original production **and original driver** reproduce its exact CI result:
row 1 is `one` instead of `v2`; A is `error`, B is `ready`, both have source
errors, and A's preload rejects with the reported `AbortError`. Keeping original
production but using the repaired final checkpoint passes. The final delivery
is when the reset-abandoned transactions first fail; they need restart before
catch-up is established. This is an evaluation/checkpoint repair under the
adversarial-review repair-location table. No production expectation was relaxed.
The trace is retained as a fixed replay of the same model, driver and check.
Logs: `new-comment-parent-red.log`, `new-comment-checkpoint-green.log` and
`new-comment-current.log` under the ignored local notes directory.

### Evidence block

- **Law:** after successful recovery and actual catch-up, durable rows and each
  open eager Collection equal the source head (Law 2, coverage-map contract and
  #2209). Reset-abandoned commits fail until restart (PR #2265). The optional
  bridge's predecessor continuity and idempotent endpoint contract is stated in
  `SyncPersistenceCapabilityV1.resumeSnapshot` and tested independently of SQL.
- **Reach:** `browser.electric-source-prefix` uses 80 fixed-seed and 80 random
  histories. It crosses membership, 1–3 toggle pairs, swapped fast/slow roles,
  empty/disjoint advancement, drain/no-drain, reload/restart and
  current/missing/foreign provenance. `sqlite-resume.source-progress` uses the
  same 80/80 budget with 3–16 generated actions plus initial replacement.
  Its actions are advance, stale, empty, snapshot and duplicate; half the
  generated domain reconstructs an old schema. Measured counts follow below.
  The real SDK/OPFS receiver ran 10 cells, each reaching all four declared
  states once: held earlier response, stale commit, later advancement,
  reopened source comparison. No fabricated messages or source positions enter
  that driver. The original 8 cells cross membership × advancement × draining;
  2 more receive missing legacy provenance with disjoint advancement.
- **RED:** before production edits, the generated Browser owner at seed 2281,
  path `0:0:0:0`, loses row 1 at its source-head comparison. The SQLite owner
  rejects missing gap evidence. The real SDK/OPFS matrix produces 4 semantic
  failures and 4 passing drain controls. Setup/recorder failures are not counted
  as RED. The exact commands are the owner commands below on the parent
  production files with the extended tests retained.
- **GREEN:** current production passes the full Browser owner (312 tests and
  2 tracked expected failures before the final new-comment replay was added),
  SQLite resume owner (62 tests), persisted grammar (1188 tests, 49 tracked
  expected failures, 2 todo), Electric resume-race suite (49 tests), bridge
  validation (8 tests), and Browser TypeScript checking. These runs reported
  no type errors. The full real SDK/OPFS run passes 14 tests: the 10 new cells
  plus 2 existing recovery histories and 2 diagnostic tests. Final restored
  mutant runs and the added replay are recorded below.
- **Mutant:** disabling the durable gap parameter fails the SQLite fixed
  campaign at a stale predecessor (`2281`, path
  `2:3:2:5:6:5:5:0:0:2:2:2:2`), the Browser fixed campaign at a lost row
  (`2281`, `0:0:0:0`), and both real disjoint/no-drain cells. Removing the
  duplicate-endpoint exception fails the SQLite comparison (`2281`,
  `0:7:1:2:2:2:2:2:2`). Accepting missing/foreign startup tokens fails the
  Browser fixed campaign (`2281`, `2:0:0`, missing token), and both real legacy
  cells. Each rejection is an assertion failure at the intended evidence or
  source-head comparison. The real tests' polling deadlines print the actual
  persistent wrong rows; they reached the comparison, rather than timing out
  during setup. All mutants were temporary and restored with `finally`.
- **Limits:** bounded, same-version eager Electric sources sharing SQLite.
  The generic storage law does not prove provider framing. Real receiving
  evidence is Chromium OPFS against the installed SDK and local Electric /
  PostgreSQL, not a browser matrix or arbitrary network schedule. No claim is
  made for mixed old/new client writes, Electron processes, mobile/Tauri,
  multi-process WAL, custom adapters without the optional atomic capability,
  on-demand subsets, optimistic mutations, or monotonic live source ordering.
  The leftover-replay/reset scheduling handoff remains under the coverage-map
  owner. Known #2209, #2267 and metadata counterexamples are not closed here.

Measured normal-run reach (fixed seed 2281 / random):

| Declared state | Browser histories |
| --- | ---: |
| present / empty | 14 / 10 |
| present / disjoint | 11 / 13 |
| absent / empty | 6 / 6 |
| absent / disjoint | 7 / 9 |
| drained before recovery | 42 / 42 |
| missing provenance at recovery | 26 / 31 |
| foreign provenance at recovery | 21 / 30 |

| Declared state | SQLite histories |
| --- | ---: |
| discontinuous commit | 61 / 57 |
| matching commit after discontinuity | 37 / 41 |
| replacement after discontinuity | 44 / 34 |
| duplicate source position | 64 / 64 |
| legacy source progress column added | 34 / 35 |

The unchanged broader history campaign also reached every declared state in
both normal runs. Its fixed/random counts were: must-refetch 47/44, peer commit
during reservation 12/13, stopped with open transaction 21/30, recovered 78/80,
durable behind server 64/65, peer commit before readiness 48/52, peer commit
after error/give-up/abort 2/9, 3/2, 3/2, reset abandoned transaction 7/9 and
reset-abandoned commit failed 4/7. Counts include attempted histories discarded
for the already recorded #2267 gap; the focused source-prefix campaign does
not rely on that gap's exclusion.

### Oracle review (self-review)

This is a self-review; no independent reviewer was dispatched.

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Law 2 and the optional bridge contract state authority and limits. Temporary stale rows remain permitted; only actual catch-up justifies source-head equality. |
| ORC-002 | The primary model is an independent server snapshot log. The core model is a path of opaque predecessor edges. Neither imports SQL continuation decisions. PostgreSQL supplies the real receiver's independent source head. |
| ORC-003 | The owners explain laws, legal actions, models, drivers and cuts beside executable code. The shared source-head checker names its authority and bounded projection. |
| ORC-004 | Both reported membership defects reconstruct as one toggle pair with no drain. Removing the stale commit or later advancement loses the defect; drain and earlier-reopen controls distinguish it. Extra pairs, swapped roles, empty/disjoint batches, recovery type and provenance retain distinct nearby cases. The core grammar reaches gap/duplicate/replacement/migration. Prefixes beyond the source log and a snapshot without authoritative replacement are excluded. |
| ORC-005 | Controlled production path uses real Browser coordination and SQLite, observing durable/public rows and status after each step and after recovery. Real tabs hold actual SDK HTTP responses. Source facts needed for final equality have arrived before each comparison; the new-comment experiment shows why a failed final commit does not meet that premise. |
| ORC-006 | Three hostile designs fail the intended comparisons, including real gap and legacy receivers. The checkpoint's original driver also rejects both reset traces before the repair. No setup failure is credited. |
| ORC-007 | Both new properties register in `oracle-config.ts`, run equal fixed/random budgets of 80, and use direct seed/path replay. The original broad grammar was not changed, preserving all supplied replay paths. Neither uses `fc.commands`. |
| ORC-008 | The core path distinguishes a coherent prefix from one with any missing edge; later matching commits cannot erase that distinction. Replacement resets the path. Duplicate endpoints add no edge. No production queue or recovery controller is copied into the model. |
| ORC-009 | The glossary defines source progress token. Model-only edges and the server snapshot log map to predecessor continuity and source states; they are not durable row versions or timestamps. |
| ORC-010 | Primary histories retain step/checkpoint and expected/actual observations. The real receiver retains its primary error as `cause`, appends observation/cleanup diagnostics and closes pages, coordinators, databases and temporary PostgreSQL tables. Core preserves primary failure during database cleanup. |
| ORC-011 | The concrete shared-fault hypothesis is trusting a wrong cursor as proof of rows. Source-head recomputation independently challenges the storage edge model; PostgreSQL rows challenge the controlled server/SDK premise. No additional duplicate model is needed for that hypothesis. |
| ORC-012 | This record gives each requirement's result, exact parent, executable manifest, witnessed boundaries, mutants and explicit remaining limits. No known in-scope counterexample remains in the bounded reopened-source class. |
| ORC-013 | Matching versus stale predecessor, repeated endpoint versus new position, sticky gap versus authoritative replacement, both memberships, empty/disjoint advancement and draining controls distinguish nearby wrong rules. Missing provenance cannot be rescued by intact key-set evidence. |
| ORC-014 | The real HTTP/SDK/OPFS receiver reproduces delayed old delivery followed by later cursor advancement. It shares `sourceHeadViolation` with the primary owner and reads PostgreSQL for the expected head. Ten finite cells bound the handoff. |
| ORC-015 | Both generated properties use failing `createOracleReach` checks; normal-run counts appear above. Each real receiving cell declares its own four reaches, all once. |
| ORC-016 | Fixed regressions replay `runGeneratedHistory`; the real cells call the shared judgment. Bridge validation examples stay in the ordinary `sync-persistence.test.ts`. No standalone type examples were added to oracle files. |

The material formulation attack was a premature catch-up cut; the new trace
confirms that evaluation repair. The conceptual/composition attack was treating
source continuity and physical key integrity as one fact; the cached-row
counterexample required separate evidence. The suitability tradeoff is a full
snapshot after a discontinuity, instead of ordering opaque source handles.
That preserves the accepted arrival-order contract and uses existing recovery.
The tests establish correctness for those cuts, not optimal network work.

Reproduce the main commands from the worktree root:

```sh
pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest --run \
  tests/sqlite-resume-snapshot-oracle.test.ts \
  --coverage.enabled=false --disableConsoleIntercept
pnpm --filter @tanstack/browser-db-sqlite-persistence exec vitest --run \
  tests/multi-tab-electric-oracle.test.ts \
  --coverage.enabled=false --disableConsoleIntercept
pnpm --filter @tanstack/browser-db-sqlite-persistence exec playwright test \
  --config playwright.opfs-electric.config.ts \
  electric-source-prefix-oracle.opfs.spec.ts electric-resume-two-tab.opfs.spec.ts
```

Mutation commands used the fixed-seed tests selected by behavior name, with
coverage and typechecking disabled. The real gap mutant selected
`--grep 'after disjoint advancement$'`; the provenance mutant selected
`--grep 'from legacy progress'`. The normal typed owner runs above supply the
separate type evidence. Raw logs and the restoring mutation script remain local
in the ignored `notes/issue-2281/` directory.

### Restored checks, code weight and cleanup refinement

After restoring all three mutants, both new generated campaigns pass again.
The SQLite owner passes all 62 tests with no type errors. The Browser selected
run passes 8 reported tests, including the new-comment and cached-row replays,
with no type errors. All 6 real disjoint cells pass, including both legacy
cells that rejected the provenance mutant. The fixed reaches are unchanged;
that restored random run reached Browser states 11/19/11/7/32/36/22 and SQLite
states 56/46/40/64/44, in the table order above.

Self-review found a separate recorder weakness: the existing Node driver
silently ignored Collection cleanup failures, and campaign `finally` blocks
could replace a primary mismatch. Cleanup now attempts every resource release,
retains errors, and aggregates a secondary cleanup error with the original
violation as `cause`. This changes test machinery only. The broader owner was
rerun after this refinement; its result is appended below.

`pnpm size:compare --files --packages db,db-sqlite-persistence-core,electric-db-collection`
compares the parent merge-base with production minified bundles:

| Package/scenario | Gzip change | Brotli change |
| --- | ---: | ---: |
| db | +37 B | -55 B |
| db-sqlite-persistence-core | +368 B | +321 B |
| electric-db-collection | +132 B | +112 B |
| three-package total | +537 B | +378 B |
| typical app scenario | +45 B | -60 B |

The source delta is 156 inserted and 19 removed production lines across five
files. Test/config additions are separate: 1059 inserted and 23 removed lines
before this final evidence entry; none ships in the package bundles.

Production grows because safe continuation needs durable provenance and an
atomic predecessor check that did not exist. The repair reuses existing
full-snapshot recovery instead of introducing a second recovery controller.
Collection metadata is deduplicated once and reused for both the source check
and its SQL writes. Reusing the old key-set flag was tried and rejected by the
cached-row counterexample: those two facts cannot be merged. Dropping duplicate
endpoint handling fails its hostile mutant. Dropping provenance validation fails
the legacy receivers. Stronger source ordering would require opaque-handle and
skipped-receipt semantics; it was not substituted for the accepted law.

`pnpm lint:changed`, Browser `tsc --noEmit`, and `git diff --check` pass.
No oracle budget was lowered or removed. Installation used the lockfile as-is;
there is no dependency override or installation workaround in this diff.


### Final verification and reviewed state

The full primary owner after cleanup refinement reports **314 passed and 2
expected failures**, with no type errors (`multi-tab-close-final.log`). Every
normal fixed/random reach passed. A combined gap mutant plus a forced host
cleanup failure produced an `AggregateError` retaining the original final
source-head mismatch and the secondary cleanup failure; both source files were
restored. `cleanup-calibration.log` records that assertion-level rejection.

All four supplied multi-tab seeds were then replayed directly on restored code:
`-1115798760`, `-1660880085`, `-699129038`, and the new `-1371495859`. Each
passed its exact reported shrink path through the unchanged broad grammar.
These are replay results, not substitutes for the normal generated campaigns.
Final lint and diff checks pass. No commit, push or pull request was created.
The local Electric/PostgreSQL test stack remains available for reproduction.

Final primary-owner normal reaches (fixed / random):

| Declared state | Histories |
| --- | ---: |
| present/empty | 14 / 6 |
| present/disjoint | 11 / 9 |
| absent/empty | 6 / 15 |
| absent/disjoint | 7 / 6 |
| drained before recovery | 42 / 44 |
| missing progress at recovery | 26 / 22 |
| foreign progress at recovery | 21 / 29 |
| must-refetch delivered | 47 / 49 |
| peer commit during an open reserved transaction | 12 / 14 |
| source stopped with an open transaction | 21 / 21 |
| tab recovered | 78 / 79 |
| durable rows behind the server | 64 / 62 |
| peer commit while a tab was not ready | 48 / 53 |
| peer commit after error without retry mid-transaction | 2 / 3 |
| peer commit after SDK gives up mid-transaction | 3 / 1 |
| peer commit after signal aborted mid-transaction | 3 / 5 |
| peer reset abandoned an open transaction | 7 / 15 |
| reset-abandoned commit put the Collection in error | 4 / 13 |

This review covers the uncommitted working tree on parent
`82c5f999b32c9db827dd74e3f172604dfda28013`, branch `codex/investigate-2281`.
The SHA-256 identity of the source/test/coverage manifest is
`54d96ca70d3be37242cf060b7c7de6ae1e0eaf59d46059f4aa3bfa4660f4cb1a`.
Compute it from sorted records `path`, NUL, content SHA-256, newline. This
record excludes itself to avoid a circular identity; later edits need a new
append-only verification entry.

| Reviewed file | Content SHA-256 |
| --- | --- |
| `docs/contributing/glossary.md` | `f8cec460111439ba9ee65b0c1ecf8a60e466b576c4d94d75af222a9ced4ed02d` |
| `docs/contributing/oracle-coverage.md` | `598fa6e4c3874eaafeb48174d3f13afd8626bc56e558d804a422d5bce3c19ba8` |
| `packages/browser-db-sqlite-persistence/e2e/electric-source-prefix-oracle.opfs.spec.ts` | `8fafec444efbcc0a171d8beab0a166b252941e84841e02d90b954ebd80517c81` |
| `packages/browser-db-sqlite-persistence/e2e/electric-source-prefix.opfs.html` | `4734264a6227519aeecdf8b3a7eaeb42f917daa8ce784d12baf8a57cb83d4c00` |
| `packages/browser-db-sqlite-persistence/e2e/electric-source-prefix.opfs.ts` | `a71db0fffc376a9b15c2d4669100876d6656df2c448134a17b890fa32f686c2f` |
| `packages/browser-db-sqlite-persistence/playwright.opfs-electric.config.ts` | `d18ef1f5dbbdec19e7db5b5498f039910d60cf43b7da48b617313c6f2ea8c62a` |
| `packages/browser-db-sqlite-persistence/tests/electric-convergence-oracle.ts` | `c3108fc39f4c8d7de91567011de9c829fb8e16fdb2a03d20231aca0a61ec27db` |
| `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts` | `2868ead1bc73508ecdc685b0590a5a8f487b01db19fc846f6236ec2c0f843cc3` |
| `packages/db-sqlite-persistence-core/src/persisted.ts` | `1a3bc05bbf10646c8d75fb062799c8335a181a8d3a5e91d61a9244c1a4f5027a` |
| `packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts` | `406e4058b85055fc7972c18786f9461856aa46c90932f6346dc6faccd1106a0c` |
| `packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts` | `2ff7303909f08896844b2343f425a26eb87988fc41f1c1137bcf646198c6f779` |
| `packages/db/src/sync-persistence.ts` | `7052e177e444acbe47b57dc5d5bf7f57aae339c7ef6b7308765ea56f81bd4251` |
| `packages/db/src/types.ts` | `152fd447c615a76398e0f8e4f0714957df7879a77cb51f89b4fef40f83bcc367` |
| `packages/db/tests/oracle-config.ts` | `ef56c55cd1e7c759d056ed4d9be85e9cd79d2cdfc9743454170562240c50c908` |
| `packages/db/tests/sync-persistence.test.ts` | `ac531d2397b3a1e39be707c0e9d0656d968fd88cbd863a42f32e6fd0e31d230b` |
| `packages/electric-db-collection/src/electric.ts` | `f8eda904b0c02439196660844d41bafcd754404dabc4d9959caa8659b6c364b8` |
| `packages/electric-db-collection/tests/electric-resume-snapshot-races.test.ts` | `26f430ae9359d989fe221c747fc9f3aeceecd1c9e4137e5cca38e5a8ab257a46` |

## Independent multi-agent review (2026-10-29)

Four fresh reviewers examined the unchanged 17-file snapshot identified above:
SQLite model/API, Browser grammar/checkpoints, real SDK/OPFS receiving path, and
policy/evidence scope. They read the oracle-review skill, rubric, glossary and
applicable ownership records. No shared source or test files were changed.
The following findings supersede the earlier self-review's unconditional
conformance statements for the named requirements. These are oracle gaps;
no additional production defect was established.

### P2: the focused recovery dimension never reaches restart

`multi-tab-electric-oracle.test.ts:1477` generates a recover step with pick 0 or
1 while the lagging tab is still running. The branch at lines 1323–1328 always
selects reload in that state, so both sampled values close the tab and open a
new Collection. The focused source-prefix campaign does not establish a
same-Collection restart after stale prefix application and later advancement.
Two reviewers independently found this by control-flow inspection.

The broader generated/storm owners do exercise restart after stops. The real
receiver exercises an actual close/reopen. Those witnesses do not supply this
missing combination. The earlier pre-edit inventory, coverage entry and
ORC-004 self-review overstate the focused reload/restart dimension. Existing
reach counters cannot detect its collapse because none names the actual
recovery path.

The smallest general repair is to stop the slow source before the restart
branch, retain a running reload branch, and declare reaches from the actual
`how` path for divergent-source restart and reload. The owner remains this
Browser oracle. Until that witness and comparison evidence exist, the focused
restart claim remains open. This finding concerns ORC-004, ORC-005, ORC-012 and
ORC-015, including AGENTS.md's unreachable-claims rule.

### P2: replay runs unrelated campaigns

The Browser random registrations at lines 1514 and 1592 use plain `it`. With
the documented `-t 'random or replayed'` selector, both run even when
`TANSTACK_DB_ORACLE_PROPERTY` selects only one. `oraclePropertyOptions` applies
the shrink path to the matching property; it reseeds the other property's
normal 80-history campaign.

A reviewer executed source-prefix seed 2281, path `0:0:0:0`: the requested
single history passed, then the unrelated broad campaign reported 80 recovered
histories and 49 must-refetch histories. The command reported 2 passed and took
21.74 seconds. This can delay replay or introduce an unrelated failure.

The SQLite source-progress registration at
`sqlite-resume-snapshot-oracle.test.ts:961` has the same isolation defect,
assessed P3 in that file. Selecting `sqlite-resume.startup-generation`, seed
1659, path `0`, while filtering for source-progress tests still ran its normal
campaign (reach counts 55/32/34/64/40). The intended source-progress replay
itself passed. Existing other unguarded core properties are not evidence that
this new registration is correct.

Use `oracleReplayTest(it, property)` or `oracleReplaySkips(property)` to stand
aside during another property's replay. Verify both property directions and
an unrelated selector. This is the missing ORC-007 selection check, separate
from successful execution of each property's own seed/path.

### Other review results and limits

The SQLite reviewer independently reconstructed stale predecessor, sticky gap,
duplicate endpoint and authoritative replacement behavior. Its fixed/random
campaigns passed with typechecking, as did direct duplicate-endpoint replay.
Browser reviewers passed both focused normal campaigns and new checkpoint
regressions. They found no weakened final source-head judgment or unsupported
removal of the known #2209/#2267 exclusions.

The receiver reviewer ran both disjoint/no-drain real cells: each passed and
reached all four declared states. An isolated temporary probe held the reopened
page's first actual HTTP response. The Collection stayed loading and `open()`
stayed pending while stale cached rows remained visible. Releasing the response
reached the shared source-head comparison and passed. The commit counter was
already 1 because setup commits reset metadata; the existing status gate, not
the counter alone, prevented premature comparison. No readiness finding was
established. A suspected `pg.end()` cleanup issue was rejected after inspecting
the installed resolve-only completion implementation and finding no concrete
supported failure path.

The evidence reviewer confirmed the recorded manifest and semantic RED/mutant
results. It found no supported production-first, model-hacking, quiet-exclusion,
pinned-only or missing-mutant shortcut. Historical logs do not hash production
at every execution boundary; they do not contradict the preserved pre-edit
gate. The two verified issues above remain unresolved in this reviewed snapshot.
No production mutants were independently rerun by the reviewers; the receiver
review did not independently repeat the other eight real cells or cleanup fault
injection. The earlier executed evidence retains those distinct claims.


## Review repairs and verification (2026-10-29)

The user authorized both review fixes. The two findings above are resolved in
this state. No production file changed during this pass; all five production
content hashes still match the preceding reviewed manifest. The recorded bundle
measurements and unchanged real SDK/OPFS receiving evidence still apply.

### Law, reach and failed controls

The convergence law and its authority remain unchanged: once a source actually
recovers and catches up, durable/public rows equal the source head. The grammar
now distinguishes two legal recovery paths after the forced prefix divergence.
Recovery 0 stops the lagging source, then restarts the same Collection. Recovery
1 closes the tab and opens a new Collection. The callback receives the driver's
actual `how` after stream startup and quiescence. The new reach states count
that branch only when the baseline was divergent, rather than inferring it
from the generated pick.

Before changing the grammar, those actual-path counters rejected the old
campaign: `divergent source restart: 0`, `divergent source reload: 38`. The fixed
80-history run failed its reach assertion (`review-restart-reach-red.log`).
This is a RED for the oracle's missing reach, not a production row failure.
The conditional stop then made the restart branch reachable. Both fixed/random
80-history campaigns pass at the original source-head comparison.

The earlier pre-edit inventory's restart claim was inaccurate, as the independent
review records. The new restart evidence was obtained after the original
production repair. This entry does not retroactively attribute it to that gate.
This pass changes test machinery only. The original broad grammar and all four
issue replay paths remain unchanged; the focused recovery recipe now includes
the missing stop.

### Replay selection

The Browser source-prefix and broad-history random registrations, and the
SQLite source-progress random registration, now use `oracleReplayTest` with
their property names. Normal campaigns still run. During path replay, these
registrations stand aside unless their property is selected; fixed campaigns
continue to stand aside for every path replay.

Before the guards, selecting the one-history source-prefix replay also ran the
broad 80-history campaign. Selecting startup-generation while filtering for
source-progress still ran the latter's normal campaign. Those successful test
exits were failed selection controls; their extra campaign output is the
violation (`review-replay-before.log`, `review-core-replay-before.log`).

After the guards, an integration probe checked five selectors with coverage and
typechecking disabled:

| Selector | Observed registration behavior |
| --- | --- |
| Browser source-prefix, 2281, `0:0:0:0` | Exactly one requested replay passed; actual restart reach was 1; no broad campaign. |
| Browser broad-history, -1371495859, `75:0:0:0:0:0:0:1:1:0:0` | Exactly one requested replay passed; no source-prefix campaign. |
| An unrelated registered property with both Browser random tests selected | Both registrations skipped; no campaign ran. |
| SQLite startup-generation with source-progress tests selected | Both source-progress registrations skipped. |
| SQLite source-progress duplicate-endpoint replay | Exactly one requested replay passed; fixed campaign skipped. |

The Browser probe used the documented `-t 'random or replayed'` selector in both
directions. The SQLite probe used `-t 'preserves source progress evidence'`.
These checks target the reviewed registrations; they do not claim to repair
pre-existing replay-selection behavior in unrelated SQLite tests.

### Mutants and restored GREEN

A temporary SQL mutant that never retains a source gap failed the new restart
replay at `after every tab caught up`, with a missing source row. The same mutant
failed both existing cursor-only reload replays at that checkpoint. A temporary
startup-provenance bypass failed the missing-token restart replay (seed 2281,
path `2:0:0`) at the same source-head comparison. All were assertion failures
with concrete wrong rows, and the source files were restored in `finally`.
Logs: `review-mutant-gap-restart.log`, `review-mutant-gap-reload.log`, and
`review-mutant-legacy-restart.log`.

After restoration, both Browser important generated properties ran their
normal fixed/random 80-history campaigns, alongside both cursor-only reload
replays. The selected command passed all 9 reported tests with no type errors
(`review-restored-campaigns-green.log`). The full SQLite owner also passed
(61 reported tests, no type errors, `review-core-green.log`). The changed
registration wrapper changes Vitest's type-test discovery count; runtime
campaigns and run budgets were not removed or lowered.

Final focused source-prefix reaches (fixed / random):

| Declared state | Histories |
| --- | ---: |
| present/empty | 14 / 8 |
| present/disjoint | 11 / 17 |
| absent/empty | 6 / 8 |
| absent/disjoint | 7 / 9 |
| drained before recovery | 42 / 38 |
| missing progress at recovery | 26 / 30 |
| foreign progress at recovery | 21 / 27 |
| divergent source restart | 25 / 23 |
| divergent source reload | 13 / 19 |

Both normal broad-history campaigns also met all existing declared reaches.
The full SQLite source-progress reaches were 61/52 discontinuities, 37/35 later
matching commits, 44/31 replacement repairs, 64/66 duplicates and 34/42 legacy
column migrations. `pnpm lint:changed` and `git diff --check` pass.

The original Browser reviewer re-reviewed the delta and independently ran both
replay directions. Each reported one passed replay, with the other campaign
absent; its source-prefix replay measured a real same-Collection restart.
The original SQLite reviewer confirmed its guard repair by inspection. Neither
reviewer found a remaining supported issue in these repairs. They did not
independently repeat this pass's normal campaigns or mutants.

For the applicable rubric changes: ORC-004/005 now have an executable restart
history and its actual-path observation; ORC-007 has isolated selection checks;
ORC-015 has failing reach counters and measured normal counts; ORC-012 is updated
by this entry. Existing laws, independent models, failure handling, shared
receiving judgment and law-only file structure remain unchanged. The earlier
ORC-001–003/006/008–011/013–014/016 evidence still applies.

The scope remains bounded same-version eager sources. The added in-page restart
interaction is a controlled SDK/Node Browser witness; the real Chromium matrix
continues to supply tab close/reopen evidence. No broader real in-page restart,
mixed-version, on-demand, native-device or monotonic-live-write claim is added.
The separate #2209, #2267 and metadata gaps remain open. No commit or push was
made during these fixes.

The updated uncommitted 17-file manifest identity is `f326ed14d9464e8ecc7d62c1da21d53589e2a49f31cfa3dec162949f1325e62b`, on the same
parent `82c5f999b32c9db827dd74e3f172604dfda28013`. It uses the sorted path/NUL/
content-hash/newline algorithm above and excludes this record. Only these
manifest entries differ from the previously reviewed snapshot:

| Changed file | Content SHA-256 |
| --- | --- |
| `docs/contributing/oracle-coverage.md` | `ef76490d320e037e9362261feb245089f1901a54ce209237946af998cf04a531` |
| `packages/browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts` | `eee52b0972a4920c573b4eb304e84ef256ed32b886583695cd35544415b7b746` |
| `packages/db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts` | `16781c8eb12ef6698cf412108d705dccb5e345223dc319a53e0528d5e83d521b` |


## Prep-pr verification on updated main (2026-10-29)

The task branch fast-forwarded to `07bfc0eb2584fd83a3efc14ec1fb452954a829ea`
before fresh review. Upstream changed release metadata and unrelated paths;
none overlapped this task's edits. The same 17-file manifest, excluding this
record, remains `f326ed14d9464e8ecc7d62c1da21d53589e2a49f31cfa3dec162949f1325e62b`.
No production, oracle, history grammar, or comparison changed during this pass.
Earlier RED, mutant, scope and ORC audit entries retain their stated provenance.

Fresh verification against this base:

- Full Browser multi-tab owner: 312 passed and 2 expected failures; no type errors.
- Full SQLite resume-snapshot owner: 61 reported passed; no type errors.
- Electric resume-snapshot races: 49 passed; no type errors.
- Persistence capability validation: 8 passed.
- Real SDK/PostgreSQL/Chromium OPFS: all 14 passed, including all ten prefix cells.
- Browser `tsc --noEmit`, `pnpm lint:changed`, and `git diff --check`: passed.

The owner commands above used `--maxWorkers=2`; the real command used
`--workers=2`. Commands set `pnpm_config_verify_deps_before_run=false` after
pnpm tried to reinstall for upstream release-specifier changes. The installed
external dependencies used here did not change; no override or lockfile edit
was made. Local logs are `notes/issue-2281/prep-{browser,core,electric,bridge,real}-green.log`.

The focused Browser fixed/random reaches, in the earlier table order, were
14/11, 11/10, 6/15, 7/11, 42/33, 26/35, 21/19, 25/24 and 13/23.
SQLite fixed/random reaches were gaps61/53, later matching37/42,
replacement44/36, duplicates64/61 and migration34/39. Every real prefix cell
reached its four declared states once. No budget was lowered.

Fresh simplification and five independent review angles found no confirmed
behavioral defect. Evaluation also held the eager baseline read after initial
resume selection, then committed a discontinuous predecessor through SQLite.
Both a row-changing and a metadata-only commit advanced the row version while
physical key evidence stayed consistent. After release, the existing generation
fence rejected resume, persisted a reset marker and prevented queued publication.
Both focused probes passed; their temporary fixture copies were removed.
This refutes the suggested startup race at that controlled cut; it does not
establish new monotonic live-write or arbitrary-scheduling guarantees.
The existing finite bounds and separate open gaps remain unchanged.

No commit, push or PR has been made at this checkpoint. Optional readability
and documentation suggestions remain for the prep-pr user walkthrough.


### Accepted test-driver simplification (2026-10-29)

The user approved flattening the URL-input conversion in the real receiving
driver. Its native string, URL and Request forms retain the same URL result.
Browser `tsc --noEmit` passes. The real lost-row/disjoint-advancement cell
passes and reaches all four declared premises; no production, model, history
grammar or comparison changed. The 17-file manifest excluding this record is
now `dfdcaa048fc45d73c2b5750856ce91e50f812137e41c724235e7e4889637adad`,
on the same base `07bfc0eb2584fd83a3efc14ec1fb452954a829ea`.
Logs: `prep-s1-tsc.log` and `prep-s1-real.log` in the local evidence directory.

### Restart evidence chronology clarification (2026-10-29)

The restart reach correction in “Review repairs and verification” concerns the
focused `browser.electric-source-prefix` campaign. Its recipe originally
performed tab reload for both recovery choices; actual restart reach was added
after the production repair. That chronology remains unchanged.

The earlier [row-loss trace](#later-traces-rows-and-the-resume-position-describe-different-prefixes)
already exercised same-Collection restart on unchanged production. Seed
`-1660880085`, path `55:0:1:4:4:4:1:1:1:1:3:4:4:4:4`, stopped both sources
after the stale-prefix and metadata-only advancement. The original driver's
final loop restarted both existing Collections. The local `loss-trace.log`
records those restarts at lines 101 and 110, followed by the missing-row
source-head mismatch at line 119. This supplies the earlier restart defect
witness; it does not retroactively supply the focused campaign's missing reach.


### Committed-tree verification (2026-10-29)

Implementation commit `20e2ad9f81c91c60e5d9c219892c6421ae12baca` contains the
reviewed repair and both approved suggestions. Its pre-commit hook removed an
unnecessary test-only non-null assertion and merged duplicate imports in the
SQLite oracle. The merged import then received a formatting correction. These
changes preserve runtime behavior, model rules, histories and comparisons.
The SQLite resume owner passes again (61 reported tests, no type errors), as
does Browser `tsc --noEmit`. Logs: `prep-committed-core-green.log` and
`prep-committed-browser-tsc.log`. All five production files retain their
previously verified content. The 17-file manifest excluding this record is
`e2fda4fe3c0962594f71929acd20c4e8c03b79cdded5e6713594168525a53111`. This identity
includes the accepted driver simplification and the hook's test-only edits.
The earlier full runtime, real-host and mutant evidence retains its scope.

### Published CI and CodeRabbit follow-up (2026-10-29)

PR #2298 first ran at `e9b2dda669a3071e9cd31d7c2d46626e2a7070bc`.
CI found two missing named replay registrations, four warm-reopen fixture
failures, one Electron snapshot-shape assertion, and documentation-check drift.
The recovery owner reproduced all four failures locally before its fixture
changed. Its warm baseline supplied a resume record but omitted the complete
source-position token. Under the new capability contract, that is a legacy
baseline and correctly requests a full snapshot. The fixture now supplies the
matching token for its existing compatible-reopen premise. Its model, request
and row comparisons remain unchanged. Missing/foreign-token recovery remains
generated in the Browser owner and exercised by the real receiving cells.

The replay manifest now names both new properties and their exact replay lanes.
The Electron assertion includes the new `sourceProgressCompatible` field.
The Convex example declares its selected task ID as a string, so an ambient
application variable cannot select the array-update overload. The obsolete
passing Preact snippet was removed from the known-failure baseline. No new
failure was added to that baseline. These changes alter no production code.

Verification commands use `pnpm_config_verify_deps_before_run=false`:

- Electric recovery owner: 60 reported tests passed, no type errors. The
  preceding run reported four failures and 56 passes.
- Electron IPC suite: 116 reported tests passed, no type errors.
- Replay harness: 41 tests passed. Guarded direct replays of
  `sqlite-resume.source-progress` and `browser.electric-source-prefix`, seed
  `2281`, path `0`, each recorded one completed execution of the exact property.
- Documentation checker: 806 examples; zero new failures, 250 known failures,
  and 59 known non-parsing examples. The earlier run had one new failure and
  one stale baseline entry.
- Browser `tsc --noEmit` and the focused formatting check pass.
- `pnpm lint:changed` and `git diff --check` pass; no run budget was lowered.
- The real SDK/PostgreSQL/Chromium source-prefix receiver passes all ten cells;
  every cell reaches each of its four declared states once.

CodeRabbit review `5701493057`, inline `4415193533`, and mutable summary
`6502484352` cover the original published head. Their complete raw text and a
seven-item lossless ledger were preserved locally before edits. The startup
polls now explicitly allow 30 seconds. The shared checker now locates its
companion grammar and drivers and explains its independent source-head model.
Its judgment, name, registration, and comparison remain unchanged.

Two historical phrases receive clarifications here to preserve this record's
append-only chronology: “new generated campaigns” means newly added
generated-history properties; “Browser important generated properties” means
both important generated properties in the Browser package. “Standalone type
examples” retains its existing meaning and spelling.

The loss audit accounts for seven items: four fixed, one spelling requirement
refuted, one accepted documentation-policy choice, and one duplicate. The
summary's aggregate docstring warning names no missing function obligation or
repository authority for its 80% threshold. ORC-003's proportional prose and
directly named companion modules remain the governing documentation contract.
No behavioral finding, unresolved law decision, or new in-scope counterexample
was identified. CodeRabbit is useful as a supplemental maintenance reviewer;
this review supplies no independent behavioral proof. Earlier evidence and
limits remain unchanged because no production or model semantics changed.

### Independent cluster report reconciliation (2026-10-29)

The SQLite/Electric peer pilot investigated frozen baseline `07bfc0eb2`.
Its report, laws, retained oracle patch, raw reset/convergence logs, and claim
ledger were compared with this repair. Its two row/cursor counterexamples
confirm the mechanism already repaired here: an old row commit followed by
another source's newer resume metadata can make restart skip a needed change.
Both exact row traces and both reset traces pass again on `297e214fe`, with
no type errors. The pilot's baseline failures do not describe that newer tree.

The report contributes one oracle improvement. The broad generated owner now
declares recovery first discovered during final catch-up separately from a
reset failure earlier in the history. An earlier failure can no longer satisfy
the reach requirement for that final branch. The model, history grammar,
comparisons, production code, and run budgets remain unchanged.

- **Law:** Law 5 requires a reset-abandoned commit to fail; Law 2 compares the
  independent source head after successful recovery and complete delivery.
  Their authority remains the coverage map and maintainer decisions on #2265.
- **Reach:** `reset-abandoned source recovered during final catch-up` reached
  2 of 80 histories at fixed seed `952051961`, and 6 of 80 random histories.
  Both campaigns require at least one. Existing reach requirements also pass.
- **RED / mutant:** Removing only the final restart/delivery block makes both
  named reset histories fail at `after every tab caught up`, with wrong rows.
  These are assertion failures, not setup failures or timeouts. This calibrates
  the driver repair; it is not a new production mutant. Earlier production
  RED and hostile source-progress evidence retain their scope.
- **GREEN:** Both normal 80-history campaigns and both positive reset replays
  pass (7 reported tests, no type errors). A measurement-only run repeats the
  same campaigns (2 runtime tests) and records the counts above. Its temporary
  direct stderr recorder was restored afterward because ordinary console
  output was suppressed. Logs: `pilot-current-*.log`,
  `pilot-final-recovery-ablation.log`, `pilot-final-recovery-green.log`, and
  `pilot-final-recovery-measured.log` in the local evidence directory.
- **Limits:** These remain bounded source-head observations. They do not
  establish individual receipt fulfillment, clean teardown, generic source
  ordering, or the other cluster issues' receiving paths.

The report also sharpens two qualifications. The published Electric
resume-safety contract requires rejecting a partial update for an unknown row.
The separate #2267 no-error composition expectation needs an authority decision;
this repair preserves the guard and does not resolve that expectation.
The Node campaign's closed-database leadership warning is distinct from
deliberately injected source failures. It also appears in earlier local logs.
Its user-facing effect remains unverified, and the coverage map now records
the teardown owner and needed held-election witness under pilot `PILOT/S02`.
Passing convergence comparisons do not establish clean teardown.

Follower reacquisition (#2139), seed metadata, real sync-metadata receiving
(#2272), broader leader-close premises (#2085), loaded-subset relay (#2174), and
real unknown-partial-message premises (#2138) remain separate boundaries.
The report supplies no reason to merge them into this source-progress repair.
The complete raw report and 16-item reconciliation ledger remain local.
