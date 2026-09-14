# Older oracle repairs

The audited runners now use independent admitted baselines, retain concurrent
same-turn snapshots, and compare rendered text alongside IDs. They also preserve
the original failure during shrinking/replay and report cleanup errors separately.
These are test-harness changes; production mutation behavior is unchanged.

## What changed

| Audit loss | Repair |
| --- | --- |
| LA-01: shrinking changes the accusation | The outer scenario retains the first failure's law, checkpoint, operation/collection when supplied, and first differing location. Other failures reject a shrink. Original and reduced inputs are saved separately. Replay reports same violation, different failure, or passing repair. |
| LA-02: cleanup masks errors or writes an early green report | Assertions freeze their evidence before cleanup. Release failures are retained separately, later releases still run, and reports are written after teardown. This includes the auxiliary registry, compiled-browser and loading callers of the shared driver. |
| LA-03: expectations borrow client state | Compiled and dependency runners read an independent baseline before actions. After reconciliation they advance that admitted baseline from reference queries. Unselected queries retain their previous reference baseline across unrelated external writes. |
| LA-04: concurrent invocation snapshot is discarded | The concurrent runner passes the snapshot captured inside `invoke` to the comparison. It does not replace that snapshot with a later client read. |
| LA-05: consumer checks see IDs only | The shared browser driver compares ordered `{id,text}` projections from the DOM against reference rows after its existing two-animation-frame checkpoint. |
| LA-06: a red exit substitutes for fault evidence | Reports distinguish semantic rejection, infrastructure failure, progress timeout, cleanup failure, fault survival and an unreached fault. They retain named comparison counts and actual fault-site records. |

`tests/oracles/evidence.mjs` shares only diagnostics, comparison bookkeeping,
shrinking and cleanup. Each oracle still owns its generator, reference state and
expected semantics. Source hashes and dependency versions are captured when the
recorder is constructed, before execution, rather than read at report time.
The first exploratory receipts predate that provenance change; use the final
campaign receipts for the frozen startup provenance.

The shared driver now copies the compiler's SQL dependency modules into its
isolated test project. Its local-port allocation rejects errors through normal
teardown instead of emitting an uncaught server error.

## Controls that the old observers missed

| Control | Old observer | Repaired observer |
| --- | --- | --- |
| Wrong admitted row written through the collection's sync utility before the next action | [Compiled](evidence/oracle-repair-compiled-old/report.json) and [dependency](evidence/oracle-repair-dependency-old/report.json) controls passed after a later mutation repaired it. | [Compiled](evidence/oracle-repair-compiled-red/report.json) and [dependency](evidence/oracle-repair-dependency-red/report.json) fail `reference-baseline` before the action. |
| Wrong row text only in the invocation snapshot, with later rows correct | [Old concurrent runner](evidence/oracle-repair-immediate-old/report.json) passed the two-action wave. | [Repaired runner](evidence/oracle-repair-immediate-red/report.json) fails `collection-rows` at `same-turn`. |
| Wrong text rendered by the generated React component, with correct IDs and collection rows | [Old browser observer](evidence/oracle-repair-render-old/report.json) passed. | [Repaired observer](evidence/oracle-repair-render-red/report.json) fails `rendered-values`. |

The baseline fault changes real client collection state. The render fault changes
the generated component. The immediate-snapshot control corrupts the fixture's
observation seam; it demonstrates that the captured value is now checked, not
that a production same-turn defect was discovered. Controls never edit the
running manual app.

The [saved browser counterexample](evidence/oracle-repair-immediate-red/replay.json)
[reproduces the same violation](evidence/oracle-repair-immediate-replay-red/report.json)
with the fault and [passes without it](evidence/oracle-repair-immediate-replay-green/report.json).
The compiled baseline counterexample also [passes after removing its fault](evidence/oracle-repair-baseline-replay-green/report.json).

## Failure-preservation controls

The helper tests exercise actual fast-check shrinking: an unguarded property
shrinks an initial row failure at `9` into a build failure at `0`. The guarded
property rejects that drift and retains the row failure at `5`.

A nested-runner test initially [failed](evidence/oracle-repair-nested-red.tap): an
inner runner could swallow a different failure and allow a later matching failure
to qualify the candidate. Only the outer scenario now decides whether to accept
a shrink, so execution stops at the first violation.

The same tests verify frozen mismatch evidence, continued cleanup after an error,
separate late-promise diagnostics, replay outcomes, and failure of survived or
unreached fault controls. An [actual compiled-runner cleanup fault](evidence/oracle-repair-cleanup-red/report.json)
changes the final verdict to `cleanup-failure` after all three operations pass.

## Validation

- [77 contract tests pass](evidence/oracle-repair-contracts-final.tap), including
  seven evidence-helper tests. The [final helper run](evidence/oracle-repair-evidence-tests-final.tap)
  also passes after provenance capture moved to startup.
- [Compiled dependency campaign](evidence/oracle-repair-compiled-final/report.json): 71 operations.
- [Dependency campaign](evidence/oracle-repair-dependency-final/report.json): 149 operations.
- [Concurrent browser campaign](evidence/oracle-repair-concurrent-final/report.json): four operations in two waves.
- [SQL browser campaign](evidence/oracle-repair-sql-final/report.json): 11 operations.
- [End-to-end campaigns](evidence/oracle-repair-e2e-final/report.json): controls,
  read retries, coherence and exhausted retries; 20 operations.
- [Exhausted-retry check after retaining wire errors](evidence/oracle-repair-read-failure-final/report.json).

Reports contain actual executed-operation and checkpoint counts. Campaign
settings are intentionally small for this repair pass; no PostgreSQL-wide
coverage or statistical confidence threshold follows from these runs.

Run from this directory, for example:

```sh
npm run test:contracts
ENDPOINT_ORACLE_SCENARIOS=5 node tests/oracles/compiled-dependencies.mjs
ENDPOINT_ORACLE_SCENARIOS=10 node tests/oracles/dependencies.mjs
ENDPOINT_ORACLE_SCENARIOS=1 ENDPOINT_ORACLE_SEQUENCES=2 node tests/oracles/concurrent.mjs
ENDPOINT_ORACLE_TEST_FAULT=bad-baseline node tests/oracles/compiled-dependencies.mjs --controls-only
ENDPOINT_ORACLE_TEST_FAULT=immediate-snapshot node tests/oracles/concurrent.mjs --replay evidence/oracle-repair-immediate-red/replay.json
```

## Coverage limits

The DOM assertion checks the fixture's visible projection—IDs, order and text—at
named checkpoints. It does not observe every intervening React commit or claim
that unrendered columns appear on screen. Full collection rows and concurrent
source notifications have their own assertions. The broader every-render promise
remains untested rather than being credited to this checkpoint observer.

Named row, notification and rendered-value failures have semantic identities.
Remaining older assertions retain a source-site identity; setup/build failures
cannot count as successful value-fault rejection. Legacy replay inputs without
recorded failure identities still execute, but do not earn same-failure evidence.

The auxiliary registry, loading and compiled-browser runners received teardown
finalization changes because they use the shared driver. Their entire campaigns
were not rerun here. This repair adds no new subset, SQL-function, broad-schema,
or concurrency-generation dimensions. Existing client/server exclusion checks
ran in the browser campaigns; no new leakage mutant is claimed.
