# PR #2062 external review audit

Reviewed product commit: `39721f20f4a3daa597a81c5172edf0109a4d83c1`.
Base: `9e8ed997885fb46ac98ec85906f4ca4f662e7cce`.
The source review supplied ten findings from code reading and no executed
reproduction. This record evaluates those claims against the reviewed commit
and the follow-up changes in this PR. Each source-order finding is recorded
below.

## Finding dispositions

| ID | Claim | Evidence and verdict | PR action and durable value |
| --- | --- | --- | --- |
| U1 | A synchronous scheduler callback throw leaves persistence stuck. | Confirmed. The direct serial-pacer witness failed with no second start (`[]` instead of `[2]`). A public manual-commit fault probe also left its next transaction pending on the reviewed commit. | **fixed-now**: reset scheduler activity, retain any reentrant pending callback, and rethrow the original error. Two direct throw histories now pass. |
| U2 | Manually committing a returned paced transaction makes its scheduled callback throw. | Confirmed conditional history: the public probe reached `completed` at the scheduled callback and observed the invariant error. The guide says the strategy controls write timing but does not explicitly define external `tx.commit()` on its returned transaction. | **design-decision**: decide whether strategy ownership forbids manual commit or manual commit must run early. The U1 repair prevents permanent scheduler poisoning; it does not define manual-commit semantics. |
| U3 | A throwing `onMutate` consumes debounce's leading edge forever. | Confirmed for a callback that throws before changing a row. The oracle expected immediate second start `[2]` and observed `[]` on the reviewed code. | **fixed-now**: restore leading admission when the failed callback installed no timer. Both trailing settings pass; the throwing callback's error identity remains observable. |
| U4 | A throwing `onMutate` consumes throttle's window and leaks partial optimistic intent into a later write. | Both effects reproduced. The window regression is new; the partial-intent leak also exists in the base transaction implementation. The original manual-transaction oracle failed for same-key update, distinct insert, and delete. | **fixed-now**: restore an unused leading window and restore the transaction's pre-callback mutation snapshot after a synchronous throw. The user chose to include the transaction contract change in this PR. Eight transaction histories and two paced receiving histories pass. |
| U5 | Repeated debounce calls can cancel an eligible leading write behind a held handler. | Confirmed. The original code kept only `[[1]]` where the oracle required `[[1],[2,3]]` when the held handler returned before the renewed quiet edge. | **fixed-now**: keep a pending leading callback; calls can join its transaction without canceling eligibility. Release before and after the quiet timer, plus a later no-duplicate cut, pass. |
| U6 | A throttle pending merge can coexist with a stale trailing timer that overwrites it. | Refuted for the stated path. The timer is cleared before it transfers its callback to serial pending state. The controlled held-write probe reaches the `serial.hasPending()` merge branch and persists `[2,3]` once, with the same transaction receipt. | **refuted**: retain the pending-merge oracle witness. A longer reentrant failure schedule remains outside this finite proof, so the invariant should be revisited if the timer handoff changes. |
| U7 | Two clocks cause an extra wait; use zero wait in the serial pacer. | Refuted as a fix and as the stated timing rule. Admission and actual backend starts are different boundaries. The zero-wait hostile mutant fails the existing actual-start spacing assertion: the third write starts one tick too early. | **refuted**: keep both clocks and the timing oracle. The coverage map still limits arbitrary schedules. |
| U8 | The commit-completion fallback is copied four times. | Confirmed by source inspection. A receipt can reject before its handler completes after manual rollback. | **fixed-now**: one `runWithCommitCompletion` helper is used by debounce, throttle, and queue. Existing manual-rollback and settlement histories pass. |
| U9 | Strategy type checks and positional callbacks deny every custom strategy dropped-call isolation. | The generic layer does branch on `_type`, but the claimed general bug conflates the built-in debounce/throttle admission convention with legacy custom queue and batch behavior. The oracle proves a false-returning custom batch retains its scheduled callback. | **refuted** as a correctness claim. Preserve the API-shape concern; a uniform admission result needs a separate compatibility design, not a change inside this repair. |
| U10 | The 48-line serial pacer violates the code-weight rule without an architectural reason. | The code weight is real. Installed Pacer Lite's debouncer has no asynchronous completion gate; its queuer drains callbacks synchronously without awaiting them. The 24 held-write histories and manual-rollback witnesses enforce the one-persisting law that a plain timer or LiteQueuer cannot express. | **refuted** as an AGENTS.md violation. The positive production diff is justified by the documented independent scheduler boundary. Keep reviewing production weight separately from oracle and documentation growth. |

