# Check effects for each operation

The proposed checker has three distinct jobs: describe what the SQL can read or
write, decide whether those effects can change a particular query, and preserve
the browser's remaining need for authoritative data. A whole-table “safe” flag
cannot express those distinctions.

The grammar reconstructs this proposal with four pieces: a bound SQL operation,
its effect summary, a judgment for a named optimization, and the collection's
authority state. Binding matters because a familiar function name can refer to
a different overload. The summary describes possible effects, not the computed
value or the exact rows changed.

This changes the treatment of three concrete cases:

- A tag mutation with a pure `lower(name)` index still writes tags. Index
  maintenance does not by itself turn the write into an unknown effect on every
  other table. A default or trigger also matters only at an event that can invoke
  it; its mere presence cannot disqualify a stored-row read.
- A PostgreSQL function that reads permissions contributes that dependency even
  if declared `STABLE`. We analyze user-defined bodies and their calls. Conversely,
  a function declared `VOLATILE` that only computes a scalar need not acquire an
  imaginary table write. An unresolved body or dynamic SQL keeps a specific
  unknown effect, rather than an empty summary.
- A server mutation can be independent of a query while an optimistic edit has
  changed that query's client collection incorrectly. The SQL proof cannot cancel
  authoritative reconciliation. The same applies to missing baselines and
  outstanding stale-response repair.

Effects compose through a graph: a parent delete can cause a foreign-key action,
which causes a child trigger, which writes an audit table. Following that graph
requires operation-specific edges and function-body analysis. Shared reads alone
do not create a write conflict.

The grammar supports two adjacent forms. Table-level summaries can establish
disjointness while accepting same-table false positives. A later column/predicate
refinement can prove more independence, but needs additional SQL semantics and
old/new membership reasoning. These are refinements, not configuration options;
neither supplies an exact-patch proof.

Tests need two independent verdicts. Database results can expose missed effects.
Expected-refetch laws must also expose needless restrictions: always refetching
can pass every final-row check. Both assertions need independent expected logic
and mutants that demonstrate they fail in the intended direction.

This run reconstructs a **proposed design**, not a proven implementation. Controls
were analytical; no new SQL execution or benchmark ran. Kitchen was a source
case, so it cannot count as independent range evidence. Range remains untested.
The concrete binder, supported routine languages, native operation summaries,
and build/deployment agreement still need implementation. Table summaries lose
row, column, path, and order detail; that loss limits which claims they support.

Your boundaries remain intact: schema and routine inspection happens at compile
time; no database tracking machinery or compiler-generated auth is introduced.
Application code, validation, transaction boundaries, and order stay unchanged.
General Node.js/helper analysis and manual extra-refresh APIs remain deferred.
Visible-SQL evidence does not claim whole-handler purity. Every retained
collection remains a candidate, and external freshness stays with polling,
events, or a sync engine. Ordinary refetch remains the fallback; this model does
not promise recovery while the backend keeps failing.

[Model](MODEL.md) · [Evidence and controls](EVIDENCE.md) · [Process](PROCESS.md) ·
[Preservation contract](PRESERVATION.md) · [Frozen state](frozen-analysis.json)
