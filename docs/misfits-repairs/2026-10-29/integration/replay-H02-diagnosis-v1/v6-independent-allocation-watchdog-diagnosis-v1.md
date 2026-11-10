# H02 v6 independent result and source diagnosis

Reviewed HEAD: `9cfa11fc712866f8f276e85762865ebb8bd49cbe` in the detached H02 worktree. Scope: independent file/hash verification, receipt parsing, pure replay of captured diagnostic text, and source inspection. No receiving execution, test/build/binding-verifier execution, production edit, or instrument source edit was performed by this reviewer. Reports are outside the frozen result directory.

The accepted law, H02-CONDITIONAL-QUEUED-PROGRESS, requires query processing to return control so an already queued finite backend answer can execute, preserving cached-row ownership and atomic publication. It excludes permanently conflicting caches and supplies no numeric product deadline. The accepted-law plan expressly permits an external watchdog after the measured queued premise as **bounded progress RED**. That result is separate from resource failure, public-row assertion failure, universal noncompletion proof, and final-comparison credit.

## Independent result verification

`canonical-current-main-v6/packet-sha256-v1.json`, SHA256 `67c3f331a859240819275135260433cb7009eb21e3676e291752d12d34c83221`, matches all 1,952 members and 68,221,119 bytes. There are no missing, extra, size-mismatched, or hash-mismatched members. Authoritative outcome-v2 remains `0ac0cf85662e724f269868eba5bf36922ea0dd0308eefadb4c8276aad04938cc`.

Independent parsing found 141,963 complete, contiguous, newline-delimited receipts in 37,674,726 bytes, SHA256 `7a6f8aa247a3a1e60f17b40f676ed6fe7bb3ae48ec7998b337e027f94f75b850`.

- Receipt 214 is the actual conflict: physical Query 4, owner 2, cached version 4/backend 0/row 3, fetching and pending; distinct sibling Query 10/owner 1 has installed empty version 10/backend 1. The current and recorded identities/counts correspond on each side.
- Receipt 216 follows actual microtask enqueue return. There is no answer-executed, final-publication, cleanup-start, worker-cleaned, or worker-error receipt.
- Receipt 223 is the first repeated held acquisition, attempt 14; receipt 224 records the post-enqueue stack. Both run through the synchronous D2 demand path.
- Final receipt 141963 is valid `actual-key-prefix` at `cache-observerRemoved`, key `["h02-progress-markers",2,[3]]`.
- Counts: 14,187 acquisitions/acceptances, 14,179 unique matched releases, 13 provider requests, 10 provider answers, 9 cache successes, 4 source stacks. Owner 1 accounts for 8 acquisitions; owner 2 for 14,179. There are 9 distinct callback hashes, 8 provider/answer/cache hashes, 12 physical Queries at provider invocation, and 2 subscription owners. Maximum recorded outstanding acquisitions is 9; final outstanding is 8.

The receiving worker PID 75057 explicitly exhausted its heap. The stderr reports a fatal JavaScript heap OOM, with last GCs at 5308/5360 ms and about 375 MiB retained. Supervisor elapsed time including verification is 6227 ms, sampled group RSS peaks at 831,750,144 bytes, and no kill was attempted. Existing wall/RSS limits were not reached. Root separately verified process-group absence; this reviewer did not repeat process inspection.

**V6 classification:** resource-limited finite prefix after a real queued premise. No product RED/GREEN, eventual noncompletion proof, allocation attribution, or closure is supplied by this run. The authoritative author classification is correct.

Machine-readable independent evidence: `v6-independent-result-verification-v1.json`, SHA256 `3d97d91420ff91ea964a03e964d7777c9abc13fe0dc77d6aed36b02e83fd5835`.

## Findings and evidence limits

| ID | Finding | Evidence/status | Action |
| --- | --- | --- | --- |
| H02-V6-IND-01 | Heap classification depends on stderr chunk boundaries. | Confirmed instrument defect by captured-text calibration below. Exact v6 chunk partition is unrecorded. | Repair detector; preserve original raw supervisor/outcome files. |
| H02-V6-IND-02 | Receiving heap retention has not been attributed. | Confirmed evidence gap. Native ArrayUnshift identifies an allocation operation, not a retained-object owner. | Measure fixed-storage milestones; do not label a product or instrument leak. |
| H02-V6-IND-03 | V6 does not reach the intended progress watchdog judgment. | Confirmed: heap exhaustion precedes wall/RSS containment, with no kill. | Arm an independent short parent window after validated enqueue; keep resource precedence. |

