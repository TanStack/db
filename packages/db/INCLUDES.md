# Includes: Hierarchical Data via Subqueries in SELECT

## Overview

Includes lets users nest subqueries inside `.select()` to produce hierarchical results. Instead of JOINs that flatten 1:N relationships into N rows, each parent row gets a child **Collection** containing its related items.

```typescript
const projects = createLiveQueryCollection((q) =>
  q
    .from({ p: projectsCollection })
    .select(({ p }) => ({
      id: p.id,
      name: p.name,
      issues: q
        .from({ i: issuesCollection })
        .where(({ i }) => eq(i.projectId, p.id))
        .select(({ i }) => ({
          id: i.id,
          title: i.title,
        })),
    })),
)
```

The result is a collection of projects where each project's `issues` field is a live Collection — a real `createCollection()` instance that updates incrementally as the underlying data changes. This nests arbitrarily: issues can include comments, comments can include reactions, etc.

## How it works

The system has three layers: the **builder** that parses the user's query, the **compiler** that builds the D2 pipeline graph, and the **output layer** that routes pipeline results into live Collections.

### 1. Builder: detecting includes

When the user passes a query builder as a value in `.select()`, the builder recognizes it as an includes subquery. It inspects the child query's WHERE clauses to find the **correlation condition** — an `eq()` that references both a parent alias and a child alias (e.g., `eq(i.projectId, p.id)`).

The builder extracts the parent-side reference (`p.id`) and child-side reference (`i.projectId`), removes that WHERE clause from the child query (since the compiler handles correlation differently), and produces an `IncludesSubquery` IR node.

### 2. Compiler: inner join filtering

The compiler processes includes after WHERE but before SELECT. For each `IncludesSubquery` in the select:

