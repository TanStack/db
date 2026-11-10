# Cleanup and optimistic publication receiving evidence

Base commit: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.

This is a test-only extension of the existing Collection lifecycle publication
owner. The pre-edit predictions are in `cleanup-optimistic-plan-v1.md`. ROOT
kept production unchanged until the assertion RED and its exact replay were
reported, then forwarded the actual source-origin and layout facts.

## Law and boundary

`Collection.cleanup()` documents source clearing, survival of a direct
subscription, and its reacquisition when a new sync run starts
(`packages/db/src/collection/index.ts`, cleanup API comment). The established
cleanup contract does not send that subscriber a clearing callback. The
maintainer's
`docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md`
locates raw reconciliation at applied source transactions, separately from
acquisition settlement or a complete graph result. The public transaction
contract and glossary supply synchronous optimistic visibility and settlement
drop. Therefore an optimistic-only publication cannot decide absence of an
untouched cleanup-retained row. A later applied source transaction can.

The earlier model's `source`, `visible`, and `retainedKeys` remain distinct.
This receiver reuses `projectPublication`, the shared lifecycle reducer,
`publishIfChanged`, and the primary publication diff. Its only additional
fact is whether disjoint optimistic row d is present. Direct reads reflect
new-run source plus optimistic d. The surviving callback fold also retains
old a/b/c rows until source applies. Direct/fold equality is deliberately not
asserted across that cleanup cut.

## History, observation, and reach

The generated grammar retains one to three unique a/b/c rows, values 0..5.
It requests demand, cleans up, restarts, and holds real on-demand reacquisition
without delivering any source transaction. It then uses real
`createTransaction` and `Collection.insert` for disjoint d, observes the same
synchronous turn and held mutation, settles by fulfillment or rejection, and
finally authors an empty or one-row source transaction. The first bootstrap
callback grouping is outside this receiver's claim; its rows are checked.
All subsequent exact callback boundaries and per-key changes are compared,
including the shared model's empty readiness callback. Cloned cuts preserve
observations before the later source transaction can repair the result.

Four states are declared with `createOracleReach`, minimum 5:
`restart-source-pending`, `optimistic-before-source`,
`settlement-before-source`, `later-source-applied`. The load inventory and
source-transaction counter establish that the optimistic cut precedes source
application, rather than merely preceding a provider promise's settlement.
Every generated history reaches all four states.

Fixed and random campaigns both run the same generator, receiver, checker,
and 60-run budget. Existing histories, comparisons, and budgets were kept.
Replay key: `subscription-lifecycle.cleanup-optimistic-publication`.

## RED before the production follow-up

Command, from `packages/db`:

```sh
/usr/local/bin/node ../../node_modules/vitest/vitest.mjs run \
  --config /tmp/collection-publication-core.vitest.config.mts \
  --coverage.enabled=false --typecheck.enabled=false \
  --maxWorkers=1 --fileParallelism=false \
  tests/collection-subscription-lifecycle-publication-oracle.property.test.ts \
  -t 'keeps cleanup-retained rows through optimistic publication'
```

`cleanup-optimistic-assertion-red.log` records both assertion failures:

- Fixed seed `20261030`, path `0:0:0`. Original generated reach: each state 1.
  Shrink reach: each state 2.
- Random seed `1552920238`, path `0:0:0:0:0`. Original generated reach: each
  state 1. Shrink reach: each state 4.

Both shrink to initial a=0, optimistic d=0, fulfillment, later empty source.
The first mismatch is `same-turn optimistic insert before source transaction:
exact callback batches`. Expected callback: insert d=0. Actual callback:
delete a=0 and insert d=0. The preceding direct-row comparison passes with d=0.
This is assertion RED at the intended checkpoint, not a timeout or setup error.

`cleanup-optimistic-guarded-red.log` records guarded exact replay of fixed
seed/path: the requested property executed once, `failed:true`, at the same
assertion. Its logged command contains an extra positional `run`; installed
Vitest accepted it and the guard positively recorded exactly one intended
property execution. The manifest's replay selector targets only the named
random/replay lane.

