# Addendum: the agent's logic and authority boundary

User statement received while lifecycle v0.1 was undergoing blind review:

> another way of thinking about this all is we need a air-tight logic container
> for the agent to work within — only then will dev teams trust this system to
> work independently

This is a new design requirement and rationale, not empirical evidence that a
particular mechanism produces team trust. It extends the active inquiry; it does
not cancel the selected instruments or retroactively alter their frozen specimen.
The hostile reviewer initially receives v0.1 only. Any follow-up review of this
addendum must be recorded separately.

## Proposed interpretation for the next candidate

The tightly enforced part is the relation between agent work, accepted evidence,
derived conclusions and permitted actions. The system cannot guarantee that
all arbitrary external facts are true merely by storing them. It can prevent
an agent's unsupported assertion from silently becoming a machine-granted right
to skip reads, dismiss a requirement or change an acceptance rule.

Separate these roles even if their implementation starts small:

- The agent proposes code, checks, claims and supporting material.
- A check runner records which code/method actually executed and what it observed.
- A versioned acceptance rule determines what that evidence permits a consumer
  to conclude, including its assumptions and scope.
- A consumer derives its allowed behavior from that decision in the applicable
  context; prose and a self-assigned status do not grant permission.
- Control changes are explicit changes to the rules of acceptance, with the
  separate review already described by the RFC. They are not ordinary results.

The general check runner is not itself an infallible semantic authority. Its
method and adapter have their own tests and assumptions. Actual production-path
reach, comparator independence and fault sensitivity remain meaningful evidence
questions; a successful subprocess exit cannot discharge them all.

## Questions this adds to the stress test

| Boundary | Failure construction to test | Desired observable distinction |
| --- | --- | --- |
| Propose versus admit | An agent writes `passed` or an admission object directly into an editable record. | A supplied claim/result is distinguishable from a decision derived under accepted rules; editing a record does not bypass the consumer. |
| Test code versus acceptance rule | An agent changes both implementation and comparator to agree on a wrong result. | Method/law/control changes remain visible and do not inherit prior acceptance automatically. |
| Evidence scope versus use scope | A valid finite oracle receipt is reused for another branch or deployment. | The consumer shows exactly why the use is or is not permitted; no implicit widening. |
| New evidence versus old permission | A counterexample arrives after an optimization was admitted. | Current admission is reconsidered; already-produced client state and outstanding requests have explicit handling. |
| Report versus action | A task says a prerequisite is complete even though its receipt is absent. | Completing prose does not change the underlying requirement/use decision. |

These are additional constructed probes, not executed tests or a claim that v0.1
already has a security vulnerability. The workflow threat includes ordinary agent
mistakes and incentive to obtain a green result. Protection against an adversary
with unrestricted control of the runner, policy and runtime is a different
deployment trust question; a project-local evidence file alone cannot supply it.

Useful bounded oracles remain admissible evidence under explicit rules. The goal
is a strict account of what they authorize, not a demand for universal proofs or
manual approval for every normal endpoint change. Existing tool, repository and
deployment permissions remain separate from evidence-derived technical support.

No engine, enforcement boundary, signature scheme or new approval process has
been implemented or selected by this addendum. Its interpretation awaits the
next candidate design and focused tests.
