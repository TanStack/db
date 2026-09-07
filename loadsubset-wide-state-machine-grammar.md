# Design grammar: local state and ownership

This run reconstructs the frozen system as several overlapping protocols. Its repeated flags do not all describe the same lifecycle. Logical demand, physical acquisition, source settlement, public replacement, and accepted window state have different owners and end at different times. Two generated forms below change local representations while preserving that distinction. They are samples, not ranked proposals or implementation recommendations.

## Source and method boundary

Instrument: **Field Lab Design grammar extractor**, state-machine lens. One executor kept the source arrangement, candidate grammar, reconstruction, and forms in one context. No source-review delegation, sibling output, earlier design report, history survey, production edit, test edit, test execution, network request, commit, or push was used. Incidental TODO text in source was not treated as a conclusion or design requirement.

The specimen is commit `1cec4d7f4669d1708800937a48eda0de8e9edaf9`, read with `git show <commit>:<path>` in `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`. The full scoped files, including inherited implementation, were read. Root and worktree `AGENTS.md`, the Field Lab skill and instrument card, and the full frozen `packages/db/src/query/live/ARCHITECTURE.md` were read before live code analysis. Line references below refer to frozen blobs, not a promise that the working checkout still has those lines.

Source abbreviations (all paths relative to the repository):

| Label | Frozen source |
| --- | --- |
| SUB | `packages/db/src/collection/subscription.ts` |
| SYNC | `packages/db/src/collection/sync.ts` |
| STATE | `packages/db/src/collection/state.ts` |
| CHANGES | `packages/db/src/collection/changes.ts` |
| LIFE | `packages/db/src/collection/lifecycle.ts` |
| LOAD | `packages/db/src/query/live/utils.ts` |
| BRIDGE | `packages/db/src/query/live/collection-subscriber.ts` |
| BUILD | `packages/db/src/query/live/collection-config-builder.ts` |
| DEMAND | `packages/db/src/query/live/subset-demand-controller.ts` |
| EFFECT | `packages/db/src/query/effect.ts` |
| SCHED | `packages/db/src/scheduler.ts` |
| WINDOW | `packages/db/src/live-query-window-controller.ts` |
| DEDUPE | `packages/db/src/query/subset-dedupe.ts` |
| TYPES | `packages/db/src/types.ts` |
| ARCH | `packages/db/src/query/live/ARCHITECTURE.md` |

Direct type, test, and adapter boundary reads are identified where used. Test assertions are **source evidence, not executed proof**. The reconstruction and form checks are analytical traces. No performance or deletion count was measured.

## Frozen arrangement and preservation list

The baseline has this arrangement:

1. LIFE owns Collection status and first-ready effects. SYNC installs adapter callbacks and fences them with `syncEpoch`; its `loadSubsetSession` fences subscription promises. STATE owns applied rows, optimistic overlays, transaction queuing, and applied receipts. CHANGES owns subscriber count, event batching, and deferred delivery.
2. SUB owns a logical demand array, an exact current acquisition per demand, cleanup debts, readiness participants, replay participants, a private replacement map, and published-row tracking. A subscription can survive Collection cleanup. Its acquired work cannot.
3. DEMAND turns current key sets into retained request segments. BRIDGE connects those segments and ordered loads to BUILD, reconciles exact source contributions, and delivers them to D2.
4. LOAD owns ordered provider coverage and refinement. BUILD owns graph sessions, active demand generations, pending ordered publication work, source recovery gates, requested/settled windows, and coherent Collection publication.
5. WINDOW owns per-controller page counts and a shared max-limit lease coordinator. Its accepted physical window is downstream of BUILD's window operation. EFFECT reuses loaders and demand segmentation but emits callbacks, disposes on source error, and has no window API or public result Collection.
6. SCHED orders graph jobs within a transaction/publication context. DEDUPE caches exact successful request identity and shares only unabortable in-flight requests. It does not own row retention or all shared adapter acquisitions.

Properties held fixed in this grammar:

- **P1 — Distinct ownership:** a logical owner can remain detached without an acquisition; physical release debt can remain without logical ownership. Preserve exact options identity at unload, and never unload a synchronous throw as if it transferred a resource (TYPES:344–370; SUB:1133–1230,1497–1542).
- **P2 — Stale work:** old sync callbacks, subscription settlements, graph jobs, and window completions cannot settle a replacement session. Do not collapse their separately scoped generations (SYNC:124–127,880–938; SUB:871–883; BUILD:776–802,842–905; WINDOW:337–356,864–892).
- **P3 — Applied settlement:** promise success follows visible application of the request's writes. Cancellation loses once application begins; queue bypass remains limited to existing truncate/immediate behavior (SYNC:249–287; STATE:909–928,1411–1441,1449–1486).
- **P4 — Coherent replacement:** replay failure keeps the old public result and private partial replacement; only authoritative success reopens it. Released demand stops gating, including older work tied to that owner. Publication precedes subscription ready (SUB:714–801,1497–1542; BUILD:1059–1143).
- **P5 — Relation authority:** D2 retains routes, multiplicity, and materialization. No form creates lifecycle objects for synchronous routes or derives internal relation truth from public rows (ARCH, “One relational graph,” “Routes and buckets are relations,” “Normative laws”).
- **P6 — Ordered evidence:** local live rows, a requested count, and successful limited settlement do not prove exhaustion. Preserve a settled source boundary, tie handling, finite-prefix invalidation, full-source recovery, and retry only through the supported explicit path (LOAD:257–605).
- **P7 — Window acceptance:** requested window, physical operator, settled window, controller page count, and shared lease maximum remain distinct. Success includes the required refinement chain; failure keeps the last accepted public window (BUILD:298–397; WINDOW:129–358,820–928).
- **P8 — Callback causality:** install or retire ownership before callbacks can reenter. Revision guards detect ABA transitions. Teardown attempts every cleanup while preserving primary error identity (SUB:917–955,1097–1131,1951–2008; CHANGES:262–313; SCHED:132–158,234–273).
- **P9 — Bounded retained work:** retain current maps, active owners, pending obligations and necessary cleanup debt, not settled historical attempts or all recursive promise suffixes (SUB:816–825; LOAD:554–564; ARCH space law).
- **P10 — Existing behavior branches:** progressive ordinary delivery, initial reachability readiness, eager-source readiness, Effect auto-disposal, and source-specific row retention remain separate policies (BUILD:1255–1307; EFFECT:287–315,719–741; DEMAND:42–112).

