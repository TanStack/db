# Independent H02 diagnostic review v1

Reviewed 2026-10-29 by `/root/review_h02_liveness`, independently of the
diagnostic author's verdict. This is a read-only source and receipt review;
the only new artifact is this report. No runtime tests, production changes,
oracle changes, commits, or canonical status edits were made.

## Verdict and scope

The reconstructed historical source has a credible, source-explained
nonmonotone demand feedback problem. The packet establishes repeated actual
acquisitions and unloads after initial preload settled, with stable identities
and cache cardinality. Its queued-completion controls materially weaken the
explanation that the driver simply forgot to answer its provider.

This is not yet an executed liveness oracle, an identified retained-publication
violation, a completed receiving witness, or a bug-class closure. Keep historical
H02 unverified/excluded. In particular, the original historical OOM phase and
allocation cause remain unknown. The fresh raw reconstruction OOM and the
instrumented post-preload feedback are distinct observations.

The immediate engineering issue is progress at the interaction between the
graph, demand-derived Query ownership, and cached result application. The
accepted ownership law must remain intact. Dropping cached data while stale
refetch runs is not authorized by these receipts.

## Materials and identity checks

- Coordinator head read: `82c5f999b32c9db827dd74e3f172604dfda28013`.
- Executed source under review: reconstructed archive
  `3937a73aeb3a273c95ab77b8d8dd66fc739517c5`, in
  `/private/tmp/replay-h02-diagnostic-mo8pxcv_`.
- Packet: `diagnostic-freeze-v1.json`, all E01–E11 receipts and relevant raw
  logs, frozen drivers, aliases, runner, source manifest, and the archived
  `replay/receiver-partitioned-cache-oom.ts`.
- Independently recomputed hashes: all thirteen frozen driver/config/runner
  inputs match; all 161 reconstructed source manifest entries match; the four
  critical production hashes match; the manifest's own hash matches; raw
  driver bytes equal the archived receiver bytes.
- Runtime versions are recorded as Node 24.19.0, Query Core 5.90.20, Vitest
  4.1.12 and Vite 7.3.7. This review did not re-execute those runtimes.

The source aliases are explicit. This is evidence about the reconstructed
source path with the recorded dependency clone. Original historical built
bytes are unavailable; neither exact historical process identity nor the
current integrated tree is established.

Required reading included the oracle-review skill, rubric, glossary, full
live-query architecture, and relevant coverage-map owners and limits. The
roughly 892 KB coverage map was searched and its Query ownership, includes,
ordered-acquisition and ordered-refetch entries read; this is not a full
portfolio audit.

## Finding 1: the observed custom key and provider scope are legal

Authority: Query Collection docs, “Using Query Key Builders” and “Query Key
Prefix Convention” (`docs/collections/query-collection.md:1564–1610`), and the
architecture's Query ownership boundary. Function-built keys retain their
caller-defined cache identity. The docs require a common base prefix and all
options that alter the requested data; they do not require equivalent
subscriptions to share one cache entry.

The key returns its documented prefix for `{}`. Derived keys add a stable
number assigned to the subscription and the complete requested key set. The
request predicate is evaluated against the fixture's finite five-row domain.
Every observed marker demand has no order, limit or offset. Returning every
marked row satisfying that predicate therefore fulfills this provider's exact
request, and the requested key set is sufficient to identify its data scope.
No request data is mutated. Separate historical responses for the same scope
are possible because the provider changes between requests.

E09 shows exactly two subscription identities and eight cache entries
throughout the repeated prefix. The same include identity reacquires `[3]`.
There is no key explosion or serialization of a subscription graph. The raw
driver retains request options and a spy; E06 removes those retained graphs
and the spy and still reaches the repeated prefix. That excludes those
recorders as necessary causes of the operational feedback. It does not profile
their contribution to the raw OOM.

The provider does not consume Query's fetch signal or write rows directly.
Unobserved Query work may continue in this path: the adapter's own unload
contract explicitly allows ordinary in-flight requests to remain cached. An
ignored signal by this controlled fetch is not evidence of request-scoped
Collection writes after cancellation. The eventual real-network receiving
boundary remains outside this fixture.

Limits: the key projection is justified only for these recorded predicate-only
demands. A general provider must include its order/window/cursor dimensions.

## Finding 2: the source supplies a concrete feedback mechanism

The smallest distinguishing recorded scene is E09 events 78–98:

1. The join's `[3]` fetch finishes with no row; its active owner keeps an empty
   result. The include's retained Query cache still contains row 3.
2. Before include acquisition 13, `markers.has(3)` is false. The anti-join and
   window can therefore expose root 3 and demand its correlated include.
3. Include acquisition starts one held stale refetch but applies its latest
   successful cached row. Before its unload, `markers.has(3)` is true.
