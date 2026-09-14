---
instrument: research-survey
title: "Optimistic coherence across endpoint query collections"
question: "What prior designs keep overlapping client query collections coherent during optimistic writes and server reconciliation, and what information and delivery guarantees do those designs require?"
scope: "Client data systems and relational view foundations; English primary sources through 2026-09-11"
intended_use: "Ground-condition probe, then exploratory Design grammar extractor on the current Endpoints prototype"
depth: broad
researched_at: 2026-09-11
source_cutoff: 2026-09-11
status: bounded
---

# Optimistic coherence across endpoint query collections

## Survey brief

- **Question:** What prior designs keep overlapping client query collections coherent during optimistic writes and server reconciliation, and what information and delivery guarantees do those designs require?
- **Intended use:** The user's selected Ground-condition probe and exploratory Design grammar extractor; no design choice or implementation.
- **Included:** Normalized caches, local query/sync systems, original relational-view work, and the current prototype. Broad depth with a bound of six inspected external sources per track and two targeted counter-search passes.
- **Excluded:** Product ranking, performance claims, exhaustive review, full CRDT taxonomy, production auth design, and implementation changes.
- **Starting sources:** Current runtime/compiler, oracle receipt, local DB documentation, user constraints. [S19](#s19)–[S24](#s24).
- **Available source languages:** English. Search and source access occurred on 2026-09-11; no later work is claimed.
- **Access limits:** Public live docs are not version-pinned archives. Two original papers used OCR mirrors after publisher/institution access failed. No benchmarks, theorem proofs, or vendor implementations were rerun.

The [frozen brief](./research-brief.md) preceded searches. Three separate source tracks inspected 18 external sources; local source observations are separate. This file is a survey output, not a Field Log or architecture decision.

## Orientation

The inspected material exposes several different mechanisms: shared entity records with separately managed list membership; query evaluation over local data; explicit edits to cached query results; and source/view delta maintenance. These are descriptive groupings imposed by this survey, not a taxonomy claimed by their authors. See the claim ledger below for the exact support and scope.

## Terms and distinctions

- **Identity versus membership:** An entity address and a query's inclusion/order rule are different information. [S1](#s1), [S4](#s4).
- **Optimistic intent versus recorded result:** Replaying a function and restoring a captured value need not produce the same later state. [S3](#s3), [S8](#s8).
- **Write acknowledgement versus read confirmation:** The API accepting a write and the read path reflecting it are separate events. [S11](#s11), [S12](#s12).
- **Complete scope versus partial knowledge:** A result can be complete for one query without covering the relation needed by another. [S15](#s15), [S21](#s21).
- **Forward versus inverse maintenance:** Computing a changed view and translating a view edit back to source state are different problems. [S13](#s13), [S14](#s14).

## Evidence landscape

### Normalized caches

- **C1 — Returned entity fields can merge by identity while insertion into list fields still needs an updater.** Evidence: primary record. Documented API; not an executed completeness test. [S1](#s1).
- **C2 — Optimistic records are separate from canonical records and are replaced or removed when responses arrive.** Evidence: primary record. Inspected lifecycle examples do not define every concurrent history. [S2](#s2).
- **C3 — Relay reapplies pending optimism around store changes but documents an overlapping captured-count hazard.** Evidence: primary record. Replay does not make arbitrary captured values correct. [S3](#s3).
- **C4 — Connection changes address particular connection IDs; filter-specific membership remains an application responsibility.** Evidence: primary record. Addresses are not membership predicates. [S4](#s4).
- **C5 — Apollo exposes named optimistic layers and batching that coalesces watcher notification.** Evidence: primary record. Local batching does not establish remote delivery order. [S5](#s5).
- **C6 — Connections accumulate fetched cursor slices; the inspected page does not establish optimistic gap filling.** Evidence: primary record. Unseen replacement-row behavior remains unverified. [S6](#s6).

### Reactive and sync systems

- **C7 — Local mutators affect cached data and open queries; client reads are limited to cached data, and server implementations may differ.** Evidence: primary record. Does not establish exact optimistic top-k replacement. [S7](#s7).
- **C8 — Pull patches and mutation acknowledgements support rebase: apply authoritative changes, replay unconfirmed mutators, and reveal state atomically.** Evidence: primary record. Its ordered mutation queue is a distinct protocol choice. [S8](#s8).
- **C9 — Callbacks explicitly modify loaded query results and rerun as those results change.** Evidence: primary record. Not an automatic entity-to-every-query membership rule. [S9](#s9).
- **C10 — Reactive pages may change size after inserts and deletes rather than preserving their requested row count.** Evidence: primary record. Cursor pages and fixed-size top-k results have different contracts. [S10](#s10).
- **C11 — Electric separates application writes from read-path sync; its examples retain optimism through stream confirmation and discuss sharing optimistic state.** Evidence: primary record. Application patterns, not a universal reconciliation algorithm. [S11](#s11).
- **C12 — Shape offsets, control messages, and subset snapshot visibility metadata distinguish initial state from subsequent changes.** Evidence: primary record. Independent-shape atomicity and local replacement-row discovery are unestablished here. [S12](#s12).

### Database foundations

- **C13 — A view update uses both the edited view and source state; projections need policies for discarded information.** Evidence: scholarly finding. Formal relational conditions; not a remote optimistic protocol. [S13](#s13).
- **C14 — Delta maintenance uses query definitions, source changes, and support information such as derivation counts.** Evidence: scholarly finding. Different methods have stated recursion and set/bag boundaries. [S14](#s14).
- **C15 — Partial-information maintenance asks whether available facts determine candidate membership, rather than assuming all missing data is irrelevant.** Evidence: scholarly finding. SPJ setting; original-paper OCR mirror, formulas not independently checked. [S15](#s15).
- **C16 — Reserve rows reduce refills; when departures exhaust the reserve, maintenance must obtain more rows from the base.** Evidence: scholarly finding. Specific ranking/update assumptions; concurrency outside its cost model. [S16](#s16).
- **C17 — Deletion rates limit buffering guarantees; this work studies probabilistic reserve sizing and instance-dependent cross-view relations.** Evidence: source argument. Not an adjudicated performance result; original-paper OCR mirror. [S17](#s17).
- **C18 — Backward delta translation can still require source queries; incremental execution does not remove missing-information requirements.** Evidence: scholarly finding. Inspected sections do not establish stale-client or remote rollback semantics. [S18](#s18).

### Current prototype and user constraints

- **C19 — The prototype caches by endpoint declaration and refetches only directly mutated collections; it emits no shared-row propagation.** Evidence: primary record. Known incomplete prototype, not an architectural impossibility. [S19](#s19).
- **C20 — The checked Todo compiler sends order metadata while keeping handlers server-side; general client membership and lineage are not emitted.** Evidence: primary record. Supported grammar is narrow. [S20](#s20).
- **C21 — Eager snapshots replace collection state; on-demand loading and direct synced writes have different scope and replacement contracts.** Evidence: primary record. Documentation and source-boundary reading, not a fresh implementation test. [S21](#s21).
- **C22 — One explicit optimistic action can mutate several collections and await their synchronization.** Evidence: primary record. Does not automatically discover shared entities or affected queries. [S22](#s22).
- **C23 — Two identical active endpoint queries diverge after an optimistic insertion targets only the first.** Evidence: primary record. One-operation known feature gap; not evidence of a core-DB defect. [S23](#s23).
- **C24 — The user requires bare writable collections, synchronous optimism, DB queries, no implicit queue, and server-code exclusion; unavailable reads may show an error.** Evidence: user material. Choice of retained rows after exhausted retries remains open. [S24](#s24).

## Positions and mechanisms

| Unranked mechanism | What it locates together | Boundary to retain |
| --- | --- | --- |
| Normalized cache with explicit connection edits | Entity state and separately addressed lists | Membership still needs policy; C1, C4. |
| Shared local data with subscriptions | Mutator effects and local query evaluation | Cached coverage and replay contract matter; C7, C8. |
| Optimistic query-result edits | An application callback and selected loaded results | Effects must reach each relevant result; C9. |
| Separate write path and synchronized read path | Local intent and later authoritative confirmation | Acknowledgement does not by itself name a read version; C11, C12. |
| Forward/inverse relational maintenance | Query derivation or a view-edit translation policy | Relevant state and supported grammar are prerequisites; C13–C18. |

These are overlapping mechanisms, not interchangeable whole-product claims. No row ranks them or asserts that it solves the user's full contract.

## Disputes and conflicting evidence

**Automatic propagation has different scope.** Entity updates, connection edits, and queries over a local store address different dependencies. Apparent disagreement about automatic updates is partly a contract difference, not a head-to-head experimental conflict. [S1](#s1), [S4](#s4), [S7](#s7), [S9](#s9).

**Replay has conditions.** A documented captured-value hazard limits a naive claim that reapplying optimism is sufficient. Ordered mutator replay is a different mechanism, and its ordering cannot be imported into Endpoints without changing the user's no-implicit-queue constraint. [S3](#s3), [S8](#s8), [S24](#s24).

**Buffered completeness is conditional.** Two top-k papers differ in workload assumptions and guarantees. This survey preserves that distinction without adjudicating comparative performance. [S16](#s16), [S17](#s17).

**Unavailable synchronization is not false certainty.** The user's latest correction allows an error when reads remain unavailable. The older oracle's unconditional exact-state interpretation does not override that requirement. [S24](#s24).

## Cases and timeline

Foundational works inspected span 1993–2018; vendor docs describe current documented mechanisms as accessed in September 2026. That does not establish publication dates or an adoption lineage. Dates are attached to individual sources below. The current one-insert counterexample is a source case used by this inquiry, not an independent future validation case. [S23](#s23).

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Entity and query membership distinction | supported | S1, S4, S19 | Application policy differs by system. |
| Optimistic layers and replay | supported, limits found | S2, S3, S5, S8, S9 | Detailed concurrent remote histories remain thin. |
| Shared-data reactive queries | supported | S7, S8 | Arbitrary local data completeness unproven. |
| Write/read delivery separation | supported | S11, S12 | Cross-query atomic version contract unestablished. |
| Partial information and top-k | supported within bounded models | S6, S10, S15, S16, S17 | Client-side refill under unavailable backend remains unknown. |
| Writable projections and joins | supported theory, transfer thin | S13, S18 | No Endpoints inverse-update contract chosen. |
| Server-only functions and authorization | thin | S7, S20, S24 | No compiler or auth completeness proof. |
| Oracle and current implementation | supported local observation | S19–S24 | Known narrow grammar; no generalized implementation test. |
| Independent failure histories and comparative measures | unsearched | — | Public guides dominate operational evidence. |
| Other libraries, languages, private/unpublished work | unsearched | — | Eighteen-source bound; no prevalence claim. |

## Claim-to-source ledger

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | primary record | S1 | solid as source report | Documented API; not an executed completeness test. |
| C2 | primary record | S2 | solid as source report | Inspected lifecycle examples do not define every concurrent history. |
| C3 | primary record | S3 | solid as source report | Replay does not make arbitrary captured values correct. |
| C4 | primary record | S4 | solid as source report | Addresses are not membership predicates. |
| C5 | primary record | S5 | solid as source report | Local batching does not establish remote delivery order. |
| C6 | primary record | S6 | solid as source report | Unseen replacement-row behavior remains unverified. |
| C7 | primary record | S7 | solid as source report | Does not establish exact optimistic top-k replacement. |
| C8 | primary record | S8 | solid as source report | Its ordered mutation queue is a distinct protocol choice. |
| C9 | primary record | S9 | solid as source report | Not an automatic entity-to-every-query membership rule. |
| C10 | primary record | S10 | solid as source report | Cursor pages and fixed-size top-k results have different contracts. |
| C11 | primary record | S11 | solid as source report | Application patterns, not a universal reconciliation algorithm. |
| C12 | primary record | S12 | solid as source report | Independent-shape atomicity and local replacement-row discovery are unestablished here. |
| C13 | scholarly finding | S13 | solid as source report | Formal relational conditions; not a remote optimistic protocol. |
| C14 | scholarly finding | S14 | solid as source report | Different methods have stated recursion and set/bag boundaries. |
| C15 | scholarly finding | S15 | solid as source report | SPJ setting; original-paper OCR mirror, formulas not independently checked. |
| C16 | scholarly finding | S16 | solid as source report | Specific ranking/update assumptions; concurrency outside its cost model. |
| C17 | source argument | S17 | solid as source report | Not an adjudicated performance result; original-paper OCR mirror. |
| C18 | scholarly finding | S18 | solid as source report | Inspected sections do not establish stale-client or remote rollback semantics. |
| C19 | primary record | S19 | solid as source report | Known incomplete prototype, not an architectural impossibility. |
| C20 | primary record | S20 | solid as source report | Supported grammar is narrow. |
| C21 | primary record | S21 | solid as source report | Documentation and source-boundary reading, not a fresh implementation test. |
| C22 | primary record | S22 | solid as source report | Does not automatically discover shared entities or affected queries. |
| C23 | primary record | S23 | solid as source report | One-operation known feature gap; not evidence of a core-DB defect. |
| C24 | user material | S24 | solid as source report | Choice of retained rows after exhausted retries remains open. |

## Sources

### Primary and official

- <a id="s1"></a>**S1** — [Mutations in Apollo Client](https://www.apollographql.com/docs/react/data/mutations), Apollo, live v4 documentation; accessed 2026-09-11. Used for C1; claim-specific limit in the ledger.
- <a id="s2"></a>**S2** — [Optimistic mutation results](https://www.apollographql.com/docs/react/performance/optimistic-ui), Apollo, live v4 documentation; accessed 2026-09-11. Used for C2; claim-specific limit in the ledger.
- <a id="s3"></a>**S3** — [GraphQL mutations](https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/), Relay v21.0.1; accessed 2026-09-11. Used for C3; claim-specific limit in the ledger.
- <a id="s4"></a>**S4** — [Updating Connections](https://relay.dev/docs/guided-tour/list-data/updating-connections/), Relay v21.0.1; accessed 2026-09-11. Used for C4; claim-specific limit in the ledger.
- <a id="s5"></a>**S5** — [Reading and writing data to the cache](https://www.apollographql.com/docs/react/caching/cache-interaction), Apollo, live v4 documentation; accessed 2026-09-11. Used for C5; claim-specific limit in the ledger.
- <a id="s6"></a>**S6** — [Pagination with Connections](https://relay.dev/docs/guided-tour/list-data/pagination/), Relay v21.0.1; accessed 2026-09-11. Used for C6; claim-specific limit in the ledger.
- <a id="s7"></a>**S7** — [Zero Mutators](https://zero.rocicorp.dev/docs/mutators), Rocicorp, undated live documentation; accessed 2026-09-11. Used for C7; claim-specific limit in the ledger.
- <a id="s8"></a>**S8** — [How Replicache Works](https://doc.replicache.dev/concepts/how-it-works), Rocicorp, undated live documentation; accessed 2026-09-11. Used for C8; claim-specific limit in the ledger.
- <a id="s9"></a>**S9** — [Convex Optimistic Updates](https://docs.convex.dev/client/react/optimistic-updates), Convex, undated live documentation; accessed 2026-09-11. Used for C9; claim-specific limit in the ledger.
- <a id="s10"></a>**S10** — [Convex Paginated Queries](https://docs.convex.dev/database/pagination), Convex, undated live documentation; accessed 2026-09-11. Used for C10; claim-specific limit in the ledger.
- <a id="s11"></a>**S11** — [Electric Writes](https://electric.ax/docs/sync/guides/writes), Electric, undated live documentation; accessed 2026-09-11. Used for C11; claim-specific limit in the ledger.
- <a id="s12"></a>**S12** — [Electric HTTP API](https://electric.ax/docs/sync/api/http), Electric, undated live documentation; accessed 2026-09-11. Used for C12; claim-specific limit in the ledger.

### Scholarly and technical

- <a id="s13"></a>**S13** — [Relational lenses: A language for updatable views](https://www.cis.upenn.edu/~bcpierce/papers/dblenses-pods.pdf), Bohannon, Pierce, Vaughan; PODS 2006. Used for C13; claim-specific limit in the ledger.
- <a id="s14"></a>**S14** — [Maintaining views incrementally](https://www.cs.columbia.edu/~gravano/Qual/Papers/13%20-%20Maintaining%20Views%20Incrementally.pdf), Gupta, Mumick, Subrahmanian; SIGMOD 1993. Used for C14; claim-specific limit in the ledger.
- <a id="s15"></a>**S15** — [Using partial information to update materialized views](https://www.researchgate.net/publication/222506926_Using_partial_information_to_update_materialized_views), Gupta, Blakeley; Information Systems, December 1995. Used for C15; claim-specific limit in the ledger.
- <a id="s16"></a>**S16** — [Efficient maintenance of materialized top-k views](https://www.cse.ust.hk/~yike/topk/icde03.pdf), Yi, Yu, Yang, Xia, Chen; ICDE 2003. Used for C16; claim-specific limit in the ledger.
- <a id="s17"></a>**S17** — [Maintenance of top-k materialized views](https://www.researchgate.net/publication/225500984_Maintenance_of_top-k_materialized_views), Baikousi, Vassiliadis; online 2009, issue 2010. Used for C17; claim-specific limit in the ledger.
- <a id="s18"></a>**S18** — [Incremental relational lenses](https://www.pure.ed.ac.uk/ws/portalfiles/portal/75693529/Incremental_Relational_Lenses.pdf), Horn, Perera, Cheney; PACMPL/ICFP 2018. Used for C18; claim-specific limit in the ledger.

### Local primary material and user requirements

- <a id="s19"></a>**S19** — [Current Endpoints runtime](../integrated-todo/src/runtime.ts), Current working tree, frozen hashes in local-source-notes.md. Used for C19; claim-specific limit in the ledger.
- <a id="s20"></a>**S20** — [Current Endpoints compiler](../integrated-todo/bound-transform.mjs), Current working tree, frozen hashes in local-source-notes.md. Used for C20; claim-specific limit in the ledger.
- <a id="s21"></a>**S21** — [Query Collection documentation](../../../docs/collections/query-collection.md), Current checkout, frozen hashes in local-source-notes.md. Used for C21; claim-specific limit in the ledger.
- <a id="s22"></a>**S22** — [Mutation guide](../../../docs/guides/mutations.md), Current checkout, frozen hashes in local-source-notes.md. Used for C22; claim-specific limit in the ledger.
- <a id="s23"></a>**S23** — [Coherence counterexample](../integrated-todo/evidence/e2e-current/coherence/sequence.json), Generated oracle receipt, 2026-09-11. Used for C23; claim-specific limit in the ledger.
- <a id="s24"></a>**S24** — [User constraints and latest correction](./local-source-notes.md), Conversation constraints recorded 2026-09-11. Used for C24; claim-specific limit in the ledger.

## Search and control record

- **Search routes:** Web search plus direct canonical vendor pages and original-paper PDFs/OCR. Three independent source tracks: normalized caches, reactive/sync systems, database foundations. Root inspected local runtime/compiler and relevant documentation. Exact query families and sections are in the linked track notes.
- **Prominence counter-search:** Original partial-information, inverse-view-update, and top-k work broadened the frame beyond current cache vendors. Targeted searches sought deletion, filtered membership, pagination gaps, and concurrency caveats. English-indexed material and familiar citation routes remain concentrated; this did not become a failed-project survey.
- **Contrary-evidence search:** Each external track performed two focused passes. Captured-count hazards, explicit filtered-connection updates, cached-data limits, probabilistic buffering, and source-query requirements were retained. Unopened search results remain leads, not claims.
- **Source-class coverage:** Current official technical guides, original scholarly works, local implementation, test record, and user testimony. Vendor docs establish documented intent, not independent robustness. No secondary account substitutes for an inspected load-bearing original.
- **Recency check:** Access cutoff 2026-09-11; current live pages separated from dated papers. Relay and Apollo visible versions recorded in notes. Electric redirects were followed; old architectural claims were not silently merged with current docs.
- **Saturation check:** All three tracks reached six inspected sources and two targeted passes. Material additions and thin cells remained, so the declared budget stopped the survey; saturation and exhaustiveness are not claimed.

Frozen notes: [normalized caches](./cache-source-notes.md), [sync systems](./sync-source-notes.md), [database foundations](./database-source-notes.md), [local source](./local-source-notes.md). Agents used separate contexts and wrote separate notes; shared model lineage and search indexes still correlate their selection.

## Limits and unmeasured

- **Main artifact risk:** The frame favors named storage and synchronization mechanisms. It may flatten developer effort, operational failures, and domain-specific update policies. Vendor documentation and English academic work are overrepresented.
- **Unmeasured:** Latency, memory use, implementation effort, runtime bug rates, production authorization, arbitrary opaque functions, multi-query failure publication, and cross-device conflict semantics. OCR formulas were not independently checked; inaccessible originals are named in the database notes.
- **Coverage claim:** A broad but bounded orientation with traceable mechanisms and limits. It supports further examination, not a design recommendation, exhaustive literature review, or certified transfer to Endpoints.

## Handoff index

- Terms and C1/C4/C19 separate identity from membership.
- C7/C15/C16/C21 locate partial-data and boundary conditions.
- C3/C8/C11/C12 locate replay and acknowledgement distinctions.
- C13/C18 locate inverse-update policy requirements.
- C19–C24 and local source hashes locate the grounded artifact and current user constraints.

This index describes available material. The user's earlier request, rather than this file, selected the subsequent Ground-condition probe and Design grammar extractor.
