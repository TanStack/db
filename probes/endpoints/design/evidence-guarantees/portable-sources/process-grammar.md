---
id: process-grammar
name: "Process grammar"
summary: "Sourced event types, typed prerequisites, replay state, invalid sequences, repairs, and bounded alternate paths"
use_when: "A corrected event sequence may conceal a reusable prerequisite structure or the reason repeated runs fail at different points"
avoid_when: "Do not infer a grammar from a poorly grounded chronology, one unrepeatable story, or missing counterfactual expertise."
access_target: "The prerequisite and state-transition grammar of a bounded process, including replay failures and valid alternate sequences"
requires: "A sourced event sequence, distinguished action types and occurrences, and a case expert who can answer prerequisite questions"
execution_seat: hybrid
fresh_context: hybrid
effort: high
persistence: "Several elicitation and replay passes; preserve event records, questions, answers, graph versions, and repair regressions."
artifact_risk: "Missing evidence becomes an invented prerequisite, temporal order becomes causality, or replay consistency is mistaken for real-world validity."
maturity: draft
documented_uses: 0
---

# Process grammar (`process-grammar`)

- **Phenomenon sought:** A bounded process's reportable action types, prerequisite sets, state transitions, repetition conditions, and sequence violations.
- **Why use it:** A timeline shows what happened once. A process grammar tests what must be enabled before an action can occur, which alternate sequences remain valid, and where an observed run contradicts the current model.
- **Operating range:** Use for repeated operational, organizational, research, incident, customer, or technical processes with a grounded sequence and answerable case knowledge. Do not use when the chronology is still disputed, event wording is too vague, the episode is unique with no justified recurrence claim, or the executor would need to invent counterfactual answers.
- **Input:** A corrected source-linked chronology; separate action-type definitions and event occurrences; event descriptions at a useful granularity; a case expert or evidence base for relation questions; and the intended scope of replay.
- **What changes:** The instrument turns an observed sequence into a candidate executable grammar. It adds counterfactual structure and a state model that the chronology alone does not contain; every added relation must therefore retain its answer and reason.
- **Procedure:**
  1. **Freeze the event record.** Preserve source passage, occurrence, short name, fuller description, actors or system parts, timing, and analyst comments. Mark selection and wording as analyst choices. Use [`substrate-map`](substrate-map.md) first if observation, report, and explanation remain mixed.
  2. **Separate types from occurrences.** Define reusable action types independently from their positions in the observed sequence. Adjust granularity when events are too concrete to recur or too abstract for prerequisite questions. Record repeated occurrences without duplicating the type definition.
  3. **Elicit prerequisite structure.** For each action type, ask whether earlier actions or states are necessary for it to occur, using prerequisite, implication, or bounded counterfactual wording. Record each question, answer, reason, source, and respondent. Use known relations to skip redundant questions, but expose every inferred skip.
  4. **Type the relations.** Mark conjunctive and disjunctive prerequisite sets. Distinguish ordinary implication, commutation or alternating-state loops, concrete-to-general instantiation, and whether a consequence depletes a prerequisite before the action can repeat. Do not encode temporal succession as necessity.
  5. **Build replay state.** Track at least `enabled`, `occurring`, and `accomplished-but-not-depleted`. Replay the observed sequence from its initial state and record every state transition.
  6. **Diagnose failures.** Mark an action as **unprimed** when its prerequisites are not fulfilled and **unused** when it repeats while its prior effects remain unconsumed. For each violation, list the bounded repair family: revise a relation, revise AND/OR structure, revise depletion or commutation, or add a specifically sourced omitted occurrence. Never repair a graph merely to force the sequence through.
  7. **Run regression replay.** After every accepted repair, replay from the beginning and report any earlier inconsistency the change creates. Keep rejected repairs and their reasons.
  8. **Test range.** Generate a small set of alternate sequences by selecting only currently enabled actions. Label these grammatical under the model, not predicted in the world. When a generalized model is useful, map concrete actions to general types, inherit only observed order, re-elicit abstract prerequisites, and test concrete/general consistency.
- **Result:** Return event-type and occurrence records; question-answer-reason log; typed prerequisite graph; replay-state trace; unprimed and unused violations; accepted and rejected repairs; regression results; bounded alternate grammatical sequences; abstraction level; and unresolved relations.
- **Control:** The case expert owns event wording and relation answers. Source pointers and the question log expose injected structure. Typed relations block a generic causal graph. Full regression replay controls local fixes. A nearby sequence or second episode is required before claiming a reusable process rather than a one-case fit.
- **Common distortions:** The LLM invents missing events; a graph edge is read as causal proof; AND/OR structure is chosen for convenience; every observed order becomes necessary; generalized actions erase actor or context differences; or successful replay is mistaken for operational desirability.
- **Escalate / stop:** Return to [`substrate-map`](substrate-map.md) when chronology or missing observations remain the main uncertainty. Use [`ground-condition`](ground-condition.md) when a prerequisite changes across material contexts. Stop when no one can answer relation questions, replay repair depends on unsourced events, the graph exceeds a reviewable scope, or the second episode breaks the grammar without a bounded explanation.
- **What it requires:** High model effort, repeated case-expert review, and persistent graph/version records. Software may schedule nonredundant questions and replay states but must not supply relation judgments.
- **Execution placement:** **Hybrid.** The orchestrator owns the frozen sequence, live corrections, relation-question framing, repair decisions, and final return. A deterministic worker may replay a frozen graph. A fresh auditor may inspect one frozen replay for state errors while hidden from preferred repairs. Without case expertise, return only the event sequence and unanswered relation inventory; do not claim a grammar.
- **Distinctness:** Unlike [`substrate-map`](substrate-map.md), this instrument adds explicit prerequisite and replay structure after the sequence is grounded. Unlike [`design-grammar`](design-grammar.md), it asks which action is enabled now and whether a sequence executes, rather than which structural forms can reconstruct a source system. Unlike a generic causal map, it preserves relation questions, state semantics, and the boundary between logical fit and causal explanation.
- **Provenance:** This Field Lab port adapts David Heise's Event Structure Analysis and Ethno procedures from [*Event Structure Analysis with Ethno*](https://cs.uwaterloo.ca/~jhoey/research/ACTBackup/ESA/EthnoHelp.pdf), with interpretive limits informed by Larry Griffin and Robert Korstad's [“Historical Inference and Event-Structure Analysis”](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/5106E90C9E03A837F5EF2F5913A1401D/S0020859000115135a.pdf/historical_inference_and_eventstructure_analysis.pdf). The portable process/replay boundary is a Field Lab adaptation.
