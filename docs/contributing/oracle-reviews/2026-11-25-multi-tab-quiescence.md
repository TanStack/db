# Multi-tab checkpoint completion

Self-review of source `f701ca976f8bfa2cbc2f3050caa46b7c87a77425`.
The repair changes test instruments and receiving checkpoints only.

## Diagnosis and repair location

PR CI run `45677128200`, job `139427527874`, failed the generated
`browser.multi-tab-reserved-history` property on source `a86d5389a`.
Seed `-348071640`, path
`34:0:0:0:2:0:1:3:7:7:10:10:10:11:12:13:12:12:12:14:14:16:17:17:17:17:17:17:17:17:17`
reproduces the same public mismatch on Node 22: after step 34, tab B is
`loading` where the model owes `ready`. Its public and durable rows agree.
The complete shrunk history now replays through the existing model and check.

Both Collections had cleaned up. A restarted tab sent its commit to a retired
leader route. The coordinator waited for its existing ten-second RPC deadline,
retried on the replacement route, and completed the source snapshot. A diagnostic
that preserved the original mismatch observed correct readiness after that retry.
This was unfinished work at the old checkpoint, not a demonstrated product
readiness defect. The old helper counted only SQL starts and messages. Five
silent tasks could pass while a real coordinator operation remained pending.

The repair observes original SQL Promises and the coordinator's commit,
reconciliation, index and pull operations. It waits for their settlement before
applying the existing five-task quiet check. New work registered while another
call settles also delays the checkpoint. Rejections release observed work while
the original Promise still reaches its caller. The helper never reads or waits
for Collection status. The receiving model, row/status comparisons, existing
80-run campaigns, known defects and test deadlines remain unchanged.

## Instrument law and evidence

Authority: ORC-005 requires the driver to establish its claimed observation
checkpoint. ORC-010 requires failure fidelity and resource release.
`host-quiescence-oracle.test.ts` owns the independent instrument judgment.
Its model counts externally released calls. Its grammar varies zero to four
calls, fulfillment/rejection, and one held follow-up per call. A fake clock
controls quiet tasks without releasing those calls. The model's `idle` flag
means completion of the host checkpoint.

- **Reach:** five builders each run five bases per campaign and enforce both
  held-work states. The fixed campaign reached original/follow-up held work
  31/29 times; the random campaign reached them 33/30 times. Every builder has
  missing-state controls for both states.
- **RED:** the exact CI replay fails before the repair. Extracting the original
  quiet algorithm also gives 18 instrument assertion failures for falsely
  completed checkpoints. An early static type-test collection error is separate
  setup evidence and supplies no mutant credit.
- **GREEN:** the same CI seed/path passes after the repair. The complete multi-tab
  file and the first instrument version passed 339 checks with two retained
  expected failures. The strengthened final instrument passes all 32 checks.
  Package `tsc --noEmit`, `lint:changed` and staged oracle/ESLint checks pass.
- **Mutants:** a wait-once helper that ignores follow-up work fails 24 instrument
  checks, including one fulfilled parent with one held child. It reports idle
  at the intermediate cut where the model requires pending work. Removing
  Electric's `params.markReady()` still fails the receiving status comparison
  after step 5; the checkpoint does not wait until that wrong result disappears.
  Both temporary source edits were restored.
- **Limits:** observed calls in one process, Node SQLite and BroadcastChannel,
  controlled Electric streams, and one follow-up level in the instrument model.
  No universal host-quiescence, latency, unbounded-chain or native-browser claim.
  Unobserved work and the receiver's existing peer-notice limits remain.

The instrument suite runs in ordinary Node CI and the package oracle command.
Vitest's static type-test collector cannot discover its dynamic registrations,
so that collector excludes the file. Runtime selection remains enabled, and
package TypeScript still checks the file.

Run the complete affected suites from
`packages/browser-db-sqlite-persistence`:

```sh
pnpm exec vitest run tests/multi-tab-electric-oracle.test.ts tests/host-quiescence-oracle.test.ts --coverage.enabled=false --maxWorkers=1
pnpm exec tsc --noEmit
```

For the original receiving replay, also set the seed and path above,
`TANSTACK_DB_ORACLE_PROPERTY=browser.multi-tab-reserved-history`, and
`TANSTACK_DB_ORACLE_UNIT='random seed: generated'`. Select that exact generated
unit with Vitest's test-name pattern. The retained fixed history is named
`waits for a restarted tab commit after its previous leader cleaned up`.

## Guide check

| Requirements | Evidence |
| --- | --- |
| ORC-001–003 | Existing receiving laws stay. The instrument states its authority, scope, independent count model and checkpoint beside executable code. |
| ORC-004 | Existing CI trace is retained. Held versus released calls, rejected versus fulfilled outcomes, empty work and child work distinguish the grammar axes. No operation starts before its parent releases. |
| ORC-005–007 | Exact real-coordinator replay, fixed/random instrument campaigns, explicit replay coordinates and assertion-level mutant failures. |
| ORC-008–009 | Three cuts count completed calls independently of scheduler state. The model-only idle flag denotes host checkpoint completion. |
| ORC-010 | Original operation Promises and outcomes reach their callers. Failure and cleanup remain the receiver's existing distinct observations. |
| ORC-011 | No proposed shared semantic fault requires a second product formulation. The new judgment concerns the independent instrument boundary. |
| ORC-012–014 | This source-specific self-review records evidence and finite limits. Parent/child and empty-work neighbors challenge a narrow fix; the real Node coordinator replay supplies the receiving path. |
| ORC-015–016 | Both declared states have five randomized builders and missing-state controls. The retained product regression uses the existing model and check. All instrument tests register through oracleProperty. |