These preserve the source's contracts, not every internal field or file boundary. Synchronous source reads, indexes, virtual metadata, optimistic ordering, and no-includes behavior remain boundary obligations even though this lens does not rederive their whole algorithms.

## Candidate primitives: observed and inferred

“Observed” below means directly represented by code. “Inferred” marks the proposed reusable unit or boundary, not a new fact about execution.

| Candidate | Observed representation and operations | Inferred reusable role |
| --- | --- | --- |
| Logical owner | `SubsetDemand`; array membership; starting/active/detached; stable request options; optional initial waiter (SUB:95–123,1133–1230) | Demand identity outlives one acquisition. Membership is authoritative for being owned; phase alone is insufficient. |
| Exact acquisition | Options, session, abort controller, listener cleanup; swap and unload (SUB:1043–1131) | Resource transfer record. Adapter return, transport settlement, and resource release are three events. |
| Retirement debt | `releaseDebts`, `releasingAcquisitions`, error-delivery depth (SUB:150–153,1097–1131,1940–2008) | A bounded physical obligation independent of logical activity. “Busy release” is not successful release. |
| Fenced continuation | Captured epoch/session/generation plus current identity checks (SYNC:124; SUB:493; BUILD:597; WINDOW:337) | Reusable rejection of obsolete work, scoped to its owner. A single global generation is not implied. |
| Participant | Readiness `{demand,promise}`; replay `{demand,attempt}` plus setup counts; operation pending promises (SUB:178–181,672–744; SYNC:668–759) | Membership in a particular completion condition. These sets overlap but are not interchangeable. |
| Publication gate | Replay session with private rows or delegated graph publication; builder pending ordered work and failure gates (SUB:114–123,750–801; BUILD:1069–1076) | Public result can remain fixed while private computation advances. Failure is a closed gate, not merely zero pending work. |
| Boundary evidence | `hasEstablishedSourceCoverage`, `sourceBoundary`, full-source/recovery flags and request signature guards (LOAD:224–239,443–605) | Proof about a specific acquired source extent. It is not a copy of D2's largest row. |
| Requested/accepted pair | Current versus settled builder window; lease target versus pending/applied coordinator limit; page count changes on success (BUILD:130–136,298–397; WINDOW:129–358,820–892) | A transition holds requested intent while the public value remains accepted state. |
| Reentrant transition | Mutate owner state, invoke callback, check identity/revision, finish remaining steps (SUB:486–648,917–955; LIFE:99–198) | A synchronous stack boundary carries protocol state even before any Promise exists. |
| Applied transaction | `committed`, `applicationStarted`, deferred receipt and pending queue membership (STATE:25–50; SYNC:249–287) | Commit admission differs from irrevocable application and from receipt delivery. |
| Exact contribution | `sentToD2Rows`, `reconcileChangesForD2`, weighted updates (BRIDGE:43–44,217–240; LOAD:113–184; EFFECT:796–809) | Input adaptation preserves exact old row identity for retraction. It overlaps publication tracking but is not public snapshot ownership. |
| Scheduled turn | Context/job identity, pending callbacks, pending-aware dependencies (SCHED:18–39,72–158; BUILD:724–806) | Coalesced graph work with reentrant replacement. Removal before callback distinguishes completed work from newly queued work. |

Recurring pattern: **publish the new ownership fact before external code**. It resolves the force that load, unload, status, and publication callbacks can synchronously release, restart, or acquire work. Smaller units are identities and phase records; larger units are subscription startup, replay, and disposal. Its response is always source-specific: sometimes register a tentative acquisition, sometimes remove a job, sometimes increment a status revision. The pattern does not authorize one generic callback engine.

### Apparent duplicate facts that the trace does not equate

