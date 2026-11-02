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
push or new package release is needed. This snapshot predates the approved
publication preparation recorded below.

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

## Approved publication preparation

The maintainer approved the commit and PR-documentation gate on November 2.
Commit `a04d85519` contains the reviewed candidate. Merge `ea43b47c4` integrates
main at `30e85464ed2b9b12c5f10981a062427a1fc8daaa`. Merge
`41f8d99e975aa56ee18d6bca46b7193c602ca287` preserves the published #2303 ancestry
while keeping the corrected candidate tree. It supersedes the withdrawn
materialization and release note. No published history is rewritten.

The following results test the production/test tree at
`41f8d99e975aa56ee18d6bca46b7193c602ca287`, before this documentation update:

| Integrated check | Result |
| --- | --- |
| Complete controlled persisted receiver | 74 passed, 284.31 seconds |
| Native receiver, SQL fixture and emitted-work files | 12 passed, 4.53 seconds |
| Core session, boundary, row-metadata composition and replay-registry files | 162 passed, 178.37 seconds |
| Scoped TypeScript and changed-oracle lint | Passed |
| General ESLint | Zero errors, 12 warnings |
| Shared campaign direct replay | One requested history passed per host, seed `527962096`, path `0` |

The core command adds `tests/oracle-replay.test.ts` to the three core files
listed above. This exercises the merged registry and replay configuration.
The paired constructive campaigns again reached every one of the 36
case/lane states eight times. Native prior-cache recovery reached 96 histories
in each campaign. Fixed seed remains `2220031`; random seeds are `-985340019`
for the controlled receiver and `622373113` for native SQLite.

Both 40-run fixed campaigns retain seed `527962096` and the same per-lane
reach: 40 inner commits, 21 named notices, 19 full reloads and two completed
bare and non-bare kept-seed states each. Controlled random seed `570739933`
reached 40 inner commits, 19 named notices, 21 reloads, one completed bare
state and five non-bare states per lane. Native random seed `-237872140`
reached 40 inner commits, 21 named notices, 19 reloads, zero completed bare
states and two non-bare states per lane. That scarce random branch remains
measured; the fixed guards and constructive matrix supply guaranteed reach.

The dependency refresh used the frozen main lockfile and the public npm
registry after the sandbox blocked registry downloads. It required no version
override or local manifest/lockfile change. Against the integrated main,
production source, manifests, the lockfile and release notes have zero delta.
No package release or changeset is appropriate for this test-only result.

Integrated logs use the `integrated-` prefix in the same scratch directory.
`integrated-code-freeze.json` records the tested head and changed-file hashes;
`integrated-reach.json` retains every measured state count. The native
receiving limits and separate #2317/P8 witness remain unchanged.

All five calibration controls were repeated on the integrated tree. They
failed at the same intended assertions listed above, with no setup failure or
timeout. Both restored durability replays passed at seed `2220031`, path
`0:0:0`. The model, production serializer and SQL fixture were restored
byte-for-byte. The `integrated-calibration/` directory retains exact commands,
mutated/restored hashes and assertion classifications. All 248 integrated
tests, replay checks and controls preserve the earlier bounded conclusion.
Final published-head CI and review remain a separate publication check.

## CodeRabbit documentation follow-up

Review `5741628374` and mutable summary `6507648970` cover published head
`9eef6525d663a3ca586f1e0c5e8af4bab1c29dbb`. The review contains one minor
wording suggestion and no inline comments. The summary also reports 57.14%
docstring coverage against its 80% threshold, without naming deficient functions.

| ID | Evaluation and repair | Evidence and retained value |
| --- | --- | --- |
| META-CR-5741628374-001 | Clarified the successful `pullSince(0)` response sentence. The proposed sentence preserves the measured input; calling `real` an adverb was unnecessary. | Direct comparison of the historical sentence and replacement; no evidence or contract change. |
| META-CR-6507648970-002 | Added missing function documentation to both receiving-driver constructors and `describeMismatch`. | The comments explain receiving inputs, observation cuts and failure diagnostics. The external coverage percentage needs CodeRabbit's next calculation. |

These are documentation findings. They require source and formatting checks,
not a new product RED or changed oracle histories. TypeScript emission with
comments removed is identical to the reviewed head for all three edited test
modules. The 248-test integrated result and five calibration controls therefore
still describe the executable tree. Budgets, guards and comparisons are unchanged.

