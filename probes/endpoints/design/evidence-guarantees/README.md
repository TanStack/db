# Evidence-system research, September 15, 2026

This packet records the user-selected sequence:
Fracture Scan → Research Survey → Ground Condition → Loss Audit.
It is design research, not an implemented evidence format or a certification
of the Kitchen AI APIs.

- [Frozen brief](BRIEF.md): question, scope, baseline, budget, and controls.
- [Fracture scan](01-fracture-scan.md): candidate failures of overbroad evidence
  claims; accepted and rejected counterexamples.
- [Research survey](02-research-survey.md): 20 guarantee entries, 6 concrete
  candidate agent tasks, sources, and full old-inventory coverage accounting.
- [Ground-condition probe](03-ground-condition.md): six matched boundary cases
  and the missing facts each exposes.
- [Loss audit](04-loss-audit.md): independent source rescans against the frozen
  survey, with omissions retained separately from any restoration decision.
- [Thorough categorization](05-categorization.md): requested code-grounded
  assessment of all 85 source records across 15 families, with a
  [complete per-ID ledger](05-categorization-ledger.md) and
  [machine-readable source](05-categorization-ledger.json).
- [Frame Projection](06-frame-projection.md): two cluster-first maps, with
  [interactive map A](frames/next-ingredient.html) and
  [interactive map B](frames/law-scope.html). Neither map selects a design.
- [Evidence-store stress tests](evidence-store-stress/README.md): boundary and
  fracture readings, a frozen lifecycle draft, fresh hostile audit, and a
  guide-word worksheet awaiting content review. Includes the later requirement
  for an enforced boundary around agent conclusions and actions.
- [Reviewed decisions](evidence-store-stress/08-content-review.md): later user
  answers qualify the frozen lifecycle and audit suggestions.
- [Four Process Grammars](process-grammars/README.md): bounded histories for
  ordering, helper inspection, mutation errors and selective refresh.
- [Evidence-donor survey](evidence-donors-survey.md): ten donor families across
  provenance, argument, assessment, execution records and temporal revision.
- [Structural Recombine](structural-recombine.md): 34 traceable parts, eight
  examined candidates, five retained candidate recombinations and three
  confirmations, with three unranked arrangements. The [procedure audit](structural-recombine-audit.md)
  corrects the original novelty count and missing log entries. No architecture
  is selected.
- [Field Log](../field-trip-optimistic-coherence/field_log.md): recovered run
  readouts and review decisions, explicitly recorded retrospectively. The
  Guide-word content review remains unfinished.
- [Base-system Design Grammar](base-grammar/README.md): exploratory extraction
  for a reusable evidence base with domain-owned claim/check packages; includes
  frozen analytical layers and explicit trust/range limits.
- [Grammar repair v2](base-grammar/revisions/v2/README.md): current contract for
  structured argument routes, expiring repair authority and causal replay;
  original grammar and audit snapshots remain frozen.
- [Evidence base prototype](../../../evidence-base/README.md): runnable local
  argument checker, bounded Endpoints example, oracle controls and packaged
  claim/check authoring workflows. No production Endpoints integration.
- [Cross-machine handoff](../../../evidence-base/HANDOFF.md): current repair,
  validation, preserved decisions, next work and portable run instructions.
- [shadcn donor study](shadcn-donor-study.md): diagnostic construction and
  agent-correction eval methodology, with reported-result and source limits.
- [Base-design audits](base-stress/README.md): Fracture Scan and a fresh Hostile
  Assay, with frozen inputs and executable witnesses. Three distinct issues
  concern explanation structure and replay applicability/causality; no fixes
  are applied by the audits. The subsequent v2 repair addresses them separately.

The fracture scan and ground-condition cases are logical constructions. The
survey records source contracts and marks Endpoints comparisons as inferences.
The loss audit identifies omissions; it does not select a design.
The later categorization evaluates those records against current code. Its
classification is separate from the frozen instrument results.

Validation: the bundled research-survey validator checks structure and source
references. Local Markdown links are checked separately. Neither check verifies
source truth. No production code, runtime behavior, or application database was
changed by this research.
Run `python3 validate-categorization.py` in this directory to check all 85 IDs,
ledger fields, category counts, frozen survey hash and local artifact links.
This checks accounting, not the truth of a classification or runtime behavior.

The user selected a reusable evidence base, followed by a prototype and packaged
claim/check authoring workflows; Endpoints consumes domain-specific packages.
The initial grammar and prototype above do not settle production storage,
enforcement, semantic rule soundness or check-level policy.
