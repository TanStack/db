# P6 metadata correction on current main

Baseline: `a3c4d0676621cc7df4d242bdfe31815509add734` (`origin/main`,
November 2, 2026). Branch: `codex/p6-metadata-closeout`. This candidate transfers
the test/model/fixture patch whose SHA-256 is
`3b82a8471cae91982e0085dade060804354904ffa839405856eef7c50ca243a9`, then
corrects one stale comment and extracts the approved shared campaign runner.
It changes no production source or release note.
The earlier [kept-metadata record](2026-10-30-kept-metadata-durability.md) retains
its historical baseline and executions; the results below are new executions.

## Accepted law and corrected diagnosis

Keeping metadata in this tab is not writing metadata durably. Decisions 9 and
18 of the [sync metadata review](2026-10-22-sync-metadata-session.md) prohibit
promoting a hydration seed's metadata through an implicit keep. Explicit
metadata writes must still persist. Decision 14 fixes insert kind, not metadata
durability. Decision 11 governs named current-run writes; decision 15 permits
an unknown-author storage observation to adopt differing durable metadata.

Thus this tab may read seed metadata M1 while storage retains cached metadata
M0. An update or equal re-insert without explicit metadata does not make M1
durable. A later unknown-author reload may expose M0. The original #2303
production diagnosis conflated those observations and is withdrawn.

The current model separately retains durable metadata and tab-local reads. The
native driver records actual successful recovery responses without replay
details; the model applies D15 using its own storage. This repairs a missing
model input, not a demonstrated production recovery defect. Direct durable
metadata comparison, constructive reach and calibrated SQL admission repair
the other instrument gaps. The approved shared completed-history reach helper
remains. The maintainer approved the separate campaign-runner extraction on
November 2; both hosts now call the same 40-run campaign mechanics.

## Published PR and issue dispositions

