---
instrument: research-survey
title: "SQL effects and justified refetch pruning"
question: "Which established analyses justify skipping an endpoint collection's refetch without importing restrictions from client evaluation or patch maintenance?"
scope: "Public primary research and PostgreSQL 17/18 contracts; English; foundational work through 2026-09-14"
intended_use: "Source basis for a deterministic SQL effect checker, its Design Grammar, and tests of correctness and avoidable refetches"
depth: broad
researched_at: 2026-09-14
source_cutoff: 2026-09-14
status: bounded
---

# SQL effects and justified refetch pruning

## Survey brief

- **Question:** Which established mathematical analyses and PostgreSQL contracts can justify skipping an endpoint collection's refetch after a mutation, while identifying genuine unknown effects and avoiding restrictions that belong only to harder tasks such as client evaluation or row-patch maintenance?
- **Intended use:** Ground the selected Design Grammar and a deterministic checker that explains individual decisions. Keep value correctness and missed optimization tests distinct.
- **Included:** Query/update independence, conservative effect analysis, cache invalidation, PostgreSQL execution contracts, and independent testing mechanisms. The [frozen brief](design/field-trip-optimistic-coherence/sql-effects-research/BRIEF.md) predates external searching.
- **Excluded:** New compiler implementation, general JavaScript/library analysis, auth transformations, manual refresh APIs, tracking infrastructure in application PostgreSQL, new incremental view maintenance algorithms, benchmarks, and the later broad SQL generator implementation.
- **Starting sources:** Our [earlier algebra survey](RELATIONAL-ALGEBRA-SURVEY.md), [checker proposal](SQL-EFFECT-RULES-PLAN.md), and Kitchen port evidence in Field Log entry 58. These establish context, not independent validation.
- **Available source languages:** English. No geographic restriction; public academic, author, project, and PostgreSQL sites.
- **Access limits:** semDDA's repository abstract was accessible but its preprint download failed. The Cousots' author summary was accessible but the linked original PDF failed. Both have weaker inspection status than the full papers below. No subscription indexes or private implementation reports were searched.

## Orientation

Three bodies of work address different questions. Query/update independence asks whether an update can change a query's result. Abstract interpretation computes conservative summaries when exact reasoning is too costly or impossible. Cache systems add a separate protocol for deciding whether a stored result is still usable. A theorem about the first question does not supply the third protocol. [S1](#s1), [S2](#s2), [S3](#s3), [S26](#s26)

PostgreSQL adds concrete execution rules to the mathematical model: name binding, implicit expressions, referential actions, triggers, views, policies, and non-table state. These are operation-specific facts. Their existence does not establish that every optimization involving the containing table is invalid. That last distinction is this survey's inference from the contracts, not a theorem supplied by PostgreSQL. [S8](#s8), [S10](#s10), [S11](#s11), [S12](#s12)

## Terms and distinctions