- Subscription readiness participants and SYNC's pending Promise set count different constituencies. Releasing logical demand can remove subscription readiness even if its transport never settles; an ordinary request begun before replay can still affect readiness without gating replay publication (SUB:714–725,957–1028; ARCH demand plane).
- `truncateReplaySession !== undefined` and `truncateReplacementPending` differ: direct subscribers buffer rows locally; query subscriptions delegate publication and set the extra flag (SUB:429–432,750–801,855–900).
- `sentKeys`, `publishedRows`, `privateRows`, and BRIDGE's `sentToD2Rows` can diverge during filtering, restart and private replay. Combining them would erase which boundary has seen the row (SUB:1270–1433,1790–1929).
- `fullSource` means an issued/retained full-source request path, not unconditional successful full-source coverage; `fullSourceFailed` distinguishes failed async completion. `requesting` is stack reentry protection; `pending` is async work (LOAD:224–239,324–328,361–379,488–564).
- `windowFailed` is not the same error as failed source recovery. Successful replay cannot prove that a failed physical window operation was accepted (BUILD:180–185,298–384,1069–1076).
- LIFE and STATE both expose `hasReceivedFirstCommit`, but their writes differ: LIFE sets its flag during first-ready compatibility handling, STATE after actual application and resets it on cleanup (LIFE:168–183; STATE:1436,1591). The source does not establish an equivalence law; deleting one as duplicate is not supported by this read.
- EFFECT's outer `disposed` and runner `disposed` guard user callback dispatch and graph/source teardown respectively; disposal promise failure permits physical retry while logical disposal remains final (EFFECT:203–285,953–1012).

## Invariants, allowed transformations, and conflicts

The grammar admits these rules, all source-derived unless marked **injected**:

| Rule | Source trace |
| --- | --- |
| R1 Register owner and tentative acquisition before calling adapter. On synchronous throw, remove tentative ownership without unload. A successful return after release must retire that exact returned acquisition. | SUB:1133–1230; TYPES:344–352 |
| R2 Retire logical membership before physical unload. Keep exact failed release debt, suppress recursive release of the same acquisition while busy, permit later retry. | SUB:1097–1131,1497–1525,1951–2008 |
| R3 A replay shares one publication baseline across overlapping attempts. Newer attempts supersede current authority, but old pending replay participants still hold the gate until settled or their logical owner retires. | SUB:381–484,672–744 |
| R4 Include setup itself in the barrier before adapter/status callbacks. Completion is checked after release callbacks, since unload can add new demand. | SUB:420–425,1497–1525 |
| R5 A failed active demand can keep replay private after all pending work ends. Retirement deletes that demand's failure; last-owner retirement aborts completion and removes the graph gate. | SUB:714–764,1527–1542 |
| R6 Cleanup invalidates epochs before calling adapter cleanup, rejects outstanding waits, and detaches surviving demand. Restart uses fresh acquisition and a fresh private barrier. | SYNC:880–938; SUB:273–370 |
| R7 Successful ordered requests can establish boundary evidence only through the exact ordered snapshot. Failure invalidates it; explicit retry uses authoritative full-source acquisition. Ties and unsupported cursor ordering have separate paths. | LOAD:296–359,443–605 |
| R8 Drain synchronous graph work before root/facade publication. Publication gating does not stop private graph computation. | BUILD:575–665,1059–1143 |
| R9 Admit a new operation's future requests to that operation; superseded operations retain already-acquired obligations. Recheck after microtask registration of follow-up loads. | SYNC:668–759 |
| R10 Match cancellation and cache identity precisely. Independent signals do not share an in-flight DEDUPE transport; reset invalidates its old completion evidence. | DEDUPE:8–71 |
| R11 Collection source errors can recover if no fatal query error remains; Effect source errors dispose the effect. | BUILD:1209–1297; EFFECT:287–315,626–661 |
| R12 A committed transaction waiting behind persistence remains cancelable. Application starts before observer calls; receipts resolve after publication handling. Truncate/immediate drains the committed prefix together. | STATE:909–928,1411–1459 |
| R13 New representation may replace local booleans with a sum type, or move repeated local transitions to a reducer, only if callback ordering and all participant distinctions survive. | **Injected transformation rule**, constrained by P1–P10; source does not mandate reducers. |

Conflicts and supported priorities:

1. **Retire now / unload may fail.** Source priority: logical retirement is final; failed physical cleanup becomes retryable debt. No rollback into active logical demand merely to preserve cleanup (SUB:1497–1525).
2. **Current attempt wins / old uncancelable work still matters.** Source priority: newest attempt alone supplies current failure authority, but all retained in-replay participants hold publication (SUB:689–709). “Latest wins” alone is too weak.
3. **Zero pending / failed replacement.** Source priority: active failure keeps the gate closed; ready status can nevertheless become `ready` once work is idle. `ready` is not a proof that failed replay rows are publishable (SUB:728–764,859–868).
4. **Source failure / cleanup failure / observer failure.** Source preserves the primary adapter error, retains cleanup debt, and separates successful source settlement from an observer's thrown error (SUB:650–669,795–801,1464–1485). This is local priority, not a single ordering for all errors throughout the system.
5. **Optimistic persistence / source application.** Ordinary commits wait; truncate and explicit immediate work drain the committed prefix. A reducer cannot silently make subset loads immediate (STATE:909–918).
6. **Source recovery / window retry.** Source success does not clear an unrelated failed window (BUILD:180–183,1069–1076). Preserve both gates.
7. **Global exclusivity of phases.** Unresolved and not assumed. One subscription may be replaying, idle in status, retain failure, and own active physical leases. One controller can hold an accepted page count while a larger lease is pending. A global `loading/ready/error/disposed` enum cannot express these products.
8. **Unload must not throw / defensive tests make it throw.** TYPES:363–368 requires idempotent nonthrowing unload; core supports a defensive extension with debt. The generated forms retain that extension. This is no evidence that throwing unload is a normal adapter success path.

