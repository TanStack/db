# Independent review: repaired source-failed-peer receiving singleton

The accepted atomic window publication law is violated at the first root
callback. This is a bounded product RED. It is not a closed bug class, a
successful baseline, or candidate reach credit. Production and oracle repairs
remain open. No new law decision is needed for the observed barrier violation.

## Law, experiment, inference, and enforcement work

**Law.** An imperative ordered window move holds the last settled public
snapshot while its required work runs. A required failure leaves that snapshot
visible. Private source and graph state can advance without publication.
Authority: `packages/db/src/query/live/ARCHITECTURE.md`, “Atomic window
publication”, lines 1366–1380 and 1414–1428. Reads and callbacks are public
observations; they need not wait for a returned Promise to settle.

Law 9 also says that an ordinary lazy-demand failure after initial-query
readiness settles the demand and permits waiting graph output to publish. That
rule does not remove an already active imperative window barrier. Preserve its
ordinary no-window case when repairing this interaction. A pending include can
legally materialize an empty array under ordinary progressive delivery; the
empty child array alone is not a total-materialization defect.

**Experiment.** ROOT admitted exactly one repaired singleton. Its unchanged
semantic program starts from a ready two-row window, widens to limit 3, holds
both marker and include acquisitions for root 3, then rejects the marker
acquisition while the include acquisition remains unanswered. The native
launcher actually used `require_escalated`. Completion `1cfb7b` returned exit 1;
no second native invocation ran.

**Inference.** The first root callback exposes root 3 before its checker throws.
It therefore establishes a transient public barrier violation independently of
later control flow. Later downstream delivery and the public cut occur after
that assertion entered production's callback/error handling. They are retained
but supply no independent product RED or settlement claim.

**Enforcement work.** Extend the primary pagination owner with the failed
required-source × pending dependent-source dimension before production edits.
Use a nonthrowing public recorder and compare the retained callbacks through
the shared model. Run both the controlled core path and the real QueryClient /
Query DB receiving path on unchanged production. The singleton is diagnostic
receiving evidence; it does not replace those generated RED gates.

## Reviewed identity and independent audit

