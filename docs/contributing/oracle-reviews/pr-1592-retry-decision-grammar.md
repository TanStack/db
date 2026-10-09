# PR #1592: retry decision grammar review

## Reviewed executable state and law

- Reviewed executable commit: `d283256048628e8a8aabd6e0b0dac0f9d8108638`.
- Production subject at that commit: `760e54204541f260be34f0e93087e9598cb769b6`; the two intervening commits change only the settlement oracle and coverage map.
- Primary owner: `packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`.
- Review method: self-review under the oracle guide and mutant gap hunt. No independent reviewer is claimed.

The accepted `shouldRetry` law has three valid answers. `true` retries, `false`
terminates, and `undefined` delegates to the existing default decision. An
omitted hook also delegates. `NonRetriableError` bypasses the hook. A thrown
hook error or any other return value fails that outbox row. The maintainer's
earlier row-local decision authorizes terminal removal; this repair does not
change that product policy. The default policy's current AbortError and message
classifications are preservation controls, not a general HTTP status policy.

The old seven-case table already included ordinary error plus `false`, so it
could reject a false-as-delegation mutant. It omitted the opposite override,
AbortError, several default message classes, and Promise results. A null result
already had public `commit()` and cleanup witnesses. The first expansion still
missed later fixed examples because fast-check counted examples against its
12-run budget. Status mutants for 400, 403, 422, and 404 survived that first
expansion. The executable repair reserves 33 fixed runs before 12 generated
runs in each normal campaign, then asserts that all 32 error/answer cells ran.

## Executed controls

The final model crosses eight fixture error kinds with four hook answers. It
checks the first stored retry record or acknowledged terminal deletion, exact
outbox IDs and retry counts, caller promises, provider calls, and Collection
rows. A separate public hook-fault driver crosses throw, null, zero, and
Promise results and checks the first terminal marker against a retry record.
The fixed matrix uses one FIFO peer, one additional auth case uses three, and
the generated runs vary peer count from one to three. A later-failure witness
checks retry count one. The controlled storage does not establish native
durability, real timer accuracy, or provider idempotency.

On the reviewed executable commit, the settlement oracle passed 51 of 51
tests; package typecheck, test-file ESLint, Prettier, and `git diff --check`
passed. The following temporary mutants were restored after their runs:

| Mutant | Distinguishing history | Outcome |
| --- | --- | --- |
| Treat `false` as `undefined` | ordinary error, explicit terminal answer | Assertion failure: stored `retry` versus expected `terminal`. |
| Await a Promise hook result | 401 error, Promise of `true` | Assertion failure: stored `retry` versus expected `terminal`. |
| Retry AbortError by default | AbortError, delegated answer | Assertion failure at stored decision. |
| Retry 400 by default | 400 message, delegated answer | Assertion failure at stored decision. |
| Retry 403 by default | 403 message, delegated answer | Assertion failure at stored decision. |
| Retry 422 by default | 422 message, delegated answer | Assertion failure at stored decision. |
| Terminate 404 by default | 404 message, delegated answer | Assertion failure at stored decision. |
| Restore the old 12-run budget | Normal campaign | Reach assertion failure: 12 observed cells versus 32 declared cells. |

The first run of the 400/403/422/404 mutants **survived** before the budget
repair. They are not counted as kills from that version. All reported kills
above reached assertions after the final budget repair; none was a timeout,
setup failure, or unreached edit. Direct replay of the false-as-delegation
mutant with seed `-1799994628` and path `5` reproduced the same ordinary/false
comparison on the reviewed executable commit.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Pass. The README, type contract, approved row-local decision, and existing default behavior support the bounded law above. HTTP status meaning, native storage, timers, and provider effects remain outside it. |
| ORC-002 independent judgment | Pass. The expected decision is a declarative truth table and three-answer rule. It does not call the production retry classifier. The provider-error helper only constructs fixture inputs. |
| ORC-003 distinguishable responsibilities | Pass. Opening prose states the law; local prose accompanies the model, 32-cell grammar, public driver, and stored-decision comparison. |
| ORC-004 grammar controls | Pass. Fixed examples reconstruct every error/answer cell; the reach assertion fails if the campaign budget excludes one. The two explicit answers, delegation, omission, permanent bypass, error classes, and peer-count variation each have a stated role. The nearby invalid null, zero, and Promise answers belong to the separate fault grammar; duplicate IDs and storage failures remain separate owners/cuts. |
| ORC-005 path and observation | Pass. Public transactions call `commit()` through the real executor, outbox, scheduler, and Collection. The first durable decision is compared before later peer progress can hide it. |
| ORC-006 checker calibration | Pass. The temporary wrong designs in the table fail at their intended stored-decision or reach assertion. Initial survivors are recorded separately. |
| ORC-007 fixed/random replay | Pass. Both normal campaigns run the same property for 45 cases, one fixed seed and one seedless. Seed/path replay reproduced the false-as-delegation comparison directly. |
| ORC-008 state minimality | Not triggered. The new decision table is stateless; no reference-model state was added or merged. |
| ORC-009 vocabulary mapping | Pass. Fixture-only error-kind labels select Error instances; `storedDecision` projects the retry-record or terminal-deletion observation and is not a production state. Outbox phases retain glossary terms. |
| ORC-010 failure fidelity | Pass. The new comparison fails before peer waits on a wrong decision. Existing `finally` cleanup releases provider gates and preserves the primary assertion; direct replay reproduced it. |
| ORC-011 second formulation | Not triggered for the optional hook law: no distinct shared semantic fault was established. The generic 404 policy remains a separate design question, not an expected result inferred from this hook oracle. |
| ORC-012 review evidence | This versioned record names the executable commit, scope, controls, applicable outcomes, and remaining limits. It follows the executable commits. |
| ORC-013 boundary witness | Pass. Ordinary/false distinguishes terminal override from delegation, auth/true distinguishes retry override from the default, and 404/defer distinguishes the default retry branch from the adjacent terminal message cases. The Promise witness distinguishes synchronous validation from awaiting. |
| ORC-014 controlled-premise handoff | No native-host claim is made. Fake storage controls the durable decision cut; real IndexedDB completion remains separate receiving work. |

## Remaining scope

The table is exhaustive only for its eight error fixtures and four hook
answers. It does not prove every string matching edge case in the default
policy, every retry count, or every interleaving. The existing second-error
witness covers count one; the row-local cleanup matrices cover peer admission
and storage failures. The coverage map keeps native storage and broader offline
recovery limits with their owners and RFC #1659.

## Final production follow-up

The production and documentation follow-up executable commit is
`c4cd2dd8de085a8cc1680f7eb8bc8a67b740428e`. It keeps the retry decision
law and the oracle unchanged. The settlement oracle passed 51/51 cases. A
package run excluding the separate uncommitted leadership/FIFO experiment
passed 217 tests in 17 files; package typecheck, source and oracle ESLint,
Prettier, and diff checks passed.

The false-as-delegation, Promise-await, AbortError, 400, 403, 422, and 404
temporary mutants were rerun on that executable commit. Each failed at the
stored-decision assertion. Direct seed/path replay again reached the
ordinary/false assertion. The temporary source edits were restored exactly;
none of these results relies on a timeout or a setup error. No later executable
change is part of this record.
