# Evidence lifecycle candidate v0.1

Status: draft for challenge, not implemented or selected as a public API.
Date: 2026-09-15. Source trace: [frozen brief](00-brief.md), especially the user
corrections, RFC rules/checks/results/composites, and oracle guide. Baseline code
observations are in [the categorization](../05-categorization.md).

## Claim and success standard

An endpoint assessment is a projection of requirements, facts, checks and open
issues. It can give an agent useful ordered work without equating a green run
with a whole-endpoint guarantee. Shared helper and composite obligations are
first-class subjects; endpoint views show the relevant dependencies.

Success: the report explains which behavior is established under what conditions,
which uncertainty remains, what decision may rely on the evidence, and the next
action with a checkable completion criterion. This draft proposes no probability
of correctness, universal goodness score, automatic auth edits or sync engine.

## Records and boundaries

| Record | Required meaning |
| --- | --- |
| Requirement | Stable rule ID and subject (endpoint, helper, query/mutation relationship or composite); behavior, applicability, dimension and source of the rule. It exists even before a test is written. Unknown applicability is explicit, not silently not-applicable. |
| Claim | A proposition about code/behavior with subject version, input/state/history scope, observation point, assumptions and relevant environment bindings. Claims about completion, table effects, authorization and repeatability remain distinct. |
| Check | Method and version, required inputs, claimed observations, actual production path, reference/model and declared shared semantic dependencies. Static derivation, inspection, exhaustive checks and sampled oracles remain different methods. |
| Result / receipt | Run identity, captured code/method/environment versions, check status, observations, coverage/reach and fault controls where relevant, raw evidence reference and replay instructions. Missing fields may limit the claim; they cannot silently create support. Historical results remain immutable. |
| Use decision | Consumer/rule version, exact required premises, supporting records and context compatibility, admitted scope, current applicability and behavior when support is absent. This is a derivation from evidence; it is not the same as a check result. |
| Issue / task | Requirement and affected views, defect/unknown/stale/check-error/design-choice classification, consequence and current mitigation, proposed action, prerequisites, completion evidence and ordering rationale. Task completion may leave part of the requirement unresolved. |

The names are conceptual records, not six mandatory classes or files. Start with
a few built-in rules. Do not require applications to hand-author all these fields
or choose a new policy switch for every endpoint. Compiler and runner supply
what they know; an agent fills the specific missing inputs.

## Supported conclusions and method choice

**Automatic derivation.** A built-in rule recognizes a supported SQL/catalog
case and establishes its premises. The compiler can enable a corresponding
optimization without an application task. Framework oracles test that general
rule; the compiler derivation is attached to the application use.

**Application-specific check.** If a rule permits test evidence for a particular
unknown, a reusable harness executes the actual application path. It records
its generated domains, checkpoint observations, reference independence, reached
path, meaningful fault controls and replay. A result can say “agreement observed
for these histories”; an admitted use must say the broader scope, if any, in
which the rule permits relying on that result. Neither label is a theorem.

**Inspection or deterministic check.** An agent can inspect a particular
library's control flow, database binding or installed validator and supply the
bounded fact the consumer needs. Standard patterns should move into reusable
compiler analysis when practical. A sampled execution is not mislabeled an
exhaustive source derivation, and a written assertion is not executable validation.

**Unknown or missing behavior.** A mock can support a client-side comparison
under its contract while the real provider premise stays open. Lack of provider
access is recorded. A fact cannot create transaction isolation, auth enforcement
or completion tracking that the application lacks.

The initial implementation should have a fixed, inspectable acceptance rule for
each supported use, rather than invent a user-facing evidence-strength option.
**Open design decision:** precisely which app-specific oracle domains and
controls suffice for each optimization use. This draft does not authorize an
arbitrary sampled pass to enable arbitrary production scope. Useful passing
results may be retained before an automatic admission rule exists.

## Eight lifecycle nodes

### N1 — Discover requirements and subjects

Start from framework promises and applicable authored product rules, not the
list of available tests. Record applicability as known-applicable, known-not-
applicable with a reason, or unresolved. Endpoints link to shared helpers and
composites; stable IDs and version bindings are separate. A rename is not a
license to erase unresolved work.

### N2 — Derive facts and expose residual questions

Run available static/schema analysis at build time. Preserve known facts while
marking uninspected parts. For dependency matching, a partial SQL set cannot
masquerade as the entire handler's bound. Emit a specific missing premise and
the methods that might establish it. No runtime catalog scans are introduced.

### N3 — Produce and capture evidence

Execute the selected check against a captured code/method/environment context.
Retain passed, failed, not-checked, out-of-date, check-error and disabled as
distinct RFC result states. Preserve the primary failure, original/reduced trace,
and cleanup diagnostics where relevant. Redact sensitive payloads from checked-in
receipts while retaining enough structure to interpret and reproduce the law.

Reach, assertion reach and fault sensitivity are distinct fields when the claim
depends on them; not every small check needs a giant test harness. References to
raw artifacts must make absence detectable. Merely listing a replay command is
not evidence that replay reached the stated mismatch.

### N4 — Evaluate support and admit a use

Match claim subject, domain, observation and assumptions against the consumer's
premises. Resolve supporting facts in a compatible context; reject circular
support as insufficient. Preserve contradictory results. A later green run does
not by recency alone erase a counterexample for the same code/claim context.
Resolution needs a reason such as a code fix, invalid expectation, changed scope
or an explained nondeterministic outcome under the actual law.

