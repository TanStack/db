# P6 instrument calibration and controlled recovery schedules

This follow-up implements the four improvements requested after the ten-item
revision review. Its starting revision is
`ef5c66ed2d19841823b0a47de37ba047f2c16827`. The earlier
[closeout record](2026-11-02-p6-metadata-closeout.md) retains the original
review, seven repairs, three refutations and the replay sibling's disposition.
This record does not replace that history or reopen its withdrawn production
diagnosis. No product law or production source changes here.

## Authority and independent judgment

D9 and D18 distinguish keeping this tab's metadata from writing it durably.
D15 governs a storage observation without transaction authorship. Those dated
maintainer decisions remain in
[the authority record](2026-10-22-sync-metadata-session.md). The glossary's
cleanup rule invalidates the sync run synchronously; callbacks from the ended
run cannot supply new source reads. SQL rollback and admission are premises of
the native fixture, rather than additional metadata policy.

The session model still supplies every expected metadata value. Its existing
peer action is split into a durable write and notice delivery for schedules
that observe storage between them. The ordinary peer action retains the same
order and semantics. No new model state or production recovery classifier is
introduced. The new recovery grammar imports the session model, action planner
and source comparison. Raw driver observations never compute expected metadata.

## The coverage chain

| Claim and authority | Legal history and reach | Actual receiving path and observation cut | Distinguishing control |
| --- | --- | --- | --- |
| A keep does not become durable, D9/D18 | Existing immediate/store-held × bare/non-bare paired writes; all four regimes retained | Controlled persisted driver; the ordered durable transaction trace, before a later explicit repair can hide the wrong write | Permanent control inserts an incorrect intermediate snapshot while preserving the correct final state; the shared comparison rejects it before settlement |
| Reload must be observed to distinguish a local keep, D9/D15/D18 | Existing constructive grammar retains all 36 cases and 108 case/lane/notice states per host | Controlled and native SQLite receivers; source reads after actual full-reload delivery | Permanent reload-only corruption reaches the actual reload on both hosts and fails the shared source comparison |
| Response delivery alone is insufficient, D15 | One recovery; all three held phases crossed with seed, peer or cleanup and both seed metadata forms: 18 states per batch | Two real Collections/coordinators, native SQLite, Node BroadcastChannel/Web Locks, on demand; source reads before application, after interruption and after completion | Temporary wrong reads are supplied only while each hold is active. Their final state is correct; every held-cut control is rejected |
| Cleanup invalidates an ended sync run, glossary | Cleanup at response, storage read or captured-row application, for both seed forms | Same native receiver; stale source reads at cleanup start and after late work; direct durable metadata after completion | Permanent stale-read controls fail at cleanup start. Recorder controls reject credit for a hydration task that completes after invalidation |
| The fixture preserves nested rollback and unrelated callers | Both transaction entry points, scoped/root reentry, inner failure caught by outer, outer failure after successful deeper scopes, detached callbacks from ended scopes, and subsequent reuse | The same one-connection fixture used by the metadata receiver; SQL reads after rollback and a read queued while another callback owns admission | Missing-savepoint, unqueued-root and stale-context controls are tested in an isolated copy |
| A replay must execute a history, ORC-007/015 | Actual fast-check seed 2220031, valid path `0` and obsolete path `0:0:0` against the durability grammar | The shared campaign execution guard; observed property invocation count | The obsolete path returns fast-check GREEN with zero invocations. The guard rejects it; the valid path executes once |

The normal recovery campaigns run the same property eight times with fixed
seed `2220035` and eight times without a seed. Every batch constructs all 18
states, so every declared state reaches its comparison eight times per campaign.
The grammar's independent calibration retains the literal required phase and
interruption set; removing an axis cannot silently shrink its declared reach.
The real holds report the exact response/read/application prefix. A five-second
premise deadline classifies failure to reach the cut separately from a metadata
mismatch. The final durable comparison uses model-owned storage, including when
cleanup discards a successful transport response.

A peer commit can finish before a held response is released. During a hydration
scope it instead waits for native transaction admission. The runner advances
model storage in that corresponding order. The application hold retains the
captured rows before the wrapper receives them. It does not merely delay a
promise after rows have already applied. Cleanup can legitimately abandon work;
only an `AbortError` in that cleanup schedule is accepted. Other errors remain
failures, and cleanup diagnostics preserve the original law and checkpoint.

## Permanent machinery and tests

The controlled and native production drivers now live in ordinary support
modules. Their test files retain registration, replay selection and campaign
budgets. Calibration tests import the drivers without registering an unrelated
campaign. The reusable SQL fixture suite runs through `transaction` and
`transactionWithDriver`; the three original fixture cases remain covered.
Recorder tests cover transport-only responses, missing storage reads, failed
application, responses delivered after a task starts, and invalidation during a
task. A shared nonzero-execution guard is used by the constructive campaigns.