The raw review, mutable summary and append-only ledger remain in task scratch.
The loss audit accounts for both documentation items; neither reveals a new
behavioral defect. CodeRabbit supplied useful minor cleanup, but this review
does not demonstrate deep behavioral analysis. Hire for assisted documentation
review; do not use this sample as evidence of independent oracle-audit ability.
Final-head CI and the external docstring calculation remain publication checks.

## Ten-item revision review: enforcement repairs

The external review targets `9eef6525d663a3ca586f1e0c5e8af4bab1c29dbb`.
Evaluation started at `d0c4d0dde04208f9aaa66a03dcb7bada9c4f7cdb`; its intervening
changes were documentation only. The raw ten claims, grouped experiment plan,
commands, traces and append-only dispositions remain in task scratch under
`revision-review-10-*`, `revision-*-green.log` and `revision-calibration/`.
This section supplements the historical results above. It changes no product
law or production source, and needs no release changeset.

### Law, experiment and inference

No new product decision is required. Dated decisions 9, 14, 15 and 18 remain
the authority. A seed's metadata can remain local while cached metadata stays
durable. D18 explicitly limits seed retention to reloads after named notices;
its final paragraph applies D15 to differing metadata under unknown writes.
An old model expectation or open coverage note cannot supersede that decision.

| Accepted law and affected items | Decisive experiment | Inference and enforcement |
| --- | --- | --- |
| An implicit keep does not write metadata; an explicit write does (D9/D18; 1, 4, 6). | The supplied nested bare-seed trace passed on both hosts in all three lanes, restoring cached M0 under D15 as independently predicted. A materialization mutant made an incorrect first durable write, then an explicit write repaired it; the old settlement-only runner passed. Seed 46 also produced eight old batches without a reload; reload-only corruption survived all 96 histories. | The authority accusation is false, but action-level durable comparison and guaranteed reload reach were missing. Both receiving paths now compare completed durable metadata before a later action can hide it. The controlled path also compares a transaction trace across held releases. Every constructive batch includes all three notice variants. |
| Only completed storage observations advance the model, at their actual order (D15; 2, 3). | The old runner consumed inputs after its first authored action. The six actual factories recorded zero setup inputs, so no existing setup metadata failure was demonstrated. A separate runner-order witness supplies a setup input. | The recorder now withholds qualifying raw responses until hydration completes a storage read and application. Undrained responses fail a guard. Setup observations are consumed before authored actions; expected metadata still comes only from independent model storage. |
| Constructive histories execute their declared actions; fixture transactions preserve scope (5, 7, 8). | All 3,000 sampled sibling lane histories had no skipped actions. The caught-inner-failure SQL probe committed row 2 incorrectly; a root query remained queued behind its own callback. Empty housekeeping commits preserved source metadata, consumer rows, receipts and durable metadata while two authored transactions remained open. | The reach count mismatch requires illegal actions the constructive grammar excludes; a new guard makes that premise explicit. SQL nested scopes now use savepoints and async-context root reentry, while unrelated callers retain serialized admission. Empty quiescence commits remain a stuttering abstraction; maxDepth bounds authored histories, not the runtime API. |

The primary law, model and comparison remain in
`packages/db/tests/sync-metadata-session-oracle.ts`. The controlled persisted
and native SQLite/coordinator hosts receive the same generated histories and
judgment. Store/read holds postpone the durable comparison until release. The controlled
adapter preserves each completed metadata snapshot for comparison then;
core holds postpone visibility but do not postpone durability. This preserves
commit order, explicit writes, source reads and consumer settlement as separate
guarantees. The new checkpoint enforces the existing no-write law, rather than
creating an obligation for every internal SQLite statement.

### Lossless item dispositions

IDs below abbreviate the scratch prefix `META-REV2-`. These are instrument and
maintenance findings; none establishes a new production defect.