### H02-V6-IND-01: chunk-sensitive classifier

Supervisor `queued-answer-progress-supervisor.ts:248–257` saves the complete stderr bytes, then appends a decoded chunk, truncates to the last 4,000 characters, and only then applies `/FATAL ERROR:.*heap|Allocation failed - JavaScript heap out of memory/`.

Captured stderr has 7,851 characters. The fatal headline starts at offset 464, 7,387 characters before the end. A pure offline text replay of this algorithm gives different classifications for the same text: one whole-stream chunk never detects heap; eight chunks of at most 1,024 characters detect heap; one-character chunks detect heap. This is a text/parser calibration, not another receiving execution or a production test. The recorded runtime chunk partition is absent, so do not claim this proves precisely how the observed generic classification arose.

The smallest repair scans the prior bounded matching suffix plus the **full incoming chunk before trimming**, and latches an independent heap fact. A final read of the already preserved regular stderr file is also an admissible backstop. Preserve resource classification if a later kill/cleanup event occurs. Calibrate whole-stream, split-marker, and tiny-chunk partitions; include ordinary stderr and the earlier non-heap native CHECK as negative controls. A heap fact must never become progress RED merely because a later watchdog also expires.

### H02-V6-IND-02: allocation and retention inventory

| Location | What source establishes | What remains unmeasured |
| --- | --- | --- |
| Receipt writer | One fd, counters, failure state; per-event JSON/string/Buffer and synchronous complete writes; no all-receipt array. | Allocation rate, GC retention, observer overhead. |
| Startup source binding | Three passive registry cuts, 172 inventory entries each; startup metadata/sealed keys; acknowledged debugger disconnect before history. | Retained V8/loader metadata size and engine reclamation. |
| Driver strong Maps | Latest queryScopes by 9 hashes, answers/cacheVersions by 8 hashes; 2 subscription identities. | Retained sizes, including physical Query references in provenance. |
| Driver pending array | Exactly 5 held provider requests after reload, with 2 released; 13 provider calls in total. | Retained size of their shared references. It is not a 14,187-entry request array. |
| Driver WeakMaps | Physical Query tokens and option-to-attempt arrays; release shifts match every recorded attempt. | Whether product promises/signals/other references keep historical option keys alive. Weak keys alone do not prove collection. |
| Driver activeAttempts | Push before actual load, pop in finally; no retained receipt history. | Actual nested depth was not instrumented. Outstanding lease count is a different quantity. |
| D2 writer queues | `graph.ts:36–43` unshifts each MultiSet into each reader queue; `drain` copies/reverses and clears it. | Queue occupancy by graph/reader and retained Multisets during feedback. |
| Product promise continuations | Per-load, result-application, aborted-segment, and replay continuations exist; host microtasks cannot drain while the synchronous graph call continues. | Counts/retained sizes and their share of the exhausted heap. |

The parent reader/checker and the sequential offline binding verifier run in other processes. Their receipt arrays cannot directly occupy receiving PID 75057's JS heap. Host timing/resource interaction remains possible.

Two relevant production unshift sites exist: D2 `graph.ts:42` and Collection `changes.ts:277`. The latter prepends a fresh local callback array only for layout-only publication; it is not inherently a historical log. The sealed evaluated source inventory also contains these two sites; other loaded native/dependency scripts contain additional unshift operations. The OOM native frame alone selects none of them. Repeated source input can accumulate in another graph's D2 readers while the active graph occupies the synchronous scheduler, making those queues a concrete measurement target, not an attributed leak.

## Source-supported feedback explanation

The actual stacks pass through compiler include-demand tap → `CollectionSubscriber.setDemand` → `SubsetDemandController.setDemand` → `requestSnapshot` → adapter acquisition, inside `D2.run`. The local chain is synchronous:

