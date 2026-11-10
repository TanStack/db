# Ordinary subscription checks under the raw applied-commit law

Only `packages/db/tests/collection-subscription.test.ts` changed. The five failures supplied by ROOT are in `core-subscription-regressions.stderr.log` from line 451. They asserted the superseded raw replay-retention rule or its deferred callback timing. None establishes a production defect under the maintainer's clarified law in `docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md`.

The expected observations were derived from the fixture's authored transactions before editing expectations. A committed truncate removes the old raw row. An adapter that commits version 2 before returning a pending promise has already exposed version 2. A later rejection does not undo that transaction. A raw callback can start another replay immediately at commit, so its version 3 transaction can apply before either provider promise settles. None of these source applications establishes subscription readiness while current acquisition work is pending.

| Supplemental check | Reconciled raw observation | Preserved or strengthened neighboring obligation |
| --- | --- | --- |
| Two logical demands share one replay promise | Applied truncate leaves reads and subscriber fold empty, including after rejection | Provider call count stays three. Retiring one owner leaves the other loading. Exact surviving error identity/count and ready-after-rejection are asserted. |
| Cleanup with an already committed replacement | Version 2 is visible before cleanup and remains the subscriber's last applied row afterward | Subscription is loading before cleanup. Resolving the obsolete promise produces no callback or status event after cleanup. Existing teardown remains. |
| Truncate replay throws | Applied truncate deletes `one`; later accepted insertion exposes `two`; another successful replay exposes `one` | Exact error identity/count, ready after settled failure, retained logical demand (third acquisition), historical lastError and cleanup remain asserted. |
| Truncate replay rejects | Same transaction-derived observations as synchronous throw | Same exact error, status, next-use ownership and cleanup assertions. |
| Callback starts a nested truncate replay | Version 2's raw callback starts nested replay before provider settlement; version 3 is already applied | The callback trigger and third load are asserted. Old settlement cannot make the subscription ready. Status is exactly `[loadingSubset]` until current work settles, then `[loadingSubset, ready]`. |

The first focused verification passed 81/83 checks. Two newly added direct-read comparisons accidentally included Collection virtual properties (`$key`, `$origin`, and others). Their observation is now explicitly projected to the declared Row.id field; the existing subscriber check likewise observes keys. This was an observation-scope correction, not a production repair or a relaxed source-row contract.

Final focused command, from `packages/db`:

```sh
/Users/kyle.mathews/.n/bin/node ../../node_modules/vitest/vitest.mjs run tests/collection-subscription.test.ts --config ../../review-evidence/collection-publication/ordinary-subscription-vitest.config.mts --coverage.enabled=false
```

Result: **83/83 pass**, process exit zero, ordinary typecheck reports no errors. The saved config merges ordinary core configuration, retains typecheck, uses a private cache, and binds DB-IVM to this worktree's source. Missing unrelated Expo example tsconfig diagnostics remain visible; they did not cause a law failure. Log: `ordinary-subscription-final.log`. Test/source hashes are in `ordinary-subscription-evidence.json`. The before/after supplemental source is preserved separately.

Targeted ordinary ESLint and `git diff --check` pass. The required changed-file oracle lint is recorded separately. No production file, oracle truth, run budget, adapter API, ownership mechanism or cleanup implementation was edited. These ordinary examples supplement the primary generated owners; they do not independently establish bug-class closure or PR readiness.

Required changed-file oracle lint exits zero with no output (`ordinary-subscription-agent-lint.log`). Targeted ordinary ESLint also exits zero (`ordinary-subscription-eslint.log`). No ordinary supplemental change remains pending from this reconciliation.
