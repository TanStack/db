# Combined v1 source-scope findings

Combined v1 remains unaccepted and preserved. These findings concern the source binding and recipe, not observed product failures. All candidate twenty states remain UNREACHED.

## H02-CAND-INDEP-COMB-V1-04: child request scope names the wrong domain

The baseline grammar names `answerScopes.peer` as child-source parent pivot `[keyShift + 3]` (`queued-answer-completion-baseline-history-oracle.ts` line364, SHA256 `726f4919ff69052e8a7c3ae7c9b26a866dcb935d3393e80152da85d7349cc082`). The finite provider records `requested` by filtering authored child rows and mapping each `id` (`queued-answer-completion-fixture.ts` lines170–172, SHA256 `4816305d73e96c55d109c5807a91cadd9fbe90257a4b70b0554e626ebe2a8dce`). Those child IDs are `parent * 100 + 1/2` from the shared facts constructor. The driver requires deep equality of these arrays (lines203–210), so its exact peer lookup cannot bind the grammar's parent-domain scope. The source-failure and terminal-graph paths require that lookup and therefore cannot establish their claimed premise under this source binding.

Repair the declared scope abstraction explicitly, preserving raw child rows/returned IDs and exact request identity. Do not replace the exact match with a broad fallback. The native author independently confirmed this mismatch and plans an explicit unique-parent projection.

## H02-CAND-INDEP-COMB-V1-05: answer facts exceed the acquired source scopes

The baseline grammar uses the shared full `answered` facts for held-window, failed-peer and initial-tail `source-answer` actions (lines273–285 and317–319). The shared constructor changes every root's rank and adds children for the first two roots (`queued-answer-completion-history-oracle.ts` lines206–217, SHA256 `5e1902e7ea02b8f11521c8ef5cc5b63c426fe3b92b50174e5c755be9b3c892fc`). But held-window deliberately reloads the marked source (driver lines444–455), and failed-peer's outstanding child scope is the pivot parent. Releasing those source answers does not itself establish changed retained root ranks or new first-two-parent children. `fixture.setFacts` changes backend fixture facts; it is not an observation that all changed source rows were acquired and applied.

Author each source-specific answer from independent backend facts and actual requested scope, or add separately justified acquisition paths. Preserve earlier installed rows when no source response/update replaces them. Do not fit the model to production output or credit whole-backend facts from one answered scope. The native author confirmed this source/recipe mismatch and asked the model author for source-specific facts. The exact successor selection must disclose any per-cell tie change needed to keep singleton failure/peer scope; no broadened query match or general tied-rank claim is warranted.

No runtime or grammar execution was performed. Source inspection and Python standard-library artifact/hash work only. Original immutable packets and canonical status/accounting/cutoff remain unchanged.