1. Pivot 3 is eligible in the LEFT join/undefined-marker result and enters the selected parent window, which demands its include.
2. Acquisition creates/subscribes an observer to the same cached Query. `subscribeToQuery` immediately applies a current successful result; `applySuccessfulResult` inserts the cached marker and commits synchronously.
3. The marker makes pivot 3 ineligible. The include's demanded keys retire that acquisition; releasing its final owner lets `cleanupQueryInternal` synchronously delete the marker and commit.
4. The marker deletion makes the pivot eligible again. The D2 demand path reacquires its cached include, and the sequence repeats.

The raw trace supports both membership directions: repeated acquisitions observe pivot absent; their releases observe pivot present. After request 212 there is no new provider invocation or cache-success receipt. The active physical Query's finite new answer is released only by the callback queued at 216. That callback first emits answer-executed, then clears holding and releases the remaining provider promises. These actions cannot run before host control returns.

`D2.run` has a synchronous while-work loop without a timer, acquisition budget, or host yield. The builder checks ordered loaders after `graph.run` returns, so an ordered-loader latch does not itself interrupt this inner loop. Monotonic revisions, new abort controllers and pending continuations can still change hidden state; identical key receipts alone are not full-state cycle proof.

A specific competing explanation is Query Core cancellation/restart: if its own lazy signal is consumed, removing the last observer can cancel/revert its retryer; otherwise Query Core cancels retries and preserves the current fetch, and a new observer can reuse its promise. A cancellation/restart could change the cache/fetch authority and break the apparent cycle. The v6 prefix shows no new provider request or cache success after 212, so this alternative did not occur in that measured prefix. A successor diagnostic should preserve actual Query identity/version/fetch-status and request-count facts rather than infer them from equal keys.

## Minimal next instrument plan

Root subsequently authorized **v7 instrument-only preparation and pure/static controls**, with no next receiving run. The author owns implementation; this report makes no source changes.

1. Repair/calibrate the chunk-insensitive sticky heap fact. Keep raw failed packets and separate classifications intact.
2. Add fixed-storage counters/milestones for the post-enqueue interval. Reuse validated physical-query premise facts; avoid per-cycle Query-state scans, receipt arrays, retained snapshots or stacks. Capture the first two acquisition/release turns and bounded scalar totals. If D2 queue occupancy is measured later, use transparent diagnostic wrappers/counters with separately bound effective code, no payload retention or scheduling change.
3. In the independent parent, arm a short operational window only after the strict receipt parser has consumed the actual valid premise and the corresponding completed host enqueue. Root proposed 1,000 ms to precede the observed roughly 5–6 s OOM. This changes containment, not the product law. Preserve the existing 20 s/384 MiB/1 GiB maxima; do not relax them.
4. Calibrate startup-only, enqueue-before-premise, mismatched enqueue, callback-executed, and resource/observation-failure precedence. Check the post-enqueue deadline **before an unbounded parent drain can delay containment**; existing drain captures a finite size but can still consume substantial work. Keep process-group cleanup and all raw receipt completeness checks.
5. Review the exact frozen successor and recipe before root admits a receiving run. A post-enqueue watchdog on that same unchanged production path is admissible bounded progress RED under the accepted plan; it receives no final-row/publication-comparison credit and proves no universal noncompletion claim. A resource failure still receives no progress verdict.

Use a bounded semantic-cycle capture to strengthen source causality, not as a new full-native-state proof requirement. The relevant distinctions are the synchronous D2 call, alternating demand/pivot membership, current pending physical Query, unchanged cached version and provider-answer count, and unexecuted host callback. Specific hidden state should be measured when it could change this path; arbitrary counter growth does not itself disprove the feedback explanation.

The required pre-edit receiving inventory remains: conditional queued progress on current production, cached-row ownership, retained/atomic publication with public and downstream observations, demand/final-value preservation, literal-true synchronous initial readiness, and ordinary synchronous mutation. V6 grants no final receiving credit. A next progress RED does not replace any neighboring owner's assertion or allow blanket cache discarding, demand suppression, ownership-policy changes, or unconditional yielding. Production edits remain behind the accepted current receiving gate.
