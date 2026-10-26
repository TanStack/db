---
name: oracle-authoring
description: Discover and articulate subsystem laws, then create or edit independent oracle tests and generated histories in TanStack DB. Use for new oracle coverage, oracle repairs, or changes to a reference model.
---

# Author an oracle

Start by making the law clear enough that someone could predict an observation
without reading production. The hard part is deciding what is owed, to whom,
under which conditions, and when. An executable model enacts that account.

Use this skill whenever an oracle changes, or the production driver, history
grammar, or comparison that it uses. This includes a change made while you fix
a bug, fix a review finding, or evaluate review findings.

Read [how oracle work is scored](../../../AGENTS.md#how-oracle-work-is-scored)
first. Auditors check the order of your work and penalize shortcuts.

Work in this order when a production change is part of the task:

1. State the law and its authority.
2. Inventory the materially affected public receiving paths and their promised
   observation cuts. Include required real-host receiving witnesses in this
   pre-edit gate; a controlled core witness does not supply their evidence.
3. Extend the history grammar, driver, or observation until generated
   histories reach the state where the law matters. Declare that state with
   `createOracleReach` (ORC-015) for each required receiving path.
4. Run those comparisons on unchanged production. Record the defect's RED
   result and the neighboring guarantees' results. A setup failure or missing
   required witness blocks production edits; repair the test path first.
5. Change production, with the oracle running after each attempt.
6. Record the GREEN result and a hostile mutant that fails.

Do not change production before step 4. Retrospective runs or a documented
process gap do not satisfy this gate. If a model rule disagrees with
production, find its authority before you edit either one. A rule that you
change only so that it matches production output is model hacking.

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

Follow the subsystem reading requirements in AGENTS.md.

Keep unit tests and standalone concrete type assertions out of oracle files
(ORC-016). Fixed regressions are inputs to the same model, driver, and
comparison as the broader campaign, without their own expected answers.
Compile-time oracles generate legal TypeScript inputs and compare public
types with a reusable independent law; a matrix of fixed assertions does not
satisfy this requirement. Supplemental examples belong in ordinary test files.

Use the [instrument library](../../../docs/contributing/instruments/index.md)
when there is a material uncertainty. Select cards within the authorized task;
there is no required sequence or instrument quota.

- When the promised behavior is unclear, use **Law discovery**. Separate the
  established contract, observations of current behavior, and proposed design.
- When changing an established model, write old and proposed predictions for a
  distinguishing case before editing expectations. **Adversarial review** can
  expose a shared mistake in production and the model.
- When obligations collide, use **Tension scan**. When laws overlap or their
  concepts seem wrong, use **Law restructuring** to propose and check a better
  organization.
- When an oracle is green but may accept a plausible wrong implementation,
  use **Mutant gap hunt** to design a semantic edit and classify any survivor.

Keep the chosen law and its authority visible beside the independent model.
A counterexample can indict production, the model, the history grammar, the
observation checkpoint, or the proposed law. Determine which before repairing
it. A convenient encoding or a stronger assertion is not automatically a better
account of the contract.

Develop the executable evidence using the oracle guide: legal histories,
production entry point, public observations, and a comparison that rejects a
plausible wrong design. Explain why each model distinction changes an allowed
next action or promised observation. Preserve freedom where the contract leaves
scheduling, representation, or implementation choices open.

For a law-design request, return candidate laws, source authority, rival
predictions, and the experiment that could discriminate them. Implement tests
when requested by the task. A proposal with unresolved authority can be explored
in a scratch model; do not silently make it a product expectation.

At closeout, write the evidence block from AGENTS.md (law, reach, RED, GREEN,
mutant, limits). Connect the law to the evidence actually obtained: which histories
and paths ran, which wrong behavior was rejected, and what remains untested.
Use concise prose suited to the change; no particular report template is
required. When changing repository coverage, update the existing owner and
coverage map to reflect the changed scope. A scratch law-design experiment
retains its proposals and limits without claiming new repository coverage.
