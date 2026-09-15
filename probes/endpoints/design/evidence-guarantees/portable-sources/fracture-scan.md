---
id: fracture-scan
name: "Fracture scanner"
summary: "Test a coherent position against its own rules or an admissible counterexample, while preserving the insight that survives"
use_when: "A coherent position may fail by its own rule, or a constructed case may defeat its claimed necessity, scope, or strategic consequence"
avoid_when: "Do not run on an incoherent sketch or simple factual error, or attack from an outside standard."
access_target: "A premise-to-consequence fracture or admissible counterexample, the hidden condition it exposes, the preserved insight, and weakening evidence"
requires: "A coherent position with traceable premises, a claimed consequence or course of action, and enough detail to test counterexample admissibility"
execution_seat: orchestrator
fresh_context: optional
effort: medium
persistence: "One deep analysis; can be done here for one position, while the dialectic workflow keeps it in the round file."
artifact_risk: "Every weakness is made self-sublating, or a vivid exception is passed off as internal despite violating the position's premises or scope."
maturity: practiced
documented_uses: 12
---

# Fracture scanner (`fracture-scan`)

- **Phenomenon / range / input:** The specific way a coherent position undermines itself, either when its own premises are extended or when a case inside its stated range defeats its claimed consequence. The input must expose premises, scope, a success rule, and a promised consequence or course of action.
- **Why use it:** External criticism shows disagreement but not failure by the position's own rule. Internal extension exposes self-defeating implications; a carefully constructed counterexample exposes a hidden assumption that made the conclusion feel necessary. Both routes preserve the strongest narrower claim that survives.
- **What it changes:** The scan temporarily treats the position's rules as binding, then either extends them or constructs a case under them. This can make a hypothetical failure scene feel more evidentially vivid than its support warrants, so the readout must keep construction, source evidence, and inference separate.
- **Procedure:**
  1. Reconstruct the position's core claim, explicit premises, scope, success rule, protected insight, promised consequence, and—when relevant—the course of action it organizes.
  2. Freeze the stated scope and entry conditions. Name what must hold if the conclusion is necessary or the strategy is sound. Do not repair or broaden the position after testing begins.
  3. Test the **internal-extension route**: carry the premises forward under the position's own standard until one blocks its promise, produces the result it rejects, or requires an exception it cannot justify. Cite the exact premise-to-consequence path.
  4. Test the **counterexample route** when the claim supports one: construct the smallest concrete case that satisfies the stated premises and scope but blocks the promised consequence, produces a rejected result, or defeats the organized course of action. Vary only what the position leaves free; render the case as a short failure scene without adding unsupported detail.
  5. Screen the counterexample for admissibility. Ask whether it satisfies every explicit premise, stays inside the declared domain, preserves the meanings of load-bearing terms, and defeats the claimed relation rather than merely showing an unusual instance. Reject it as an external objection or near miss if any test fails.
  6. Identify what made an admitted counterexample surprising: an unstated premise, a prototype mistaken for a definition, a suppressed boundary condition, or intuition treated as necessity. State whether it defeats the whole position, its universal scope, one causal link, or only the proposed action.
  7. Preserve the strongest narrower claim that survives. Do not let the force of a vivid counterexample erase a valid local insight.
  8. Run two controls: one ordinary rebuttal using an outside standard, and one vivid near-counterexample that violates an explicit premise or scope condition. The scan must reject both as internal fractures.
  9. Return zero or more candidate fractures. If neither route succeeds, return a null result rather than manufacturing one. For every candidate, state what evidence would show that it is an external objection, factual error, or inadmissible construction.
- **Readout / control:** For each candidate fracture, return the target claim, frozen premises and scope, route used, exact premise-to-consequence trace, and preserved insight. For the counterexample route also return the minimal failure scene, preserved premises, exposed condition, defeated consequence or action, and admissibility record. Include weakening evidence plus the rejected outside rebuttal and near-counterexample controls.
- **Common artifacts:** Making every weakness self-sublating; importing outside values while claiming immanent critique; treating any exception as a counterexample; changing several conditions at once; using analogy instead of a case that satisfies the premises; cherry-picking an out-of-range instance; mistaking surprise for logical force; and letting a vivid failure scene turn a bounded correction into total demolition.
- **Escalate / stop:** Escalate when complementary fractures expose a hidden question. Stop when the position is incoherent, the issue is a simple factual error, or the scope and premises cannot distinguish an admissible case from a near miss. A null result is valid.
- **What it requires:** One deep analysis; can be done here for one position, while the dialectic workflow keeps it in the round file.
- **Execution placement:** **Orchestrator.** It sees the full position, evidence, interview lineage, and prior structural work because immanent continuity matters. A subagent may challenge a completed fracture as a control but must not replace the primary scan. If continuity is missing, re-ground from the record before running. Return candidate fractures and their traces without turning them into a synthesis.
- **Provenance:** The counterexample route adapts Venkatesh Rao's [“UnAha!” account](https://ribbonfarm.com/2008/03/05/unaha/) and its later treatment of counterexamples as [anti-strategies](https://ribbonfarm.com/2011/05/16/strategies-counter-examples-and-the-unaha-experience/). Rao uses a carefully constructed case to overturn an apparently necessary conclusion and expose the assumption beneath certainty. The card keeps a stricter immanent requirement: a qualifying counterexample must satisfy the position's own premises and scope.
