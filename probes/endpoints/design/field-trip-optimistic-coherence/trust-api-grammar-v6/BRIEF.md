# TanStack Trust API Design Grammar v6

## What this tells us

TanStack Trust should be a protocol runtime around domain compilers, not a
linter engine with a larger rule callback.

A domain compiler already knows useful things. A PostgreSQL adapter can identify
queries and mutations, their statements, schema dependencies, read/write
effects, source locations and the places where analysis is unknown. Endpoints
can relate its queries, mutations and refresh decisions to those PostgreSQL
operations, add collection authority and publish its own static check results.
Trust should preserve and connect that structured output.

The resulting language has four central moves:

1. A **protocol** defines stable subjects, relationships, facts, evidence
   contracts and requirement templates for one domain.
2. A compiler or adapter publishes what it currently knows, including explicit
   uncertainty. An evidence method publishes an immutable, attributable result.
3. A **requirement** says what must be established. Trust separately decides
   whether available evidence is strong enough and whether it still applies.
4. Conditions expose what remains. Policy decides whether those conditions
   warn, block or permit a bounded exception.

This keeps the valuable linter properties—installable packages, local checks,
deterministic configuration, source diagnostics and test harnesses—without
making “a callback returned no errors” the model of trust.

## What it changes

- **Endpoints becomes a consumer and extension of PostgreSQL knowledge.** It
  links its subjects to PostgreSQL operations rather than copying their facts or
  evidence. Its compiler can publish `safe-skip-refetch` evidence directly from
  the real decision path.
- **Evidence providers become independently composable.** Neon could implement
  a PostgreSQL execution-profile contract, run an authorized query thirty times
  with declared predicates, and return attested statistics. A project—not Neon
  or Trust—can require p99 below one second, thirty samples and seven-day
  freshness.
- **Ordinary authoring gets much smaller.** A check author specifies a typed
  subject, dependencies, result schema and interpretation. Claims, premises and
  alternate proof routes remain the inspectable lowered form for advanced
  cases, not mandatory ceremony. Source annotations lower into the same
  inspectable configuration and may add or tighten requirements, not weaken
  global ones. Agents may propose new proof routes, but cannot admit their own
  proposals.
- **Agents receive a work surface, not prose-only diagnostics.** The same
  operation registry powers TypeScript, LSP, MCP, CLI and Devtools. Diagnostics
  include the affected subject, requirement source, current evidence, exact
  missing evidence, staleness causes, limits, legal actions, authority boundary
  and snapshot. Bead-style todos let agents discover, claim and hand off work;
  closing a todo never counts as evidence.

## Concrete cases

For the implemented Endpoints check, complete disjoint effects plus current
collection authority support skipping a refetch. Overlap contradicts it.
Unknown writes or different build artifacts remain unresolved. This behavior
fits the grammar as PostgreSQL facts, Endpoints relations, compiler-produced
evidence and a separate policy decision.

For production latency, a new query can open an `evidence required` condition.
The LSP points an agent to the Neon method; MCP supplies the bounded run plan;
submission creates evidence; qualification checks both the measured p99 and
whether the SQL, schema, environment and freshness still match. A daily agent
can later query expired-evidence todos and renew them.

For an emergency deployment, a scoped expiring override changes only the CI or
deployment action. The unmet requirement and its evidence history remain
visible. Raising the global check level uses a read-only config preview that
shows new requirements, reusable evidence and new todos without mutating live
state.

## What it does not tell us

The current prototype implements one Endpoints check, a finite evidence kernel
and shared local interfaces; all 21 tests, eight hostile controls and typecheck
still pass. It does not implement the proposed standalone PostgreSQL protocol,
additional SQL-library adapters, Neon execution, production authority,
multi-writer storage or hostile extension isolation.

Range is untested because PostgreSQL and Neon helped form this grammar and no
independent second domain exists. Typed protocols also cannot establish the
soundness of an analyzer, the honesty of a provider or the legitimacy of a
requirement. The extraction may make future proof discovery look cleaner and
more compiler-shaped than practice will be.
