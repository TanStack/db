# Ordinary replay regression reconciliation

Changed file: `packages/db/tests/collection-subscription-replay.test.ts`.

Authority: `docs/contributing/oracle-reviews/2026-10-30-raw-collection-publication-decision.md`.
Raw Collection subscribers observe applied source transactions. A pending or
failed replay does not retain the source baseline or retract accepted writes.
Acquisition ownership, completion, status, error, and live-query graph contracts
remain separate.

The parent regression run reported 19 failures in this ordinary supplemental
file. The failures expected the superseded baseline-retention law or callback
publication at replay completion. No production defect was identified in this
file. The reconciliation preserves existing acquire/unload identities, abort
ordering, peer rows, readiness, release reentry, and settlement assertions.

- Canceled/reentrant replay: applied truncate empties the raw subscriber;
  later applied source writes publish even after replay failure.
- Ordered replay: a new ordered snapshot may issue an empty callback after
  failed acquisition; provider prefix/cursor assertions remain. Applied source
  rows publish while replay is pending, and repeated ordered snapshots neither
  duplicate insertions nor manufacture provider cursor boundaries.
- Synchronous loader/release failures: writes committed before failure remain
  visible at demand retirement.
- Reentrant additional acquisition: readiness can stay pending after raw source
  rows become public. Existing abort/status/settlement assertions remain.
- Subscriber failure: arm the throwing listener before the accepted source
  commit. Assert its exact Error object at that synchronous publication cut,
  preserve the applied row, then prove replay completion still resolves and
  reports ready. The former queued-error assertion at replay resolution no
  longer exercised a callback under the accepted raw law.
- Final release/reacquisition: expect distinct truncate-delete and replacement-
  insert batches. Release does not synthesize another source transaction.

From the workspace's `packages/db` directory:

```sh
/Users/kyle.mathews/.n/bin/node ../../node_modules/vitest/vitest.mjs run --config /tmp/collection-publication-core.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --fileParallelism=false tests/collection-subscription-replay.test.ts > /tmp/collection-subscription-replay-ordinary-raw-final.log 2>&1
```

Result: **65/65 passed**. Unrelated React Native Expo tsconfig parse warnings
remain nonfatal. First reconciliation run was 61/65: its four failures were an
empty nested snapshot callback and indexing an empty callback as a source batch;
the final expectations distinguish snapshot callbacks from source batches.

From the workspace root:

```sh
/Users/kyle.mathews/.n/bin/node node_modules/eslint/bin/eslint.js packages/db/tests/collection-subscription-replay.test.ts
/Users/kyle.mathews/.n/bin/node node_modules/prettier/bin/prettier.cjs --write packages/db/tests/collection-subscription-replay.test.ts
/Users/kyle.mathews/.n/bin/node node_modules/typescript/bin/tsc --project /tmp/collection-replay-ordinary-types.tsconfig.json --noEmit > /tmp/collection-subscription-replay-ordinary-raw-typecheck.log 2>&1
```

ESLint and Prettier passed. Focused typecheck result is recorded in the named
log. No production file, oracle definition, generator, or campaign budget changed
in this reconciliation.
