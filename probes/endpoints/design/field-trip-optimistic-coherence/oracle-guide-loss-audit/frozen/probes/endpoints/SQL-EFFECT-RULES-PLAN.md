# Deterministic checks for SQL optimization rules

Status: proposed replacement for ad hoc support restrictions, now grounded by the
[Research Survey](SQL-EFFECTS-SURVEY.md) and
[Design Grammar](design/field-trip-optimistic-coherence/sql-effects-grammar/BRIEF.md).
The instruments completed on 2026-09-14; the new checker is not implemented.
The Kitchen port
exposed a design error in the prototype: table-wide `readable` / `writable`
booleans mix dependency discovery with expression evaluation and other, stronger
proof obligations. Passing the current oracle does not justify that design.

## Check a named claim

The first tool should answer `canSkipRefetch(query, mutation, schema)`, with a
machine-readable derivation. It should not answer whether a whole query, type,
table, or database is generically "safe".

Inputs: SQL ASTs, bound relation identities, a build-time schema snapshot, and
explicit assumptions about PostgreSQL/application contracts. Outputs: inferred
read and write sets, the rules used, and unresolved effects with source locations.
Keep `known`, `unknown`, and `not relevant to this claim` distinct.

No runtime catalogs, query execution to discover schema, auth insertion, new
PostgreSQL objects, or inspection of arbitrary JS libraries. Existing helper
analysis is experimental and not a prerequisite for this tool.

## Initial calculus

- A base relation contributes its bound database/schema/table identity.
- Selection and projection retain the input dependencies and add dependencies
  from scalar subqueries or functions that read tables.
- Joins and set operations union their inputs and expression dependencies.
- Grouping, ordering, limits, and offsets do not remove table dependencies.
- A scalar operation such as `lower(column)` adds no relation beyond its input.
- INSERT, UPDATE, DELETE, and MERGE contribute their possible target relations.
  Read dependencies in a predicate do not automatically become write targets.
- Data-modifying CTEs contribute their own writes. CTE names are scoped bindings,
  not physical relation identities.
- FK actions add affected tables through a fixed-point closure of actions.
- Triggers/rules/functions that can add table effects require an effect summary;
  an unresolved effect is reported at that operation.
- Indexes implement access and uniqueness. Their presence, expression syntax,
  or physical method is not itself a new application-table dependency.

For table-driven freshness, disjoint known read and write sets permit pruning.
Optimistic recipients and missing baselines still require an authoritative read.
This rule does not predict the mutation result or reproduce uniqueness checking.
A rejected transaction, partial commits outside transactions, and reconciliation
are checked through actual execution and the runtime's existing authority rules.

Analyze PostgreSQL function bodies and their calls at compilation time. Kyle
explicitly selected this over accepting declarations alone as effect evidence.
A user-defined IMMUTABLE/STABLE label cannot erase a body read or write. A
VOLATILE function whose analyzed body only computes a scalar need not acquire
an imaginary table write. Use resolved routine identities, including routines
invoked by operators, casts, and applicable schema expressions. Native routines
need explicit semantic evidence; arbitrary extension behavior is not established
by its name or namespace. Unsupported bodies or dynamic SQL yield a specific
unknown effect, not an empty set. General JavaScript/helper analysis stays deferred.

Function volatility, hidden table reads, result repeatability, and external
freshness must not be collapsed into one "pure" boolean. Evidence remains scoped
to the analyzed SQL and matching schema/binding environment; it does not claim
whole-handler purity.

## Separate claims

| Claim | Required analysis |
| --- | --- |
| Skip an unrelated collection's refetch | Table dependencies, mutation effects, authority obligations |
| Evaluate an optimistic query on the client | Operator/type semantics and available data |
| Return a row patch | Membership, ordering, limits, aggregates, and sufficient before/after information |
| Reuse a previously computed result | Relevant database changes, scope, and non-table inputs |

A limitation in one row cannot silently disable the other rows.

## Executable laws before broadening implementation

Extend the existing generated PostgreSQL oracle with metamorphic pairs:

1. Add/remove ordinary, unique, expression, and partial indexes: application-table
   read/write dependencies are unchanged under the declared SQL contracts.
2. Add pure scalar projection, cast, enum, JSON, ordering, or aggregation: retain
   the same input relation dependencies; do not require client-side evaluation.
3. Add a scalar subquery/join: union in its relation dependencies.
4. Add a cascading FK: grow the appropriate write closure; unrelated tables stay
   out. Include update vs delete vs set-null/set-default distinctions.
5. Add a genuinely unresolved database effect: identify that effect and fall back
   for the affected claim, without marking unrelated schema objects unsafe.
6. Generate optimistic recipients outside the actual write set and cold retained
   collections: they still receive authority.
7. Remove a dependency from the analyzer as a mutant: the same oracle must fail.
8. Add a gratuitous support restriction as a mutant: equivalent-schema pairs
   must fail the expected-pruning assertion, even when all final values agree.
9. Generate PostgreSQL function bodies with hidden reads, nested calls, writes,
   and pure scalar expressions. Vary volatility declarations independently where
   PostgreSQL permits them. Effects must follow the body, not the label. Include
   unparsed/dynamic bodies and ensure unknowns cannot silently become no effects.

Compare bags and promised ordering, not arbitrary physical row order. Adding an
index should preserve a logical relation footprint; it need not produce the same
members for an underordered LIMIT. Such cases need a permitted-outcome oracle or
an explicit deterministic-order constraint in the generator.

The rule engine and SQL generator must not share the code that decides expected
correctness. PostgreSQL execution supplies rows; independent relational laws
supply expected dependency relationships. Save failing seeds and shrink paths.

## Grounding

PostgreSQL requires immutable functions/operators in index definitions and
forbids subqueries and aggregates there:
https://www.postgresql.org/docs/current/sql-createindex.html

Its volatility categories describe contracts to the optimizer. STABLE functions
can read other tables, and volatility is not a complete dependency description:
https://www.postgresql.org/docs/current/xfunc-volatility.html

## Implementation sequence after the design

1. Build the small effect/independence rule kernel with derivation output. Keep
   known reads/writes, unknown effects, and result/context premises separate.
   Test the frame law and authority gate independently; both omitted-effect and
   needless-fallback mutants must fail.
2. Supply its facts from compile-time SQL bindings, schema actions, and PG routine
   bodies. Compose direct calls and event-specific implicit calls to a fixed point.
   Record unsupported syntax/languages at the responsible operation. The concrete
   binder and initial body-language coverage are still implementation questions;
   the grammar does not prove them solved.
3. Extend the existing PostgreSQL oracle with the schema/function metamorphic
   pairs above, preserving independent expected results and skip assertions.
   Replace table-wide eligibility in the supported paths, then rerun Kitchen's
   compiled paths, browser authority checks, and client/server bundle boundary.
4. Feed broader PostgreSQL generation through the same checker and oracle. Track
   supported, unknown, invalid-input, and proved-independent cases separately so
   more generated failures or fallbacks cannot masquerade as better coverage.

No new optimization option is needed. No compiler auth changes or runtime schema
queries are authorized by these analyses. Do not respond to each new SQL feature
by adding another table-wide ban or a one-off function-name exception.