## Overlap, intersections, dependencies, and module claims

The overlap map is not a tree:

```text
logical demand ─┬─ exact current acquisition ── adapter session
               ├─ readiness participants ─── subscription status
               ├─ replay participants ────── publication gate
               └─ initial caller waiter ──── replay publication completion

ordered request ┬─ acquisition ownership above
                ├─ source coverage evidence
                ├─ imperative operation obligations
                └─ ordered publication gate ── graph output accumulator

window lease ── coordinator request ── builder window operation
                                  ├─ accepted window
                                  └─ public page-count acceptance
```

The demand/replay intersection is active: `{demand,attempt}` decides which overlapping transport work gates replacement and whose failure matters. It cannot be owned only by the attempt because release removes all work for the logical owner. The source-load/window intersection is active: it defines which requests an imperative promise must await. The graph/publication intersection is active: private materialized output may advance without public rows advancing. Each has a distinct constraint and therefore remains explicit in the grammar.

| Unit | Inputs/dependencies | Outgoing boundary | Module status |
| --- | --- | --- | --- |
| DEDUPE | Stable request key, cloning, adapter load function | `true | Promise<void>`, dedup callback, reset | Defensible small module. Exact identity interface and direct tests; no row or graph coupling. |
| DEMAND | Plan keys, canonical value scope, subscription snapshot/release | Changed/empty/ready result | Defensible demand module with bounded source interface, shared by BRIDGE and EFFECT. Its readiness policy still belongs to caller. |
| LOAD | Order planning info and callbacks, subscription snapshot/read/release | `start/loadMore/reset/dispose`, result callback | Defensible boundary adapter already shared by query and Effect; ordered lifecycle tests exercise integration. Its compiler info is mutable and coupled, so not a free-standing generic state machine. |
| Subscription acquisition + replay | Sync generation/adapter, subscriber callback, collection events | Snapshot/release/unsubscribe, status/error, replacement completion | One protocol cluster, not two independent modules. Acquisition and replay intersect through tentative work, failures and reentrant release. A narrower reducer may live inside it, but extraction is an injected boundary. |
| BUILD + publication | D2, facade stages, subscription gates, scheduler, Collection sync | Coherent rows, readiness, window API | Orchestrating boundary; not safely separable by moving flags alone. The graph/facade integration laws are its evidence, and its cross-unit dependencies are substantial. |
| SCHED | Context IDs, job IDs, pending-aware dependency interface | Ordered callbacks, clear notification | Defensible scheduler module. BUILD's pending callback map is caller state, not automatically redundant scheduler state. |
| WINDOW coordinator | Target `setWindow/getWindow`, independent lease symbols | Max desired limit, shared completion | Defensible local coordinator module; tests exercise multiple controllers. It cannot derive requested intent solely from settled `getWindow`. |
| LIFE/SYNC/STATE/CHANGES | Mutual manager dependencies, optimistic transactions, indexes/events | Collection public lifecycle and publication | Collaborating ownership boundaries, not independent pluggable machines. Splitting applied phase from state storage requires preserving causal queue and optimistic overlays. |

No semilattice theorem is asserted. The diagnostic result is that several consequential pairwise intersections cannot be discarded to draw a clean hierarchy.

## Reconstruction control

Using only the candidates and R1–R12, the source arrangement can be rebuilt at protocol granularity:

1. **Bootstrap:** create a Collection lifecycle plus a fenced sync callback set; defer startup when needed. Register subscriber ownership and listeners before snapshot work. A request has an exact identity and logical owner; unavailable loader produces detached demand and an immediate waiter result. R1/R6 reproduce SUB and SYNC startup without treating `markReady` as loader installation.
2. **Ordinary demand:** DEMAND compares canonical key sets, retains every nonfailed segment intersecting current keys, retires fully irrelevant/failed segments, and acquires uncovered keys. Attach changed aggregate settlement to a fresh BUILD demand generation. Feed current source changes through exact-contribution reconciliation to D2. R2/R8/R10 preserve partial source data and current route readiness.
3. **Replay:** open one publication gate with the prior public baseline and private replacement. Add a setup obligation, capture current attempt, abort replaced acquisitions, and queue startup until truncate deletes have entered private state. Each returning async acquisition joins captured replay and readiness constituencies. An old attempt can drain without becoming current. R3/R4 reproduce the retained overlap instead of losing old uncancelable work.
4. **Release/failure:** remove owner membership and its failure/participants first. Try exact physical unload; retain failed debt. Recheck completion after callbacks. With an active failure, hold replacement private; with no demand, abort now-unreachable replay and stop gating the graph; otherwise publish successful replacement and then emit ready. R2/R4/R5 reconstruct all three branches.
5. **Ordered load:** start from prefix when no acquired boundary exists. An exact success permits a bounded source read; ties load through a boundary request; forward shortage invokes another request. Failure removes coverage authority and blocks automatic retry. Explicit next window may retire failed acquisition and acquire full source. R7 preserves local live rows without treating them as source extent.
6. **Window:** coordinator takes max current leases; BUILD copies requested options, mutates top-K within one publication context and records requests in an operation. Its public settled window and controller committed pages advance only after obligations finish. Existing older ordered work can still gate publication. R8/R9 preserve source-private/public-accepted separation and supersession.
7. **Applied writes:** queued committed transactions remain cancelable until admission to application. Apply the committed prefix when allowed, overlay optimistic state, install indexes, publish, settle receipts. R12 reproduces the before/after cancellation boundary without adding queue priority.
8. **Cleanup/restart:** retire sync epoch before adapter cleanup; reject waiting callers, abort or detach demand, discard graph/session callbacks and public gate ownership. Retained logical demand is reacquired on restart. Physical debts never move to a new adapter session. R6 reproduces stale completion suppression at each boundary.
9. **Effect:** reuse demand/ordered input primitives and scheduled-turn ordering, but classify output into deltas and dispose on source failure. Preserve skip-initial policy and deferred heavy cleanup during graph execution. R11 recreates this distinct consumer rather than adding a result Collection or window semantics.

