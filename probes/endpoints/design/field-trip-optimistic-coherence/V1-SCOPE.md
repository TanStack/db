# Endpoints v1 scope

Confirmed by Kyle after the code-guarantee grammar discussion.

- Analyze raw SQL and supported schema information to infer read/write dependencies and SQL-side effects.
- Use those dependencies to select retained collections for refresh. Preserve authority requirements for optimistic recipients and missing baselines.
- Explicit additional refresh requirements are deferred by Kyle. No manual-refresh API is part of this implementation step.
- Explain supported assumptions and analysis limits through diagnostics. Do not make exhaustive analysis of hypothetical library effects a prerequisite for this version.
- Keep schema inspection at compilation, server code outside client bundles, and application PostgreSQL free of added tracking infrastructure. External freshness remains the application's polling/event/sync concern.
- Application code owns auth and execution order. No compiler auth insertion or restructuring.

Following JavaScript helper calls and understanding auth/common libraries are future work. The existing experimental helper analyzer is not a prerequisite for v1, and this scope decision does not remove it from the prototype. PostgreSQL functions are a separate case: Kyle explicitly included analysis of their bodies and calls in the SQL effect design. User-defined volatility declarations alone do not certify their effects; unsupported bodies and dynamic SQL remain explicit unknowns.

Tests extend the generated SQL/PGlite oracle to cover inferred refresh targets. Kitchen SQL is moved into endpoint handlers by an explicit application source refactor. AI/Trello work remains in helpers without database access. The compiler does not move auth or synthesize auth checks.

Kyle subsequently rejected ad hoc schema restrictions (notably expression-index bans). The Research Survey and Design Grammar for a deterministic, claim-specific SQL effect calculus are complete; see [the implementation sequence](../../SQL-EFFECT-RULES-PLAN.md), [survey](../../SQL-EFFECTS-SURVEY.md), and [grammar](sql-effects-grammar/BRIEF.md). The new checker and two-sided oracle laws remain to implement. Kitchen's inline SQL port is verified; broad PostgreSQL generation remains a later step.

Prior auth instruments and the broader code-guarantee grammar remain historical evidence. Their wider analysis program is not the v1 roadmap. The exact API for additional refresh requirements has not been selected.
