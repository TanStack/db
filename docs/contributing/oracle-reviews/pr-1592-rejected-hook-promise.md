# PR #1592: rejected retry-hook Promise review

## Scope and authority

- Independent oracle-review challenge: PR head
  `1ec6a92d76a0b71727d1c30998b804b53bc11ed7`. The reviewer read the
  oracle, public contract, glossary, coverage map, and instruments, ran the
  51-case settlement oracle and a direct replay, and probed the executor.
- Oracle-first repair: `057daa796fc079080fdfcf25cd15ba33dffe658f`.
- Production repair reviewed here:
  `9f257e03b5ce83202f76580b482e9f54b81d7003`.
- Primary owner:
  `packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts`.

The README, guide, and package skill promise that `shouldRetry` returns a
synchronous decision. A Promise is invalid and fails only its outbox row. After
acknowledged deletion, queued rows continue. A Promise rejected by an async
hook must therefore not escape as an unhandled process rejection. The same
sources promise that a non-`Error` named mutation rejection is converted to an
`Error` before the hook runs. These are bounded contract claims, not a new
async retry API or a promise that the original non-`Error` fields survive.

## Finding, witness, and repair

At the challenged head, a direct Node 24 probe called the real executor with
an async hook returning a rejected Promise. The row was removed and its caller
received the invalid-return `TypeError`, but an `unhandledRejection` listener
received the async error. Without that listener, the Node process exited 1
after removal. The old oracle used only `Promise.resolve(true)`, so its history
grammar could not produce this failure or observe the process event.

The repaired oracle crosses a fulfilling and immediately rejecting Promise at
the public `commit()` and restart path. A second case returns a pending Promise,
holds deletion, admits two peers, completes them in FIFO order, then rejects the
Promise. Its Node process listener must remain empty after a macrotask. The
public commit, outbox, provider-call, and Collection checks still judge the
row-local failure at their existing cuts. Two neighboring histories reject a
string or status-bearing object from the named mutation function and check the
hook's converted `Error`, retry count zero, terminal caller identity, outbox
deletion, and optimistic rollback.

The production repair observes any invalid returned value with
`Promise.resolve(decision).catch(...)` before throwing the invalid-return
`TypeError`. It does not await that value or change the terminal decision. The
one-line operation also assimilates thenables, though the executable witnesses
use native Promises.

## Executed calibration and checks

| Subject | History and result | Classification |
| --- | --- | --- |
| Original executor at `1ec6a92d7` with immediate rejected-Promise oracle | Public caller and deletion checks passed; `unhandled` contained the async error at the asserted cut. | Assertion failure at intended observation. |
| Temporary removal of the rejection observer from the repaired executor | Immediate and held-late Promise cases both found the async error in `unhandled`; the late case failed after queued peers settled. The edit was restored. | Assertion failures at intended observations. |
| Temporary bypass of `toError` at the named mutation rejection boundary | Both non-`Error` cases reached the hook and failed its `Error` assertion. The edit was restored. | Assertion failures at intended observation. |
| Temporary `await` of the hook return | The held Promise prevented terminal deletion until the oracle checkpoint timed out; cleanup released that test-owned Promise. The edit was restored. | Timeout exposing a progress violation, not an assertion kill. |
| Repaired executor at `9f257e03b` | Settlement oracle 55/55; package tests 221/221 across 17 files excluding the separate uncommitted leadership draft; typecheck, ESLint, Prettier, and diff checks passed. | GREEN within stated scope. |

The independent reviewer then challenged the new tests twice. The first pass
found missing pending-waiter cleanup in the non-`Error` case and an unsupported
claim about late rejection. The repair records and rejects a pending waiter in
`finally`, awaits its observed promise, and uses a held Promise released only
after peer settlement. The second pass found that an await-the-hook mutant
could leave that held Promise unresolved after a timeout. Cleanup now attaches
a cleanup-only rejection handler and releases it while preserving the primary
checkpoint failure. The reviewer made no source edits.

## Oracle guide audit

| Requirement | Result |
| --- | --- |
| ORC-001 authority and limits | Pass. Public retry docs authorize synchronous, row-local failure and conversion of non-`Error` rejection. Node process observation is the claimed host boundary. |
| ORC-002 independent judgment | Pass. Expected outcomes follow from the public row-local contract and Error input rule; neither calls the executor's retry classifier. |
| ORC-003 literate responsibilities | Pass. Opening law and local prose identify the model relation, legal immediate/delayed histories, real public driver, observations, and checkpoints. |
| ORC-004 grammar controls | Pass for the finite extension: fulfilled versus rejected native Promise, immediate versus held-late rejection, and primitive versus status-bearing object provider rejection. Generic thenables remain outside these fixtures. |
| ORC-005 path and observation | Pass. Public `commit()` drives the executor and outbox. The listener observes Node's process event; the held case checks FIFO peers before releasing the Promise. |
| ORC-006 calibration | Pass. Removing rejection observation and bypassing Error conversion fail their intended assertions. Awaiting the held Promise times out and is classified separately. |
| ORC-007 fixed/random replay | The new cases are fixed histories, so this trigger does not apply to them. The unchanged generated retry matrix still runs fixed-seed and seedless campaigns with direct replay support. |
| ORC-008 model-state minimality | Not triggered: no reference-model state was added or removed. |
| ORC-009 vocabulary | Pass. Outbox row, queued peer, offline executor restart, and observation checkpoint retain glossary meanings; `unhandled` is a test observation list. |
| ORC-010 failure fidelity | Pass. The non-`Error` case settles a pending waiter during cleanup. The held case releases storage gates and a pending test-owned Promise after a primary failure; cleanup diagnostics remain separate. |
| ORC-011 second formulation | Not triggered: no plausible fault shared by both a model and production classifier was identified for this process-event law. |
| ORC-012 review evidence | This record names reviewed executable revisions, required outcomes, hostile controls, and scope limits. |
| ORC-013 boundary witness | Pass for the bounded law. Immediate rejection and rejection after peer settlement both distinguish observed from escaped Promise failure. Converted-error cases distinguish hook input from raw non-`Error` values. |
| ORC-014 controlled-premise handoff | No browser-host claim is made. Node's process event is observed directly; storage and provider effects remain controlled fixtures. |

## Remaining limits

The rejected-Promise cases cover a native Promise that rejects immediately or
after two queued peers settle in a Node-hosted Vitest run. They do not establish
browser `unhandledrejection` behavior, every third-party thenable, a rejection
after executor disposal, or native power-loss durability. The settlement owner
can add those histories if a broader cross-host or thenable claim is needed.
The status-bearing object case checks conversion to `Error`, not preservation
or removal of its custom fields. No reachable in-scope counterexample remains
for the bounded histories above.
