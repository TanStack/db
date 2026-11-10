# R03-E6-HEALTH01: request-error ownership correction plan

Status: source-only proposal. No repository source, historical evidence, runtime
recipe, or production file changed for this plan. E6 remains stopped. A reviewed
plan does not admit receiving runtime.

## Frozen result and classification

E6 result freeze: `f88e9b4c0199cf6f1706ad74d5d82b35e7aff1a4bde5ee7bd373f1099b55ea50`.
Source is the E3 source on HEAD `9cfa11fc712866f8f276e85762865ebb8bd49cbe`;
production identity remains
`60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.
The independent result/ownership review is
`R03-E06-independent-partial-result-and-health-ownership-review-v1.md`, SHA256
`8f94cfdaff08f43e2aa9ed00e4498ba285e13cdfece0ad1d8a381d48cc163cbd`.

The sole E6 invocation ran E02. Its first assertion failure was a request-health
check in `failed covering keeps the prior publication`: the oracle demanded
Error42 in the query's own health after the directly authored union load failed.
It had already compared the old waiter's Error34 and retained public snapshot.
The publication reach after the union failure was not reached. The trace has
105 contiguous observations and `completed=false`; it is failure evidence, not
a completed witness. Ten other bodies passed; eight selected bodies never
ran. Neither a 19-neighbor pass nor production RED follows.

Classification: evaluation receiving/provenance gap. A direct subscription
request was treated as if the query plan had started a keyed demand. Whether a
genuine later graph demand violates health remains unproved. This classification
does not excuse any replay, completion, subscription-error, or publication debt.

## Authority and source reading

- Glossary, `request error`: a failed subset load for demand that a live query
  or Effect started after initial-query readiness belongs to the query's own
  node. Subscription ownership and query-plan demand are distinct concepts.
- `ARCHITECTURE.md`, Atomic window publication, lines 1390–1402: a failed
  waited replay keeps its own earliest still-deciding Error; a completed
  receipt does not change when later demand fails.
- Replay participants and failure, lines 1478–1542: current held subscription
  acquisitions participate in replay/publication, including later demand.
- Law 16, lines 1926–1944: the replay verdict decides the request-error frame;
  once the attempt failed, a later query demand's failure appears at once.
  The original failed replay frame remains until its lawful recovery or
  retirement. Error-value identity coalesces failures, not logical owners.
- Coverage map, lines 1084–1188: this owner checks held replay authority and
  public snapshots. Direct request/release/replace receiving reach expressly
  does not establish the natural demand controller's choice of replacement.
- Lifecycle grammar opening: a logical demand, acquisition attempt and sync run
  are separate; explicit direct requests are legal lifecycle participants.
- Repair-location table: attributing an observation to the wrong receiving
  owner belongs in the model/driver/comparison; a production repair needs an
  accepted promise and the actual promised path.

Relevant production evidence (descriptive, not contract authority):

- `collection-subscriber.ts` lines 53–60 forwards the natural demand controller's
  per-key outcomes to query health. Its lazy `loadSubset:error` listener at
  155–175 records subset failure without independently forwarding every keyed
  request into per-key health.
- `collection-config-builder.ts` lines 605–624 records subset/window errors;
  731–747 separately reports aggregate replay and keyed request health.
- `subscription.ts` lines 1040–1085 and 1280–1298 record the exact Error and
  emit `loadSubset:error` for an unaborted load. `requestSnapshot` supplies the
  caller's result observer. The oracle's direct caller at 2777–2821 records
  request options and consumes rejection; it does not install the natural
  controller's per-key observer.
- `subscription.ts` lines 749–765 calls replay publication failure on the first
  completion verdict. A later failure must not rewrite that completion.
- `subset-demand-controller.ts` lines 308–360 installs the natural observer;
  its `setDemand` path is the required receiving boundary for a graph-demand
  health claim. No proposed test may synthesize that callback or invoke the
  builder's error-reporting method.

## Distinguishing predictions before any source edit

| History/cut | Old request-error account | Proposed independent account |
| --- | --- | --- |
| First own replay verdict fails with A, including a directly authored participating demand | May owe A, but a later overlapping request can suppress it | Aggregate replay health must contain the independently judged first verdict's owed failure frame; this is separate from per-key attribution and immutable waiter A |
| Later direct `requestSnapshot` union fails with B while A still holds publication | Requires B in query own health merely because it is a keyed load on the subscription | Require the union's exact subscription error event B; record whole health at the same cuts; keep aggregate A, waiter A and retained publication obligations. The direct request alone supplies no new graph-plan per-key B debt. Extra query-health B is allowed |
| Later actual graph demand fails with B after the replay already failed A | Requires B, without distinguishing origin | Still require B in query own health at the lawful command cut, with A while its frame remains owed; also require exact subscription error B |
| Later direct load is merely issued after a graph failure | Any overlapping later request can suppress the old failure | Direct issue alone supplies no graph-plan supersession evidence. Graph debt cannot be waived by an unrelated direct request |
| A held complete authoritative replacement succeeds | Existing replay/publication recovery and immutable receipt apply | Same requirements; the added provenance does not change replacement authority or redefine completion |

The correction narrows only an unsupported cross-owner inference. It strengthens
the checks for first-verdict health and direct subscription errors, and retains
the genuine graph-demand health law. It must not be implemented as an unrecorded
skip, `isAuthored` early return for every comparison, or allowance for missing
query health on actual graph demand.

## Exact proposed source scope

Only these test/document files may change, following fresh root authorization:

1. `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`:
   introduce explicit demand provenance in the model/driver account; add passive
   subscription-error and whole-health observations; separate aggregate replay
   health from a later per-key health obligation; add the finite natural path and
   shared-comparison controls below.
2. `packages/db/tests/query/load-subset-retained-publication-oracle.ts` only if
   a shared comparison needs an additional observation input. No existing
   publication/window expectation may be weakened for this ownership correction.
3. `docs/contributing/oracle-coverage.md`: append the exact boundary, needed
   natural witness, and unmeasured status. No budget reduction or exclusions.

No production changes, completed own-receipt chooser changes, old freeze edits,
test budget edits, changesets, commits, pushes, or PR work are included.

### Provenance independent of observed outcomes

The authored history registers each explicit direct logical request before its
`requestSnapshot` call. Bind its name/immutable predicate to the actual options
at the adapter/caller boundary; replay renewal retains the same origin. Use
the existing unique authored predicates and exact-option receiving witnesses.
This mapping must survive reentrant synchronous starts and acquisition renewal;
register intent before calling production. Do not classify by Error, Promise
result, health contents, native replay pending flags, or whether a check passes.

Natural provenance comes from the fixture's declared query and source-relation
actions, then the real compiled graph and demand controller. For a native-only
lane, no direct source request is legal, so every keyed load reached through its
declared query is graph demand by construction. Other receiving paths require an
explicit origin mapping; absence from the authored registry is not by itself
proof of a graph-plan origin. Unknown provenance is a failed receiving premise,
not a reason to omit an expected error.

Keep every directly authored load in the existing own-completion and shared
publication accounts. Add distinct request-health obligations:

- aggregate first replay verdict health, computed from the independent first
  own judgment and its still-held failing logical demands;
- per-key query health from actual graph demand;
- subscription error delivery for all current unaborted failed direct loads.

Recovery and retirement decide each obligation at its own boundary. A direct
request's issue cannot silently supersede an existing graph-plan failure. A
completed receipt remains immutable even if later recovery clears health.
This plan does not authorize a general rewrite of existing key-coverage rules;
any new counterexample stops the batch for classification.

### Passive observations and comparison cuts

Install one removable `loadSubset:error` listener per actual source subscription
before the adapter can settle/throw. Record exact event subscription, options and
Error identities, with sequence/command identity. Do not call health setters or
add a result observer that forwards synthetic request errors into query health.
Record a whole public health snapshot at event delivery and before/after the
existing command boundary (`flushPromises` plus existing reentry receipts),
including exact `cause` identities. Event-listener timing is diagnostic; the
lawful health comparison stays after the command settles, since Promise
reaction and listener delivery need not establish one universal intermediate
ordering. The subscription's public `lastError` is recorded separately and
checked against the relevant delivered latest error at that cut.

At the original direct-union failure cut, require B's exact source-subscription
error and the still-owed aggregate A. Record extra health B without requiring
its absence. Continue to the existing failed-covering publication reach and
whole retained snapshot comparison. The original waiter's native Error A and
the independently frozen receipt remain checked separately. Preserve final
recovery, exact unload/cleanup, completed flag and contiguous raw observations.

### Required natural-controller receiving witness

Add one finite history to this owner using the real compiler, a real eager
parent Collection and an on-demand joined source, with initial-query readiness
established before faults. A small independent key-relation model states the
needed keys. Reuse the corrected obligations and comparison; do not put a
separate literal expected-health test in an oracle file.

The minimal history is:

1. Publish a parent whose graph-generated joined demand succeeds; reach ready.
2. Hold source loads and truncate the joined source. Fail its current replay
   acquisition with A and let its own current participants drain. Retain that
   logical owner; establish independent first own failure A and the native
   completion A while publication remains held.
3. Insert another parent through normal sync, causing the real graph to add
   a distinct demanded key. Its actual demand controller requests that key;
   hold this acquisition until the first failure is complete. No direct
   `requestSnapshot`, synthetic replacement, private controller state change,
   or health callback injection is permitted in this lane.
4. Fail that later current held graph acquisition with B. At the command cut,
   require exact subscription error B and query-health B, along with still-owed
   aggregate A, unchanged original completion A and retained publication.
5. A successful authoritative replay recovers the demand, clears its health
   errors, and publishes the model result; exact unloads and cleanup still run.

Declare and measure reach for ready before fault, independent first failed
receipt, native completion identity, current graph demand started after that
receipt, late current failure, both health owners, retained publication and
recovered publication. Missing natural entry or premature replay recovery is a
receiving failure, not GREEN. Passive controller-entry observation may show the
real plan ID and requested keys; those observations do not compute expected
health or demand keys.

This minimal witness proves the natural late-key failure receiving boundary. It
does not prove that the controller chooses the particular covering-union edge
in the original direct fixture. Natural fragmented-churn replacement remains a
separate open receiving limit unless an additional reviewed history reaches it.

### Controls required before credit

Feed wrong observations through the same comparison, without special expected
answers for the fixed history. Controls must reject:

- missing A from the independently owed first replay health frame;
- missing B from a genuine later graph-demand failure;
- missing/wrong-identity B event, wrong subscription, or wrong request options
  for the direct union;
- rewritten original completion A, leaked partial publication, or suppressed
  failed-covering retention reach, using existing comparisons.

A control that omits standalone direct B from query health must remain legal
when exact direct B delivery and aggregate A remain. Extra B health is legal
too. This demonstrates that the correction changes ownership rather than
fabricating a preferred production outcome. A natural request falsely marked
direct or an unclassified request must fail receiving attribution.

## Review and later admission gates

The independent reviewer should first assess this exact plan and its authority.
Root may then authorize the small oracle/driver/document edit. After edits,
freeze a new source packet and run only authorized static checks. Inspect the
native Vitest full-name functions when preparing any new exact finite selector;
do not reuse display ` > ` names as native names. A later runtime packet must
name selector cardinality, expected bodies/reaches/payloads, source identities,
one-worker/bail/timeout limits, immutable input set, guard/process-group checks,
and stop-first-surprise handling. E6 admission does not admit any of it.

Proposed later runtime order, subject to separate exact admission: original
direct failure plus ownership controls first; the new native receiving history
second; previously unrun finite neighbors only after both are classified. No
campaign, mutant, retry, or E03 is presently authorized. Unknown results stop
before further commands or edits. All old receipts and R03-E6-HEALTH01 remain
lossless historical evidence.

The evidence presently establishes the provenance gap and the failed E6
comparison. Every new reach, subscription-event observation, corrected GREEN,
native health result and control kill in this plan remains unmeasured.
