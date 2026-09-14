---
instrument: research-survey
title: "Relational algebra, incremental results, and client reconciliation"
question: "Which relational and SQL result operations can be maintained or transmitted incrementally, what information and guarantees do they require, and which boundaries matter for Endpoints without changing the user's PostgreSQL database?"
scope: "Foundational relational and incremental-view theory through primary sources accessible on 2026-09-11; PostgreSQL semantics and client result transfer; English sources."
intended_use: "Provide a source-traced factual substrate for later Ground Condition and Design Grammar on simple Endpoints optimizations; do not select a design."
depth: broad
researched_at: 2026-09-11
source_cutoff: 2026-09-11
status: complete
---

# Relational algebra, incremental results, and client reconciliation

## Survey brief

- **User request:** “This looks great but let's first do a research survey to relational algebra etc. to get a good sense of what operations are doable”.
- **Question:** Which relational and SQL result operations can be maintained or transmitted incrementally, what information and guarantees do they require, and which boundaries matter for Endpoints without changing the user's PostgreSQL database?
- **Intended use:** A factual substrate for later Ground Condition and Design Grammar; no design ranking or implementation in this pass.
- **Included:** Relational/set/bag algebra, signed deltas and provenance; selection, projection, joins, grouping, negation, ordering/limits, recursion; view maintenance/self-maintainability; existing SQL and transaction semantics; result differencing and baseline-dependent transfer.
- **Excluded:** Installing triggers, tables, extensions, replication infrastructure or migrations in user databases; implementing an optimizer; claiming complete SQL coverage; new latency benchmarks; formal systematic review.
- **Starting sources:** The current conversation, `MUTATION-EFFECTS-CATALOG.md`, and `REFRESH-PRUNING.md` are local context and constraints, not independent evidence.
- **Depth and stop rule:** Broad; up to 24 substantive external source pages/papers, with final targeted passes on gaps and contrary evidence. Stop after two consecutive targeted passes add no material mechanism or boundary, or at the declared source/access limit. Report the actual reason.
- **Dates and language:** Research and source cutoff 2026-09-11; English sources. Separate foundational papers from pinned PostgreSQL documentation and current system descriptions.
- **Access:** Public web search and directly opened papers/docs. Record failed/paywalled access. No proprietary literature indexes.
- **Destination:** `probes/endpoints/RELATIONAL-ALGEBRA-SURVEY.md`.

## Coverage frame (frozen before external search)

1. Relational algebra versus executable SQL: sets, bags, identity, NULL, order.
2. Delta rules for local operators and joins; simultaneous changes to multiple inputs.
3. Auxiliary state and information sufficiency: aggregates, distinct, outer/anti joins, top-k.
4. General incremental computation and limits: recursion, nonlinearity, cost and memory.
5. What an existing PostgreSQL deployment exposes: mutation results, constraints/dependencies, MVCC and authoritative snapshots; indirect/context-dependent effects.
6. Full recomputation versus result differencing versus input-delta maintenance; client baseline, multiplicity and ordering requirements.
7. Contrary cases and performance evidence: maintenance work exceeding recomputation, incomplete inputs, transport versus computation costs.

## Orientation

