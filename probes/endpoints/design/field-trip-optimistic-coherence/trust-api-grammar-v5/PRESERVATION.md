# TanStack Trust API Design Grammar — Preservation Contract v5

v5 repairs the frozen v4 candidate using its evaluated audit ledger and the
ESLint donor readout. It selects an API layering and enough concrete contracts
to support fresh-agent usability simulations. It does not claim implementation
or independent cross-domain validation.

1. **PC5-01 — Domain ownership and extensibility.** Installable and project-local
   modules define subjects, claims, routes, methods, adequacy, applicability,
   semantic messages, and source mapping. Trust owns lifecycle mechanics.
   Consumers own action. Modules cannot admit themselves.
2. **PC5-02 — Claims and obligations precede evidence.** Versioned claims,
   claim uses, support routes, premises, and obligation sources exist before an
   observation and retain independent identity.
3. **PC5-03 — Method-specific evidence.** Every observation retains its exact
   method/evaluator/schema/runtime, run plan, captured input and dependencies,
   production admission, provenance, trust roots, calibration basis, coverage,
   omissions, reach, result, and replay class. Shape never implies truth.
4. **PC5-04 — Argument, adequacy, and applicability remain explicit.** AND/OR
   routes, method-to-premise edges, domain adequacy, tri-state applicability,
   current admission, and cross-version identity relations cannot collapse into
   one pass/fail or score.
5. **PC5-05 — Stigmergic traces are not proof.** Conditions and work coordinate
   agents and preserve useful residue. Claims, leases, notes, PRs, popularity,
   and work closure never support a premise or confer authority.
6. **PC5-06 — Histories and clocks stay distinct.** Immutable history,
   configuration revisions, evidence freshness, applicability decisions,
   condition activation, work leases, admission changes, override expiry, and
   policy evaluation retain separate transitions and explicit clock owners.
7. **PC5-07 — Challenges require causal repair.** Counterexamples remain
   effective until an authorized repair links the same violation and affected
   use to a changed cause and a fresh, non-cache, post-failure observation.
8. **PC5-08 — Conditions are durable and policy-free.** Active membership and
   retained occurrence history are distinct. Missing, inconclusive,
   unreachable, inapplicable, expired, challenged, invalid, unadmitted,
   unresolved, operational-failure, and cleanup-failure states remain distinct.
9. **PC5-09 — Agent actions are navigable and safe.** Diagnostics expose stable
   rule and condition refs, structured causes, affected uses, limits, authority
   boundaries, version-bound legal actions, and typed stale/error recovery.
   Diagnosis, preview, authorization, application, and re-evaluation are
   separate stages.
10. **PC5-10 — Proposal is not authority.** Agents may propose every semantic
    object, evidence result, challenge, repair, or protocol revision. Admission
    and deployment exceptions require independently verified principals and
    capabilities.
11. **PC5-11 — Consumer policy cannot rewrite semantics.** Severity,
    visibility, fallback, CI/deployment action, and scoped expiring overrides
    operate over conditions. They do not alter observations, adequacy,
    applicability, challenges, or admission.
12. **PC5-12 — Linter ecosystem protocol.** Modules publish content-addressed
    capability manifests; configuration resolves deterministically with
    contributing-layer explanation; options and message/action catalogs have
    runtime schemas; lowering is atomic and deterministic; source remapping,
    compatibility metadata, and `TrustRuleTester` are first-class contracts.
13. **PC5-13 — One service, three layers, one meaning.** Linter-style authoring
    lowers to a typed query/command service whose versioned operation schemas
    project consistently through TypeScript, CLI, LSP, MCP, CI, and Devtools.
    Pure queries never invoke unfrozen executable hooks.
14. **PC5-14 — Transaction and decision integrity.** Commands are
    capability-checked, idempotent, expected-version operations with explicit
    intent, attempt, commit, delivery, cleanup, reconciliation, and typed
    receipts. Reports and policy decisions bind one coherent snapshot and
    evaluation instant.
15. **PC5-15 — Bounded completeness and honest range.** Completeness means the
    system can represent the declared support, defeat, applicability, failures,
    work, authority, configuration, policy, and remaining obligations. It does
    not mean universal proof, exhaustive relevance discovery, liveness,
    calibrated truth, hostile-code isolation, or validity beyond Endpoints.

The first v5 test range is six fresh-agent simulations against a condensed
design packet. These trials measure interface comprehension, friction, missing
operations, and invented assumptions. They do not validate the implementation
or settle the remaining security, persistence, calibration, and distribution
designs.
