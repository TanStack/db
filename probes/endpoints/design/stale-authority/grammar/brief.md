# Stale authority: Design Grammar reading

The proposal can be expressed as a rule about **what a read is known to include**. A client counter can show that local work happened after a read began. It cannot, by itself, establish server commit order or make a result authoritative.

The grammar therefore separates three events: the handler finishes, a read covers its effects, and the optimistic transaction retires. The current implementation's persistence promise combines the last two. Using that promise to decide when to start the read would create a circular wait. A separate record of handler knowledge is necessary for this proposal.

For an isolated mutation, its inline results can supply the needed coverage. After overlap, a read issued after every relevant handler is known to have finished can cover their effects—provided the read reaches the same authority, effects finish within the handlers' lifetimes, and no new relevant mutation invalidates the attempt. Once those results are installed, the specifically covered transactions can retire with their own success or error outcomes.

## What this makes explicit

- **The wait is for evidence, not permission to execute.** Actions still dispatch immediately and show owned whole-row overlays. Their receipts can nevertheless remain unresolved while authority is uncertain. Continuing traffic can prevent a quiet read indefinitely; the counter does not supply a progress guarantee.
- **A response belongs to particular collection lifetimes.** GC and recreation cannot reuse an old response's authority. A collection created during a mutation also needs catch-up even if it has no subscribers. Knowing it needs data does not supply the row support required for exact optimism while it loads.
- **Every path that writes confirmed data needs the same admission rule.** Initial reads and ordinary refetches cannot bypass the checks imposed on mutation responses. The existing query adapter publishes through a different path; this integration remains unproved.
- **The response and its transaction outcome are different.** A handler error can follow commits. A lost response does not prove that the handler finished. The source does not yet define operation-status recovery or every error/overlay exit.

The extraction supports two unranked forms: one quiet-read boundary for the client, and the same rules applied to independently proved impact domains. The second needs trustworthy dependency evidence and overlap handling; unknown effects collapse it back to the first. No measured benefit or architecture choice follows from this distinction.

## What remains open

The source does not establish atomic installation across collections or coordinated retirement of several same-row overlays. Per-collection writes and per-transaction notifications may expose intermediate states. Whole-row snapshot ownership must survive; silently merging fields or replaying edits would change the existing contract.

Other unresolved conditions include outcome-unknown requests, newly loading queries, admission inside the query adapter, auth changes, external writers and reads routed to stale replicas. Local generations do not solve those conditions. The quiet-read route provides conditional local catch-up, not continuous equality with a database that can change elsewhere.

This is an exploratory reconstruction with a provisional preservation list. The extraction introduced explicit records, coverage relations and assumptions to make the short proposal testable. Those additions can make it appear more complete than the source: they are labeled in the [model](./model.md). Reconstruction and exclusion examples were source-derived; **independent range is untested**, and no concurrent implementation was tested. The [evidence](./evidence.md) and [process](./process.md) retain the controls, losses and unresolved rule choices.
