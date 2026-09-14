# Hostile failure assay — frozen auth candidate v1

Date: 2026-09-12. Candidate: `audit-candidate.md`, “per-query guards and selective payloads v1.” This is a fresh, blind design examination. It is not implementation, adoption, or a security certification.

## Result

I did not establish an unconditional contradiction in the all-proven, single-batch guard-before-payload protocol. Its guard, binding, write-union, and conservative fallback gates defeat the direct skip-auth attacks examined here.

Two source-backed undercutters remain in its composition with existing behavior: the existing concurrency repair runs whole query handlers in parallel, and a legal opaque fallback can still write while a proven sibling payload is being read. “Full refresh” alone does not close either ordering gap. Both admit concrete stale-result schedules. Whether they violate this candidate depends on where its phase law applies and whether its success guarantee includes proven queries in mixed batches. The candidate needs to resolve those boundaries; neither is listed among its explicit unresolved transport/client requirements.

A third, narrower failure hypothesis concerns returning a refresh error before all already-started guards have stopped writing. The present read runner uses fail-fast aggregation. The candidate does not specify its guard error barrier closely enough to establish or dismiss that hypothesis.

These are bounded design/integration findings, not reproduced bugs in a candidate implementation: no implementation exists in the allowed evidence. I found no basis for claiming that the current eight Kitchen payload queries exhibit the session-table example below.

## Evidence boundary

I read the hostile-assay instrument, this one candidate, `sources.md`, `sources.json`, the disposable session probe and its recorded results, and permitted local sources S1, S2, S4, S6, S8, S9, S10, S11, S12, and S13. Their file hashes, and those of S18/S19, match the dossier. I did not read sibling designs, other auditors' findings, field logs, or the broader oracle suite. I did not inspect application credential values, call a live auth service, edit app/framework code, or modify installed libraries. I did not rerun the probe because the matching recorded probe already establishes the relevant single-invocation paths; it does not exercise the disputed batch schedules.

Source IDs below refer to `sources.json`. Line references are to those matching files. Hypothetical handlers and schedules below are deductions, not measured Kitchen behavior.

## A1 — The existing repair path does not establish the proposed phase law

**Broken link.** The candidate promises authoritative settlement using “the existing concurrency repair path.” Its safety argument gathers guard writes before payloads, but the traced repair path performs separate whole-handler query RPCs in parallel. A table may be selected for refresh correctly and still be read before a later covered guard write.

**Evidence.** S13 `runtime.ts:756–777` switches overlapping inline operations to `refresh()`. At `576–616`, that refresh waits for tracked mutations to close and then runs the retained endpoint RPCs through `Promise.all`. `479–487` retries each whole endpoint RPC. It has no global guard-completion boundary. S4 `session.mjs:153–220` reads a session and can later renew it by writing `expiresAt` and `updatedAt`. S19 confirms an accepted invocation can write a session. S10 shows the ordinary leading-guard shape; it does not include a sessions payload query.

**Concrete admissible scene.** Consider two proven handlers using the same ordinary session guard and the pinned, hook-free auth policy. Query A selects only session IDs and renewal timestamps; query B selects an unrelated payload. Both payloads are deterministic database reads and discard the returned user. A concurrency repair starts their ordinary whole-handler RPCs:

1. Both guards read a session due for renewal.
2. A's renewal commits at time t1; A's payload reads the timestamp t1.
3. B's already-started renewal commits at time t2, after A's payload read.
4. Both RPCs finish. The repair publishes A's timestamp t1 and settles the operations. The database now holds t2.

No new mutation starts during this repair, so the client epoch and topology checks do not force a second pass. No external writer or hidden hook is needed. There is one final covered write after A's payload read. This is a permanent stale result until another event, not merely a demand for a shared SQL snapshot.

**Disposition.** Confirmed source-level mismatch between the inherited repair implementation and the candidate's phase argument. It is an undercutter of the assertion that the *existing* repair suffices, not proof that a future implementation obeying the phase law on every refresh path must fail. If the candidate intends to replace repair reads with a batched guard/payload operation, that intent closes the ambiguity but is additional integration work. The actual eight Kitchen payloads do not read sessions, so this example does not establish a current Kitchen failure.

**Repair condition.** Apply the guard-effect completion boundary to repair reads as well as inline mutation refreshes. An alternative is an explicit restriction that repair guards cannot write any retained payload dependency. A table write set alone is insufficient; the selected payload must execute after the relevant completed effects. Keep whole-handler retry as an acknowledged opaque fallback rather than silently using it for a proven D retry.

**Missing oracle dimension and smallest class-level test.** Generate effectful leading guards on otherwise pure handlers, including two guards writing the same payload table. Drive overlapping mutations into the repair path, control the completion order of guard writes and payload reads, and assert that after quiescence every covered retained result equals a final database evaluation. Include both inline and repair execution as a generator dimension. A single pinned renewal race can seed the replay, but the law must quantify over guard/read schedules. The allowed single-call auth probe has no retained-query, repair, or publication model; its green result cannot catch this class. I did not inspect other oracles and cannot say which existing test should have caught it.

