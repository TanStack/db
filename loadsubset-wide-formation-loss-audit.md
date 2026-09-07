# Loss audit: wider loading Formation section

The frozen report preserves the named replay corrections and several distinctions between surviving scopes. This pass recovers qualifications that its unit names and compact arrows omit: inherited request cloning, an acquisition-identity substitution, the conditions on request reuse and operation completion, and the exact retained-segment rule. These are source traces, not judgments about what to restore.

## Boundary and method

One fresh **Hidden-signal recovery assay (`loss-audit`)** examined one bounded lineage bundle. The frozen reduction is `dce182aa:loadsubset-wide-formation-section.md` plus only the six lines added to `loadsubset-minimal-stack-todo.md` by that commit. The TODO was read with `git diff --unified=0 dce182aa^ dce182aa -- loadsubset-minimal-stack-todo.md`; no other TODO content was read.

The bundle consists of baseline `68366eca`, current `1cec4d7f`, and the report's named parent/commit transformations within its 13-path loading corpus. The two deleted modules named explicitly in F02 were read only at their named addition/deletion hunks. Paths below are relative to `packages/db/src/` unless stated otherwise. `commit:path — symbol` identifies a source location; a transformation names both the commit and the changed symbol. The full Field Lab skill, loss-audit card, root/worktree AGENTS, and full `1cec4d7f:query/live/ARCHITECTURE.md` were read before live-code analysis. Architecture is a normative constraint, not runtime evidence or a historical date.

The report was read before the named sources to establish the permitted boundary. Both sibling grammar runs, other reports, earlier analyses and audits, unrelated TODO history, unrelated commits, adapter internals and network sources remained hidden. No new history/completeness survey, tests, repository writes, commits, pushes, tasks or delegation occurred. This Markdown file is the sole saved result.

## Recovered traces

In each entry, the source fact and its absence or compression in the reduction are direct observations. The proposed reduction mechanism is an inference unless the report states it. No author intent, majority rule or explicit rejection is established.

### L01 — A new options module contained inherited cloning work

**Recovered item and support.** `68366eca:query/subset-dedupe.ts — cloneOptions/cloneBasicExpression/snapshotComparisonValue` already clones request expressions and snapshots Date and byte comparison values while retaining opaque reference identity. `0034409d` moves that implementation out of subset-dedupe, replaces it with a re-export, and adds `query/load-subset-options.ts — cloneLoadSubsetOptions`; that new module also adds `snapshotLoadSubsetDemand`, which drops signal and subscription ownership fields. `76cd6d8a` deletes the module but adds `query/subset-dedupe.ts — cloneOptions/cloneExpression/snapshotComparable`. Current `1cec4d7f` still has cloning there, with distinct equality, ordering and membership contexts.

**Where changed or lost.** F02 correctly dates the new modules, but places them together under an “Applied outcome/provenance extension” that was “added” and then cut. Its formation arrow says “module/extent cut → exact settlement.” This does not preserve that a module's addition included relocation of an inherited responsibility, nor that the responsibility survives deletion of the module. The report does not expressly claim all cloning vanished; this is lost granularity, not evidence that its whole deletion claim is false.

**Reduction mechanism.** Inferred module-level categorization merges a moved responsibility with newly added provenance. The clone implementations differ across endpoints; this pass does not claim they are behaviorally identical or reconstruct unnamed intermediate changes.

### L02 — The outcome cut also substitutes deferred acquisition identity

**Recovered item and support.** `76cd6d8a:collection/sync.ts — DeferredLoadSubset, loadSubset, unloadSubset` removes `ownerOptions`, the `deferredAdapterOptions` map and its retain/forget helpers. It snapshots options and uses `Object.assign(options, loadOptions)` so the queued adapter call and unload use the same acquisition object. Current `1cec4d7f:collection/sync.ts — loadSubset/unloadSubset` retains that in-place identity strategy. The transformation's comment explicitly says it avoids a translation registry.

**Where lost.** F02's extension-to-exact-settlement edge and reconstruction control describe removed outcome/extent plumbing, but not this associated owner-to-adapter identity substitution. It is not the later F04 change from copied demand fields to an acquisition object: these are distinct storage locations and hunks.

