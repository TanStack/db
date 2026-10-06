---
name: oracle-review
description: Review TanStack DB oracles and generated-history tests by challenging enforcement, model independence, law formulation, law suitability, and relationships among laws. Use for oracle reviews and proposed oracle contract changes.
---

# Review an oracle

Ask both whether the oracle enforces its stated law and whether that is the
right law to promise. A passing test can coexist with a wrong theory; a failing
test can coexist with correct production.

Read [the oracle guide](../../../docs/contributing/oracle-tests.md),
[the glossary](../../../docs/contributing/glossary.md), and the relevant owner
and limits in [the coverage map](../../../docs/contributing/oracle-coverage.md).
Follow the subsystem reading requirements in AGENTS.md. Guide conformance is
judged by its ORC requirements, not by use of these instruments or headings.

Follow the oracle's authority claim to the nearest public contract source and
inspect neighboring promises within the review scope. The oracle's own summary
can omit the very obligation it should check.

Reconstruct one promised observation from the contract independently of the
implementation. Trace the actual model, legal histories, production path,
recorder, and comparison that purport to check it. Then select a useful attack
from the [instrument library](../../../docs/contributing/instruments/index.md):

- **Adversarial review** examines enforcement, formulation, suitability, and
  underlying concepts. Name the level each attack addresses.
- **Law discovery** helps when the claim has no clear authority or two plausible
  interpretations predict different behavior.
- **Tension scan** examines demands that collide under a concrete condition.
- **Law restructuring** tests whether merging, splitting, replacing, or removing
  laws gives a better account while preserving necessary obligations.

Choose attacks for the actual uncertainty; do not run every card or require a
finding at every level. Use a fresh reviewer for an independent challenge when
delegation is available and authorized. Give it the artifact, sources, and task,
without the author's desired verdict. Label a self-review as such.

For each finding, give the challenged claim, source or authority, smallest
legal witness or concrete design consequence, evidence status, and repair or
next experiment. For a confirmed bug, explain why the existing oracle missed
it and identify the smallest general improvement. Distinguish executed results
from source inspection and proposed experiments. A setup error or timeout is
not evidence that a mutant was rejected at the comparison.

Keep defects under accepted contracts separate from proposals to change those
contracts. Criticism may recommend different, safer, or more conventional
behavior, but must name the external standard or engineering reason, its
applicability, and migration cost. Existing behavior does not establish its own
correctness; a preference does not establish a contract violation.

Report supported findings and remaining uncertainty. Do not invent findings,
retire laws, or rewrite expectations to make a review come out decisive.
