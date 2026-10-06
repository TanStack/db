---
name: oracle-authoring
description: Discover and articulate subsystem laws, then create or edit independent oracle tests and generated histories in TanStack DB. Use for new oracle coverage, oracle repairs, or changes to a reference model.
---

# Author an oracle

Start by making the law clear enough that someone could predict an observation
without reading production. The hard part is deciding what is owed, to whom,
under which conditions, and when. An executable model enacts that account.

Read [the oracle guide](../../../docs/contributing/oracle-tests.md),
[the glossary](../../../docs/contributing/glossary.md), and the relevant owner
and limits in [the coverage map](../../../docs/contributing/oracle-coverage.md).
Follow the subsystem reading requirements in AGENTS.md.

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

At closeout, connect the law to the evidence actually obtained: which histories
and paths ran, which wrong behavior was rejected, and what remains untested.
Use concise prose suited to the change; no particular report template is
required. When changing repository coverage, update the existing owner and
coverage map to reflect the changed scope. A scratch law-design experiment
retains its proposals and limits without claiming new repository coverage.

Track newly confirmed bugs using [the repository's issue-filing guidance](../../../AGENTS.md#track-newly-discovered-bugs),
including discoveries made during a scratch experiment whose fix is outside the
current task. Link the tracking issue in the experiment's closeout.
