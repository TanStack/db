# Candidate: paced-mutation admission, scheduled work, cleanup, and settlement

Proposed organization of existing obligations; not an adopted contract change. Source pointers are relative to the supplied `clean-input` packet. No obligation below is retired. Statements attributed to public documentation remain obligations even where the current oracle has no witness.

## A. Admission and optimistic isolation

A call applies its optimistic mutation immediately and returns its transaction. Queue calls receive separate transactions; debounce/throttle calls share the pending transaction until its execution begins. A rejected call fails its returned transaction, rejects its settlement promise with the applicable reason, and removes only that call's optimistic contribution. Previously admitted same-key work remains intact.

Queue capacity limits waiting items, not every transaction awaiting settlement. Admission precedes processing: `maxSize: 0` rejects the first call too. Overflow uses `QueueCapacityExceededError`. Queue cleanup closes admission; a later paced call uses `QueueDisposedError`, rolls back, and never starts persistence. Direct execution on the disposed queue rejects new callbacks by throwing with the disposal message `Queue has been cleaned up`. Repeated queue cleanup preserves these effects.

Debounce/throttle calls skipped with trailing execution disabled use `DebounceCallDroppedError` or `ThrottleCallDroppedError`. With both edges disabled, every call fails. A later valid call after a leading-only window can still execute. A custom queue may return `void` while retaining its callback; a custom batch may return `false` while retaining its callback. Those returns do not reject their transactions or establish settlement.

Sources: `docs/guides/mutations.md:1097–1101,1148–1155,1198–1207,1253–1268`; `docs/reference/interfaces/BaseStrategy.md:53–81`; `packages/db/src/strategies/types.ts:48–72`; `packages/db/tests/paced-mutations-oracle.test.ts:519–721,849–923,1148–1386`.

## B. Scheduled attempts and transaction boundaries

Queue attempts preserve the configured front/back insertion and removal order, with FIFO defaults. Every admitted mutation is attempted independently. The first scheduled item is immediate; the configured wait spaces later queue processing. Persistence itself is serial: each earlier transaction settles before the next starts. Already scheduled work can wait behind a held transaction; releasing it can let several immediately successful transactions start at the same clock time. Queue wait is therefore not an additional minimum delay between all handler starts after a backlog.

Debounce collects mutations until the quiet edge after the last call and persists their final merged state. Its default is non-leading with trailing execution; omitted `trailing` remains enabled with explicit `leading`. A leading execution and a later pending trailing transaction are distinct transactions.

Throttle keeps its configured leading/trailing edges and minimum execution spacing. Both omitted options enable both edges. Explicit `trailing: true` with omitted `leading` is non-leading; `leading: false` with omitted `trailing` is also non-leading. With `trailing: false`, omitted `leading` enables leading execution. A non-leading first call waits for its trailing edge; subsequent calls in that window share the pending transaction. An eligible first leading call executes even at clock epoch zero.

Strategy factories do not mutate caller-owned options, including frozen options. Debounce drop classification uses the trailing option captured at construction; subsequently changing the caller's option does not change it.

**Retained unresolved interaction:** the public guide also promises at most one pending and one persisting debounce/throttle transaction at a time (`mutations.md:1099`). Preserve this declared concurrency bound. Its interaction with an execution edge reached while an earlier handler remains pending is not settled by the current oracle; this candidate supplies no precedence rule or permission to discard either promise.

Sources: `docs/guides/mutations.md:1097–1213,1253–1268`; strategy reference pages; `packages/db/tests/paced-mutations-oracle.test.ts:78–202,369–485,802–847,925–1146,1388–1440`.

## C. Cleanup preserves admitted work without awaiting it

Built-in strategy cleanup preserves already admitted scheduled persistence. Queue cleanup closes new admission and drains waiting work in queue order at its configured pace, behind prior transactions. Throttle retains its pending trailing edge. Debounce retains the quiet edge measured from its last call, including a pending transaction after a leading execution. Cleanup does not flush early, cancel these transactions, fulfill their promises early, or wait for their settlement. Pending transactions and promises remain pending before their scheduled execution.

These admitted callbacks still run after separate Collection cleanup, as covered by the existing queue, debounce, and throttle witnesses. Strategy cleanup and Collection cleanup are distinct operations. Callers await the returned transactions when teardown requires settlement; they retain an external client needed by an admitted write until that write settles. The base strategy's resource-cleanup obligation remains; its `void` return does not promise a synchronous persistence drain or prove that every resource has already been released.

New debounce/throttle calls after cleanup have no defined admission guarantee. Callers stop invoking the mutation function when the strategy is no longer needed. This absence of a guarantee is not a queue-style rejection promise. Custom strategy cleanup is not assigned the built-in drain policy by this candidate.

Sources: `docs/reference/interfaces/BaseStrategy.md:36–49`; `docs/guides/mutations.md:1155,1207,1213–1214`; `docs/contributing/glossary.md` cleanup/settlement entries; `packages/db/tests/paced-mutations-oracle.test.ts:488–517,722–847,951–1060`.

## D. Settlement reports the transaction's outcome

Admission, execution, cleanup return, and transaction settlement are different checkpoints. At a successful transaction-settlement boundary, the transaction becomes `completed`, its visible state is recomputed under the optimistic-settlement contract, and its settlement promise fulfills with that same transaction. Failure yields `failed`, rolls back its optimistic state, and rejects with the original error, or `undefined` for rollback without an error. Settlement does not establish backend confirmation unless the handler awaited that confirmation.

Queue persistence failures are not automatically retried. Subsequent admitted transactions continue; the queue is not an all-or-nothing transaction. These public failure obligations remain even though failed persistence is outside the paced oracle's current grammar. Pending admitted work must not be left with a permanently pending receipt merely because cleanup occurred; completion still depends on time advancing and the handler settling.

Use `when('settled')` for the public contract. The existing oracle observes deprecated pre-RC `isPersisted.promise`; retain its identity, pending, fulfillment, rejection, and named-error checks during any API migration.

Sources: `docs/guides/mutations.md:245–276,1261–1268`; `docs/reference/functions/queueStrategy.md` error behavior; `packages/db/tests/optimistic-history-oracle.ts:11–86`; paced oracle receipt observations and assertions.

## Evidence boundary retained

The current owner uses finite virtual-clock histories through `createPacedMutations`, distinct positive IDs plus focused same-row witnesses, queue waits zero/positive, positive debounce/throttle waits, and forward-only time. It checks immediate optimistic rows, grouping/transaction identity, ordered starts and recorded times, transaction states, receipt outcomes, and cleanup cuts. Capacity witnesses are zero/one. Held writes establish queue serialization. Broader capacities/schedules, failed persistence, and new debounce/throttle admission after cleanup remain open; public API receipt migration and held debounce/throttle concurrency need receiving evidence. This is not universal proof, backend/resource-release evidence, or cross-framework evidence.

Keep harness cleanup separate from product cleanup: preserve the original mismatch, report secondary cleanup failures distinctly, and attempt every resource release. Retain existing calibration controls for ordering, edges, capacity/overflow settlement, and option mutation.

Sources: `docs/contributing/oracle-coverage.md:58,245`; paced oracle opening, `withCleanup`, finite cases, and calibration tests; `docs/contributing/oracle-tests.md` ORC-005/006/010.
