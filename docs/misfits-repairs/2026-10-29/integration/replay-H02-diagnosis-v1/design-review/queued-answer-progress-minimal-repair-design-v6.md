# Queued-answer progress: minimal production repair proposal

Status: additive source-only design. No production or test edit, execution, or
new admission. Keep v1–v5, canonical evidence, and baseline fixtures unchanged.

The human decision `H02-CONDITIONAL-QUEUED-PROGRESS` requires returning control
so an already queued finite backend answer can run, preserving cached-row
ownership and atomic publication. It decides no permanent-conflict policy or
numeric product deadline. Its source receipt is SHA256
`e12e53f13adc3ee9d393501deb588e26d8a0aae1c9bb9191b86fb71cd634e142`.
Architecture laws 7, 9, 14 and 16 and the synchronous initial-readiness cut
continue to constrain settlement, publication, cleanup and errors.

The accepted V4 result review, SHA256
`6894f0f6f742e3a35c9c93c2e613c620cbcfc5978a81d60d43385a5ba43b0293`,
establishes conflict 182, completed enqueue 184, and no callback execution through
receipt 70,961 under its admitted finite observation window. Row 4 stays public.
It establishes neither infinite execution nor the proposed internal stop premise.

## Smallest mechanism

1. Keep demand acquisition, cached-result application and lease release unchanged.
   `CollectionSubscriber.setDemand` exposes its existing `DemandUpdate` after
   normal participant registration. The builder captures the existing publication
   hold and input revision before that call. A changed Promise-returning update
   that synchronously advances graph input requests a stop for this D2 call.
   Capture the hold before callbacks can retire its last owner.
2. Add an opt-in stop to `D2.run`, checked after a complete `op.run()`. Default
   callers retain full draining. Stop only with remaining work; a stop request
   with no remaining work takes the ordinary successful tail.
3. On suspension, return before loader selection, flush, initialization or status.
   Retain D2 state and root/facade accumulators. Queue one builder-owned host task,
   fenced by exact task token, sync-run generation, config and state identity.
   While queued, every immediate graph-entry path leaves resumption to that task.
   Dispatch clears only its own token and runs a fresh ordinary graph turn without
   the old transaction/publication context. Creation does not require an active
   public operation. Cleanup cancels the task; identity checks still reject late
   delivery. A microtask alone is insufficient for the timer-answer lane.
4. Retain the accepted completion safeguards from v2–v5. Task ownership and an
   operation-only completion obligation are separate. Existing and newly admitted
   windows attach before they can settle; repeated yields retain that obligation.
   Completion requires a newly successful whole graph/publication tail, open
   existing gates, current revisions and settled establishing applied receipts.
   Register returned root/facade/restoration receipts before the next fallible
   phase. Keep terminal graph failure, retryable tail failure, ordinary source
   aggregation and explicit rollback disposal distinct. Reuse the sync manager's
   operation records; add no second operation registry or cache state machine.

An outer scheduler-only change cannot interrupt the inner `D2.run` drain.
Deferring or dropping cached ownership would change the accepted ownership law.
Putting completion into the publication gate it awaits would make it wait for
itself. These alternatives are not smaller valid repairs.

## Required pre-edit oracle and receiving gate

Extend the existing progress owner and its completion companion; do not create
another expected-result model. Reuse their independent provider-fact recomputation
and mandatory family lanes. Generate finite cache feedback crossed with already
queued microtask/timer answers, empty/nonempty prior publication, and an actual
helper path with no active public operation. Record positive reach separately for
the exact held/changed-Promise/input-feedback/operator-stop premise in each
claimed receiving path. The actual-helper/no-active-operation neighbor remains
missing; V4 does not supply it.

The real QueryClient receiving driver must run those histories on unchanged
production before edits. Required checkpoints distinguish these simpler wrong
repairs:

| Wrong repair | Distinguishing observation |
| --- | --- |
| Drop cached rows or delay ownership claims | While refetch is held or fails, every live peer and reacquired owner retains its rows; each final release retires only its own claim. |
| Broaden asynchronous barriers | All-literal-true initial chains and ordinary compatible source mutations retain rows, readiness and coherent events before their initiating stack returns. |
| Yield only through microtasks | An already queued timer answer executes; host return alone supplies no successful-window credit. |
| Run an obsolete task | After cleanup/restart with a current live task, old dispatch changes no rows, readiness, error, task token or operation in the replacement run. |
| Settle on source answer, task dispatch, quiescence or a returned flush | At the host gap and held/parked-output cuts, original and partial-option windows remain pending with their settled window/publication retained; fulfillment follows the successful whole tail and applied visibility. |

Keep the existing twenty candidate observations as instrument obligations derived
from these accepted laws, not twenty independent product laws. All remain
UNREACHED. Preserve the additional actual-helper/no-active-operation obligation;
do not infer or adopt the proposed state14 mapping. Baseline setup failures must
be repaired and classified before they can supply receiving credit. This design
grants no production-edit admission, GREEN, mutant kill or bug-class closure.