## A2 — Legal opaque fallback is not yet safely composed with proven siblings

**Broken link.** The candidate permits whole-handler fallback for unknown purity or interleaved authorization, says unknown means full refresh, and otherwise gathers writes from the mutation and query guards before selecting payloads. An unsplittable fallback has no proven G/D boundary. Forcing every payload to run does not ensure its unknown writes finish before the proven payload reads them.

**Concrete scene.** A retained proven query P performs its leading permission check and then selects an audit table. Retained query F has interleaved authorization and an awaited audit write, so it is correctly classified as opaque and executed as a full handler. A mutation affects an unrelated table. The engine treats F's effects as unknown and selects every payload, then preserves the current parallel read behavior:

1. P's guard completes.
2. P's selected payload reads the audit table.
3. F writes an audit row and returns successfully.
4. The batch publishes P's pre-write result and settles.

All dependencies can be conservative, all required guards can run, and no reuse need occur. The result is still stale because selection was substituted for ordering. F is deliberately *not* labeled proven. Its opacity is the legal fallback case being tested, rather than a hidden hook smuggled into the proven subset.

**Evidence.** Candidate scope and steps 3/6 allow the fallback and retain existing behavior. S12 `refresh.server.ts:35–52` executes selected whole reads concurrently and retries them. S6 demonstrates why opaque auth calls can have write effects, although this hypothetical handler does not depend on any actual Kitchen hook. The dossier reports no configured Kitchen hooks.

**Disposition.** Conditional compositional gap, not an unconditional counterexample to an all-proven-batch theorem. It is admissible if “every affected retained collection” and “within the proven subset” protect P while a legal fallback sibling exists. It is outside the guarantee only if the candidate explicitly withdraws that guarantee for the entire mixed batch. The existing text does not choose between those readings. The explicit fallback limitation on effect-once semantics does not by itself disclaim stale proven sibling payloads.

**Repair condition.** State the batch boundary. Options include completing effectful fallbacks before the proven guard/payload phase, with an explicit policy for their own returned snapshots; restricting optimizable batches to handlers whose effects close before any payload reads; or declaring and testing a weaker guarantee for mixed batches. Do not describe “refresh all” as sufficient evidence of authoritative settlement when unknown reads can themselves write. Arbitrary opaque handlers may require a stronger restriction; this assay does not claim a finite rerun loop can make them converge.

**Missing oracle dimension and smallest class-level test.** Mix proven and opaque retained handlers in generated batches. Let fallback effects occur before, between, and after sibling payload reads, including partial-write failure and retries. Assert final-state correctness for every query still covered by the stated guarantee, or assert that the batch is explicitly classified outside that guarantee. The false-green model to avoid treats all query handlers as pure reads or treats “selected” as equivalent to “fresh.” No claim is made that the unexamined broader oracle currently has that model.

## A3 — Failed guard aggregation may leave a request with outstanding writes

**Broken link.** “Gather all query guards before selecting payloads” constrains a successful selection. It does not explicitly say whether a failure response waits for every guard already invoked to finish its effects. The candidate relies on existing closure/repair behavior.

**Failure hypothesis.** Guards A and B start. A fails. A fail-fast coordinator returns `read-error` while B is still waiting to perform a session renewal. The client treats the mutation operation as closed, then starts a repair or another mutation refresh; that work reads the sessions payload before B's late write. The late write is from this client's earlier refresh, not a newly discovered external writer.

**Evidence.** S12 `36–52,69–78` uses `Promise.all`, whose rejection does not cancel sibling promises. S13 `683–698` marks the operation closed upon the read-error envelope and fails its transaction. The traced code does not establish that every sibling endpoint has ceased effects. This is existing execution structure, not evidence that the unimplemented candidate's guard runner will copy it.

**Disposition.** Unresolved error-path closure hypothesis. It is defeated if the candidate's guard-before-payload law requires all guards' effect completion before *any* terminal response, including denial/failure. A conservative may-write union does not alone establish that temporal fact. No delayed-guard reproduction was run.

**Repair condition.** Specify guard failure aggregation and closure evidence: await all started guards' effect completion before declaring the refresh closed, or track outstanding effectful work as a separate obligation and prevent authority publication until closure is known. A timeout or cancellation signal is not proof that the database work stopped. Do not rerun the mutation to repair this condition.

**Missing oracle dimension and smallest class-level test.** Generate one rejecting guard and one delayed writing guard; permit a subsequent repair once the first error response arrives. Check that no authority is declared current before all covered effects close. Include guard outcomes independently from guard side effects. This tests an error/completion law rather than just another renewal input.

## Disposition of the other material attacks

