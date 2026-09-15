# Evidence-store theory: frozen stress-test brief

Date: 2026-09-15. Baseline: `51e3d3077`.

User selection: “let's do it” in response to the proposed Ground Condition →
Fracture Scan → lifecycle draft → Guide-word Sweep and fresh Hostile Assay.
This authorizes research and a draft, not implementation of the evidence engine
or changes to endpoint behavior.

## Position under test

The framework maintains an assessment for each query/mutation across several
dimensions. It describes what is known and unknown, the evidence supporting
each conclusion, and an ordered list of concrete work that can reduce risk or
enable improvements. Claims, supporting evidence and permitted use are separate.

Recent user corrections are part of the position:

- Some optimizations follow from reusable compiler/linter analysis and should
  become automatic; agents should not repeat that work endpoint by endpoint.
- Application-specific oracles can support optimizations outside implemented
  analysis, including optimized-versus-baseline comparisons of actual app code.
- Oracles can test a value boundary, several participants, a history, or both.
- Missing evidence that only causes extra work differs from wrong accepted
  evidence that causes incorrect behavior. Priority and required rigor differ.
- The user wants an ordered todo list for drawing down risk across dimensions.

The assistant's provisional order was: demonstrated bugs; consequential unknowns;
automatically justified optimizations; further optimization evidence. That order
is a candidate to test, not an irrevocable user requirement. The user’s stated
“bugs > optimizations” does not establish that any minor observed bug must outrank
every severe unresolved concern.

## Premises, scope and success standard

1. Ordinary TypeScript and SQL remain the application language. The compiler
   does not insert authorization or change user semantics to satisfy a claim.
2. Compiler/catalog facts, inspection and test receipts keep their actual scope.
   A sampled pass is useful evidence; it is not silently relabeled a theorem.
3. No single goodness score substitutes for the individual requirements.
4. Missing, contradicted, stale and failed-to-run evidence remain distinguishable.
5. Tasks explain the affected obligation, action, completion evidence and why the
   action matters. Recording a task as done must not erase a larger open promise.
6. Evidence applicability depends on code, method and relevant environment.
7. Assessments must accommodate shared helpers and composites as well as endpoint
   views, consistent with the RFC. Endpoint-local ownership is not a frozen rule.
8. No new hidden mutation queue, blind mutation retries, PG instrumentation,
   unrelated external-write detection or sync engine is in scope.

Success means a later agent can distinguish an established guarantee from a
useful but incomplete result, choose a concrete next action under stated
priorities, and understand when prior support no longer applies. It does not
mean measured reduction in the probability of a production incident.

## Source trace

- **S1: user conversation**, the corrections quoted/summarized above, ending in
  “an ordered todo list for drawing down the risk.” This supplies the aim.
- **S2: [RFC v0.18](/Users/kylemathews/programs/dialectics/field-trip-tanstack-db-endpoints-prototype/sources/tanstack-db-endpoints-rfc-v0.18.md)**,
  “Rules, checks, and results,” “Open issues become agent work,” composites and
  “Where human review matters.” It already separates requirements/checks/results,
  supports dependency graphs and requires review for acceptance-control changes.
- **S3: [oracle guide](../../field-trip-optimistic-coherence/oracle-guidance-reaudit/GUIDE.md)**,
  “Compare formulations,” “Test the test,” and “Review and maintain the portfolio.”
  Baseline independence, actual path/observation, reach, fault controls, replay,
  and retained open promises are requirements, not new discoveries here.
- **S4: [categorization](../05-categorization.md)** and its per-ID ledger. This
  supplies bounded current-code observations and source-framework distinctions.
- **S5: [two projections](../06-frame-projection.md)**. Conceptual maps, not a
  test-method hierarchy, measured risk model or chosen implementation.

The oracle-guide path is repository-local. The RFC is an existing external local
reference. No fresh web claims or production incidents are asserted by this run.

## Record and execution controls

Ground and fracture runs happen in the parent context. Boundary cases are
constructions paired with baselines; source observations keep their labels.
The later lifecycle draft is a separate, versioned candidate informed by those
readings. A fresh hostile reviewer receives that candidate, its sources and the
success standard, not the parent's preferred verdict or sibling findings.

Guide-word Sweep requires competent content judgments that the card reserves
from an LLM. Its output in this run is preparation: fixed worksheet, missing
review roles and questions. It must not be reported completed merely because
the worksheet is full. Other selected work continues independently.

No production code or formal evidence-admission protocol is implemented. Artifact
checks can verify accounting and traceability; they cannot verify the theory.
