# Guide-word Sweep: preparation record

Status: **prepared; content review has not run**. Instrument: guide-word-sweep.
Date: 2026-09-15. Candidate: [lifecycle v0.1](03-lifecycle-draft.md), frozen at
the SHA-256 recorded in [the worksheet JSON](04-guide-word-worksheet.json).

## Study definition

Purpose: expose deviations in an evidence lifecycle intended to produce honest
endpoint assessments and useful, ordered risk-reduction work. Lifecycle stage:
design draft. The declared intent and limits are those in the candidate and
[brief](00-brief.md). The theory is not implemented, and no operational safety
or probability claim is made.

Current sources: the user’s stated aim, RFC rules/checks/results and control-change
review, oracle guide, current prototype observations in the categorization.
No production incident history for an evidence store exists in this packet.
The known prototype limitations are source observations, not evidence-store
failure measurements.

Excluded: unrelated external-write discovery, universal proof of arbitrary code,
new replication machinery, compiler-inserted auth, probabilistic risk scoring,
and claims of coverage for coupled multi-failure behavior. Adjacent systems are
the compiler, real test runner, artifact storage, build/runtime consumer and
application/deployment configuration.

## Nodes and parameters

Parameters are proposed for this design review; they were not measured from a
deployed system. Shared context binding and consumer authority span the nodes.

| Node | Declared intent | Parameters expanded |
| --- | --- | --- |
| N1 | Discover applicable requirements and their subjects. | Requirement coverage; subject identity. |
| N2 | Derive supported facts and retain residual unknowns. | Effect completeness; binding context. |
| N3 | Run checks and capture what actually happened. | Production path; observations. |
| N4 | Decide which use the evidence supports. | Admitted scope; support composition. |
| N5 | Apply the decision at its bound consumer/context. | Consumer authority; use timing. |
| N6 | Render open obligations and ordered useful work. | Priority rationale; assessment coverage. |
| N7 | Invalidate and recheck affected support. | Dependency closure; revalidation order. |
| N8 | Close tasks without erasing limits; retain history. | Completion criterion; history retention. |

The [complete worksheet](04-guide-word-worksheet.md) has **112 candidate
questions**: 8 nodes × 2 parameters × 7 guide words. Every parameter receives
`No`, `More`, `Less`, `Part of`, `As well as`, `Reverse`, and `Other than`.
No extra domain guide word substitutes for a fixed word. Several questions may
be duplicates or meaningless; only content review can give their disposition.

## Roles and missing review

| Responsibility | Current owner/status |
| --- | --- |
| Freeze record, expand pairs, validate accounting | Codex; preparation completed. |
| Intended app/framework behavior and credible deviations | Framework maintainer/content reviewer; unassigned. Kyle can supply this judgment if he chooses. |
| Compiler/runner/runtime feasibility and shared controls | Relevant implementation reviewer; unassigned. |
| Product consequence, priority and accepted tradeoffs | Product/engineering owner; unassigned. |
| Corrective action ownership and completion acceptance | Assigned during content review; currently none. |

The fresh hostile agent is a separate adversarial reading, not a substitute for
the competent review this card requires. No reader has yet classified the
worksheet's credibility, consequences or safeguards.

For each row, a reviewer should decide: credible; information needed; not credible
with reason; or not applicable. For a credible deviation, record initiating and
enabling causes, immediate/downstream consequences, affected parties, actual
preventive/detective/mitigative safeguards, their dependencies, control-failure
consequences and warning signs. Draft mechanisms are not existing safeguards.

Only after those judgments should actions receive recommendations, accountable
owners, due dates, completion evidence and residual gaps. Rejection must keep its
reason. No action is marked closed because an LLM populated a field.

## Questions needing content decisions

1. Which node intents accurately describe the framework we want, and which
   impose unnecessary machinery on simple checks?
2. Which constructed deviations are feasible in the intended deployment/build
   model, including the lifetime of running clients?
3. Which acceptance/control changes can the agent make under existing project
   authority, and which require a separately authorized decision?
4. What can be inferred about consequence and urgency automatically, and what
   must remain an explicit product choice?
5. Which mitigations really exist at each boundary? In particular, does disabling
   future optimized use also repair state produced under an earlier decision?

These are reviewer questions, not five findings with accepted consequences.

## Review and revalidation

Proposed review checkpoint: **before adopting the lifecycle or implementing its
admission rules**. Calendar review date: not set. No automation was created.
Material changes to claim scope, runner, schema, evidence storage, acceptance
rules, report/task logic or deployment topology require revisiting affected
nodes and shared controls. The new user “logic container” requirement is recorded
as a later addendum rather than silently changing this frozen worksheet.

Completion evidence for this preparation is exact pair coverage, source pointers
and a readable worksheet. Completion of the actual sweep additionally needs the
review judgments and action dispositions above. Closure would mean those actions
were dispositioned, not that the deviations became impossible.

## Instrument limit

The [Guide-word Sweep card](/Users/kylemathews/programs/linux-config/skills/field-lab/reference/instruments/guide-word-sweep.md)
states that an LLM “does not decide credibility, consequence, adequacy, or
closure” and, without competent review, must “return only a preparation
artifact.” That is why this stage is prepared rather than completed.

The worksheet may create false completeness, repetitive questions or apparently
equal importance across rows. Node decomposition can hide coupled failures and
shared controls. Its size is an accounting result, not evidence of risk coverage.
