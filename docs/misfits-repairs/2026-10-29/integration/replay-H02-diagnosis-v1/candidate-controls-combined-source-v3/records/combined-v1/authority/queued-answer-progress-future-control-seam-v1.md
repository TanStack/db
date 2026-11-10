# Future continuation control binding v1

This is a source-only binding specification for the native receiving author.
It supplements the independently assessed v1–v5 design. The final successor
assessment is `queued-answer-progress-successors-independent-assessment-v1.md`,
SHA256 `af9e5c9c973b07e5a34de2c9bc130d84a5d8f466a506cd63f09ae8e0be65a67d`.

The assessed design fixed semantic owners, not exact function names or a
production implementation. The interface below is the preferred concrete
future binding so candidate controls can be authored now. It is not an existing
baseline seam or an independently reviewed implementation. Candidate source
review must either adopt this binding or update the test binding explicitly.
Do not make an applicable baseline observation depend on its existence.

Only this report is written. No production, oracle, test, dependency, budget,
or campaign changed; no runtime, install, receiving invocation, commit, push,
or publication ran. Continuation-specific reaches remain UNREACHED until an
accepted candidate actually exercises them. This specification admits no run.

## Narrow host-task module binding

Preferred internal module, relative to the source checkout:

`packages/db/src/query/live/graph-continuation.ts`

```ts
export function scheduleGraphContinuation(task: () => void): () => void
```

The return value cancels that scheduled host task. Production uses a real host
task, such as a zero-delay timer, rather than a microtask. The numeric timer
argument is a scheduling request, not a product deadline. The helper carries no
transaction/publication context and performs no graph, demand, operation, or
receipt work. It exports no owner, token, or completion data, and is not exported
from the package's public entry point.

The builder creates a fresh exact token for each queued callback. Its callback
captures the stable progress owner and that token. Before clearing its own
queued marker or doing any graph work it verifies owner/token/run/config/state
identity. It then requests a fresh normal graph turn. Retry replaces a failed
completion incarnation, not the stable owner or its queued token. Pending work
with no token may run on normal source callbacks; a pending completion alone
does not suppress graph execution.

The helper's test replacement implements the exact signature above. It records
each callback in an ordered local queue and returns a cancellation closure for
that exact queue record. Keep canceled records available to invoke deliberately
as already-dispatched stale callbacks. The replacement must never dispatch a
callback inline from `scheduleGraphContinuation`. It must not replace global
`setTimeout`, `queueMicrotask`, or Query Core's timers.

The receiving-only queue record can be this shape; it is not a production type:

```ts
type ControlledGraphTask = {
  id: number
  callback: () => void
  cancelled: boolean
  dispatches: number
}
```

Use a monotone local receipt ID only to correlate observations, never as a
progress deadline, retry allowance, or model input. Calling a recorded callback
is a **dispatch observation**, not proof of accepted graph resumption. A stale
callback must still be callable without changing the replacement run.

## Private identities and public observations

The following identities are semantic requirements of the design, not test
imports or extra public instrumentation APIs:

| Private identity | Required lifetime | Receiving distinction |
| --- | --- | --- |
| Stable progress owner | One exact sync run/config/state | Old callback after cleanup/restart cannot enter or clear the replacement's task. |
| Task token | One scheduled callback | Repeated qualifying yield queues one successor only after the current token is consumed; immediate graph scheduling cannot bypass a queued token. |
| Completion incarnation | Repeated yields of one pending obligation; replaced before a legal retry attaches after recoverable failure | Existing and async-gap new window operations remain pending; old rejection cannot reject or complete retry. |
| Publication attempt/target scope | Each recorded output/restoration obligation, with explicit rollback-only disposal | Abandoned new-facade rejection differs from retained root/facade/restoration obligation. |
| Successful-pass checkpoint | Only a newly successful whole graph tail/current incarnation | Same revisions after a later throw cannot reuse old success. |