**Reduction mechanism.** Inferred category mismatch: a cut grouped by result payload also changes deferred ownership representation. The registry's original introduction is outside the named hunks; no new origin claim is made.

### L03 — The logical/physical split predates the new demand states

**Recovered item and support.** `68366eca:collection/subscription.ts — SubsetAcquisition, SubsetDemand, subsetDemands` already distinguishes a demand's `requestOptions` from acquisition options and retains logical demands. `d3f18042` adds `starting | active | detached`, cleanup/restart handling and state-sensitive physical release. `b9fa9698` then nests one acquisition object under a demand. Current type definitions retain that nesting and state union.

**Where changed or lost.** F04 identifies “Logical demand distinct from physical work” through `d3f18042` and says “Present,” without the explicit inherited label used for F01/F17. Its diagram starts from “logical demand fields,” so the older form is partly preserved. What is absent is an explicit baseline provenance for the distinction itself, separate from the added state machine and later object substitution.

**Reduction mechanism.** Inferred compression of an inherited distinction into the commit that made additional lifecycle states explicit. The hunks support added states and handlers, not invention of logical ownership at that commit.

### L04 — Exact reuse has different pending and completed rules

**Recovered item and support.** `76cd6d8a:query/subset-dedupe.ts — loadSubset/reset`, retained at `1cec4d7f`, consults `completed` before testing `options.signal`. A signaled caller can therefore reuse an already completed exact demand. Only pending transport sharing excludes signaled requests. Completion records a key only when its generation is current and the request is not aborted; reset clears both collections and increments generation. The map's finalizer removes only its own promise entry.

**Where lost.** F03 retains the cancellation qualification at a broad level (“cancelable calls no longer use that shared-lease algorithm”), but the table and diagram's “exact-key reuse” do not preserve the pending/completed split or reset fence. Reading that phrase as one uniform sharing rule would lose these conditions.

**Reduction mechanism.** Inferred compression of conditional reuse into the kind of key. No predicate-subsumption behavior is recovered as current, and no claim is made about uninspected canonical-key implementation details.

### L05 — Operation-chain completion is scoped to the active operation

**Recovered item and support.** Both `68366eca` and `1cec4d7f:collection/sync.ts — beginLoadSubsetOperation/trackLoadSubsetOperationPromise/settleLoadSubsetOperation` retain first failure and defer final completion through a microtask so follow-up registrations can join. They also give future registrations to the newest operation: older operations keep their existing promises but cannot absorb work caused by a superseding physical window. The current cancel handler can restore an unfinished previous operation. `d03177ac:query/live/utils.ts — observe` stops returning the recursive suffix and registers each next request before its predecessor settles.

**Where lost.** F01 and F10 correctly connect per-request registration to inherited tracking. Their “completion still covers the logical chain” and reconstruction wording omit the operation ownership condition and the distinction between the inherited tracker and its current cancellation behavior.

**Reduction mechanism.** Inferred compression of a scoped composition rule into a chain-completion statement. The code supports that composition when registrations belong to the applicable operation; this audit does not turn it into a guarantee for arbitrary overlapping callers. The current cancel difference is an endpoint observation; its introducing commit was not sought.

### L06 — Flattened replay still counts logical acquisitions separately

**Recovered item and support.** `cdb9ecdb:collection/subscription.ts — trackTruncateReplayParticipant` removes the promise field from replay memberships while keeping a fresh pending object per acquisition. `baa2163f` adds the attempt reference and increments/decrements its count; its comment explicitly preserves one participant per logical acquisition even when promises are shared. `7b9ea648` moves failure storage to the session, clears it for a new attempt, and limits writes to current authority. Current membership and release code retain those distinctions.

**Where lost.** F05–F07 preserve the retained-attempt admission correction and failure-location split, but do not explicitly state that flattening is not deduplication by transport promise. That omitted distinction separates replay membership from F01's promise-keyed operation set.

**Reduction mechanism.** Inferred compression to the shape and location of collections. No loss was found in the report's explicit “old attempt may accept returning work while retained; a drained attempt cannot reopen” qualification.

### L07 — Added stale-row reconciliation does not reopen a failed replay

