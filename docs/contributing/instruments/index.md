# Design and review instruments

Use an instrument when a specific uncertainty makes ordinary implementation or
review insufficient. Read only the relevant card. Choose and use it within the
user's authorized task; these cards do not require a separate approval for each
reasoning step or a fixed workflow.

| Uncertainty                                                           | Instrument                                  | Result                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| What behavior should this subsystem promise?                          | [Law discovery](law-discovery.md)           | A sourced candidate law, competing predictions, and a distinguishing witness. |
| Could the implementation, model, or law itself be wrong?              | [Adversarial review](adversarial-review.md) | Concrete attacks at named levels, their evidence, and repair conditions.      |
| Would a plausible wrong implementation still pass the oracle?          | [Mutant gap hunt](mutant-gap-hunt.md)       | A semantic mutant, public distinction or scoped equivalence, and a contract-supported verdict. |
| Do sound obligations conflict under the same conditions?              | [Tension scan](tension-scan.md)             | A traced collision, missing distinction, or no supported tension.             |
| Should these laws or concepts be merged, split, replaced, or removed? | [Law restructuring](law-restructuring.md)   | An alternative organization and a check of what it preserves or loses.        |

These are reasoning aids, not additional oracle conformance requirements. The
[oracle guide](../oracle-tests.md) owns testing requirements. Use the
[glossary](../glossary.md) and the relevant architecture and contract sources.
The authoring and review skills route oracle work here; the cards can also help
with architecture and other design questions.

Keep source statements, observed behavior, generated examples, hypotheses, and
design judgments distinguishable. An existing contract constrains correctness
claims and can itself be challenged in a design proposal. Adopting a changed
contract requires the authority appropriate to the task; an instrument result
alone does not authorize changing product expectations.

Carry forward the question, selected operation, source pointers, concrete
witness, and unresolved part in the task's normal notes or review. A separate
log or formal schema is unnecessary. No finding, no supported tension, and an
unsuccessful simplification are useful results. A reasoning witness is not an
executed test, and passing sampled histories is not universal proof.

These compact DB adaptations draw on Field Lab's assumption and boundary
probes, hostile failure assay, tension statement, structural recombinator, and
position-preservation assay. They change the routing for repository work and
extend critique to the suitability of the law itself. They are self-contained;
Field Lab installation, its logging system, and its runtime are not required.
