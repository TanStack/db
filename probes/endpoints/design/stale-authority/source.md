# Stale-authority proposal: frozen source

This source records the assistant's proposal immediately before the user selected Design Grammar, then parallel Fracture Scan and Hostile Auditor. It is a proposed protocol, not implemented behavior or an approved architecture. It belongs to the existing Endpoints system; linked files are context from that same system, not donor systems.

## S1 — Verbatim proposal

> I’d start with **a client generation counter and a conservative fallback when mutations overlap**. Request order alone is insufficient: an earlier request can commit later.
>
> For an isolated mutation, keep the current fast path: apply the authoritative results in its response, then retire its optimistic overlay.
>
> When mutations overlap:
>
> 1. Keep executing them immediately and showing their overlays.
> 2. Record each handler’s outcome, but hold snapshots whose freshness is uncertain.
> 3. Once all outstanding handlers have returned, request fresh authoritative results for every potentially affected retained collection.
> 4. Apply that response only if no new mutation started during the read. Otherwise, discard it and reconcile again after the new work finishes.
> 5. Install authority before retiring the acknowledged mutations’ overlays. Their success or failure remains separate from reconciliation.
>
> For example:
>
> ```text
> A starts → B starts → B returns → A returns → fresh read → install
> ```
>
> Neither response’s arrival order decides which snapshot wins. The fresh read runs after both handlers finish.
>
> Each collection also needs an **instance generation**, so a late response cannot update a collection that was GCed and recreated. Ordinary query reads must follow the same checks.
>
> This adds an extra request for overlapping writes, but introduces no mutation queue or disabled actions. If reads exhaust retries, surface the error rather than claim coherence.
>
> Later, a trustworthy server snapshot/version protocol could let us safely accept more inline responses and patches. That requires an explicit database consistency contract—especially for writes from other clients—rather than treating client counters or PostgreSQL transaction IDs as commit order.

## S2 — User-selected operation

> This is actually a pretty important design, so let's do a thorough job on this before starting implementation. First, run design grammar, and then in parallel, fracture scan and hostile auditor.

Execution queue: exploratory Design Grammar; after its analysis freezes, Fracture Scan in the orchestrator concurrently with a fresh Hostile Assay agent. No implementation is selected by this request.

## S3 — Existing user requirements

These are normalized from explicit prior conversation, not new preferences: bare writable query collections; synchronous Transaction-returning actions; no mutation queue or globally disabled actions; DB query semantics; guesses remain existing transaction overlays; server effects may differ or partly commit; every affected non-GCed collection participates regardless of subscribers; unknown effects require conservative refresh; server/client exclusion; distinct safety and measured-benefit decisions; independent PostgreSQL tentative/confirmed oracle; inspect concurrent and collection-lifecycle histories before optimizing.

## S4 — Grounded implementation context

- [Audit revision](../representation/audit-fixes.md): independent handler/reconciliation outcomes, committed writes survive handler failures, validation before baseline writes, sequential coverage and explicit lifecycle/concurrency limits.
- [Runtime](../../integrated-todo/src/runtime.ts): pending transactions are removed only on persistence settlement; initial reads directly record results; existing creation/readiness guards exclude creation/loading during mutations; retained filters status, not subscribers; authority installation and transaction settlement are separate operations. These are current facts, not the proposed generation protocol.
- [Server refresh](../../integrated-todo/src/refresh.server.ts): trusted read IDs, one execution of handler, handler error captured, requested reads retried, snapshots/results returned together; no standalone reconciliation endpoint or handler-completion notification exists.
- [Transactions](../../../../packages/db/src/transactions.ts): commit sets `persisting` before awaiting mutationFn; persistence receipts settle after transaction state change/publication; rollback cascades to conflicting transactions only in `pending`, not all `persisting` siblings.
- [Existing grammar](../representation/grammar/model.md): query/effect/transaction/collection/authority roles; unresolved lifecycle and observation contracts; independent effect and optimistic recipient selection.
- [Oracle driver](../../integrated-todo/tests/oracles/driver.mjs): explicit handler/read gates and PostgreSQL reference checks, but operations currently sequential and observations sampled at checkpoints.

## S5 — Evidence boundary

No concurrent Endpoints implementation exists in this proposal. The previous sequential oracle receipts are ground truth only for their tested scope. The extraction may formalize candidate transitions but must label added assumptions. It may not declare a common server snapshot, exact simultaneous multi-collection publication, guaranteed operation-status recovery, arbitrary initial-load optimism or universal eventual convergence.