PR [#2303](https://github.com/TanStack/db/pull/2303) was refreshed at head
`ea769ec8d3b4c1bffc286e1d88b1b0c553c5cc5f`, still open. Its published title,
body, serializer materialization and release note describe the withdrawn
production fix. No new review or inline comment was present. The current
replacement candidate contains only tests, model, fixtures and documentation.

Recommended title: **test(persistence): separate local metadata keeps from durable writes**.
Update the existing PR with ordinary follow-up history: merge current main,
replace its net diff with this validated candidate, remove the obsolete
materialization and release note, and rewrite the body around D9/D18 and the
bounded receiving evidence. Preserve main's source-progress changes. No force
push or new package release is needed. This session has not updated the PR.

- **#2281:** open. Withdraw the old metadata product-repair claim; the row-loss
  and resurrection reports remain separate.
- **#2272:** open. This supplies one bounded native receiving path, not its
  broader host, transport or lifecycle closure.
- **#2317 / P8:** open. Its source-facing metadata loss after a controlled
  notice is a distinct witness. Neither the withdrawn diagnosis nor this
  durability comparison resolves it.

## Lossless review accounting

The original six claims and proposed cures, historical assessments, sibling
corrections and seven claim-accounting amendments remain in the append-only
task ledger. The original source was re-read before this evaluation.

| ID | Claim and current disposition | Preserved value |
| --- | --- | --- |
| META-EXT-2303-001 | PR materialization amplifies metadata writes and copies a map: repaired by omitting the materialization. Selective seed materialization is also unauthorized. | Direct durable comparison and 2/100/10,000-row emitted-mutation controls. |
| META-EXT-2303-002 | Updates need the same materialization: refuted under D18/D15. | Update histories and actual unknown-recovery input remain useful. |
| META-EXT-2303-003 | Materialization conflicts with D18: repaired by preserving main's serializer. | Keep tab-local and durable metadata separate; no restart proof inferred. |
| META-EXT-2303-004 | Completed bare-seed premise was scarce: repaired constructively. | Every batch crosses write form, seed metadata and explicit/implicit writes on both hosts. |
| META-EXT-2303-005 | Root SQL calls can enter another transaction; quiet-time polling is insufficient: fixture repaired. | Root/scoped admission, actual notices/ensure replies and apply-lock barriers. |
| META-EXT-2303-006 | Duplicated campaign runner: repaired after maintainer approval. | Shared mechanics preserve host setup, recovery, registration, replay selection, budgets and comparisons. |

Raw total: **6 = 5 repaired + 1 refuted**.
The suspected production recovery sibling remains refuted; the missing-model-input
sibling remains repaired. Prior prep prose/release-note corrections and the
seven original-claim corrections retain their identities and qualifications.

Two fresh independent prep agents found the same stale phrase, “find this
defect,” in the controlled receiver. P6-SIMP-DOC-001 is fixed by changing it to
“generate this interaction”; P6-CR-001 is a duplicate with its source identity
retained. Neither reviewer found another supported behavioral defect. The
original reviewer merits a hire recommendation for finding the D18 and fixture
problems, with contract verification required before applying proposed cures.

## Current evidence

The unmodified production on this main baseline is GREEN. No product RED on
this baseline is claimed: this is correction of the PR and its instruments.
The historical pre-removal RED remains in the October 30 record. Fresh hostile
controls below reject the same PR materialization on the selected main source.

| Check | Current result |
| --- | --- |
| Complete controlled persisted receiver file after extraction | 74 passed, 279.07 seconds |
| Native receiver, SQL fixture and emitted-work files after extraction | 12 passed, 4.90 seconds |
| Core session property/boundary files and row-metadata composition owner before the mechanics-only extraction | 92 passed, 69.26 seconds |
| Scoped TypeScript | Passed |
| Prettier and `pnpm lint:changed` | Passed |
| General ESLint on nine changed TypeScript files | 0 errors, 12 warnings (shadowed test variables and async fixture stubs) |
| Shared campaign direct replay on each host | One requested history ran and passed on each host, seed `527962096`, path `0`; the fixed campaign stood aside |
| Restored direct durability replay on each host | One property ran and passed on each host, seed `2220031`, path `0:0:0` |

Both normal native durability campaigns reached all 36 successful case/lane
states eight times each. Actual prior-cache recovery without replay details
was reached 96 times per campaign. Fixed seed was `2220031`; the native random
seed was `705218229`. The preserved 40-run native seed/re-insert/reload fixed
campaign (`527962096`) reached inner commits 40, named notices 21, full reloads
19 and both completed kept-seed states twice, per lane. Random seed
`-1759635559` reached inner commits 40, named notices 18, full reloads 22,
completed kept bare seeds twice and non-bare seeds six times, per lane.
Random completed-branch counts remain measured, not promised by that campaign.
The constructive durability matrix supplies that premise independently.

Both controlled durability campaigns also reached all 36 successful case/lane
states eight times each: fixed seed `2220031`, random seed `1349769898`.
The preserved controlled 40-run campaigns passed at fixed seed `527962096`
and random seed `-1150914171`. Fixed reach matched the native fixed campaign.
The random campaign reached inner commits 40, named notices 20, full reloads
20 and each completed kept-seed branch three times, per lane. The complete
post-extraction file executed and passed all 74 tests.

`sync-metadata-session-campaign.ts` shares the existing history loop, reach
counters, fast-check configuration and failure reporting. It introduces no
model rule or expected answer. Each host keeps its production driver and
replay filter; the newer constructive durability campaigns remain local.
Direct replay of the extracted runner selected one history on each host;
normal fixed and random runs retained their original 40-history budgets.

The emitted-work controls observed zero implicit metadata mutations at 2, 100
and 10,000 unchanged rows. These are mutation counts, not elapsed-SQLite-time
claims. The grammar sampling control again measured zero old completed bare
premises at seed `-704889444` and two at `527962096`, versus 24 constructive
bare/implicit histories across each eight-batch sample.

All five calibration executions were repeated after extraction and failed at
the intended comparison:

| Wrong account | Observed rejection |
| --- | --- |
| Original PR materialization, controlled host | Settled durable metadata expected cached M0, got local seed M1 or absence. |
| Original PR materialization, native host | Same durable mismatch; native on-demand also exposes the differing source read after actual recovery. |
| Omit the measured recovery input from the model | Source metadata mismatch at `commit`: expected seed metadata, got cached metadata; actual response crossing version 0 to 2 remains in the trace. This is a model calibration, not a production mutant. |
| Drop explicit durable metadata writes | Explicit-write case expected `{s:3}` but durable storage retained `{cached:true}`. |
| Restore unscoped root SQL calls | Rollback/isolation assertion expected `[]` but read uncommitted row 1. This is fixture calibration. |

The three metadata controls replayed the same property with seed `2220031`,
path `0:0:0`; the materialization control ran on both hosts. None failed by
setup error, timeout or zero-test selection. Temporary production/model/fixture
edits were restored byte-for-byte, then both direct replays passed. Production
still equals main. No original budget, guard or comparison was removed.

Commands from `packages/db-sqlite-persistence-core` (all Vitest invocations also
used `--maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false`):

```sh
pnpm exec vitest run --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false tests/sync-metadata-session-persisted.test.ts
pnpm exec vitest run --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false --silent=false --disableConsoleIntercept tests/sync-metadata-session-sqlite.test.ts tests/sync-metadata-sqlite-driver.test.ts tests/sync-metadata-write-work.test.ts
```

The core command from `packages/db` used the same flags and
`tests/sync-metadata-session-oracle.property.test.ts`,
`tests/sync-metadata-session.test.ts`, and
`tests/collection-row-metadata-composition-oracle.test.ts`.
For each metadata calibration and restored replay, set
`TANSTACK_DB_ORACLE_PROPERTY=sync-metadata-session.persisted-kept-metadata-durability`
or `sync-metadata-session.sqlite-kept-metadata-durability`,
`TANSTACK_DB_ORACLE_SEED=2220031`, `TANSTACK_DB_ORACLE_PATH=0:0:0`, and select
`-t 'tab-local and durable metadata distinct'` in the matching host file.
For direct replay of the shared runner, use property
`sync-metadata-session.persisted-seed-reinsert-reload` or
`sync-metadata-session.sqlite-seed-reinsert-reload`, seed `527962096`, path `0`,
and select `-t 'inserted metadata across peer reloads'` or
`-t 'histories through SQLite'` in the matching host file. Each replay ran one
history; it establishes replay selection, not full campaign reach.

Scoped types used `pnpm exec tsc --project /private/tmp/tanstack-db-p6-2026-11-02/scoped-types.json`: the package's config,
limited to the changed model/receiver/support files, with source aliases for
DB, DB IVM, Store and the broadcast-coordinator entry. Logs, exact calibration
commands/source edits, restored hashes, raw PR/issue snapshots, reviews and the
append-only finding ledger are retained in
`/private/tmp/tanstack-db-p6-2026-11-02/`. Those scratch artifacts are not PR files.
Post-extraction runs use the `runner-` log prefix; repeated calibration logs,
exact mutation commands and restored hashes are in its `runner-calibration/`
directory. The earlier runs and ledger entries remain intact.

The historical ORC-001 through ORC-016 assessment still describes the unchanged
semantic model/grammar/comparison and receiver behavior. This new baseline was
independently reviewed; current runtime, reach and calibration results above
replace no historical execution. The accepted extraction moves the same
campaign loop into a support module and retains both host-specific production
drivers. Exact SHA-256 identities at this cut:

- `packages/db-sqlite-persistence-core/src/persisted.ts`: `1a3bc05bbf10646c8d75fb062799c8335a181a8d3a5e91d61a9244c1a4f5027a`.
- `packages/db/tests/sync-metadata-session-oracle.ts`: `584d767b43aa7a9f4661c65fa431ac579d0037e5e1fa8415e693817b0dae635c`.
- `packages/db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts`: `e63459f1dfa5721ab3aa154771f3c0d2ba3c1f3f3ddf2305a5290f5b0527d071`.
- `packages/db-sqlite-persistence-core/tests/sync-metadata-session-sqlite.test.ts`: `66cd18bc436d3358cd3f4f4aee577d0dd24154a581df7948b52b2a1bb2987a16`.
- `packages/db-sqlite-persistence-core/tests/sync-metadata-session-campaign.ts`: `6c96e1f4b498a8b14fcd9835d6926c1daee4e4c33e3fa5e007f84a2d4b71cc46`.
- `packages/db-sqlite-persistence-core/tests/sync-metadata-sqlite-driver.ts`: `99ec1af0f43f4885558c61296c66f2a42226fae7be58b32efaa970c831cde059`.

## Limits and readiness

The shared judgment checks source metadata after authored actions, and rows,
receipts, durable rows and durable metadata after settlement. The constructive
matrix covers update, flat equal re-insert and inner equal re-insert; bare and
metadata-bearing seeds; implicit and explicit metadata; partial/full/on-demand
lanes. Notice choices are sampled rather than a Cartesian guarantee.

Native evidence uses one process, two Collections and Browser coordinators,
Node BroadcastChannel/Web Locks and one SQLite connection with serialized root
admission. Each correlated commit/notice/recovery finishes before the next
authored action. Arbitrary response/application interleavings, recovery during
cleanup/expiry/cancellation, leadership or transport loss, Chromium OPFS,
Electron IPC, restart semantics and necessity of gap detection remain outside
this evidence. Existing controlled store/read-hold lanes remain intact.

The published PR is **not ready** while it contains the withdrawn production
change. All optional prep suggestions are now addressed. Replacement-head
readiness remains unproven until the commit/documentation gate, publication
and final-head CI are resolved. No issue closure or merge is authorized by
this record.

During validation the shared `origin/main` reference advanced to
`30e85464ed2b9b12c5f10981a062427a1fc8daaa` (#2316). The tested baseline remains
`a3c4d0676621cc7df4d242bdfe31815509add734`. That new commit changes the coverage
map and replay configuration as well as other subsystems; integrate it before
publishing the replacement. The persistence production source and shared
metadata model are unchanged between those main commits. The results above
do not claim validation of the future integrated head.
