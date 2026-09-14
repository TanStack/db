# Hostile assay: global quiet-read admission

No counterexample was established against the candidate with **all** of its stated coverage, handler-closure, lifetime and admission predicates enforced. An epoch check alone does fail. The unresolved admission and publication boundaries therefore carry real correctness work; they are not incidental bookkeeping.

One source-backed contract tension remains: core error settlement destroys a conflicting **pending manual** sibling transaction. It preserves a **persisting Endpoint** sibling. The candidate's unqualified preservation language does not distinguish these cases. This is an integration conflict under the broader reading, not a new DB-core defect or a demonstrated failure between two normally returned Endpoints actions.

## Audit bounds and evidence

This was a fresh, single-candidate assay. I read the entire Hostile Assay card, the frozen `candidate.md`, and its five named source traces. I did not inspect sibling forms, grammar files, `source.md`, or the other concurrent audit. No production code or tests changed.

Evidence levels used below:

- **Actual source execution:** the real `TransactionScope` and `refreshAfterMutation`, with a stub collection notification target and deferred reads. This proves transaction states and envelope timing, not browser publication.
- **Source inspection:** the named current runtime and oracle driver. The proposed epoch/generation protocol is absent from that runtime.
- **Constructed execution:** small scheduler models of explicitly insufficient admission rules. These are negative controls, not an implementation or falsification of the complete candidate.

Both diagnostic scripts passed their assertions. Receipts: [source-boundaries.json](./hostile-repros/source-boundaries.json) and [scheduler-models.json](./hostile-repros/scheduler-models.json). Scripts: [source-boundaries.mjs](./hostile-repros/source-boundaries.mjs) and [scheduler-models.mjs](./hostile-repros/scheduler-models.mjs). The source diagnostic intentionally fabricates only the mutation fields used by core rollback and stubs notification; it does not exercise real collection snapshot storage.

## H1. Retiring an operation must not erase the evidence needed to reject older reads

**Source premise.** The structural claim uses a local epoch; transitions 3 and 5 also require sufficient effect coverage, and ordinary reads use the same admission boundary. The current `runtime.ts:83–86` records every query result directly, separately from inline installation at `270–282`.

**Admissibility and disposition.** This schedule satisfies stable authority, writes closed within handlers, finite traffic and fresh reads. It refutes an epoch-only or current-outstanding-only implementation. It does **not** refute transition 5 when “sufficient coverage” includes the authority already accepted. The candidate expressly leaves query-adapter admission execution unresolved.

**Minimal failure scene.** M starts, advancing the epoch to 1. An ordinary read Q starts while M is running and observes value 0. M commits value 1 and its valid outcome arrives. A quiet read G observes 1; the client installs G and retires M. Q then returns with captured epoch 1, which still equals the client epoch. If admission consults only the current outstanding set, that set is now empty. Q installs 0 over justified authority 1.

No stale replica, external writer or write after handler completion is involved. Q was truthful when it read. Its arrival is late.

**Evidence.** Constructed execution proves the weak check accepts Q. A retained accepted-coverage comparison rejects it. Current source inspection establishes direct query recording, but the proposed adapter was not executed.

**Repair condition.** Every result must prove coverage at least as fresh as the authority it would replace, even after its covered operations retire. The proof must reach both runtime baseline recording and the query adapter's collection/cache publication. Returning stale rows from a query function after suppressing only `record(rows)` does not establish that boundary. Duplicate deliveries also need this check; retirement must not make an already obsolete delivery admissible again.

**Why sequential tests miss it.** `driver.mjs:431` completes each operation before beginning the next and has no separate gate for an ordinary read's execution versus delivery. Add the law “accepted authority coverage never regresses” and schedules where an initial/refetch result begins during a handler and arrives after reconciliation and retirement. Assert the confirmed baseline and query-backed visible collection independently. Include duplicate delivery after retirement as the same law, not just another example.

## H2. Lifetime equality does not prove target completeness

**Source premise.** Transition 7 requires catch-up for newly retained/recreated lifetimes; the success standard includes every affected non-GCed instance, including late creation and zero subscribers. Reads capture target lifetimes. Current runtime captures retention before invoking the action (`runtime.ts:352–353`), rejects creation while persistence is pending (`174–184`), and skips cleaned-up captured targets (`338–341`). It has no proposed generation protocol.

**Admissibility and disposition.** Dynamic creation is explicitly in the candidate's success standard. Failure results from checking only captured target generations, an unsafe implementation of the stated catch-up obligation. Precise coverage/cohort boundaries remain unresolved; this is not proof that the candidate requires premature settlement.

