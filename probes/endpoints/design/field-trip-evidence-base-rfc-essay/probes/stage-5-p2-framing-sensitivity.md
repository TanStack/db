# P2 framing-sensitivity control

## Boundary

Three fresh sibling-hidden readers saw one controlled title variant plus the
same subtitle, description, and nine O2 headings. They did not see sibling
outputs or the source map and were not asked to choose wording.

The variants were:

- **V0:** `TanStack Trust: A Base for Domain-Owned Software Guarantees`
- **V1:** `TanStack Trust: Evidence Machinery for Domain-Owned Software Guarantees`
- **V2:** `TanStack Trust: A Base for Domain-Owned Software Claims`

Only the title term changed. The fixed description still used “proposed base
layer” and referred to what domain guarantees mean, so title-term isolation is
partial and explicitly bounded.

## Raw reader reconstructions

### V0 — selected P2

The reader reconstructed a proposed reusable base for domain-specific evidence
systems, with domain packages owning meaning and authoritative checks, the base
maintaining support/contradiction/freshness/repair records, and consumers owning
permission. It read the RFC as proposed rather than production-complete and did
not infer agent certification or a correctness proof. Its strongest promise was
inspectable lifecycle evidence. Its largest ambiguity was the strength and
meaning of “software guarantees”; it also found the product form and Endpoints
prototype status incompletely specified.

### V1 — “Evidence Machinery” title

The reader reconstructed the same reusable infrastructure/base layer, owner
split, proposal status, non-certification boundary, and inspectable evidence
lifecycle. Its largest ambiguity remained the substantive strength of
“guarantees.” It also found the Endpoints implementation status ambiguous.

### V2 — “Software Claims” title

The reader reconstructed the same domain-specific base, owner split, proposal
status, non-certification boundary, and inspectable evidence-state maintenance.
It no longer named the strength of “guarantees” as the largest ambiguity;
Endpoints implementation status became the largest ambiguity.

## Stable components

Across **3/3 fresh probes and all three prompt inputs**:

1. TanStack Trust was reconstructed as a reusable, domain-specific evidence
   base rather than a standalone domain authority.
2. Meaning and authoritative checks belonged to domain packages; evidence
   mechanics belonged to the base; permission and fallback belonged to
   consumers.
3. The packaging described a proposal with unresolved work, not a complete
   production system.
4. No reader inferred agent certification or proof of software correctness.
5. The strongest promise was inspectable evidence maintenance and explicit
   authority handoffs.

This recurrence describes only the three correlated model probes under the
complete public package. It is not a probability or audience estimate.

## Frame-sensitive components

- **“Software Guarantees” in the title:** Both variants retaining this phrase
  (**V0 and V1**) independently named its substantive strength as the largest
  ambiguity. The claims-title variant (**V2**) did not; its ambiguity moved to
  Endpoints implementation status. The wording affects how strongly the domain
  promise is read, but did not change the reconstructed authority split or
  system maturity.
- **“Base” in the title:** Replacing it with “Evidence Machinery” produced no
  observed change in product-shape reconstruction. This is a weak result because
  the fixed description and headings repeated “base layer” and “the base.” The
  assay cannot establish title-only insensitivity.
- **Endpoints maturity:** All three readers distinguished the overall proposal
  from a complete production system, but each found whether the bounded
  Endpoints vertical is already operational insufficiently explicit. This
  ambiguity is stable rather than caused by either title term.

No model-sensitive component can be claimed because all three contexts used
the same model family.

## Decision boundary

The selected full P2 package preserved every decision-critical ownership and
status distinction under these two title perturbations. The test does not choose
between “guarantees” and “claims,” and it does not revise P2. It shows one
drafting obligation: the RFC must define a domain-owned guarantee as a bounded
claim with declared evidence and limits, and must state the current Endpoints
implementation status at point of use.

## Limits

- Three fresh contexts reduce direct contamination but are correlated model
  samples.
- The unchanged description repaired much of the title's possible ambiguity.
- No title-only extraction, human reader, alternate model family, or prose draft
  was tested.
- The probe measured reconstruction, not preference, credibility, adoption, or
  whether the completed engineering system will deserve the title.
