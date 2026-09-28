# DEC-03 window-overlap oracle review

Reviewed semantic head: `f42fbcf4a642bc936e91309241137325c6f034e3` (branch `codex/audit-dec-03`).
Base: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
Owner: `packages/db/tests/conformance/infinite-suite.ts`, instantiated by the
React, Vue, and Svelte receiving drivers.

## Decision and boundary

The maintainer chose this rule: after a failed preload overlaps a successful
page request, `hasNextPage` follows the latest committed page count. The failed
preload's error remains visible until explicit recovery. The earlier behavior
forced continuation to `false` on the later page success. The fix recomputes
continuation in the asynchronous page-success branch.

The bounded contract is finite ordered source rows × a page size of two × a
failed initial-window preload × a successful second-page window × a public
snapshot after each settlement. Four rows distinguish exact exhaustion; five
rows distinguish a remaining row. The two settlement orders distinguish a
failure followed by success from success followed by failure. Each history also
checks explicit recovery. The model derives visible rows, page boundaries,
params, continuation, status, and error from the source length, committed page
count, and the chosen error lifetime. It does not copy the controller's
`failedHasNextPage` cache.

The production driver calls the exported DB window controller in each package
realm. It uses a real ordered live-query Collection and controls the two
`setWindow` results with Promises. It checks the exact limits 3 and 5, then
compares public snapshots at 12 checkpoints per driver. Current framework
hooks expose `fetchNextPage` but no `preload`, so this test does not establish
the same overlap through a hook. Adjacent shared scenarios retain hook paging
coverage.

## RED, GREEN, and hostile controls

On unchanged production, the new shared cell failed in React, Vue, and Svelte
at the failure-first, five-row final checkpoint: expected `hasNextPage: true`,
received `false`. This was an assertion failure on the public snapshot. After
the one-branch production change, the DB controller suite passed 75/75 and the
package-local conformance suites passed React 36/36, Vue 38/38, and Svelte
38/38. The DB build, changed-file ESLint, Prettier, and `git diff --check`
passed. Package-local Vitest configuration is required for the React and Svelte
receiving suites.

Temporary wrong-design controls were built and tested, then removed:

- Restoring the asynchronous success assignment to `false` failed at the
  five-row continuation assertion.
- Leaving the failed continuation frozen through asynchronous success failed
  at the four-row exact-exhaustion assertion (`true` versus `false`).
- Clearing the error on later success failed the earlier Error identity
  assertion (`undefined` versus the sentinel Error).

A review suggested testing an additional synchronous page-success branch. A
legal synchronous-success cell was reached by preparing the physical five-row
window first. It passed with the synchronous assignment changed back to
`false`: that mutant survived. The assignment was therefore removed from the
fix. At synchronous success, `requestPageCount` has cleared an earlier error;
a still-pending preload failure can run only after that synchronous call and
then recomputes continuation itself. The surviving mutant and execution order
make the synchronous assignment irrelevant to the reported public failure
state. This does not claim all synchronous window behavior is covered.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The maintainer selected the overlap rule. The executable contract and coverage map name the direct-controller boundary and hook limit. |
| ORC-002 independent judgment | Pass. Expected continuation comes from source length and committed page count. The model imports no production window classifier or failure cache. |
| ORC-003 visible responsibilities | Pass. The shared contract, pure expected snapshot, bounded matrix, production driver, and public comparisons are adjacent in the shared suite and its contract module. |
| ORC-004 generated grammar controls | Not applicable. The four histories are an explicit finite matrix, not a generated-history or input-grammar claim. |
| ORC-005 path and observation | Pass. The driver asserts both physical window limits and observes rows, pages, params, continuation, fetching state, status, and error after each controlled settlement and recovery. |
| ORC-006 checker calibration | Pass for the asynchronous overlap. The three controls above failed by assertion at the intended public checkpoints. The synchronous assignment mutant survived and is reported as such. |
| ORC-007 fixed/random campaigns | Not applicable. This is a bounded scenario, not an important generated property. |
| ORC-008 model minimality | Not applicable. Expected snapshots are stateless recomputation from scenario inputs; no mutable reference-model state changed. |
| ORC-009 vocabulary mapping | Pass. `pageSucceeded` represents two committed pages; `preloadFailed` represents the observable retained pagination error. The model does not represent physical lease state. |
| ORC-010 failure fidelity and cleanup | Pass. The scenario resolves both held gates in `finally`, waits for both operations, disposes the controller, and restores the spy. `ScenarioLifetime` cleans the dependent live query before its source and preserves a primary assertion if cleanup also fails. No shrinking is involved. |
| ORC-011 second formulation | Not applicable. No additional shared-fault hypothesis was identified that a second formulation would distinguish within this direct-controller boundary. Four and five rows already reject opposite wrong continuation rules. |

This record supplies ORC-012 evidence for semantic head `f42fbcf4a642bc936e91309241137325c6f034e3`.
It claims closure only for a failed initial preload overlapping an asynchronous
second-page success on finite ordered local rows at the stated checkpoints.
The coverage map retains framework hook scheduling and other acquisition
paths outside this owner; a reachable counterexample there would require a
separate witness.
