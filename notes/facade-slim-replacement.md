# Slim functional-input replacement

Status: retained checkpoint, **not merge-ready**. Baseline: `2bf4a3a4`.
The user approved distinct live views between separate functional projection
calls and asked to remove old machinery rather than add another permanent path.

## Change

- Materialize Collection-valued inputs before the functional callback through
  a continuation in the same D2 graph. Retain outputs with existing D2 reduce
  so negative weights retract the previous callback output.
- Remove `FN_SELECT_STATE`, its compiler writer, deferred materializer replay,
  and publication-time callback execution. Input descriptors are consumed
  before callback execution, not repaired on arbitrary callback output.
- Remove the previous prototype's view-to-public identity conversion. All
  functional holders may keep their live views, including classes and closures.
- Keep public rows and indexes untouched while callbacks read draft rows.
  Promotion drops the draft reader and forwards retained methods to the live
  public Collection. No temporary Collection or second graph is created.

Only one assertion family changed: updated-parent `===` across separate
functional projection calls. Expression identity, initial sharing,
unchanged-parent identity, later live rows, and all previous isolation/data
assertions remain. No test was deleted or marked expected-failure.

## Evidence

Reports have prefix `/tmp/tanstack-facade-slim-` and suffix `.json`:

| Report | Pass/fail | Scope |
| --- | ---: | --- |
| `v1` | 157/0 | Slimmed candidate before captured-method extension |
| `captured-red` | 157/1 | Captured `get` reads private retirement during a later failed callback |
| `v2` | 158/0 | Method forwarding follows promotion; retained private reader is cleared |
| `baseline` | 130/28 | Same revised oracle with all six production files restored to HEAD |
| `adjacent-final` | 370/0 | Eleven adjacent includes/facade/functional suites |
| `lifecycle` | 940/0 | Twelve lifecycle/ordered/error/window suites |

No skips in these reports. Baseline production was temporarily restored with
`apply_patch`, then the exact saved candidate was reinstalled. Baseline red
cells fail before the new later isolation assertions; the `captured-red` run,
not that baseline, proves the captured-method defect. The missing oracle
dimension was a read method retained during the callback, rather than fetching
the method anew from an already-published handle.

Adjacent/lifecycle runs used `TANSTACK_DB_ORACLE_SEED=1657011`; projection
matrices are deterministic. JSON verifies outcomes, not command environment.
Package tsc exits 2 (`/tmp/tanstack-facade-slim-types.txt`), with no diagnostic
for changed source or the projection oracle. Targeted ESLint passes except
the builder's two previously present unnecessary-condition errors at 632/838.
No full package type/lint pass is claimed.

## Size and next gates

Executable source, including the new 82-line module:
**269 added / 150 removed = +119 net lines**, versus the prior +227 candidate
(108 fewer net lines; about 48% smaller increase). Against fixed main checkpoint
`68366eca`: **5,295 added / 2,081 removed = +3,214 net lines**, 49 files.
This is not below main. No current bundle, heap, or throughput measurement.

Still required before calling the implementation complete:

- Draft read API parity: iterator/state/virtual properties, ordering, and
  indexes or subscriptions created during callback execution. Forwarding an
  unhandled method to the real facade is not proof that it sees draft rows.
- Async publication, nested continuation, failed callback/flush, cleanup and
  retry boundaries, including a view captured during failed work. The broad
  lifecycle suite does not directly cover every new continuation transition.
- Bound copying/read work and retained state; no benchmark proves current
  per-read Map reconstruction cheap enough.
- Run the queued 100x campaign after these gates, then remeasure whole-branch
  production and bundle size. Do not trade correct data for a smaller diff.

The accepted identity decision does not waive these gates or approve a new
API restriction. This checkpoint removes old code and preserves the current
bounded green tests; it is not evidence that every Collection API works on a
draft view.
