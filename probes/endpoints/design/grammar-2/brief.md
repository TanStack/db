# Endpoints: full results with independently justified shortcuts

## What this tells us

The revised design language starts from your chosen authoritative baseline: **evaluate potentially affected queries on the server and return their full results with the mutation**. Analysis can justify doing less at several separate points. There is no single “this endpoint is optimized” decision.

Safe execution, safe optimization, and worthwhile optimization are distinct. The current prototype does not yet make that separation: unsupported query extraction becomes a compiler error. The new grammar represents conservative execution without claiming it is already implemented.

## What it changes

**Each shortcut has its own conditions.** Proving a query unchanged can avoid its read. Sufficient effects and supporting data can avoid full evaluation. A usable baseline can permit a result delta after evaluation. Compatible queries can share SQL work, and compatible results can share encoding. Evidence for one does not authorize the others. Unknown impact retains conservative read candidates. The oracle must still check every active collection, including those analysis skips.

The measured sharing case makes the cost distinction concrete: at the largest size, sharing reduced gzip by about 33% with overlap and increased it by about 33% without overlap. Combining SQL and sharing rows remain separately optional; their analysis and selection overhead also count. The experiment supplies no universal threshold.

**Read recipients and optimistic participants are different sets.** Suppose optimism changes a collection, but the server takes another branch that leaves its authoritative result unchanged. A read may be unnecessary if that is established, while the tentative change still needs retiring. Mutation prediction inputs, predicted writes, actual direct/indirect writes, and query dependencies cannot be collapsed into one list of touched tables. Complete changed-row images can still miss an unchanged join partner needed for a result.

**Two ownership forms remain, unranked:**

| Form | What changes | Main added obligation |
| --- | --- | --- |
| Query-owned results | Coordinate supported optimistic edits across existing collections | Discover recipients, compute their distinct edits, and coordinate settlement while retaining separate result ownership. |
| Shared supporting data with query overlays | One supported row edit feeds several derived results | Track coverage, fields, retention, and valid write mappings; a full query response cannot replace unrelated shared support. |

Both retain bare writable collections and synchronous Transaction-returning actions. Both can use the same delivery shortcuts. Neither is an implemented or certified module replacement.

## What it does not tell us

Full-result fallback resolves missing authoritative result data; it does **not** guarantee exact optimism for an unanalyzable case. That behavior remains open. So do general evidence acquisition, validated active-instance information at the server, preload/late-activation policy, writable projections, and observation/publication rules for overlapping mutations. One response does not prove atomic publication. No implicit mutation queue or client-side server-code shortcut is admitted. Exhausted reads may report an error; they do not undo a committed write.

Source reconstruction and the narrow encoding experiment support this grammar, but **independent range remains untested**. All known examples informed extraction. The clean separation into units and evidence can hide the difficulty of obtaining those facts and maintaining them as demand and state change. Local PGlite timings do not establish production benefit. No architecture, initial support set, or cost policy has been selected.

Support: [Model](./model.md), [Evidence](./evidence.md), [Process and claim map](./process.md), [preservation contract](./preservation.md). The analytical layers were [frozen before this brief](./analysis-freeze.json).