The source freeze reports detached head/base
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`. No Git operation was used to infer a
newer commit. Disk source identity matches the reviewed freeze. This review
made only additive artifacts in this directory. It ran no product, JavaScript,
model, fixture, native test, process probe, install, or production edit.

| Artifact | SHA-256 |
| --- | --- |
| Successor source freeze | `0a1978c5a8856da7aab49379462dd5f258f75b7ba910454eed320f3018f13779` |
| Successor 88-entry packet manifest | `60a45f03547a64b44341b72b2a9cebe2f9c2f662efc014b613d0e840978427fd` |
| Input freeze | `2777d9652b05480948130b228c9c4bf8c204cb7906b3fa4e8720decb31c1277c` |
| Exact native recipe | `a454b52a8c6fae157b154d203ee7c976e93f6bb99e75e1565ac8982692038a45` |
| Unchanged program | `c5eef9f5c5bdce78790002f0a753684c6dfb3e42fb4b68f0b0b7d5fcbd07e9e7` |
| ROOT singleton admission | `981670d3d8a5631be4b15daf02b8e914ccba72bbc70eabcf909fb4095a891971` |
| Actual tool return | `e55e315dd12bcea1838cebdf1beaa47acca343af74c1230dcf1e5dd0dd597721` |
| Immutable actual-result freeze | `37065c97890248961352332dc1a85ac252ecc4d6cd673a98f2706167b617d4d6` |
| Independent actual facts v2 | `ecc54f059aa9e133cc974aa73662ac2b8eaff3814016440c74f327f1684fbbe9` |

Static audit `55dad5` exited 0 with no errors. It independently rehashed 1,975
result assets, all 88 packet entries, 584 current source files, 73 source
snapshots, 199 inherited record snapshots, 4,294 prior packet/result entries,
2,544 dependency payload files, Node, two locks, and four reuse links.

It checked all 1,626 captured V8 source bodies, acknowledged debugger setup and
shutdown, disconnection before history, the binding seal, and both evaluated
module inventories. It derived all 338 selected loader-to-V8 binding rows and
matched the verifier output. All 17 required instruments and three production
entry modules were evaluated before history. This binds the receiving worker's
source and execution. It does not assert parent V8 binding. Parent evidence is
its frozen disk source plus the actual parent comparison stack and result.

The first static audit attempt (`1b6d99`, exit 1) had a reviewer schema mistake:
`signalPresent` lives in provider detail's `options`. The v1 script and separate
schema-error receipt are preserved. Additive v2 corrects only that lookup. This
reviewer error supplies no product evidence.

## Decisive receipt order

The 328 raw receipts and 306 boundary events have consecutive sequence numbers.
Raw sequence numbers below differ from the embedded boundary sequence.

| Raw sequence | Observation |
| --- | --- |
| 186 | Complete ready baseline: roots 1 and 2, ranks 10 and 20, child arrays [101,102] and [201,202]. Settled window offset 0 / limit 2. |
| 190 | Original imperative window request asks for limit 3. |
| 212 / 213 | Exact marker request [3], request 2 / initiating load 2, then its nonliteral Promise load return. |
| 240 / 241 | Exact child request [3], request 2 / initiating load 2, then its nonliteral Promise load return. |
| 291 | Held-window cut: both requests pending; original window Promise pending; public baseline and settled metadata intact. |
| 293 | Marker request 2 rejects with registered `baseline-source`. |
| 294 | Its original applied-load receipt rejects with that same registered error. |
| 295 | Driver's identity and chronology checks emit `baseline-source-failure-applied`. |
| 296 | Marker demand rejection is observed. |
| 300 | Root forward output commit returns literal true. |
| 301 | Boundary 286 root callback: public insert root 3, rank 30, children []; synchronous root read is [1,2,3]. |
| 302 | Normalized root delivery records the same three rows before calling the live checker. |
| 315 / 316 | Later downstream callback/delivery records the same three rows; no independent credit after the root checker throw. |
| 317 | `flush-throw`, after the first bad root callback. |
| 321 | Later source-failed-peer cut still shows three rows with settled limit 2, ready status, request error, pending original operation and pending peer. Retained as contaminated follow-on evidence only. |
| 322 / 324 | Cleanup starts; the child load settles only during cleanup. |
| 327 / 328 | Positive worker cleanup followed by the final public-cut checker error. |

The peer request receives no answer or injected failure anywhere in the trace.
Its applied-load receipt first settles at raw 324, after cleanup. Both exact
live pending receipt premises were established before raw 291 by the repaired
request-window checkpoint. The original failed-premise run remains distinct:
there, the held cut had zero provider answers pending and the exact requests
appeared only during teardown. It supplied no product RED.

The fixture query is an ordered LEFT anti-join against markers with an inline
child include. Root 3's remote marker is present in the finite provider facts.
Its provisional anti-join membership and empty include are private candidates;
the old complete public window already exists. No missing child answer is
needed to preserve that old window. This review does not require a new remote
fetch, forbid cache reuse, or assert that exact request shapes are universal.

## First observation versus test interference

Fixture lines 507–527 read the public root Collection inside its subscriber and
record the event. Driver lines 237–243 emit `completion-baseline-delivery`
**before** calling `deliveryCheck`. The checker's first root-content comparison
at line 1721 rejects the extra root. The callback's three-row observation thus
precedes the test exception.

Native stderr distinguishes two things:

- The expected QueryCollection warning for injected `baseline-source`.
- An unhandled rejection from the test's callback-content assertion, through
  `callbackCapture.capture`, Collection event publication, graph flush, and
  `CollectionConfigBuilder.failDemand`.

The host-error recorder listens to browser error events and
`uncaughtExceptionMonitor`, not `unhandledRejection`. The absence of a raw
`completion-host-error` receipt does not show that no test exception escaped.
The live checker throw may change the graph continuation, its Promise outcome,
or downstream scheduling. Therefore raw 321 is not a second independent defect,
and the original operation remaining pending there is not a proven product
settlement violation.

The parent separately consumes the immutable delivery receipt. Its baseline
test calls the same delivery checker. The supervisor retains the first parent
observation error and requests SIGKILL. The captured stack names that actual
comparison. The native outcome is `reason: observation`, `signal: SIGKILL`,
`exitCode: null`, bound source, no cleanup errors. The outer command returns
exit 1, has no heap/signal or outer limit trigger, and records zero remaining
owned groups and zero cleanup errors. Saved named-process/group checks report
ESRCH; this review did not repeat probes. Finite time/RSS limits are containment
bounds, never product deadlines.

The prior default-sandbox `kill EPERM` remains a separate historical containment
limit. This elevated run's SIGKILL outcome does not establish the earlier OS
cause, repair the old context, or prove all future failure-kill paths.

## Smallest primary-oracle closure plan

`docs/contributing/oracle-coverage.md` lines 2377–2399 assigns general
ordered-window rows and publication to
`packages/db/tests/query/pagination-oracle.property.test.ts`. The ordered-work
opening repeats that ownership. Ordered-lifecycle's opening explicitly records
multiple pending joined plans during a move as an omission; the coverage map's
ordered-acquisition owner entry records the corresponding missing witness.

The primary pagination owner already has an independent ready-baseline
failed-window rule. `runPendingMutationScenario` starts a ready baseline for
rejection scenarios, records public cuts without throwing into callbacks, and
at lines 2211–2226 requires its complete baseline rows and settled window while
that window stage fails. Its current driver has one pending ordered source.
The pending-history lane has no response-failure dimension and starts before
initial publication. Neither reconstructs this ready move with one dependent
source failing while another remains pending. This is a missing history/path
dimension, not authority to relax the existing baseline rule.

1. Extend that primary ready-baseline window grammar with dependent acquisition
   shapes. The minimal reconstructing shape is the actual ordered anti-join
   plus inline child include. Keep the finite recomputation and old-snapshot
   rule independent of production demand classifiers. Share the law and
   comparison with receiving drivers; do not make another expected-results
   model in a receiving test.
2. Generate a ready baseline, a widening or offset move, held required marker
   work and held include work. Vary which required source fails, its failure
   before/after peer application, and peers pending versus already settled.
   Vary marker membership and child nonemptiness so empty canonical values do
   not accidentally hide publication. Include translated/scaled ranks, both
   directions, and one/two newly reached rows within small finite bounds.
   Preserve successful complete publication and failed-then-explicit-retry
   neighbors. Add broader ties or additional plan kinds only when needed to
   distinguish the proposed repair; do not multiply unrelated axes blindly.
3. Declare reach with `createOracleReach` separately for each controlled and
   receiving path: ready old snapshot; imperative move pending; both exact
   required live acquisitions/receipts pending; one failed while peer remains
   pending; old snapshot compared at every callback; and coherent retry after
   the failure. Report counts from fixed and random campaigns, plus direct
   replay inputs. A legal cached/batched implementation that lacks a requested
   fixture scope is an unreached premise, not a reason to force acquisition.
4. Use the primary owner's existing nonthrowing capture pattern. Snapshot raw
   public rows, native keys, full values, order, changes, synchronous reads,
   settled-window metadata, operation outcomes and error identity. Preserve
   callback order and partial output; compare after capture outside production
   callbacks. Keep primary failure and cleanup diagnostics distinct. The real
   QueryClient / Query DB driver must reuse these judgments and reach the same
   premise before production changes.
5. Run the extended primary owner and receiving driver on unchanged production.
   Require RED at the first forbidden callback, not a timeout, setup failure,
   later cut, or assertion-induced stuck operation. Keep this original
   singleton as replay input to the same judgment, with its current callback
   interference honestly recorded. A fresh recorder is needed to independently
   assess settlement and post-failure continuation.
6. Repair production only after those gates. Preserve ordinary lazy-failure
   publication when no imperative move owns a barrier, progressive inline
   materialization, request-error health and ready status, replay failure
   retention, ownership and cancellation, successful atomic publication, and
   explicit retry. The mandatory actual-helper/no-active-public-operation
   neighbor remains required and unreached.
7. Run identical controlled/receiving histories for GREEN. Restore the original
   behavior as a hostile mutant and require the same callback failure. Also
   challenge a one-trace fix that blocks only marker failures and a broad fix
   that freezes every lazy failure: respectively, fail another required source
   and run the no-active-window neighbor. Test swap of which peer stays pending,
   peer settling first, successful replacement, and retry. A production change
   is not closed until the generated dimension and receiving path both kill
   the appropriate wrong designs.

This plan does not claim that every ordinary lazy include is always a required
window participant. The instrument must demonstrate the actual move's required
work and publication gate. The held peer and exact original receipts make that
premise concrete in the reviewed trace.

## Lossless disposition and limits

| ID | Claim | Technical verdict | Action and durable destination |
| --- | --- | --- | --- |
| H02-CHECKPOINT-FIRST-ROOT | Repaired singleton reveals forbidden window publication. | Confirmed at first root callback before checker throw. | `confirmed-open`: primary pagination generated dimension and shared Query DB receiving gate, then production repair owned by ROOT's coordinated work. |
| H02-CHECKPOINT-LIVE-CHECKER | Inline comparison can perturb later behavior. | Confirmed by emitted delivery, source order, stderr and flush-throw. | `confirmed-open`: use nonthrowing public capture before evaluating continuation/settlement; preserve original receipts. |
| H02-CHECKPOINT-LATER-CUT | Later downstream/cut/pending result independently proves another product defect. | No independent credit after test callback throw. | Keep raw evidence; require uncontaminated generated/receiving witness. No product refutation or dismissal. |
| H02-CHECKPOINT-AUDIT-SCHEMA | Reviewer's initial static checker used wrong signal field location. | Reviewer-only schema error; v2 succeeds with no audit errors. | Preserve v1/error receipt and additive v2; no product or runtime inference. |

There is one confirmed product finding and one confirmed instrument finding;
none is fixed by this review. The later-cut claim remains an evidence gap,
not a second confirmed defect. This diagnostic loss accounting is complete;
authorized implementation and oracle closure are not complete. This is a
review-only scope, not an agreed deferral of the coordinator's repair work.

All 20 candidate raw states remain UNREACHED. State14 cleanup mapping remains
proposed/unadopted. The actual-helper/no-active-operation neighbor remains
required and UNREACHED. Metadata is separately owned. Remaining 13 baselines
are unrun. No canonical accounting, candidate admission, implementation,
coverage-map change, PR readiness, or universal provider claim follows.

The repaired instrument supplied a useful real-boundary counterexample after
its premise defect was corrected. Its callback checker supplies clear first
observation evidence but cannot validate later control flow. No external
human-reviewer hire assessment or whole-PR readiness assessment is within this
artifact's evidence.