- **Independence:** A mutation leaves a query's answer unchanged over the modeled database states. This is a relation between a query and an update, not a property called “safe table.” [S1](#s1)
- **Soundness versus precision:** A dependency summary must include every possible relevant dependency. Extra dependencies reduce useful conclusions without necessarily breaking correctness. Minimal summaries can be uncomputable in expressive languages. [S4](#s4)
- **Effect versus value:** Knowing where an expression may read or write need not determine its returned value. A server-generated value can be unpredictable while its destination relation remains known. This is an inference illustrated by defaults and sequence contracts. [S18](#s18), [S22](#s22)
- **Catalog dependency versus data dependency:** PostgreSQL's object dependency graph supports operations such as dropping objects. It is not a complete description of the tables that an executed function reads. [S13](#s13)
- **Unknown versus demonstrated interference:** Failure to prove independence is not a counterexample to it. Cosette explicitly distinguishes proof, counterexample, and unknown for SQL equivalence. [S24](#s24)
- **Relevant to which claim:** Refetch selection, client evaluation, exact patches, and cross-request reuse have different premises. This is an analytical distinction for the proposed checker; no inspected source validates the whole Endpoints design.

## Evidence landscape

### Independence and conservative summaries

- **C1 — Independence has a precise semantic target.** Levy and Sagiv define it by equality of query results before and after an update. They relate independence to equivalence and establish undecidability and decidable subclasses for their Datalog setting. This does not establish a decidability boundary for every PostgreSQL construct. [S1](#s1), sections 2–4.
- **C2 — A simpler abstraction can answer a narrower question.** The Cousots describe abstract execution that retains selected facts about concrete execution while allowing imprecision. Their author summary supplies the conceptual basis here; the original proof text was not accessible in this run. [S3](#s3)
- **C3 — Correct dependencies need not be minimal.** Cheney, Ahmed, and Acar formalize dependency-correctness and give both dynamic tracking and a less precise static analysis. Their nested relational calculus includes examples where provenance that records derivation does not suffice to establish independence. [S4](#s4), sections 3–5.
- **C4 — A coarse frame rule needs no expression evaluator.** Analytical derivation: let `R(q)` overapproximate the state locations that determine `q`, and `W(m)` overapproximate locations mutation `m` can change. If `D` and `m(D)` agree outside `W(m)`, the query is a deterministic function of `R(q)` and fixed inputs, and `R(q) ∩ W(m) = ∅`, then `q(D) = q(m(D))`. The proof is substitution of equal inputs. A table-set instance needs all implicit relation effects accounted for; table sets alone do not cover clocks, session state, sequences, or external sources. This is a proposed application of the independence/abstraction foundations, not a mechanically checked theorem for our parser. [S1](#s1), [S3](#s3), [S4](#s4)
- **C5 — Finer summaries are established research, not free precision.** semDDA reports applying intervals, octagons, polyhedra, and related domains to database application dependency analysis. Only the repository abstract was inspected; its evaluation and soundness arguments were not audited. [S5](#s5)

### Cache invalidation systems

- **C6 — Query/update pairs can yield executable invalidation conditions.** Sqlcache derives conflict formulas over old/new rows and query/update parameters. Its simple-query analysis distinguishes entering a result, leaving it, and changing a selected value. It weakens conflict conditions when needed, accepting extra invalidations. The implementation supports a stated SQL subset and separately handles transactional cache access on one server. It does not prove arbitrary PostgreSQL handler analysis. [S2](#s2), sections 2–4.
- **C7 — Restricted predicates can make fine-grained invalidation practical.** Łopuszański develops a single-table scheme using shared revision counters and predicate regions. The paper explicitly leaves multi-table joins outside its model and coarsens unsupported predicate shapes. Its reported deployment is author evidence, not a reproduced benchmark here. [S6](#s6), sections 2, 5–7.
- **C8 — Stronger cache contracts can require more infrastructure.** TxCache uses validity intervals and modified PostgreSQL to provide consistent, potentially stale snapshots. Ji and colleagues propose DBMS changes plus an invalidation index. Both illustrate information that a database-integrated design can obtain; neither demonstrates a drop-in solution under our no-database-modifications constraint. [S26](#s26), section 5; [S7](#s7), abstract and system description.

### PostgreSQL effects are attached to execution paths

- **C9 — An expression index is not itself an extra application relation.** Index expressions and predicates are restricted to the indexed row and immutable functions/operators; uniqueness may reject a write. Under those contracts, an index such as `lower(tags.name)` supplies no reason to classify a mutation as writing all other tables. This inference concerns relation footprints, not prediction of uniqueness outcomes, performance, physical inspection queries, or falsely declared functions. [S8](#s8)
- **C10 — Volatility describes several different behaviors imperfectly for this purpose.** `IMMUTABLE` promises argument-only results and no database modification. `STABLE` permits table reads and only promises repeated results within a statement. `VOLATILE` does not imply that a function writes a table. PostgreSQL documents ways incorrectly declared functions can violate these promises. Whether the checker accepts declarations as premises is a design contract, not something the label itself proves. [S9](#s9)
- **C11 — Foreign-key checks and actions have different effects.** Checking a referenced row does not itself imply writing its table. Deleting or updating a referenced key can execute `CASCADE`, `SET NULL`, or `SET DEFAULT` on referencing rows. A write closure must follow the action's direction and event; an undirected schema adjacency graph loses that distinction. The closure formulation is an inference from the documented actions. [S10](#s10)
- **C12 — A zero-row write may still execute effects.** PostgreSQL statement triggers run even if no rows are affected. Upsert and MERGE can activate statement triggers for specified actions even when that action changes no row. Trigger effects and transaction timing therefore cannot be inferred solely from returned row count. [S11](#s11)
- **C13 — Defaults and generated columns differ from ordinary reads.** Defaults run when selected by a write, including omitted insert columns or explicit `DEFAULT`; they can use volatile functions. Generated expressions are row-local and immutable by contract. PostgreSQL 17 supports stored generated columns; PostgreSQL 18 also supports virtual ones with stricter type/function restrictions. The mere presence of a default does not make reading stored rows invoke it. [S12](#s12), [S22](#s22), [S28](#s28)
- **C14 — Binding and object dependencies are separate inputs.** Function overload choice depends on argument types, schema qualification, and search path. A built-in-looking name is insufficient to identify a function. PostgreSQL does not record body-only dependencies for string-defined routines; SQL-standard bodies have different dependency tracking. Neither names nor `pg_depend` alone form a general effect oracle. [S15](#s15), [S13](#s13)
- **C15 — Views, policies, and rules require different expansion.** A view evaluates its defining query when referenced. RLS policies may consult other relations. Update rules may add or replace actions, and their generated trees undergo further rewriting. These are three distinct reasons the surface SQL relation names may be incomplete. This is no evidence that all three features must be rejected: known definitions can in principle contribute to an analysis. [S17](#s17), [S14](#s14), [S16](#s16)

### Equality and authority boundaries

- **C16 — A table transition is not the entire PostgreSQL state.** `nextval` advances sequence state even if the transaction later aborts. It does not follow that every application-table collection changed. Likewise, changing a generated UUID value need not change which relation receives it. The latter is an effect/value distinction, not a claim that every volatile routine is harmless. [S18](#s18), [S9](#s9), [S22](#s22)
- **C17 — Snapshot boundaries matter to the reference result.** At Read Committed, successive selects can observe different snapshots. Data-modifying CTE siblings share a snapshot and do not see each other's target-table updates; `RETURNING` communicates their changes. Combining an update and a base-table read in one CTE statement is not automatically a post-mutation refetch. [S19](#s19), [S21](#s21)
- **C18 — Equality must match SQL's promised result.** Without a sufficient ordering clause, SQL does not promise a row order; an underordered limit can choose different members. A test that merely sorts outputs cannot repair nondeterministic membership. Exact equality cases need a defined result contract, while tests of permitted nondeterminism need a relational oracle. [S20](#s20); the testing consequence is an inference.
- **C19 — Server independence does not discharge browser obligations.** In the user-defined Endpoints contract, an optimistic recipient may need authoritative correction even when the actual server write is disjoint. Missing baselines and already outstanding repair obligations also remain. All retained collections are candidates, regardless of subscribers. These are local requirements, not findings about PostgreSQL. External freshness remains polling/event/sync work; independence does not upgrade it to continuous global consistency. Source: user instructions and the [checker proposal](SQL-EFFECT-RULES-PLAN.md).
- **C20 — Whole-handler claims exceed SQL-only evidence.** The user has deferred arbitrary JavaScript/helper and auth-library inference. Thus a visible-SQL footprint must state that scope; it cannot silently become a proof of every effect the handler might perform. Auth code stays unchanged. Deferring analysis and claiming proven absence of hidden effects are different acts. Source: user scope, consistent with the explicit-program assumptions of [S2](#s2).

### Independent validation

- **C21 — Broad query generation does not supply a value oracle.** SQLsmith generates from a target schema and reports execution outcomes; its own documentation notes that generated function calls may have side effects. It is a source of test inputs, not proof of result correctness or a guarantee that rollback undoes every effect. [S27](#s27)
- **C22 — Different oracles catch different failures.** PQS ensures a generated pivot row should be returned, but does not validate order or duplicate counts and has limits around nonmatches and limits/offsets. NoREC compares a query with a rewrite designed to avoid optimizations. These establish practical alternatives to cross-engine agreement, each with restricted semantics. [S23](#s23), sections 3 and 5; [S25](#s25).
- **C23 — A deterministic checker can return unknown.** Cosette combines counterexample search and proof search for a SQL fragment. Its outcomes include unknown; executing on a single concrete database answers a different, weaker question than equivalence over all databases. This supports separating proof, bounded evidence, and missing analysis. It does not establish that Cosette is a ready-made PostgreSQL effect analyzer. [S24](#s24), section 2.
- **C24 — Correct rows cannot detect every needless refetch.** Analytical inference for our oracle: an implementation that refetches everything may pass every final-row assertion. Independently specified metamorphic laws can additionally require invariant relation footprints and skips when adding an effect-free index, renaming aliases, or replacing an expression with another having the same established effects. A separate mutant that adds gratuitous fallback should fail these assertions; an omitted-effect mutant should fail value comparisons. This two-sided contract is proposed, not externally validated. [S4](#s4), [S8](#s8) motivate the distinction.

## Positions and mechanisms

| Mechanism | Source support | Boundary |
| --- | --- | --- |
| Conservative relation/effect summaries | Independence and abstract interpretation foundations; C1–C4 | Disjointness is sufficient, not necessary; binding and implicit effects still need sound summaries. |
| Predicate/column-sensitive independence | Sqlcache conflict formulas; C6 | Needs old/new membership and SQL semantics; its supported fragment is not all PostgreSQL. |
| Shared counters and predicate regions | Single-table cache algorithm; C7 | Requires coordinated invalidation metadata and a restricted predicate model. |
| Database-integrated validity tracking | TxCache and transparent invalidation; C8 | Stronger integration/consistency contracts than our selected deployment scope. |
| Equivalence solver | Cosette; C23 | Its formal SQL model, counterexamples, and unknown outcomes must remain explicit. |

These are unranked mechanisms. Cost/coverage comparisons for Endpoints were not measured.

## Disputes and conflicting evidence

**Declared contracts versus enforcement.** PostgreSQL's optimizer relies on volatility promises, yet its documentation describes misdeclarations and enforcement gaps. Accepting the documented contract supports more reasoning; verifying arbitrary implementations is a larger task. The survey records that boundary without selecting a trust policy. [S9](#s9)

**Conservative does not mean maximally restrictive.** Overapproximating dependencies preserves the relevant safety property, but recording every input everywhere can reveal nothing useful. This agrees with the criticism of table-wide bans; it does not prove every desired optimization is valid. [S4](#s4), [S2](#s2)

**Physical independence has a result-contract limit.** A valid index need not add a logical relation dependency, but changing access paths can expose unspecified order or underordered limit membership. “Same relation footprint” and “byte-identical arbitrary query output” are distinct metamorphic assertions. [S8](#s8), [S20](#s20)

**Different cache guarantees are not contradictory findings.** TxCache targets consistent snapshots, potentially stale; Endpoints' selected task is mutation-driven repair of browser collections. Reported cache performance does not establish this application's latency or justify introducing DB modifications. [S26](#s26), [S7](#s7)

No head-to-head evidence was found that adjudicates a universal best invalidation granularity for this workload. No consensus or exhaustive negative claim is inferred from that bounded result.

## Cases and timeline

| Period | Material development |
| --- | --- |
| 1977 | Abstract interpretation provides a vocabulary for correct approximations. [S3](#s3) |
| 1993 | Query/update independence linked to equivalence for Datalog. [S1](#s1) |
| 2000s–2010s | Dependency provenance, transactional application caches, and compile-time invalidation analyses address distinct parts of the problem. [S4](#s4), [S26](#s26), [S2](#s2) |
| 2017–2020 | SQL proof/counterexample tools and dedicated DBMS logic oracles demonstrate executable checking with stated limits. [S24](#s24), [S23](#s23), [S25](#s25) |
| 2023 public records | Single-table invalidation and DBMS-integrated invalidation provide contrasting deployment models. Publication of these records is not a claim that the ideas originated in 2023. [S6](#s6), [S7](#s7) |
| PG17 versus PG18 | Virtual generated columns change when some expressions execute; versioned schema contracts matter. [S28](#s28), [S12](#s12) |

Kitchen's expression-index rejection is a motivating local case, not independent range evidence for a grammar extracted using that case.

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| 1. Independence, precision, logical/physical distinction | supported | S1, S4, S8, S20 | No universal PG independence decision procedure established. |
| 2. Abstract interpretation and provenance | thin | S3, S4, S5, S13 | Strong dependency paper; original abstraction paper and semDDA proof text unavailable. |
| 3. Invalidation systems | supported | S2, S6, S7, S26 | No reproduction or comparable Endpoints measurements. |
| 4. PG operation effects | supported | S8–S18, S21, S22, S28 | Representative contracts, not exhaustive types/operators/extensions/DDL/FDW coverage. |
| 5. Context, transactions, browser authority | supported with local premises | S9, S18–S21, S26; user scope | No new browser protocol proof; partial-commit repair remains a runtime concern. |
| 6. Executable validation | supported | S23–S25, S27; C24 | No generator/tool adoption tested; precision-oracle laws still to implement. |

## Claim-to-source ledger

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | scholarly finding | S1 | solid | Datalog model. |
| C2 | source argument | S3 | solid | Author summary, original PDF inaccessible. |
| C3 | scholarly finding | S4 | solid | Nested relational calculus. |
| C4 | inference | S1, S3, S4 | solid | Conditional frame argument, not implementation proof. |
| C5 | source argument | S5 | plausible | Abstract only. |
| C6 | scholarly finding | S2 | solid | Stated SQL subset and server assumptions. |
| C7 | source argument / practitioner report | S6 | plausible | Single-table model; deployment not reproduced. |
| C8 | scholarly finding / source argument | S26, S7 | solid | Different deployment contracts. |
| C9 | inference | S8 | solid | Valid contracts; logical relation footprint only. |
| C10 | primary record | S9 | solid | Declarations are promises, not body proofs. |
| C11 | primary record / inference | S10 | solid | Event-sensitive closure is our derivation. |
| C12 | primary record | S11 | solid | Applicable PostgreSQL trigger events. |
| C13 | primary record / inference | S12, S22, S28 | solid | PG versions and expression execution sites differ. |
| C14 | primary record | S15, S13 | solid | No proposed binder implementation validated. |
| C15 | primary record / inference | S17, S14, S16 | solid | Expansion is possible in principle, not implemented coverage. |
| C16 | primary record / inference | S18, S9, S22 | solid | Separate sequence and table effects. |
| C17 | primary record | S19, S21 | solid | Isolation and command boundaries. |
| C18 | primary record / inference | S20 | solid | Equality must reflect specified order/membership. |
| C19 | user material / inference | User scope; local checker proposal | solid | Required behavior, not externally verified guarantee. |
| C20 | user material / inference | User scope; S2 | solid | SQL-only scope cannot certify arbitrary code. |
| C21 | primary record | S27 | solid | Project documentation; tool not run. |
| C22 | scholarly finding | S23, S25 | solid | Oracles have distinct blind spots. |
| C23 | scholarly finding | S24 | solid | SQL fragment, unknown permitted. |
| C24 | inference | S4, S8; local oracle goal | plausible | Proposed two-sided test design, not implemented. |

## Sources

Each numbered record counts once toward the 28-source cap. Alternate formats of the same work do not count again. Full-paper inspection below means the relevant definitions, mechanisms, and limits were inspected, not that every proof was independently checked.

- <a id="s1"></a>**S1** — [Queries Independent of Updates](https://www.vldb.org/conf/1993/P171.PDF), Alon Levy and Yehoshua Sagiv, VLDB 1993. **Used for:** C1, C4. **Limit:** Full paper; Datalog, not PostgreSQL's full semantics.
- <a id="s2"></a>**S2** — [A Program Optimization for Automatic Database Result Caching](https://adam.chlipala.net/papers/SqlcachePOPL17/SqlcachePOPL17.pdf), Ziv Scully and Adam Chlipala, POPL 2017. **Used for:** C6, C20. **Limit:** Full paper; Ur/Web subset, compiler transformations not authorization to transform auth here.
- <a id="s3"></a>**S3** — [Abstract interpretation: a unified lattice model](https://www.di.ens.fr/~cousot/COUSOTpapers/POPL77.shtml), Patrick and Radhia Cousot, 1977 author record. **Used for:** C2, C4. **Limit:** Author summary; linked PDF failed.
- <a id="s4"></a>**S4** — [Provenance as Dependency Analysis](https://homepages.inf.ed.ac.uk/jcheney/publications/drafts/prov-dep-jv.pdf), James Cheney, Amal Ahmed, Umut Acar, journal draft of work originating in 2007. **Used for:** C3, C4, C24. **Limit:** Full draft; precise calculus and annotation semantics.
- <a id="s5"></a>**S5** — [Extending Abstract Interpretation to Dependency Analysis of Database Applications](https://iris.unive.it/handle/10278/3702278), semDDA paper, DOI 10.1109/TSE.2018.2861707. **Used for:** C5. **Limit:** Institutional abstract only; open-preprint download failed.
- <a id="s6"></a>**S6** — [Algorithm for Invalidation of Cached Results of Queries to a Single Table](https://arxiv.org/pdf/2310.15360), Jakub Łopuszański, 2023 arXiv record. **Used for:** C7. **Limit:** Full paper; restricted model and author deployment claims.
- <a id="s7"></a>**S7** — [The Case of Transparent Cache Invalidation in Web Applications](https://arxiv.org/pdf/2311.02384), Yunhong Ji, Xuan Zhou, Yongluan Zhou, Ke Wang, 2023 preprint. **Used for:** C8. **Limit:** Proposal and preliminary evaluation; no independent reproduction.
- <a id="s8"></a>**S8** — [CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html), PostgreSQL 18. **Used for:** C9, C24. **Limit:** Index contracts, not proof of extension implementations.
- <a id="s9"></a>**S9** — [Function Volatility Categories](https://www.postgresql.org/docs/18/xfunc-volatility.html), PostgreSQL 18. **Used for:** C10, C16. **Limit:** Contract and documented enforcement gaps.
- <a id="s10"></a>**S10** — [Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html), PostgreSQL 18. **Used for:** C11. **Limit:** Declarative effects; arbitrary routines in expressions require separate evidence.
- <a id="s11"></a>**S11** — [Overview of Trigger Behavior](https://www.postgresql.org/docs/18/trigger-definition.html), PostgreSQL 18. **Used for:** C12. **Limit:** Trigger invocation rules do not describe every trigger body's effects.
- <a id="s12"></a>**S12** — [Generated Columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html), PostgreSQL 18. **Used for:** C13. **Limit:** Distinguish stored/virtual and execution site.
- <a id="s13"></a>**S13** — [Dependency Tracking](https://www.postgresql.org/docs/18/ddl-depend.html), PostgreSQL 18. **Used for:** C14. **Limit:** Object dependencies are not complete data effects.
- <a id="s14"></a>**S14** — [Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), PostgreSQL 18. **Used for:** C15. **Limit:** Policies and request role matter; no auth transformation implied.
- <a id="s15"></a>**S15** — [Function Type Resolution](https://www.postgresql.org/docs/18/typeconv-func.html), PostgreSQL 18. **Used for:** C14. **Limit:** Read at build-time binding boundary; no runtime catalog proposal.
- <a id="s16"></a>**S16** — [Rules on INSERT, UPDATE, and DELETE](https://www.postgresql.org/docs/18/rules-update.html), PostgreSQL 18. **Used for:** C15. **Limit:** Rewrite rules need expansion or an explicit unknown result.
- <a id="s17"></a>**S17** — [CREATE VIEW](https://www.postgresql.org/docs/18/sql-createview.html), PostgreSQL 18. **Used for:** C15. **Limit:** Views and updatable views have distinct read/write behavior.
- <a id="s18"></a>**S18** — [Sequence Manipulation Functions](https://www.postgresql.org/docs/18/functions-sequence.html), PostgreSQL 18. **Used for:** C16. **Limit:** Nontransactional sequence state is distinct from application rows.
- <a id="s19"></a>**S19** — [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html), PostgreSQL 18. **Used for:** C17. **Limit:** Does not prove the browser's response-acceptance protocol.
- <a id="s20"></a>**S20** — [LIMIT and OFFSET](https://www.postgresql.org/docs/18/queries-limit.html), PostgreSQL 18. **Used for:** C18. **Limit:** Underordering creates permitted nondeterminism.
- <a id="s21"></a>**S21** — [WITH Queries](https://www.postgresql.org/docs/18/queries-with.html), PostgreSQL 18. **Used for:** C17. **Limit:** DML CTE behavior differs from a subsequent statement.
- <a id="s22"></a>**S22** — [INSERT](https://www.postgresql.org/docs/18/sql-insert.html), PostgreSQL 18. **Used for:** C13, C16. **Limit:** Actual effects include selected defaults and conflict actions.
- <a id="s23"></a>**S23** — [Testing Database Engines via Pivoted Query Synthesis](https://www.usenix.org/system/files/osdi20-rigger.pdf), Manuel Rigger and Zhendong Su, OSDI 2020. **Used for:** C22. **Limit:** Full paper; containment oracle is not complete-result equality.
- <a id="s24"></a>**S24** — [Cosette: An Automated Prover for SQL](https://www.cs.cmu.edu/~15811/papers/db.pdf), Shumo Chu, Chenglong Wang, Konstantin Weitz, Alvin Cheung, CIDR 2017. **Used for:** C23. **Limit:** Full paper; fragment-specific solver, not production PG effect checker.
- <a id="s25"></a>**S25** — [Detecting Optimization Bugs via Non-Optimizing Reference Engine Construction](https://www.manuelrigger.at/preprints/NoREC.pdf), Manuel Rigger and Zhendong Su, ESEC/FSE 2020. **Used for:** C22. **Limit:** Full paper; metamorphic oracle with restricted transformations.
- <a id="s26"></a>**S26** — [Transactional Consistency and Automatic Management in an Application Data Cache](https://drkp.net/papers/txcache-osdi10.pdf), Dan Ports and colleagues, OSDI 2010. **Used for:** C8. **Limit:** Full paper; modified DBMS, different freshness contract.
- <a id="s27"></a>**S27** — [SQLsmith](https://github.com/anse1/sqlsmith), project documentation, inspected 2026-09-14. **Used for:** C21. **Limit:** Documentation only; repository not built or run.
- <a id="s28"></a>**S28** — [Generated Columns](https://www.postgresql.org/docs/17/ddl-generated-columns.html), PostgreSQL 17. **Used for:** C13, version comparison. **Limit:** Only stored generated columns in this version.

## Search and control record

- **Search routes:** Web search for query/update independence and irrelevant updates; author/VLDB paper follow-through; abstract interpretation and database dependency analysis; provenance dependency-correctness; automatic cache invalidation and TxCache; PostgreSQL documentation by named execution mechanism; Cosette and SQLancer/NoREC/SQLsmith primary records. Definitions, worked cases, and limitations were searched within full papers. The preceding algebra survey was a lead list only.
- **Prominence counter-search:** Sought the narrower single-table counter scheme and semDDA alongside the better-known provenance/SQL solver work; followed author and institutional repositories beyond top results. Included Chinese/European-authored invalidation work available in English. Secondary AI summaries, Reddit, and vendor summaries were excluded as technical evidence. This does not remove English/publication bias.
- **Contrary-evidence search:** Tested the candidate shortcuts against STABLE functions reading other tables, incomplete catalog dependencies, trigger execution on zero-row writes, FK direction, underordered limits, sequence effects surviving rollback, and DML CTE snapshot behavior. Searched the cache papers for SQL-subset and deployment restrictions, and oracle papers for blind spots. These passes added real boundaries, rather than supplying two empty search passes.
- **Source-class coverage:** Original research/preprints, official PostgreSQL contracts, author summaries, institutional abstracts, and a generator's own documentation. No secondary source supplies a technical conclusion. User/local evidence is labeled separately.
- **Recency check:** Foundational dates are separated from web crawl dates. PG17 and PG18 generated-column behavior was compared directly. The cutoff is 2026-09-14; this is not a survey of every publication through that date.
- **Saturation check:** Stopped at the declared 28 substantive source-record cap. The last additions covered oracle limits, generator behavior, and PG17/18 differences. The cap fired; thematic saturation was not demonstrated. Further testing and effect-analysis literature remains unsearched.

## Limits and unmeasured

The main artifact risk is treating these complementary models as one already-proven PostgreSQL calculus. No inspected work supplies that whole calculus. Each transfer into our checker remains a rule with explicit premises and a test obligation.

No complete catalog of extension behavior, custom access methods, casts, collations, FDWs, large objects, DDL, procedural-language bodies, temporal constraints, or all partition interactions was assembled. Ordinary native types and pure scalar expressions are not thereby disproven; their binding/effect treatment still needs design and implementation. Build/runtime schema agreement is a premise to define, not a runtime schema polling requirement.

No formal proof assistant, new SQL test harness, benchmark, or independent replication ran. Existing Kitchen and generated oracle results were not rerun and are not evidence of complete PostgreSQL support. PostgreSQL/PGlite is a useful reference for Endpoints behavior but can share database bugs with the SUT; distinct metamorphic oracles address a different layer.

The survey supports a bounded map of mechanisms, source contracts, and open premises. It does not certify an implementation, select an optimization, or establish complete SQL coverage.

## Handoff index

- **Checker target and explanations:** C1–C6, C23 distinguish conditional proof, precision loss, counterexample, and unknown.
- **Operation rules:** C9–C17 identify execution-specific facts and negative controls.
- **Browser and scope constraints:** C18–C20 preserve equality, authority, SQL-only analysis, and external-freshness boundaries.
- **Test design inputs:** C21–C24 separate input breadth, row oracles, and independent precision assertions.
- **Open design premise:** Whether documented SQL-function contracts may be trusted without body analysis. The survey does not choose it.

The selected Design Grammar is separate work. This index supplies evidence; it does not confer a proof or expand implementation scope.