**Control result:** the candidate grammar accounts for the scoped lifecycle arrangement and the named callback boundaries. An earlier tempting reduction to “one pending set” would fail step 3 and step 4; the grammar retains distinct participants. This is a reconstruction of state/ownership behavior, not line-for-line code regeneration or a proof of all compiler, metadata, optimistic, or index behavior. Those retained components remain necessary boundary units.

## Range, exclusion, and boundary conditions

### Matched marginal case

The frozen `packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts:8–94` holds source data, the pending user transaction, requested write, signal, and observation logic fixed, and changes abort phase among `at-commit`, `while-parked`, and `after-publication-starts`.

- Ordinary successful applied case at the late edge: abort in the publication callback leaves the remote row visible, receipt successful, and both delivered keys and callback reads containing that row.
- Marginal case: abort while the same transaction is parked rejects with `AbortError`; source state, delivered batches and callback reads contain no remote row.
- Classification: **same grammar, changed event ordering**, using R12's application boundary. No changed rule or error priority is needed. The cases are sourced and matched in one test matrix; not executed here. Empirical range remains untested by this run.

Additional stress trace from `packages/db/tests/collection-subscription-replay-oracle.property.test.ts:3943–4049`: unloading the original replay lease starts a second asynchronous demand. After only the first replay promise resolves, no replacement or ready event is allowed; after the nested demand settles, one batch contains both replacement rows. R4 must check completion after the unload callback. This is sourced test evidence, not a second empirical experiment.

### Negative exclusion

The grammar must not generate a cache that treats `age > 10` settlement as proof that a distinct `age > 20` request is complete, nor a `(limit=10, offset=0)` request as proof for `(limit=5, offset=2)`. The exact negative test is `packages/db/tests/query/subset-dedupe.test.ts:47–57`, which expects four adapter calls. R10 excludes predicate-containment coverage inference. Another negative is a request with an independent AbortSignal sharing the same cancelable in-flight transport solely because its options key matches; the source test at :83–112 excludes it.

These are nearby out-of-family *states* of the candidate request grammar, not assertions that all external caches must follow this policy. An adapter can share work under a separate ownership protocol; the core deduper does not supply that protocol.

### Dynamics / constraints / boundaries

| Kind | What belongs here |
| --- | --- |
| Dynamics | Acquire, install return, release owner, retry debt, start/supersede replay, settle participant, mark failure, reset session, drain graph, refine ordered request, request/accept window. Generated local sum-type or reducer transformations use R13. |
| Constraints | P1–P10, exact options identity, independent participant constituencies, setup-before-callback, application-before-cancel cutoff, no source exhaustion inference, D2 authority, no stale publication. |
| Boundary conditions | JS synchronous reentry and Promise microtasks; existing `true | Promise<void>` protocol; one graph-run order; on-demand versus eager sync; compiler order capability and index availability; controller offset-zero max-limit leases; no pending-window API added; adapter cancellation support. |

Adapter constraints are concrete. Electric's `packages/electric-db-collection/src/electric.ts:675–723` says requestSnapshot publishes through the stream before its promise resolves and lacks request-specific cancellation identity; it waits for commits after the snapshot. PowerSync's `packages/powersync-db-collection/src/powersync.ts:715–753,861–893` waits for startup, checks released/options identity and cancellation around async setup, and separates logical cleanup from queued release draining. Query DB's `packages/query-db-collection/src/query.ts:2119–2146` derives a query key, adjusts refcounts and uses idle cleanup; it does not turn SUB predicate release into generic row deletion. These reads establish constraints only; no adapter redesign or full adapter correctness claim follows.

## Generated adjacent form A: explicit acquisition transfer with a local reducer

**Route:** pattern unfolding inside SUB. Fold the recurring “publish owner, call adapter, inspect reentry” pattern into a local acquisition transition owner. This is not a new whole-subscription lifecycle or a generic workflow engine.

**Changed variables:** replace the loose pairing of `acquisitionState`, current acquisition, stack-held prior acquisition, and release sets with phase-tagged acquisition records and transition results. Keep logical demand identity, replay sessions, status delivery and private/public row stores separate. A tentative replacement can coexist with its prior established lease; that overlap cannot vanish.