## Law coverage and calibration

The paced owner is `packages/db/tests/paced-mutations-oracle.test.ts`.
Its public authority is the paced guide's one pending and one persisting
transaction rule, immediate optimistic admission, and debounce/throttle
edge behavior. The new synchronous-throw scheduler seam has a two-callback
model: the first error remains visible and the second eligible callback
starts. It failed at the second-start assertion before the fix. The reentrant
pending neighbor also passes. This seam does not decide U2's external
manual-commit policy.

The leading-admission model treats a callback that throws before changing a
row as admitting no mutation. Its next same-tick call keeps the leading edge.
Both factories and both trailing settings reach that premise. The reviewed
code failed the start cut for debounce and throttle. A separate held-handler
history checks that a later debounce call cannot cancel an already eligible
leading transaction; the original implementation failed at the release cut.
The repaired driver observes rows at admission, ordered handler payloads at
start, transaction identity, receipt settlement, and absence of a later
duplicate. These finite histories do not cover arbitrary-length bursts.

The optimistic transaction owner is
`packages/db/tests/optimistic-transaction-oracle.property.test.ts`, after
the stable `optimistic-history-oracle.ts` contract. The independent rule retains
only successful synchronous `mutate` callbacks. The grammar crosses a prior
successful callback or none with three failure operations, then commits a
later successful callback; a second witness touches two Collections. The
driver compares public rows and pending mutation payload immediately after
the throw, then the handler payload at commit. The original implementation
failed all three failure-operation kinds at that throw cut; the repair passes
all eight manual histories. A restoration-listener fault killed the first
repair at the original-error assertion. The final repair restores every
Collection and preserves the callback error as the aggregate cause. The paced
owner checks the same rule through
debounce and throttle. `query/scheduler.test.ts` checks that abandoned join
work cannot publish after the failed callback and explicit rollback. The
contract permits transient subscriber notifications while the synchronous
callback runs. Nested throwing callbacks and asynchronous work after that
scope are not covered here.

The throttle pending-merge witness reaches the timer-to-serial handoff while
a first handler is held. It asserts one successor start with both admitted
rows, fulfilled receipts, and no later repeated start. The source transition
keeps `trailingTimeout` and serial pending mutually exclusive on that path.
The actual-start timing oracle rejects a zero-wait serial pacer with an
assertion failure one tick before the required spacing edge; the original
non-mutant code passes. These checks do not establish all possible timer
schedules or real-server timing.

The committed coverage map names the bounded owners and remaining histories.
No new random campaign is claimed. Controlled Collections and fake timers
prove the DB source path, not framework scheduling or external persistence.

## Oracle guide audit

ORC-001 through ORC-003: guide and transaction documentation state the laws;
the paced and optimistic owners keep their model, legal grammar, driver, and
comparison cuts beside the code. ORC-004 and ORC-007 do not apply to the new
finite matrices. ORC-005 is met by real Collections, transactions, strategies,
and handler starts. ORC-006 is met by the original assertion failures and the
zero-wait hostile mutant; no timeout is counted as a kill. ORC-008 and ORC-009
are met by the explicit pending-IDs and successful-callback abstractions.
ORC-010 uses cleanup helpers that preserve the primary failure. ORC-011 has
no named shared semantic fault requiring a second model. ORC-012 is this
revision-bound record and the coverage map. ORC-013 is met by failed and
successful neighboring admission cases and both sides of timing edges.
ORC-014 does not apply beyond the controlled DB boundary claimed here.

## Reviewer assessment

The review found several real asynchronous and exception-boundary failures
without test execution. Its strongest points were the scheduler stall,
leading-edge loss, and canceled leading write. Its weaker points inferred an
unreachable stale-timer combination and proposed zero wait despite the
actual-start spacing law. It also combined a new throttle regression with a
pre-existing transaction error contract. The actionable signal is high, but
the proposed fixes require executable calibration and contract separation.
