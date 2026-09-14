---
instrument: research-survey
title: "Representing Endpoints effects and reads"
question: "Which existing representations can describe dependencies, guessed effects, and authoritative updates without treating unsupported analysis as proof?"
scope: "Local TanStack DB and Endpoints plus four PostgreSQL 18 documentation pages; English"
intended_use: "Exploratory representation grammar, then an authorized executable draft"
depth: broad
researched_at: 2026-09-11
source_cutoff: 2026-09-11
status: complete
---

# Representing Endpoints effects and reads

## Survey brief

The [frozen brief](./survey-brief.md) sets the exact question, source budget, exclusions, and user constraints. Included: installed query expressions, transaction and adapter boundaries, current compiler, and bounded SQL effect semantics. Excluded: core materialization redesign, arbitrary SQL equivalence, distributed protocols, and production performance. Starting sources were the local implementation and prior Field Log. English only; no access failures among selected sources.

## Orientation

The local system already has three distinct representations: authored server handlers, DB query expressions, and captured optimistic row mutations. The current compiler connects handlers to client ordering but does not describe dependencies or cross-collection effects. PostgreSQL documents useful returned-row observations alongside effects that exceed those observations. These are different evidence channels, not interchangeable descriptions of one complete mutation.

## Terms and distinctions

- **Query expression:** an operator tree. The local IR also contains runtime collection references and optional callbacks, so the entire IR is not a portable wire value. [S1](#s1)
- **Guessed row effect:** the original/modified row captured by a client transaction; it describes client intent, not the server's actual branch. [S2](#s2)
- **Returned row:** a projection of rows from the mutation target. It is not a documented global effects log. [S4](#s4)
- **Unknown analysis:** absence of proof for an optimization, distinct from SQL's NULL truth value. The former fallback rule is user material; the latter is documented SQL behavior. [S5](#s5)

## Evidence landscape

### Local representations and boundaries

- **C1 — DB has reusable expression evaluation but its full query IR includes runtime objects.** `QueryIR`, `CollectionRef`, callbacks, `PropRef`, `Value`, and `Func` establish this directly. Public `compileSingleRowExpression` and `toBooleanPredicate` provide a reusable bounded evaluator. This does not establish codec or collation equivalence for every SQL type. [S1](#s1)
- **C2 — Existing transactions own optimistic snapshots and persistence settlement.** Whole-row snapshots must not be field-merged with later synced rows. Mutation persistence must not start or await preload. Query Collection's manual `writeBatch` uses immediate sync and validates against synced data. This is a usable adapter boundary, not proof of atomic multi-collection publication. [S2](#s2)
- **C3 — The bound compiler currently proves only a narrow query shape and emits order fields.** Its extractor accepts one trusted Todo relation and auth predicate; current runtime refetches direct mutation targets. That leaves cross-query propagation and recipient analysis absent. The separate old catalog checker is not called by the bound transform. [S3](#s3)

### Database evidence

- **C4 — Returned target rows cannot alone certify complete effects.** PostgreSQL documents triggers on zero-row statements, cross-table writes, cascades, and deferred work. Inferring “no effects” from an empty returned payload lacks support. [S4](#s4)
- **C5 — Result reasoning must retain SQL truth, multiplicity, and ordering semantics.** NULL comparisons can yield unknown; WHERE accepts true only. SELECT ALL retains duplicates and deterministic LIMIT requires a unique order. These facts do not prove local wire/evaluator equivalence. [S5](#s5)

## Positions and mechanisms

Unranked mechanisms visible in these sources are: compile a restricted description into existing DB expressions; capture client row guesses through normal transactions; publish authoritative rows through adapter manual writes; obtain target rows with RETURNING; rerun server queries for authoritative results. Each has a different support boundary. The last fallback is a user requirement, not a finding that it is cheapest.

## Disputes and conflicting evidence

No material conflict was found within the stated routes and scope. This is a bounded search result, not evidence of consensus. The useful limiting contrast is target-row observation versus transaction-wide effects. Installed-version support for PostgreSQL 18 old/new RETURNING and complete trigger observation remain unresolved.

## Cases and timeline

This is a 2026-09-11 local snapshot and version-pinned documentation survey. Historical evolution is outside its question. Existing top-k, multi-table, and result-sharing probes are input boundaries, not new range evidence.

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| DB query and transaction representations | supported | S1, S2 | No whole-IR wire contract |
| Endpoints compiler and runtime | supported | S3 | Narrow Todo extraction |
| SQL returned rows/effect coverage | supported | S4 | No installed complete-effects observer |
| SQL truth/bag/order | supported | S5 | Type, codec, collation equivalence unproved |
| Drizzle decoder guarantees | thin | External notes leads | Leads not opened |
| General delta calculus and SQL equivalence | unsearched | None | No completeness claim |

## Claim-to-source ledger

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | primary record | S1 | solid | Inspected local definitions only |
| C2 | primary record | S2 | solid | No new runtime experiment |
| C3 | primary record | S3 | solid | Current probe, not future framework |
| C4 | inference | S4 | solid | Stronger restrictions could prove more |
| C5 | primary record | S5 | solid | SQL semantics, not local equivalence |

## Sources

### Primary and official

- <a id="s1"></a>**S1** — Local [IR](../../../../packages/db/src/query/ir.ts), public query/compiler exports, expression evaluators. Used for C1. Inspected definitions and evaluator entry points; not every operator implementation.
- <a id="s2"></a>**S2** — Local DB live-query ARCHITECTURE.md (read in full), mutation/query skills, Query Collection manual-sync.ts (read in full). Used for C2. Normative contracts and source, not benchmark evidence.
- <a id="s3"></a>**S3** — Local integrated-todo runtime.ts, bound-transform.mjs, transform.mjs, and track-a-analysis/probe.mjs (read in full). Used for C3. Existing prototype only.
- <a id="s4"></a>**S4** — PostgreSQL Global Development Group, PostgreSQL 18 [RETURNING](https://www.postgresql.org/docs/18/dml-returning.html) and [trigger behavior](https://www.postgresql.org/docs/18/trigger-definition.html). Used for C4; version-specific documentation.
- <a id="s5"></a>**S5** — PostgreSQL Global Development Group, PostgreSQL 18 [SELECT](https://www.postgresql.org/docs/18/sql-select.html) and [comparison operators](https://www.postgresql.org/docs/18/functions-comparison.html). Used for C5; inspected sections listed in external notes.

### Scholarly and technical

No additional scholarly source inspected in this bounded pass. Prior Field Log surveys remain separate evidence.

### Field, critical, and secondary

User requirements supply optimism/authority and retention rules. No secondary source used as factual support.

## Search and control record

- **Search routes:** local definitions/call sites and four official pages; exact queries, sections and leads are in [external source notes](./external-source-notes.md).
- **Prominence counter-search:** an outside-publisher Drizzle limitation search returned decoder/type leads; the budget prevented opening them. This leaves publisher concentration explicit.
- **Contrary-evidence search:** reversed empty RETURNING ⇒ no effects, and challenged type declarations ⇒ runtime equivalence. The former found documented limits; the latter remains a lead.
- **Source-class coverage:** local implementation and official database documentation; no new scholarly or production report.
- **Recency check:** local files as inspected today; external evidence pinned to PostgreSQL 18, not assumed installed-version parity.
- **Saturation check:** stopped at four external pages and two limitation passes. Budget stop, not saturation.

## Limits and unmeasured

Main artifact risk: mistaking a reusable evaluator and precise SQL documentation for proven end-to-end semantics. Unmeasured: installed codecs/collations, arbitrary SQL, all trigger effects, concurrency, and production cost. This maps a bounded representation boundary; it neither selects an architecture nor claims complete prior-work coverage.

## Handoff index

C1–C3 support local representation extraction. C4 bounds effect claims. C5 bounds predicates and result identity. Source gaps remain inputs to later work, not permission to assume equivalence.
