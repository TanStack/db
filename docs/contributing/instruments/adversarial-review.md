# Adversarial review

**Use when:** a model, oracle, or proposed law needs a concrete challenge.

**Inputs:** one artifact or candidate, its sources, claimed domain, and success
criterion. Prefer a fresh reviewer that has not seen the author's desired
verdict. Without that separation, report a self-critique rather than independent
validation. Delegation remains subject to the task's authorization and tools.

## Operation

Start with a plausible way this account could be wrong. Select the relevant
levels; they are different questions, not a mandatory sequence:

| Level       | Attack                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------- |
| Enforcement | Seek a legal history or wrong output the oracle cannot distinguish. Check path reach.    |
| Formulation | Challenge premises, guarantees, checkpoints, observations, and available information.    |
| Suitability | Ask whether the law serves its intended use, citing authority or a concrete consequence. |
| Composition | Find obligations that conflict, duplicate, or need shared ordering or authority.         |
| Concepts    | Challenge identity, state, ownership, and boundary distinctions.                         |

For formulation, seek legal histories that require incompatible public
observations. Try a correct alternative implementation and a plausible wrong
one. For suitability, name the external contract, standard, user consequence,
or engineering reason that applies. For composition, use the tension or
restructuring card when needed. For concepts, describe the case without its
current names and check what becomes visible or gets lost.

### Locate the repair

The attack level names what to challenge. Once evidence shows a problem, use
this table to locate the repair:

| Finding or question                                                             | Possible repair location                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Production disagrees with an accepted law.                                      | Production code.                                                          |
| The reference predicts behavior the law does not allow.                         | Reference model; revise an accepted law only with authority.              |
| The law needs information the production path lacks at the promised checkpoint. | Provider, protocol, architecture, or an authorized contract decision.     |
| The check rejects an allowed intermediate observation or accepts a wrong one.   | Evaluation: checkpoint, history grammar, driver, recorder, or comparison. |
| Correct behavior still fails the user's need.                                   | Requirement and its suitability for the intended use.                     |

These locations can overlap. Name the evidence for each before choosing a
repair; an assertion change cannot resolve a code defect or supply missing
information.

To test whether a path has enough information, keep its initial state and inputs
identical through the claimed checkpoint. Test a nearby production path that
receives the missing distinction before that checkpoint. An accepted contract
remains an obligation even if the current path lacks the information needed to
meet it. A repair might require additional provider data. Moving the promised
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
