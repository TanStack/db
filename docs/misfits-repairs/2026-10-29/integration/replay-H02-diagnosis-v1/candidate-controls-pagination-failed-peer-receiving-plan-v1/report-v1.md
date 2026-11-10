# Nonthrowing real QueryClient receiving successor plan

This is a source-only plan. The current primary freeze `cf550f0a80c400acb8a151f58f5692ba3f1442dc5122027b42b2160f76179eec` remains unchanged. Root requires the exact current primary RED run to finish and freeze before any successor edits. The containment author is sealing that prior epoch; this plan grants no runtime admission.

## Accepted boundary

Atomic window publication keeps the last settled complete public snapshot when required refinement fails. The decisive existing real QueryClient evidence is the first root callback at raw301 / boundary286, delivered at raw302: it shows three public roots, including the new root with empty children, while the settled window has limit 2. That capture precedes the checker exception. Later downstream reads, cut321 and pending operation observations are contaminated follow-ons. They remain preserved separately and supply no independent failure or settlement verdict.

The new receiver must establish the same failure-first history without a checker exception changing the production callback. It must compare at a measurable first failure-processing checkpoint while the original peer is still held, before peer release and before awaiting the window operation. There is no numerical product deadline.

Root's possible `failDemand` / asynchronous window-failure-handler ordering explanation remains a hypothesis. It supplies neither a model rule nor a prescribed production repair. Ordinary post-ready lazy-load failure publication (architecture law 16) remains accepted. Success with a pending peer remains a separate required neighbor.

## Minimal shared extraction

Add one nonregistering oracle companion beside the primary pagination oracle. It has only these responsibilities:

1. Export the existing `referenceWindowRows` unchanged, with the same NaN handling, primary direction, ascending public-key tie-breaker, offset/limit slice and projected id/rank result. The primary imports it in place of its local definition. No test module becomes a dependency of receiving.
2. Add a clearly scoped pure child-aware recomputation over finite root, marker and child facts. It removes marked roots, calls that same ordered-window reference, then derives each included child-id array from independent facts in ascending child-id order. It stores no production loader, cache, graph, request or operation state.
3. Export one retained-snapshot judgment that compares actual full rows and actual settled-window value with the independently derived previous snapshot. It preserves missing/undefined windows as representable violations. It makes no callback-count or numerical progress promise.

The primary joined-failure extension uses the full-child recomputation for baseline, retry and success, and copies full child arrays in callback/current-read captures. It calls the shared retained-snapshot judgment at the existing pre-peer-release checkpoint. Success/retry callback content may be the complete prior or complete replacement row snapshot; it must not accept the replacement root ids with missing children. Terminal window metadata is checked after operation fulfillment. Do not invent a stronger successful-callback metadata timing law.

The completion companion's `modelCompletionRows` delegates its existing finite ascending-row prediction to this same recomputation. Its lifecycle model and unrelated completion laws remain unchanged. Its existing rich delivery checker then derives expected rows from the primary reference instead of restating the row model. Receiving also invokes the primary retained-snapshot judgment directly for root/window captures at the barrier. This is one shared semantic row model and barrier judgment, with a supplemental existing event-replica law.

The exact prior QueryClient failure recipe reconstructs the primary pinned scenario: rankOffset10, rankStep10, ascending, initialLimit2, pivotMarked true, tailCount4 and tailMarked true; the schedule is failure-first. Freeze and check the fact/window mapping. Reuse that authored input. Do not derive expected facts or demands from production's selected requests.

## Reuse receiving mechanics

Reuse `createCompletionFixture`, its real QueryClient and QueryDB providers, original source-load attachments, operation observer, durable receipt transport and existing fixture teardown. Keep the current inline topology. A new scheduler, cache model, generalized history interpreter, or native launcher is unnecessary.

The receiving successor changes callback processing in `queued-answer-completion-baseline-driver.ts`. Its raw sink records the event, sequence and already-authored epoch, then returns. It performs no expected-epoch lookup, projection assertion, `need`, delivery comparison or event-replica check inside root/downstream callbacks. Deferred normalization and comparison run when the driver closes the explicit observation interval. Retain raw callback lists; do not replace them with a last-value map or discard duplicates. Preserve initialization callbacks separately so event replicas can start empty and consume the actual insert stream.

At the handled-failure checkpoint, drain all captured callbacks in original sequence and compare each layer's installed read with its expected complete rows. Invoke the same primary retained-snapshot judgment for root rows and settled-window captures. The root callback need not have advanced downstream yet. Check each downstream callback against its own layer; check both public reads and event replicas at the barrier. Rich event copies retain every message, key, full value and full previousValue separately. Reconstruct event membership and values with the existing checker; a final correct read does not erase an earlier torn callback or malformed event. Metadata remains independently owned.

