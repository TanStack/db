# Reader Assay v0.3 — reader 01

## Execution boundary

Fresh sibling-hidden model context. The reader saw only the frozen RFC, the
target-reader description, and the neutral eight-question prompt recorded in
the Field Log. It verified the expected draft digest and inspected no other
artifact.

## Raw response

Digest verified: `f3c246b7393beb8767931aa8465aecd49beb8d972cdfd82aefadef289f891904`.

### 1. Claim and proposal

The RFC proposes TanStack Trust as an internal Endpoints architecture for maintaining the evidence behind bounded software guarantees. A domain package defines what a claim means, acceptable evidence routes, applicability, and omissions; Trust records and evaluates observations, arguments, freshness, contradictions, and repairs; consumer policy alone decides what action is permitted. CLI, LSP, MCP, and workflows carry these operations without gaining authority themselves.

It explicitly does not claim proof, checker soundness, generality across TanStack, deployment safety, or an independent `@tanstack/trust` product.

### 2. Recovered system map

```text
Domain package
  defines claim, checks, rules, context, omissions
        ↓
Trust evidence graph
  observations + rules → arguments
  AND within one route; OR across routes
  filtered by applicability, freshness, and challenges
        ↓
Assessment and structured explanation
        ↓
Consumer policy
  permit / deny / review / fallback
```

On failure: failing observation → targeted challenge → fresh post-failure replay of the same law and case → linked resolution. Later dependency changes can expire the replay’s current authority without deleting the historical resolution.

Workflows help design, maintain, and repair evidence; CLI/LSP/MCP expose one underlying service.

### 3. Present versus remaining

Present in the local prototype:

- A finite kernel with claims, observations, rules, arguments, challenges, route structure, and cycle rejection.
- Explicit dependencies, monotonic revisions, selective invalidation, and a private boolean applicability check.
- Exact same-case challenge replay, causal ordering, append-only resolution history, and expiry.
- One Endpoints safe-skip CheckContract/rule/check, exercised by 21 local tests and eight mutation controls.
- A checksum-wrapped local file store with atomic rename and single-process serialization.
- One service exposed through CLI, LSP, and six MCP operations.

Still proposed or absent:

- Stable manifests, extension APIs, generic ingestion/argument operations, complete typed explanations, package discovery, task projection, packaged integrations, and consumer enforcement.
- Generic formal/rubric integration, authentication, signatures, hostile-plugin isolation, coordinated writers, and deployment security.

Unresolved:

- Applicability ownership and whether it is boolean or three-valued.
- Semantic identity across versions, richer repair semantics, checker/rule admission, operational-failure storage, transactions, and distributed clocks.

Intentionally unselected:

- Severity, permission, fallback, confidence aggregation, evidence ranking, and investigation priority.

Unmeasured:

- Generality beyond Endpoints, agent usability, human comprehension, reduced mistakes or repair time, scalability, and deployment outcomes.

### 4. Confusion or lack of conviction

- In §10, “overlap or missing authority” produces a failing observation and challenge. Missing authority sounds like a claim precondition is absent, which could instead mean inapplicable or unresolved. The exact boundary between contradiction and unmet conditions was unclear.
- “Applicability condition” is introduced as one of six candidate primitives in §3, but §4 leaves both its ownership and result type unresolved. It was therefore hard to recover its eventual data-model status.
- The “verified store” wording in §8 initially sounded security-oriented, although the same section later narrows it to accidental/out-of-band modification detectable only when the actor cannot rewrite the checksum.
- §10 cites 21 tests and eight mutation controls, but the draft does not identify what faults were injected or which architectural properties those controls substantiate.
- Generality remains asserted architecturally rather than demonstrated: Router, Query, Table, and Form are explicitly hypothetical, while §11 says no second implementation is planned.

### 5. Three clearest retained distinctions

1. Evidence state, execution reach, operational success, and permission are four different questions.
2. Premises are conjunctive within a route; routes are alternatives, so a flat gap list is not a completion plan.
3. Repair must be a causally later, applicable replay of the same failure; matching old bytes or an unrelated later pass does not revive authority.

### 6. What the draft now enables

I could now inspect a “green” result by asking what claim and route it supports, whether production was reached, which dependencies were captured, what remains omitted, and who may act on it. I could also sketch an Endpoints domain package or checker with an independent oracle, reach checkpoint, hostile controls, explicit applicability inputs, and replay obligation, or select one real route gap for an agent to pursue.

### 7. Generic or predictable material

The warnings against agent self-certification, solver-output overclaiming, confusing task completion with evidence, and treating model-to-code correspondence as automatic are broadly familiar assurance principles. One service behind several adapters, append-only history, atomic file replacement, dependency tracking, and the design/maintain/repair workflow are also conventional patterns. The architecture becomes distinctive where these are combined with explicit AND/OR support routes, historical non-revival, exact causal repair, and the domain/Trust/policy authority split.

### 8. Inferences not firmly supported

- I inferred the current registered Endpoints rule is effectively hard-coded or manually admitted; the draft only says admission governance is absent.
- I inferred all cited tests and mutation controls pass; it reports “bounded evidence” from them without showing their individual outcomes.
- I inferred an open challenge defeats support for its exact claim/use, though the general challenge-to-route defeat semantics are not fully specified.
- I inferred “production-shaped” means the extracted helper closely represents a real production decision path; the draft does not demonstrate deployed execution or PostgreSQL behavior.
- I inferred a future three-valued applicability result would propagate `unknown` into assessment rather than becoming consumer policy; that interaction is not yet defined.
