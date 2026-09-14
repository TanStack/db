# Frozen candidate for parallel audits: global quiet-read admission

This is one proposed Endpoints design, not current working code. Test its own standards. Do not read sibling forms or the other audit. This packet is frozen after Design Grammar extraction. It supplies qualifications deliberately; an already disclosed missing mechanism is not an implemented bug.

## Structural claim

A local client epoch plus a global read after overlapping handlers finish can prevent stale authoritative results from overwriting newer authority, while actions still dispatch immediately and guesses remain owned DB transaction overlays. It is a candidate conservative protocol before server-version-based optimization.

## Exact source proposal

> For an isolated mutation, keep the current fast path: apply the authoritative results in its response, then retire its optimistic overlay.
>
> When mutations overlap:
> 1. Keep executing them immediately and showing their overlays.
> 2. Record each handler’s outcome, but hold snapshots whose freshness is uncertain.
> 3. Once all outstanding handlers have returned, request fresh authoritative results for every potentially affected retained collection.
> 4. Apply that response only if no new mutation started during the read. Otherwise, discard it and reconcile again after the new work finishes.
> 5. Install authority before retiring the acknowledged mutations’ overlays. Their success or failure remains separate from reconciliation.
>
> Each collection also needs an instance generation, so a late response cannot update a collection that was GCed and recreated. Ordinary query reads must follow the same checks.
>
> This adds an extra request for overlapping writes, but introduces no mutation queue or disabled actions. If reads exhaust retries, surface the error rather than claim coherence.

## Normalized state and transitions (candidate inferences)

C = query semantic/auth identity, retained instance lifetime, baseline/load/coherence status.
M = mutation identity, possible effects and handler outcome: unknown/success/error.
O = actual DB Transaction and its whole-row optimistic snapshots, associated with M.
R = read attempt with captured local epoch, target lifetimes, cause and completed effects it can cover.
F = local epoch, unknown-handler set, known outcomes awaiting coverage and dirty-instance obligations.

1. Action captures O, creates M, advances epoch, marks potentially affected retained collections and dispatches immediately.
2. A valid handler envelope makes M's outcome known; missing/failed transport alone does not. O and dirty obligations can remain after M's outcome is known.
3. Isolated inline snapshots may be admitted only with own-handler completion, no uncertain overlap, correct lifetimes/scope and matching epoch.
4. After overlap, issue a fresh full read once relevant handler outcomes are known. Wait on handler knowledge, not persistence receipts, since receipts require this reconciliation.
5. Accept only with sufficient effect coverage, unchanged relevant epoch, matching scope/lifetimes and complete valid results. Otherwise keep outstanding obligations. Ordinary/initial/refetch responses use the same admission boundary.
6. Install accepted results, then retire the specific covered O records with their individual M outcomes. Other transactions' whole snapshots remain owned and unchanged. Do not substitute field merges or a new mutation queue.
7. GC removes only that lifetime as a target; a newly retained/recreated lifetime needs catch-up. Handler/read failures remain separate; only reads retry.

## Success standard and preserved requirements

- No stale observation replaces newer justified authority simply by arriving later.
- No overlay retires as successfully reconciled without authoritative coverage of its finished effects for relevant retained instances.
- Every affected non-GCed instance participates, including zero-subscriber instances and late creation.
- Settling one operation preserves still-owned sibling snapshots. Ordinary collections remain writable; actions synchronously return real Transactions.
- Unknown effects cannot narrow authoritative reads to optimistic recipients; partial commits survive handler errors.
- API/server source exclusion remains intact. No production speed or universal SQL claim.

## Explicit conditions and unresolved boundaries

Assumptions for the finite success path: one stable client/auth authority domain; relevant writes close within handler lifetime; reads observe completed writes from that authority; relevant handlers/read responses eventually finish and some valid read interval is free of new relevant mutations. These are conditions, not tested server guarantees.

No unconditional liveness is claimed under continuous traffic. No external-writer subscription, auth-transition protocol, stale-replica contract, unknown-operation-status lookup or idempotent write retry has been supplied. Client epochs are not server versions.

No atomic multi-collection publication or simultaneous overlay-retirement mechanism has been supplied. Newly loading collections may lack support for exact optimism. Existing query-adapter admission, duplicate delivery and precise cohort boundaries require an execution model. Unknown-outcome and exhausted-read UI/overlay exits remain incomplete. State those limits accurately; distinguish a counterexample within declared premises from an unimplemented extension or ambiguous rule.

## Same-system source trace available to the auditor

All paths relative to this file:

- `../../../integrated-todo/src/runtime.ts`: current registry, queryFn direct recording, inline persistence, independent installs, transaction receipt tracking, creation/readiness guards. It has no proposed generation protocol.
- `../../../integrated-todo/src/refresh.server.ts`: handler executes once; success/error captured; reads run/retry; combined envelope returned. Handler completion is not sent separately before read completion.
- `../../../../../packages/db/src/transactions.ts`: commit/persist/rollback and notification order. Cascade only to conflicting `pending` transactions; Endpoints invokes commit immediately, yielding `persisting` state.
- `../../../integrated-todo/tests/oracles/driver.mjs`: current sequential oracle/gates. Gaps should identify a missing law, scheduling dimension or publication assertion.
- `../../representation/audit-fixes.md`: grounded baseline behavior and known scope, not a concurrent proof.

The proposer’s other variants and the sibling audit are intentionally outside this packet. You may inspect these code paths for integration constraints and run bounded standalone diagnostic models under this audit's directory. Do not implement fixes or change runtime/tests. Constructed model executions must be labeled as such; they do not prove actual Endpoints behavior.
