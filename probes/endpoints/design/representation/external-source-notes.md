# Representation survey: external source track

Frozen: 2026-09-11. English. Broad but bounded source track for the question and exclusions in [survey-brief.md](./survey-brief.md). This is source input to the parent Research Survey, not an architecture choice or implementation proposal. Four external primary pages were opened; two targeted limitation searches ran. No production code changed.

## Coverage frame

| Cell | Status | Source or boundary |
| --- | --- | --- |
| Returned mutation rows and before/after values | Supported for PostgreSQL 18 | E1 |
| Effects beyond the target row; timing and observation | Supported for PostgreSQL 18 | E2 |
| Duplicate counts, ordering, and bounded result windows | Supported for PostgreSQL 18 | E3 |
| NULL and predicate truth | Supported for PostgreSQL 18 | E3, E4 |
| Drizzle runtime representation and decoder limits | Thin; search leads only | L1, L2 below; local track owns installed source inspection |
| General SQL equivalence, incremental delta calculus, proof of unsupported analysis | Unsearched | No formal theorem or completeness claim |
| Installed database/version and wire equivalence | Unmeasured | These pages do not establish local runtime behavior |

## Inspected sources and typed evidence

The four evidence paragraphs below each contain fewer than 100 words. Links are version-pinned; retrieved 2026-09-11. They are official product documentation from the PostgreSQL Global Development Group, not measurements or independent studies. No direct quotations are used.

### E1 — Returned rows