| ID | Technical verdict and severity | PR action and preserved value |
| --- | --- | --- |
| 001 | Refuted. D18, dated October 27, explicitly selects the reviewed unknown-write outcome; six same-trace host/lane runs agree. | Retain the shared replay and distinguish named versus unknown notices. No model-law or production change. The broader #2281 reports remain open. |
| 002 | Confirmed recorder gap, P2. A qualifying transport response alone did not prove that storage was observed or applied. Reading response.requiresFullReload is reading transport data, so the old comment was imprecise. | Correlate response delivery with successful hydration/storage observation before exposing a model input; guard unapplied responses. Retain the serialized recovery scope and its lifecycle exclusions. |
| 003 | Confirmed latent ordering gap, P2. The old order probe was action/recovery/recovery; actual factories had no setup inputs in the measured runs. | Consume inputs before the authored loop and keep an ordinary runner-order calibration. Do not report an unobserved current metadata failure. |
| 004 | Confirmed generator/reach gap, P2. Seed 46 omitted reload in eight old batches, and reload-only wrong observations survived. | Construct all no-notice/named/full-reload variants and declare 108 case/lane/notice states per host. Preserve the eight-run budgets and neighboring explicit-write cases. |
| 005 | Refuted for this constructive grammar. Every action is legal by construction; sampled model checkpoints execute all 3,000 lane histories without skips. | Add a fail-fast successful-history length check, preserving the legality premise and existing completed-branch guards. The reviewer’s suggested executed-step accounting remains relevant to grammars that can skip. |
| 006 | Confirmed observation gap, P2. A wrong first durable write followed by an explicit repair passed the old settlement comparison. | Compare durable metadata after every action with completed storage I/O and at settlement. Both receiving hosts use the same check. The controlled adapter records every completed durable transaction, so a hold release cannot collapse a wrong write and its later repair. A four-regime generated campaign covers both seed forms and immediate/store-held commits. Coverage-map observations now name these cuts. |
| 007 | Confirmed fixture defect, P2. Caught inner rollback left row 2 committed; awaited root reentry would cycle behind its own callback. | Add nested savepoints and scoped async root reentry. Retain cross-adapter isolation. Reusing preparedDriver alone would lose the root admission that this two-adapter fixture needs. |
| 008 | Refuted as a fidelity defect. Empty commits are real runtime operations but introduce no model writes or recorded receipts; the same-path two-open-transaction probe preserved all compared observations. | Keep quiescence and document its stuttering abstraction. Runtime depth three is legal; the grammar's authored depth two is a finite test bound. |
| 009 | Confirmed duplication, P3. The hosts repeated durability campaign mechanics and state construction. | Extract runKeptMetadataDurabilityCampaign. Hosts retain setup, replay selection and native recovery reach. Source comparison and both receiver suites validate this maintenance repair. |
| 010 | Confirmed weak calibration, P3. The count guarded label cardinality, not whether actions implemented those labels. Its sampling cost was not a product-performance finding. | Replace diagnostic sampling with checks of all 36 unique cells, seed metadata, actual notices, explicit-write actions, reinsert form, nesting and legality in all lanes. Preserve emitted-work controls. |

### Reviewer assessment

The review supplied seven useful issues or narrower weaknesses out of ten,
including the important transient-durability and reload omissions. It separated
several test-integrity concerns from cleanup and proposed useful general fixes.
However, the highest-ranked authority accusation missed D18's explicit scoped
decision. The reach and quiescence objections also omitted premises that source
inspection and executable probes resolved. No submitted test or mutant supported
the downstream consequences, and preparedDriver was an incomplete fixture cure.

Hire for assisted adversarial test review, with required authority verification
and executable follow-through. This sample does not support an unsupervised
final correctness verdict. Its strongest value is identifying distinguishing
experiments, not proving all ten conclusions.

### Repaired observations and hostile controls

A second cut audit extended item 006 beyond action-level storage reads. A
store hold can drain several commits during one release. The controlled
adapter now captures raw durable metadata after every completed transaction
and peer write. The model records its own durable states after authored
transitions. The comparison removes only consecutive identical snapshots,
which permits empty transactions while preserving every change and its order.
Expected metadata never comes from a production transaction's classifications.
The native schedule awaits each durable commit separately, so its action cuts
already distinguish those writes.

`queuedMetadataRepairHistoriesArbitrary` constructs all four bare/non-bare ×
immediate/store-held histories in each batch, varying seed shape and reinsert
count. Each makes an implicit keep, then an explicit write. Its controlled
fixed and random campaigns retain eight-run parity, declare every regime and
use the same session model/driver/comparison. Direct replay is registered as
`sync-metadata-session.persisted-queued-metadata-repair`.

