# Trace-plan precision addendum

This addendum tightens `R03-trace-plan-v1.md` (SHA256 `61c74ac29638578100f5809d93c9437df1812e025590440df2e67d31876fc0aa`) following the independent artifact-only review. The original plan stays frozen. Both documents are unexecuted specifications; neither admits an executable overlay or trace run.

At `checkReplayError`, capture only calls and predicate atoms that the original execution actually evaluates. Record short-circuited history entries and atoms as `not-evaluated`, with their result unknown. Do not invoke `stillDecides`, `covers`, a getter or any other predicate again to complete the trace. Primitive snapshots may retain the original inputs, but the recorder must not compute a second verdict or change evaluation count, ordering or branching.

Give separate identity tokens to the native `Promise.all(pending)` base promise, the existing `.then(() => undefined)` recovery promise, the async `resume` promise, the window-returned promise and the existing test observer's derived promise. Record exact identity equality or inequality rather than assuming those promises are one object. Preserve the original combinators and existing callbacks. A native base promise's first settlement remains unavailable unless an admitted observation point can establish it without an added observer.

An exact request-data object reference is evidence of identity, but it does not necessarily identify one acquisition attempt. Record an invocation token at the actual original acquisition call and link the resulting production acquisition record, subscription demand and model load through observed invocation/return boundaries. If request data is reused across attempts and the original path does not expose a unique association, record all observed matches and mark the association ambiguous. Do not choose by temporal proximity, predicate shape, source name or Error message.

These constraints apply to the author's executable transform and its finite independent review before root admission. They do not change the accepted earliest-own-replay law, model, comparison, cleanup or exact replay coordinate.
