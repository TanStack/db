# Agent usability evaluation protocol

Frozen before any workflow report was read.

## Unit of observation

Each report is one exploratory usability session: one fresh agent, one common
packet, and one workflow. It can reveal a concrete failure or missing contract;
it cannot estimate a population success rate.

## Per-workflow reading

Record:

1. **Outcome:** recoverable, recoverable-with-invention, or blocked.
2. **Path recovery:** whether the agent found the intended query/command and
   adapter sequence without importing a second semantic model.
3. **State fidelity:** whether its trace kept evidence, conditions, work,
   policy, authority, and snapshots distinct.
4. **Invented surface:** every essential and convenient type, field, operation,
   default, error, authority rule, or transition absent from the packet.
5. **Friction:** discovery, naming, ceremony, missing input schema, missing
   output schema, unclear ownership, or unclear recovery.
6. **Safety:** any step that treats work, policy, an edit, cache, successful
   delivery, or an agent assertion as evidence/authority.
7. **Repair:** the report's smallest proposed improvement, kept as that agent's
   proposal rather than an adopted change.

## Cross-workflow synthesis

After all six reports exist, cluster repeated inventions by semantic operation,
not by spelling. Preserve one-off workflow-specific gaps. Distinguish:

- **design gap:** the normative model lacks the needed behavior;
- **public-packet gap:** `MODEL.md` supplies it but the condensed packet does
  not;
- **schema gap:** the operation is named but required inputs/results are absent;
- **ergonomic gap:** the workflow is possible but excessively ceremonial or
  hard to discover;
- **agent mistake:** the packet directly answers the question and the agent
  overlooked it; and
- **open implementation detail:** a concrete choice is unnecessary for the
  simulated outcome.

No majority vote changes the design. Repetition raises the priority of a gap;
a single safety counterexample is sufficient to retain a defect candidate.

## Controls and limits

- All agents receive the same frozen packet hash and exactly one workflow.
- They do not see design rationale, audits, sibling reports, or this evaluation
  protocol.
- Reports must include code/state traces; adjectives alone are not evidence.
- The orchestrator must not edit the packet or workflow prompts after the first
  agent starts.
- Model identity and stochastic variation are uncontrolled in this first pass.
- The packet's author and evaluator share context, so classification may favor
  intended distinctions. Raw reports remain the primary record.