**Preserved:** P1–P5, P8–P10 directly; ordered/window contracts remain callers of the same snapshot interface. Exact options objects, captured replay attempt, owner-specific failure, and retryable release debt survive. No source rows move into the reducer.

Generated pseudocode, not existing implementation:

```ts
type Transfer =
  | { tag: 'detached'; request: Request }
  | { tag: 'starting'; candidate: Acquisition; prior?: Acquisition;
      replay?: CapturedReplay }
  | { tag: 'held'; acquisition: Acquisition }

type Physical =
  | { tag: 'held'; acquisition: Acquisition }
  | { tag: 'releasing'; acquisition: Acquisition }
  | { tag: 'debt'; acquisition: Acquisition }

// Logical membership is separate from Transfer, including while a load is on stack.
function begin(owner, capturedReplay) {
  const candidate = freshAcquisition(owner.request, currentSession())
  const prior = heldAcquisition(owner.transfer)
  owner.transfer = { tag: 'starting', candidate, prior, replay: capturedReplay }
  // State is installed BEFORE external code. The driver does not queue reentry.
  let result
  try { result = adapter.load(candidate.options) }
  catch (error) {
    dispatch({ type: 'threw', owner, candidate, error })
    return
  }
  // A failure in returned-resource handling is not a synchronous load throw.
  dispatch({ type: 'returned', owner, candidate, result })
}

function transition(event): Effect[] {
  if (event.type === 'releaseOwner') {
    owners.delete(event.owner)
    rejectInitialWait(event.owner, AbortError())
    replay.removeOwnerParticipantsAndFailure(event.owner)
    // Starting candidate is not yet transferred; return/throw will finish it.
    return [releaseEstablishedLeases(event.owner),
            recheckReplayAfterCallbacks(), stopReadiness(event.owner)]
  }
  if (event.type === 'returned') {
    const transfer = capturedTransfer(event.candidate)
    if (!sameSyncSession(event.candidate)) return [abortAndForget(event.candidate)]
    if (!owners.has(event.owner))
      return [releaseTransferredCandidate(event.candidate), releasePriorOnce(transfer)]
    if (!sameAttempt(transfer.replay))
      return [retainCapturedPendingIfAdmissible(transfer, event.result),
              restorePriorIfStillCurrent(transfer), releaseTransferredCandidate(event.candidate)]
    // Bind observers to captured identities, not whatever attempt exists later.
    replay.attach(transfer.replay, event.owner, event.result)
    readiness.attach(event.owner, event.result)
    // Every effect below is followed by identity checks in the driver.
    return [installHeldCandidate(event.owner, event.candidate),
            releasePriorWithSourceCompatibleRollback(transfer)]
  }
  if (event.type === 'threw') {
    // Load's synchronous failure transferred no candidate resource.
    abortAndForget(event.candidate)
    restoreOrRetireLogicalOwnerAccordingToCapturedPrior(event)
    return [reportPrimaryOnlyIfOwnerAndAttemptCurrent(event), recheckReplay()]
  }
}

function releaseExact(acquisition) {
  if (physical.get(acquisition)?.tag === 'releasing') return
  physical.set(acquisition, { tag: 'releasing', acquisition })
  let failure
  try { if (sameSyncSession(acquisition)) adapter.unload(acquisition.options) }
  catch (error) { failure = { error } }
  finally { removeAbortListener(acquisition) }
  if (failure) physical.set(acquisition, { tag: 'debt', acquisition })
  else physical.delete(acquisition)
  // Retry from an error listener must see debt, never an on-stack release.
  if (failure) reportAccordingToExistingPrimaryErrorRule(failure)
}
```

The effect names stand for existing policy, not unspecified new permission: `releasePriorWithSourceCompatibleRollback` must preserve SUB:1072–1095's restore-old-on-unload-failure behavior when the logical owner remains, and debt when reentry already retired it. `retainCapturedPendingIfAdmissible` must use SUB:679–709's setup-or-pending admission test, including the branch where work was superseded before attachment. The pseudocode deliberately leaves these branches explicit; “all returns become held” would be wrong.

**Concrete source surface:** SUB:95–107,486–648,1043–1230,1497–1525,1940–2008. BRIDGE and EFFECT retain their existing snapshot/release contracts. LOAD retains its provisional-result handling. SYNC retains session generation and adapter callbacks.

**Plausible deletion surface, estimate not measurement:** roughly 120–230 lines of repeated tentative-state restoration, phase checks, release-debt bookkeeping and reentry guard scaffolding could be replaced inside those SUB regions. This does not mean 120–230 net lines saved: a reducer/driver and typed events could add roughly 150–280 lines. Exact release/error branches remain. No production diff was made.

**New machinery and cost:** event variants, typed captured transfer records, a synchronous effect driver that must re-read current owner state after every callback, and one authoritative physical-phase map. It introduces indirection and more explicit phase plumbing. It must avoid retaining terminal records; a per-acquisition historical event log would violate P9. A full FIFO dispatch queue would change reentry semantics and is excluded.

**Stepwise preservation check:** (1) Moving tentative install before adapter preserves R1. (2) Tagged return/throw keeps transfer separate from settlement. (3) Separating logical membership from physical phase preserves debt without ownership. (4) Keeping replay/readiness outside the local reducer preserves their different participant sets. (5) Keeping exact identity guards after effects preserves callback reentry. These are design checks, not execution results.