| Attack | Disposition and evidence | Condition for reopening |
| --- | --- | --- |
| Reuse skips authorization | Defeated by steps 2, 4, and 7: every query runs G, and deny/failure cannot yield unaffected/unchanged success. S11 shows the current bypass being addressed; it is not evidence the proposed gate fails. | A generated skip branch bypasses G or checks only mutation auth. Test the full cross-product of selection/revision outcomes and allow/deny/error. |
| Cookie cache accepts a revoked session | Real measured policy behavior, explicitly excluded as a stronger freshness demand. S19 `revoked-cached` accepts without a database read. The candidate preserves configured caching. | A product requirement changes the auth policy; this assay does not make that decision. |
| Session expiry writes despite disabled refresh | Real behavior, already covered by the candidate's guard write union and error paths. S4 checks expiry before `disableRefresh`; S19 records deletion. | An effect summary omits deletion or assumes disabled refresh implies no writes. |
| Guard renewal or partial failure writes escape dependency selection | Defeated for completed, correctly summarized guards by step 3. S4/S19 substantiate that guards need write effects; the candidate includes them. A1–A3 concern completion/order, not a missing sessions entry. | A summary fails to include schema effects, hooks, or error-path writes. |
| Auth output changes while SQL table dependencies remain unchanged | Defeated by the server-held binding comparison and preserving captured values in steps 4–5. Unproven dependence must fall back. | A compiler binds only user ID while D actually uses another changed captured field, or equality/encoding is unsound. No such compiler was supplied. |
| A forged client baseline grants permission | Defeated by fresh G and server-held binding. Client flags are not server authority. S11's existing raw-input/certificate implementation is not the proposed parsed-input/auth binding implementation. | The proposed binding is omitted from the unaffected branch or trusts client values. |
| Hooks, callbacks, mutable closures, or later row auth are silently treated as pure | Rejected as proven inputs by scope, not a demonstrated internal flaw. S6/S8 show why effects cannot be assumed away. A2 separately tests their expressly legal fallback composition. | A concrete proof classifier accepts one despite incomplete effects or captures. |
| A D retry uses an earlier allow after expiry/revocation | An intentional consequence of retaining a successful G while retrying only D. The candidate explicitly declines revocation detection stronger than actual guard invocations. This cannot establish a breach of that narrow standard. | A requirement demands a fresh permission decision per retry or per SQL attempt. That would need an explicit retry/auth contract, not silently replaying an effectful G. |
| One guard fails but another allows; the batch withholds successful data | No internal failure. Atomic authority publication may withhold the whole batch. Per-query guards do not imply independent partial success publication. | A separate availability requirement mandates partial publication. |
| Renewal/expiry headers are lost or conflict | Explicitly unresolved transport work, not a new discovery. S1/S2 do not request returned headers; S8 exposes them only through the relevant return modes. No browser delivery evidence exists. | A transport design claims delivery/merge semantics without browser tests, including simultaneous renew/delete headers. |
| Denial leaves local data visible; a same-user session replacement accepts an old response | Explicitly unresolved stale-data erasure and session-generation teardown. S13's generic failure path does not purge baselines. The candidate expressly says this is not a finished auth implementation. | Completion is claimed before denial and lifetime-transition tests pass. |
| A refresh failure replays the mutation | Defeated at the stated contract and traced server boundary: S12 invokes mutate once and returns its outcome separately from read error. Partial writes remain possible on handler error; the candidate acknowledges that. | A client maps refresh failure to mutation retry, or a transport retry replays a non-idempotent request under a newly claimed guarantee. Neither was demonstrated here. |
| A deployment change makes a static library summary false | Unproven deployment premise, not a demonstrated counterexample to version/config/schema-pinned summaries. The recorded package/source pins support one examined version only. | A claimed supported deployment changes hooks, schema effects, configuration, or code without invalidating the summary. |
| Server code or secrets reach the client build | Unverified success condition. The auth split/compiler build does not exist in the examined evidence; no positive leak evidence was found. | Inspect generated client artifacts after implementation, using synthetic server-only sentinels. |
| Claimed payload savings do not materialize | Not presently claimed. Eight public API scenarios measure control flow, not transformed app performance. Correct conservative fallback may yield no savings. | Savings are asserted without a converted-app measurement that includes guard costs and fallback frequency. |

## Compact findings and limits

- **A1:** Existing repair does not supply the global guard barrier. A hook-free session-renewal schedule can stale a sessions payload during repair. Resolve whether repair adopts the new protocol.
- **A2:** Full refresh does not by itself safely compose effectful opaque fallbacks with proven siblings. Specify the mixed-batch guarantee and execution order.
- **A3:** Specify whether failure responses wait for all started guard effects to close. Current fail-fast read aggregation is not that proof.
- No unconditional failure of the fully obeyed, all-proven single-batch protocol was established. Cached revocation, header forwarding, typed errors, and local/session teardown were not promoted into new internal bugs.
- This assay checked one frozen candidate and matching local sources. It neither inspected a candidate compiler nor ran PostgreSQL/browser integration, measured payload savings, or reviewed the broader test suite. The concrete schedules are counterexamples to the identified inherited/mixed execution readings, with the stated repair conditions; they are not claims of measured production failures.