The wrong observations in permanent calibration tests are intentionally hostile
inputs to the same comparison. They are not new product models. Passing them
means the comparison rejected those specific corruptions at a reached cut.
It does not establish a production mutation score or universal correctness.

## Remaining limits and review status

The new schedules cover one recovery in the on-demand native receiver. They do
not establish arbitrary overlapping recoveries, cache claim expiry, persisted
cache generation rotation, leadership turnover, transport loss, restart,
Chromium OPFS or Electron IPC. The broader receiving work remains with #2272.
These schedules compare source metadata and final durable metadata, rather than
claiming a complete publication/event trace during recovery.

Read-hold and abandonment lanes still have source-facing coverage without the
peer lanes' direct durable transaction trace. The coverage map names this owner
and the needed wrong-write/repair/abandonment witness explicitly. This is remaining
observation work, not a retired law. The open #2317/P8 controlled-notice witness
and the broader #2281 reports remain separate from this bounded addition.

This is an author self-review. Earlier CodeRabbit coverage of `adf6a07f9` and
`ef5c66ed2` does not review these semantic instrument changes. CI success and
third-party review coverage must be reported separately for the new publication.

## Rubric audit for the changed instrument

| Requirement | Outcome |
| --- | --- |
| ORC-001 | D9/D15/D18 and synchronous sync-run invalidation are the authority; the history/path/observation limits above bound every claim. |
| ORC-002 | The same independent session model predicts metadata. The recorder returns version facts only; it never supplies an expected metadata value. |
| ORC-003 | Contract, grammar, shared model, native driver boundaries and comparison cuts remain visible in the owner and directly named companion modules. |
| ORC-004 | The initial nested keep reconstructs the known seed/re-insert/recovery witness. Phase, interruption and seed form contribute all 18 cells. Payloads range from -100 through 100. Independent literal grammar calibration catches axis removal; an unsupported boundary is rejected by the same driver/runner instead of credited. Existing constructive action legality and completed-history guards remain. |
| ORC-005 | The native boundary holds response return, actual storage-read entry, or captured rows before application. Prefix witnesses and completed input guards prove those cuts ran. Peer admission follows the host scope. Final agreement is not credited for the held source observations. |
| ORC-006 | Permanent wrong-observation controls and isolated deliberate mutations challenge the exact comparisons, recorder, scope and replay guard. Outcome categories and concrete failures are recorded below. |
| ORC-007 | Fixed and random campaigns share grammar, driver, comparison and eight-run budgets. The property is registered with its owner and direct replay interface. Captured failure replay and restored execution are checked below. |
| ORC-008 | No model state is added or removed. Splitting a peer's durable write from its notice is distinguishable by a recovery read between them. The ordinary peer action retains both events in their prior order. |
| ORC-009 | Response, storage reading and application are separate driver boundaries. `stagePeerWrite` is explicitly the model projection of durable input before notice delivery. Cleanup retains the glossary meaning. |
| ORC-010 | Failure capture includes the concrete schedule and named cut. Pending work drains before database close; an AggregateError preserves the primary failure and secondary cleanup diagnostics. Only expected cleanup abandonment accepts AbortError. |
| ORC-011 | No new semantic policy or named shared semantic-fault hypothesis requires a second formulation here. Existing hold/key/seed relational properties are retained. The new schedule reuses the primary model rather than duplicating its policy. |
| ORC-012 | This versioned record audits the changed chains and limits. Earlier broader session evidence remains in the linked closeout record. Executable revisions, commands and results follow below. |
| ORC-013 | Both seed metadata forms, named versus unknown reloads, transient versus final corruption, and before-versus-after application distinguish neighboring wrong rules. Scope is finite; no universal recovery closure is claimed. |
| ORC-014 | Actual node:sqlite/coordinator traffic supplies the new receiving premise. The controlled durable trace does not establish arbitrary native interleavings. Browser OPFS and Electron receiving gaps remain explicitly owned. |
| ORC-015 | All 18 recovery states must reach at least once; normal fixed/random campaigns reach each eight times. Existing 108-state durability, four-regime held-write and sibling guards and budgets remain. |
| ORC-016 | The new oracle module owns grammar and shared judgment only. Ordinary drivers, SQL fixture controls, recorder units and calibration tests stay in ordinary modules. No fixed production metadata answer is restated outside the primary model. |


## Additional fixture finding: META-INST-S001

The reusable conformance pass found a test-fixture isolation defect. The old
`AsyncLocalStorage<boolean>` remained true in a detached callback after its
transaction ended. Root SQL from that callback could bypass admission while
another transaction was open. The old tests covered an unrelated caller and
active root reentry, but omitted an inherited context after its scope ended.