A requirement may have useful support and remain unresolved. A run may pass
while its proposed use is not admitted. Rules with accepted bounded test evidence
must name that mode of support; they cannot display “statically proved.”

### N5 — Consume the decision

Build/runtime consumers use the decision only with its bound subject/rule/context.
For an optional optimization, missing support selects the established baseline.
For incomplete effects after the relevant write boundary closes, that can mean
full refetch. For unfinished writes or absent auth, full refetch is not a remedy;
report the unmet behavior/requirement using the existing error/diagnostic policy.

The consumer must not upgrade historical results to current facts. Context
assumptions that cannot be bound to the execution remain explicit limits;
unobservable remote changes are not magically detectable by local hashes.

### N6 — Render assessment and order work

Render per-dimension requirements, their current use decisions and gaps. Show
why a task is ordered where it is. Keep evidence status separate from consequence.
One proposed ordering procedure for the prototype is:

1. Identify obligations with demonstrated consequences or plausible in-scope
   failure paths, recording impact, exposure, urgency and existing safeguards.
   Where those facts are unavailable, label them unknown; do not invent scores.
2. Put currently unmitigated consequential failures and targeted investigations
   of consequential unknowns before work that only saves optional effort, using
   established framework consequences and authored product priorities.
3. Respect action prerequisites. If investigation is needed to choose a safe fix,
   show that dependency instead of proposing a guessed fix.
4. Within genuinely comparable work, use impact/urgency and then effort as an
   explicit tie-break. With unresolved value tradeoffs, show the incomparable
   tasks together and request the missing product decision.

The UI may show a linear order for convenience; it must expose ties, prerequisites
and the basis for that order. No count of green checks or completed tasks measures
the probability of correctness. An unknown concern can be urgent without being
presented as a confirmed defect. A satisfied prerequisite is progress even if
the final risk has not yet been mitigated.

### N7 — Revalidate on change

Changes to relevant source, schemas, check methods, acceptance rules, hooks,
configuration or inspectable remote identity mark dependent uses out of date.
Preserve unrelated supported facts. A rerun against changed code creates a new
receipt. Open issues are version-aware: resolving an old-context issue does not
automatically close a new-context issue.

A code change that also changes a comparator or acceptance criterion is a
control change, not simply another green run. Preserve its explanation and use
the RFC's review requirement for accepting changed controls. This does not impose
a human approval step for every ordinary test addition or endpoint edit.

### N8 — Close, retain limits and reopen

Close a task only against its named completion criterion; update the associated
requirement separately. “Ran oracle” is not synonymous with “established the
whole guarantee.” Retain tested scope, unresolved premises and superseded evidence.
If new evidence contradicts support or dependencies change, reopen affected uses
and tasks. Acknowledged/disabled requirements remain visible with a reason; they
do not become passing claims or automatically admit unsafe optimizations.

## Example derived report

Illustrative, not an executed assessment of Kitchen AI:

```text
Subject: updateRecipe -> shopping helper -> retained query family

Validation: supported by compiler/runtime schema path for the captured code.
SQL effects: recipes known; shopping helper effects unresolved.
Optimistic/settled rows: oracle comparison passed in tested apply=false histories.
Provider premise: actual apply=true path has not been exercised or inspected.
Selective refresh: not admitted for the unresolved helper path.
Current mitigation: full refetch, conditional on helper writes finishing at return.
Completion: that condition is unresolved for the queued variant.

Next action: establish whether the real helper's promise covers its PG writes
            on success, failure and timeout.
Why now: early refetch could retire optimism before the endpoint's writes happen.
Completion: trace the real helper boundary or run a controlled integration check
            that observes the write event and publication; retain unsupported paths.
Next dependent action: establish the helper effect bound / differential equivalence.
```

The report can retain a useful green result and still show an urgent unknown.
It does not reject oracles merely because their scope is bounded.

## Candidate obligations for later model/oracle work

- Removing required evidence never silently increases the scope of an admitted
  use. Ordinary fallback can preserve behavior while increasing work.
- Adding an unrelated green receipt never closes another requirement.
- Evidence from incompatible contexts cannot jointly establish a use.
- A counterexample remains visible until its disposition is justified.
- A stale receipt cannot authorize a current use just because its timestamp is
  later than another receipt's timestamp.
- Changing a method or law cannot silently inherit its predecessor's credit.
- Task closure and requirement support have separate, testable transitions.
- A shared-fact change invalidates all known dependent views; completeness of
  dependency discovery remains a separate obligation.
- Order explanations preserve prerequisites and expose missing product priorities.

These are proposed laws, not passing tests. A small future model can generate
receipt arrivals, source edits, conflicts, task closures and context changes,
then compare derived reports and use decisions. Actual integration still needs
the real compiler, runner and consumer boundaries; a store-only model cannot
establish those adapters' behavior.

## Open questions for challenge

1. What minimum admission contract connects a sampled app oracle to a production
   optimization domain without requiring an impractical universal proof?
2. How can version/assumption closure be both sufficient and cheap, especially
   for remote behavior we cannot observe changing?
3. How should the system express credible but unmeasured consequences and
   priorities without prompting for a policy on every endpoint?
4. Which shared subjects must be discovered automatically, and what happens when
   discovery itself is incomplete?
5. What is the smallest useful evidence format that supports these distinctions
   without creating a second application framework?

No implementation complexity or runtime cost was measured. The draft risks
overstructuring simple checks; its record distinctions can share storage and
need not all become public concepts. It awaits the selected challenges.
