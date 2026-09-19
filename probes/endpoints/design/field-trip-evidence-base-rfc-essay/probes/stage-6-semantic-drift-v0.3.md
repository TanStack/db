# Stage 6 Semantic Drift Assay — TanStack Trust RFC v0.3

## Frozen versions and invariants

- Control: `drafts/tanstack-trust-rfc-v0.3-pre-edit.md`
- Control SHA-256: `b5ed2dda2d07cbeeeb3c5dd0e95589f7bc75f164b2ac0065469de65f6edb1e9c`
- Edited draft: `drafts/tanstack-trust-rfc-v0.3.md`
- Edited SHA-256: `f3c246b7393beb8767931aa8465aecd49beb8d972cdfd82aefadef289f891904`
- Mechanical extent: 35 inserted and 28 deleted lines across four illustrative
  cases and one lifecycle sentence; much of that count is wrapping.

The comparison held six invariants fixed: Trust remains internal to Endpoints;
domain, Trust, and consumer authority stay separate; the four other-library
cases remain hypothetical; no new Trust mechanism, implementation claim,
product outcome, or range claim enters; status boundaries remain recoverable;
and the route, reach, freshness, contradiction, replay, and expiry mechanics
remain unchanged.

## Substantive change ledger

| Unit | Before | After | Class | Support and authorization | Disposition |
| --- | --- | --- | --- | --- | --- |
| Router illustration, §3 | A generic hypothetical about generated route metadata and runtime matching, with a promise to check the current Router surface later. | A visibly labeled hypothetical built on the documented generated file route tree, its IDs, paths, parent relations, URL matching role, and import into `createRouter`; the text explicitly says this is not Trust implementation evidence. | Attribution, evidence role, scope, example function | Official Router route-tree docs and file-based quick start, collected as source 17 under the authorized post-draft illustration check. | **Accepted authorized correction.** The example becomes more concrete without changing the Trust route rule or implying support. |
| Query illustration, §4 | Applicability depended on library version, persistence format, options, and age. | Applicability is illustrated through documented timestamp, max-age, buster, hydration, storage representation, and `gcTime` controls; the unsupported vague library-version dependency is removed. | Scope, attribution, evidence role, example function | Official `persistQueryClient` documentation, source 18, under the same authorization. | **Accepted authorized narrowing.** The applicability lesson is unchanged; the example now uses documented controls. |
| Agent-lifecycle sentence, §7 | “The architecture becomes a product when agents can participate…” | “The architecture becomes useful to agents when they can participate…” | Reader promise, product scope | The approved Endpoints-incubation design rejects a standalone Trust product claim. The bounded cleanup explicitly recorded this wording change. | **Accepted authorized clarification.** It removes a product implication and preserves the lifecycle claim. |
| Table illustration, §7 | A generic row-model sorting or filtering property with no checked Table surface. | A hypothetical is tied to documented client-side sorting/filtering row-model stages and manual modes that treat caller rows as already processed. | Attribution, evidence role, scope, example function | Official Table sorting and column-filtering guides, source 19. | **Accepted authorized grounding.** Trust mechanics and range status do not change. |
| Form illustration, §9 | A generic validation adapter mapping schema results into field or form errors, plus a promise to check the surface later. | A hypothetical is tied to documented Standard Schema field errors and form-validator results with separate form and field errors. | Attribution, evidence role, scope, example function | Official Form validation guide, source 20. | **Accepted authorized grounding.** Domain ownership and hypothetical status remain explicit. |
| Sentence and block wrapping | Several illustration sentences and blockquotes used longer or awkward line shapes. | The same actor-and-action content is split into shorter sentences and corrected blockquote wrapping. | Mechanical structure | Recorded writing-guide cleanup. | **Mechanical; no semantic disposition needed.** |

## Reconstruction test

The edited version still reproduces all declared invariants without consulting
the control:

1. The abstract, §§2 and 9, and the roadmap keep Trust inside Endpoints while
   preserving its internal authority seam.
2. The domain-package → Trust → consumer-policy handoff remains explicit.
3. Every Router, Query, Table, and Form block says it is illustrative and not
   implementation evidence; §9 states that examples are not range evidence.
4. None of the official-source additions creates a new Trust primitive, rule,
   interface operation, shipping claim, or measured outcome.
5. The status legend and point-of-use qualifications remain unchanged.
6. The full route, reach, applicability, historical freshness, contradiction,
   causal repair, and expiry account is textually identical outside the bounded
   example wording above.

## Result and limits

- Restored changes: none.
- Accepted authorized changes: five meaning-bearing units.
- Mechanical changes: wrapping and sentence splitting inside the same units.
- Flagged unauthorized or unsupported changes: none.
- Unresolved comparisons: none.

This was an orchestrator-run comparison because exact drafting history was
needed to separate official-source corrections from cleanup. That creates
self-review risk: the same context that knows the authorization may be too
sympathetic to the edits. The exact hashes, complete mechanical diff, frozen
invariants, source records 17–20, and reconstruction checks make the judgment
auditable. The assay establishes preservation across this edit pass only; it
does not validate the RFC claims themselves.
