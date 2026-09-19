# Stage 6 v0.3 draft-frame cartography plan

## Frozen source track

Frozen before any expectation probe is launched or read. These items are
reconstructed from the checked v0.3 draft, its source trace, and its question
register. They remain typed by the status the draft assigns them.

| ID | Typed source-map item | Support |
| --- | --- | --- |
| SM1 | **Selected product premise:** code generation is becoming cheap while people still perform most guarantee definition, verification, maintenance, and permission work; Trust aims to automate more of that work safely. Outcomes remain unmeasured. | Abstract; §1; source trace |
| SM2 | **Proposed guarantee definition:** a guarantee is a bounded domain claim with declared evidence, conditions, and limits, not automatic proof, certification, universal coverage, or permission. | Abstract; §2 |
| SM3 | **Proposed authority architecture:** domain packages own meaning, rules, checks, evidence adequacy, applicability, encodings, and omissions; Trust owns reusable evidence records and history; consumers own permission and fallback; workflows and interfaces only carry operations. | Abstract; §2; §9 |
| SM4 | **Implemented bounded evidence topology:** support is AND within a route and OR across alternate routes; gaps remain explicit and cycles do not create grounding. The finite local kernel implements a subset. | §3; prototype trace |
| SM5 | **Proposed state separation with a bounded implementation:** evidence state, execution/reach, operational failure, and consumer policy remain distinct; a successful check execution may still observe failure, and an operational failure creates no correctness observation. | §4 |
| SM6 | **Implemented bounded temporal mechanism plus open semantics:** applicability is domain-meaningful and explicit; dependency revisions are monotonic; evidence never revives merely because bytes return; selective invalidation works only for captured dependencies. Applicability ownership and cardinality remain unresolved. | §4 |
| SM7 | **Implemented exact repair subset:** a challenge requires causally later, applicable replay of the same law and case; history is append-only; replay authority can later expire while the historical resolution remains. Richer repair identity is unresolved. | §5 |
| SM8 | **Proposed explanation and agent lifecycle:** explanation is a structured operation over routes, gaps, reach, context, challenges, replay, expiry, witnesses, and limits. Agents may design, maintain, investigate, and propose repairs but may not admit their own authority. Generic lifecycle operations and admission governance are absent. | §§6–7 |
| SM9 | **Implemented local service slice with explicit limits:** CLI, LSP, and MCP adapters share one local service and verified store. Generic domain discovery, authoring, ingestion, stable explanation, task projection, packaging, hostile-writer security, and demonstrated agent use remain absent or unmeasured. | §8 |
| SM10 | **Incubation and range boundary:** Trust will remain part of Endpoints for the foreseeable future while keeping clean internal seams. Endpoints is constructive evidence and the only implementation, not an independent range test; no second implementation or extraction milestone is planned. | Abstract; §§2, 9–10 |
| SM11 | **Bounded donor transfer:** proof assistants, ATMS, Datalog, SMT, TLA+/Alloy, provenance systems, assurance systems, lint, and task systems contribute mechanisms only with stated breakpoints. None authorizes a generic solver, universal score, or overarching trust product. | §3; §11 |
| SM12 | **Completeness as goal, not status:** the RFC names the complete architecture and build dependency order while distinguishing implemented, bounded, proposed, normative, absent, unmeasured, unresolved, and unselected states at the point of use. | Status vocabulary; §§10–12 |

Checked draft: `drafts/tanstack-trust-rfc-v0.3.md`, 7,095 words,
SHA-256 `3dea5a0c372721d513ead9f47e5d95f4b25c2d647ab3029658ee01f27d0156de`.

## Frozen public specimen

Every blind probe receives exactly these public elements and nothing from the
source map, full draft, source trace, prior probes, or desired result.

**Title:** TanStack Trust: A Base for Domain-Owned Software Guarantees

**Subtitle:** Separating domain meaning, reusable evidence mechanics, and
consumer policy

**Status:** Draft RFC for feedback

**Audience:** TanStack maintainers and contributors building libraries, domain
packages, and agent-facing developer tools

**Abstract:**