**Recovered item and support.** `4c382d75:collection/subscription.ts — requestSnapshot` admits stale known rows only under `!this.isBufferingForTruncate`, and calls `reconcileStalePublishedChanges` only outside buffering. The same hunk removes `pruneReleasedReplayRows` and its release hook. These guards survive at `1cec4d7f`. Current `abandonTruncateReplay` retains the private state; the frozen architecture's Demand plane states that ordinary snapshots cannot prove a failed source complete.

**Where lost.** F09 explicitly preserves the fact that reconciliation was added, so this is not an omitted compensating change. It omits that change's buffering guard. The shorter “delete/reconcile stale rows → source-owned retention” arrow does not tell the reader when reconciliation is allowed.

**Reduction mechanism.** Inferred compression of a guarded call-site addition. No source evidence here supports treating a normal snapshot as recovery from an active failed replay.

### L08 — Confirmed-boundary evidence depends on fulfillment of the request

**Recovered item and support.** `88fad51b:collection/subscription.ts — readOrderedSnapshot` combines the subscription predicate, request predicate and cursor's `whereFrom`, then reads the local ordered range up to its limit. `88fad51b:query/live/utils.ts — observe/countAcquiredRows` takes the last row of that range after success and counts rows at or before the retained boundary. An empty range keeps the prior boundary rather than inventing one. A boundary-read failure enters the failure path. Current symbols retain these rules. The frozen architecture explicitly requires fulfillment of the exact ordered request, denies that an empty range proves exhaustion, and notes that counting a long prefix can revisit rows.

**Where lost.** F11's “source evidence” and “confirmed-range counts” omit that the confirming read is local and depends on the adapter contract; it is not a provider receipt naming every applied row. The report states no performance claim, but also does not preserve the distinction between avoiding extra transfer and doing local prefix-read work.

**Reduction mechanism.** Inferred compression of evidence provenance into the word “confirmed.” The source read and its guards are direct code evidence; adapter fulfillment is a normative premise, not something measured in this pass.

### L09 — Pending jobs are not the scheduler's only dependency observation

**Recovered item and support.** `84d788c5:scheduler.ts — flush` removes `completed`, but its blocking predicate is `jobs.has(dep) || depHasPending`; the latter queries `hasPendingGraphRun(contextId)` on a pending-aware dependency. This survives at `1cec4d7f`. `832bf765:query/live/collection-config-builder.ts — scheduleGraphRun` snapshots the builder dependency set before scheduling parents, which may reenter source setup.

**Where lost.** F14 correctly treats the builder and scheduler cuts as separate. Its “pending job/dependency maps survive” and “pending work rather than a second completion fact” compress the external pending-aware query and the snapshot-before-reentry ordering.

**Reduction mechanism.** Inferred storage-centered compression. Deleting `completed` does not make presence in the scheduler's job map the sole test of an unmet prerequisite.

### L10 — A pending lease result is returned only after two checks

**Recovered item and support.** `f2c7af87:live-query-window-controller.ts — getLeaseResult`, retained at `1cec4d7f`, first checks that the named lease exists and meets `minimumLimit`. It returns a pending promise only when that promise's limit equals the coordinator's current desired limit. Otherwise it consults the settled window. The coordinator itself is present at baseline `68366eca`.

**Where lost.** F13 correctly records the method substitution and pending-before-settled order, but its “A pending lease returns its promise” sentence leaves these admission checks implicit.

**Reduction mechanism.** Inferred compression of a conditional return into a general sentence. There is no source support here for handing any pending coordinator promise to any lease.

### L11 — The inherited segment layer retains overlap, not exact demand membership

**Recovered item and support.** Both `68366eca` and `1cec4d7f:query/live/subset-demand-controller.ts — setDemand` retain an existing nonfailed segment whenever it intersects the new keys. A partial key removal does not split that segment or release its removed keys. A failed segment intersecting current keys defeats the unchanged-key fast path and is reacquired. The unchanged, nonfailed fast path returns `changed: false, ready: true`, even though an existing segment may still be pending; this return is not a fresh aggregate wait. Changed demand aggregates active segment promises. Current release failures are caught so graph demand can still advance, while the subscription owns cleanup debt.

