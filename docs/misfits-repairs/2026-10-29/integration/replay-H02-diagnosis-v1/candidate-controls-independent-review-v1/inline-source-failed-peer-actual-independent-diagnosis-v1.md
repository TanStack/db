# Inline source-failed-peer: independent actual failure diagnosis

Classify exact ordinal 3 as **fixture-premise/checkpoint failure**, with a
separate native supervisor group-kill denial. It supplies no product RED or
GREEN. The batch must stay stopped; ordinals 4–16 remain unrun. This diagnosis
admits no retry, edits no source and changes no expected product behavior.

The immutable result freeze is
`029a8eb1cf46e59d84cdf6d52cb7f56837b962b829922672e76630df26b49957`.
Independent facts are in
`inline-source-failed-peer-actual-independent-facts-v1.json`, SHA256
`dd5643716d7ed8ecd489662aa4df0c5a1bf5e714d38143da36ef40b14be41d81`.
All static audit checks pass: 1,975 result files; 584 current frozen sources;
2,544 payloads; Node, two locks and four links; all 1,626 V8 bodies; both
179-module registries; all 338 derived binding rows; and the required seventeen
plus three evaluated pre-history modules. Strict completion binding is bound.
The evidence failure is not missing provenance or stale source. No product,
JS, model, native test or process probe is executed by this audit.

## Primary failure and distinguishing trace

The driver arms marked/children hold flags in `hold-demand-sources`. Its
`request-window` physical action then calls the real public setWindow and
returns immediately. The loop's single async return does not guarantee that
the root answer has applied and generated the later marked/children demands.
The next held-window cut requires an actual unanswered provider request.
Those two premises are not the same: a pending public operation can precede
any held descendant provider request.

The actual record distinguishes a too-early checkpoint from a missing or
cached demand:

| Raw sequence | Boundary ordinal | Observation |
| --- | --- | --- |
| 191 | 179 | real window operation entered |
| 196 | 184 | roots load 3 entered for one forward row |
| 198 | 186 | roots request 3 answered with root 3, rank 30 |
| 204 | 192 | original window call returned a promise |
| 207 | cut | previous complete two-root window; original operation pending; zero pending provider answers |
| 208 | 194 | fixture teardown starts after the failed comparison |
| 216 | 202 | marked request 2, exact scope [3], starts and remains unanswered |
| 244 | 230 | children request 2, exact scope [3], starts and remains unanswered |
| 283 | 269 | roots load 3 applied settlement recorded |
| 296 | 282 | fixture cleanup completes |
| 297 | — | one positive worker-cleaned |
| 298 | — | worker rethrows the held-provider premise error |

Descendant graph processing starts before the source-load promise's settlement
callback is recorded, so boundary 269 is not an ordering contradiction. The
provider requests are real and bind their originating loads. They arise during
teardown because teardown yields/drains the previously started work. Teardown
is not a valid observation checkpoint for the planned history, but the late
records explain why the earlier premise was false.

At the failed cut, root and downstream both preserve roots [1,2], ranks [10,20],
complete child sets, window {offset:0,limit:2}, ready status and no request
errors. The original window promise is pending. No public callback occurs in
the held epoch. There is no observed violation of the accepted publication
barrier. The checker correctly refuses a held-provider claim with zero actual
held providers. It must keep that positive assertion.

Only the first three authored semantic actions and first two of four epochs
run. No source-failure action, applied failure witness, source-answer release,
peer provenance, remaining cut or final operation outcome is reached. Thus the
intended source-failure/peer-aggregation class receives no outcome from this
run. A pending original operation alone does not close that class.

## Smallest source-only repair

For the source-failed-peer `request-window` physical path, use the existing
host-turn waitFor to wait until **both** selectedRequest(answerScopes.failure)
and selectedRequest(answerScopes.peer) exist as unanswered, uncancelled actual
provider requests. Bind/validate each original establishing load/receipt at
that premise: the original receipt must be a live promise with the exact
source/query-key ownership and an unaborted signal. Then take the existing
held-window cut. The same requirement should remain checked before injecting
the source failure, because a previously seen request can retire before use.

This moves a fixture admission checkpoint to the state its author declared.
It needs no production change, model rule, different expected row, new public
promise, reload, cache invalidation, manual source write or forced callback.
Keep the old positive held-request check, exact source failure identity,
pending-peer rule, authored epochs, original operation identity and complete
window barrier. The existing source-failure path already waits for both
selected scopes; the missing wait is before the earlier held cut.

The witness uses fresh key 3 after establishing keys 1 and 2, and this run
shows the exact requests naturally arise. That does not authorize a general
product requirement to fetch. If a legal implementation serves those facts
from cache, or legally batches a different scope, the exact fixture premise is
unsupported/UNREACHED. Retain that classification and stop under the existing
finite containment bound. Do not relax the comparison or force a request to
make the test pass. A fixed number of microtasks or arbitrary delay is weaker
than waiting on the exact recorded premise.

Before any retry, review the concrete narrow source overlay independently,
retain immutable old source/input/results, and create new frozen sources and
fresh exclusive outputs. Calibrate the new wait's admission predicate against
no request, only one selected scope, answered/cancelled or foreign requests,
and exact live requests. Preserve the old generated budgets and model rules.
ROOT must separately admit any native successor; no runtime is authorized here.

## Secondary cleanup/containment diagnostic

The child and parent both invoke the shared held-window comparison. The child's
recorded stack points at the driver observation comparison. The parent's
primaryObservationError points at the parent baseline test's comparison of the
same cut. This is actual invocation evidence beyond child module evaluation;
it remains short of parent V8 loaded-source binding.

The native supervisor reader catches the parent comparison error. While the
receiving process is not yet marked exited, it calls its existing
kill(`observation`) path, saves that trigger, and attempts SIGKILL on the
registered negative PID/process group. The system returns EPERM, which is
retained as `cleanupErrors: ["Error: kill EPERM"]`. The native outcome is
reason observation, exit 1, signal null, strict source binding bound. The
parent then emits its general receiving-instrumentation failure. These are
secondary consequences of the failed premise, not a product-source error.

The EPERM is a real containment diagnostic. This evidence does not establish
its OS cause or validate the native failure-path kill. Do not suppress it,
relabel it ESRCH, or declare that path clean merely because the worker later
exits. Fixture cleanup itself records cleanup-complete and worker-cleaned;
these are separate from process-group containment. The outer executor records
no trigger/heap/signal, matching identity, zero remaining owned-group rows and
zero outer cleanup errors. Saved final checks report the named original
PID/PGID identities absent. That establishes this run returned with no recorded
owned survivor; it does not erase the failed inner kill or establish escaped-
descendant/PID-reuse coverage. No new probe was performed.

The primary premise repair can proceed independently in source-only scope.
Retain the EPERM as an explicit open instrument/failure-containment limit; any
later claim that this failure path is validated requires separate evidence.
A successful future ordinary run would not by itself validate that path.

Actual tool completion `f6e194` is outer exit 1 and parent child exit 1. The
collector's exit 1 records these failed test/completeness conditions while
preserving the entire result; it is not missing output. All twenty candidates,
actual-helper/no-active-operation neighbor and all recovery-progress claims
remain UNREACHED. State14 is proposed and unadopted; metadata remains separate.
