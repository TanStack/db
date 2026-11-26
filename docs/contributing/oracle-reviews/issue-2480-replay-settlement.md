# Ordered-loader replay settlement

This self-review records the evidence for implementation commit
`b699d1ca2e4981c91a7ba4a3b2989857ae35d07a`, based on
`e462d35cdd7aeef5de4e646538bd1594a94d8425`. The record's commit changes
documentation only.

## Finding and repair

[Issue #2480](https://github.com/TanStack/db/issues/2480) records the
[failed PR #2420 job](https://github.com/TanStack/db/actions/runs/45705971399/job/139596048346).
Its direct replay fails on unchanged main at the held-acquisition check:

```text
held after step 6: request 4, a successful acquisition of repair chain 3,
was released before a later authoritative read succeeded
```

The controlled driver reported replay success while replacement prefix 5
was still in flight. ARCHITECTURE.md, "Replay participants and failure",
requires every acquisition started inside replay to join its publication
barrier. The driver supplied an impossible completion signal.

The repair belongs in the production driver, under the repair-location
table in `instruments/adversarial-review.md`. The success command now
answers acquisitions that joined replay, including their continuations,
before completing it. Each answer passes through the existing held-law
comparison. In the captured case, prefix 5 starts full-source read 6.
Read 6 succeeds before replay retires request 4, so the release has coverage.

The completion helper also refuses to complete with an unanswered current
acquisition. A hung request keeps that replay pending. Historical transports
may remain unanswered because replay reacquires their logical demands.
Completion stays synchronous when no current acquisition needs an answer.
An asynchronous helper at this cut changed neighboring observations, so
the repair preserves the original synchronous drain checkpoint.

The component driver deliberately retains explicit loader retries during
replay. They exercise acquisition and continuation handling. The public
window API waits for replay before moving, as ARCHITECTURE.md requires.
There is no change to that production boundary.

## Evidence

- **Law:** reuse the held-acquisition law and the existing replay barrier.
  Both derive from ARCHITECTURE.md. No law or comparison changed.
- **Reach:** `ordered-loader.replay-settlement` declares
  `current-acquisition-before-replay-success`. At seed `1040058663`, each
  campaign reaches it in 5 constructed histories and 100 generated histories.
- **RED:** the extended property fails all 10 registered tests on the old
  driver, including the captured fixed history, both constructions, and both
  generated campaigns. The first difference is held checkpoint `1638`.
- **GREEN:** the complete loader-state owner passes all 142 tests in both
  gap-run baselines, with no nondeterministic tests. The original property,
  seed `1040058663`, unit `random seed: generated`, and path
  `5586:1:1:1:5:4:8:8:10:11:20:22` pass directly.
- **Mutant:** change `? chain !== keptChain` to `? true` in
  `OrderedSourceLoader.retireSettledFiniteAcquisitions`. The fixed authority
  history for a superseded tie rejects it at held checkpoint `1638`.
  The targeted report records one mutant, one kill, and no gaps.
- **Other checks:** DB test-source typecheck, ESLint, Prettier,
  `pnpm lint:changed`, and the run-budget check pass.
- **Limits:** this is a controlled-driver correction. It establishes no
  new provider, browser, public-row, or resource-leak claim. The gap run
  targets one authored mutant, not the whole production mutation inventory.
  A separate one-mutant sample with only the replay selected did not
  distinguish omission of `loadPrefix`'s `orderBy` option (`M316`). This
  change makes no claim to close production request-shape gaps.

The gap runs used a temporary package-local config which retained the DB
configuration and selected `**/ordered-source-loader-state-oracle.test.ts`.
It disabled coverage and Vitest's typecheck during execution, and used
one worker. The separate TypeScript check covered the test sources. The
temporary config is not part of the change.

```sh
pnpm exec oracle-gaps --package packages/db \
  --source src/query/live/ordered-source-loader.ts \
  --env-prefix TANSTACK_DB_ORACLE --seed 1040058663 \
  --config vitest.investigate-2480.config.mts --contexts 1 \
  --mutants <authored-mutant-directory> \
  --only authored:retire-current-repair-acquisitions

pnpm exec tsc --noEmit -p packages/db/tsconfig.test.json
pnpm lint:changed
node scripts/check-oracle-run-counts.mjs
```

For the RED run, select `ordered-loader.replay-settlement` with the config's
`testNamePattern`, and use `--sample 1` instead of the authored mutant flags.
For the original replay, use its environment variables above with the
unfiltered owner configuration.

## Rubric audit

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Existing architecture authority and controlled-driver limits remain explicit. |
| ORC-002 | The independent request ledger and its judgments are unchanged. The driver derives pending acquisition identity from that ledger. |
| ORC-003 | Prose explains replay participation, synthetic answers, and the component/public window distinction beside the code. |
| ORC-004 | The fixed case reconstructs the CI trace. The grammar varies deltas -1/0/1, offsets 0/1, cleanup faults, reentrant passes, and up to eight later commands. Removing acquisition participation admits the recorded impossible completion. |
| ORC-005 | All cases drive the real loader. The complete owner also retains its existing Collection and Effect receivers. |
| ORC-006 | The current-chain retirement mutant fails the held comparison. Restoring the original driver reproduces the false alarm under the extended property. |
| ORC-007 | Fixed and random campaigns share the grammar and 100-history budget. The original seed, unit, and shrink path still replay directly. |
| ORC-008 | No model field or transition changed. The new selector derives current acquisitions from the existing ledger and truncate boundary. |
| ORC-009 | Current acquisitions started after the last truncate. Historical transports belong to replay's reacquired logical demands. Explicit component retries do not claim public window admission. |
| ORC-010 | Existing cleanup remains intact. The held comparison runs after each added answer, before later work could hide a release. |
| ORC-011 | No new shared semantic fault between production and the reference was identified. There is no new second-formulation claim. |
| ORC-012 | This record identifies the exact implementation commit and the boundary of the repair. Review was a self-review. |
| ORC-013 | The captured pending prefix and its later successful full-source read distinguish premature completion from covered retirement. |
| ORC-014 | The claim ends at the controlled component boundary. Existing receivers remain; no new real-provider premise is asserted. |
| ORC-015 | Both campaigns reach the declared state. Construction preserves a generated suffix and returns a fresh history object. |
| ORC-016 | The new property registers only through `oracleProperty`. Fixed and generated histories use the same driver, ledger, and comparison. |

The design-grammar trigger applies because this boundary has more than five
laws. The repair keeps the existing ledger, classifications, laws, and
checkpoints. It adds no model state. Answering acquisitions that joined replay preserves
the driver's success-command meaning without filtering histories or
discarding component continuation coverage. Existing run budgets remain
unchanged; the directed campaign adds 100 histories per campaign.
