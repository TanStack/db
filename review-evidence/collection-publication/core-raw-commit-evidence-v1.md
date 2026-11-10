# Core raw-commit pre-production evidence

Production baseline: c351fc04d7f70dc59bf92ecbed310f899b9511cd. Every RED below completed before ROOT edited production. The superseded source-privacy model evidence and frozen design-grammar-v1 remain unchanged.

Law: raw Collection reads and a full-state raw subscriber fold reflect each applied source transaction, including truncate, partial replay delivery, equal follow-up and quiet load failure. Authority: maintainer decision in docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md. Load failure does not retract applied source writes. Applied receipts and load-success-after-applied-settlement remain separate obligations.

The shared model reduces fixture-authored transactions, certified at the exact core receipt or synchronous authored callback cut. It never selects expected rows from observed Collection membership or replay state. Four-key membership, empty/one/three baselines, empty/same/overlap/disjoint replacements, equal/changed values and resolve/reject load outcomes remain in the grammar. Both failure continuations (retry and final-owner retirement) run before a comparison error escapes.

## Commands and assertion REDs

From packages/db:

```sh
/usr/local/bin/node ../../node_modules/vitest/vitest.mjs run --config /tmp/collection-publication-core.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --fileParallelism=false tests/collection-subscription-lifecycle-publication-oracle.property.test.ts -t 'Collection atomic public snapshot'
```

core-raw-commit-first-red.*: calibration passes; all eight shared explicit inputs fail the same judgment, with both rejection continuations retained. Fixed and random campaigns each stop on an assertion RED, not a setup/progress error. Empty initial -> a1: candidate-applied-while-sibling-held reads/get/values/entries/toArray/index/has/keys/size show a1, fold remains empty. Initial a0 -> empty: the applied truncate leaves direct reads empty, fold retains a0. Receipts report applied and progress inventory is empty. Full original and shrink cuts are in stdout before cleanup.

Captured campaign records (generated histories and shrink histories are separate):

```json
[
  {
    "property": "subscription-lifecycle.atomic-public-snapshot",
    "campaign": "fixed",
    "seed": 20261030,
    "path": "0:0:0:0:1:1",
    "failed": true,
    "runs": 1,
    "completedGeneratedReach": {
      "held-after-truncate": 2,
      "held-after-candidate-commit": 2,
      "held-after-equal-followup": 2,
      "quiet-failure": 2,
      "failed-retirement": 1,
      "successful-retry": 1,
      "successful-publication": 0,
      "cleanup-old-work-fenced": 2,
      "restarted-publication": 2
    },
    "completedShrinkReach": {
      "held-after-truncate": 14,
      "held-after-candidate-commit": 14,
      "held-after-equal-followup": 9,
      "quiet-failure": 12,
      "failed-retirement": 6,
      "successful-retry": 6,
      "successful-publication": 2,
      "cleanup-old-work-fenced": 14,
      "restarted-publication": 14
    }
  },
  {
    "property": "subscription-lifecycle.atomic-public-snapshot",
    "campaign": "random",
    "seed": 243238577,
    "path": "0:0:0:1",
    "failed": true,
    "runs": 1,
    "completedGeneratedReach": {
      "held-after-truncate": 1,
      "held-after-candidate-commit": 1,
      "held-after-equal-followup": 1,
      "quiet-failure": 0,
      "failed-retirement": 0,
      "successful-retry": 0,
      "successful-publication": 1,
      "cleanup-old-work-fenced": 1,
      "restarted-publication": 1
    },
    "completedShrinkReach": {
      "held-after-truncate": 5,
      "held-after-candidate-commit": 5,
      "held-after-equal-followup": 2,
      "quiet-failure": 0,
      "failed-retirement": 0,
      "successful-retry": 0,
      "successful-publication": 5,
      "cleanup-old-work-fenced": 5,
      "restarted-publication": 5
    }
  }
]
```

Exact manual replay (core-raw-commit-direct-replay.*): property subscription-lifecycle.atomic-public-snapshot, seed 20261030, path 0:0:0:0:1:1 reproduces a0,d3 candidate with fold empty. A manifest-guarded replay (core-raw-commit-guarded-replay.*) has executions=1, numRuns=1, failed=true at those exact coordinates. Its command prepends the same environment and uses `/usr/local/bin/node --import tsx tests/oracle-replay.ts` with the same Vitest arguments. This is an assertion failure at the same observation cut.

Primary model revision was predicted in primary-raw-commit-plan-v1.md before editing it. primary-raw-commit-first-red.* reports 53 failures, 85 passes, 11 skipped. The first failure authors c42, requests a, then truncates: model requires delete c42 at truncate, production delivers no callback. Fixed seed1657005/path7:1:2:4:6:2:2:0:0 shrinks to source a0; request a; truncate; unsubscribe. Random seed2043981345/path27:1:2:2:7:4:4 independently finds source a0; cleanup; restart; noop release a; source d2: missing delete a0 in the later applied transaction's callback. The primary exact guarded replay has executions1/failedtrue and preserves the fixed truncate violation. Its legacy manifest lacks a name filter, so other owner tests also execute; the exact property witness still identifies the requested replay.

## Reconciliation and checks

Removed the primary model's replay-owned Replacement and finishReplacement state. Diagnostic replay-pending/replay-settling/replay-failed labels retain the same bounded product axes without choosing expected raw visibility. Cleanup still retains the subscriber fold without inventing a cleanup clear event; its first later applied source transaction reconciles current raw source membership. Exact callback boundaries, per-key change order, local selection dedupe, unsubscribe silence, terminal settlement fencing, every history and all run budgets remain. The 288-cell bounded product still requires every cell to be reached.

Fresh focused TypeScript and ESLint pass after the primary revision (primary-raw-commit-typecheck.*, primary-raw-commit-eslint.*). core-raw-commit-oracle-lint.* passed the changed-file oracle hook before the primary revision; a final changed-file hook is still required after all concurrent changes. No installs, commits, source edits or mutants were done by this agent.

Limits: no GREEN or closure is claimed in this pre-production record. The new read/fold equality model excludes cleanup-time equality, optimistic overlays, arbitrary callback programs and per-key event-order judgment; the primary exact-batch model retains its applicable bounded checks. Real Query and persisted-wrapper receiving evidence belongs to their receiving drivers. Complete live-query result retention remains a separate law and must stay GREEN. Legacy replay-specific expectations and lifecycle counters are delegated to their existing owners; changing this model does not discharge them.
