# Evidence and controls — version 1

This is a design extraction from a proposed checker, grounded by inspected
research and database contracts. The controls below are analytical reconstruction
and ablation. They are not passing compiler or PostgreSQL executions.

## Reconstruction

| ID | Source case / property | Reconstruction with model IDs | Result |
| --- | --- | --- | --- |
| E1 | Kitchen tag write; immutable `lower(name)` index; unrelated recipes read | M1 index maintenance has no extra logical table effect under analyzed semantics; R3 keeps tags as target, R6 permits recipe independence, R7 still checks authority. | Reconstructs the intended correction. Existing prototype behavior is not certified. |
| E2 | Add native enum/JSON/pure scalar projection/aggregate to a table query | R1 resolves operations; R2 retains table and expression effects. Browser evaluation is irrelevant to M3 independence. | Reconstructs P7 without a blanket type allowlist rule. |
| E3 | `STABLE` PG function reads permissions while outer SQL reads recipes | R5 includes body read; R2 unions permissions and recipes. R6 detects permission writes. | Reconstructs latest P4; declaration alone cannot erase reads. |
| E4 | PG function with default `VOLATILE` label only returns integer arithmetic | Analyze body using R5. If all operations are known and context-free, M2 has no table reads/writes. R6 needs no value prediction. | Preserves easy optimization despite a coarse label. |
| E5 | Parent delete cascades to child with a trigger writing audit | R3 begins parent delete; R4/L4 expand child delete and audit write. A non-key update need not follow the delete edge. | Reconstructs event-sensitive effects; no undirected dependency closure. |
| E6 | Table has an insert default or delete trigger but query only reads stored rows | R4 has no applicable write event. Policy/view/read-expression effects still apply if present. | Excludes irrelevant features without claiming all effects absent. |
| E7 | Dynamic SQL in a reachable PG routine | R5 records unknown effect and known surrounding facts; R8 falls back where the unknown blocks a premise. | Safe exit remains ordinary execution, no global “bad table” classification. |
| E8 | Query SQL independent, but optimism changed that collection incorrectly | M3 can prove server independence; L3/M4 and R7 require authoritative reconciliation. | Reconstruction needs the active overlap; server proof alone fails. |
| E9 | Missing baseline, outstanding authority repair, or exhausted read retries | M4 supplies existing protocol obligation; R7 cannot erase it. R8 does not claim guaranteed successful reads. | Preserves authority and error boundaries. |
| E10 | Uninspected Node helper adjacent to visible SQL | B1/P4 scope applies. Known SQL facts are reported without asserting a whole-handler effect proof or rewriting auth. | Reconstructs user scope rather than former whole-JS prerequisite. |
| E11 | User adds an ordinary index; analyzer now needlessly refetches | I6 tests the unchanged logical footprint and expected skip independently of final rows. | Precision assertion is necessary; row oracle alone is insufficient. |
| E12 | Wrong relation removed from summary | I2 forbids removal; I6 demands independent database comparison capable of detecting the stale result. | Missing-effect mutant has a different observable from E11. |

## Ablation

| Removed item | Consequence | Keep / demote |
| --- | --- | --- |
| M1 bound operation | E5/E6 collapse read, insert, update and delete events; overload identity in E3 is lost. | Keep |
| M2 effect summary | Cannot compose E3/E5 or retain known facts beside E7 unknowns. | Keep |
| M3 claim judgment | E2's unsupported client expression can again block unrelated refetch selection. | Keep |
| M4 authority state | E8/E9 incorrectly inherit the server independence proof. | Keep |
| L1 | Source facts have no defined route into a summary. | Keep |
| L2 | Summaries cannot justify an individual decision. | Keep |
| L3 | E8 loses its joint server/browser obligation. | Keep |
| L4 | E5 loses transitive function/schema effects. | Keep |
| R1 | E3 can confuse an overload with a built-in; incorrect binding becomes evidence. | Keep |
| R2 | E2/E3 lose child dependencies. | Keep |
| R3 | Mutation predicate reads can become writes or real targets can disappear. | Keep |
| R4 | E5 misses implicit writes; E6 needs a blanket fallback. | Keep |
| R5 | E3 misses body reads or E4 relies on a blanket declaration ban. | Keep |
| R6 | No independent semantic criterion separates proof from mere non-observation. | Keep |
| R7 | E8/E9 fail. | Keep |
| R8 | E7 has no specified operational exit. | Keep |
| I1 | Partial SQL evidence can masquerade as a whole-handler certificate in E10. | Keep |
| I2 | E12 can be excused as precision improvement. | Keep |
| I3 | Compiler auth changes or runtime catalog checks can enter without violating the remaining relation calculus. | Keep |
| I4 | Independence can authorize an exact patch without patch evidence. | Keep |
| I5 | External freshness or response acceptance can silently become SQL-proof conclusions. | Keep |
| I6 | E11 passes on final-row equality alone. | Keep |

Source identity, SQL spans, function declarations, rule names, and diagnostics
were demoted from separate candidate units to fields or projections: deleting
their separate unit names changes no reconstruction. Removing the information
itself would still weaken I1. The four-unit account is shorter without losing
the named distinctions; this is a compression heuristic, not a proof of minimality.

## Exclusion and range

- N1: `SELECT read_hidden_permissions()` classified independent of permission
  writes solely because its declaration says STABLE. R5/I2 reject this state.
- N2: Removing a query's optimistic correction because server sets are disjoint.
  R7/I5 reject it.
- N3: Expression-index presence alone changes an unrelated collection from proved
  independent to unknown. E1/E11 reject it for the stated pure index case.
- N4: Compiler-inserted auth extraction to manufacture a “pure payload.” I3 rejects
  this even if its table summaries happen to be correct.
- N5: Treating skipped analysis of a PG routine's dynamic SQL as an empty write
  set. R5/I2 reject it.

These are near negatives constructed from the source and surveyed contracts.
They are not independently held-out test cases. No independent marginal case was
supplied, so range is **untested**. No fresh evaluator or subagent ran. Kitchen
was part of extraction and cannot be reused to claim independent generalization.

## Losses and limits

- D1: A table set loses rows, columns, order, counts, and path conditions. F1
  therefore accepts same-table false positives; F2 recovers only a specified part.
- D2: SQL effect summaries lose arbitrary JavaScript behavior and cannot establish
  whole-handler purity. Their scope remains explicit.
- D3: The model does not implement type binding, procedural-language parsing,
  deployment matching, or the browser authority protocol. Those are material
  boundaries, not boxes whose existence proves implementation completeness.
- D4: The survey's mathematical models and PostgreSQL contracts differ. The local
  rule calculus is a derivation that needs independent executable tests.
- D5: A static possible-effect set says nothing about actual latency or whether an
  invocation succeeds. No performance ranking or universal coverage follows.

Reconstruction passed at the proposed-design level. No code-level correctness,
complete PostgreSQL coverage, or independent range claim is made.
