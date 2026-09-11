# Phase 3 pre-implementation test plan

Extend only source adaptation for the integrated specimen; phase 1/2 stay frozen.

- A full TSX module with imports, query input schema, sibling mutation/onMutate, route/UI must produce the real query's SQL/order diagnostic. Phase 2 currently rejects this grammar; capture its actual unsupported result as red evidence.
- Preserve source offsets across extraction: repeated orderBy decoys in sibling mutation/comments/JSX must not become the repair target. Applying repair must change only listTodos' actual order call, and rechecking must clear.
- Bind query/db/table/auth/operators to the integrated worker's explicit import contract. Changed imports, computed query configuration/spreads, handler transforms/branches and opaque query helpers remain not checked. Other endpoint bodies/UI are outside this check.
- Use exact known disposable schema contract and source/schema revision evidence, never imply live deployment matching. Missing/stale declared binding contracts cannot certify the source.
- Actual emitted SQL from the integrated server query must equal analyzer SQL for the test input if worker can expose it. Otherwise mark generated SQL correspondence as a remaining gap rather than claiming runtime identity.
- CLI emits absolute source URI/hash, endpoint identity, location/edit and rerun; copies under this track prove apply/clear/stale. Coordinator owns any final edit to the integrated app source.
