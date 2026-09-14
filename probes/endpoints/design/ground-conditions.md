# Ground-condition probe: optimistic coherence and authoritative updates

Completed 2026-09-11. This is the second operation in the user-selected sequence. Input: the [bounded research survey](./optimistic-coherence-research-survey.md), [frozen local source facts](./local-source-notes.md), and the user's added question about small mutation responses versus per-query refetch. It does not choose an architecture.

## Frozen question and baseline

**Question:** Under what conditions can one optimistic mutation update overlapping endpoint collections, and when can a small authoritative response reconcile them without a full client refetch?

**Observed baseline:** The current prototype has two independent, fully loaded, identically scoped and ordered Todo queries. An insert into one reaches only that collection. Both query functions return complete rows. The [one-operation receipt](../integrated-todo/evidence/e2e-current/coherence/sequence.json) records this known missing feature. No DB defect is inferred.

**Current implementation account:** Collections are addressed by declaration. A transaction records direct mutations and refetches its direct targets. The current client does not receive a relation connecting the two query declarations. [Runtime](../integrated-todo/src/runtime.ts), [compiler](../integrated-todo/bound-transform.mjs).

**User-owned aims retained:** Bare writable query collections; synchronous optimistic actions; DB query evaluation; no implicit mutation queue; server-code exclusion; coherent supported queries; a client error is acceptable when read retries exhaust. The latest addition asks for different reconciliation choices for different query–mutation pairs. These are requirements, not observations of existing coverage.

## Conditions and controllers

All consequences below are analyst inferences about the design question; implementation facts are labeled separately.

| Condition | Who supplies or controls it | Current evidence | If it changes / fact needed |
| --- | --- | --- | --- |
| Shared row identity includes source relation and scope | Compiler/schema metadata and runtime identity rules | Runtime has endpoint and row IDs; no general provenance relation is emitted | Matching plain IDs can conflate unrelated records. Need a declared or checked equivalence relation. |
| Query semantics are available and supported locally | Compiler and query definition | Only checked ordering crosses the present compiler boundary | A client cannot infer an opaque filter or projection from a result array. Need safe query metadata or server evaluation. |
| Locally available rows/fields suffice for this change | Loading contract and server response | Current oracle uses full Todo results; limited/projection cases are outside it | Need a coverage claim for the affected operation, not merely a cache with some rows. |
| Mutation effects are known completely enough | Server execution and mutation contract | Current RPC returns no reconciliation contract; onMutate is an authored guess | Need authoritative effects or query results. A list of guessed writes does not prove trigger/server-only effects absent. |
| Returned updates have a usable baseline and order | Read/write protocol and runtime | Current protocol relies on full refetch; no cross-query snapshot revision is emitted | Need enough provenance to reject stale delivery, remove the right optimism, and interpret deletions/omitted fields. Exact token design is open. |
| Several query updates have a defined publication boundary | Runtime and delivery protocol | One transaction can record several explicit collection writes; automatic group discovery is missing | Need to say when all related consumers may observe the new state; method must not smuggle in a mutation queue. |
| Read path can recover or report failure | Backend, retry policy, UI | Three read retries exist; user permits a surfaced error after exhaustion | Lack of an authoritative result must not be represented as proof of successful synchronization. Retained-row policy is not selected. |

## Dynamics, constraints, and boundary conditions

- **Dynamics:** A write produces local optimistic change, the server accepts/rejects or transforms it, authoritative information arrives, and the related local changes settle or fail.
- **Constraints:** Query results depend on identity, membership, order, sufficient source information, and a usable update baseline. Server authority cannot be replaced by an optimistic guess. Client-visible metadata must preserve the server-code boundary.
- **Boundary conditions:** Which rows and fields are loaded; query shape and arguments; scope; mutation footprint; pending writes; server transformations; available snapshots or deltas; read availability. These vary by query–mutation pair.

## Matched coverage comparison

This is a **constructed information counterexample**, not a new executed oracle test or a claim about a vendor implementation.

Hold fixed the underlying data `A(rank=1), B(rank=2)`, the query `ORDER BY rank, id LIMIT 1`, and the mutation `delete A`.

| Case | What the client knows before deletion | Server response | Can the client determine the exact next result? |
| --- | --- | --- | --- |
| Ordinary complete-data case | Both A and B, and the query rule | Deleted ID A | Yes: reevaluate the query to obtain B. |
| Partial-data boundary | Only the current query result A | The same deleted ID A | No: B's identity and fields are absent. |
| Boundary with additional information | Only A before the mutation | Deleted ID A plus authoritative replacement B and a usable result/version contract | This particular information gap is closed; other ordering/concurrency conditions still apply. |

The control is a second possible server world, `A(rank=1), C(rank=2)`. It presents exactly the same initial client result and deletion payload, but the required next result is C. A deterministic client receiving those identical inputs cannot know which answer is correct. Extra local coverage or extra authoritative information changes that fact.

This changes the **information path**, not just CPU cost. A mutation-row payload insufficient for one query can be sufficient for another. It does not show that a small response is impossible: the server may find B and return it. Nor does it show that the server avoided executing the full query.

## Supported range and remaining questions

For known row-preserving queries over sufficient local data, shared storage or coordinated writes can address the baseline propagation gap in principle. This statement is conditional reasoning, not a tested design. Normalizing row identities alone does not supply query meaning, missing fields, or replacement rows.

For the partial boundary, the client needs more information or an explicit incomplete/error state. Whether Endpoints should restrict a query family, load supporting rows, compute query-specific updates on the server, or request a full refetch is still open. Exact client state and backend availability remain distinct requirements; an error does not justify silently treating stale data as current.

The new server-response question therefore has at least two separate measurements: **how much work the server performs** and **how much data crosses the network**. A server can compute a result delta after rerunning a query. That is a different mechanism from deriving it directly from mutation effects.

**What remains unmeasured:** Which compiler query forms have enough metadata; whether a real mutation exposes its complete footprint; overlapping transaction delivery; atomic publication across query results; and cost of server query recomputation. No benchmark or additional code experiment ran.

**Distortion introduced by this probe:** The toy top-1 case isolates missing coverage and hides joins, business logic, concurrent writes, and transport. It can make coverage seem like the only condition. The condition table restores those separate constraints; no single condition is selected as the decisive design criterion.

The original API and responsiveness requirements remain in force after this comparison. The next queued operation is the Design grammar extractor, using this result as a boundary condition rather than as a chosen solution.
