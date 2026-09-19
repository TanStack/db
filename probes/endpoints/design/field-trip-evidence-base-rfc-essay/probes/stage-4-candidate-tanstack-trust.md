# Frozen Stage 4 candidate: TanStack Trust

## Identity and status

- **Candidate ID:** `TT-RFC-BAC`
- **System name:** TanStack Trust
- **Status:** selected for Stage 4 validation; unvalidated at this freeze
- **Primary reader:** Kyle
- **Research boundary:** registered corpus only; no outside research
- **Lineage:** RFC-B supplies the high-level use-case narrative; RFC-A supplies architecture and authority where the narrative crosses system boundaries; RFC-C supplies concrete failure/repair witnesses where rules need justification.

## Public claim

TanStack Trust is a proposed reusable evidence layer for making software guarantees inspectable and maintainable by humans and agents. A claim package declares domain semantics and checks; the base records provenance-bearing observations, evaluates explicit argument routes under current applicability, preserves contradictions and repair history, and reports support without taking over consumer permission. Authoring and maintenance workflows organize the work, while CLI, LSP, and MCP expose a shared operation layer. The current implementation is a bounded prototype, and Endpoints is one worked consumer rather than evidence of generality.

## High-level use-case spine

1. **Design a claim and check.** State the law, bounded domain, source/reference, production path, checkpoint, observations, omissions, reach, fault controls, and replay obligations.
2. **Establish evidence.** Execute the registered check, retain run provenance and per-law observations, and admit only what the declared rule can use.
3. **Inspect current support.** Traverse jointly required premises and alternative routes; expose gaps and distinguish no evidence, unresolved observation, contradiction, operational non-reach, and consumer denial.
4. **Maintain freshness.** Track explicit context/dependency revisions without treating byte reversion or an unrelated green result as restored authority.
5. **Handle contradiction and repair.** Preserve the original challenge; accept only a causally later exact replay under the current conservative model; retain resolution history while allowing its present authority to expire.
6. **Use the result through agent surfaces.** CLI, LSP, and MCP call one shared service. They may project different interactions or diagnostic severity, but transport parity is not independent corroboration.
7. **Hand off to consumer policy.** TanStack Trust reports support state. The consuming project decides severity, permission, fallback, and whether an action is enabled.

Architecture is introduced at each ownership or authority boundary. Repair witnesses are introduced only when they explain a rule in the sequence. The Endpoints safe-skip check supplies one bounded pass/fail/unresolved walkthrough and stops before analyzer completeness, production refresh policy, or broader PostgreSQL claims.

## Load-bearing source support

| Candidate claim | Primary support and status |
|---|---|
| Base/package/workflow/policy/interface ownership layers | `ESS-S01`, supported but untested as a general product architecture |
| Claim, observation, rule, argument, applicability, challenge core | `ESS-S02`, provisional grammar represented in a bounded kernel except for richer applicability |
| AND/OR routes, flat-gap limit, cycle exclusion | `ESS-S03`, provisional relation repaired into bounded implementation and source-reported tests |
| Append-oriented contradiction, exact replay, expiring current authority | `ESS-S04`, design/repair/implementation history bounded to exact local prototype cases |
| Distinct no-evidence/unresolved/contradicted/non-reach/disallowed states | `ESS-S05`, supported distinctions with policy still open |
| Check contract and Oracle portfolio | `ESS-S06`, `ESS-H04`, normative guidance with one bounded instantiation |
| Design/maintain/repair authoring workflows | `ESS-S08`, draft procedures with effectiveness unmeasured |
| Shared CLI/LSP/MCP service | `ESS-S09`, `ESS-P06/P07`, implemented local adapters; real clients/distribution unfinished |
| Endpoints worked consumer | `ESS-S10`, `ESS-P04`, bounded implementation and tests; no generality or production-readiness claim |
| Local checked persistence and security boundary | `ESS-S11`, `ESS-P08`, corruption detection but no hostile-process or multi-writer guarantee |
| Repair rationale and concrete witnesses | `ESS-H03`, `ESS-P01/P02/P03/P05`, local reproduced failures and controls, not production incidents |
| Public agent-operability losses | `LGI-V1-03/V1-08/V1-09/V1-14`; `LGI-V2-02/V2-05–V2-12/V2-14/V2-15`, revision-specific public-contract recoveries, not a restoration backlog |
| Receipt/control/authority losses | `LFG-H05/H07/H08/H10–H14/H18/H19`, supported recoveries retaining proposed, constructed, bounded, or open status |

## Protected unresolved decisions and gaps

- Applicability ownership and result cardinality remain open (`BR-06`, `ESS-T01`).
- Rule/checker soundness remains a trust root (`ESS-T03`).
- Semantic equivalence, subsumption, cross-version mapping, and complete dependency discovery remain unresolved (`ESS-T02/T05`).
- Missing-evidence severity, permission, confidence aggregation, priority, and consumer fallback remain policy or future design (`ESS-T04/T09`).
- Speculative challenge objects, rubric admission, alternate repair, selective expiry, and durable repair certificates remain incomplete (`ESS-T06/T07/T08`).
- Independent range, agent-workflow effectiveness, failure provenance, mutation receipts, durable multi-process operation, real client integration, hostile-process integrity, scale, and released packaging remain unmeasured or unfinished (`ESS-E01/E03–E13`).

## Reader-promise hypothesis

Before the RFC, Kyle has the design grammar, Oracle guidance, prototype, interfaces, repair history, and loss audits as separate dense artifacts. Through a use-case-led account that introduces structure and failures only where the work encounters them, he may leave able to:

- explain what TanStack Trust owns and refuses to own;
- follow how a guarantee becomes, loses, or regains current support;
- distinguish implemented behavior, documented workflow, proposed semantics, and missing evidence;
- see which semantics agents can actually operate through the current public surfaces; and
- evaluate the unresolved design and implementation work without receiving hidden architecture choices.

This is a hypothesis about one named reader, not a measured reader result.

## Injected editorial choices

- Use cases, not primitives or chronology, supply the top-level order.
- Architecture appears at the first use-case boundary that needs it.
- A failure witness appears immediately after the rule it justifies.
- Endpoints is one continuous example but never the source of general architecture.
- Detailed provenance and loss ledgers remain linked support rather than dominating the primary reading.

## Reconstruction and limits

The candidate reconstructs from RFC-B plus nested RFC-A and RFC-C material in [`stage-3-condensed-candidates.md`](stage-3-condensed-candidates.md), with exact support retained by [`stage-3-candidate-map.md`](stage-3-candidate-map.md) and the Stage 2 ledgers. It adds the user-selected name “TanStack Trust” and the user-selected hierarchy of narrative versus supporting material. It does not add a new mechanism, source claim, policy, applicability answer, roadmap, or validation result.