4. That row now matches the join, so root 3 loses the anti-join and its include
   route retires. Unloading its sole row owner deletes marker 3.
5. Before acquisition 14, marker 3 is false again. The same route and demand
   return, without a new external answer. Later cache state stays
   `owner0/[3] = []`, `owner1/[3] = [3]`, with the latter fetching.

This scene is explained by the frozen historical source, not a second model
copied from its queues:

| Boundary | Frozen source location and relevant behavior |
| --- | --- |
| Route to acquisition | `packages/db/src/query/compiler/index.ts:868–895`: the parent-key `tap` calls the source's `setDemand` callback. |
| New and retired demand | `packages/db/src/query/live/subset-demand-controller.ts:68–173`: changed nonempty keys start a snapshot; empty keys release its segments. |
| Query cache application | `packages/query-db-collection/src/query.ts:2343–2409`, `3360–3397`: a recreated observer subscribes and immediately processes its current successful result. |
| Row support | `query.ts:2727–2818`: applying that result adds its explicit owner, inserts an absent row, and commits. |
| Final release | `query.ts:3488–3558`, `3568–3640`: idle cleanup removes ownership and commits deletion when no owner remains. |
| Source changes back to graph | `packages/db/src/query/live/collection-subscriber.ts:271–289`: source messages enter D2 and schedule graph work. |
| Synchronous drain | `packages/db-ivm/src/d2.ts:59–75`: `run()` repeatedly runs operators with pending input. `collection-config-builder.ts:820–885` suppresses nested graph runs and drains remaining synchronous input. |

The graph is acyclic as a relation graph, but its demand side effects feed
source changes back into its inputs. With only the include able to own row 3
at this cut, a simplified relation is: marker presence equals include demand;
include demand equals root-3 visibility; root-3 visibility requires marker
absence. There is no stable Boolean assignment while that retained cached
result remains the include's result. This abstraction names only this local
counterexample; it is not an implementation model or a universal claim.

Repeated operations therefore need not mean recursive JavaScript stack growth.
The source can cycle inside a graph fixed-point loop while its explicit
reentry guard prevents nested runs. The receipts do not include a sampled
runtime stack at the repeated acquisition. The exact drain frame is therefore
a source-supported explanation, not measured stack attribution. One bounded
stack sample at an acquisition in the prefix would resolve that remaining
mechanism detail without throwing from an adapter callback.

## Finding 3: these results do not reach the intended judgment

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| E01 | Unchanged raw driver exhausts a 384 MiB heap on reconstructed source. | Original historical built-process cause, phase, or a failed public-value comparison. |
| E02 | Instrumented preload settles at 8 acquisitions / 8 fetches; a finite repeated prefix follows. | A clean pass: Vitest intercepts the `process.exit(86)` cap and reports four errors even though its test line says passed. |
| E03–E06, E09 | Bounded actual load/unload feedback survives spy and retained-history ablations. | A comparison failure or measured retained-space violation. These terminate at the diagnostic event cap. |
| E07, E08 | Removing the include, or removing order/offset/limit, lets the two-answer diagnostic finish. | A repair GREEN, equivalence proof, or isolation to one source helper. The no-window control changes provider demand scopes. |
| E10, E11 | A timer or microtask is queued inside fetch 13; repeated operations continue before either callback executes. | An infinite-execution proof or a numeric public latency bound. The sentinel blocks only after event 128. |

In E10, the completion timer is armed at 31.116 ms and no completion fires
before the last event at 40.229 ms. E11's queued microtask is armed at 25.793 ms
and remains unexecuted through 32.662 ms. A queued microtask is particularly
useful here: it does not depend on the driver's next timer-based
`flushPromises()` returning. The finite prefix is consistent with a
synchronous turn monopolizing execution. No fresh provider answers occur in
that prefix after the one held include fetch starts.

The original receiving driver calls `checkRetainedPublication` only after
control returns to its loop and it finds the late acquisition. None of these
diagnostics completes that intended cut. Its reach declaration grants no
receiving credit. OOM, process-exit errors and supervisor kills are runtime or
containment outcomes outside the refinement comparison, as ORC-005/006 require
us to distinguish.

## Authority, tension, and repair location

The accepted cached-ownership law at
`packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts:961–975`
requires a reacquired lease to own its last successful result while a stale
refetch is pending. A failed refetch keeps those rows. This law is not the
defect merely because it contributes to the cycle.

Architecture laws 9–11 require coherent publication, current demand handling,
and explicit ownership. The shared source's join/include publication barrier
is specified at `ARCHITECTURE.md:1531–1542`. Law 13 is a retained-space law;
these receipts alone do not show its retained-state bound was violated. They
also do not establish a publication mismatch. A finite prefix cannot prove
universal eventual completion, as the rubric explicitly cautions.

