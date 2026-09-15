# Authority-boundary follow-up to the hostile assay

Date: 2026-09-15. Continuation of the [v0.1 hostile assay](05-hostile-assay.md),
using the new [authority addendum](06-authority-boundary.md). This is not a second
fresh-independent result or a new full instrument run.

**A sound evidence graph needs an enforced authority boundary before its
conclusions can constrain an agent.** The additional premise is that the agent
cannot grant itself permission by changing the evidence, accepted controls,
derivation or consumer it is supposed to satisfy. That premise must hold at the
actual action boundary, not just in the report.

This does not require every component to be outside the repository. It requires
a stated boundary between what the agent may propose and what becomes
operationally authoritative. This follow-up does not select how to enforce it.

## Four bounded attacks

### A1 — A supplied receipt impersonates a runner observation

**Disposition: required authority premise, not a demonstrated vulnerability.**

An agent edits a project-local receipt to say that a check passed, with the right
code hash and a plausible runner ID. The graph is internally consistent. Its
accepted rule grants selective refresh because it treats those fields as a
runner-produced observation.

The broken link is from the record's assertion of origin to its actual origin.
A hash can bind content without establishing who observed it. Merely deriving
admission instead of storing it does not solve this: a correct derivation can
consume fabricated premises.

**Repair condition:** distinguish agent-supplied material from observations
whose origin and captured execution context the consumer is authorized to
trust. Define which sources can establish each premise. Untrusted material may
start an investigation or remain a proposal; it cannot impersonate an accepted
runner observation. Manual inspection can still be an accepted evidence method
when a rule explicitly defines its role and limits.

**Decisive probe:** insert or alter an otherwise well-formed receipt through the
ordinary agent-edit path. It must not acquire runner authority merely because
its fields parse. The probe needs the real ingestion and consumer boundaries;
a model that labels its own inputs “trusted” has assumed the disputed premise.

**Limit and consequence:** the addendum already demands this distinction but
selects no enforcement. If the distinction fails, an unsupported claim can
cause an incorrect optimization. This is stronger than merely losing useful
evidence and doing extra work.

### A2 — An authentic run uses a false oracle law

**Disposition: semantic limit of runner authority; accepted-control requirement.**

The runner really executes the stated code, captures the actual inputs and
observations, and reports a passing comparison. Both implementations return
wrongly ordered rows because the agent changed the comparator to sort away
order, although the product rule promises order.

An authentic observation establishes what ran and what it observed. It does
not establish that the comparison answers the product question. Even independent
code can encode the same wrong rule. A successful subprocess exit is weaker
still: it may not show that the intended assertion ran.

**Repair condition:** bind use to the accepted law, relevant method version,
observation and controls. Keep evidence for path reach and checker sensitivity
separate from the runner's origin. Treat a proposed change that changes what
counts as acceptable behavior as a control change under the RFC's review rule.
A new useful test inside existing controls need not trigger a new approval.

**Decisive probe:** preserve an ordered-result requirement while replacing its
comparison with unordered membership. The authentic green receipt must not
inherit permission to satisfy the old ordered requirement. Separately show that
an unchanged accepted comparison rejects a within-scope wrong order.

**Weakening evidence and consequence:** the candidate, addendum and oracle guide
already describe these distinctions. This is a test of their enforcement, not
a discovery that bounded oracles are invalid. An accepted rule can still admit
a scoped sampled result without claiming a universal proof. If the semantic
boundary fails, trustworthy execution can lend authority to the wrong law.

### A3 — A proposed control change becomes its own approval

**Disposition: required separation of control proposal and acceptance.**

A rule requires ordered comparison. The agent proposes a weaker rule, marks the
proposal accepted in an editable file, and re-runs a test. A versioned graph
correctly records that the new version now passes. Versioning preserved history
but did not establish authority to change the rule.

**Repair condition:** acceptance of a control change must come from the
applicable authority defined by the project's review policy. The RFC already
requires human review of proposed acceptance-control changes. Record what was
accepted so that later edits cannot borrow that acceptance. Historical results
remain associated with their original controls. Proposal, acceptance and new
execution are separate facts even if stored compactly.

**Decisive probe:** change the comparator or acceptance criterion without changing
production code, and supply a self-authored acceptance status. The current use
must continue to evaluate under accepted controls or show that new admission is
unavailable. A subsequent legitimate acceptance must apply to the reviewed
change, not to arbitrary later contents sharing its label.

**Limit and consequence:** this does not require human review of every test,
endpoint edit or normal run. It does require the selected policy's acceptance
boundary to exist. Otherwise the agent can erase the standard it is meant to
satisfy while leaving a tidy audit trail.

### A4 — The consumer bypasses a correct denial

**Disposition: required enforcement and deployment premise.**

The graph correctly denies selective refresh. The agent changes the consumer to
skip its admission check, or deploys an artifact whose gate differs from the one
bound to the decision. The report remains honest, but the action does not follow
it.

**Repair condition:** identify which actions the evidence system actually
controls and where accepted consumer behavior is enforced. Those actions must
consult applicable decisions, including withdrawal, through a path the agent
cannot silently bypass within its granted authority. Bind the consumed decision
to the relevant artifact and context. Keep permission to edit or deploy separate
from technical support for the optimization: neither substitutes for the other.

**Decisive probe:** deny admission and attempt the optional optimization through
the real consumer, including an alternate entry path if one exists. An
agent-proposed gate removal must not become operative solely by passing checks
whose authority that edit removes.

**Limit and consequence:** this is not a requirement to defend against an actor
with unrestricted authority over every runner, policy and deployment component.
If the agent has that authority, the claimed containment must be narrowed. If
the system is advisory, say so. For a system that claims to constrain autonomous
actions, a report-only gate is insufficient even when its logic is flawless.

## What this supports

These attacks distinguish three kinds of warrant:

- **Observation:** an authorized source recorded this execution and these facts.
- **Interpretation:** an accepted rule permits this bounded conclusion from those
  facts, with named assumptions and semantic limits.
- **Authority:** the actual consumer and action path enforce that conclusion under
  the applicable project permissions and accepted controls.

No one of these establishes the other two. The word “airtight” can describe a
strict rule against unsupported elevation of authority. It cannot turn a finite
oracle into universal truth or make unobservable external assumptions certain.
Nor does an internally consistent graph establish that every required premise
was discovered.

The minimum next design input is a concrete account of who may propose and who
may accept each of the four boundary transitions above, plus the real consumer
boundary each acceptance governs. Choose that account before choosing files,
signatures, services or a larger trust infrastructure. The probes here are
constructed acceptance criteria; none has been executed.

The original candidate SHA-256 remains
`5148174df0503857d2a0e2678e35c3e123762d74cf5e3dfbf182edea5ff935ad`.
The original audit was preserved unchanged; its SHA-256 is
`7d409d5480ec5e6f9acad8740c81ddc7a2b24f3462675d156b0d9d5b64ba6675`.
No implementation, enforcement scheme or new approval process was selected.
Whether these controls earn development teams' trust remains an empirical
question beyond this follow-up.
