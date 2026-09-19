# TanStack Trust: Protocol Discovery and Engineering — Preservation Contract

Confirmed for exact-equivalence Design Grammar run 67. The extraction source is
frozen through Field Log event 1121; the user's confirmation and the run start
are recorded at events 1121–1123.

1. **PE-P01 — Future-valued target.** Begin with a future condition an
   authorized person or team values, then work backward to a guarantee that can
   be created and maintained now.
2. **PE-P02 — Two-level architecture.** Keep protocol discovery and engineering
   separate from the admitted concrete TypeScript definitions and runtime
   operations that execute a protocol.
3. **PE-P03 — Native, predictive and engineered hardness.** A substrate such as
   PostgreSQL may already provide hardness; a diagnostic predicts its refusal;
   a protocol can create additional hardness through ordering, admission or
   refusal.
4. **PE-P04 — Generator–verifier composition.** LLMs generate many candidate
   protocols, proofs and hardening routes and iterate from feedback. Model
   confidence, self-critique and popularity do not judge admission.
5. **PE-P05 — Fast, high-quality verification.** Verifiers are independently
   grounded, bounded, repeatable and fast enough for iterative search. They
   return structured failures and counterexamples rather than only a score.
6. **PE-P06 — Verifier limits.** Passing establishes only the verifier's
   declared property and domain. Independence, coverage, calibration,
   applicability, shared assumptions, reward hacking and overfitting remain
   explicit.
7. **PE-P07 — Reusable mechanisms.** Tests, property and oracle campaigns,
   static analysis, database constraints, performance gates, feature flags,
   canaries, rollback and other traditional hardening mechanisms remain
   composable without becoming equivalent.
8. **PE-P08 — Agent-operable cloud primitives.** Admitted providers may expose
   bounded production sampling, replay, shadowing, fault injection, ephemeral
   environments, staged rollout, attestation or new operations that let agents
   gather grounding or manufacture enforceable transitions.
9. **PE-P09 — Open and local ecosystem.** Projects and packages can discover and
   use local sources or needs for hardness, then publish generally useful
   mechanisms through an open ecosystem. Installation, reuse and popularity do
   not grant admission or authority.
10. **PE-P10 — Lifecycle, authority and softness.** Targets, subjects,
    grounding, candidate designs, evidence, qualification, hard points,
    monitoring, expiry and repair remain linked from product intent through
    production. Agents cannot authorize value, admit their own verifier, grant
    exceptions or turn work completion into evidence. Challenge, fallback,
    revision and expiring exceptions remain explicit.
11. **PE-P11 — Concrete shared API.** Accepted protocols have coherent,
    idiomatic TypeScript authoring APIs and one operation model projected
    through LSP, MCP, CLI and Devtools while PostgreSQL, Endpoints, Neon and
    project packages retain source and authority boundaries.
12. **PE-P12 — Honest range.** Only the finite Endpoints evidence kernel and
    local interfaces execute today. Refresh enforcement, standalone
    PostgreSQL/Neon/product packages, agent-operated cloud hardening, registry
    behavior and a second-domain range test remain absent or proposed.
