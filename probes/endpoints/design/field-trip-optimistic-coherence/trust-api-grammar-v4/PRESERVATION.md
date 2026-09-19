# TanStack Trust API Design Grammar — Preservation Contract v4

Run 61 is an exact-equivalence extraction. The contract was frozen after the
Protocols Institute survey, blind donor perturbation, the TypeSafe System One
Models article, and Kyle's requirement that Trust preserve the familiar
extension model of linters.

1. **PC4-01 — Domain ownership and extensibility.** Installable domain packages
   and project-local modules define known claims, checks, adequacy,
   applicability, and presentation and help models propose new hardness. Trust
   manages evidence mechanics and history. Consumers decide action.
2. **PC4-02 — Claims precede evidence.** Claims retain versioned identity,
   scope, conditions, and obligation lineage before evidence exists.
3. **PC4-03 — Method-specific evidence.** Deterministic checks and typed
   probabilistic evaluators retain method, evaluator, schema, input,
   calibration, provenance, trust roots, coverage, omissions, and results.
   Schema conformance never implies semantic truth.
4. **PC4-04 — Argument structure.** AND/OR support routes, evidence uses,
   applicability, and unresolved identity relations remain explicit.
5. **PC4-05 — Stigmergic traces are not evidence.** Conditions and work cases
   form the shared trace substrate but never become evidence, commands,
   admission, or policy.
6. **PC4-06 — Distinct histories and clocks.** History appends and supersedes.
   Evidence freshness, applicability, condition lifetime, work leases,
   configuration revisions, and policy expiry remain distinct.
7. **PC4-07 — Causal challenge and repair.** Challenges and repairs preserve
   causality, obligations, objection state, and semantic progress independently
   of task churn.
8. **PC4-08 — Actionable diagnostics.** Diagnostics expose stable rule codes,
   causes, affected uses, coverage limits, authority boundaries, and typed legal
   next actions.
9. **PC4-09 — Proposal is not authority.** Agents may propose claims, routes,
   checks, evidence, challenges, repairs, and protocol revisions but cannot
   authorize their own trust roots.
10. **PC4-10 — Probability, admission, and policy remain separate.**
    Probabilities are method outputs. Profiles and scoped expiring overrides
    may change severity or deployment action without rewriting evidence.
11. **PC4-11 — One service with linter-shaped extension and projection.** One
    lifecycle service projects consistently through idiomatic TypeScript, CLI,
    LSP, MCP, Devtools, and Beads-style work APIs. Rules and checks are ordinary
    versioned code packages; projects compose installed and local definitions
    and explicitly enable, configure, or disable them. Configuration is
    inspectable and source-controlled, and changing it never rewrites evidence
    history. Stable rule codes, source locations, severity, suppression, fixes,
    machine output, and CI status remain familiar projections. Reads are
    side-effect-free and commands transactional.
12. **PC4-12 — Bounded completeness.** Completeness means representable
    support, defeat, applicability, failure provenance, work, admission,
    configuration, and remaining obligations—not universal proof, confidence,
    liveness, or cross-domain validity.

The frozen extraction target is the internal TypeScript API and shared semantic
service used by Endpoints, including its extension grammar and agent-facing
projections. Endpoints is the only implementation and illustrative consumer.
Linter ecosystems constrain the interface and extension model; they are not
independent evidence of cross-domain range.
