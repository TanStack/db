# Design a check

Input: one proposed claim, its intended consumer, existing source/code, and the
consequence of an incorrect conclusion. Output: one bounded claim/check package.

## 1. State the promise

Write the law, subject, conditions and scope. Give one satisfying case, one
violating case and one unresolved case. Distinguish the application outcome from
the check outcome. Ask for a product decision only when the missing requirement
cannot be inferred from the selected task; do not invent a threshold or policy.

Keep the user's original requirement alongside any narrower measurable claim.
An easier check must not quietly replace the required guarantee.

## 2. Find the boundaries

Construct matched cases that differ in one relevant condition. Ask what makes
the conclusion stop following: stale data, incomplete input, delayed effects,
different configuration, external behavior or a changed consumer. Record each
assumption as a premise or explicit exclusion. A hypothetical case is a reasoning
control, not an observed production bug.

Stop if a missing fact prevents stating the law. Request that fact; do not
substitute a general success claim. Separate local observations from guarantees
about an unobserved provider.

## 3. Choose the evidence route

Use the route that can access the property:

- **Static/certificate check:** specify the semantics analyzed, certificate
  contents, verifier, unsupported constructs and exact trusted components.
- **Empirical/oracle check:** specify histories, the independent expected result,
  exercised production boundary, observations, generators and replay/shrinking.
  Value, work and latency are distinct laws.
- **Source inspection/rubric:** preserve source passages and representation,
  inspect calls/configuration as needed, state each conclusion and its limits,
  and assess against criteria specific to this claim. Same-agent assessment is
  allowed; it must not impersonate an automatic runner result.

Do not rank these routes globally. Declare which routes are alternatives for a
premise and which premises are jointly required. Label a relied-on assumption
instead of manufacturing a test result for it.

## 4. Attack admission and diagnostics

Try to make the checker accept a violating case and reject a satisfying case.
Try wrong scope, missing dependencies, empty/vacuous campaigns, shared oracle
assumptions, changed comparators, stale evidence and plausible but irrelevant
support. Test whether the repair suggestion actually addresses the missing
premise and points to a file the consumer can edit.
Check whether the explanation distinguishes alternative repair routes from
jointly required work. Two different completion conditions must not collapse
into the same task report just because they mention the same missing claims.

Keep objections separate from reproduced counterexamples. A hostile critique
is a lead until its reasoning or executable witness establishes the violation.
Do not solve an inconvenient counterexample by narrowing the claim without
preserving the original obligation.

## 5. Test the checker

Reproduce known counterexamples. For an oracle, mutate the implementation across
named fault classes and require the unchanged oracle to detect them. Distinguish
an assertion failure from a harness/import crash. Record false-green controls and
repair generators, adapters or assertions before counting them as coverage.
For replay-sensitive checks, generate separate invocation, measurement and
delivery events. A pass delivered late must not qualify as a replay if the check
started before the failure. Advance context after a successful resolution and
verify that stale repair evidence cannot retain authority.

Check both false acceptance and unnecessary rejection. Preserve original failing
law, inputs and observation through shrinking. If a check cannot run, report an
operational/CI error; do not invent a correctness result or evidence-log entry.

## 6. Package and review

Include the artifacts listed in this directory's README. Make rule versions and
trust assumptions explicit. Register the rule through the project's normal
code-review/change process; the agent cannot establish rule soundness merely by
proposing an argument under it. No separate reviewer is mandatory by this workflow.

Return: the claim, acceptance rule, passed controls, counterexamples, unsupported
conditions and open decisions. Stop before expanding scope or selecting severity
unless that work is already authorized. The package is ready for bounded use only
under its stated assumptions; the base must still check every concrete use.