1. **Branch the parent pipeline** to produce a stream of parent correlation keys (e.g., all current project IDs).
2. **Compile the child query** recursively, passing the parent key stream as a parameter.
3. Inside the child compilation, the child's FROM input is **inner-joined** with the parent keys before anything else (before the child's own WHERE, SELECT, ORDER BY). This means the child pipeline only ever processes rows that match a parent currently in the result set.
4. Each child row is tagged with a `__correlationKey` (the parent's correlation value) so the output layer knows which parent it belongs to.
5. The `IncludesSubquery` entry in SELECT is replaced with a null placeholder.

The inner join is the key architectural decision. It means:
- When a parent is filtered out by a WHERE clause, its children are automatically excluded.
- When a parent is added back, its children automatically flow through.
- The child pipeline never processes orphaned rows.

### 3. Output layer: per-parent child Collections

The output layer creates a **separate child Collection for each parent row**, keyed by correlation value. Flushing happens in five phases per includes level:

1. **Parent INSERTs**: A child Collection is created for the new parent (even if empty) and attached to the parent result object.
2. **Child changes**: Routed to the correct child Collection by correlation key. Inserts, updates, and deletes are applied via `begin/write/commit`. The routing index is updated so grandchild changes can be routed later.
3. **Drain nested buffers**: Buffered grandchild changes are routed from shared buffers into the correct per-entry states using the routing index.
4. **Flush per-entry states**: Each child entry's own `includesStates` are flushed recursively.
5. **Parent DELETEs**: The child Collection entry and its routing index entries are removed so re-added parents get a fresh Collection.

#### Nested includes: per-entry state isolation

For **nested includes** (e.g., projects → issues → comments), each `ChildCollectionEntry` owns its own `includesStates` array — an isolated copy of the nested `IncludesOutputState` for that specific parent. This avoids a shared-state problem where flushing one parent's nested changes could clear pending changes for another.

Nested pipeline output (e.g., comments) writes into **shared buffers** (`NestedIncludesSetup.buffer`), one per nested includes level. During flush, `drainNestedBuffers` routes changes from the shared buffer to the correct per-entry state using a **routing index** (`nestedRoutingIndex`) that maps each nested correlation key (e.g., `issueId`) to its parent correlation key (e.g., `projectId`). The routing index is built in Phase 2 as child changes are processed, ensuring new children are indexed before their grandchildren need routing.

This bottom-up approach means:
- Only entries with actual changes are visited (no O(N) scan of all child entries).
- Each entry's nested state is independent — flushing one never affects another.
- The shared buffer acts as a staging area until the routing index can resolve the destination.

## Architecture diagram

<img src="https://github.com/user-attachments/assets/c00e6a6b-017c-4c7a-a7fc-6be9bafe9770" alt="Includes architecture" />

<details>
<summary>Text version (for agents / plain text readers)</summary>

```
                    D2 / DB-IVM Pipeline Graph

 Input:                  Input:                    Input:
 projectsCollection      issuesCollection          commentsCollection
      |                       |                         |
 filter() for            map({issue}) =>          map({comment}) =>
 .where(...)             [issue.projectId,        [comment.issueId,
      |                  [issueKey, issueRow]]    [commentKey, commentRow]]
      |                       |                         |
      +----+                  |                         |
      |    |                  |                         |
      |  map({project}) =>    |                         |
      |  [project.id, null]   |                         |
      |    |                  |                         |
      |    +-----> innerJoin() <--+                     |
      |                |          |                     |
      |           map to extract  |                     |
      |           [issueKey,      |                     |
      |            issueRow]      |                     |
      |                |          |                     |
      |           groupedOrderBy() |                     |
      |           for .orderBy(..)|                     |
      |           .limit(10)      |                     |
      |           (grouped by     |                     |
      |            projectId)     |                     |
      |                |          |                     |
      |                +----+     |                     |
      |                |    |     |                     |
      |                |  map({issue}) =>                |
      |                |  [issue.id, null]               |
      |                |    |                            |
      |                |    +--------> innerJoin() <-----+
      |                |                    |
      |                |               map to extract
      |                |               [commentKey,
      |                |                commentRow]
      |                |                    |
 map() for        map() for           map() for
 .select(...)     .select(...)        .select(...)
      |                |                    |
 Root Output:     Child Output:        Child Output:
 project          issue                comment
      |                |                    |
      v                v                    v
 Fan out to       Fan out to           Fan out to
 result           ChildCollections     ChildCollections
 collection       per project          per issue
```

</details>

## Files

| File | Role |
|------|------|
| `src/query/ir.ts` | `IncludesSubquery` class, updated `Select` type |
| `src/query/builder/index.ts` | Detects query builders in select, extracts correlation from WHERE |
| `src/query/compiler/index.ts` | Inner join with parent keys, recursive child compilation, correlation key tagging |
| `src/query/compiler/select.ts` | Skips `IncludesSubquery` entries (null placeholder) |
| `src/query/compiler/group-by.ts` | Guard for `IncludesSubquery` in `containsAggregate` |
| `src/query/compiler/order-by.ts` | Grouped ORDER BY for child queries with LIMIT/OFFSET |
| `src/query/live/collection-config-builder.ts` | Child Collection lifecycle, output routing, nested includes |

## Design decisions

**Per-parent child Collections vs. a single shared Collection**: Each parent gets its own Collection instance. ORDER BY works without grouped variants because each Collection is an independent scope. LIMIT/OFFSET uses `groupedOrderByWithFractionalIndex` (grouped by correlation key) so the limit is applied per parent, not globally across the shared child pipeline. The trade-off is N Collection instances for N parents, but each is lightweight (a sorted map and a few objects), and updates are O(1) by correlation key lookup.

**Per-entry nested state vs. shared nested state**: For nested includes (3+ levels), each `ChildCollectionEntry` gets its own `includesStates` array rather than sharing a single `IncludesOutputState` across all children. Shared state caused two problems: (1) flushing the first child's nested changes would clear `pendingChildChanges`, losing changes for other children, and (2) detecting which children had nested changes required an O(N) scan of the entire child registry. The per-entry approach uses shared buffers for pipeline output (since D2 outputs are not scoped to a parent) and a routing index to distribute changes to the correct entry during flush. This keeps flush cost proportional to the number of entries that actually changed.

**Inner join placement**: The inner join happens before the child's WHERE/SELECT/ORDER BY. This means the child pipeline only processes relevant rows, and the child's own WHERE can add additional filtering beyond the correlation condition.

**Child Collections are output-only**: They don't sync with any backend. The source collection (e.g., `issuesCollection`) syncs once, the D2 pipeline processes the data, and child Collections receive pre-computed results via `begin/write/commit`. No redundant data loading.

**Correlation extraction**: The builder auto-detects the correlation by scanning the child's WHERE for an `eq()` that references both parent and child aliases. The user doesn't need to explicitly declare the relationship — it's inferred from the query structure.

## V2 and beyond

Things not covered by the current implementation:

- **Composite correlation keys**: V1 supports a single `eq(child.field, parent.field)` correlation. Multi-field correlations (e.g., composite foreign keys) would require extending the correlation extraction and inner join to handle multiple fields.

- **Explicit child Collection disposal**: Currently, when a parent is deleted, its child Collection is dereferenced from the registry and left for GC. If child Collections gain resources that survive GC (subscriptions, timers), explicit cleanup would be needed.

- **Optimistic mutations on child Collections**: Child Collections are currently read-only outputs. Supporting `insert`/`delete` mutations that propagate back to the source collection would require a mutation routing layer.

- **Cascade behavior**: Deleting a parent does not delete its children from the source collection. This is by design — includes is a view, not a referential integrity system. Cascade deletes would be a separate feature.

### Implemented in follow-up branches

The following V2 items have been implemented:

- **`toArray()` on child Collections** (`kevin/includes-to-array`): Wrap a child query with `toArray()` to get a plain array instead of a live Collection. The parent row is re-emitted whenever its children change. Works at any nesting level and can be mixed with live Collections.

- **Per-parent aggregates** (`kevin/includes-aggregates`): Aggregate functions (count, sum, etc.) work in child queries and are computed per parent, not globally. The correlation key is taken into account during GROUP BY so each parent gets its own aggregate result.

- **Parent-referencing WHERE filters** (`kevin/includes-arbitrary-correlation`): Child queries can have additional WHERE clauses that reference parent fields (e.g., `eq(i.createdBy, p.createdBy)`). Parent fields are projected into the child pipeline and filters are fully reactive. The correlation condition can also be extracted from inside `and()` expressions.
