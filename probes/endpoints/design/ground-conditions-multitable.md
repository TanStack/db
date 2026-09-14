# Ground-condition probe: multi-table reads and writes

Completed 2026-09-11. This is the user's second Ground-condition probe, extending the inquiry to multi-table programs. **The previous work acknowledged these cases but did not establish coverage.** This pass is an analytical comparison, not a new implementation or executed oracle test.

## Frozen baseline and claim

The existing generator creates one `todo` table, queries full Todo rows, and generates insert/edit/complete/delete operations against that table. See [generator](../integrated-todo/tests/oracles/program.mjs:17), [schema](../integrated-todo/tests/oracles/program.mjs:99), and [runtime](../integrated-todo/src/runtime.ts:62). The runtime captures explicitly mutated collections and refetches those targets. It does not establish general server read/write dependency tracking.

The [first probe](./ground-conditions.md) worked through a single-table top-k coverage gap. The [grammar](./design-model.md) names joins, grouped/distinct aggregates, complete mutation footprints, scope, and publication as conditional or unresolved. Naming them did not test them.

**Claim under examination:** Given the potentially affected active query instances, Endpoints can determine sufficient optimistic edits and authoritative updates. The earlier account leaves open where its dependency and sufficiency information comes from.

Hold the original goals fixed: bare writable query collections, synchronous Transaction-returning actions, no implicit mutation queue, server-code exclusion, independent oracle checks, and low update cost. An observable synchronization error after exhausted retries remains permitted.

## Dynamics, constraints, and boundaries

- **Dynamics:** A mutation reads state, chooses writes, predicts local effects, executes on the server, and reconciles every affected active result. Several statements can contribute to one logical mutation.
- **Constraints:** Knowing a table was touched does not reveal query membership, output multiplicity, all effects, or whether the client has the needed rows. Client guesses and server effects are different authorities. Query results require a defined observation baseline.
- **Boundary conditions:** Read and write relations; predicates and old/new values; client coverage; joins, aggregates and absent matches; indirect writes; transaction scope; query arguments and authorization; activation time; concurrent or external changes.

## Matched multi-table coverage comparison

**Constructed specimen, not observed Endpoints behavior:** `allocate(orderId)` reads `orders`, `inventory`, and a read-only `allocation_policy`; it writes `orders`, `inventory`, and `allocations` in one assumed atomic server transaction. For the comparison, hold policy, successful branch, server state, transaction schedule, and complete authoritative before/after effects fixed.

An active query is:

```sql
SELECT o.id, o.sku, i.available
FROM orders o JOIN inventory i ON i.sku = o.sku
WHERE o.status = 'pending'
ORDER BY o.id;
```

Before allocation, O1 and O2 both request SKU S; S has ten units. Allocation makes O1 allocated, inserts its allocation row, and reduces S to nine. The correct result loses O1 and changes O2's displayed availability from ten to nine, even though O2 was not written.

| Coverage condition | Information available | Consequence |
| --- | --- | --- |
| Complete local input relations | O1, O2, S, query semantics, and the complete effects | Reevaluate the join: remove O1 and update O2. |
| Only the complete current query result | Both output rows, their SKU and status contract, and S's after-image | This particular query can still be patched. Full base-table replication is not necessary here. |
| Only directly changed rows, while a related result must be initialized or expanded | O1, S, and the allocation; O2 and its relationship are unavailable | The effects alone cannot reconstruct that related result. More coverage or a server-produced result is needed. |

The third row is a separate loading boundary, not proof that a complete loaded join is unpatchable. To isolate a genuine missing-match boundary for a loaded result, use the following matched pair.

**Absent-match control:** Keep the allocation mutation and complete effects fixed, but examine an active `orders JOIN allocations JOIN customers` query that currently returns no rows for O1. It projects `order.id, customer.label, allocation.id`, joining the customer through `order.customer_id`. Before insertion the allocation does not exist. In one server world that unchanged customer's label is `Ada`; in another it is `Bea`. The client holds the same empty result and receives identical complete before/after images for all changed rows in orders, inventory, and allocations. The next join rows differ because the unchanged customer is absent locally. The client cannot determine the projected label from those identical inputs.

The ordinary control has the customer label available locally, or includes it in a sufficient server result. That closes this particular gap. This control varies coverage while preserving complete changed-row images. It shows why complete mutation effects need not be sufficient query-update data: an unchanged join partner can supply a newly visible field.

**Boundary sensitivity:** One changed input row can change untouched output rows or introduce previously absent join results. Relation-level impact can be conservative and sound under complete dependencies, while exact output edits still require more information. The information path changes; this is more than a larger number of rows.

## Candidate conditions and who controls them

All rows below are conditional reasoning about designs, not claims that the prototype supports them.