The new witness runs through both transaction entry points. Transaction A
commits row 1 and leaves a detached callback waiting. Transaction B inserts row
2 and waits before rollback. The detached callback then submits a root read
and insert of row 3. Its read must wait for B and see only row 1; its write must
survive B's rollback. Before the fixture edit, both tests failed: the read
returned rows 1 and 2. This is RED at the intended isolation assertion, not a
timeout or a production metadata finding.

The repair gives each outer transaction an active scope and invalidates it in
`finally`. Active root reentry remains supported; callbacks from ended scopes
queue. The ten-case reusable fixture suite and the complete native receiver
suite pass after the repair. Removing that invalidation in the isolated copy
reproduces the same read failure. This finding is **fixed-now**. It is separate
from the earlier ten raw review items and does not reopen the withdrawn
production diagnosis or close #2281, #2272 or #2317/P8.

## Executed evidence

Environment: Node 24.19.0, pnpm 11.1.0 and Vitest 4.1.12. Commands below run
with `--maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
--disableConsoleIntercept`. No oracle budget was lowered or removed.

| Run, from the named package | Result |
| --- | --- |
| `db`: `pnpm exec vitest run tests/sync-metadata-session-oracle.property.test.ts tests/sync-metadata-session.test.ts tests/collection-row-metadata-composition-oracle.test.ts tests/oracle-config.test.ts tests/oracle-replay.test.ts` | 163 tests passed in four executed files, 151.73 seconds |
| `db-sqlite-persistence-core`: `pnpm exec vitest run tests/sync-metadata-session-persisted.test.ts` | 76 tests passed, 406.40 seconds |
| `db-sqlite-persistence-core`: `pnpm exec vitest run tests/sync-metadata-session-sqlite.test.ts tests/sync-metadata-recovery.test.ts tests/sync-metadata-calibration.test.ts tests/sync-metadata-recovery-recorder.test.ts tests/sync-metadata-campaign-result.test.ts tests/sync-metadata-sqlite-driver.test.ts tests/sync-metadata-write-work.test.ts` | 40 tests passed in seven files; includes both recovery campaigns, 11 calibration tests, five recorder tests and ten SQL fixture cases |

These are 279 local tests. The changed scope also passes a source-mapped,
no-emit TypeScript check, formatting, general ESLint and `pnpm lint:changed`.
The scoped general ESLint run reports zero errors and eight warnings. It is
not a whole-repository lint claim. No install workaround was needed.

Each normal recovery campaign reports all 18 states at count 8. Existing
constructive durability campaigns retain all 108 states per host, each at
count 8. The controlled queued-repair property retains all four regimes, each
at count 8. Their fixed/random budgets and the older 40-run budgets remain.

### Deliberate mutations

An isolated archive of the starting revision, overlaid with the final test
sources, supplies the baseline. It shares dependency directories, not source
files, with the working tree. The unmodified focused baseline passes 29 tests
in five files. Each mutation changes one decision and is restored afterward.
These are self-generated challenges informed by the known gaps, not held-out
independent review or an estimated production mutation score.

| ID and exact decision changed | Target and observed rejection |
| --- | --- |
| `drop-response`: return false on an OK pull inside `recoverFromSeqGapUnsafe` | Fixed recovery campaign; source metadata differs at `completed response` |
| `no-savepoint`: replace the scoped transaction body with `work(scoped)` | Both transaction entry points fail the caught-inner-rollback value assertion |
| `unqueued-root-read`: replace the root query's queued branch with a direct scoped query | Both entry points expose an unrelated transaction's uncommitted row |
| `stale-transaction-context`: remove `scope.active = false` | Both entry points fail the detached-context read assertion described above |
| `ignore-durable-trace`: make both `driver.storedMetadataTrace` selections false in the session comparison | Permanent intermediate-write calibration fails because the comparison accepts the corruption |
| `credit-invalidated-task`: remove the recorder's `started !== generation` early return | Recorder's task-after-cleanup value assertion fails |
| `accept-zero-replay`: replace the shared executed-history guard with an empty function | The actual obsolete-path calibration fails because zero-invocation GREEN is accepted |

All seven outcomes are **assertion failures at the intended comparison or
calibration**. None is credited from setup failure, runtime crash or timeout.
No selected mutant survives this bounded experiment. This says nothing about
unselected wrong designs.

### Direct replay

The dropped-response campaign shrinks to seed `2220035`, path `0:0`. With that
mutation active, the direct replay selects only the requested property and
reproduces the same completed-response metadata mismatch. Restoring production
passes the same replay and executes six batches; every recovery state reaches
six times. The initial replay verifier incorrectly required exactly one batch.
Its failed bookkeeping result is retained in scratch and superseded by this
checked nonzero-execution result; the oracle itself passed. No run budget or
shared replay configuration was changed to satisfy that mistaken assumption.

