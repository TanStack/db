# Normalized cache source track

Frozen input: [research-brief.md](./research-brief.md). Research question: What prior designs keep overlapping client query collections coherent during optimistic writes and server reconciliation, and what information and delivery guarantees do those designs require? This track covers normalized entity caches. It supplies evidence for the parent Research Survey; it does not select an architecture.

Research/access date and cutoff: 2026-09-11. English public primary documentation only. Six distinct pages opened and inspected. No runtime experiments or implementation inspection. Documentation dates were not visible; versions are recorded below. Every page carried a web-tool source word limit of 200 words. Each source's claims and boundaries below use approximately 100 derived words or fewer; reserve at least 90 words per source for the parent artifact, including repeated paraphrases. No direct quotations are used.

## Sources and typed claims

### NC1 — Mutations in Apollo Client

- URL: https://www.apollographql.com/docs/react/data/mutations
- Publisher/type: Apollo GraphQL; primary API documentation. Visible version: Apollo Client (Web), v4 (latest). Date: accessed 2026-09-11. Source budget: 200 words.
- Inspected sections: Updating local data; Include modified objects in mutation responses; The update function; Refetching after update.
- **NC1-C1 — Primary documented behavior:** Returned objects merge by `__typename` and configured key fields; returned fields replace matching cached fields. A newly cached object does not automatically enter list fields. An application updater can change list references, and dependent queries receive notifications. With an optimistic response, the updater runs for both optimistic and server results. Refetching can check the updater's approximation of server effects.
- **Boundary:** Identity matching does not document predicate evaluation or automatic discovery of every affected list. The page presents application-supplied cache edits and query refetching.

### NC2 — Optimistic mutation results

- URL: https://www.apollographql.com/docs/react/performance/optimistic-ui
- Publisher/type: Apollo GraphQL; primary API documentation. Visible version: Apollo Client (Web), v4 (latest). Date: accessed 2026-09-11. Source budget: 200 words.
- Inspected sections: The optimisticResponse option; Optimistic mutation lifecycle; Example: Adding a new object to a list.
- **NC2-C1 — Primary documented behavior:** Apollo stores an optimistic object separately from its canonical cache record and notifies active queries containing it. On response, Apollo removes the optimistic object and writes returned server values; GraphQL errors discard the optimistic version. Optimistic creation requires a temporary identity, replaced by the server object's identity on response.
- **Boundary:** This lifecycle example does not specify out-of-order acknowledgments or preservation of arbitrary overlapping read-dependent mutations. It cannot support a broad concurrency guarantee.

### NC3 — GraphQL mutations

- URL: https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/
- Publisher/type: Meta / Relay; primary API documentation. Visible version: v21.0.1. Date: accessed 2026-09-11. Source budget: 200 words.
- Inspected sections: Writing Mutations; Optimistic updates; Order of execution of updater functions; Invalidating data during a mutation.
- **NC3-C1 — Primary documented behavior:** Relay merges response fields into matching IDs. It reverts optimistic changes before server updates, then reapplies pending optimism around other store changes. Failure rolls back optimism. The guide warns that two captured optimistic count increments can leave a count increased twice after one rollback; it points to optimistic updaters for store-dependent values. For hard-to-enumerate effects, it describes invalidation and later refetch.
- **Boundary:** Replay is documented; correctness of arbitrary captured values or unknown server effects is not guaranteed. This is an explicit concurrency caveat, not a measured failure rate.

### NC4 — Updating Connections

- URL: https://relay.dev/docs/guided-tour/list-data/updating-connections/
- Publisher/type: Meta / Relay; primary API documentation. Visible version: v21.0.1. Date: accessed 2026-09-11. Source budget: 200 words.
- Inspected sections: Connection Records; Adding edges; Removing edges; Connection identity with filters.
- **NC4-C1 — Primary documented behavior:** Connections are distinct records accumulating fetched items. Insert directives require target connection IDs and payload nodes/edges; deletion directives require deleted node IDs and target connections. Filters participate in connection identity, excluding pagination arguments. Applications must update every affected connection and respect each filter; the guide illustrates withholding a nonfriend's comment from a friends-only connection.
- **Boundary:** Connection identity supplies an address, not membership logic. Explicit insertion/deletion APIs do not establish that every filtered or limited result is automatically rebuilt.