Observe task dispatch through the narrow module mock and accepted graph entry
through the exact query's existing D2 graph instance or narrowly bound graph-run
driver observation. Do not count another query's D2 run or callback invocation
as accepted resume. A receiver that cannot identify that graph instance must
leave accepted-resume reach UNREACHED, rather than infer it from rows changing.
Public reads, `setWindow`/`getWindow`, callback payloads, downstream result,
readiness/health, and one-shot releases remain the comparison observations.

Window promise identities are observable operation outcomes; they are not the
private completion promise. Repeated-window controls infer the shared
obligation by checking those public outcomes at exact task/receipt cuts. Do not
add a production fence-ID export merely to compare private promises.

## Concrete control attachment and cuts

1. Mock only the internal scheduler module. Import the production query path
   after its module replacement is installed. Keep actual Query Core and custom
   cache ownership intact. Queue the selected backend answer through its stated
   real microtask/task path. A controlled graph-task queue demonstrates the
   completion cuts; it cannot alone prove the production helper returns host
   control. The primary actual-host comparison still needs the real helper.
2. At the first accepted enqueue, retain the task record. After the initiating
   call returns and the queued answer/last demand settles, but before dispatching
   that task, compare prior public rows and settled window; existing and newly
   admitted partial-options window promises must remain pending. Dispatch only
   that graph task to continue. Repeated yields keep operations pending without
   permitting an immediate scheduler bypass.
3. Cause recoverable source or publication failure while that task is queued.
   Admit a legal explicit retry. Its promise must be fresh/pending while the
   original queued task remains the scheduling barrier. Dispatching the retained
   callback must resume current work, not strand the retry or clear another
   token. Deliver old promise observers afterward and compare unchanged retry
   outcome until its own completion checkpoint.
4. For graph-terminal failure, bind fault injection to `run()` on the exact
   resumed graph and exact controlled-task dispatch, with an unanswered source
   participant already reached. Do not inject into a generic timer or setup.
   All unfinished current-run operations must end through their existing
   manager, preserving recorded first error and later-callback no-op behavior.
5. For a retryable subscriber exception, attach the fault through the actual
   public root/facade subscriber reached after state installation. Include
   unfinished operations with and without the captured pending completion.
   The manager selects `pending.has(capturedFence)` before rejecting that
   fence; unrelated records cannot be ended by run identity alone. A no-fence
   synchronous call retains its old exception path. Observe host reporting
   separately from operation rejection and later explicit retry.
6. Park output using a legal persisting transaction at the actual root or
   facade boundary. Include output queued before suspension, facade A accepted
   before facade B throws, and retained-facade restoration accepted during
   rollback. No private sink mock supplies expected application. The retry
   stays pending until the required real receipts apply and a fresh successful
   normal graph tail completes.
7. Separately create a facade that only the failed attempt owns, roll it back,
   and dispose it before a same-run retry. Deliver its old receipt rejection
   afterward. The explicit rollback-disposal scope removes only its own
   obligation; it cannot fail the retry. Retained-target errors need their real
   classification and cannot use this exemption.
8. After the last receipt settles, make the exact normal recheck publication or
   status tail throw with unchanged input/window revisions. No old checkpoint
   or `finally` can fulfill completion. Fault injection must reach that tail;
   a setup throw does not qualify.
9. Cleanup/restart with a queued task, preserve both canceled old and current
   queue records, then dispatch the old callback. It changes no current rows,
   task ownership, releases, readiness, health, or window outcome. Dispatch the
   current callback afterward to show it remains live rather than merely absent.

The optional cooperative D2 stop is checked only after a complete operator,
uses a sticky local stop request, and reports suspended only with remaining
work. Its exact TypeScript overload is an implementation choice separate from
this scheduler binding. Candidate controls must preserve default synchronous
D2/Effect full drain and the no-pending-work loader/publication tail; do not
guess an unreleased overload in baseline source.

No early-window control substitutes for the actual progress comparison. The
original starvation behavior, early-success mutants, stale-owner mutants, and
receipt/failure-scope mutants each require their own reached premise and
intended comparison. Neither dispatch-only instrumentation, setup failure, nor
resource termination supplies product RED/GREEN or closure.
