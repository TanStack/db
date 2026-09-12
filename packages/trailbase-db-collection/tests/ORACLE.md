# TrailBase lifecycle oracle

`lifecycle-oracle.property.test.ts` runs the real adapter and collection against
a controlled RecordApi and native ReadableStream. The mock supplies requests and
already-decoded events at the RecordApi boundary; it bypasses the SDK's fetch,
SSE decoding, and wildcard subscription routing. Adapter, core, and native stream
lifecycle code execute unchanged.
An independent Map models rows; explicit gates control subscribe/list settlement.
The same interpreter runs a fixed corpus and generated histories.

## Laws and scope

- Published inserts, updates and deletes agree with the model after each event.
- Eager startup waits for its list; on-demand startup does not claim to load rows.
  Required startup failures reject. Later stream failures retain rows and report
  the error, matching the adapter's current policy.
- Graceful closure drains buffered events before releasing the reader.
- Processing failures cancel an open source. Terminal paths release readers and
  timers without detached rejections, including same-turn cleanup.
- A startup processing error rejects readiness before asynchronous cancellation
  settles. Two fixed controls hold cancellation through later list completion,
  then resolve or reject it; cleanup cannot turn failed startup into readiness.
- Cleanup clears the collection. Late work from an old session cannot publish
  into, cancel, or report errors against a replacement session.
- A late acquired old stream is canceled once and stays unlocked, including when
  its native cancellation rejects. An unfinished old preload rejects with
  AbortError before late work settles; an already-ready on-demand preload stays
  fulfilled. Its direct subset promise settles as a canceled no-op after I/O.
- Error and detached-rejection observations are append-only through final gate
  release and cleanup. Epoch tags record when an observation arrives, not the
  hidden session that caused it. Exact console output checks pin the adapter's
  current compatibility policy, not a general service reporting contract.

Histories contain one to three sessions, eager/on-demand modes, delayed startup
and list resolve/reject, zero to eight row edits, five stream endings, and
immediate versus settled cleanup. Thirty-two fixed cases pin the boundaries;
ordinary runs add 30 fixed-seed and 50 fresh-seed histories with shrinking.
Additional controls cover rejecting late cancellation in both modes and mutate
provider-owned list, event, and buffered rows before parsing. Model rows derive
separately from command scalars, so provider mutation cannot change the answer.

This is not a model of pagination, filtered subsets, optimistic mutation
acknowledgements, service reconnects, or arbitrary event/list interleavings.
The generated event phase starts after loading; existing loading-time unit
matrices and the two held-cancellation startup controls remain valuable. Those
controls were both RED when listener failure awaited cancellation, and GREEN
when cancellation was observed separately. The on-demand driver calls the core subset boundary,
not a live query. Service-backed E2E coverage remains separate.

## Run and replay

Run from `packages/trailbase-db-collection`:

```sh
pnpm test:oracles --coverage.enabled=false
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10 pnpm test:oracles --coverage.enabled=false --testTimeout=60000
```

For a failing random campaign, use its reported seed and shrink path:

```sh
TANSTACK_DB_ORACLE_SEED=123 TANSTACK_DB_ORACLE_PATH=0:1 TANSTACK_DB_ORACLE_PROPERTY=trailbase.lifecycle node --import tsx ../db/tests/oracle-replay.ts tests/lifecycle-oracle.property.test.ts --coverage.enabled=false -t 'random or replayed'
```

Replace the example seed/path with the failure's values. The guarded runner
requires a witness that the named property executed with this seed and path;
wrong-property and zero-reach commands fail. Direct Vitest commands do not supply
that guard. Shared configuration lives in `packages/db/tests/oracle-config.ts`;
do not copy its replay parser.

## Evidence against false greens

Before the stale-startup fix, both campaigns independently shrank to: cancel a
pending subscription, restart and load a healthy stream, reject the old subscribe.
The old startup canceled the replacement reader. The fixed corpus pins this in
both modes and sends further edits through the replacement stream.

Five isolated source-transform mutations were each rejected by the fixed corpus:

| Reintroduced fault                                | Failing cases | Detecting assertion                               |
| ------------------------------------------------- | ------------: | ------------------------------------------------- |
| Unobserved `reader.closed.finally()` rejection    |             4 | No detached rejections                            |
| Release reader as soon as `closed` settles        |             2 | Buffered close reports no error                   |
| Omit source cancellation after processing failure |             2 | Underlying source canceled                        |
| Ignore cleanup's cancellation rejection           |             2 | Same-turn cleanup has no detached rejection       |
| Let abandoned startup cancel the current reader   |             2 | Replacement remains locked, uncanceled and usable |

These targeted mutations test known failure classes, not overall mutation
coverage or a proof of completeness. The 10× campaign passed 800 generated
histories (fixed seed 714203, random seed 127535183) plus the 32 corpus cases.
No service-backed E2E run is claimed.
