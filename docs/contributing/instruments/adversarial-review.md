# Adversarial review

**Use when:** a model, oracle, or proposed law needs a concrete challenge.

**Inputs:** one artifact or candidate, its sources, claimed domain, and success
criterion. Prefer a fresh reviewer that has not seen the author's desired
verdict. Without that separation, report a self-critique rather than independent
validation. Delegation remains subject to the task's authorization and tools.

## Operation

Start with a plausible way this account could be wrong. Select the relevant
levels; they are different questions, not a mandatory sequence:

| Level       | Attack                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enforcement | Find a legal history or wrong output that the model, generator, driver, or recorder cannot distinguish. Can the intended production path remain unexercised while the test passes?             |
| Formulation | Find omitted premises, excessive guarantees, wrong checkpoints, ambiguous observations, or missing information. Can two legal histories indistinguishable to production require different promised results? Try a correct and a wrong implementation. |
| Suitability | Question whether the promised behavior is desirable, safe, or conventional. Name the external contract, standard, user consequence, or engineering reason that makes the objection applicable. |
| Composition | Find obligations that conflict, duplicate each other, or require a shared ordering or authority rule. Use the tension or restructuring card if that is the material uncertainty.               |
| Concepts    | Question the chosen identity, state, ownership, or boundary distinctions. Describe the same case without relying on its current names and check what is lost or becomes visible.               |

The attack level names what to challenge. Once evidence shows a problem, locate
what needs repair separately:

| Finding or question | Possible repair location |
| --- | --- |
| Production disagrees with an accepted law. | Algorithm or code. |
| The reference predicts the wrong behavior. | Model or specification; a change to an accepted law needs its own authority. |
| The promise requires information the path does not receive. | Provider, protocol, architecture, or an authorized decision about the promise. |
| A wrong result passes the evaluation. | History grammar, production driver, recorder, or comparison. Correct a coverage claim if the case lies outside declared scope. |
| Behavior satisfies the specification but fails the user's need. | Requirement and its suitability for the intended use. |

These locations can overlap. Name the evidence for each before choosing a
repair; an assertion change cannot resolve a code defect or supply missing
information.

For an information-sufficiency attack, keep the path-visible initial state and
inputs identical through the claimed checkpoint. Test a nearby receiving path
that supplies the missing distinction before that checkpoint. An accepted
contract remains an obligation even if the current path lacks the information
needed to meet it. A repair might supply a provider signal. Moving the promised
checkpoint or narrowing the guarantee needs an authorized contract decision;
changing an assertion supplies no data.

For each material attack, name the broken claim and construct a small legal
history or concrete failure scene. State the competing expected observations,
the evidence that could decide between them, and a possible repair condition.
Check that the attack is within scope and that its standard actually applies.
An outside-domain case may motivate a scope change; label that proposal.

When execution is authorized and practical, run the discriminating experiment.
A hostile control must reach the intended comparison to demonstrate rejection.
Use the oracle guide's calibration and mutant-outcome rules. A source-level
argument can remain useful when execution is unavailable; label it accurately.
For a systematic search across plausible wrong implementations, use the
[mutant gap hunt](mutant-gap-hunt.md) to design semantic edits and classify
survivors.

**Return:** supported defects, design objections, and untested hypotheses as
separate kinds of finding, with sources, witnesses, outcomes, and repair
conditions. For bugs, identify the test gap that permitted the class of failure.

**Control:** explain what would defeat the criticism. Check whether the attack
would also reject a valid implementation or depend on a condition the contract
excludes. Do not presume a defect merely because the stance is adversarial.

**Distortion:** generic pessimism, irrelevant external standards, author capture,
or treating a preferred design as evidence of a current correctness bug.

**Stop when:** the material attacks have evidence or an explicit unresolved
experiment. No supported finding is a valid result. Challenging a law does not
silently replace it.

Adapted from Field Lab's hostile failure assay; DB's version also permits
explicit criticism of the candidate's standard and conceptual organization.
