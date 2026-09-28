# GAP-04 paced-mutation oracle review

## Reviewed state and authority

- Starting head: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Initial implementation commit: `1b844588bc18e96a4c18c0de6bb1edadcad85332`.
- Reviewed implementation commit: `ccdeaa5ba61f94e7cf81930987d728769266a1cd`.
- Owner: `packages/db/tests/paced-mutations-oracle.test.ts`.
- Public authority: strategy option types, `createPacedMutations` reference, and `docs/guides/mutations.md`.

The owner uses finite virtual-clock histories over public `createPacedMutations` and the three real strategy factories. Its independent models use an appointment time, pending mutation IDs, and a plain ordered list. The tests compare immediate public Collection rows, mutation callback times and payloads, returned transaction identity, final transaction state, and `isPersisted.promise` fulfillment with the returned transaction object. A held-write history crosses the queue timer and two pending persistence promises to check serialization.

The maintainer chose the documented pacing behavior: factories preserve caller-owned options, `maxSize` overflow fails the returned transaction and rolls back its optimistic state, and explicit non-leading throttle waits for its first trailing edge. The baseline `maxSize:1` witness returned two completed and two permanently pending transactions after four calls. The baseline explicit non-leading throttle witness started at t=0 rather than the trailing edge. The follow-up oracle encoded both laws and failed on the unchanged production implementation. Omitted leading/trailing defaults remain outside the finite domain.

## Verification on the reviewed commit

- The expanded oracle passed 17 tests. The existing paced-mutation suite passed 13 tests, and the React hook suite passed 6 tests under jsdom.
- The DB package typecheck, changed-file ESLint, Prettier, and `git diff --check` passed.
- Hostile controls for queue extraction, debounce trailing, throttle leading and non-leading timing, ignored capacity, false-green overflow admission, and caller option mutation each failed their intended checker.
- A hostile cleanup control threw after an assertion failure. The result retained the assertion as `cause` and the cleanup error in `AggregateError.errors`. Collection cleanup still ran.
- The permanent capacity, non-leading throttle, and frozen-options tests failed on the unchanged baseline and pass with the repair. Capacity receipts are observed at named virtual-clock cuts so an unsettled promise produces an assertion failure rather than a test timeout.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass for documented queue order and bounded admission, explicit debounce trailing and throttle edges, optimistic rows, and persistence settlement. Omitted defaults, failed writes, and broader generated schedules remain outside this finite owner. |
| ORC-002 independent judgment | Pass. The expected trace is computed from a virtual appointment list, a quiet-period grouping rule, and a leading/trailing window rule. No pacer-lite code or production scheduler enters the model. |
| ORC-003 five responsibilities | Pass. The opening states the law and limits; `queueStarts`, `debounceStarts`, and `throttleStarts` are the model; action arrays are the finite grammar; `runProduction` is the real driver; exact trace and receipt assertions are the refinement check. |
| ORC-004 grammar controls | Bounded enumeration, not an important generated property. It reconstructs all four queue position combinations, zero queue wait, queue capacity zero/one with waiting and in-flight writes, debounce reset, both throttle edge forms, and held queue settlement. Distinct IDs isolate queue admission; a focused same-key witness checks that overflow rollback leaves an admitted update intact through first-write settlement. Negative waits and broader capacities are outside the claimed grammar. |
| ORC-005 path and observation | Pass. Real strategy instances drive the public manager and Collection; callback times and payloads, public rows, returned transaction identity/state, and persistence receipts are observed at virtual-clock cuts. Rejected receipts carry `QueueCapacityExceededError`; admitted same-key state survives the preceding write's settlement. |
| ORC-006 checker calibration | Pass for hostile queue extraction, disabled debounce trailing, disabled throttle leading, early non-leading throttle, ignored capacity, false-green overflow admission, and caller-option mutation controls. Each reaches and fails its corresponding checker. |
| ORC-007 fixed/random campaigns | Not triggered: this owner is bounded finite enumeration, not an important generated property. |
| ORC-008 model minimality | Pass. The queue's ready-list order distinguishes later extraction; due time distinguishes a call before/after eligibility. Debounce pending IDs and quiet-period due distinguish which transaction persists and when. Throttle pending IDs and next edge distinguish merged trailing output from a fresh leading call. |
| ORC-009 vocabulary mapping | Pass. The opening maps model pending IDs, ready list, and due appointment to production concepts without importing their implementation. It uses the glossary terms optimistic transaction and settlement. |
| ORC-010 failure fidelity | Pass. The driver compares the complete trace before cleanup. `withCleanup` stops strategy timers and cleans the Collection. When comparison and cleanup both fail, it retains the comparison as the cause and reports cleanup errors separately. A hostile cleanup test checks both errors and Collection cleanup. No shrinking or external capture occurs. |
| ORC-011 second formulation | Not triggered for the documented finite schedule laws: the model's appointment/list formulation differs from pacer-lite's timers and promise chain, and no named shared semantic fault has a meaningful second formulation. Broader capacities and schedules remain open. |

ORC-012 is this versioned record, tied to the reviewed implementation commit and the coverage-map owner. The sampled finite histories do not prove every legal schedule.

## Review and loss audit

The original audit accurately found absent queue option coverage and no paced-mutation oracle. It correctly rejected a pacer-lite differential as permanent authority. It missed the pending transaction on queue rejection and the early non-leading throttle start. Hire recommendation: hire for issue discovery with a reproduction and contract-authority gate; good signal and prioritization, incomplete edge/settlement analysis.

The source ledger has six claims. GAP04-1, GAP04-3, and GAP04-4 are fixed for the finite domain described above, including bounded capacity and hostile capacity controls. GAP04-2 has a maintainer decision and a tested implementation. GAP04-5 is accepted and implemented: the copied pacer-lite differential is not the oracle. GAP04-6 is deferred to the proposed MUT-05 replacement. The source claims stay distinct in the task-local ledger.

The follow-up review found two oracle gaps: the same-key witness did not observe the admitted update after the first write settled, and direct receipt awaits could hang before cleanup. Both were fixed by holding writes across a settlement cut and recording receipt outcomes before asserting them. A simplifier removed a duplicate queue transaction reference; a separate non-leading timer remains necessary because pacer-lite 0.2.1 measures its first wait from epoch zero.
