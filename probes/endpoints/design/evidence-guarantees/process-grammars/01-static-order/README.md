# Static query ordering

The useful process boundary is **current evidence applicability**. The recorded
checker first found the actual query supported. Later, a deliberate removal of
the unique tie-breaker produced a source-located diagnostic. Applying the guarded
edit changed the source; it did not make the old running-app receipt valid.
A fresh capture cleared the finding. Restoring original bytes produced another
fresh supported check.

This is the historical local correspondence contract, not a proposal to query
PostgreSQL catalogs at mutation runtime.

## Types, prerequisites and repeats

| Action family | Prerequisite in this bounded model | Effect |
| --- | --- | --- |
| Capture | Available source/runtime specimen | Version-matching receipt |
| Diagnose | Matching bad-source receipt | Source-located finding |
| Guarded edit | Current source matches the diagnostic | New source; old correspondence no longer applicable |
| Check | Source, schema and runtime correspondence match | Supported or unsupported result under the named rule |
| Restore | Repaired specimen available | Original source bytes; runtime correspondence must be established separately |

Captures and checks can recur. They do not require a prior failure. Evidence is
not depleted by inspection; a change can invalidate applicability. The particular
stale check attempted during repair is optional: a valid alternate path captures
fresh evidence directly.

The countermodel admitted clearance merely because the source had been edited.
The actual `STALE_RUNTIME_SOURCE` receipt refutes that rule. Requiring matching
correspondence rejects the constructed shortcut, and both observed episodes
still replay. Repair without a current diagnostic is also excluded for this
specific hash-guarded edit operation, not for all possible human code edits.

## Bounds and open relation

An actual query/source/schema result does not establish auth, arbitrary helper
effects, client sorting, or deployment agreement. Original-source restoration is
observed, but historical-evidence reuse is not settled by the subsequent rerun.
In the frozen v0.1 this remains open. Kyle's later R22 answer rejects automatic
reactivation: code is not the only test input. [v0.2](../revisions/v0.2/model.json)
removes that candidate action and retains the fresh-check path.

Sources: A0–A6 in [source captures](../sources.json). Full [model and relation
answers](model.json); [replay and countermodel correction](replay.json).
