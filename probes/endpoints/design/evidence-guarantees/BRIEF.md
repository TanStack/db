# Guarantees that agent evidence could recover

Frozen 2026-09-15, before new outside research. Authorized sequence:
Fracture Scan → Research Survey → Ground Condition → Loss Audit.

Question: What guarantees in the previously surveyed full-stack data frameworks
depend on facts that Endpoints cannot currently establish, but an agent could
supply through additional code inspection, a deterministic check, or a scoped
manual certification? Which instead need ordinary compiler work, authored app
code, or runtime machinery?

Downstream use: design the general evidence system and precise linter requests;
prepare a demo with a conditional-write API and an API with no database writes.
No evidence schema or implementation is selected by this research.

Starting material: the September 1 full-stack framework survey and its source
list; Endpoints RFC v0.18; current prototype commit
`9189b4f34c79b7a6aa79e85e12c40dc4974c7515`; current user decisions.

Depth: broad, bounded to accessible English primary docs, original papers, and
source code, as retrieved 2026-09-15. Historical contracts remain historical.
Budget: at most 30 newly inspected primary pages/documents, plus supplied local
records. Stop at that boundary or after two targeted passes add no material
mechanism/condition. Report thin/unsearched systems rather than imply exhaustive
coverage. Vendor contracts are contract evidence, not independent verification.

Coverage frame (guarantee is the unit, framework is provenance):

1. Tier placement, serialization, identity, query/fragment composition.
2. Transaction participation, atomicity, retry, effect isolation, completion.
3. Query dependency completeness, authorization-sensitive reads, invalidation.
4. Optimistic intent, replay, confirmation, stable ordering and subset coverage.
5. Runtime validation and domain-policy boundaries.
6. Source/config/remote-version changes and the limits of transferable evidence.

Compare each guarantee with Endpoints using distinct labels: already provided;
ordinary compiler/catalog work; candidate agent evidence; runtime/app mechanism
required; outside present scope; unknown. A guarantee can have several parts.
Every candidate agent task needs a code example, failure case, exact claim,
support method, consumer, and invalidation condition. A test over sampled inputs
is never silently promoted into a universal certificate.

Controls: revisit source restrictions and escape hatches; retain less-prominent
historical systems; record counterevidence; do not invent auth rewriting,
production data representativeness, external-write discovery, or PG changes.

Outputs live here: `01-fracture-scan.md`, `02-research-survey.md`,
`03-ground-condition.md`, and `04-loss-audit.md`, with independent audit notes.
These are research artifacts, not an implemented evidence database.