**Where lost.** F17 preserves inherited segmentation and mentions identity/error changes, but omits these segment-retention and return-value rules. They also qualify the report's surviving-seam statement that different demand layers have different keys and release effects.

**Reduction mechanism.** Inferred compression to the existence of a layer. The class comment's claim about rebuilding segments that covered a removed key is broader than the observed intersection branch; this audit uses the branch as evidence and makes no correctness or intended-design judgment.

## Preserved material and explicit nulls

- **F02/F03 cut direction:** The named `76cd6d8a` hunks really delete the outcome modules and broad predicate/shared-abort implementation; `ff3e57b3` removes residual result types in the inspected loading paths. No reversal of that direction was found. L01–L04 recover finer distinctions inside it.
- **F05 → F06 and F06 + F07:** Direct hunks support a cut followed by bounded attempt-admission restoration, then a separate failure-storage/authority change. The report already preserves those corrections. No evidence was found that all attempt identity disappeared, or that pending historical work retains historical failure authority.
- **F08 → F09:** Direct hunks support reuse of the existing published baseline, followed by removal of predicate release pruning and addition of guarded stale reconciliation. The public/private distinction is explicitly preserved in the report. No lost claim of a pure deletion was found.
- **F10/F11:** The recursive-suffix substitution, later confirmed boundary, and removal of emitted-row cursors are distinct changes in the named diffs. `5e61e9ca` updates both subscriber and effect callers to contribution-derived invalidation. No evidence was found for reducing those transformations to one rename.
- **F12:** `e6c8da4f` adds replay waiting/rejection before a window move; `92b6c536` adds `windowFailed` and its publication guard. Current builder source retains both scopes. The report already says source success cannot clear an unrelated failed window. No omitted collapse of the two outcomes was found.
- **F15/F16:** `0041231b` shares callback iteration at collection-change and scheduler call sites; `573ccf00` replaces local normalization functions with shared imports in subscription, effect and builder; `886ecdba` represents failure by an optional record. `5a6b966a` reduces effect cleanup storage; `b09f7765` snapshots iteration and re-adds a callback on outer failure after reentry. Current source retains these behaviors. The report explicitly preserves sequencing/error-delivery limits and the reentry correction. No direct derivation of F16 from F15 is established. Shared helper bodies outside the 13-path corpus were not independently audited.

## Reconstruction and coverage controls

The inspected parent/commit hunks support the reported local substitutions. They do not regenerate the frozen files, show all intermediate changes, or prove runtime correctness. The report already states these limits, excludes unopened hunks, says its graph is incomplete, and distinguishes its optional grouping from release order. No missing global-completeness qualification was recovered from those paragraphs.

Its count of 132 first-parent commits is a report claim. This audit did not reproduce that index because doing so would require the prohibited new history survey. Nor did it compare all 13 paths equally: named detailed transformations concentrate in subscription, sync, ordered loading, scheduler, effect, window control and demand segmentation. State/lifecycle internals and adapter behavior were not surveyed. Those gaps are not evidence of absent responsibilities. Baseline presence dates inherited forms only to the bounded starting point; bulk-import internals and unnamed intermediate changes remain unknown.

The six-line TODO checkpoint preserves “Analysis only” and “not a ranking,” but compresses the report's detailed scope, ancestry and reconstruction limits into a link. Its word “complete” modifies the two sibling grammar readings, which were hidden. This audit cannot verify that word or their status and does not use it as a coverage claim for the Formation section. No additional substantive historical claim appears in the checkpoint that this bounded source pass can independently recover or defeat.

## Instrument limits and distortion

Reading the frozen reduction first was required to define the admitted hunks, but it anchors this scanner to the report's units. A loss-seeking pass can make omitted implementation details look like necessary additions merely because they can be named. This result therefore lists them without ranking usefulness or choosing restoration. Treating a lineage as one bundle also differs from scanning unrelated source accounts: repeated endpoint and hunk evidence is correlated, not independent confirmation. Architecture can make a contract condition salient without proving when it entered the code or whether adapters fulfill it.

One bounded pass is complete. No repair, new survey, test design, simplification ranking or implementation choice follows from it.
