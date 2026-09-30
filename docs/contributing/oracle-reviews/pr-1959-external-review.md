# PR #1959 external review

Reviewed executable head: `f82832a157ab5cf73c9ac3347082810671ab3574`.
The review source was the `#1959` section of `pr-reviews-1956-1961.md`.
Its captured section has SHA-256
`ee763757a29b41c9835fe4981c72165e6e8bff9850bf4d4b2e20472c3db49d0f`.
The task-local lossless ledger keeps the eight original claims in source order.

## Reviewer assessment

The reviewer correctly identified the scheduler's bounded output behavior and
the quadratic reverse-registration case. It also found a literal duplicated
guard. Its proposed removal of `step()` missed an exported public method with
distinct one-pass behavior. The analysis has useful local depth, but its only
API-affecting suggestion would break consumers. The two cleanup findings have
low action value for this PR. Do not use this review as the sole library API
review; it is useful as supporting review when the public type and built output
are checked separately.

## Source-order ledger

| ID | Claim | Evidence and verdict | PR action | Durable value |
| --- | --- | --- | --- | --- |
| R1959-001 | Built-in operators do no observable work without queued input; gating preserves behavior. | `Operator.hasPendingWork()` reads input queues. Built-in `run()` paths consume those queues; empty inputs change no output or retained state. True for built-ins. | Already satisfied; keep the scheduler. | The D2 work oracle owns the bounded work law. |
| R1959-002 | The new multi-pass loop reaches the old scheduler's fixpoint. | A direct 5/10/20-operator probe produced the same exact output with both schedulers in forward and reverse registration order. True within that domain. | Already satisfied. | The D2 work oracle retains the reverse-order witness. |
| R1959-003 | The two production `db` callers guard `run()` and cannot hit the new empty unfinalized throw. | `effect.ts:498` and `collection-config-builder.ts:994` finalize before use. Both call sites check `pendingWork()` before `run()`. True for these paths. | Already satisfied. | The caller boundary remains visible in this record. |
| R1959-004 | The oracle is independent and sound. | Its expected call counts come from a per-branch input ledger, and it checks exact forwarded messages after each `run()`. The old loop failed with 64 idle calls. Sound for the stated bounded law. | Already satisfied. | The coverage map records topology and latency limits. |
| R1959-005 | `step()` is dead and should leave `D2` and `ID2`. | No in-repo call remains, but `index.ts` exports both types, built declarations expose `step()`, and built JS contains it. An idle finalized graph runs its operator once through `step()` and zero times through `run()`. The dead-code claim is false. | Preserve the public method and interface. | This record preserves its distinct one-pass behavior. |
| R1959-006 | Extract the duplicated finalized guard into a helper. | The two three-line guards are identical. A braced helper plus two calls adds one production line and an indirection, with no current drift. The duplication is real; the proposed edit has no demonstrated benefit now. | Defer until a D2 API or invariant edit. | Reconsider this local cleanup with that edit. |
| R1959-007 | Reverse registration remains quadratic, as before. | For 5/10/20 operators, new `run()` made 30/110/420 pending checks and 5/10/20 operator calls. The old loop made 20/65/230 checks and 25/100/400 calls. Both check counts grow quadratically, and exact output matched. | Already understood; no latency claim. | The coverage map excludes arbitrary topology and elapsed latency. |
| R1959-008 | Standard `pipe()` chains register forward and take two scan passes. | `StreamBuilder.pipe()` applies operators in call order. A 5/10/20-operator forward chain took 10/20/40 checks, one active pass and one quiet pass. This does not characterize every valid graph. | Already satisfied; keep reverse-order support. | The oracle retains one valid reversed pair. |

## Oracle guide review

| Requirement | Outcome at the reviewed executable head |
| --- | --- |
| ORC-001 | The selected work law comes from PR #1645's scheduler proposal. The test and coverage map limit it to D2 operator calls, exact output, and named graph shapes. |
| ORC-002 | Expected calls follow test-owned direct inputs and branch positions, not production `hasPendingWork()` or its scheduling branches. |
| ORC-003 | The opening contract, input ledger, finite positions and two-turn history, real `D2.run()` driver, and exact checkpoint assertions remain distinguishable in one file. |
| ORC-004 | Not applicable: the three positions are fixed cases, not a generated-history claim. |
| ORC-005 | The driver calls `D2.run()` and compares exact messages and operator counts after each call. The original implementation reached and failed that comparison. |
| ORC-006 | The original unconditional scheduler is the hostile design. It failed with 64 idle operator calls at the intended checkpoint. |
| ORC-007 | Not applicable: this is a fixed bounded oracle, not an important generated property. |
| ORC-008 | The expected-call array retains the first turn's count for the second turn. Removing that state would misjudge the prior active branch after the next input. |
| ORC-009 | The test calls its reference a per-branch input ledger. It maps direct sent messages to expected operator calls; it does not claim to model production queues. |
| ORC-010 | Not applicable: the test has no shrinking, external resources, or cleanup path that can replace a failure. |
| ORC-011 | No second semantic formulation is required for this bounded work law. The test checks exact forwarded output separately from call counts. |
| ORC-012 | This record names each applicable result and limit at the exact reviewed executable head. It makes no general latency or arbitrary-topology claim. |

## Loss audit

The source contains four opening assessments, two numbered cleanup findings,
and two parts of the non-defect note. All eight have a source-order ledger item:
six already satisfied, one refuted, and one deferred. No item lacks evidence.
The public `step()` method stays in the PR. The only unresolved idea is the
optional guard helper, owned by this record for a later D2 API edit.
