# Query receiving RED

Production revision: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`. Production files were unchanged. Source hashes and all public observations are in `query-receiving-red.json`.

## Law and receiving path

Maintainer decision, 2026-10-30: a truncate replay's replacement remains private to direct Collection reads and subscribers until coherent successful publication; failure retains last good rows. The shared primary judgment and grammar are `packages/db/tests/collection-public-snapshot-oracle.ts`.

The receiving test is `packages/query-db-collection/tests/collection-publication-query-oracle.test.ts`, property `query-db.collection-public-snapshot`. It drives actual `QueryClient` and `queryCollectionOptions` with two exact complementary predicates in one subscription. Query's real commit receipt is forwarded unchanged. Both replay queryFn calls enter; one returns its result while the other remains held. The recorder opens only after provider return and captures direct toArray, values, get and size plus a full-state subscriber fold immediately after the real Query commit call. No independent-subscriber global promotion policy is assumed.

The test records the privacy assertion, then independently permits successful or failed replay progress. It preserves the primary assertion and separates later snapshot, protocol and cleanup failures. Query's cache keys, receipt visibility, acceptance semantics and production code are unchanged.

## RED commands

From `packages/query-db-collection`, run the exact Node/Vitest command below. The saved config merges the package's ordinary `vite.config.ts`, retains ordinary typecheck and binds DB/DB-IVM to this worktree's source rather than donor dist artifacts.

```sh
/Users/kyle.mathews/.n/bin/node ../../node_modules/vitest/vitest.mjs run --config ../../review-evidence/collection-publication/query-receiving-vitest.config.mts --coverage.enabled=false tests/collection-publication-query-oracle.test.ts
```

Result: both campaigns and all eight shared finite inputs reject the privacy law. Ordinary typecheck reports **no errors**. Fixed campaign: seed `20261030`, path `0:0:0:0:1:1`, failure after one generated history. Random campaign: seed `184679171`, path `1:0:0:1`, failure after two generated histories. Each campaign stopped early on the intended assertion; this is no claim that its 60-run budget or minimum-five reach requirement completed.

Both shrink to `initial=[]`, `replacement=[{id:a,value:0},{id:d,value:3}]`, success outcome. While the right queryFn is held, direct reads expose `a=0` and the fold stays empty. After the right response is released, replay fulfills and all recorded Query receipts fulfill. This is an assertion RED, not a timeout or setup failure. The larger fixed witness begins `a0,b1,c2` and returns `a3,d5`; its held direct read is `a3,b1` while its fold remains `a0,c2,b1`.

The raw log also preserves quiet failed-replay snapshot mismatches as secondary assertions. Exact Query error event and replay rejection identity checks do not fail. Success and rejection both progress in the finite histories. Expected Query failure logging and unrelated missing Expo tsconfig diagnostics remain visible in the raw log; neither supplied the RED.

## Direct replay

```sh
TANSTACK_DB_ORACLE_PROPERTY=query-db.collection-public-snapshot TANSTACK_DB_ORACLE_SEED=20261030 TANSTACK_DB_ORACLE_PATH=0:0:0:0:1:1 TANSTACK_DB_ORACLE_REPLAY_WITNESS=/tmp/query-publication-witness.jsonl /Users/kyle.mathews/.n/bin/node ../../node_modules/vitest/vitest.mjs run --config ../../review-evidence/collection-publication/query-receiving-vitest.config.mts --coverage.enabled=false tests/collection-publication-query-oracle.test.ts -t 'keeps real Query replacements private.*replay'
```

The exact replay reproduced the same held-public-read mismatch with zero shrinks and ordinary typecheck clean. Its guarded witness is saved in `query-receiving-replay-witness.jsonl`. Fast-check internally executes the failing replay input a second time; the extra invocation is recorded as `additionalExecutionReach`, not credited as another generated history or a shrink. Stable test name: `keeps real Query replacements private (random or replay campaign)`.

## Reach and limits

Before shrinking, fixed reached initial real Query settlement, both replay provider entries, actual result commit and held comparison once; it reached failed replay progress once. Random reached those four states twice and failed replay progress twice. Additional reductions and verification executions are listed separately. All eight finite inputs also exercised their complete path. This RED gate is deliberately narrower than bug-class closure.

Targeted ordinary ESLint passes after replacing conditional test registration with the documented replay guards. `query-receiving-eslint.log` is empty. The required changed-file oracle lint script also ran; it reported only two conditional registrations in the separate persisted receiving file, at lines 357–358. Query had no finding. Its output is preserved in `query-receiving-agent-lint.log`; ROOT owns that other file. No install, production edit, commit, push or PR mutation occurred. No GREEN is claimed. After the production design is implemented, rerun the same fixed/random budgets, finite histories and direct replay without relaxing the shared model or receipt contract. The original divergence is the hostile behavior this new oracle rejects. Persisted wrappers, compiled graph publication, independent-consumer scope, optimistic causal queues, cleanup/restart and native hosts need their own required receiving witnesses.

The maintainer subsequently selected Field Lab Design grammar to explore fixes without a new adapter API. This evidence is preserved as the unchanged-production receiving gate; no further runtime investigation or production work followed that instruction.
