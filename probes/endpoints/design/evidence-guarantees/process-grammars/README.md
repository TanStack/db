# Four evidence-check Process Grammars

Status: first bounded passes, with explicit unresolved relations. Date: 2026-09-15.
Kyle selected four subjects and authorized execution with “ok go”. Instrument:
[Process Grammar](/Users/kylemathews/programs/linux-config/skills/field-lab/reference/instruments/process-grammar.md).
These are instrument readouts for the existing evidence inquiry, not an evidence
engine implementation or a completed Design Grammar run.

## What the four cases show

| Check | Process distinction | Reading |
| --- | --- | --- |
| Static query ordering | A supported result can exist before any investigation. An edit can make evidence stale without establishing another query bug. | [Ordering](01-static-order/README.md) |
| Opaque helper effects | A source observation, an inconclusive note and a complete effect claim have different completion conditions. | [Helper](02-helper-investigation/README.md) |
| Mutation failure | Failed application execution can be the expected successful test case. Boundary and browser observations retain separate scope. | [Mutation errors](03-mutation-errors/README.md) |
| Selective refresh | Value agreement and useful read reduction are separate conclusions. A shrinking or replay step must preserve the original violation. | [Optimization](04-selective-refresh/README.md) |

The first, third and fourth models replay bounded documented histories. The helper
model deliberately stops before scoring or settling the complete effect claim:
no concrete rubric or historical acceptance event is available. A missing event
was not invented to complete the diagram.

The static case includes both the initial supported check and the later deliberate
defect/repair exercise. The evidence process therefore does not require finding a
bug before producing useful support. The optimization case includes injected
faults; removing a test fault is not described as repairing a new production bug.

## State and source controls

[sources.json](sources.json) preserves 28 source records: original-file hashes,
selected passages or result fields, and the Kitchen helper commit/blob references.
Full local paths retain provenance. Current source inspection is labeled separately
from historical events. A later source change does not rewrite these captures.

Each model separates action types, occurrences and prerequisite questions. Guards
use conjunction within a clause and disjunction between clauses. Replay records
enabled actions, the occurring action, and accomplished effects not yet depleted.
Repeating a check creates another occurrence; reading evidence does not consume it.
No observed occurrence in these subjects establishes an unused-action violation.

Prior user decisions supply the relevant answers. In particular: known partial
facts survive uncertainty; notes do not settle investigations; the producing agent
can score evidence; check-level policy remains deferred; and missing evidence is
not an unconditional optimization veto. The models concern evidence conclusions,
not a new policy for enabling optimizations.

The three proposed commutations are marked analyst inferences from separate check
fixtures. Their successful replay establishes model consistency, not real-world
independence. Every inferred skip and unresolved relation remains in its model.

## Replay results and limits

Run `python3 probes/endpoints/design/evidence-guarantees/process-grammars/validate.py`
from the repository root. It verifies the frozen inputs and runs `replay.py`.

The current [summary](replay-summary.json) accounts for seven episode projections
(including shared setup/aggregate records), eight constructed invalid sequences,
four source-grounded countermodel corrections, seven bounded alternate paths and
three commutation checks. The four countermodels are deliberate analyst controls,
not four newly discovered production bugs. Each correction is followed by full
regression replay of that study's episodes.

No production code, browser, API or database tests were rerun. These are small
process models, not an oracle for the future evidence implementation. No universal
process coverage, confidence probability or independent holdout is claimed.
Historical oracle weaknesses and the helper report's 96-versus-88 comparison-count
discrepancy are retained as limits rather than repaired by narrative.

## Reviewed relation: code reversion

**Q1:** when code returns to an exact previously checked version, and every other
relevant binding still matches and the evidence has not expired, can the old
evidence become applicable again without a rerun?

The ordering episode reran its check after restoring original bytes. That alone
did not establish necessity. Kyle subsequently answered: “no — code isn't the
only thing used in tests”. [PG1 v0.2](revisions/v0.2/model.json) removes automatic
reactivation and requires a fresh check for current support. Its [regression
record](revisions/v0.2/regression.json) retains all seven episode projections,
eight exclusions and four countermodel corrections. The original v0.1 remains
frozen. [Remaining questions](questions.md) concern rubric design and explicitly
bounded inferences or missing historical evidence.
