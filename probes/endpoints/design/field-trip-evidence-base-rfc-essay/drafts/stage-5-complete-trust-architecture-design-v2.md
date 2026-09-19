# TanStack Trust RFC — complete architecture-first design v2

**Selected outline:** TA-1, layered architecture with just-in-time examples  
**Borrowed from TA-2:** one deliberately simple whole-system map after the
opening problem; final decisions grouped by architectural plane  
**Detailed source-traced outline:** stage-5-trust-architecture-revised-outlines.md  
**Status:** Approved for source-bound drafting by Kyle's “ok do that”  

## Frozen organizing rule

Trust architecture is the subject. The reader moves through its prerequisites:

1. human guarantee work and safe automation;
2. authority and refusal;
3. static evidence graph;
4. reach, applicability, and freshness;
5. contradiction, replay, and expiry;
6. explanation and agent work;
7. one operation service and bounded persistence;
8. domain integration and consumer policy;
9. current Endpoints implementation evidence;
10. plane-grouped decisions and dependency-respecting build work; and
11. the later-agent success condition.

Endpoints appears only in a reusable miniature fixture and a late
implementation audit. Each callout illustrates the current architectural
concept without retelling the feature design.

## Local disclosure rule

Every architectural section proceeds through:

1. the practical question;
2. one minimal example;
3. the precise rule or representation; and
4. current status, unresolved boundary, or prohibited inference.

The simple account must remain true after the technical account appears.

## Reusable Endpoints miniature

One retained query and one mutation share a build artifact. The query may skip
its refetch only when the collection has an authority baseline, no optimistic
or repair obligation is pending, both effect bounds are complete, and the
query's reads do not intersect the mutation's writes. External writes are
outside the law.

Later sections may refer to this miniature to illustrate:

- domain-owned claim semantics and consumer-owned enablement;
- pass, fail, unresolved, no observation, and operational failure;
- rule application and route support;
- analyzer, artifact, or environment dependency revision;
- a challenge opened by an observed failure;
- rejected earlier-started, cached, same-batch, or alternate repair;
- accepted post-failure same-case replay and later expiry; and
- one assessment exposed through CLI, LSP, and MCP.

No later callout repeats the full fixture unless the local rule cannot be
understood without it.

## Section sequence

0. **Abstract: safely automate guarantee work**
1. **The authority Trust has—and refuses**
2. **The evidence graph**
3. **Current evidence: reach, applicability, and freshness**
4. **Contradiction, causal repair, and expiry**
5. **Explanation is an operation**
6. **Safely automating the lifecycle**
7. **One service, several interfaces, bounded persistence**
8. **Domain integration and consumer action**
9. **What exists in Endpoints today**
10. **Open decisions and build dependencies**
11. **What a later agent must recover**

The detailed per-section questions, source concepts, examples, transitions,
scale, disclosure, and reader contributions are frozen in TA-1.

## Whole-system map

After the opening problem and one generic bounded guarantee, show only:

domain defines meaning and checks → Trust maintains evidence and history →
consumer policy decides action

Workflows and interfaces sit below that path as carriers. The map must not
introduce the full primitive vocabulary, state machine, interface matrix, or
package topology. Those arrive in their prerequisite sections.

## Packaging

The previously selected P2 packaging remains accurate under the corrected
outline:

- **Title:** TanStack Trust: A Base for Domain-Owned Software Guarantees
- **Subtitle:** Separating domain meaning, reusable evidence mechanics, and
  consumer policy
- **Description:** TanStack Trust is a proposed base layer for building evidence
  systems inside specific software domains. Domain packages own what their
  guarantees mean and which checks have authority; the base maintains
  inspectable support, contradiction, freshness, and repair records; consumers
  decide what that state permits. This RFC defines those handoffs, shows the
  bounded Endpoints vertical, and identifies what remains unimplemented or
  undecided.

The title names the architecture, not a standalone product. “Base” continues to
mean narrow authority, not small implementation or separate distribution. The
earlier title framing-sensitivity result remains applicable.

## Writing constraints

- State the useful capability/deployability, bounded-promise, tested-control,
  and maintenance reasoning directly; do not require AIUC familiarity.
- Do not mention the internal Design Grammar in reader-facing prose.
- Do not use “silently.”
- Prefer concrete actors and actions before abstract inventories.
- Put status and limits at the point where a mechanism is introduced.
- Preserve the exact distinction among implemented, bounded evidence, proposed,
  normative, absent, unmeasured, unresolved, and unselected.
- Keep the architecture deep. Compression may remove repetition, not
  prerequisites, overlaps, failures, or authority limits.
- Label generated non-Endpoints examples as illustrations until they are
  checked against official sources after the draft.
- Do not claim that safe automation, agent effectiveness, reduced work,
  improved correctness, portability, or product outcomes have been measured.

## Late reference material

The capability matrix, full donor ledger, complete decision register, and exact
build inventory appear only after the relevant architecture. A short mechanism
or breakpoint may appear earlier when it clarifies one rule.

Final decisions are grouped by:

- authority and semantics;
- evidence and domain integration;
- time, contradiction, and repair;
- explanation, workflows, and interfaces;
- runtime, security, and scale; and
- validation and product outcomes.

## Source boundary and scheduled checks

Draft only from the frozen RFC, source trace, approved design, and registered
Essay material. After the initial draft:

1. check generated TanStack examples against official library material within
   Kyle's bounded instruction;
2. offer the required conditional draft-cartography checkpoint because the
   introduction and ordering change materially;
3. run bounded writing-guide cleanup and required Stage 6 assays after that
   checkpoint;
4. run the user-selected v0.2 → v0.3 loss audit; and
5. return the validated draft for Kyle's read.

The example check may narrow, replace, or remove an illustration. It may not add
new Trust theory or treat another library as range evidence.
