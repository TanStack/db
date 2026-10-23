---
name: oracle-review
description: Review TanStack DB oracles and generated-history tests by challenging enforcement, model independence, law formulation, law suitability, and relationships among laws. Use for oracle reviews and proposed oracle contract changes.
---

# Review an oracle

Ask both whether the oracle enforces its stated law and whether that is the
right law to promise. A passing test can coexist with a wrong theory; a failing
test can coexist with correct production.

Read [the oracle guide](../../../docs/contributing/oracle-rubric.md) and
[the glossary](../../../docs/contributing/glossary.md) in full, then read the
relevant owner and limits in
[the coverage map](../../../docs/contributing/oracle-coverage.md).

After a handoff or compaction, reopen required sources whose relevant contents
are absent from the current context. A prior agent's statement that it read
them does not supply their definitions. Apply the glossary's model alignment
rule before naming or renaming a state, action, boundary, or observation. Use
canonical terms and declare abstractions that combine or split production
concepts. Delegated agents must do the reading relevant to their own scope.

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
- **Mutant gap hunt** tests whether a plausible wrong implementation can pass
  the owner and traces survivors to a missing distinction, a contract-permitted
  difference, a scoped equivalence argument, or a baseline product bug.

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

Audit the change for the shortcuts that
[the scoring section](../../../AGENTS.md#how-oracle-work-is-scored) penalizes.
Report each one as a finding:

- A production change without a RED result from the extended oracle on the
  parent commit.
- Required public receiving paths tested only after the production repair,
  or aggregate reach that hides an unexercised receiving path. Check the
  pre-edit inventory, actual comparison results, and their order. Retrospective
  evidence or documentation of a gap does not satisfy the pre-edit gate.
- A model rule that changed to match production output without an authority.
- A claim about a state that no declared reach shows generated histories enter.
- A skipped, narrowed, or relaxed comparison without a coverage-map entry and a
  maintainer decision.
- A pinned example where the law needs a generator dimension.
- A counterexample labeled as older than the change and then left without a
  fix, a coverage-map record, or a maintainer decision.
- A closure claim without a hostile mutant that fails the oracle.

Report supported findings and remaining uncertainty. Do not invent findings,
retire laws, or rewrite expectations to make a review come out decisive.

If the review leads to oracle edits, load
[oracle-authoring](../oracle-authoring/SKILL.md) before you edit. This also
applies when you fix a finding during the same task.
