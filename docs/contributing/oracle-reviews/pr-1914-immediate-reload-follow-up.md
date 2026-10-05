# PR #1914 immediate-reload oracle follow-up

- Reviewed executable commit: `46b8babdf917aa5f29f6fbb7593aaf91866adbe5`.
- Comparison commit: `595697ab7da30d59ddb4d97f82626757ca2653a0`.
- Executable owner: `packages/browser-db-sqlite-persistence/e2e/electric-immediate-reload.opfs.spec.ts` with its `.opfs.ts` browser fixture.
- Source: external review supplied by the user on 2026-09-28. The lossless raw review and temporary-mutant details are in the task-local evaluation ledger; this versioned record preserves verdict-critical evidence.

## Contract, fixed history, and checkpoints

The fixed host history starts with an empty OPFS database and a live PostgreSQL
table. The first Chromium page inserts one row through the Collection's
`onInsert` handler. PostgreSQL commits it, and Electric acknowledges its txid.
The source row's OPFS adapter write is held before the write starts. The first
page must expose the row publicly while its durable snapshot remains empty.
The test closes that page without releasing the write.

The second page opens the same raw OPFS database but pauses before creating a
Collection or starting Electric. Its durable snapshot must still be empty at
this `before-source-start` checkpoint. After the fixture releases that gate,
the real Electric provider must restore the exact public and durable row. The
reopened page must send zero user-insert POST requests during this recovery.
The expected row comes from the PostgreSQL insert payload and a separate
PostgreSQL row query; it is not read from Electric or SQLite to construct the
expected result.

The test records only `POST /__issue1456/insert` requests on the reopened page,
with its listener installed before navigation. It polls public rows before
requesting complete observations, then continues checking the exact durable
row until it appears. Thus pre-publication polling does not repeatedly enqueue
full OPFS reads, while a lagging durable write still fails or remains pending.

## Review reconciliation and RED/GREEN controls

| Review item | Verdict and change | Calibration or limit |
| --- | --- | --- |
| #1: no reopened empty-before-Electric checkpoint | Valid missing direct causal observation. Added the raw OPFS snapshot while Collection creation and Electric startup are held. The review's specific claim that a failed first-page hold could pass was overstated: the existing first-page `durableRows: []` assertion and unresolved write gate already reject that path. | A temporary nonempty-snapshot mutant failed at the new held checkpoint, seeing `[row]` where `[]` was required. A separate wrong-expectation control failed at that exact assertion with actual `[]`, preserving the primary failure through teardown. |
| #5: no explicit no-reinsert observation | Valid. Added a reopened-page request recorder and zero-POST assertion. Rechecking the original first-page route counter would not observe reopened requests. | A temporary extra-POST mutant reached recovery and failed the zero-POST assertion with the inserted request URL. A permanent helper check covers method/path filtering. Requests after the final observation cut are outside this bounded claim. |
| #3: duplicated diagnostic branches lack self-tests | Valid maintenance gap. Added local tests for empty failure messages, terminal failure, late page errors, and closed-page diagnostics. | The sibling straddle fixture has a different startup boundary. A universal helper extraction was not needed to establish these checks. |
| #4: plain mode installs a pass-through write override | Valid cleanup. The override now exists only in hold mode. | The recovering page uses the unwrapped adapter. |
| #2: every observation poll reads the full OPFS snapshot | Valid work-law observation. Public-first polling removes full snapshots from pre-publication polls and retains durable polling afterward. | A deterministic control needs three public polls and two full snapshots, including one durable-lag poll. The review's claim of contention with a write already inside the scheduler was unsupported: the held wrapper waits before calling the original adapter writer. No latency improvement is claimed. |
| Cross-PR shared-harness proposal | Design decision deferred. Similar diagnostic mechanics do not imply identical startup and observation boundaries. | This record is the destination for reconsidering shared diagnostic plumbing if another fixture needs it; extraction alone would not add request observation or reduce OPFS reads. |

The two temporary behavioral mutants failed at their intended assertions, not
by timeout or setup failure. They were removed. After restoration, the focused
immediate-reload file passed **7/7** tests. The full live
Chromium/Electric/OPFS lane passed **15/15** tests, including sibling fixtures.
The main live witness also passed five repeated runs during the follow-up.
Package TypeScript, changed-file ESLint, Prettier, and `git diff --check` passed.
No production behavior, schema, or API changed.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass for the bounded issue #1456 history. The report supplies the reload case; the PostgreSQL table supplies the expected server row. `awaitTxId` is treated only as Electric transaction evidence, not a SQLite durability acknowledgment. This test does not establish Windows/Edge, offline recovery, arbitrary later inserts, or unbounded eventuality. |
| ORC-002: independent judgment | Pass. PostgreSQL data, the initially empty database, and the absence of a user insert request determine expected observations. No production resume marker or SQLite row determines the expected row. |
| ORC-003: distinguishable responsibilities | Pass. The spec and browser fixture state the bounded law, fixed insert/hold/close/reopen history, PostgreSQL-backed expected result, real provider driver, and exact public/durable/request checks at three named cuts. A generated reference model is not claimed. |
| ORC-004: generated-history grammar controls | Not triggered. This is one fixed host history with no generated-history coverage claim. The randomized database/table suffix isolates resources; it does not generate semantic histories. |
| ORC-005: production path and observation | Pass. Real Chromium pages run the Collection, installed Electric SDK, PostgreSQL, OPFS worker, and SQLite adapter. The test observes the first-page held row, raw reopened OPFS baseline before Electric starts, recovered public and durable rows, and reopened-page POST requests. |
| ORC-006: checker calibration | Pass for the repaired checkpoints. The extra-POST and nonempty-baseline mutants reached and failed the intended assertions. A wrong-expectation control confirmed the held checkpoint's actual empty snapshot and primary-error retention. None of these controls proves every possible regression is caught. |
| ORC-007: fixed/random campaigns and replay | Not triggered. The owner is a fixed live-host history, not an important generated property. |
| ORC-008: stateful-model minimality | Not triggered. No stateful reference model was introduced or changed. |
| ORC-009: vocabulary mapping | Pass. `before-source-start` is a fixture-only observation cut after opening raw OPFS and before Collection creation; it is not a new production Collection status. Source, public, and durable rows retain their distinct meanings. |
| ORC-010: failure fidelity and cleanup | Pass for exercised paths. The existing harness keeps a primary assertion as the cause if cleanup also fails. The new gate remains closed during teardown if the held checkpoint fails; page close aborts that page rather than racing Collection creation with database close. The temporary wrong-expectation control failed at the intended equality assertion with no secondary cleanup error. Process crashes remain outside this guarantee. |
| ORC-011: independent second formulation | Not triggered. No plausible shared semantic classifier between the PostgreSQL expected row and the OPFS/Electric result was identified. The added pre-Electric raw snapshot is a distinct causal checkpoint, not a second implementation of Electric recovery. |

ORC-012 is satisfied by this record for the exact executable commit above. The
follow-up strengthens one bounded host witness; it does not claim closure of
every host or timing regime in issue #1456.