**Existing oracle laws:** acquisition start/reentry/phase and physical-interaction matrices in `packages/db/tests/collection-subscription-lifecycle-oracle.test.ts:16–260`; replay owner retirement and nested-demand publication at `packages/db/tests/collection-subscription-replay-oracle.property.test.ts:3943–4049`; exact rejection identity cases at :3308 and :3364; teardown retry behavior from the source contract and current lifecycle suites. No cited suite ran here.

**Missing proof/tests for this form:** no reducer exists to compare. It would need public-trace equivalence against the existing implementation for every transition event; callback injection after each reducer effect, including unload failure followed by reentrant retry; stale load return after cleanup/restart; and retained-record counts after long repeated replacements. Existing tests may contain individual versions of these cases; this run has not established that they exercise every new reducer effect boundary or prove absence of leaked terminal records.

**Loss and injected rules:** the reducer boundary and event vocabulary are analyst additions. Stack-local intent becomes an explicit record, potentially retaining prior leases longer and making ordering harder to read. A broad reducer would hide the fact that adapter callbacks can reenter other state owners. This sample therefore stops at acquisition transfer rather than absorbing replay publication or Collection status.

## Generated adjacent form B: evidence-bearing ordered continuation

**Route:** rule combination within the existing LOAD boundary, with a local substitution of state representation. Source evidence supports a loader shared by BRIDGE and EFFECT. It does not support moving provider policy into D2 or making all application statuses one machine.

**Changed variables:** represent acquired source evidence separately from request execution phase. Replace combinations of `hasEstablishedSourceCoverage`, `sourceBoundary`, `needsFullSourceRecovery`, `fullSource`, `fullSourceFailed`, `failed`, and failed-operation identity with a product of tagged evidence and request phase. Keep request-signature/tie guards and the synchronous requesting guard, since those facts can coexist.

Generated pseudocode:

```ts
type Evidence =
  | { tag: 'none' }
  | { tag: 'finite'; boundary?: Row } // empty successful range has no boundary
  | { tag: 'invalid'; reason: 'source-order' | 'request-failed' }
  | { tag: 'full' }

type RequestPhase =
  | { tag: 'idle' }
  | { tag: 'starting'; token: Token; kind: Kind }
  | { tag: 'pending'; token: Token; kind: Kind; promise: Promise<void> }
  | { tag: 'failed'; kind: Kind; operation?: number; release: Release }

type Loader = {
  active: boolean; generation: number; evidence: Evidence; request: RequestPhase;
  retainedFullDemand: boolean; // lease existence is not source proof
  lastPage?: { count: number; boundary: unknown };
  lastPrefixCount?: number; lastTie?: { value: unknown };
}

function chooseNext(s, needed, explicitOperation): Request | 'wait' | 'none' {
  if (!s.active || limit === 0 || s.request.tag === 'starting') return 'none'
  if (s.request.tag === 'pending') return 'wait'
  if (s.request.tag === 'failed') {
    if (explicitOperation === undefined || explicitOperation === s.request.operation)
      return 'none'
    retireFailedLeaseBeforeRequest(s.request.release)
    if (!s.active) return 'none' // unload may dispose
  }
  if (s.evidence.tag === 'full') return 'none'
  if (s.evidence.tag === 'invalid' || compilerRequiresFullSource)
    return fullSourceRequest()
  if (!singleColumnIndex || !cursorExpressesLocalOrder(s.evidence))
    return prefixOrFullFallbackUsingExistingGuards(needed)
  const boundary = s.evidence.tag === 'finite' ? s.evidence.boundary : undefined
  return pageRequest({
    count: requiredCountUsingCurrentIndexedRows(needed, boundary),
    cursor: boundary && cursorOf(boundary),
    offset: boundary ? countAtOrBefore(boundary) : 0,
  })
}

function onRequestSuccess(token, kind, options) {
  if (!isCurrentActive(token)) return
  request = { tag: 'idle' }
  if (kind === 'full-source') evidence = { tag: 'full' }
  else if (kind === 'ordered') {
    evidence = { tag: 'finite', boundary: lastRowOfExactAppliedRange(options) }
    requestTieThenResumeUsingExistingGuards()
  } else resumeForwardRefinement() // tie success alone adds no finite proof
}

function onRequestFailure(token, kind, error, release) {
  if (!active) return
  evidence = { tag: 'invalid', reason: 'request-failed' }
  // Preserve current code's distinction: stale failure may invalidate evidence,
  // but cannot set the new generation's request-failure identity.
  if (!sameGeneration(token)) return
  request = { tag: 'failed', kind, operation: token.operation, release }
  clearRequestAndTieGuards()
  throw error
}

function onVisibleSourceChange(change, exactPreviousContribution) {
  if (isDeleteOrOrderChange(change, exactPreviousContribution)) {
    clearRequestGuards()
    evidence = { tag: 'invalid', reason: 'source-order' }
  } else if (isNewKey(change, exactPreviousContribution)) clearRequestGuards()
}
```

