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

The next design has not been selected. The packet preserves questions about
claim scope, consumer requirements, support methods, failure/completion paths,
and source/config/deployment invalidation for later work.
