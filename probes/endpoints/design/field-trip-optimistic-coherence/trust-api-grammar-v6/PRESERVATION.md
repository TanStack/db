# TanStack Trust API Design Grammar — Preservation Contract v6

Confirmed by the user for exact-equivalence Design Grammar run 65. The source
set is frozen through Field Log event 1088; confirmation is event 1089.

1. **P1 — Domain-owned hardness.** TanStack Trust remains a domain-agnostic
   kernel. Domain protocols locate and establish useful hardness instead of a
   universal Trust product pretending to know every domain.
2. **P2 — PostgreSQL substrate beneath Endpoints.** A reusable PostgreSQL
   protocol accepts adapters for Drizzle, Kysely and raw SQL. Endpoints consumes
   that protocol and adds endpoint-specific semantics and optimizations.
3. **P3 — Honest compiler knowledge.** Adapters preserve stable operation
   identity, dependencies, read/write effects, source mappings, annotations and
   explicit unsupported or unknown results rather than claiming complete
   analysis.
4. **P4 — Relationships instead of copying.** Stable typed relationships connect
   Endpoints subjects to PostgreSQL operations so evidence can apply across
   layers without being copied or reinterpreted.
5. **P5 — Separate semantic stages.** Definitions, compiler observations,
   applicability, method qualification and runtime evidence remain distinct.
   Requirements select what is needed; enforcement policy decides consequences.
6. **P6 — Independent evidence providers.** Third parties such as Neon can ship
   separately versioned evidence methods over subjects and protocols they do not
   own, subject to explicit project admission and bounded production authority.
7. **P7 — One inspectable requirement model.** Global requirements and
   source-local annotations lower into one inspectable configuration. Local
   declarations cannot weaken global requirements or grant authority.
8. **P8 — Governed production evidence.** Production evidence runs are planned,
   authorized, bounded, attributable and atomically submitted, with expiry and
   dependency invalidation retained.
9. **P9 — Simple surface, explicit lowering.** Adequacy and applicability remain
   separate kernel decisions, while ordinary package authors receive derived
   defaults and write typed checks, dependencies and result interpretation
   instead of explicit proof graphs.
10. **P10 — Agent proposals are not authority.** Agents may query unresolved
    work, challenge a requirement and propose new evidence or proof routes, but
    evidence and assertions cannot rewrite requirements or manufacture
    enforcement authority.
11. **P11 — One meaning across interfaces.** The same inspectable state and
    actions project through TypeScript, LSP, MCP, CLI and Devtools, supporting
    edit repair, expiry renewal, CI gating, human browsing, temporary scoped
    downgrade and stricter-policy preview.
12. **P12 — Honest implementation range.** Endpoints is the only current
    implementation. A broader PostgreSQL adapter ecosystem and Neon production
    execution remain proposed and are not validation evidence.