```sh
TANSTACK_DB_ORACLE_PROPERTY=sync-metadata-session.sqlite-recovery-schedules \
TANSTACK_DB_ORACLE_SEED=2220035 TANSTACK_DB_ORACLE_PATH=0:0 \
pnpm exec vitest run tests/sync-metadata-recovery.test.ts \
  --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false \
  --disableConsoleIntercept
```

The obsolete-path permanent control independently checks seed `2220031`, path
`0:0:0`, against the durability grammar. Fast-check reports GREEN with no
property invocation, and the shared guard rejects it. Valid path `0` executes
one invocation. These two experiments test different replay obligations.


### Tested source identity

The following SHA-256 values bind all 18 changed TypeScript modules to the
executed instrument. Unchanged production is from the starting revision
`ef5c66ed2d19841823b0a47de37ba047f2c16827`. Core and controlled suites ran
before a later comment-only owner edit; executable semantics are unchanged.
The native suite, isolated baseline, mutations and replay use these final
source contents. Documentation revisions do not extend third-party review.

| Repository path | SHA-256 |
| --- | --- |
| `packages/db-sqlite-persistence-core/tests/sqlite-fixture-conformance.ts` | `8c4c6d9d28f42d9e8b461233fbbe3d48d84c0582d9decc9abb935d2c85883ba9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-calibration.test.ts` | `dc960530b4286b860e6632979df8c1f2c1ce5c86df76a0d084dc59191759e431` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-campaign-result.test.ts` | `f75952c705f60519b783cf86887ada61c41c2eca86db98daa773fabc494775b9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-campaign-result.ts` | `66f2447c1116f3d10bdcee8d6a97192f81bd5e855afc3a69fbee163a75cca7cb` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-recovery-recorder.test.ts` | `a318b173252956b8a7424817d371c1aa2ad5ce3152ad1c40d43fc1bc27259971` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-recovery-recorder.ts` | `591206dbde1605b306bcd62b65ff2f5a9d1a001befc648d076ca052138e11a69` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-recovery.test.ts` | `880e40bd7f6aaf452dd2f3512a4ed0eb027feadaac221e1846dd9cfe0354dbfb` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-campaign.ts` | `b1de1ba24d79db954a4d85d6d7da18422ac29480d7175893d90b1ab07b24f1ae` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-persisted-driver.ts` | `908ae60996e225757c7f6db8ab8408a5c44d7efd6ae1000188ced6588a133240` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts` | `3296a963a8737f84c72b6897817c44fd5c9b57d3fb723307115d78b3df03ded9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-sqlite-driver.ts` | `42c6e6257de7c437005e4e0d7a297514178a95998000acf3931032140dc16e07` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-sqlite.test.ts` | `7d4d547c70cd370dab328ef289689bb85c7e4c223907ba508f71158672af181d` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-sqlite-driver.test.ts` | `7582a61d10a944dd9bd794d5deb76bca3c6996158f3c9ef229493b98cc1ca2e9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-sqlite-driver.ts` | `e5ef179a2a50d5e42f8b0ee51872885141056e2eef029a620f4ccd53a5512e53` |
| `packages/db/tests/oracle-config.ts` | `36eb19aafe2e36728a6f6798056b8f413cbbd1e3cfba01fdcd95807b2ad9b1c9` |
| `packages/db/tests/oracle-replay-manifest.ts` | `66164d47358978cad61dadbcba4c8d619983added3bf825f0ebda9d65104e496` |
| `packages/db/tests/sync-metadata-recovery-oracle.ts` | `ed05738b4d44411e617b82eccdd62ca51d4e5749ad4f698be9fd86f582976e13` |
| `packages/db/tests/sync-metadata-session-oracle.ts` | `8ad9a7dd1ab3002677461c5117e001cd7993eb45fb42b0bc0fdad268db3430b6` |


### Integration and final accounting

Fetched main is `9be51e037f6c092bc9625f9b5b4b7e23eb4fa5fe`.
The PR's three-dot diff has no production, manifest, lockfile or changeset
delta. Main has since added held query-refetch coverage and negative-limit
admission; this branch has not incorporated those commits. The local results
above describe this branch and its existing dependencies. Publication-head CI
must supply integration evidence; earlier green CI is not transferred.

The four requested improvements are implemented. The additional finding is
`1 = 1 fixed-now` (META-INST-S001), with no open finding or product decision
from this pass. The known receiving and observation limits above remain open;
they are not removed from the contract by this accounting. The earlier ten-item
review retains its independent `10 = 7 fixed-now + 3 refuted` accounting.


### Commit binding

Executable instrument revision: `60ace06b044e76fc9e57f2a6942a3c73593a2388`.
All 18 TypeScript hashes above match after commit hooks. This binding appendix
changes documentation only. The 279-test result, seven intended mutation
rejections and direct replay result describe that executable revision.
Final publication-head CI and third-party review remain separate obligations.
