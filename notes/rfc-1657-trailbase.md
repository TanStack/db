# RFC 1657 follow-up: TrailBase stream termination

Base: origin/main ad043b745. This is the narrow error-handling bug found while
examining #1521; it does not implement that PR's polling policy.

- [x] Reproduce with the actual Collection and TrailBase adapter.
- [x] Add close/error matrix checking reported errors, unhandled rejections,
      reader lock, cleanup timer, retained rows/status, and absence of extra loads.
- [x] RED: normal close passes; errored stream leaks an unhandled rejection and
      keeps its reader locked. Later cleanup can reject again when canceling it.
      /private/tmp/trailbase-stream-red.log.
- [x] Fix: observe both settlements of reader.closed, clear interval, release
      reader, and clear only the matching active-reader reference. The existing
      listen catch remains the error reporter.
- [x] GREEN: all12 package runtime tests pass; no type errors. ESLint no errors
      and one pre-existing require-await warning. Prettier unchanged.
      /private/tmp/trailbase-stream-green.log.
- [ ] Release note and PR after integration review. No implementation pushed.

## Why the tests missed it

Existing tests close streams normally or cancel them deliberately. None errors
a live stream after startup. The listen() rejection handler did not observe the
separate promise returned by reader.closed.finally(). Normal close and rejected
close therefore need separate laws, including resource cleanup after failure.

## Boundaries preserved

Initial subscribe failure still rejects readiness. Post-start disconnection
keeps the last ready rows. No polling/reconnect behavior, automatic refetch,
mutation confirmation policy, or core change is added.

The broader #1521 proposal claims a polling cycle which does not exist, marks
ready even after required list failure, and skips acknowledgement waits based
only on initial subscription availability. Do not transplant it. Stale same-ID
ack evidence and actual degradation/recovery policy remain separate decisions.

## PR preparation review

Fetched origin/main: still ad043b745. Simplification review found no worthwhile
cuts. Correctness review found a regression in the initial fix: reader.closed
can settle before listen() drains its last queued event. Releasing the lock at
that point turns graceful buffered closure into a spurious subscription error.

- [x] Add buffered-close to the close/error matrix. Enqueue two inserts before
      closing; assert both rows applied, no error report, timer cleared, reader
      released and later collection cleanup safe. RED: one fail, two controls pass.
      `/private/tmp/trailbase-buffered-close-red.log`.
- [x] Retire the reader after listen() settles, with a caught finally chain.
      reader.closed now only clears the timer and observes both settlements.
- [x] Full package: 13 runtime tests plus one type test pass, no type errors.
      Built the missing Electric declaration dependency before the full type gate.
      ESLint: no errors, one pre-existing require-await warning.
      `/private/tmp/trailbase-prep-final-{green,lint}.log`.
- [ ] Commit review follow-up, changeset and PR after preparation approval.

The original matrix terminated an idle reader after readiness. It did not cross
buffered delivery with close. This is why it missed the race; no new recovery
policy or retry loop is needed to correct reader ownership.

The follow-up review found that retiring the reader after listen() rejects must
also cancel a still-open source: parsing/writing can fail without a stream read
failure. Added an actual parse-failure test with an underlying cancel spy. RED:
zero source cancellations. The listener's handled finally now awaits cancellation
(preserving the original error on an already-errored stream) before releasing its
lock. Buffered-close, normal-close and read-error controls remain GREEN.

Final gate: 14 runtime tests and one type test pass; no type errors, lint errors,
or new warnings. RED log: /private/tmp/trailbase-processing-failure-red.log.
Final GREEN/lint logs reuse the prep-final paths above.

Adjacent pre-existing limitation, not claimed solved: erroring the stream and
calling collection.cleanup() in the same turn can still expose the unobserved
promise from cancelEventReader(). Its cancellation path is unchanged. The
reviewer also verified that an error during pending initial loading now retires
the reader before a later, settled cleanup. Do not equate that with the same-turn
cleanup case. Track the latter as a further cancellation test/fix before claiming
full termination coverage.

## Same-turn cleanup follow-up

User approved including the adjacent cancellation failure. Added the four-cell
loading/ready × close/error matrix with no microtask between stream termination
and collection cleanup. Both error cells RED, both close controls GREEN.
`/private/tmp/trailbase-same-turn-red.log`.

cancelEventReader now observes its cancellation promise, since native errored
streams reject cancellation with the original stream error. The reader is still
retired synchronously. The tests observe preload immediately, resolve delayed
loading after cleanup, and assert no unhandled rejection, no late rows, no new
fetch/subscription, an unlocked stream and cleaned-up status.

TrailBase has no dedicated fast-check/model oracle yet. Its local tests are
example/matrix integration tests. Its service-backed E2E entry runs shared
predicate, pagination, join, deduplication, collation, mutation, live-update and
progressive suites; these are not a generated lifecycle model. E2E was inspected,
not run during this preparation. A bounded future lifecycle oracle should vary
startup/list completion, event delivery, stream termination, processing failures,
cleanup and restart, with independent row/status/resource observations. Do not
add polling semantics to that model without a separate policy decision.

Full local gate: 18 runtime tests plus one type test pass; no type errors or
lint errors (one pre-existing require-await warning). Logs:
`/private/tmp/trailbase-same-turn-{green,lint}.log`. No new commit or push yet.

## Lifecycle oracle (user-approved)

- [x] Drive the actual adapter and collection with controlled subscribe/list
      promises and native streams; model visible rows independently.
- [x] Cross eager/on-demand, startup failures, delayed old-session settlements,
      row edits, graceful/buffered close, read/parse failures, cleanup and restart.
      Keep existing unit and loading-time matrices. Extract only the shared mock.
- [x] Add 32 corpus cases plus fixed and fresh-seed fast-check campaigns using
      the existing replay configuration, not a second seed parser.
- [x] New bug RED in both generated campaigns and both modes' fixed witnesses:
      old canceled subscribe rejects after restart and cancels the current reader.
      Fixed seed 714203, path 21:0:2:2; random seed -951227069, path 39:0:3:2:2:2.
      Log: /private/tmp/trailbase-oracle-first.log.
- [x] Guard canceled startup before touching shared reader ownership. GREEN.
- [x] Mutation assay: all five known stream fault variants rejected by this
      oracle itself. Logs: /private/tmp/trailbase-oracle-assay-\*.log.
- [x] 10× campaign: 800 generated histories plus 32 fixed cases pass, random
      seed 127535183. Log: /private/tmp/trailbase-oracle-stress.log.
- [x] Document laws, exclusions, replay commands and mutation evidence in
      packages/trailbase-db-collection/tests/ORACLE.md.

The gap that exposed the new bug was ownership across sessions: testing only
cleanup followed by old settlement leaves no replacement resource to corrupt.
The oracle settles old work while the next stream is live, then sends new edits.
This is a small lifecycle oracle, not complete TrailBase adapter coverage.
No polling, reconnect, pagination or mutation-confirmation policy was added.

Final local gate: 52 runtime tests plus one type test pass, no type errors.
Lint has no errors and only the existing require-await warning. Logs:
/private/tmp/trailbase-oracle-{green,lint}.log. Changes remain local, uncommitted.
