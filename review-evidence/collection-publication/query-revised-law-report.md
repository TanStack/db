# Query receiving evidence under the clarified raw Collection law

Production baseline: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`. All RED and neighboring GREEN observations below ran before production edits. The exact source hashes, generated observations and applied prefixes are preserved in `query-revised-law-evidence.json`. The receiving source is preserved in `query-receiver-revised-law.ts.txt`.

## Law and authority

The maintainer's 2026-10-30 clarification separates two observations. Raw Collection reads and full-state raw subscribers expose applied source transactions, including while replay acquisitions remain held or have failed. A later failed acquisition cannot retract accepted writes. A live-query Collection continues to retain its last complete publication until its replay has established a successful complete replacement. The decision is recorded in `docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md`; the graph law remains in live `ARCHITECTURE.md`, Replay participants and failure, laws 7, 9 and 14.

The superseded stronger raw-retention law and its RED observations remain untouched in `query-receiving-red.*`. Its complete test source is retained in `query-receiver-superseded-law.ts.txt`. Those observations are historical evidence, not authority for the revised expectation. For example, applied `a1` with an empty subscriber fold formerly indicted the direct read; the revised account correctly indicts the subscriber fold.

## The actual Query raw receiving boundary

`query-db.collection-public-snapshot` drives real QueryClient and queryCollectionOptions through two exact complementary retained predicates in one raw subscription. The recorder copies Query's begin/write/truncate inputs before forwarding them. It advances the shared independent keyed fold only after the original core receipt returns true or fulfills. These are source inputs to the Collection judgment; no Collection read, private state classifier, or expected Query ownership result computes the expected rows. Query's synchronous cached-result transactions remain explicit in the prefix.

This receives the core transaction-publication law through actual Query. It does not independently judge whether Query produced the correct result or ownership changes. Distinct-key iteration order, per-key event sequence, optimistic holds, indexes and arbitrary public query methods remain outside this bounded relation. The recorder compares toArray, values, get, size and a complete subscriber fold at initial settlement, immediately after truncate, at the first real replacement commit's applied receipt, and after replay fulfills or rejects. Raw assertion failure is preserved while later progress, exact error identity, later snapshots and cleanup are checked separately.

Unchanged production is assertion RED. In the named rejection history `initial=[]; replacement=[a1]`, the applied prefix is truncate, two empty cached-result commits, then the actual `a1` result commit. Every receipt fulfills. While the right provider remains held, toArray/values/get contain `a1`, size is one, and the subscriber fold is empty. After the right provider rejects, replay rejects with that exact error and the accepted `a1` remains in direct reads; the fold remains empty. The missing row is the revised-law mismatch. Progress and accepted-row survival do not fail.

Both final normal raw campaigns stopped after the first generated mismatch: fixed seed `20261030`, path `0:0:0:0:1:1`, five shrinks; random seed `1448909450`, path `0:0:0:1:1`, four shrinks. Each reached initial settlement, both actual queryFn entries, actual replacement commit and held comparison once before reductions. Fixed reached rejected replay progress once; random reached successful replay progress once. Additional verification/reduction executions are reported separately in JSON. These early RED results do not satisfy the normal 60-history budget or minimum-five reach, and no closure claim follows.

The exact raw seed/path replay reproduced the same subscriber-fold assertion with one generated history and zero shrinks. Its witness is `query-raw-commit-replay-witness.jsonl`. Fast-check internally invokes the failing input again; that invocation is not another generated history or a shrink.

## Actual Query compiled live-query receiving boundary

`query-db.collection-live-replay` reuses the existing graph owner's ReplayPublicationModel, mechanically extracted to `packages/db/tests/query/replay-publication-oracle.ts`. Its class body is byte-for-byte unchanged after removing the export keyword. The original joint-replay driver imports that companion and retains its budgets and histories. The receiver projects rows without a separate version field to model version zero; it retires the unused peer model owner.

A compiled live-query Collection reads the real Query source. A function-built Query key names each authored provider revision: initial, replay and recovery. A new revision has no cached result, so its replay load must await its real acquisition. An explicit assertion checks that replay remains pending while that provider gate is held. This distinction matters: an earlier fresh-cache fixture never reached the provider, and refetchOnMount always could start a background fetch after a cached replay had already settled. Neither fixture established a held replay obligation. Their logs remain `query-live-replay-neighbor.log` and `query-live-replay-fixture-probe.log`; neither is claimed as a product-law RED.

While the real replay queryFn is held, the driver authors an ordinary source transaction installing the generated replacement and awaits its exact applied receipt. These are ordinary injected source writes, not a partial backend Query result. The graph model keeps its old result because the real replay participant remains outstanding. The receiver compares callback-time live reads and their full-state event fold, plus drained held reads. It then resolves the provider with that already applied complete replacement or rejects with one exact error. Successful load completion still awaits Query's original establishing receipts. Rejection retains old reads and events, then a new successful replay recovers the same live-query Collection. No adapter API or receipt semantics were changed.

The final unchanged-production live campaigns are GREEN: fixed seed `20261030` and random seed `1012664750`, 60 generated histories each. Eight fixed shared histories also pass. Declared reach, minimum five per state:

| State | Fixed generated histories | Random generated histories |
| --- | ---: | ---: |
| initial compiled query settled | 60 | 60 |
| actual replay provider held | 60 | 60 |
| ordinary source replacement applied | 60 | 60 |
| held live publication compared | 60 | 60 |
| failed live publication compared | 30 | 29 |
| successful live publication compared | 30 | 31 |
| recovered live publication compared | 30 | 29 |

The same comparison rejects a hostile wrong answer that adds an unestablished `d` row during held replay, independently in direct reads and in the subscriber fold. All eight shared-input calibrations pass. This is wrong-answer calibration, not a production mutant. No production mutation was authorized for this receiving assignment.

## Commands and verification

Run from `packages/query-db-collection` with the saved config. It merges the ordinary package vite.config.ts, preserves ordinary typecheck, uses a private cache, and binds DB/DB-IVM to this worktree's production source rather than donor dist output.

```sh
/Users/kyle.mathews/.n/bin/node ../../node_modules/vitest/vitest.mjs run tests/collection-publication-query-oracle.test.ts --config ../../review-evidence/collection-publication/query-receiving-vitest.config.mts
```

Final baseline result: 10 raw tests fail on the intended assertions; 22 neighboring/calibration/type tests pass; ordinary Query typecheck reports no errors. Log: `query-raw-and-live-final.log`. The separate live campaign log is `query-live-replay-green.log`.

```sh
TANSTACK_DB_ORACLE_PROPERTY=query-db.collection-public-snapshot TANSTACK_DB_ORACLE_SEED=20261030 TANSTACK_DB_ORACLE_PATH=0:0:0:0:1:1 TANSTACK_DB_ORACLE_REPLAY_WITNESS=/tmp/query-raw-commit-replay-witness.jsonl /Users/kyle.mathews/.n/bin/node ../../node_modules/vitest/vitest.mjs run tests/collection-publication-query-oracle.test.ts -t 'reflects real Query applied commits in raw observations.*replay' --config ../../review-evidence/collection-publication/query-receiving-vitest.config.mts
```

Exact raw replay: intended assertion RED, one history, no type errors; log `query-raw-commit-replay.log`. Targeted ordinary ESLint passes for the Query receiver, shared graph model and original joint driver. Required `node scripts/agent-lint-feedback.mjs` (`pnpm lint:changed`) also passes without output. Logs: `query-raw-and-live-eslint.log`, `query-raw-and-live-agent-lint.log`. Missing unrelated Expo example tsconfig diagnostics remain visible in runtime logs; they did not supply any law failure.

## Bounded claim and guide audit

The shared grammar varies initial empty/one/three rows, replacement empty/same/overlap/disjoint keys, equal/changed values and resolve/reject. It reconstructs empty-retention, missing deletion, retained-value update and overlapping ownership witnesses. Removing those dimensions loses their corresponding distinguishing cases. Keys are unique; pending transactions and duplicate keys are excluded. Numeric values range from baseline -20..20 with changed-value delta 1..20. The graph receiver uses one source, one complete query, uncached revision keys, no joins/includes, no optimistic hold and no provider transport. Static-key cached/background-refetch behavior, more complex graphs, framework scheduling and persisted/native hosts require their own evidence.

ORC-001/002: authority and independent judgments are stated above. ORC-003/009: executable prose explains the raw/graph split, source-input projection, revision-key premise and zero-version mapping. ORC-004/013: shared dimensions and distinguishing neighboring histories are named above; raw and live checkpoints distinguish held versus failed versus complete acquisitions. ORC-005/014: actual Query paths, real receipts, explicit held-provider/pending-replay premise and precise receiving limits are recorded. ORC-006: raw original defect is assertion RED; graph comparison rejects premature rows in both observation paths. ORC-007/015: fixed/random parity, exact raw replay, budgets and honest reach are preserved; exact live replay remains a follow-up at repaired tree. ORC-008: the existing graph model is unchanged; the raw model revision is owned by the Collection lifecycle agent. ORC-010: first failures and secondary progress/cleanup diagnostics survive; all created resources are released. ORC-011: no additional shared semantic-fault hypothesis requiring another formulation was identified; the shared graph model is reused, not copied. ORC-012: this record and immutable source/observation artifacts preserve the evidence. ORC-016: shared fixed histories and wrong-answer calibrations use declared model/check parts; no ordinary unit test or standalone type assertion was added.

GREEN for the repaired raw law, hostile production mutation and whole-class closure remain ROOT's production-repair work. This receiving assignment made no production edit, install, commit, push or PR mutation. Pre-edit receiving evidence is complete within the boundaries above.

## First verification after ROOT's source repair

ROOT removed the raw subscription replay buffer. The receiving tests and shared judgments were unchanged. Normal raw fixed/random campaigns now each pass 60 histories (random seed `866891227`), and compiled live campaigns each pass 60 histories (random seed `-714944239`). All eight raw histories, eight live histories and eight wrong-answer calibrations pass: 32 behavior/calibration/type tests in total. Raw generated reach is 60 for each held-path state; success/reject counts are fixed 30/30 and random 31/29. Live generated reach is 60 for each held-path state; failed/successful/recovered counts are fixed 30/30/30 and random 24/36/24.

The preserved original raw counterexample replay (`20261030`, `0:0:0:0:1:1`) passes one history. The compiled property's exact replay (`1012664750`, `0`) passes one rejected-replay/recovery history. Both guarded witnesses identify the correct property, seed and requested path and report `numRuns=1; failed=false`. Exact live replay therefore supersedes the earlier follow-up item above.

These first repaired runs are behavioral GREEN, not clean-process GREEN: ordinary typecheck reports the unused production `snapshotSent` field at subscription.ts:189, and Vitest exits one. The receiver has no type error. Logs: `query-raw-and-live-repaired.log`, `query-raw-commit-repaired-replay.log`, `query-live-repaired-replay.log`. JSON observations and witnesses are preserved separately. The mechanical field cleanup and clean-process rerun remain ROOT-coordinated follow-up. No receiving expectation was relaxed.

## Clean process after removing the unused field

The normal Query command then exits zero: 32/32 tests pass, with ordinary typecheck reporting no errors. Raw fixed/random campaigns pass 60 histories each (random seed `-915642909`); live fixed/random campaigns pass 60 histories each (random seed `1035337850`). Every raw reach is at least 28; every live reach is at least 29. The exact source for this clean run is preserved in `query-clean-first-source.json`, and all observations/reach are in `query-clean-first-evidence.json`. Log: `query-raw-and-live-clean-green.log`.

ROOT subsequently identified a separate cleanup-only selection issue in primary/review coverage and is preparing a second source correction. This clean run supplies evidence for its captured source; receiving validation must be repeated after that correction. This record does not claim whole-PR readiness.

## Final stable-source receiving verdict

After ROOT's cleanup/readiness correction, the normal command and both exact replay commands all exit zero. Ordinary Query typecheck reports no errors in all three runs. Normal result: 32/32 tests pass. There is no receiving divergence under these bounded laws.

The final raw fixed/random campaigns pass 60 histories each, with random seed `1176914439`. Each held-path reach is 60. Success/rejection progress counts are fixed 30/30 and random 37/23. The final compiled-live fixed/random campaigns pass 60 histories each, with random seed `-1739277190`. Each held-path reach is 60. Failed/successful/recovered counts are fixed 30/30/30 and random 34/26/34. All exceed the declared minimum five.

The saved raw counterexample (`20261030`, `0:0:0:0:1:1`) is now clean-process GREEN with one history and zero shrinks. The compiled exact replay (`1012664750`, `0`) is clean-process GREEN with one rejected-replay/recovery history and zero shrinks. Both guarded witness files preserve the requested property/seed/path. The normal run also includes every shared raw/live fixed input and every read/fold wrong-answer calibration.

Logs: `query-final-normal.log`, `query-final-raw-replay.log`, `query-final-live-replay.log`. Full observations, reaches and source hashes: `query-final-evidence.json`, `query-final-source-hashes.json`. The eight recorded source/test hashes were unchanged across all three executions. The subscription source hash is `31fde05bf653f129cffd5cfe1a2a28db9505921b59674f4ddcf1abc39285c0cb`; exact source snapshots are `query-final-subscription.ts.txt` and `query-receiver-final.ts.txt`. The changes-manager boundary is also recorded separately in the final hash record and `query-final-changes.ts.txt`.

One diagnostic-only receiver improvement followed the preserved baseline evidence: if a callback mismatch precedes a drained-read mismatch, the first callback now remains the primary failure and later assertion/cleanup diagnostics remain secondary. No model rule, expected row, generator, comparison or budget changed after baseline RED.

This closes the receiving assignment at the captured source. ROOT owns the hostile production mutant and the broader core/persisted/cleanup/Effect/graph coverage reconciliation. Those obligations, other hosts and arbitrary histories are not established by these finite Query runs. Whole-PR readiness is not assessed here.

Final targeted ordinary ESLint passes (`query-raw-and-live-eslint-final.log`). The required final changed-file oracle lint also exits zero with no output (`query-final-agent-lint.log`). `git diff --check` passes. No installation workaround, production mutation, commit, push or PR operation was performed by this receiving agent.

## Follow-up after forwarding source and layout publication flags

ROOT's generated cleanup/optimistic and includes owners identified two additional production distinctions: actual source application versus an optimistic-only event, and an empty layout publication versus a redundant empty source event. ROOT corrected the internal flags without changing this Query receiver. As requested, one additional normal receiving run validates that adjusted source; exact replays were not repeated.

Result: **32/32 pass**, process exit zero, ordinary Query typecheck reports no errors. Raw fixed/random campaigns pass 60 histories each; random seed `393740827`, successful/rejected progress 29/31. Compiled-live fixed/random campaigns pass 60 each; random seed `1328063621`, failed/successful/recovered 39/21/39. Fixed campaign conditional counts remain 30 each. Every held-path reach is 60; every declared conditional reach exceeds the minimum five.

Latest normal log: `query-source-flags-final-normal.log`. Latest verified source hashes: `query-source-flags-final-hashes.json`; all eight recorded hashes stayed unchanged during this run. Subscription source SHA: `3078838292deff0a5879c7463fdcced5bccd79378a587d246d5df659671430c5`. Changes-manager source SHA: `f4f76988a427c37e37fcd21ffd5f30176074f92bdf0af31d343d08ba54d245d8`. Earlier exact-replay witnesses remain evidence for their separately captured source; this follow-up does not relabel them as reruns on the latest source.