The parent runner must also keep semantic mismatch from becoming an observer exception that triggers supervisor reason `observation` and kills an otherwise-running child. Its receipt callback retains the first semantic mismatch, returns normally, and keeps recording until worker cleanup/finalizer and process outcome are available. It then fails with that mismatch and separate cleanup/finalizer diagnostics. Operational source-binding, transport, heap, RSS, wall and process failures retain their current classification. A missing finalizer, ignored mismatch or incomplete receipt stream cannot become GREEN.

## Physical premises and observation order

Before failure injection, store the exact marked provider request and exact child provider request selected by the authored pivot scopes. Bind each through its existing `appliedLoad`, source, generation, queryKey, options and original nonliteral-true receipt. Preserve object identity and all bound loads from `establishingLoads`. Require every bound load's outcome and settledAt to be undefined, its signal un-aborted, and its exact physical request not answered. Require the original wider setWindow promise to be pending. Both scopes are checked against authored finite facts, not inferred ownership.

Then reject the exact marked provider request with the authored Error. Observe rejection of every establishing original core receipt with that exact Error, with receipt-settlement sequence after provider-failure sequence. Require `live.utils.lastSubsetError === authoredError`. That handling observation prevents an ignored rejection from passing a silent baseline comparison. A host turn, if needed to reach the production processing checkpoint, is a scheduling cut and not a product timeout.

Recheck the same stored child request and every original child receipt immediately before the comparison: unanswered, outcome undefined, settledAt undefined and signal un-aborted. Record their identities and the handling sequence in one barrier receipt. Compare captured callbacks and current public rows/window before releasing that peer and before awaiting setWindow. Record a diagnostic callback count without requiring a row callback from a correctly retained unchanged window.

The held-peer condition is a measured premise of unchanged-production RED. It is not an independently accepted no-cancel law. For later GREEN, legal retirement/cancellation of the peer must be classified separately from a publication violation, while old-snapshot and own-operation obligations still apply. Do not force another fetch or weaken the row comparison to preserve this exact acquisition.

After a passing barrier comparison, release the peer, observe the original operation separately, compare retained state, and perform explicit same-target retry with complete child facts. Peer-first failure and success-after-both-answers are neighboring histories using the same shared model. These later cuts receive credit only in an uncontaminated successor; the old run supplies none.

## Failure and cleanup

On the first deferred semantic mismatch, preserve raw callback prefix and barrier premise before teardown. Stop subsequent semantic history actions; do not answer the held peer merely to manufacture a complete operation. Keep raw cleanup observations distinct from publication. The existing fixture unsubscribes, cleans downstream then root, restores wrappers, cleans source Collections and clears the real QueryClient. Record cancellation and outstanding work honestly; fixture cleanup is not proof that an ignored provider promise settled.

Retain the first semantic mismatch as primary. Preserve secondary cleanup exceptions, failed finalizer/receipt close, nonzero process outcomes and incomplete binding diagnostics separately. Emit a positive worker-cleaned receipt only after successful actual teardown. Semantic comparison never throws from production callbacks. Only after cleanup and receipt closure does the worker/parent fail the finite test. The existing native bounds and process-group ownership remain unchanged unless root separately freezes and admits a successor recipe.

## Source corrections and execution sequence

The independent reviewer has identified these requirements for the successor, without requesting a mutation of the current frozen packet:

- Full child payloads in primary success/retry comparisons; id/rank alone cannot close complete-publication behavior.
- Explicit direct-replay argv whose `-t` selects only the random-or-replayed new family. PROPERTY/SEED/PATH alone leave older unwrapped tests eligible. The unique leaf is `retains complete windows across joined failure histories for a random or replayed seed`. Retain actual seed/shrink path from the admitted failure before crediting replay.
- Treat post-failure peer retention as measured RED reach, not a new product no-cancel rule.

After root reports the current primary outcome frozen: announce the successor edit boundary to the source reviewer and containment author; make the minimal shared extraction and receiving change; preserve all existing run budgets; run direct installed static validation and both source-feedback/report-worktree lint; freeze changed primary/shared/completion bindings in an additive successor; obtain exact-source independent review; prepare exact primary and real receiving RED recipes for root admission. No production edit precedes both clean RED witnesses. No old packet/result is rewritten. All raw20, remaining13 and actual-helper/no-active-public-operation states retain their current UNREACHED/UNRUN status; metadata receives no transferred credit.
