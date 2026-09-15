# Two audits of the evidence-base design

User selection: “ok run both on the designs”. September 15, 2026.

- [Fracture Scan](fracture-scan.md): orchestrator, preserving the design context;
  internal-extension and admissible-counterexample routes, plus rejected outside
  and near-miss controls.
- [Hostile Assay](hostile-assay.md): fresh auditor, one candidate and its source
  trace; no sibling arrangements, preferred outcome or parent hypotheses.

The shared subject is the base contract, its prototype and the packaged authoring
workflows. Prototype limitations remain explicit. No fixes or policy changes were
made. The [manifest](manifest.json) freezes eight source files; both their snapshots
and original files still match their hashes. The [contract packet](base-contract.json)
omits adjacent candidate forms from the blind auditor's input.

## Finding cross-reference

This table accounts for overlap between the reports; it does not rank the findings
or select a repair design.

| Relation tested | Fracture Scan | Hostile Assay | Evidence |
| --- | --- | --- | --- |
| Missing-work explanations preserve alternative routes | F1: identical reports for `(A AND B) OR C` and `A AND B AND C` | Not independently assessed | Executable matched pair; establishing C produces different support outcomes |
| Resolution remains applicable when its replay becomes stale | F2 | H1, independently reproduced | Executable context-change histories |
| Later delivery establishes a later replay | Not independently assessed | H2 | Executable same-batch and delayed-delivery scenes; the latter has a pass measured before the failure |

All ten frozen tests still pass. Each report names the missing oracle law or
false-green model assumption. The witnesses assert the observed defect, so a
successful witness run means reproduction, not that the design passed a
correctness test.

```sh
node --experimental-strip-types probes/endpoints/design/evidence-guarantees/base-stress/fracture-witnesses.mjs
node --experimental-strip-types probes/endpoints/design/evidence-guarantees/base-stress/hostile-witnesses.mjs
```

The workflows retain their useful scope and anti-self-certification requirements.
Their repair/maintenance steps depend on the replay and applicability contracts
that these findings expose. Neither report claims that following a workflow proves
arbitrary rule code sound.

Limits: constructed local cases, not observed production application failures;
no PostgreSQL or deployed Endpoints regression established. The Fracture Scan is
an author self-examination and can inherit the author's framing. The Hostile
Assay's failure-first stance can overweight attackable details; its rejected-attack
ledger keeps declared limitations from becoming invented promises. A fresh reader
and executable witnesses improve the checks without making them exhaustive.