Source: [PostgreSQL 18, 6.4 Returning Data from Modified Rows](https://www.postgresql.org/docs/18/dml-returning.html).

Inspected: full section; target-table projection, INSERT/UPDATE/DELETE defaults, MERGE, explicit old/new content, trigger-modified returned values (browser lines 20–57).

**Primary documentation evidence:** `RETURNING` projects target-row columns or expressions; `*` selects target columns. INSERT normally yields inserted content, UPDATE new content, DELETE deleted content. PostgreSQL 18 permits explicit old/new row values. MERGE exposes source and affected target content. Returned row values can include trigger modifications.

**Limit:** Version-specific feature evidence; no claim that the installed engine or Drizzle exposes every documented feature. The section does not specify a global mutation-effects log.

### E2 — Effects and timing

Source: [PostgreSQL 18, 37.1 Overview of Trigger Behavior](https://www.postgresql.org/docs/18/trigger-definition.html).

Inspected: full section; zero-row statements and statement triggers, deferred constraint triggers, BEFORE suppression/modification, propagation/cascades, foreign-key actions, transition tables (browser lines 20–68).

**Primary documentation evidence:** Statement triggers run even when no rows are affected. BEFORE triggers can suppress or alter a row operation. AFTER triggers can update other tables; trigger SQL can cascade. Foreign-key referential actions issue ordinary UPDATE/DELETE commands and can fire triggers. Constraint AFTER triggers can defer until transaction end. Trigger effects share the originating transaction. Transition tables expose affected-row sets to requesting AFTER triggers.

**Limit:** Transition tables are a database mechanism, not evidence of an existing Endpoints observation channel. Their presence alone does not establish complete observation across relations and transaction timing.

### E3 — Result semantics

Source: [PostgreSQL 18, SELECT](https://www.postgresql.org/docs/18/sql-select.html).

Inspected: Description steps 3–9, WHERE clause, DISTINCT/UNION summary, EXCEPT ALL, ORDER BY, LIMIT, and WITH's side-effect-free restriction (browser lines 75–109, 194–201, 337–384).

**Primary documentation evidence:** SELECT ALL preserves duplicates; DISTINCT removes them. WHERE retains rows only when its predicate is true. EXCEPT ALL subtracts multiplicities with a zero floor. Without ORDER BY, order is unspecified; ties across every sort expression still have implementation-dependent order. Deterministic LIMIT subsets require a unique order. Default null placement depends on ascending versus descending order. NOT MATERIALIZED does not apply to recursive or non-side-effect-free WITH queries.

**Limit:** These are SQL engine semantics, not proof that any JavaScript evaluator or collection representation matches them.

### E4 — NULL comparison

Source: [PostgreSQL 18, 9.2 Comparison Functions and Operators](https://www.postgresql.org/docs/18/functions-comparison.html).

Inspected: comparison predicates table, ordinary NULL comparisons, IS DISTINCT FROM and IS NOT DISTINCT FROM, Boolean IS tests (browser lines 44–60, 76–115).

**Primary documentation evidence:** Ordinary comparisons with a NULL input yield NULL, the unknown truth value. IS DISTINCT FROM and IS NOT DISTINCT FROM instead produce Boolean results with defined NULL equality behavior. IS TRUE/FALSE/UNKNOWN tests also produce true or false for NULL inputs.

**Limit:** This section does not specify JavaScript missing properties, wire omission, codecs, or all SQL type/collation rules.

## Inference ledger

These are bounded model inferences, not additional primary-source claims or architecture decisions.

| ID | Inference | Basis | Limit |
| --- | --- | --- | --- |
| I1 | A target-row RETURNING payload does not by itself certify the complete effect set. An empty payload is not sufficient proof of no effects. | E1 + E2 | A system with stronger explicit restrictions or observation could establish more; not examined here. |
| I2 | SQL dependency or result reasoning needs an explicit semantic domain for NULL, multiplicity, and ordering. A generic value/array shape alone is not evidence of equivalence. | E3 + E4 | No local mismatch asserted. |
| I3 | An authority claim can depend on when effects are observed, including deferred work. | E2 | No transaction protocol selected or tested. |
| I4 | SQL unknown truth and analyzer inability to prove a proposition are different concepts. | E4 + frozen brief | Analyzer-unknown behavior comes from the user constraint, not a theorem established by this survey. |

**User-supplied constraint, not a research finding:** Unsupported analysis excludes dependent optimizations; authoritative fallback evaluates full results and returns them with the mutation. Optimism is a guess using transaction overlays. No subscriber pruning.

## Search routes and contrary controls

Index: available `web.run` search. No date filter; selected evidence pinned to PostgreSQL 18 with a 2026-09-11 retrieval cutoff. Snippets and unvisited pages were treated only as leads.

1. Initial coverage queries, issued together:
   - `site.postgresql.org/docs/current dml returning triggers other tables side effects`
   - `site.postgresql.org/docs/current SELECT DISTINCT ORDER BY LIMIT NULL comparison unknown duplicates`
   Results led to the official returning, trigger, SELECT, and comparison pages. Direct version-pinned opens of those four pages established the source set.
2. Limitation pass 1, reversing “empty returned rows means no effects”:
   - `site.postgresql.org/docs/18/trigger-definition.html "zero rows" "other tables" RETURNING complete effects`
   It returned E2 and older/mirrored copies. E2's directly inspected statement-trigger and cross-table clauses supply the boundary. Mirrors, forums, and older copies were not opened or counted as corroboration.
3. Limitation pass 2, outside the PostgreSQL publisher, challenging type-level sufficiency:
   - `site:orm.drizzle.team sql type generic runtime mapping unsupported SQL null order semantics`
   Leads: L1 [Magic sql operator](https://orm.drizzle.team/docs/sql), sections `sql<T>` and `.mapWith()`; L2 [Count rows](https://orm.drizzle.team/docs/guides/count-rows), generic type warning. These pages were **not opened** because four primary pages were already inspected. They are follow-up pointers, not evidence used in the claim ledger.

## Coverage audit and stop

Stop condition: the explicit four-page source budget and two limitation-pass budget were reached. This is **not saturation**. The second limitation pass supplied an unresolved decoder/type lead. No source-access failures or paywalls occurred among the four selected pages. Search returned irrelevant and secondary material; none supports a claim here.

The evidence is concentrated in one vendor and one documentation version. The outside-publisher search did not become inspected evidence. No disagreement between inspected pages was found; this is not a consensus claim. The main boundary tension is between useful target-row observations and a broader effect set, not a documented source dispute.

Chief artifact risk: these precise PostgreSQL semantics could be mistaken for proof that the installed Drizzle dialect, local analyzer, serialization, and collection materialization preserve them. They do not establish that. Remaining work includes local adapter contracts, codecs and custom SQL, effects-coverage restrictions, transaction observation, delta correctness, other SQL dialects, and a formal treatment of bounded analysis. No production performance, distributed protocol, or arbitrary-SQL equivalence claim was investigated.

## Handoff index

- RETURNING/effect coverage: E1, E2, I1.
- SQL evaluator/result assumptions: E3, E4, I2.
- Authority observation boundary: E2, I3.
- Unsupported analyzer state versus SQL truth: I4 and the frozen user constraint.
- Follow-up source pointers only: L1, L2.