| Deliberately wrong execution | Rejection or distinguishing result |
| --- | --- |
| Materialization followed by a later explicit write, both hosts | The new comparison rejects the first wrong durable commit at step 5. The earlier runner passed the same corrupted history. |
| Wrong source observation only after full reload | The expanded grammar reaches reload and the source-metadata assertion rejects `wrong after reload`. The old seed-46 campaign omitted that cut and accepted the corruption. |
| Keep notice labels but remove peer actions | The grammar calibration rejects the missing actual notice. |
| Consume setup input after the first action | The runner-order assertion rejects action before recovery. |
| Remove nested savepoints | The fixture assertions reject row 2 surviving caught inner rollback, for scoped and root reentry. |
| Remove unrelated-root admission | The isolation assertion reads uncommitted row 1 instead of `[]`. |
| Discard a successful qualifying pull response before hydration | The actual native path fails `recovery response was not applied before comparison`. It never supplies that unapplied input to the model. |
| Ignore completed recovery input | The source-metadata comparison rejects cached M0 where the mutant model still expects the seed. The trace records version 0 to 2. |
| Drop explicit durable metadata writes | The durable comparison rejects the missing explicit value. |
| Materialization with a later repair inside one store hold, trace disabled | GREEN hostile execution: action-level comparison alone misses both bare and metadata-bearing cases. |
| The same held materialization, trace enabled | RED at release: the trace contains the wrong intermediate value before the explicit write. Restored production passes. |
| Replay obsolete durability path `0:0:0` after grammar expansion | Both hosts now reject zero-history execution. The valid path `0` executes the requested batch and passes after restoration. |

The initial obsolete-path control ran zero histories and returned GREEN. That
is an unreached path, not a surviving recovery mutant. Sibling
`META-REV2-S001` adds zero-run guards to both shared runners. The following
valid-path control reaches the native recovery guard. An intermediate log
validator also searched for `source metadata` instead of the actual law text,
`source reads its row metadata`; inspection found the intended assertion, and
the repeated control validated that exact law. Neither diagnostic mistake
counts as evidence of oracle sensitivity.

Temporary production, model, driver and fixture edits were restored
byte-for-byte after each control. Logs and restoration hashes remain in
`revision-calibration-v2/`, `revision-calibration-v3/` and
`revision-held-calibration/`. No timeout, setup failure or zero-test run is
credited as a successful value comparison. The temporary probe is absent from
the final diff.

### Current validation and rubric audit

The final executable tree passes **253 tests**: 76 controlled receiver, 163
core/session/composition/registry, and 14 native receiver/SQL/work tests. Scoped
TypeScript, Prettier, changed-oracle lint and diff checks pass. General ESLint
reports zero errors and 12 warnings, from shadowed test variables and async
fixture stubs. The full workspace test command was not run locally.

The complete runs use the same commands listed earlier, with
`tests/oracle-replay.test.ts` included in the core command. Logs use the
`revision-complete-` prefix. Direct controls and replays use the same Vitest
flags and matching property/seed/path selectors. The ten changed TypeScript
file hashes in `revision-final-code-freeze.json` match the executed tree. Their
sorted path/hash JSON has SHA-256
`ba6782bae1011f2f7d565157cafa1fe5e0050d63c3c9b761cec5c9e87e8069d6`.
This record accompanies those repairs on parent `d0c4d0dde`.

The fetched main head is `d9d0a8e50bf8494fe401e2925438b766594c5e26`.
Its only change since integrated `30e85464e` is a disjoint review-document
appendix. Production, manifests, lockfile and changesets still have zero delta
against fetched main. No overlapping implementation integration is outstanding.

Normal constructive campaigns declare all 108 case/lane/notice states per
host and reach each state eight times. Native prior-cache recovery reaches
288 histories per campaign. The additional controlled queued-repair campaigns
reach all four declared regimes eight times. The older 40-run campaigns keep
their budgets, fixed completed-branch guards, replay selection and comparisons.
Random completed-branch counts remain measured. No run budget decreases.

Durability replay now uses seed `2220031`, path `0`, because the expanded
grammar has a different shrink tree. Sibling replay retains seed `527962096`,
path `0`. Queued-repair replay uses seed `2220031`, path `0`. Each requested
property executes directly and the fixed campaign stands aside. Obsolete
zero-history paths fail explicitly.

