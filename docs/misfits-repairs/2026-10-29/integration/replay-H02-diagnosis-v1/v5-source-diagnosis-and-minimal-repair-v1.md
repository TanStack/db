# H02 v5 source diagnosis and minimal repair

Source-only diagnosis. No source edit, receiving run, verifier run, build or production execution occurred during this review. The v5 native failure and its initial mistaken heap classification remain separate frozen records; `outcome-v2.json` is authoritative. There is still no queued-answer progress or semantic product verdict.

## The witness waits for an observation behind the feedback

The finite raw prefix is `receipts.jsonl`, SHA256 `f40eb411454d545b3b4d0d01f34576115307a778e2653efa19b7d66179895b86`. Its earliest relevant events are:

- 202: release owner 1's held pivot request.
- 203: its actual provider answer is backend version 1, rows `[]`.
- 204: acquire owner 2's pivot scope with the pivot absent.
- 212: owner 2's real QueryFn starts a held finite request, with its old backend-version-0 cache containing the pivot.
- 214: release that acquisition with the pivot present.
- 218/224, then repeated: cached acquisition restores the pivot; release removes it. No new QueryFn is needed.

The driver's `cacheVersions` mirror updates only in the QueryCache success listener (driver lines 230–246). Frozen Query Core `query.ts` lines 678–685 first assigns `query.state`, then synchronously calls observers, and only afterward notifies QueryCache. `QueryObserver.#notify` similarly calls actual listeners before cache listeners. The adapter also applies an available cached result immediately when subscribing (`query.ts` around 3373–3397).

Consequently, the empty owner-1 sibling cannot reach the mirror while its success observer is stuck in the acquire/release feedback. The gate inside the held QueryFn sees a false `emptySibling`; the later `await hostTurn()` continuation cannot repair that missed observation. The 14,276 acquisitions versus 13 provider requests distinguish cached feedback from repeated backend calls. The old driver also conditions its feedback stack receipt on `answerQueued`, so that receipt is unreachable in this failure.

**Minimal witness repair:** keep the same conditional law and conflict predicate. At the existing held-request registration, inspect the actual Query cache state directly, using exact actual keys/scopes. Require the real pending request, its actual old cached pivot, and a distinct actual success-state empty pivot sibling matched to a recorded finite backend-version-1 provider answer. Record those primitive facts before emitting the premise and calling the existing `queueAnswer`. Reuse that detector before release when an eligible request is already pending; do not require a fresh QueryFn to rediscover it.

The provider-answer record at 203 alone is insufficient: it proves production of an answer, not installation in Query's cache. A failed direct-state check remains an unmet premise. Do not queue speculatively at 203 or invent a cache-success receipt. Keep enqueue-return/executed-first-action receipts, real pending-promise resolution, relational model and cached ownership rules unchanged. Capture the first repeated acquisition stack independently of whether an answer was queued, at the existing real callback.

## The inspector remains active across the history

The native stack establishes `ScopeIterator` through inspector `currentCallFrames`, `didPause`, `BreakRightNow` and API interrupt. It does not identify the pause requester. This review found no explicit `Debugger.pause`, `setPauseOnExceptions` or debugger statement in the instrument or retained loaded V8 source. The setup does connect an inspector Session, enable Debugger and precise Profiler, and keep them active until `afterAll` (setup lines 133–165). The native failure is not a demonstrated heap limit or product defect.

**Minimal instrumentation repair:** restrict inspector use to startup loaded-source capture. Acknowledge a skip-all-pauses policy, collect `scriptParsed`/`getScriptSource` and actual loader-registry evidence, then seal the startup source envelope after dynamic driver import and acknowledge disable/disconnect before invoking the driver. Place this teardown in receiving setup, before any product history action. Remove optional precise coverage; it is not required by the binding verifier and supplies no final credit in v5.

Later capture hooks can read the loader registry passively. Preserve exact original-to-loader-to-V8 byte containment and fail closed for a later module without captured binding. Preserve lawful callback `Error.stack` receipts for actual DB/db-ivm/Query execution. A pure session-protocol calibration should reject missing teardown acknowledgement or any active pause/coverage session crossing into driver invocation. This removes the active debugger from the feedback interval without claiming to have proved its exact native trigger.

These two bounded source repairs need exact review and a new receiving admission. Neither changes production, model, grammar, contract, resource limits or the operational/result classifications.