The natural product progress obligation is that a finite legal source step
must return to an asynchronous waiting cut, so already queued provider
completion can run. Async subset loading and preload/reload contracts depend
on that capability, but the inspected architecture does not spell out this
compositional fairness law or a numeric acquisition budget. State that law and
its authority before a production repair. Do not silently assert that every
combination of incompatible cache results has an immediate stable fixed point.

Applying the repair-location table:

- **Production candidate:** if finite-turn progress is an accepted obligation,
  prevent synchronous demand/cache ownership feedback from monopolizing the
  turn, while keeping ownership and publication correct. The evidence does
  not select a specific queue, scheduler, acquisition, or Query repair.
- **Evaluation repair now:** retain a bounded receiving witness with observable
  progress and public-value cuts; the current capped diagnostics cannot carry
  retained-publication or class-closure claims.
- **Contract decision if needed:** specify ordering or retention when legal
  cache scopes give contradictory answers and no provider result will resolve
  them. For example, infinite freshness or a failed stale refetch is a useful
  adjacent challenge. Changing cache identity, cached ownership, or immediate
  retirement policy is a product decision, not an expectation adjustment.
- **No demonstrated missing-information repair:** the fixture already supplies
  the pending answer and queues its completion. Additional source facts alone
  do not explain why the current turn cannot reach them.

Yielding while preserving the replay barrier is a possible implementation
direction to investigate, not a reviewed solution. An unconditional yield
would need controls for the architecture's literal-`true` initial synchronous
cut and ordinary synchronous publication. A retry cap that silently declares
success would violate the existing publication/readiness laws.

## Why the existing owners do not establish this composition

The Query ownership model correctly checks the union of latest successful
results for independently controlled leases. Its reacquisition table at
lines 5224–5322 performs explicit load/unload steps; no anti-join route derives
the lease's existence from rows that the same lease inserts or deletes. Its
result-settlement opening also explicitly excludes observer scheduling.

The include temporal owner checks controlled source demand incarnations and
readiness. Its documented omissions exclude arbitrary route churn and real
provider receiving behavior. The ordered-refetch owner has a real QueryClient,
anti-join/window plans and static/function keys, but the inspected grammar has
no correlated include over that same Query Collection with an independently
retained conflicting cache result.

The ordered-work coverage entry additionally records a directly relevant
observer limitation: a loader may repeat a prefix without reaching the
provider, so its provider-request budget cannot see that loop. Here fetch
count stops at 13 while acquisition/unload count continues. Raising a provider
request budget would not repair this gap.

This is a missing composed history and observation boundary, not evidence that
any of those owners' independent row laws are false. Primary responsibility
should join the replay/publication receiving boundary with Query ownership;
ordered work supplies the progress observation. Do not create a duplicate
cache-ownership model solely to cover this receiver.

## Smallest oracle-first follow-up

1. Freeze the finite-turn progress law and its observation cut. Keep the
   original historical H02 record separate from this reconstructed witness.
2. Reuse a finite relation recomputation for the anti-join/window/include
   result, a small explicit lease-to-last-successful-result relation for
   ownership, and the existing retained-snapshot comparison. Keep cache
   versions distinct from current backend rows. Do not copy D2 passes or
   controller retry states into expected results.
3. Generate the composed premise: one source read both by an anti-join and an
   include, bounded window, a retained nonempty include result, an empty newer
   join result, and an already queued provider completion. Declare separate
   reaches for that cache disagreement, reacquisition during refetch, and the
   queued completion. Existing plain semantic-key and no-include controls
   remain useful adjacent histories, not replacement receiving paths.
4. Observe whether the provider completion gets its cut, then compare exact
   public rows/events, replay retention, final result and ownership release.
   Count actual acquisitions and unloads as well as fetches. A watchdog must
   be outside the worker; classify its firing as a progress timeout, never as
   a successful row comparison. Avoid choosing 128 as product policy merely
   because the diagnostic used it.
5. Obtain pre-edit RED on the actual receiving path. Preserve the original
   source as a hostile mutant after repair; require the same progress failure
   and intended subsequent comparisons to distinguish it. E01–E11 do not
   already discharge this gate.
6. Vary cache empty/nonempty, compatible/separate identities, freshness and
   refetch failure, offset 0/1 and width 0/1/2, earlier unmatched rows, both
   reload answer orders, peers, retirement, and cleanup. Include a cached
   ownership control and literal-`true` synchronous-load control so a repair
   cannot win by dropping cached rows or deferring every synchronous result.

No closure claim is warranted until the accepted law, measured generated
reach, pre-edit receiving RED, repaired GREEN, hostile mutant, and remaining
in-scope limits are recorded. No new experiment was executed for this review.
