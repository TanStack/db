# Survey brief — SQL effects, independence, and justified pruning

Frozen before external searching, 2026-09-14.

**Question:** Which established mathematical analyses and PostgreSQL contracts can justify skipping an endpoint collection's refetch after a mutation, while identifying genuine unknown effects and avoiding restrictions that belong only to harder tasks such as client evaluation or row-patch maintenance?

**Downstream use:** Source-traced basis for the selected Design Grammar and a deterministic explanatory checker with correctness and missed-optimization tests. The survey maps evidence; it does not choose the checker design.

**Depth:** Broad. Public primary literature and official PostgreSQL 17/18 documentation, foundational work through 2026-09-14, English. Up to 28 substantive external sources. Stop after two targeted passes add no material mechanism/boundary or at the declared source/access cap; do not claim saturation if the cap fires.

**Starting material read:** `probes/endpoints/RELATIONAL-ALGEBRA-SURVEY.md`, `probes/endpoints/SQL-EFFECT-RULES-PLAN.md`, and the Kitchen index restriction/port results recorded at field-log entry 58. These local artifacts are context, not independent validation. Reopen external sources for claims used here.

**Coverage frame:**
1. Query/update independence and noninterference; soundness vs precision/completeness; logical vs physical dependencies.
2. Abstract interpretation/effect summaries and compositional relation inference; static vs dynamic provenance, catalog vs program dependencies.
3. Existing cache invalidation/checking systems and their formal assumptions; coarse table sets vs predicates/constraints.
4. PostgreSQL binding, function contracts, indexes/types/constraints/defaults/generated columns, FK cascades, triggers/rules/views/RLS; which operations actually execute which effects.
5. SQL and browser authority boundaries: context/nondeterminism, transactions/partial commit, optimistic recipients, missing baselines, external freshness exclusion.
6. Executable validation: independent oracles, metamorphic equivalence, mutation testing, limits of proving arbitrary SQL equivalence; existing generators only insofar as they affect checker testing.

**Exclusions:** Implementing more compiler rules, general JS/library analysis, changing auth, installing anything in application PostgreSQL, row-patch/IVM optimization design, latency benchmarking, an exhaustive PostgreSQL support or extension inventory, the separate broad-generator implementation. All schema knowledge is build-time knowledge. External freshness stays with polling/events/sync.

**Output:** `probes/endpoints/SQL-EFFECTS-SURVEY.md`, using the canonical Research Survey template, with a claim ledger, directly inspected sources, coverage cells, conflicts/limits, and search controls. Record in the existing Field Log. Design Grammar is queued separately and must retain its own source/preservation boundary.