Relational algebra provides rules for composing query results. Incremental view maintenance (IVM) asks how those results change when their inputs change. Self-maintainability asks a narrower question: whether the old result and supplied changes contain enough information, without another base-table read. Transport differencing asks a separate question: how to encode a new result using an older result already held by the receiver. [S1](#s1) [S4](#s4) [S23](#s23)

These literatures describe many more maintainable operations than simple row filtering. Their assumptions differ: complete changes, retained intermediate state, access to other input rows, or identifiable prior representations. None of those assumptions follows merely from parsing an endpoint's SQL. This is the survey's bounded reading, not an Endpoints support declaration.

## Terms and distinctions

- **Relation versus physical table:** Codd separates the logical data model from storage layout, indexes, and access paths. Algebraic equivalence does not specify an execution cost. [S1](#s1)
- **Set, bag, signed bag:** Sets record membership; bags record multiplicity; signed bags allow negative weights for retractions. Positive algebra adds multiplicities through projection/union and multiplies them through joins. [S2](#s2) [S9](#s9)
- **Incrementally maintainable versus self-maintainable:** Maintenance may consult base data or auxiliary views. Self-maintenance uses only the view and the supplied database modifications; it can depend on the modification type. [S4](#s4)
- **Monotonicity:** For set queries, adding input cannot remove output. A filter with a fixed predicate is monotone; an anti-join need not be. This definition says nothing about how much output changes or how deletions are handled.
- **Provenance versus dependency:** Provenance describes how input tuples contribute to outputs. A coarse dependency names a possibly relevant input. A list of contributing tuples can omit distinctions between alternative derivations. [S2](#s2)
- **Output patch versus input delta:** An output patch relates two representations. An input delta describes database changes from which a query delta might be computed. These need not be obtained by the same method. [S9](#s9) [S23](#s23)

## Evidence landscape

### Algebra and the information it preserves

**C1 — SQL requires more than set algebra.** PostgreSQL defaults to retaining duplicate rows in `SELECT`, while plain `UNION` removes them. `INTERSECT ALL` uses the smaller multiplicity; `EXCEPT ALL` uses truncated subtraction. Sorting also introduces collation, NULL placement, and ties. Equal sort keys do not guarantee a repeatable relative order. [S13](#s13)

**C2 — Signed changes compose through many operators.** Write `R₁ = R₀ + δR`, with integer tuple weights: insertions add, deletions subtract. For fixed deterministic row expressions, selection and bag projection commute with changes. For a join whose two inputs change:

```text
δ(R ⋈ S) = (δR ⋈ S₀) + (R₀ ⋈ δS) + (δR ⋈ δS)
```

This follows by distributing `(R₀ + δR) ⋈ (S₀ + δS)` and subtracting the old join. All terms refer to a consistent pair of input states. It also exposes why a self-join cannot treat the second occurrence of a changed table as unchanged. This is an algebraic derivation using signed-bag operations, not SQL `EXCEPT ALL` as a signed subtraction operator. [S11](#s11)

**C3 — Deletion needs evidence about surviving support.** The counting approach tracks how many derivations support an output. Losing one derivation does not necessarily remove that output. Recursive maintenance adds further concerns: the 1993 paper distinguishes counting from delete-and-rederive (DRed). [S3](#s3)

**C4 — Missing state is a real limit on self-maintenance.** Consider two databases whose ascending top-1 result is `A`: one has hidden successor `B`, the other `C`. Receiving only “delete A” gives identical observations but requires different new answers. No computation on those observations alone can distinguish them. This is an illustrative inference, consistent with the top-k paper's refill boundary. Keeping extra candidates can reduce refills without removing the general boundary. [S4](#s4) [S6](#s6)

### Operation map

“Possible” below means under the stated information and semantics. It does not mean implemented in this repository, constant time, or possible from a displayed collection alone. Rows describe operator families; composing them can add state and enlarge the affected region.

| Operation | What can be done | Information or boundary |
| --- | --- | --- |
| Fixed filter, bag projection, rename, `UNION ALL` | Transform signed input rows and combine their weights. | Old values for retractions; matching expression semantics; multiplicity retained. Projection can discard a base key. C1–C2. |
| `DISTINCT`, set union | Maintain support counts; emit a change when membership crosses zero. | Distinct output alone loses the count of duplicates. C3; [S12](#s12). |
| Inner join, including multiple changed inputs | Join changes with the appropriate other inputs; include cross-effects. | Other-side rows or suitable indexes/state; one changed row can match many outputs. C2. |
| Semi-join / `EXISTS`, anti-join / `NOT EXISTS` | Track whether matching support exists; emit transitions when it appears or vanishes. | Matching counts or equivalent reads. An insertion can remove an anti-join result. Algebraic inference from C3 and outer-join decomposition. [S5](#s5) |
| Outer join | Maintain matched rows and repair NULL-extended unmatched rows. | Appearance/disappearance of the first/last match; join keys and constraints can reduce work. [S5](#s5) |
| Grouped `COUNT`, `SUM`, `AVG` | Maintain per-group sufficient statistics; `AVG` uses sum plus non-NULL count. | Deleted contributions, group creation/removal, NULL rules; numeric execution must match the required result semantics. [S3](#s3) [S14](#s14) |
| `HAVING` | Re-evaluate the predicate for each changed aggregate group. | Groups can enter/leave the result. Inference by composing aggregation and selection. |
| `MIN`, `MAX` | Maintain extremes with enough supporting state, or read replacement candidates. | Deleting the last current extreme may require a base read. [S11](#s11) |
| Median, other complex deterministic aggregates | Recompute affected groups when their keys and complete current members are available. | A group can be the entire relation; no claim of a small invertible accumulator. [S10](#s10) |
| `ORDER BY`, top-k, offset | Maintain order over known rows; refill missing candidates when necessary. | Full result versus truncated result; ties and sort semantics; offset changes can shift many rows. C1, C4. |
| Window functions | Recompute affected partitions; narrower algorithms depend on the window. | Rank and running values can change across many rows. Frames, peers, ordering and NULL behavior matter. [S10](#s10) [S15](#s15) |
| Recursive queries | Maintain fixed-point computations in systems such as DBSP. | Retained recursive state and convergence assumptions; this is not a proof for arbitrary PostgreSQL recursive SQL. [S9](#s9) |
| `INTERSECT` / `EXCEPT`, with or without `ALL` | Re-evaluate output membership/multiplicity for values whose input counts change. | Counts on both sides and exact set/bag semantics. Inference from C1. |
| Ordered JSON/array/string aggregates | Recompute affected values/groups or maintain their ordered contents. | Input order changes the aggregate; JSON variants differ on NULLs and duplicate keys. [S14](#s14) |
| User functions, time/context-dependent expressions | Re-evaluate under an explicit evaluation context; no generic row-local rule follows. | Volatility declarations are optimizer promises, not exhaustive proofs of dependencies. [S20](#s20) |

**C5 — SQL numeric and empty-input behavior remains part of correctness.** `COUNT(*)` differs from `COUNT(x)` on NULLs; an empty `SUM` is NULL. Algebraic sums over exact values do not by themselves prove identical floating-point evaluation after regrouping additions. The latter is a numerical inference and an unproved implementation boundary here. [S14](#s14)

### Broader maintenance mechanisms

**C6 — Higher-order maintenance trades state for repeated work.** DBToaster materializes queries and their delta queries, then maintains these auxiliary views. Its own analysis also identifies nesting and inequality cases where recomputation is preferable. This is compiled stateful maintenance, not a stateless rewrite of a mutation response. [S7](#s7)

**C7 — Factorization can avoid constructing repeated combinations.** F-IVM organizes computations, payloads and updates into factored forms. Conditional independence in the query can allow shared substructure instead of listing every combination. Its paper also identifies shapes such as triangle queries with no such factorization opportunity. Reported gains apply to its evaluated tasks and representations. [S8](#s8)

**C8 — General incrementalization and cheap incrementalization are separate claims.** DBSP gives a compositional framework over streams and signed collections, including recursive computation. A construction that integrates changes, evaluates the original query, and differentiates its output establishes a delta computation; rewrites are needed to avoid merely reconstructing and recomputing. [S9](#s9)

**C9 — Recomputing an affected region is established practice.** Enzyme describes group/partition replacement, delta plans and full recomputation. It uses row tracking, change feeds and historical versions. This 2026 Databricks account does not establish that its infrastructure or costs transfer to PostgreSQL browser applications. [S10](#s10)

### Existing PostgreSQL and authority boundaries

**C10 — `RETURNING` exposes useful DML results, with version differences.** PostgreSQL 17 documents inserted rows, new updated rows and deleted rows. PostgreSQL 18 additionally documents explicit `old` and `new` values. These interfaces avoid a separate retrieval for those values. Neither page establishes that the target-row result is a complete transaction-wide change stream. Older PostgreSQL/PGlite compatibility must be checked separately. [S16](#s16) [S17](#s17)

**C11 — An authoritative read is tied to a snapshot.** At Read Committed, separate `SELECT`s can observe different committed states; later statements see their transaction's earlier writes. A shared HTTP response alone does not establish a shared SQL snapshot. Conversely, an SQL snapshot does not establish that an older response remains safe to install after a newer one. The latter is a client-protocol inference, not an MVCC guarantee. [S18](#s18)

**C12 — One SQL statement is not automatically a post-mutation refresh.** Data-modifying CTE siblings share a snapshot and cannot observe each other's base-table changes; they communicate modifications through `RETURNING`. A main `SELECT` from the target table therefore need not read the new contents. [S19](#s19)

**C13 — Catalog dependencies and visible row versions are limited evidence.** PostgreSQL does not track body-only table dependencies for functions whose bodies are string literals. `xmin` identifies a row version's inserting transaction; `ctid` is a physical location that can change. Neither is documented as a query-result revision. The inference for this task is narrow: these facts alone cannot certify that a whole cached collection remained unchanged. [S21](#s21) [S22](#s22)

**C14 — The evaluation context can change without ordinary row writes.** PostgreSQL's `STABLE` promise is within a statement. Functions can depend on configuration such as time zone; `VOLATILE` functions can change results or perform writes. Thus `Q(database)` is an incomplete model for unrestricted SQL; it may need to be `Q(database, context)`, with an explicit boundary for effects. [S20](#s20)

### Wire representation and overlapping results

**C15 — Delta transmission can be independent of query maintenance.** RFC 3229 describes encoding a new representation relative to an identified older instance, including choosing a retained base. It does not require knowing the operations that produced the new representation. Thus, as a protocol inference, fully evaluating an endpoint and then differencing against a retained exact result can reduce transfer without incrementalizing its SQL. It saves no base-query work by itself. [S23](#s23)

**C16 — A patch needs its expected target.** JSON Patch operations apply sequentially and array positions change as edits are applied. The format provides edits and tests, not a database coherence protocol. For Endpoints, matching the authoritative baseline, handling order/multiplicity, and keeping optimistic overlays separate remain additional obligations. Those are application inferences, not guarantees supplied by JSON Patch. [S24](#s24)

**C17 — Sharing evaluation, sharing representation, and bundling calls are different operations.** PostgreSQL can share a materialized CTE, but materialization can prevent useful restriction pushdown. F-IVM shares factored computation. Neither establishes that packaging three independent queries into one statement yields one scan. Nor does joining three independent result sets preserve them: joining changes combinations and multiplicities. A tagged union or separate named result payloads expresses a different operation. This distinction is an algebraic inference; no combined-query optimization was measured here. [S19](#s19) [S8](#s8)

## Positions and mechanisms

These are unranked mechanisms, not competing implementation proposals.

| Mechanism | What its evidence supplies | What it assumes or leaves open |
| --- | --- | --- |
| Algebra-derived input deltas | C2–C3: query changes from complete input changes and supporting state. | Change capture, compatible snapshots and SQL semantics. |
| Self-maintained view | C4: cases needing no further base reads. | The retained view contains sufficient information for the particular operation. |
| Auxiliary/factored state | C6–C8: reuse work across changes and avoid repeated combinations. | State initialization, freshness, memory and lifecycle. |
| Affected-region recomputation | C9: recompute groups/partitions rather than invert each function. | Complete affected keys and access to all current region members. |
| Full evaluation plus result difference | C15–C16: compare actual outputs, then encode changes. | A retained compatible baseline; computation and transfer costs remain separate. |
| Shared read or shared payload | C17: combine common work or repeated data. | Equivalent semantics and a measured execution/encoding plan. |

**C18 — Applicability and freshness are different predicates.** Under a pure relational model, complete read/write sets that are disjoint establish that *this mutation* does not affect *this query*. They do not establish that the client already contains the current result. Example: another writer changed a relevant row before an unrelated mutation started. The unrelated mutation leaves the query unchanged during its own execution, but the old client remains stale. This is a counterexample inference from the snapshot/baseline distinctions, not a new database theorem. [S18](#s18) [S23](#s23)

Applied to optimism, the same distinction concerns available knowledge: an input overlay over a complete relevant relation supports more deductions than an overlay over a filtered output. This does not predict server branching, hidden effects, or intervening writes. The user's existing fallback and retained-collection rules remain constraints; this survey does not change them.

## Disputes and conflicting evidence

**Expressive theory versus restricted systems.** DBSP covers a broad modeled language (C8); `pg_ivm` exposes narrower supported combinations, including restrictions around outer joins and subqueries. That is a difference in implementation and assumptions, not evidence that the excluded algebra is impossible. The PostgreSQL wiki page is a proposal, and `pg_ivm` is an extension; neither is adopted under the no-database-modification constraint. [S9](#s9) [S11](#s11) [S12](#s12)

**Incremental speedups versus maintenance overhead.** DBToaster reports cases where reevaluation wins; F-IVM reports benefits for factorizable tasks; `pg_ivm` warns that large changes can cost more than refresh. Enzyme also chooses full recomputation in its strategy space. These do not define a common break-even threshold: state, workload, engine and measured quantity differ. No latency ranking follows. [S7](#s7) [S8](#s8) [S12](#s12) [S10](#s10)

**Fewer bytes versus loopback timing.** There is no contradiction between extra computation and a network latency win. As an explicit illustrative model, serialization time over a bottleneck is `bytes / throughput`; saving 100 KiB at 10 Mbit/s saves about 82 ms in that term. This is arithmetic, not a benchmark. Added requests, request-body bytes, compression, overlap and both network legs—PostgreSQL→server and server→browser—change the comparison. RFC 3229 treats delta encoding and compression as distinct transformations. Local timings cannot measure an absent bottleneck. [S23](#s23)

No material conflict about the basic delta identities was found within these routes. That is a bounded search result, not evidence of universal agreement or exhaustive proof checking.

## Cases and timeline

| Period | Representative contribution | Scope |
| --- | --- | --- |
| 1970 | Codd's relational model | Logical data independence; not an incremental engine. S1. |
| 1993–1996 | Counting/DRed and self-maintainability | Correct maintenance and sufficient information. S3–S4. |
| 2002–2007 | HTTP deltas, top-k refill, provenance, outer joins | Separate transport, information and operator issues. S2, S5–S6, S23. |
| 2013 report; 2018 revision | DBToaster; F-IVM | Compiled auxiliary state and factorization. S7–S8. |
| 2023 | DBSP | General compositional incremental computation. S9. |
| PostgreSQL 17 versus 18 | Expanded `RETURNING` documentation | Runtime version changes available evidence. S16–S17. |
| March 2026 preprint | Enzyme | Production-engine account with richer storage support. S10. |

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Set/bag semantics, signed changes, identity | supported | S1–S3, S9, S13, S22 | No full SQL type/equality conformance matrix. |
| Filters/projection/joins and multi-input changes | supported | S2, S5, S9, S11 | No Endpoints translator proof or runtime tests. |
| Distinct, aggregates, anti/outer joins, top-k | supported | S3–S6, S10–S15 | Top-k source inspected through institutional abstract, not full algorithms. |
| Windows and recursion | thin | S9–S10, S15 | Mechanisms mapped; no complete PostgreSQL composition or termination classification. |
| DML evidence, snapshots and dependency gaps | supported | S16–S22 | Existing triggers, RLS, deferred constraints, FDWs and external writers need further dedicated analysis. |
| Auxiliary state and factorization | supported | S7–S9 | No state budget or representative OLTP benchmark. |
| Result diff, baseline and shared transport | supported | S19, S23–S24 | No selected encoding, browser implementation or proof for overlap repair. |
| Cost boundaries and contrary evidence | supported | S7–S8, S10, S12 | No common benchmark; no production latency measurements. |
| Query containment/rewrite completeness, constraint reasoning | thin | S4–S5 | No full chase/containment survey or security-aware rewrite rules. |
| Exotic SQL types/operators, recursive bag edge cases | unsearched | — | Spatial/vector/full-text, user aggregates, custom collations and extensions remain outside this pass. |

## Claim-to-source ledger

Confidence describes support for the bounded claim, not readiness to ship.

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | primary record | S13 | solid | PostgreSQL 18 semantics only. |
| C2 | scholarly finding / inference | S9, S11 | solid | Fixed deterministic signed-bag operators. |
| C3 | scholarly finding | S3 | solid | Counting and recursion require distinct treatment. |
| C4 | inference / scholarly finding | S4, S6 | solid | Indistinguishable-input example; top-k paper abstract access. |
| C5 | primary record / inference | S14 | solid | Numerical equivalence not proved. |
| C6 | scholarly finding | S7 | solid | Stateful compiled system and its workloads. |
| C7 | scholarly finding | S8 | solid | Query-dependent factorization. |
| C8 | scholarly finding | S9 | solid | Modeled language, not all executable SQL. |
| C9 | practitioner report | S10 | solid | Primary implementor report; different storage system. |
| C10 | primary record / inference | S16, S17 | solid | Target rows do not establish complete effect capture. |
| C11 | primary record / inference | S18 | solid | Snapshot and client installation are distinct. |
| C12 | primary record | S19 | solid | Data-modifying CTE semantics. |
| C13 | primary record / inference | S21, S22 | solid | Refutes these shortcuts, not every possible proof. |
| C14 | primary record / inference | S20 | solid | Does not inventory every context dependency. |
| C15 | primary record / inference | S23 | solid | Exact base required; SQL work not reduced. |
| C16 | primary record / inference | S24 | solid | Format is not a coherence protocol. |
| C17 | primary record / scholarly finding / inference | S19, S8 | solid | No combined-query benchmark. |
| C18 | inference | S18, S23 | solid | Explicit external-write counterexample. |

## Sources

All accessed 2026-09-11. Papers were inspected in relevant sections, not reviewed line by line in full. Sources are primary authors' work or official documentation; a mirror is an access route, not a second independent authority.

### Scholarly and technical

- <a id="s1"></a>**S1** — [A Relational Model of Data for Large Shared Data Banks](https://db.dobo.sk/wp-content/uploads/2015/11/Codd_1970_A_relational_model.pdf), E. F. Codd, CACM, 1970. **Used for:** logical/physical distinction. **Limit:** reprint mirror; original ACM PDF access failed.
- <a id="s2"></a>**S2** — [Provenance Semirings](https://www.cs.ucdavis.edu/~green/papers/pods07.pdf), Green, Karvounarakis and Tannen, PODS, 2007, §§2–4. **Used for:** bag annotations, derivations. **Limit:** positive algebra framework does not alone cover negation and SQL NULLs.
- <a id="s3"></a>**S3** — [Maintaining Views Incrementally](https://www.cs.columbia.edu/~gravano/Qual/Papers/13%20-%20Maintaining%20Views%20Incrementally.pdf), Gupta, Mumick and Subrahmanian, SIGMOD, 1993. **Used for:** C3, C5, aggregates and counting. **Limit:** formal models and algorithms, not Endpoints.
- <a id="s4"></a>**S4** — [Data Integration Using Self-Maintainable Views](https://www.researchgate.net/publication/2302656_Data_Integration_using_Self-Maintainable_Views), Gupta, Jagadish and Mumick, 1996 work; author-uploaded chapter text, §§1–3. **Used for:** C4 and information sufficiency. **Limit:** OCR spacing is poor; platform upload/publication dates differ from original work; no theorem-completeness claim here.
- <a id="s5"></a>**S5** — [Efficient Maintenance of Materialized Outer-Join Views](https://www.cs.columbia.edu/~jrzhou/pub/OJViewMaintenance.pdf), Larson and Zhou, 2007. **Used for:** matched/unmatched maintenance, constraints. **Limit:** paper's query class and experimental setting.
- <a id="s6"></a>**S6** — [Efficient Maintenance of Materialized Top-k Views](https://scholars.duke.edu/publication/807148), Yi, Yu, Yang, Xia and Chen, ICDE, 2003. **Used for:** C4, top-k refill. **Limit:** institutional abstract and bibliography only; reported performance not independently checked.
- <a id="s7"></a>**S7** — [DBToaster: Higher-order Delta Processing for Dynamic, Frequently Fresh Views](https://dbtoaster.github.io/papers/2013-dbtoaster-report.pdf), Koch et al., 2013 report, §§1, 5. **Used for:** C6 and recomputation counter-cases. **Limit:** manuscript copy, specialized compilation and state.
- <a id="s8"></a>**S8** — [Incremental View Maintenance with Triple Lock Factorization Benefits](https://arxiv.org/html/1703.07484v2), Nikolic and Olteanu, 2018 revision, §§7–8. **Used for:** C7, C17. **Limit:** specific query/task structure; no PostgreSQL deployment claim.
- <a id="s9"></a>**S9** — [DBSP: Automatic Incremental View Maintenance for Rich Query Languages](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf), Budiu et al., PVLDB, 2023, §§2–6. **Used for:** C2, C8 and recursion. **Limit:** formal language assumptions and retained streams/state.
- <a id="s10"></a>**S10** — [Enzyme: Incremental View Maintenance for Data Engineering](https://arxiv.org/html/2603.27775v1), Yadav et al., March 2026 preprint, §§2–5. **Used for:** C9, group/window recomputation and cost choice. **Limit:** authors' Databricks account; storage capabilities unavailable by assumption here.

### Primary and official

- <a id="s11"></a>**S11** — [Incremental View Maintenance](https://wiki.postgresql.org/wiki/Incremental_View_Maintenance), PostgreSQL project wiki, live proposal page. **Used for:** delta rules, aggregate/outer-join boundaries. **Limit:** proposal and patch description, not a core PostgreSQL support contract.
- <a id="s12"></a>**S12** — [pg_ivm README](https://github.com/sraoss/pg_ivm), IVM Development Group, current repository documentation. **Used for:** distinct support counts, implementation restrictions, maintenance overhead. **Limit:** mutable README; extension requires installation and is outside deployment constraints.
- <a id="s13"></a>**S13** — [SELECT](https://www.postgresql.org/docs/18/sql-select.html), PostgreSQL 18 docs. **Used for:** C1, set operations and ordering. **Limit:** language semantics, not a maintenance algorithm.
- <a id="s14"></a>**S14** — [Aggregate Functions](https://www.postgresql.org/docs/18/functions-aggregate.html), PostgreSQL 18 docs. **Used for:** C5, NULLs, order-sensitive aggregates. **Limit:** no client numeric equivalence proof.
- <a id="s15"></a>**S15** — [Window Functions](https://www.postgresql.org/docs/18/functions-window.html), PostgreSQL 18 docs. **Used for:** frames, peers, rank and NULL boundaries. **Limit:** no general incremental algorithm.
- <a id="s16"></a>**S16** — [Returning Data from Modified Rows](https://www.postgresql.org/docs/17/dml-returning.html), PostgreSQL 17 docs. **Used for:** C10 version comparison. **Limit:** not a whole-transaction effect manifest.
- <a id="s17"></a>**S17** — [Returning Data from Modified Rows](https://www.postgresql.org/docs/18/dml-returning.html), PostgreSQL 18 docs. **Used for:** C10 explicit old/new values. **Limit:** must not assume this syntax on older engines.
- <a id="s18"></a>**S18** — [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html), PostgreSQL 18 docs. **Used for:** C11, C18. **Limit:** SQL guarantees do not order browser response installation.
- <a id="s19"></a>**S19** — [WITH Queries](https://www.postgresql.org/docs/18/queries-with.html), PostgreSQL 18 docs, §§7.8.3–4. **Used for:** C12, C17. **Limit:** shared computation and DML snapshot rules need separate treatment.
- <a id="s20"></a>**S20** — [Function Volatility Categories](https://www.postgresql.org/docs/18/xfunc-volatility.html), PostgreSQL 18 docs. **Used for:** C14 and context/effect boundaries. **Limit:** declared promises do not reveal all behavior.
- <a id="s21"></a>**S21** — [Dependency Tracking](https://www.postgresql.org/docs/18/ddl-depend.html), PostgreSQL 18 docs. **Used for:** C13. **Limit:** catalog dependency tracking, not complete static program analysis.
- <a id="s22"></a>**S22** — [System Columns](https://www.postgresql.org/docs/18/ddl-system-columns.html), PostgreSQL 18 docs. **Used for:** C13, row identity/version limits. **Limit:** not a collection revision protocol.
- <a id="s23"></a>**S23** — [RFC 3229: Delta Encoding in HTTP](https://www.rfc-editor.org/rfc/rfc3229.html), Mogul et al., January 2002, §§7, 10. **Used for:** C15, C18, baseline and coding distinctions. **Limit:** protocol precedent; no claim about current browser adoption.
- <a id="s24"></a>**S24** — [RFC 6902: JSON Patch](https://www.rfc-editor.org/rfc/rfc6902), Bryan and Nottingham, April 2013, §§3–4. **Used for:** C16. **Limit:** edit semantics only, not authority or concurrency control.

## Search and control record

- **Search routes:** Web search for relational model/Codd; IVM counting and bag semantics; self-maintainable views; provenance semirings; DBToaster/DBSP; outer joins and top-k deletion; PostgreSQL effect/dependency limits. Followed primary paper links, official versioned docs and RFCs. Inspected 24 distinct substantive sources; duplicate formats and access attempts count once.
- **Prominence counter-search:** Searched information-loss and older view-maintenance vocabulary beyond DBSP and current product pages. Added top-k refill, counting, self-maintainability, Oxford factorization, and protocol work. Institutions span IBM, universities, Microsoft Research, PostgreSQL implementors and Databricks. English and well-indexed public work remain overrepresented.
- **Contrary-evidence search:** Sought maintenance slower than recomputation, missing join/top-k information, unsupported operator combinations, hidden function dependencies, nondeterminism and misleading version identifiers. DBToaster's recomputation cases, pg_ivm restrictions, and Enzyme's infrastructure/cost requirements limit simple success claims.
- **Source-class coverage:** Primary research papers, author-uploaded text, institutional abstract, official SQL docs, implementor repository/proposal and standards. Search snippets and secondary discussions served only as leads; none supplies a material technical claim in the ledger. Independent benchmark replication was outside scope.
- **Recency check:** Separated 1970–2023 foundations from the March 2026 Enzyme account and live implementation pages. Pinned PostgreSQL docs to 17/18 where relevant; did not use development-version behavior as a supported baseline. Source cutoff 2026-09-11.
- **Saturation check:** Stopped at the declared 24-source cap, not claimed saturation. Final gap/contrary passes added factorization, affected-window/group recomputation, and current infrastructure assumptions. Targeted rereads confirmed their limits. Two consecutive no-new-information passes were not achieved; deeper constraint/containment and exotic-SQL coverage remain open.

## Limits and unmeasured

- **Main artifact risk:** Operator tables can make compositional SQL support look easier than it is. A correct local rule can still require unavailable old state, broader affected inputs, or different numeric/context semantics when composed.
- **Access:** Original ACM Codd PDF failed; used a reprint. Top-k coverage is abstract-only. Self-maintainability text has OCR defects. Other papers were selectively read in relevant sections. No inaccessible theorem is treated as verified.
- **Unmeasured:** No new benchmark, implementation, PGlite version check, optimizer plan inspection, memory estimate or generated oracle run. No complete inventory of PostgreSQL types, extensions, write side effects, RLS or external API behavior.
- **Deployment boundary:** No new PostgreSQL objects, extensions, triggers, replication setup or required migrations. Systems requiring those capabilities are evidence of methods, not available adapters. Existing application effects still belong in the correctness boundary.
- **Coverage claim:** Broad map of mechanisms and required information, not a systematic review, exhaustive PostgreSQL support matrix, selected design or proof that incremental work is faster.

## Handoff index

- **Operator rules and state requirements:** C1–C9 and the operation map.
- **PostgreSQL observation limits:** C10–C14.
- **Baseline, representation and affectedness distinctions:** C15–C18.
- **Cost counter-cases and open coverage:** disputes, coverage table and control record.

These are inputs for later examination. No further instrument or implementation is selected by this report.
