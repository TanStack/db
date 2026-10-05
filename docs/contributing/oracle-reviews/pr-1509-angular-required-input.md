# PR #1509: Angular required input review

Reviewed source: [PR #1509](https://github.com/TanStack/db/pull/1509) body,
diff, and inline comments (none). Main baseline:
`ae2eb3fbf3a314a7f043f0d963fd336d8c1f1ec8`. Independent repair commit:
`9ed03a10ce2aec780dbf4072fa16e5eaad75db82`. The repair was tested in an
isolated worktree; the PR branch was not changed.

## Reviewer assessment

The author found a real Angular lifecycle bug and supplied the right component
shape to expose it. The proposal also combined a test-runner replacement,
cleanup rewrite, and timing-helper rewrite with that bug. `linkedSignal` would
exclude the package's declared Angular 16 peer range. Accuracy on the central
finding is strong; fix scope and compatibility judgment are mixed. One PR is
insufficient evidence for a hiring recommendation.

## Lossless finding ledger

| ID | Original claim or proposal | Evidence and verdict | Action and durable destination |
| --- | --- | --- | --- |
| P1509-01 | Eager derived-collection read breaks required signal inputs. | **Confirmed.** The original code threw NG0950 during component field initialization, before input assignment. | **Fixed now.** Lazy status read in the repair commit. |
| P1509-02 | Compiled Angular test setup is needed for a component witness. | A JIT component with the AOT-equivalent signal-input flag reaches the same runtime boundary; AOT compilation remains untested. | **Deferred.** The larger compiler/test-runner setup stays in PR #1509 as a separate test-infrastructure proposal. |
| P1509-03 | A required-input regression test should prove initial and reactive results. | **Confirmed.** The final test throws NG0950 on baseline; after repair, initial input 30 renders one row (`b`) and changed input 10 renders two (`a`,`b`). | **Fixed now.** Angular conformance driver and coverage map. |
| P1509-04 | Replace status with `linkedSignal` reading `untracked(collection)`. | It may defer the read on Angular 20, but `linkedSignal` is unavailable at the declared Angular 16 minimum. The two collection reads are unnecessary. | **Refuted as a compatible fix.** The repair uses supported `signal` and `computed` primitives. |
| P1509-05 | Remove external cleanup and rely only on effect cleanup. | No cleanup failure was reported or reproduced. Existing unsubscribe cleanup clears its handle before repeated calls; unmount conformance remains green. | **Deferred.** Separate simplification candidate in PR #1509. |
| P1509-06 | Replace timeout waits with Angular stability checks. | The existing helper waits 0 and 50 ms; the proposal is plausible, but no failing schedule was supplied. | **Deferred.** Angular test-helper proposal in PR #1509. |
| P1509-07 | The original PR passed `pnpm test` locally. | Historical claim not replayed at that PR head. Current repair passes the full Angular suite, type checks, and package build. | **Deferred.** Historical evidence remains with PR #1509; no current-main inference. |

Loss audit: seven claims in the raw body and no inline review comments. Totals:
two fixed now, four deferred, one refuted. All seven have a destination. No
behavioral claim from the PR diff or checklist is silently omitted.

## Reproduction and calibration

The production driver is `TestBed.createComponent` with an `input.required()`
field and the public `injectLiveQuery({ params, query })` call. The JIT test
environment does not infer `input()` metadata, so the test supplies Angular's
signal-input flag and still uses `componentRef.setInput` for value assignment.
The baseline failed at `src/index.ts:219`, where status initialization called
`collection()` and reached the unassigned input. This was an assertion failure
at construction, not a timeout or setup failure. The repair defers the read.

A simpler `status = signal('idle')` repair changed immediate disabled-query
status to `idle`. A deliberate mutant that removed the lazy disabled fallback
failed the new synchronous-status check with `expected 'idle' to be 'disabled'`.
After restoring the repair, both focused checks passed. The full Angular run
reported 61 passing runtime tests, one existing todo, and no type errors; the
Angular package build and ESLint passed. Production code changed by +7/-5
lines, net +2. The extra derived status preserves immediate disabled readiness.

## Oracle guide audit and limits

- ORC-001: Angular assigns required inputs after construction; the public
  reactive-query API must defer reading them. The test also preserves existing
  synchronous disabled status. The coverage map names AOT and runtime limits.
- ORC-002 and ORC-003: Expected IDs come from a two-row array filter, separate
  from query machinery. The test comment, fixed input history, TestBed driver,
  and post-change-detection comparison keep all five responsibilities visible.
- ORC-004 and ORC-007: Inapplicable; this is a fixed two-step history, not a
  generated property or a claim about a broader grammar.
- ORC-005 and ORC-006: The public component path and exact rendered/selected
  observations ran. Baseline code and the disabled-status mutant failed at the
  intended checkpoints.
- ORC-008 and ORC-009: Inapplicable; no stateful reference model or alternate
  subsystem vocabulary was introduced.
- ORC-010: The component fixture is destroyed in `finally`; no cleanup error
  occurred. A cleanup failure could replace an earlier assertion error, so this
  fixed witness does not claim failure-preserving teardown under injected faults.
- ORC-011: No plausible shared semantic fault requires a second query
  formulation for the construction-timing law. The selected-row model checks
  values only within this bounded fixture.
- ORC-012: This record ties the claims, RED/GREEN results, guide audit, and
  bounded closure statement to the exact repair commit above.

This witness covers required input assignment before initial change detection
and one later value change in Angular 20's JIT runtime. It does not prove the
AOT compiler path, Angular 16 through 19 execution, every option overload,
or every scheduler ordering. Those are separate cells, not claims closed here.
