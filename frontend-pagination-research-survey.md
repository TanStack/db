---
instrument: research-survey
title: "Frontend pagination under changing data"
question: "How do frontend pagination systems fetch cheaply while keeping continuation boundaries safe when cached or live data changes?"
scope: "Frontend and reactive pagination; current official documentation and inspectable source through 2026-09-06; English-language public sources."
intended_use: "Provide source-traced mechanisms and limits for a later TanStack DB pagination design decision; do not select or implement a design."
depth: broad
researched_at: 2026-09-06
source_cutoff: 2026-09-06
status: bounded
---

# Frontend pagination under changing data

## Survey brief

- **User request:** “yeah cheaper fetching would be better — explore how other frontend pagination systems handle this with a research survey”.
- **Question:** How do frontend pagination systems fetch cheaply while keeping continuation boundaries safe when cached or live data changes?
- **Intended use:** Inform a later design decision about observed rows versus established loading boundaries, rare recovery, code/state size and transfer cost. This survey does not choose or implement the next design.
- **Depth and budget:** Broad; three independent source tracks, approximately 15 primary pages/source files plus targeted contrary/boundary checks. Stop after two targeted passes add no material mechanism/boundary, or report a bounded stop at the access/effort limit.
- **Included:** TanStack Query/SWR/RTK Query page caches; Apollo/Relay connection caches; Convex/Firestore and a less-prominent block/range cache if source access permits. Ordinary continuation, local/live mutation, cursor provenance, refresh scope, page boundaries, request/result separation, gaps/duplicates and recovery guarantees.
- **Excluded:** Backend pagination algorithm benchmarks, distributed database implementation, exhaustive framework rankings, private incident data, code changes, and a recommended TanStack DB design.
- **Starting sources:** User's local bug description and probe: an out-of-prefix live insert can make observed rows appear complete; the conservative prefix candidate returned 560 versus 110 rows over ten pages in a synthetic provider. These are local task context, not evidence about other systems.
- **Available source languages:** English. No geographic restriction on projects.
- **Access limits:** Public browser/search and repository source; no private production telemetry or controlled execution of other frameworks. Current documentation may change without versioned URLs.
- **Output:** This Markdown file, not a new Field Log or workflow.

## Coverage frame (frozen before search)

| Cell | Starting status | Question |
| --- | --- | --- |
| Page-chain caches | unsearched | Are continuation parameters independent of rendered rows? |
| Connection caches | unsearched | Where are end cursors retained during cache insertion/deletion? |
| Reactive pagination | unsearched | Who preserves range boundaries while results change? |
| Invalidations and refetch | unsearched | What scope is refreshed, and why? |
| Failure/contrary cases | unsearched | Which guarantees exclude arbitrary live changes or depend on server behavior? |
| Work and retained state | unsearched | Which costs are documented versus actually measured? |

## Orientation

