# Addendum: continuation receipt and retry cuts

The source-only neighbor packet remains frozen. This addendum records the later proposed-design correction without modifying that packet.

The design agent supplied [retry and exception-safe receipt ownership v4](design-review/queued-answer-progress-retry-receipts-v4.md), SHA256 `9d11de5a62098008f4797ab0bdf76649726bcea237402a87de23437033464b59`. Its final independent review was pending when this addendum was written. It is a source proposal, not implementation or runtime approval.

All v4-specific reaches are **UNREACHED**. The four prepared current-production paths do not establish them. Future receiving preparation must cover:

- A facade returns a parked applied receipt before a later facade throws. The receipt survives the missing successful flush return.
- Rollback enqueues a retained-facade restoration receipt. Both forward and restoration obligations remain visible to completion, including a retry with no new delta.
- A recoverable completion fails while its task is queued. A new partial-options operation gets a fresh pending completion before attachment; the same exact task token still prevents immediate D2 entry.
- An old completion observer runs after that replacement and changes neither the new completion nor its task token.
- Rollback disposes a facade created by the failed attempt. Its late receipt rejection removes only its explicitly abandoned target obligation; it cannot fail the new operation or report successful application.
- An unexpected same-run retained-target receipt rejection selects the attributed attempt, target and lifecycle failure path. Age alone does not authorize ignoring it or failing every newer operation.
- A terminal failure callback changes lifecycle before operation fanout. Exact identity checks protect replacement-run operations.

No indiscriminate timer interception, separate receipt registry or second ownership model is proposed by the neighbor packet. The candidate's narrow trigger, continuation token, completion incarnation and per-commit receipt sink do not yet exist in production. Their concrete receiving instrumentation requires separate source review and root admission.

The accepted V7 bounded queued-answer progress RED remains valid for its actual measured premise. It supplies no executed reach for the candidate suspension trigger, retry incarnation or exception-safe receipt sink. Those gaps continue to block a production edit.