This is a product, not one enum: an in-flight request may coexist with invalidated earlier evidence, and a retained full-source lease may coexist with failed evidence. `retainedFullDemand` remains separate because deleting it would duplicate replay acquisition. `finite` allows no boundary after an empty range; omitting that case would inject an exhaustion inference. A production version must preserve LOAD:510–512's previous-boundary fallback for an empty later range, and all existing request/tie signature equality rules. The pseudocode omits arithmetic and snapshot assembly already owned by existing helpers.

**Preserved:** P2–P10; acquisition P1 stays in SUB. Request result stays `true | Promise<void>`; exact request range and local indexed reads remain the source of evidence. BRIDGE/EFFECT continue to own their own publication/error policies. No request count becomes a proof of exhaustion. Full replay success clears source recovery without clearing BUILD's failed-window gate.

**Concrete source surface:** LOAD:224–239,296–430,443–644,646–724; callers BRIDGE:279–405 and EFFECT:618–624,933–1001. BUILD:499–534 and1069–1076 remain external publication gates. SUB exact release closures remain the physical cleanup boundary.

**Plausible deletion surface, estimate not measurement:** roughly 70–140 lines of repeated boolean assignments and correlated branch checks could be replaced in LOAD's completion/failure/reset/retry paths. Tagged evidence constructors and request transitions could add roughly 90–180 lines. It may improve representational exclusion without reducing net code. Request-building, boundary reads, tie handling, and adapter glue are not claimed deletable.

**New machinery and cost:** tagged evidence constructors, request tokens carrying loader and operation identity, and an explicit transition table for replay reset/full replay success. A token containing a row retains that row just as current `sourceBoundary` does; adding retained pages or history is excluded. Request phase inspection is another branch at each call site. Moving it behind a new class is optional and not source-required.

**Stepwise preservation check:** (1) `none` admits prefix startup from offset zero. (2) exact success builds `finite`, including an empty boundary case. (3) mutation invalidation changes evidence without erasing request ownership. (4) a failed request blocks normal graph retry and permits a fresh explicit operation. (5) authoritative full success supplies full evidence, while the retained lease fact remains separate for replay. (6) caller publication barriers continue to cover the whole refinement chain. Current-source traces support these distinctions; no generated implementation has been run.

**Existing oracle laws:** `packages/db/tests/query/ordered-lifecycle-oracle.property.test.ts:16–34` declares page/prefix/boundary/full-source × before-settlement/after-success delivery × keep/widen × resolve/reject/abort-error × retain/restart × initial/replay. The suite's :493 and :504 name its 192-history distinctness and terminal-cleanup checks. `packages/db/tests/live-query-window-controller.test.ts:278,319,561,760,874,930` names accepted-window failure/retry, superseding reset, cleanup, shared-window and remaining-lease cases. This run inspected the product declaration and named tests, not all implementations of these test cases; they are a validation map, not claimed full coverage.

**Missing proof/tests for this form:** transition equivalence for invalidation while a finite request is pending, exact boundary extraction failure after adapter success, stale failure after reset, empty successful range retaining a prior safe boundary, full-source failure followed by replay and then explicit window retry, and retained-state counters across long chains. Existing tests may cover subsets; a new sum type still needs evidence that each legal product maps to the same request/publication trace, including unsupported local order relations and Effect consumers.

**Loss and injected rules:** the tags are analyst additions; the source does not present a first-class evidence object. An overly strong type named “covered” could imply exhausted or complete source state that the API cannot prove. The sample preserves that uncertainty in `finite` and leaves the full-request lease separate. It also leaves some flags and generation checks in place; deleting all guards is not a supported transformation.

## Why two forms; limitations and unresolved questions

Two forms are returned because the other tempting state reductions crossed unsupported equivalence claims. A third “global lifecycle” would conflate Collection ready, subscription idle, replay completion, graph publication and window acceptance. A shared all-purpose pending-work ledger would need new admission, release and error-priority rules across distinct participant sets. A pure rename of WINDOW's page flags would be cosmetic relative to these samples. The source does contain an explicit transaction application boundary, but turning that into an additional sum type alone would not establish a structurally distinct arrangement worth claiming here.

The extraction itself selected temporal and ownership structure. It can make flags look more redundant than they are and flatten stack ordering into diagram edges. The reconstruction repaired that distortion by retaining reentry checkpoints, independent generations, participant intersections, and separate public/private row states. It did not establish that the proposed local boundaries improve maintenance, runtime work, or defect rate.

Outstanding uncertainties:

- Complete representational equivalence of either form needs executable traces. Neither pseudocode is production-ready.
- The full scope includes optimistic and virtual-row state whose laws cannot be reduced to the lifecycle primitives alone. They remain preserved implementation units, not proven consequences of a small machine.
- The exact test products for every new effect boundary and every adapter cancellation behavior were not established. Source assertions demonstrate intended laws, not a passing run.
- The local phase map in form A may merely move branching into a driver; the evidence representation in form B may add types without deleting meaningful logic. Estimated replacement surfaces are not net-size claims.
- Electric's inability to identify canceled snapshot rows bounds what any core state machine can enforce. No local state representation can prevent arbitrary adapter writes that violate the boundary contract.
- Cross-session ownership of cleanup retry remains consequential. Neither form may preserve old physical debt by sending it to a replacement adapter.

The instrument stops with this grammar, reconstruction, bounded range reading, negative exclusions, and two unranked samples. It supplies no implementation choice.