The inspected systems separate three operations: continuing a page chain, changing displayed data, and refreshing earlier acquisitions. They assign different responsibilities to the client, application and server. Page caches expose page parameters; connection caches retain page information beside edges; a reactive range API can preserve adjoining boundaries while page sizes change. These are different contracts, not interchangeable solutions. [S1](#s1), [S8](#s8), [S11](#s11)

This broad survey inspected 17 sources across seven systems, including three implementation files and two historical/report sources. SWR remained an access gap. The run stopped at its bounded source/access budget, not saturation. No external framework was executed.

## Terms and distinctions

- **Continuation boundary:** A value used to request what follows an acquired page. It may be an opaque server cursor, document snapshot or caller-defined page parameter. Its meaning depends on the provider. [S1](#s1), [S13](#s13)
- **Displayed membership:** Rows currently presented by a cache or connection. Local connection edits need not change its continuation metadata. [S8](#s8)
- **Refresh:** Reacquiring previously loaded data; distinct from requesting one more page. [S2](#s2)
- **Reactive range:** A page bounded by start and end cursors whose membership may change while adjoining ranges remain aligned. [S10](#s10), [S11](#s11)
- **Completeness versus deduplication:** Removing repeated node IDs does not establish that no unseen row was skipped. This is an inference about the narrower operation performed by a merge, not an additional Relay guarantee. [S8](#s8)

## Evidence landscape

### Page-chain caches

**C1 — TanStack Query distinguishes continuation from refresh.** Its infinite-query cache stores pages and their request parameters. The example gets continuation from the page response. Stale refetch runs sequentially from the first retained page to rebuild cursors; `maxPages` limits retained and refetched pages. These are documented policies, not a server snapshot protocol. [S1](#s1)

**C2 — The implementation makes that distinction concrete.** A directional fetch computes a parameter from existing page data and fetches one page. The refetch branch builds a new result, starting with the first stored parameter and deriving later parameters from newly fetched pages. Because callbacks are caller-defined, the library does not itself prove the safety of every cursor derivation. [S2](#s2)

**C3 — RTK Query follows the same API lineage.** It separates cache query arguments from page parameters and retains both pages and parameters. Its default refresh refetches cached pages sequentially. Current documentation also permits shrinking to one page on refresh and bounding retained pages. This is not independent evidence that TanStack Query's model handles live relational results. [S3](#s3)

**C4 — Invalidation needs information beyond visible entities.** RTK Query documents an earlier-page deletion that should shift the current page but fails to invalidate it when only visible IDs supply tags. A list-level invalidation tag covers that case. The source concerns index-based pagination and configured mutation invalidation, not automatic detection of arbitrary external writes. [S4](#s4)

### GraphQL connection caches

**C5 — Apollo documents a cursor separate from item storage.** One policy example stores the response cursor alongside an ID-keyed item map. A simpler ID-as-cursor policy instead searches cached items and appends if the cursor is absent; the guide warns about overwriting when the cursor lies inside the list. These are alternative policies, not one unconditional behavior. [S5](#s5)

**C6 — Apollo's Relay-style helper has conditional boundary behavior.** The inspected implementation prefers stored `pageInfo.endCursor` even when its read filters unreadable edges; it falls back to an edge cursor when metadata is absent. A forward merge searches for `after`, retaining the existing prefix when it cannot find it. It has no node-ID deduplication pass. This does not establish server cursor survival after deletion. [S6](#s6)

**C7 — Relay separates local edge edits from pagination metadata.** Local insertion/deletion helpers change edges, not page information. Network forward merges check cursor compatibility and warn/return for an unsupported mismatch; accepted network merges deduplicate node IDs. A non-directional fetch replaces the connection. These checks do not prove gap freedom under arbitrary server reordering. [S8](#s8)

**C8 — Connection maintenance still has application duties.** Relay documents mutation/subscription insertion and deletion, but applications must decide membership in filtered connections and update the affected connections. Its pagination API offers both additional-page loading and explicit refetch. Neither inspected guide promises automatic repair of every sort or membership change. [S7](#s7), [S9](#s9)

### Reactive queries and block caches

**C9 — Convex retains ranges rather than fixed live page sizes.** Its reactive pages may grow or shrink. The options API provides start/end cursors to avoid gaps between pages and supports splitting an existing range. Read-row and read-byte limits can force splits; those limits exclude search queries. This is a documented server/client contract, not evidence that a generic client can recreate it without provider support. [S10](#s10), [S11](#s11)

**C10 — Reactive pagination also has a reset boundary.** Convex documents first-page resets when query/arguments change and for invalid-cursor or excessive-data errors. Stable range management does not mean every recovery preserves all accumulated pages. [S12](#s12)

**C11 — Firestore's example cursor comes from a query snapshot.** The guide uses the last returned document as `startAfter`; field-only cursors may require more fields to disambiguate ties. The inspected guide does not establish coordinated repair across independently subscribed pages. [S13](#s13)

**C12 — A listener observation need not be a completed server page.** Firestore listeners can initially report cached data and notify local writes before the backend accepts them; metadata distinguishes pending writes. This supports a provenance distinction, not a claim that Firestore pagination is incorrect. [S14](#s14)

**C13 — AG Grid exposes a different refresh/display tradeoff.** Its Infinite Row Model fetches index blocks and bounds cached blocks. Refresh reloads cached blocks while leaving old data visible; purge discards blocks and fetches those needed on screen, with an empty display meanwhile. Its guide favors server updates plus cache refresh for insertion/deletion. It does not establish atomic refresh across all blocks. [S15](#s15)

## Positions and mechanisms

These are unranked mechanisms. “Support” means the source was inspected, not that its behavior was independently proved.

| Mechanism | Support | Where work or state is bounded | Boundary |
| --- | --- | --- | --- |
| Continue one page; rebuild the chain on refresh | C1–C3: docs plus TanStack Query source | Page-count retention limits; separate forward-fetch branch | Caller cursor semantics and server changes remain outside the cache's proof |
| Keep continuation metadata beside editable items | C5–C8: Apollo/Relay docs and source | Ordinary continuation does not itself require reacquiring the whole prefix | Metadata can remain present without proving its server validity |
| Maintain adjoining reactive ranges | C9–C10: Convex API contracts | Split ranges and configured read limits | Pages vary in size; some errors reset; provider support matters |
| Refresh or purge bounded display blocks | C13: AG Grid documentation | Block size/cache count and visible-range acquisition | Keeping old display data is not an atomic multi-block snapshot guarantee |

**C14 — Cost inference, not a benchmark:** For fixed page size `p`, visiting `n` pages once requires `n × p` returned rows if each continuation fetches only a fresh page. Re-fetching the entire growing prefix each time requires `p × n(n+1)/2`. This excludes retries, overlaps, exhaustion probes, caching and mutations. It describes request shapes, not measured performance of any surveyed library. C2 provides a concrete one-page continuation implementation; C13 describes a bounded-block alternative. [S2](#s2), [S15](#s15)

## Disputes and conflicting evidence

### Editable cache versus complete live result

Connection helpers permit local changes without moving continuation metadata (C7), but filtered membership remains an application responsibility (C8). Firestore explicitly exposes observations with different local/server provenance (C12). Thus “the cache contains this row” and “the provider acquired everything up to this row” are not interchangeable claims. That last distinction is an inference; this survey does not determine the exact metadata TanStack DB needs. [S7](#s7), [S8](#s8), [S14](#s14)

### Refresh safety versus refresh scope

TanStack Query's stated reason for sequential refresh is avoiding stale cursors. RTK Query also permits discarding later pages on refresh. AG Grid permits retaining old display blocks or clearing them. These are different retained-data and acquisition contracts, not competing measurements of the same guarantee. No inspected material establishes an atomic cross-request snapshot during arbitrary concurrent server writes. [S1](#s1), [S3](#s3), [S15](#s15)

### A contrary cache-policy report

**C15 — A caller reported a cache-first pagination loop with Apollo's Relay-style policy.** A forum response attributed repeated first-page results to cursor-insensitive cache reading. The response was tentative and the report was not reproduced here. The documented guide uses `fetchMore`; the report used repeated `client.query` calls. It is evidence of a reported integration failure, not grounds to declare the helper universally unsafe with cache-first. [S16](#s16), [S5](#s5)

The searched routes found no direct, tested comparison under TanStack DB's combined live-update and partial-acquisition contract. That is a gap, not agreement that any one mechanism is sufficient.

## Cases and timeline

- **2021 / 2024:** Apollo report and later explanation, kept separate from current v4 documentation (C15). [S16](#s16)
- **2023 → 2025:** RTK Query's design discussion collected incompatible pagination/cache use cases; a 2025-02-23 update announced infinite queries in 2.6.0. Historical workarounds are not treated as current endpoint behavior. [S17](#s17)
- **Current inspection, 2026-09-06:** TanStack Query docs identify v5; Apollo docs v4; Relay docs v21.0.1; AG Grid's page identifies 36.1.0. Convex and RTK pages are current, unversioned URLs. Firestore pages show 2026-09-01 updates. Mutable source branches were inspected without freezing release SHAs; release equivalence remains unverified. [S1](#s1), [S3](#s3), [S5](#s5), [S7](#s7), [S10](#s10), [S13](#s13), [S14](#s14), [S15](#s15)

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Page-chain acquisition and refetch | supported | S1–S4 | Caller-defined cursor correctness not proved |
| Connection cursor/local-membership separation | supported | S5–S9 | Arbitrary reorder and deleted-cursor server behavior thin |
| Reactive adjoining ranges | supported | S10–S12 | One integrated provider; server implementation not audited |
| Snapshot versus listener provenance | supported | S13–S14 | Cross-page listener repair thin |
| Bounded block refresh/display policy | supported | S15 | Other AG Grid row models excluded |
| Contrary cases and invalidation boundaries | thin | S4, S12, S16, S17 | Reports/docs, not a reproduced incident corpus |
| SWR direct source inspection | inaccessible | No claim source | Search result available; page opens failed, guessed repository fallback unavailable; snippets not used as findings |
| Work controls | supported | S1, S3, S11, S15 | Controls documented, savings not measured |
| Transfer, latency, code size, failure rates | unsearched | None | No common workload or implementations benchmarked |
| Atomic consistency under concurrent server reorder | thin | S1–S15 | No inspected proof meeting the full local contract |

## Claim-to-source ledger

Confidence refers to faithful description of the inspected evidence, not confidence in universal correctness.

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | primary record | S1 | solid | Documented policy |
| C2 | primary record | S2 | solid | Mutable source; callback semantics external |
| C3 | primary record | S3 | solid | Shared design lineage; current docs not release-pinned |
| C4 | primary record | S4 | solid | Configured mutation invalidation |
| C5 | primary record | S5 | solid | Alternative example policies |
| C6 | primary record | S6 | solid | No server validity proof |
| C7 | primary record / inference | S8 | solid | Network and manual merges differ |
| C8 | primary record | S7, S9 | solid | Application responsibility persists |
| C9 | primary record | S10, S11 | solid | Vendor contract; search limit exception |
| C10 | primary record | S12 | solid | Documented reset paths |
| C11 | primary record | S13 | solid | No cross-listener theorem |
| C12 | primary record / inference | S14 | solid | Provenance distinction only |
| C13 | primary record | S15 | solid | Infinite Row Model only |
| C14 | inference | S2, S15 | solid | Arithmetic under stated idealized assumptions; no benchmark |
| C15 | practitioner report | S16, S5 | plausible | Historical, tentative explanation; no reproduction |

## Sources

All sources accessed 2026-09-06. An undated/current page is not assigned an invented publication date.

### Primary and official

- <a id="s1"></a>**S1** — [Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries), TanStack, v5 current docs, undated. **Used for:** C1 and refresh limits. **Limit:** API guidance, not backend consistency proof.
- <a id="s2"></a>**S2** — [infiniteQueryBehavior.ts](https://raw.githubusercontent.com/TanStack/query/main/packages/query-core/src/infiniteQueryBehavior.ts), TanStack Query, mutable main. **Used for:** C2, C14. **Limit:** Inspected source, not a pinned release or execution.
- <a id="s3"></a>**S3** — [Infinite Queries](https://redux-toolkit.js.org/rtk-query/usage/infinite-queries), Redux Toolkit, current undated docs. **Used for:** C3. **Limit:** Version of each option not established.
- <a id="s4"></a>**S4** — [Pagination](https://redux-toolkit.js.org/rtk-query/usage/pagination), Redux Toolkit, updated 2025-02-23. **Used for:** C4. **Limit:** Configured index-page example.
- <a id="s5"></a>**S5** — [Cursor-based pagination](https://www.apollographql.com/docs/react/pagination/cursor-based), Apollo Client, v4 current docs, undated. **Used for:** C5 and C15's workflow boundary. **Limit:** Several alternative policies.
- <a id="s6"></a>**S6** — [pagination.ts](https://raw.githubusercontent.com/apollographql/apollo-client/main/src/utilities/policies/pagination.ts), Apollo Client, mutable main. **Used for:** C6. **Limit:** Release mapping and runtime behavior not tested.
- <a id="s7"></a>**S7** — [Updating Connections](https://relay.dev/docs/guided-tour/list-data/updating-connections/), Relay, v21.0.1. **Used for:** C8. **Limit:** Application updaters determine filtered membership.
- <a id="s8"></a>**S8** — [ConnectionHandler.js](https://raw.githubusercontent.com/facebook/relay/main/packages/relay-runtime/handlers/connection/ConnectionHandler.js), Relay, mutable main. **Used for:** C7. **Limit:** Not server cursor semantics or every manual-update path.
- <a id="s9"></a>**S9** — [usePaginationFragment](https://relay.dev/docs/api-reference/use-pagination-fragment/), Relay, v21.0.1. **Used for:** C8. **Limit:** Explicit API, not automatic gap repair.
- <a id="s10"></a>**S10** — [Paginated Queries](https://docs.convex.dev/database/pagination), Convex, current undated docs. **Used for:** C9. **Limit:** Experimental hook also described; not conflated with stable implementation.
- <a id="s11"></a>**S11** — [PaginationOptions](https://docs.convex.dev/api/interfaces/server.PaginationOptions), Convex, current undated API. **Used for:** C9. **Limit:** Contract, not measured work; search exception.
- <a id="s12"></a>**S12** — [React pagination API](https://docs.convex.dev/api/modules/react#usepaginatedquery), Convex, current undated API. **Used for:** C10. **Limit:** Hook implementation not inspected.
- <a id="s13"></a>**S13** — [Paginate data with query cursors](https://firebase.google.com/docs/firestore/query-data/query-cursors), Google, updated 2026-09-01. **Used for:** C11. **Limit:** Example does not coordinate multiple live listeners.
- <a id="s14"></a>**S14** — [Get realtime updates](https://firebase.google.com/docs/firestore/query-data/listen), Google, updated 2026-09-01. **Used for:** C12. **Limit:** Listener behavior, not a multi-page protocol.
- <a id="s15"></a>**S15** — [Infinite Row Model](https://www.ag-grid.com/javascript-data-grid/infinite-scrolling/), AG Grid, displayed v36.1.0. **Used for:** C13, C14. **Limit:** Not the Server-Side Row Model or an atomicity audit.

### Scholarly and technical

No scholarly experiments were inspected. Primary implementation files are listed above; their presence must not be mistaken for formal verification.

### Field, critical, and secondary

- <a id="s16"></a>**S16** — [Cannot get relay-style paging to work with cache-first](https://community.apollographql.com/t/cannot-get-relay-style-paging-to-work-with-cache-first/707), Apollo community, report 2021-07-08, response 2024-02-29. **Used for:** C15, a firsthand failure report only. **Limit:** No exact package version or independent reproduction; explanation tentative.
- <a id="s17"></a>**S17** — [Infinite-query use cases and concerns](https://github.com/reduxjs/redux-toolkit/discussions/3174), Redux Toolkit maintainers/community, started 2023-02-14, announcement update 2025-02-23. **Used for:** Historical API-diversity control and timeline. **Limit:** Historical arguments and examples are not current implementation evidence.

## Search and control record

- **Search routes:** Public web search, official documentation and linked/raw repository files. Three tracks used the same frozen brief: page caches; Apollo/Relay; reactive queries/block caches. Agent notes were frozen before integration. Shared model/search infrastructure means these are not independent replications.
- **Query families:** `infinite queries refetch sequentially stale cursors maxPages`; `pagination previousPageData revalidate`; `infinite queries partial list`; connection `deleted cursor`, `gaps`, `duplicate`, `missing cursor`, `cache-first`; Convex `pagination InvalidCursor`; Firestore `pagination realtime duplicate`; AG Grid `infinite row model insert delete refresh cache`.
- **Prominence counter-search:** Added block caches and reactive range APIs to the familiar React/GraphQL cache frame; searched failure terms and historical design concerns. This diversified mechanisms but did not overcome English/public/vendor concentration. RTK Query explicitly shares TanStack Query lineage and is not counted as independent validation.
- **Contrary-evidence search:** Recovered C4's invalidation hole, C6/C7's conditional merge behavior, C10's reset boundary and C15's reported misuse/failure. The Firestore query did not recover an official multi-page listener guarantee. A negative search result was not converted into a claim that none exists.
- **Source-class coverage:** Fifteen official docs/source files plus two primary discussion/report records. No independent performance study or formal proof. The forum report supports only that the failure was reported, not its diagnosis as established fact.
- **Recency check:** Current docs and mutable source were distinguished from 2021–2025 reports. Cutoff 2026-09-06. Release SHAs were not pinned; these links can change. Search previews and mirrors were not substituted for current official pages.
- **Access failures:** SWR page opens failed repeatedly, including unsupported markdown content type. A guessed repository documentation path returned 404; shell fallback had DNS failure. Search snippets remained leads, not extracted mechanisms. One mistaken TanStack discussion URL was corrected to the actual Redux discussion before use.
- **Saturation check:** Budget/access stop fired. The two satellite tracks each reached six inspected sources; main inspected five. Last material additions were RTK's first-page shrink option and historical API-diversity discussion, plus the unresolved SWR access cell. Two no-new-information passes were not achieved; saturation is not claimed.

## Limits and unmeasured

- **Main artifact risk:** Grouping polished vendor APIs can make unlike guarantees look interchangeable. Accessible English docs overrepresent intended behavior and underrepresent production failure. Familiarity guided the initial framework list; source diversity does not remove that bias.
- **Unmeasured:** Transfer bytes, latency, provider cache hits, CPU, retained state size, implementation code size, error frequency, adversarial race histories and the effort to preserve TanStack DB's current guarantees. No comparative executions were run.
- **Coverage claim:** This is a bounded map of seven inspected systems, not an exhaustive review, correctness proof, prevalence estimate or design recommendation. SWR is explicitly missing. All source-backed behavior is scoped to the named API/helper.
- **Local context limit:** The 560-versus-110 row probe counts synthetic provider-returned rows, not network bytes or actual adapter work. It motivates the question but cannot rank these systems.
- **Instrument limit:** Research Survey is marked draft with zero documented uses in its card. Structure validation checks references and sections, not source truth or completeness.

## Handoff index

- **Continuation and refresh:** C1–C4 distinguish acquisition paths and invalidation scope.
- **Editable membership and metadata:** C5–C8 expose connection-cache boundaries.
- **Provider contracts:** C9–C13 describe ranges, provenance and block refresh.
- **Cost and uncertainty:** C14, coverage table and limits retain assumptions and unmeasured work.
- **Claim and source ledgers:** Stable IDs preserve provenance for later examination.

This index describes available material. It does not select or run another instrument or choose a TanStack DB implementation.