**Events and consequence.** M finishes. G captures C1 and starts a quiet read. C2 becomes retained while G is in flight; its initial read is still held. No new mutation starts. G returns valid C1 results, and C1's lifetime still matches. A check over only G's target list passes, yet retiring M as covered for all relevant retained instances leaves C2 without coverage. Neither an unchanged mutation epoch nor a generation attached to C1 detects C2's omission.

A related replacement schedule cleans C1 generation 1, creates generation 2, and delivers the old response. Rejecting the generation-1 result is necessary. Catch-up for generation 2 is a separate obligation; rejection by itself supplies no fresh authority.

**Evidence.** Constructed execution demonstrates captured-target completeness can pass while retained-target completeness fails. Current creation guards keep this history out of the existing executable slice. No production lifecycle failure was reproduced.

**Repair condition.** State exactly when a new lifetime enters mutation-coverage obligations and what its initial read must cover before readiness or affected receipts can be claimed. Removal must discharge only the old lifetime. A zero-subscriber retained instance remains an obligation. Generation checks must apply where results publish, not only where requests launch.

**Why sequential tests miss it.** The current driver initializes a fixed program and checks zero subscribers before the operation loop (`409–431`). Add create/retain/cleanup/recreate events between read target capture, read completion, installation and receipt settlement. Assert the set of retained lifetime obligations, not merely equality for collections already present in the expected snapshot. This is distinct from the already covered zero-subscriber static fixture.

## H3. “Install, then retire” does not imply coherent observations throughout publication

**Source premise.** Transition 6 installs authority before retiring specific covered overlays and preserves other whole snapshots. The packet explicitly supplies neither atomic multi-collection publication nor simultaneous overlay retirement. Runtime installs each snapshot separately (`runtime.ts:338–343`). Core retires and notifies transaction by transaction (`transactions.ts:534–577, 659–669`).

**Admissibility and disposition.** The schedules are inside the stable-authority, finite-traffic setting. Their intermediate observations fall within an **explicitly unresolved publication boundary**. They do not falsify a promise of atomicity, because no such promise exists. They limit what “coherent” can mean to consumers.

**Events and consequence.** A server change makes a row completed. Its all-items and completed-items snapshots are both fresh. Publishing the all-items result first allows an observer to see `completed=true` there while the completed collection still lacks the row. Whole-response validation does not prevent this observable mismatch.

For retirement, let accepted authority be 20 and older/newer owned whole-row guesses be 1 and 2. Retiring the newer overlay before the older exposes `2 → 1 → 20`. Authority stays 20 throughout; the intermediate 1 is a still-owned guess. Calling that baseline regression would be false. A callback that starts another action from an intermediate view can nevertheless make that view the input to new work, so “it lasts only one turn” is not a sufficient consumer contract.

**Evidence.** Constructed observer models demonstrate both sequences. Source inspection establishes independent primitive calls. Actual browser or collection notification visibility at every primitive boundary was not tested; batching may suppress some observations.

**Repair condition.** Specify the legal observation boundary for collections, subscribers and transaction receipts, and whether callbacks can dispatch during publication/retirement. Test that boundary. If intermediate views remain legal, consumers must not receive a stronger aggregate coherence claim at that point. Do not silently replace whole-row snapshots with field merges to remove an intermediate view: that violates the preservation requirement.

**Why sequential tests miss it.** `checkpoint` reads a snapshot at selected gates and renders after two animation frames (`driver.mjs:305–334`). Final equality can miss notifications between installs and settlements. Record every observable notification and receipt in a multi-collection, multi-overlay history, including a callback that invokes another action. Assert baseline coverage separately from the visible composition of owned guesses, so legitimate sibling optimism does not become a false failure.

## H4. Failure settlement conflicts with unqualified preservation of pending siblings

**Source premise.** Transition 6 says other transactions' whole snapshots remain owned and unchanged; the success standard preserves sibling snapshots and keeps ordinary collections writable. Core rollback cascades to conflicting transactions whose state is `pending` (`transactions.ts:102–117, 545–552`). Endpoints normally calls commit immediately, placing returned actions in `persisting` (`runtime.ts:384–390`; `transactions.ts:623`).

**Admissibility and disposition.** If “other transactions” includes a manually held DB transaction over the same collection/key, this is a real contract conflict with current settlement. If it refers only to returned Endpoints actions, the tested normal case survives. Manual pending transactions are not expressly excluded in the packet, but the broader reading must be made explicit before claiming a general defect. Core is implementing its documented rollback semantics.

**Events and consequence.** Endpoint-like A persists. The caller holds manual transaction P pending on the same global key. Endpoint-like B also persists on that key. A's mutation function records the point where partial-commit authority would have been installed, then throws the handler error. Core fails A and cascades failure to P, while B remains persisting. P loses ownership without its own handler outcome or coverage being the cause. Finishing B still succeeds.

