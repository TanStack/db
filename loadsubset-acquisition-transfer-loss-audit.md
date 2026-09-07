# Acquisition transfer loss audit

One supported loss appears in the test: the candidate removes the baseline's explicit reference-identity assertions for unload options. No production behavior or callback-order loss is supported by this bounded static comparison.

## Frozen inputs and scope

- Baseline: `89d3ba2bbd6cbbaf86f0dff2eec1e61814fbd4c8`.
- Candidate: `2a489848854a1f1394139ad1399fd29f3b110f3a`.
- Read-only worktree: `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`.
- Production source: `packages/db/src/collection/subscription.ts` at those revisions. Read the complete affected methods, ownership fields, replay setup and settlement, initial startup, release paths, status/error observers, snapshot callers, and teardown. The two-revision diff establishes that the other inspected methods are unchanged.
- Test source: the changed handoff test in `packages/db/tests/collection-subscription-replay-oracle.property.test.ts`, baseline lines 3249–3306 and candidate lines 3249–3318; its imports, `ReplayRow` type, and `flushPromises` helper (`packages/db/tests/utils.ts`, candidate lines 417–419).
- Required context: applicable AGENTS instructions, full Field Lab skill and loss-audit card, and full live `packages/db/src/query/live/ARCHITECTURE.md`. The architecture's Git blob hash was `f8282bca8ca7b84277bd0ac4ff2cffdae6dfd132`.

This is one fresh Hidden-signal recovery assay (`loss-audit`). It audits the closure-to-transfer reduction and the associated test expansion. No tests ran, no production files changed, and no prior reports, plans, or broad history were consulted.

## Recovered item: exact unload argument identity

**Original support — static source evidence.** Baseline test lines 3297–3299 assert two unloads and separately require `unloads[0]` to be `loads[0]` and `unloads[1]` to be `loads[1]` using `toBe`. These assertions preserve object identity, not just equivalent option values. Production source also names this contract: baseline lines 146–149 say that exact load options are stored for symmetric unload; baseline lines 1081–1083 pass the prior acquisition's options directly to unload.

**Where it vanished — static source evidence.** Candidate test lines 3303–3305 replace the individual identity checks with `toEqual` on the unload array. Lines 3310–3312 likewise use array deep equality after teardown. The new abort assertion checks the candidate's signal state, not the identity of the options received by unload.

**Reduction rule.** The four-cell expansion compresses individual reference assertions into one conditional expected-array assertion. That preserves expected array length, order, and value comparison but drops the explicit identity comparison. The original two-true cell remains in the matrix, so this is an assertion loss within a retained scenario rather than removal of the scenario.

**Bounded failure example — inference, not an executed mutation.** If unload receives a shallow copy of the candidate's options, with every nested value and its signal retained, the former candidate `toBe` assertion distinguishes that copy from the loaded object. The new deep-equality assertion does not require that distinction. The adapter fixture's `options === loads[0]` branch still constrains the first old-lease unload when release or failure is enabled; it does not independently establish candidate-options identity. Thus the fixture's identity branch does not recover the entire dropped assertion.

**Comment limit.** The title's “exact replay handoff” and lines 3308–3309's “that exact lease” describe behavior the production paths support, but the new assertions alone no longer prove exact options identity throughout the trace. This is a test-proof limit, not evidence that production unload now receives copies. No false baseline assertion was found.

## Production preservation trace

| Item checked | Baseline support | Candidate support | Static reading |
| --- | --- | --- | --- |
| Capture timing | Lines 508–527 capture prior state and acquisition before installing `next` | Lines 516–536 retain those capture points and put the same references in the transfer | No capture moved across adapter or status callbacks |
| Conditional restore | Lines 523–527 return unless the demand still points to `next` | Lines 1080–1085 return unless it points to `candidate` | Both preserve a newer reentrant acquisition at this restore step |
| Restore call sites | Lines 539, 576, 611, 628 | Lines 548, 585, 620, 1089, reached by line 638 | Throw, superseded adapter return, superseded status return, and acceptance retain restoration |
| Acceptance order | Restore at 628; read demand's current acquisition at 1076; install next at 1081; unload prior at 1083 | Restore at 1089; read current acquisition at 1091; install next at 1096; unload prior at 1098 | No callback occurs between these ordinary field operations in either version; acceptance still rereads current ownership after conditional restore |
| Unload failure with live demand | Lines 1085–1086 restore the prior acquisition; caller lines 635–646 retire candidate and report failure | Lines 1100–1101 and 643–654 retain the same steps | Rollback and reporting order remain |
| Unload failure after reentrant retirement | Lines 1087–1090 retain old acquisition as debt | Lines 1102–1105 retain the same exact acquisition | Reentrant release sees candidate; failed old release remains retryable |
| Initial or detached startup | Initial path at 1133–1230; replay marks non-active prior demand active and returns at 621–623 | Initial path unchanged; replay early return at 630–632 | Acceptance helper is still restricted to replay with a prior active acquisition |

The transfer's readonly wrapper is shallow: it fixes its fields at the type level while retaining mutable demand/acquisition objects, as the baseline closure did. It adds no retained session field, admission check, or asynchronous step. The movement of restoration inside the acceptance call's `try` does not expose a new ordinary callback boundary: these ownership records are internal plain objects in the admitted source.

Adapter throw, demand retirement, stale sync session, and superseded attempt checks retain their order before acceptance. Replay participation is still registered before status observation, and the subsequent reentry checks remain at the caller. The restore method's narrow comment describes restoration only; it does not claim acceptance can never overwrite newer state. That distinction exists in the baseline too.

## Four-cell trace

Let P be the prior acquisition and N the candidate. The following traces are static inferences from the admitted subscription methods and test fixture, not test results.

| Reentrant release | Old unload throws | Unloads before unsubscribe | N aborted | Unloads after unsubscribe |
| --- | --- | --- | --- | --- |
| false | false | P | false | P, N |
| false | true | P, N | true | P, N, P |
| true | false | P, N | true | P, N |
| true | true | P, N | true | P, N, P |

In the live-demand failure cell, rollback restores P and the caller retires N; unsubscribe releases P. In the retired-demand failure cell, reentrant release retires N and the acceptance catch keeps P as debt; unsubscribe retries P. The fixture throws only on the first old-lease release, so that retry succeeds. These sequences match the candidate's expected values and preserve the baseline's two-true trace.

## Controls and limits

The chosen reduction and four-cell matrix select attention toward active replay handoff. That selection can hide unrelated subscription defects. The matrix flattens adapter behavior to synchronous `true` results and one old-unload callback with two booleans; it does not measure async settlement, cleanup/restart during unload, external cancellation, nested truncates, or callback exceptions beyond the named old-release error. Static inspection checks whether the refactor retains those existing branches; it does not establish their runtime correctness.

Both frozen versions were visible during comparison. This preserves exact code provenance but offers less isolation than fully separate scanners for each source. No sibling audit informed this reading. Required architecture context supplies constraints, not empirical proof. Imported sync-manager and callback-runner implementations were outside this admitted bundle, so the report does not claim an end-to-end execution proof.

The supported recovered item is the removed identity assertion. The production-loss result is explicitly null within the admitted scope. This audit neither ranks that loss nor decides whether to restore it.
