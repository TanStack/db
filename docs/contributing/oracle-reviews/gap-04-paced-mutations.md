# GAP-04 paced-mutation oracle review

## Reviewed state and authority

- Starting head: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Reviewed implementation commit: `1b844588bc18e96a4c18c0de6bb1edadcad85332`.
- Owner: `packages/db/tests/paced-mutations-oracle.test.ts`.
- Public authority: strategy option types, `createPacedMutations` reference, and `docs/guides/mutations.md`.

The owner uses finite virtual-clock histories over public `createPacedMutations` and the three real strategy factories. Its independent models use an appointment time, pending mutation IDs, and a plain ordered list. The tests compare immediate public Collection rows, mutation callback times and payloads, returned transaction identity, final transaction state, and `isPersisted.promise` fulfillment with the returned transaction object. A held-write history crosses the queue timer and two pending persistence promises to check serialization.

Queue `maxSize` and omitted leading/trailing defaults await maintainer decisions. The baseline `maxSize:1` witness returns two completed and two pending transactions after four calls. They remain pending after all queue timers finish. The baseline explicit non-leading throttle witness starts at t=0 where the documented trailing wait suggests t=50. Neither ambiguous law is encoded in the permanent oracle.

## Verification on the reviewed commit

- The new oracle passed 9 tests. The existing paced-mutation suite passed 13 tests in the same run.
- The DB package typecheck, changed-file ESLint, Prettier, and `git diff --check` passed.
- The three hostile strategy controls each failed the exact execution-trace checker at its intended cut. They are permanent calibration tests.
- The capacity and non-leading throttle probes failed on the unchanged baseline. They remain in the task ledger and coverage map as open decisions. The temporary tests are not in this commit.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass for documented unbounded queue order, explicit debounce trailing, explicit throttle leading/trailing, optimistic rows, and persistence settlement. Capacity, omitted defaults, caller option mutation, early non-leading throttle timing, cleanup, and failed writes are excluded pending contract decisions or separate owners. |
| ORC-002 independent judgment | Pass. The expected trace is computed from a virtual appointment list, a quiet-period grouping rule, and a leading/trailing window rule. No pacer-lite code or production scheduler enters the model. |
| ORC-003 five responsibilities | Pass. The opening states the law and limits; `queueStarts`, `debounceStarts`, and `throttleStarts` are the model; action arrays are the finite grammar; `runProduction` is the real driver; exact trace and receipt assertions are the refinement check. |
| ORC-004 grammar controls | Bounded enumeration, not an important generated property. It reconstructs all four queue position combinations, zero queue wait, debounce reset, throttle leading/trailing, and held queue settlement. Removing position, clock advance, or held write loses a distinct case. Distinct IDs avoid unrelated duplicate-admission behavior. Negative waits and repeated IDs are outside the legal/claimed grammar. |
| ORC-005 path and observation | Pass. Real strategy instances drive the public manager and Collection; callback times and payloads, public rows, returned transaction identity/state, and persistence receipts are observed at virtual-clock cuts. |
| ORC-006 checker calibration | Pass for three hostile option mutants: swapped queue extraction end, disabled debounce trailing, and disabled throttle leading each reach and fail the exact trace comparison. A capacity mutant awaits contract. |
| ORC-007 fixed/random campaigns | Not triggered: this owner is bounded finite enumeration, not an important generated property. |
| ORC-008 model minimality | Pass. The queue's ready-list order distinguishes later extraction; due time distinguishes a call before/after eligibility. Debounce pending IDs and quiet-period due distinguish which transaction persists and when. Throttle pending IDs and next edge distinguish merged trailing output from a fresh leading call. |
| ORC-009 vocabulary mapping | Pass. The opening maps model pending IDs, ready list, and due appointment to production concepts without importing their implementation. It uses the glossary terms optimistic transaction and settlement. |
| ORC-010 failure fidelity | Partial. The driver records the complete trace before cleanup. Finally blocks stop strategy timers and clean the Collection, even if strategy cleanup throws. No shrinking or external capture occurs. A cleanup throw can still supersede a pending comparison, so an oracle cleanup-failure control remains open. |
| ORC-011 second formulation | Not triggered for the documented finite schedule laws: the model's appointment/list formulation differs from pacer-lite's timers and promise chain, and no named shared semantic fault has a meaningful second formulation. Capacity/defaults remain open. |

ORC-012 is this versioned record, tied to the reviewed implementation commit and the coverage-map owner. The sampled finite histories do not prove every legal schedule. The partial ORC-010 cleanup diagnostic remains open in this owner.

## Review and loss audit

The original audit accurately found absent queue option coverage and no paced-mutation oracle. It correctly rejected a pacer-lite differential as permanent authority. It missed the pending transaction on queue rejection and the early non-leading throttle start. Hire recommendation: hire for issue discovery with a reproduction and contract-authority gate; good signal and prioritization, incomplete edge/settlement analysis.

The source ledger has six claims. GAP04-1, GAP04-3, and GAP04-4 are partly fixed by the new owner. The capacity part of GAP04-1 and GAP04-4 remains confirmed open. GAP04-2 is a design decision. GAP04-5 is accepted and implemented: the copied pacer-lite differential is not the oracle. GAP04-6 is deferred to the proposed MUT-05 replacement. The source claims stay distinct in the task-local ledger.