**Evidence.** Actual source execution confirms states `persisting/pending/persisting → failed/failed/persisting`. The “authority installed” event is a marker, not a real collection write. The finding does not depend on a claim about resulting row rendering.

**Repair condition.** Resolve whether pending ordinary DB transactions are in the sibling-preservation contract, then establish a settlement behavior consistent with that answer. Do not claim all siblings survive merely because every Endpoint action calls commit immediately.

**Why sequential tests miss it.** The oracle has one active Endpoint operation and no manual pending sibling. Add transaction-state as a generator dimension: pending manual, persisting Endpoint, non-conflicting, and conflicting keys. The missing law is preservation of ownership for the expressly supported sibling class when a covered handler fails after a partial commit. Test both failure and successful settlement; retain the persisting-sibling case as a control against overbroad claims about cascade.

## H5. A quiet read cannot resolve an unknown handler, and receipts cannot stand in for handler knowledge

**Source premise.** Transition 2 distinguishes a valid handler envelope from failed transport; transition 4 waits for handler knowledge rather than persistence receipts. Unknown-outcome exits and operation-status lookup are expressly absent. Current `refresh.server.ts:23–46` learns handler outcome but returns it only with read completion; `runtime.ts:384–388` tracks pending work through persistence receipts.

**Admissibility and disposition.** Two distinct issues must stay separate. With eventual valid envelope delivery, the current combined response merely delays knowledge; it is **not inherently a deadlock**. Waiting on persistence receipts to start the very read that resolves them would create a cycle, but transition 4 explicitly forbids it. A permanently missing valid outcome is an **acknowledged excluded/incomplete recovery boundary**, not a refutation of the finite valid-envelope success path.

**Events and consequence.** A handler commits and the server starts a slow inline read. The client cannot yet learn the handler outcome from the existing helper. If a new coordinator substitutes “all persistence receipts settled” for “all outcomes known,” it never starts the reconciliation needed for those receipts.

For transport uncertainty, a rejected request and a fresh read returning 0 are compatible with both: (A) the handler already stopped without writing; (B) the handler is still running and commits 1 after the fresh read. A read observes data, not handler closure. Dropping the unknown entry because a request rejected permits premature coherence in B. Keeping it unknown safely blocks global reconciliation, including receipts of later healthy actions, until some additional closure evidence exists. Retrying a write is not justified by either observation.

**Evidence.** Actual execution of `refreshAfterMutation` observes `serverWriteClosed=true` and `envelopeDelivered=false` while its read is held, then a valid success envelope when released. The two indistinguishable unknown-handler worlds are constructed. No transport recovery protocol was executed.

**Repair condition.** Keep operation knowledge independent of DB receipt state and local overlay state. Define what counts as eventual valid outcome delivery in the finite-success premise; transport settlement alone is insufficient. Any future unknown-outcome exit needs a closure argument or an explicitly unresolved state. A user's rollback of a returned real Transaction must not, by itself, prove its remote handler stopped or clear dirty obligations. Exhausted reads must preserve the independent handler outcome even if a local receipt rejects.

**Why sequential tests miss it.** The driver holds reads and correctly requires persistence to stay pending (`driver.mjs:474–514`), but valid combined responses eventually arrive. It reloads after exhausted reads (`576–578`), erasing the old runtime and its obligation state. Add valid success/error outcomes crossed with lost/malformed envelopes, local rollback, later healthy operations, and read recovery without reload. Assert no write retry, no unknown-to-known transition from transport failure alone, retained dirty obligations, and distinct handler/read outcomes. Rejection of `isPersisted` is not itself an assertion of server rollback.

## Attacks rejected by the candidate's own bounds

- Two overlapping handlers returning snapshots in reverse order do not defeat the protocol when their uncertain inline snapshots are withheld and a full quiet read follows both known outcomes.
- Partial commit followed by handler error is not new rebutting evidence: the candidate requires authoritative coverage before error settlement and preserves committed results.
- New relevant mutations during a read require discard. A model that accepts anyway tests an expressly forbidden implementation.
- Endless traffic, external writers, stale replicas, changing auth domains and post-handler writes cannot be used as in-premise counterexamples. The packet excludes them or makes contrary assumptions.
- A still-owned whole-row sibling guess obscuring new authority is not automatically stale authority. Reinterpreting it as a forbidden merge would attack a different design.
- No change proposed here requires or demonstrates a loss of API/server source exclusion. That independent existing test gate remains relevant.

Each attack above has a disposition: H1/H2 require execution evidence for already stated admission obligations; H3 is a disclosed observation boundary; H4 needs resolution of the supported ownership scope; H5 is a disclosed knowledge/recovery boundary with a demonstrated current transport timing constraint. No architecture revision, candidate ranking, or production-concurrency proof is supplied by this assay.