### NC5 — Reading and writing data to the cache

- URL: https://www.apollographql.com/docs/react/caching/cache-interaction
- Publisher/type: Apollo GraphQL; primary API documentation. Visible version: Apollo Client (Web), v4 (latest). Date: accessed 2026-09-11. Source budget: 200 words.
- Inspected sections: Using cache.batch; Working with optimistic updates; Using cache.modify.
- **NC5-C1 — Primary documented behavior:** `cache.batch` groups cache operations with one watcher notification after completion. A string optimistic option creates a named layer; true writes to the current top layer; false writes to the canonical root. A batch can write server data and remove a named optimistic layer. `cache.modify` replaces existing fields and bypasses merge functions; it cannot create absent fields.
- **Boundary:** Layer targeting and notification batching are local mechanisms. The inspected documentation does not specify ordering or version guarantees for server deliveries.

### NC6 — Pagination with Connections

- URL: https://relay.dev/docs/guided-tour/list-data/pagination/
- Publisher/type: Meta / Relay; primary API documentation. Visible version: v21.0.1. Date: accessed 2026-09-11. Source budget: 200 words.
- Inspected sections: Opening connection description; Connection Directives; The usePaginationFragment hook.
- **NC6-C1 — Primary documented behavior:** Relay requests slices using cursors/counts and receives edges plus page information. `loadNext` requests more items; completing pagination appends them by default, so the connection accumulates fetched items.
- **NC6-I1 — Model inference:** A collection of fetched slices alone does not establish knowledge of an unseen replacement row after a deletion. Additional knowledge or delivery would be needed to identify that row.
- **Boundary:** This page does not specify automatic mutation-triggered gap filling, stable snapshots across pages, or an exact top-k maintenance law. Those remain unverified, not disproven.

## Coverage and contrary-evidence controls

| Coverage cell | Status | Evidence / limit |
| --- | --- | --- |
| Entity identity versus list membership | Supported | NC1, NC4 |
| Optimistic insert/update/delete and rollback primitives | Supported | NC1–NC5; APIs and examples, not execution tests |
| Overlapping pending mutation semantics | Thin, explicit caveat found | NC3 documents replay and captured-value hazard; NC2/NC5 do not settle Apollo's full ordering behavior |
| Filtered membership propagation | Supported boundary | NC4 assigns affected-connection updates to application logic |
| Limited results and unseen replacement rows | Thin | NC6; absence of a verified refill contract |
| Server-only effects and reconciliation | Thin | NC1/NC3 discuss approximation/invalidation; no completeness proof |
| Delivery ordering, versions, retries, sync failure | Unmeasured | No distributed delivery guarantee established by these pages |
| urql and other normalized caches | Unsearched | Optional breadth omitted within source bound |

Search route: web search with `site:apollographql.com/docs/react` and `site:relay.dev/docs`, followed by opening current canonical documentation URLs and following the current Relay connection link. Initial queries covered mutation list updates and optimistic rollback. Search returned old versions and Apollo deployment previews; canonical pages were inspected instead. Search snippets, third-party discussions, and old-version pages were leads only, not evidence.

Targeted contrary/thin-cell pass 1 queried Apollo concurrent optimistic layers/order and Relay filtered insert/delete handling. It added connection-address requirements and the filter-specific update burden (NC4). Targeted pass 2 queried Apollo named-layer rollback and Relay deletion/pagination gaps. It added explicit batch layer controls (NC5) and fetched-slice semantics (NC6), while leaving delivery order and gap filling unresolved.

Stop criterion: six inspected sources plus two targeted contrary/thin-cell passes. Both passes added material boundaries, so saturation is **not** claimed. No opened page was inaccessible or paywalled. No non-English sources, source code, issue histories, benchmarks, or independent empirical studies were inspected.

Chief artifact risk: two prominent vendors' public guides and one search index overrepresent documented successful workflows. The source frame emphasizes cache primitives and may underrepresent application policy, network adapters, and failure histories. Shared documentation does not establish field-wide consensus. No ranking, recommendation, or performance conclusion is supported.

Handoff: use NC1/NC4 for identity–membership distinction; NC2/NC3/NC5 for optimism/replay boundaries; NC6 for the partial-data cell. Keep delivery order and limited-query completeness open.