| Rubric requirement | Current outcome |
| --- | --- |
| ORC-001 | D9/D14/D15/D18 supply authority. Named/unknown authorship, direct durability and finite receiving limits remain explicit. |
| ORC-002 | Expected storage and its trace come from model actions. Transport inputs carry versions, never expected metadata. No production semantic helper computes expected values. |
| ORC-003 | Opening law/limits, grammar prose, model store rule, recorder and comparison describe their separate responsibilities beside executable code. |
| ORC-004 | The grammar rebuilds the supplied prefix, omitting notice actions fails calibration, both seed forms and immediate/held repairs occur constructively, and all authored actions satisfy model legality. Depth overflow and writes without an open transaction remain excluded. |
| ORC-005 | Actual source, peer/coordinator and direct durable paths reach the shared checks. The response guard distinguishes delivery from applied storage observation. Completed durable traces preserve intermediate changes. |
| ORC-006 | The controls above distinguish assertion rejection, an instrument guard, a GREEN hostile subject and an initially unreached replay. Restored subjects pass. |
| ORC-007 | Fixed/random campaigns share histories, driver, judgment and budget. Both receiver properties and the new queued property execute checked direct replays. Registry tests cover their selectors. |
| ORC-008 | The semantic model state and rules are unchanged. The runner's new trace retains a distinguishable history: two different durable writes can end at the same final value. |
| ORC-009 | Existing glossary mappings remain. Raw transport response, completed hydration input, action cut and durable-transaction snapshot name separate observations. Empty housekeeping commits stutter in the model. |
| ORC-010 | Existing primary/cleanup failure handling remains. Controls preserve their intended law/checkpoint, and temporary probes retain raw diagnostics separately from cleanup. |
| ORC-011 | The alleged shared semantic fault in item 001 is disproved by dated D18 and same-path execution. No model-law revision requires another formulation. Snapshot traces challenge the named final-state blind spot directly. |
| ORC-012 | This append-only versioned section records all applicable requirements, all ten raw findings, the replay sibling and evidence limits. |
| ORC-013 | Implicit versus explicit writes, bare versus metadata-bearing seeds, named versus unknown notices and immediate versus queued repairs distinguish the conditional law and nearby wrong designs. |
| ORC-014 | Controlled and native receivers share the same model/grammar/comparison. Native storage, messages and recovery supply the bounded real-host premise. Store holds and their transaction trace belong to the controlled receiver, while native commits are awaited individually. |
| ORC-015 | Both hosts declare 108 successful notice/case/lane states. The native receiver separately declares prior-cache recovery. The queued campaign declares all four immediate/store-held seed regimes. |
| ORC-016 | New fixed/constructive histories reuse the model, driver and comparison. Runner-order, SQL fixture and grammar calibrations remain in ordinary test files. |

The durable trace covers the peer lanes, where the model owns durable storage,
including queued source commits under store holds. Read-hold/abandonment lanes
retain their source-facing laws and do not establish this direct durable trace.
No evidence covers intermediate SQL statements, arbitrary concurrent recovery,
cleanup/expiry/generation changes during recovery, Chromium OPFS, Electron IPC
or restart. The existing coverage-map owner retains those receiving limits.
The #2317/P8 source-facing witness, the broader #2281 reports and #2272 scope
remain separate and open.

### Final loss audit

The raw review was reread after the final diff. All ten original source-order
items survive: **10 = 7 fixed-now + 3 refuted** (001, 005 and 008). No raw item
is deferred, duplicated away or awaiting a product decision. The initial
counts-only calibration's limited value, item 003's absent actual setup input,
item 007's incomplete preparedDriver cure and the authority dispute in 001
retain their qualifications. The separately discovered replay item S001 is
fixed-now. No sibling counterexample remains hidden in the loss accounting.

The same current-head CodeRabbit summary reports no actionable comments and
100% docstring coverage at `d0c4d0dde`; the previous external percentage is
resolved. Formal review 5741628374 still covers `9eef6525d` and its wording
item is fixed. CI snapshot 14 has all 25 checks passing for `d0c4d0dde`.
These are historical publication observations, not final-head CI for the new
semantic test/instrument repairs. The new pushed head needs its own checks and
review coverage before a readiness verdict. This evaluation's accounting and
authorized repairs are complete within the stated receiving boundary. It does
not close #2281, #2272 or #2317/P8, or establish whole-library correctness.


## Current-head CodeRabbit wording follow-up

Review `5742229429` covers `adf6a07f97b26116933ad68e3d5e1b2f6fe5093f`.
It contains one additional minor wording item and no inline comments.
`META-CR-5742229429-001` is **fixed-now**: the fixture evidence now says
“while two authored transactions remained open.” This uses the reviewer's
first suggestion and preserves the tested premise. The proposed hyphenated
term would imply a new transaction category and was not suitable.

This is a clarity improvement, not a correctness defect. Direct comparison
of the sentence and its replacement, formatting, diff checks and unchanged
TypeScript hashes validate it. No product law, model, history or observation
changes, so no new RED test or mutant applies. The 253-test result and controls
above still describe the executable tree. The raw review was reread after the
edit: **1 = 1 fixed-now**, with no omitted suggestion or open item.

Hire this reviewer for assisted documentation cleanup. The suggestion is
precise and low priority, but this sample supplies no new behavioral evidence.
The mutable summary now covers `adf6a07f9`, reports 100% docstring coverage
and no blocking issue, and notes that it skipped the coverage map as similar
to earlier changes. Final publication-head CI remains pending. This wording
follow-up adds no unreviewed executable change.
