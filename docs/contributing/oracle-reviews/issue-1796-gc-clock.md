# Issue #1796: Collection GC clock review

Reviewed implementation: `39d68cd6` (base `ae2eb3fb`). This record covers the
clock correction and oracle added at that commit. The source report is
[issue #1796](https://github.com/TanStack/db/issues/1796); it had no comments
when read on 2026-09-29. The full claim ledger is retained in the task record.

## Contract and bounded result

`BaseCollectionConfig.gcTime` promises collection cleanup after the configured
number of milliseconds without active subscribers. `docs/guides/live-queries.md`
documents the live-query variant. Where `performance.now()` is available and
monotonic, moving the wall clock must not move an already scheduled GC deadline.
The Collection's normal idle callback still follows the queue deadline.

The queue now captures the Performance clock at construction and uses it for
schedule, timer selection, and processing. The previous `Date.now()` path
remains the fallback where Performance is unavailable. That fallback still
inherits backward wall-clock adjustments. Some browsers pause Performance time
through OS sleep despite the intended monotonic-clock contract; this review did
not test suspend/resume and does not claim sleep-inclusive GC timing.

## RED and GREEN

With the new oracle on unmodified `ae2eb3fb`, both the fixed-seed and random
campaign failed. The smallest shrink was a zero-delay appointment followed by
a one-millisecond backward wall-clock step: delivery occurred at elapsed time
one instead of zero. The public live-query fixture likewise retained one source
subscriber ten elapsed milliseconds after a one-millisecond GC appointment and
a 1,000-millisecond backward step. The source subscriber count was `1`; the
contractual count was `0`.

At `39d68cd6`, the same two suites pass. The focused cleanup/restart and
Collection lifecycle suites also pass: 98 tests across four files, no Vitest
type errors. `pnpm --filter @tanstack/db build` succeeds. The production change
is five added lines and three removed lines: net **+2**. Tests and coverage
documentation are counted separately.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The elapsed GC law comes from `BaseCollectionConfig.gcTime`; this review limits the clock-step claim to runtimes with monotonic Performance time. |
| ORC-002 | The reference stores elapsed appointments. It never imports the queue's deadline or reads its chosen clock. |
| ORC-003 | The queue oracle names the contract, pure appointment model, action grammar, real queue driver, and callback-delivery comparison. The focused Collection test observes source subscription ownership. |
| ORC-004 | Fixed histories reconstruct backward delay and forward early-delivery risks. Removing wall-step actions loses both. Delays are integers 0–20 ms; steps are integers −1000–1000 ms. Invalid non-positive/non-finite Collection `gcTime` is excluded because lifecycle disables GC for it. |
| ORC-005 | The driver calls the real `CleanupQueue`; the integration witness calls public Collection and live-query APIs and compares `source.subscriberCount` after elapsed GC. |
| ORC-006 | Unmodified `ae2eb3fb` is the hostile wall-clock design and fails at delivery/subscriber observations. Existing cancel, replacement, duplicate, and late controls remain green only when their deliberate faults are rejected. |
| ORC-007 | The same 100-run property executes with fixed seed `20260913` and a seedless random lane. `oraclePropertyOptions` accepts seed and shrink path for direct replay. |
| ORC-008 | No reference state was added: a wall step leaves elapsed appointments unchanged. A later elapsed advance distinguishes due from pending appointments. |
| ORC-009 | Model `now` is elapsed time; `wallClockOffset` is a driver-only correction used to record elapsed callback time from Vitest's fake Date. Neither is a Collection lifecycle state. |
| ORC-010 | The oracle resets its singleton, timers, error spy, and real timers in `finally`. The public fixture explicitly cleans both Collections and restores timers. The recorded RED assertion was observed before cleanup and was not replaced by a cleanup failure. |
| ORC-011 | The public source-subscriber witness is a second formulation of the queue delivery law. It does not copy the queue's appointment model. |
| ORC-012 | This record ties the bounded evidence and limits to implementation commit `39d68cd6`. |

## Limits and next owner

The queue oracle covers bounded appointment histories, including cancellation
and replacement around wall steps. Callback-reentrant scheduling remains with
`packages/db/tests/cleanup-queue.property.test.ts` as an omitted grammar axis.
Suspend/resume behavior and runtimes without `performance.now()` also remain
with that owner. The focused live-query test covers one eager source, one live
query, and source subscription release after GC; it does not prove React render
or unmount scheduling.
