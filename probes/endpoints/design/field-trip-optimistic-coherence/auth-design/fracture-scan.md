# Fracture: full refresh is not an effect barrier

Run 24; orchestrator analysis on frozen audit-candidate v1, without changing it during the scan. The fresh hostile auditor has not seen this result.

## Frozen position

Claim: keep every retained query's permission check, collect request writes, and selectively execute pure payload reads; unknown handlers fall back to full execution. Every affected retained collection should settle to authoritative payload data without discovering external writes.

Premises: compiler-proven splits use G-before-D; unknown analysis stays legal via whole-handler fallback; guards may write; all covered writes inform selection; no exact old interleaving or shared database snapshot is promised. Protected insight: a permission operation need not force an unrelated payload SELECT, but neither its outcome nor effects may be omitted.

## FRC1 — the fallback can reopen the supposedly closed write phase

**Internal-extension trace:** candidate step 3 closes the guard/effect phase before payload selection → its scope and step 5 still admit opaque whole handlers → those handlers contain unseparated guards → a fallback guard can write after another payload has already been sampled → even selecting every collection does not ensure its returned rows include all completed request effects.

The missing condition is **effect completion**, not a more accurate table set. A may-write set says which reads could be stale; it does not establish when the last relevant write happened.

**Minimal scene:** retain A (a pure payload query) and B (an opaque handler whose permission hook writes A's table before returning its own payload). The mutation finishes. Full refresh selects both. A reads value 0. B's guard writes value 1. Refresh succeeds with A=0, while the database is 1. There is no external writer and no overlapping client mutation to trigger the existing stale-authority repair path.

The [probe](late-guard-write-probe.mjs) executes that schedule through the current `refreshAfterMutation` and a disposable PGlite database. [Results](late-guard-write-results.json) show a confirmed snapshot of 0 against authority 1. This is a constructed fallback witness, not evidence that Kitchen currently has the invented permission hook or that the unimplemented candidate compiler emits it.

**Admissibility:** A is in the proven subset; B exercises the expressly permitted unknown fallback. Guard writes are allowed by the candidate and observed as a category in Better Auth. The whole-handler hook is deliberately not called proven or pure. All writes occur inside the request; data equality is checked after both finish. No requirement for immediate revocation or an across-query shared snapshot is imported: A cannot include the later completed write at any point, and the claimed final reconciliation fails.

**Defeated consequence:** fallback-to-full-read alone does not preserve the candidate's all-retained reconciliation claim in a mixed cohort. This is narrower than rejecting guard/payload separation.

**Possible repair conditions, not implemented:** close every effectful operation before sampling final pure payloads; or restrict admitted query handlers to a proven effect boundary and explicitly reject/limit the unknown effectful case. Re-reading opaque handlers until stable is not a general repair because each read may itself write again. An implementation would need an effect-completion contract and a final read path that does not reopen it.

**Weakening evidence:** this is not an admissible fracture if the final contract excludes all effectful unknown query handlers, or if an existing outer phase demonstrably runs every such effect to completion before a fresh payload-only pass. Neither exclusion/barrier is stated in frozen v1. If candidate freshness is weakened to arbitrary samples during request execution, the scene no longer defeats it—but that would surrender the stated reconciliation law rather than prove it.

## Controls and surviving claim

Outside-standard rebuttal rejected: “Immediate database revocation must win even with a valid cached cookie.” The candidate explicitly preserves configured cache policy.

Vivid near-case rejected: a different process writes after the endpoint's final read. External discovery is out of scope and not needed for FRC1.

A second suggested attack—permission expires during a read retry—does not establish an internal fracture under the candidate's explicit per-guard invocation policy and lack of exact timing equivalence. It does expose a policy cost: reusing one guard result across payload retries differs from today's whole-handler retries. This is an unresolved lifetime/behavior requirement, not a second proven failure.

Surviving insight: with every effectful guard completed and a truly pure remaining payload operation, a fresh permission decision plus correct identity/effect evidence can permit unrelated payload reads to be skipped. This scan does not prove that the compiler can recognize that boundary in Kitchen.

## Test gap and limit

Missing oracle dimension: **query refresh itself performs writes**, including an opaque fallback beside a proven pure query. Existing mutation-focused schedules can stay green while assuming all reads are observational. Add generated G/D/fallback interleavings and compare every successful published payload with an independent final database read after all covered request effects. A mutant that starts one effectful fallback after a sibling payload sample should be caught. This covers the failure class rather than just this two-row schedule.

The witness uses the real refresh primitive and PGlite, but not compiled endpoints or client publication. The critique could become a false universal attack if the explicit unknown-fallback clause is later narrowed; preserve that scope limit with the finding.
