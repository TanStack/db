# TrailBase stream termination

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