> Code generation is becoming cheap. Guarantee work is not.
>
> People still define what software must do, decide which checks deserve
> authority, verify that those checks reached the behavior they claim to test,
> preserve failures, determine whether old results still apply, and decide what
> the available evidence permits. Most of that work is manual today. TanStack
> Trust is an architecture for automating more of it without letting an agent
> approve its own claims.
>
> A guarantee in this RFC is a bounded domain claim with declared evidence,
> conditions, and limits. It is not automatically a mathematical proof,
> certification, promise of universal coverage, or permission to act.
>
> The architecture separates three responsibilities. A domain package defines
> the guarantee, the rules and checks that may support it, the contexts where
> evidence applies, and the known omissions. TanStack Trust maintains the
> evidence graph and its history: observations, support routes, applicability,
> freshness, contradictions, repair, and explanation. Consumer policy decides
> permission, severity, fallback, and deployment action. Workflows and
> interfaces help people and agents perform this work; they do not acquire
> authority of their own.
>
> For the foreseeable future, Trust will be built and shipped inside TanStack
> DB Endpoints. It is an internal architecture and evidence contract, not a
> separate product or package roadmap. Endpoints provides the first bounded
> implementation and the recurring examples in this document. Those examples
> illustrate the architecture; they do not define its full range.
>
> The current worktree implements a finite local kernel, verified file storage,
> one Endpoints check, and CLI, LSP, and MCP adapters over one service. That is a
> useful vertical slice. It does not establish that the registered rule is
> sound, that the architecture spans other domains, that agents can use it
> effectively, or that software is now safe to ship.

**Opening question:**

> What would justify relying on this change, in this domain, under these
> conditions—and what would make that justification expire?

**Opening example:** A retained Endpoints query and a mutation share a build
artifact. Endpoints would like to skip the query's refetch when the mutation
cannot affect its result. The claim depends on an authority baseline, no
pending optimistic or repair work, complete effect bounds, and disjoint read
and write sets. External writes remain outside the law. Even supported evidence
does not decide whether product policy enables the optimization.

**Simple architecture:**

```text
domain package                 TanStack Trust                  consumer
--------------                 --------------                  --------
defines claims and rules  →    maintains evidence and history → decides use
implements bounded checks      assesses declared routes        owns fallback
declares applicability         explains current state          applies policy

authoring and repair workflows       CLI / LSP / MCP
              \________________ carriers ________________/
```

**Main-section sequence:**

1. Why Trust exists
2. The authority Trust has—and refuses
3. The evidence graph
4. Current evidence: reach, applicability, and freshness
5. Contradiction, causal repair, and expiry
6. Explanation is an operation
7. Safely automating the lifecycle
8. One service, several interfaces, bounded persistence
9. Domain integration and consumer action
10. What exists in Endpoints today
11. Open decisions and build dependencies
12. What a later agent must recover

## Sample coordinates

- Expected product shape and the problem it solves.
- Expected authority boundaries and semantic owners.
- Expected evidence and temporal mechanisms.
- Expected agent, workflow, interface, and consumer roles.
- Expected implementation status, Endpoints role, and range.
- Expected limits, open decisions, and conclusion.
- Likely collapse into familiar assurance, policy, test, provenance, or agent
  platforms.

Unsampled: human maintainer reactions, non-English readers, other model
families, body-level close reading, implementation usability, and real agent
behavior.

## Frozen prompt family

All variants include the exact public specimen and request the same fields.
Only surface wording and clause order change.

- **BC3-01, canonical:** “Using only the public elements below, reconstruct the
  substantive RFC you expect to find. State the product shape, authority
  boundaries, mechanism sequence, implementation status, Endpoints role,
  largest unresolved areas, likely conclusion, and the most likely
  simplification or overclaim. Cite the exact public phrase behind each
  inference.”
- **BC3-02, reordered:** “From these public elements alone, first infer the
  mechanism and ownership handoffs, then reconstruct the product, current
  implementation, Endpoints boundary, open decisions, conclusion, and largest
  collapse risk. Attach an exact phrase from the public elements to every
  inference.”
- **BC3-03, neutral:** “Describe the most likely architecture and argument
  behind these public elements, including what each actor owns, how evidence
  changes over time, what exists now, what Endpoints does and does not show,
  what remains undecided, the likely conclusion, and where a reader might
  flatten the design into something more familiar. Support each item with an
  exact phrase.”

The output contract is descriptive. Probes must not judge quality, truth,
novelty, product priority, or public popularity.

## Controls and risk

Three fresh sibling-hidden contexts receive one prompt variant each. They do
not use tools or inspect files. The source map stays hidden until all three
outputs are fixed. No adaptive sample is added before the first overlay.

Recurrence will be reported as an exact count across three correlated model
samples. The unusually explicit abstract and section sequence may make the
authority split and temporal lifecycle easier to recover than they would be
from the title alone. The run cannot estimate public opinion, reader value,
historical novelty, or human comprehension.