| Condition | Controller and evidence status | What changes at the boundary / missing fact |
| --- | --- | --- |
| Query dependencies include every input that can change the result | Query/compiler contract; currently not a general emitted contract | A query returning orders may also depend on inventory, allocations, policy, or permissions. Need semantic dependencies, including tables that currently contribute no rows. |
| Mutation reads and writes are distinguished | Handler/schema metadata and execution evidence | Reading policy can choose a write branch. A read does not itself change policy-query results. Treating every mutation read as a write creates extra recipients; ignoring reads loses prediction dependencies. |
| Potential writes differ from actual writes | Compiler or explicit declaration versus server execution | Static analysis may name several branches; a run chooses one. Optimism may choose another. Authoritative reconciliation must cover actual effects and retire all effects predicted for that transaction, including predictions the server did not realize. |
| Effects include indirect writes | Database/application execution boundary; not tested here | In a hypothetical cascade, trigger, helper, or procedure that writes another table, direct statement targets are incomplete. Need a trustworthy closure of effects or conservative dependency coverage. |
| Predicate and output dependencies include absence | Query semantics and dependency analysis | `NOT EXISTS`, outer joins, and zero-count groups can change when a previously absent match appears. An index of rows previously returned is insufficient. |
| Read-dependent optimism has enough state | Local coverage and authored optimistic contract | Two unseen inventory states can produce acceptance versus rejection for the same input. Exact prediction of the future commit is impossible from identical client information. A declared tentative model, restricted supported case, or unresolved state must be distinguished from committed truth. No policy is selected here. |
| Multi-table server and client publication have stated boundaries | Endpoint transaction contract and runtime | An atomic server write does not specify when independently delivered client collections publish. Without a defined boundary, an observer may combine new allocations with old inventory. Whether such intermediate observations are allowed must be stated before an oracle judges them. |
| One endpoint call has a known commit structure | Handler and backend topology | Several statements in one transaction, several commits, and writes to separate services are different histories. An endpoint function alone does not promise an atomic commit or rollback of already committed steps. |
| Identity, query arguments, and authorization remain scoped | Schema and server-validated instance descriptors | Equal IDs from different tables or tenants must not merge. Permission changes can alter visible results without changing projected business rows. Shipping a query handler or sensitive predicate data is not an acceptable substitute for safe metadata. |
| Active demand and observation versions remain usable | Client lifetime registry and synchronization protocol | A newly active query needs the pending multi-table intent; a late response needs an interpretable baseline. Invocation-time recipients alone do not settle either problem. |

For a closed model where all relevant dependencies and writes are known, an intersection between query read relations and mutation write relations can identify a **candidate superset**. It is not a proof of exact impact. Updating a field the query does not use, writing outside its scope, or taking a no-op branch can leave its result unchanged. Unknown dependencies cannot support an “unaffected” claim. Mutation read relations serve a different job: explaining which inputs control predicted or executed effects.

## Additional in-domain boundaries

These are paired hypothetical variants, not additional executed comparisons:

- **Independent row edits → join fanout:** Updating one product name can change one or many order-line outputs. Even a minimal correct result delta can be large; small write count does not bound response size.
- **COUNT → DISTINCT count or MIN:** A known contribution can update a simple count against a valid baseline. Removing a last distinct contributor or current minimum needs multiplicity/support or replacement information. “Aggregate” is not one update rule.
- **One changed input → two changed join inputs:** For an insert-only inner join, output additions can involve changed-left × old-right, old-left × changed-right, and changed-left × changed-right. Independent per-table patches against the old baseline can miss the last term; other schedules can double-count it. General deletes, updates, and SQL bag semantics need their own rules.
- **One transaction → external writer between reads:** Refetching all targets does not alone establish one common snapshot. The oracle must state whether it checks one transaction-consistent observation or later convergence. Literal equality to the latest server state at every wall-clock instant is not available during communication delay.

## Supported range, evidence, and remainder

This probe supports a narrower conditional claim: **complete dependency knowledge can support conservative recipient selection; sufficient coverage and a defined observation contract are separately required for exact edits.** Multiple tables do not automatically defeat local updates. Complete loaded joins can be maintainable; absent matches, read-dependent branches, indirect effects, and multi-input changes expose distinct missing contracts.

The prior single-table latency measurements do not bound join fanout, impact analysis, aggregate support, multi-table transaction work, or mixed delivery. Their two baselines—refetch and inline full results—still apply as comparisons, with those costs added rather than assumed away.

The missing facts are concrete: which read/write metadata the compiler can establish; what server execution can report completely; which query forms have sufficient local support; and what optimistic and authoritative observation boundaries the API promises. The existing oracle has not tested these facts. Useful future cases include an allocation transaction with multiple targets, a mutation reading an unchanged policy, an absent-match insertion, a two-input join change, indirect writes, rollback across targets, and activation while the transaction is pending. These are coverage gaps, not a selected implementation plan.

**Distortion from this probe:** The small deterministic allocation example favors explicit relational effects and one database transaction. It hides opaque application logic, external services, real scheduling, and transport costs. The hypothetical boundary inventory does not measure frequency or prove a candidate framework fails. This is not independent held-out validation of the earlier grammar.

The original requirements remain: a simple writable collection API, immediate optimism, coherent supported results, safe server/client separation, and measured cost. Discovering these conditions does not choose how much query generality Endpoints should support, what incomplete optimism should display, or which architecture to implement.
