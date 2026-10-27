# Ordered signalling-refetch oracle scope

Parent: `160b5ce2486e7d12ce53cde0518eb761dc5eace9`.

## Law and authority

The live-query architecture's "Ordered requests, continuation, and recovery" section states: finite continuation requires an order index, and an underfilled unindexed prefix retains the established full-source fallback. Its work law requires an applicable index. A no-additional-full-source assertion for every joined refetch exceeded that contract.

CI workflow 40572667149 failed the generated `ordered-work.eager-indexed-window` property at seed `-931507916`, path `21:3:3:3:4:3:4:4:4:5:4:4:4:4`. Local replay reproduced the same work assertion, two full-source requests versus zero, after an empty source receives an ineligible row and a marker change. These were two consumers' permitted fallback reads. No production defect is claimed.

## Repair and evidence

The signalling-refetch transfer assertion now requires bounded continuation to be available: an indexed joined window or a direct source-filter window. Unindexed joined histories still execute every row, order, publication, and other applicable work comparison. The coverage map records the bounded-transfer limit and owner. Existing generated dimensions already include both index choices and these actions; they remain unchanged.

The exact replay passes. All 270 existing tests in the owner pass with no type errors. Two fixed inputs replay the reduced trace through the same `checkEagerWindow` model, driver and comparisons, once without an index and once with it; both pass. They carry no independent expected answers. These fixed inputs are distinguishing witnesses, not a new generated reach claim.

A temporary wrong-observation control added one full-source request only on indexed histories immediately before the work comparison. The indexed neighboring witness failed at that comparison, one request versus zero; the unindexed witness passed. This demonstrates retained comparator sensitivity, not a production-mutant result. The control was removed. Changed oracle lint and targeted ESLint passed; ESLint reports four unchanged marker-shadow warnings outside this edit.

Replay command: `TANSTACK_DB_ORACLE_PROPERTY=ordered-work.eager-indexed-window TANSTACK_DB_ORACLE_SEED=-931507916 TANSTACK_DB_ORACLE_PATH=21:3:3:3:4:3:4:4:4:5:4:4:4:4 pnpm --filter @tanstack/db exec vitest run tests/query/ordered-work-oracle.property.test.ts -t 'keeps rows and per-change work bounded for a random' --coverage.enabled=false`.

## Limits

This corrects an oracle assertion under an existing architectural contract. It does not revise a product law or establish a new behavior-class closure. Unindexed joined refetch transfer is not bounded by this assertion. Existing independent row checks remain mandatory, and indexed histories continue to reject full-source work at the tested checkpoint. No shipped implementation changed. Fresh CI must pass before readiness is reported.
