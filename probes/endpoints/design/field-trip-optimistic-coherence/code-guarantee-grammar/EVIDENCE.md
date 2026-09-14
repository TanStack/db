# Evidence and controls — frozen v1

## Observations

E1 (S1/S2/S3): source interpreter, schema binder and emitter provide dependency set/null, reason, file provenance and version inputs. This is a footprint proof under supported assumptions, not a generic auth guarantee.
E2 (S10/S11): pure-helper emits one relation. two-read-helper emits two, even though only one query's rows are returned. permission-named-pure-helper emits the same two relations. The latter equality is asserted: names confer no special treatment in these controls.
E3 (S10/S11): opaque-prefix and opaque-suffix both emit null with External call: opaque.authorize. A known SELECT before or after an unknown call does not turn the whole proof into a partial successful set.
E4 (S10/S11): query-write emits null with Effectful query. An observed write is distinguishable from an unknown external call in the existing diagnostic reason.
E5 (S10/S11): all six generated registry handler bodies have AST equality with their submitted handler bodies after stripping source locations/comments. This checks body preservation only; it does not prove full runtime call order, lifetime, wrapper semantics or client secrecy.
E6 (S4/S5): consumers force missing baselines/optimistic recipients and use intersection/unknown for other selection; revision reuse is another distinct branch. Both can avoid a read handler. No complete invocation semantics certificate is represented by the emitted array/null.
E7 (S6/S7): existing tests cover helper aliases, callbacks, transaction parameters, unioned error paths, unknowns, fingerprints and executable coercions. Read these as source/tests; this run did not rerun the full suite or claim its broader oracle coverage.
E0 (process failure): initial extraction fixture destructured only query and the current transform rejected it with ENDPOINT_BOUND_UNSUPPORTED bind query and mutation without aliases. The fixture was corrected to the existing supported declaration shape; no product code changed. This bounds the six results: they do not prove flexible binding syntax. A later harness revision removed an unasserted descriptive boolean and added actual equality between the named/unnamed two-read footprints before final results were saved.

## Reconstruction

RC1: U1 is handler+bindings+snapshot. U2 is the existing proof object. U3 is existing intersection/baseline/optimism and revision handling. U4 is dependencyDiagnostics. L1–L3 reproduce the current analysis/emission/consumer arrangement without an auth primitive. L4 extends the existing source-edit/versioning relation into the explicitly user-owned lint workflow; suggestions are not currently implemented.

RC2: All six controls map to this arrangement: known footprints feed existing selection metadata; unknown calls or writes retain null/reason; submitted handler bodies remain intact. This is a successful reconstruction of the bounded compiler/data flow, with runtime-policy detail deliberately unreconstructed. R2/R5 are proposed constraints on extensions, not falsely reported current complete guarantees.

## Exclusion controls

N1 (executed compiler control E3): accept a query's known SELECT as a complete proof despite an opaque prefix/suffix. Rejected by null output, R3 and P4.
N2 (constructed design negative): a linter offers “move requireUser outside this handler,” and the compiler silently implements it or trusts lint suppression as proof. Rejected by R1/R6/L4/P1/P2. No such feature exists or was executed.
N3 (executed/compiler plus interpretation): a function named authorize performing ordinary SELECTs receives an auth exemption. E2 instead preserves its actual read footprint. No real user authentication was exercised by that synthetic helper.

## Ablation ledger

Analytic removals, not unit tests:

| Removed | Lost reconstruction, property or exclusion |
|---|---|
| U1 | Evidence cannot be bound to the code/database/version it describes (P5/RC1) |
| U2 | Cannot distinguish complete sets from null/reason or explain E2–E4 |
| U3 | Cannot reconstruct metadata use or distinguish retention/optimism from relation matching (E6) |
| U4 | Removes author-directed lint work required by P2 and F1 |
| L1 | Source edits can leave an ungrounded old claim (P5) |
| L2 | No trace from proof kind to permitted runtime action (P6) |
| L3 | Lint can tell a different story from emitted evidence (C2) |
| L4 | Source suggestion can become authority without a reanalysis step (N2) |
| R1 | Compiler guard extraction becomes legal again (N2/P1) |
| R2 | Footprint silently becomes authorization/effect-closure proof (C1) |
| R3 | Known suffix rescues an unknown complete footprint (N1) |
| R4 | Claims lose binding/build assumptions (P5/P8) |
| R5 | One generic success flag authorizes unrelated consumers (C1/P7) |
| R6 | Suppression/refactor suggestion can grant runtime authority (N2/P2) |
| R7 | Full refresh is mistaken for final-value correctness when reads write (P9/P10) |

Property coverage: P1→R1/N2; P2→U4/L4/R6; P3→U1/E2; P4→U2/E3/R3; P5→L1/R4; P6→U3/R2/R5; P7→E6/R5; P8→S2/R4; P9→R7/C3; P10→R7 and evidence limits. No property disappears into a generic safety claim.

Pruning: provider, auth guard, annotation, suppression, subscriber and safe-bit units are parameters, excluded proposals, or redundant encodings as stated in Model. F1 and F2 exercise different changes (feedback versus consumer eligibility); third cosmetic presentation and compiler auth rewriting were excluded.

Range: no independent case; no new range search. These controls were extraction inputs. Suggested oracle work is a requirement for future claims, not generated full-stack validation performed here.
