# Workflow 1 — editor repair loop

You edit `src/endpoints/updateTodo.ts` so that `updateTodo` skips its
authoritative refetch. The editor publishes an LSP diagnostic for
`endpoints/safe-skip-refetch`: `completeEffects` evidence is missing for this
exact unsaved document version. The diagnostic includes a condition ref,
snapshot, and `gatherEvidence` action.

Simulate the complete path a coding agent would take: inspect the diagnostic,
use MCP for the deeper explanation, obtain the evidence plan, run or externally
gather the required evidence, submit the complete result, and confirm the new
source version is clean or understand why it remains blocked. Include stale
document/snapshot handling where it naturally matters.