`cleanup-optimistic-first-red.log` is retained separately. It exposed the
receiver's initial omission of the existing empty readiness callback, not the
target defect. The receiver then reused the primary lifecycle projection;
that first setup/model mismatch is not cited as product RED.

## GREEN and static validation

ROOT's `core-followup-green.stdout.log` records full primary publication and
includes publication suites, 244/244 tests passing. The new property passes:

- Fixed seed `20261030`: 60 histories, each declared state reached 60.
- Random seed `759702904`: 60 histories, each declared state reached 60.
- Both have zero shrinks.

Focused TypeScript passed with `/tmp/collection-publication-core.tsconfig.json`.
Assigned-file ESLint passed. The changed-file stop-hook equivalent passed;
its empty successful log is `cleanup-optimistic-lint-feedback.log`.
No dependency installation or workaround was introduced by this extension.

The GREEN working-tree blobs, after the source follow-up and oracle citation
comment, are:

| File | Git blob |
| --- | --- |
| primary publication oracle | `696a64748eecfd742de042ddf338b11a5afcb5fc` |
| collection/changes.ts | `847c32bdb282738e3c52b389925972d7f54bda3a` |
| collection/state.ts | `50ee72e496f8917059e8ddbb38224ddcf0b421a8` |
| collection/subscription.ts | `903442806ddf7a48fa61f9b5902322a012b45393` |

The citation comment changed after ROOT's worker loaded the test. Executable
semantics are identical to that GREEN run.

## Wrong design and remaining limits

The original always-source classification is rejected by assertion RED and
exact replay. ROOT owns the additional coordinated hostile-mutant run; its
result will be recorded separately. No source mutation was performed by this
receiver's author. For the new options signature, forcing sourceApplied true
recreates the original optimistic-pruning fault. Simply omitting forwarding
now defaults false and tests a different fault: missing true-source pruning.

This witness is limited to raw Collection callbacks at an on-demand
cleanup/restart boundary, disjoint optimistic insert and settlement, and the
next empty/nonempty source transaction. It does not establish overlapping
optimistic writes to retained keys, arbitrary multi-transaction interleavings,
provider behavior, framework behavior, or live-query complete-result retention.
Those remain with the optimistic, provider, framework, and graph owners.

## Rubric review

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Cleanup API, maintainer raw decision, and transaction contract above; bounded scope explicit. |
| ORC-002 | Plain Maps/diff compute expectations; no production source-origin classifier computes them. |
| ORC-003 | Opening law and local model/grammar/receiver/checkpoint prose accompany executable code. |
| ORC-004 | Minimal a/d witness reconstructs; ablation and ranges stated beside grammar; source delivery before the optimistic cut is excluded by fixture construction and checked counter. |
| ORC-005 | Real Collection subscription, cleanup/restart, and transaction path; source/load premises asserted; direct rows, exact batches and fold observed before later repair. |
| ORC-006 | Original wrong classification rejected by the same exact callback checker; coordinated further mutant belongs to ROOT. |
| ORC-007 | Same fixed/random60 property; seeds/path and guarded single-execution replay above. |
| ORC-008 | The visible/source distinction is necessary: a later source transaction may prune old rows, an optimistic-only publication may not. The one extra optimistic-presence fact changes direct reads at insertion/settlement. |
| ORC-009 | Uses glossary cleanup, restart, sync run, optimistic transaction, applied source transaction, acquisition, publication, and observation cut; model-only retained projection described. |
| ORC-010 | Cloned cuts survive later source application. Receiver preserves driver failure with separate teardown diagnostic and releases transaction/load/subscription resources. |
| ORC-011 | No concrete shared semantic fault requiring a second formulation identified; limited law reuses the primary model. |
| ORC-012 | This record names exact blobs, original/adjacent histories, wrong design, and explicit limits; no universal closure claimed. |
| ORC-013 | The source-pending optimistic cut and later applied source cut distinguish origin-sensitive reconciliation from always-source and never-source rules; later transaction can be empty. |
| ORC-014 | Claim stays at controlled core Collection boundary; no real-provider or host handoff claimed. |
| ORC-015 | Four declared reaches, minimum5, original/shrink and GREEN counts separately above. |
| ORC-016 | Both campaigns use the shared independent model and checker; no written per-example expected answers added. |
