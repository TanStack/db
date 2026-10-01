# Oracle guide portfolio: bounded follow-up

Executable revision: `18d3ad92dab02a162cff2067a00ae95bea284883`
Guide revision: `a1d75726`
Baseline review: [September 30 portfolio audit](2026-09-30-guide-portfolio.md),
which assessed executable revision `7e4266bb`.

This append-only follow-up assesses the executable revision above. It covers
17 previously audited files named `oracle` or `property`, one Chromium OPFS
receiving spec, and Electric cleanup support. The follow-up changes tests,
test support, and the coverage map, with no production-source change. The
original 90-owner audit remains the inventory; this record reports only the
changed evidence and carries its unresolved portfolio gaps forward. A passing
expected-failure guard records a product counterexample, not a passing product
law. No universal bug-class closure is claimed.

## Verification at the executable revision

| Campaign | Result |
| --- | --- |
| Changed DB oracle files | 678/678 within the full campaign |
| Full DB oracle command | 3,707/3,707 across 55 files; no type errors |
| Query DB Collection oracle command | 474/474 across 16 files; TypeScript passed |
| Offline FIFO and serializer properties | 44/44; TypeScript passed |
| PowerSync oracle command | 12/12, no skips; TypeScript passed |
| Browser SQLite Node oracle command | 113 passed, 4 typecheck placeholders skipped, 0 failed |
| Chromium OPFS configured suite | 4/4, no skips; fairness spec 2/2 |
| Electric runtime oracle command | 328/328 across seven files, no runtime skips |
| Formatting, lint, diff check | Prettier and diff check passed; ESLint exited 0 with seven warnings and no errors |

The literal Electric `test:oracles` command exits 1 after its runtime tests
because the typecheck project cannot resolve three unchanged imports of
`@tanstack/electric-db-collection` in shared `db-collection-e2e` move and
progressive suites. A seven-file runtime command with typecheck disabled exits
0. No edited Electric file produced a reported type error. The browser's four
skips are typecheck placeholders; its runtime lifecycle properties executed.

The cross-formulation owner's checked commands are printed beside its two
calibration tests. Seed `1658004`, path
`0:0:0:0:0:0:0:0:0:0:0:0:0:0`, and property
`includes-cross-formulation.equivalence` reproduce one intentional main-property
failure at cross-formulation checkpoint 0. Seed `1658005`, path
`0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`, and property
`includes-cross-formulation.ordered-window` reproduce one at the ordered-window
checkpoint 0. Each command selects the requested replay directly; no normal
campaign runs first. Removing its explicit calibration switch makes the same
seed/path replay pass. The serializer directly replayed seed `20260914` and
path `0:1:0:0:0:1:1:1:1:1` at its wire checkpoint. The intentionally failing
cross-formulation commands are calibration evidence, not a package test failure.

## Guide requirement verdicts

These outcomes apply to this follow-up and preserve the baseline's wider
partial verdicts. `Conditional` means the requirement applies only where its
trigger holds. The executable files below supply the contract, model,
grammar, driver, and check; this record supplies exact-revision evidence and
limits.

| Requirement | Follow-up outcome and evidence |
| --- | --- |
| ORC-001 authority and limits | **Partial.** The unsupported FIFO one-timer/no-poll assertion was removed while the documented deadline/order law stayed. Comparison normalization authority is stated and bounded. Offline settlement still contradicts its README: a fulfilled configured `mutationFn` followed by failed fake-storage outbox deletion fulfills the caller although the README requires durable deletion. Product authority must be chosen before that owner can be closed. |
| ORC-002 independent judgment | **Bounded.** Array/Map recomputation, independent branch semantics, and authored provider histories remain separate from the tested production machinery. The new product counterexamples compare against the documented query meaning, not current output. No claim is made for unmodeled query forms. |
| ORC-003 visible responsibilities | **Bounded.** Each changed owner retains its visible contract, model, legal-history grammar, production driver, and public refinement cut. Electric's setup helper is directly named by its driver. No file-format change is required. |
| ORC-004 generated grammar controls | **Improved, still partial.** Central includes now pins transition placements, route shapes, destinations, batch cells, exclusions, and public effects of ablation. Cross-formulation and utils add reconstructed boundary histories and independent branch/value controls. Legal two-descendant rekeys at `[depth,target]` `[3,1]` and `[4,2]` have fixed composed witnesses but remain outside the generated two-transition family. Larger includes scenario, scalar, alpha-renaming, and some full-row/noise grammars remain outside complete ablation evidence. |
| ORC-005 production path and public observation | **Bounded.** New Collection facade, same-root optimistic, D2 live-query, Query DB demand, PowerSync watcher, and Chromium OPFS witnesses reach their named entry points and compare public rows, events, calls, or logical completion at named cuts. Controlled and real-host limits remain distinct. |
| ORC-006 checker calibration | **Improved, still partial.** Exact wrong-result controls, replayed hostile failures, and expected-failure product guards reject named plausible mistakes. Synthetic checker controls calibrate their comparisons; they do not alone prove production capture. Other laws in the portfolio still lack a demonstrated distinguishing kill. |
| ORC-007 fixed/random parity and direct replay | **Improved, still partial portfolio-wide.** Serializer captured a failing shrink path and directly replayed its wire comparison. Cross-formulation captured hostile production-driver failures and replayed each reduced counterexample through the selected main property at public checkpoint 0. Its two checked seed/path/property commands intentionally exit 1 with one named failure; the same commands without explicit calibration pass. Other portfolio replay gaps remain. |
| ORC-008 stateful-model minimality | **Triggered and bounded.** New source-row Maps in the held facade, held optimistic, aggregate QueryRef, and joined `findOne()` references retain distinctions that legal next actions expose. A held facade can show the same old public rows while private rank/value changes make release publish a different order or event. A hidden joined second candidate changes the result after deletion of the first; item/person IDs determine later aggregate matches. These Maps retain source identity and join/rank/value fields, not production queue or compiler state. The optimistic rank argument includes one adjacent legal branch not executed by this fixed witness. |
| ORC-009 vocabulary mapping | **No new divergent model abstraction.** New histories use the glossary's source, Collection, acquisition, replay, publication, and checkpoint terms. Driver-local fault labels are identified as harness diagnostics. The baseline's conditional verdict carries forward. |
| ORC-010 failure fidelity and cleanup | **Improved, still partial portfolio-wide.** Load-subset releases its mutation gate and Collections while optimistic transaction settlement may remain pending, and forwards a rejected applied receipt without unhandled child promises. Separate D2 calibrations resolve held replay work and label multiple cleanup faults. Electric restores an SDK spy and HTTP provider on setup failure; comparison and serializer preserve the first mismatch through shrink/replay. These calibrations are bounded to their harnesses; a cleanup callback that never settles is not covered. |
| ORC-011 second formulation | **Conditional.** Cross-formulation compares independently computed ternary branches and nested/flat/per-parent results. The optimizer's materialized-Collection path is a different formulation that returns the expected aggregate row while the nested QueryRef path fails. No second path is claimed where no shared-fault hypothesis was named. |
| ORC-012 review evidence | **Recorded with gaps.** This record names the exact executable revision, changed owners, applicable requirement outcomes, product counterexamples, campaign results, and remaining coverage owners. It does not promote a partial result into portfolio conformance. |
| ORC-013 distinguishing boundary witness | **Improved, still partial.** Finite child repair and facade events, same-root optimistic overlap, disconnected Query DB branches, virtual root projection forms, OPFS K=1 persist backlog, and D2 scan/restart cuts now distinguish nearby wrong consequences. Matching nested QueryRef aggregates and initial joined `findOne()` remain reachable product counterexamples. |
| ORC-014 controlled-premise handoff | **Improved, still partial.** The same fixture-held storm runs through a real Chromium OPFS worker and is checked at logical adapter completion; native local SQLite plus an SDK-delivered watcher supplies one PowerSync metadata-update premise. Electric live-service framing, external D2/load-subset provider delivery, native Temporal/browser storage, held PowerSync callback ordering, and remote upload remain owned, unproved handoffs. |

## Changed owner evidence and limits

| Owner | New evidence and applicable ORC IDs | Remaining limit |
| --- | --- | --- |
| Browser OPFS fairness spec | Real worker cold-read reach, K=1 backlog, five logical persist completions in FIFO order (005, 013, 014) | One held-BEGIN Chromium history; no durable reopen order or browser matrix. |
| DB comparison property | Contract authority and first-failure fidelity through normalization, shrink, and replay (001, 006, 010) | Bounded value encodings and sampled histories. |
| D2 source reconciliation property | Scan/index truncate and live-query cleanup/restart cuts; labeled fault cleanup and held replay release (005, 010, 014) | External provider event shape and arbitrary graph shapes remain open. |
| Includes Collection property | Held finite ordered repair request, exact facade event payload, identity, silence, and A→B→A value/order history (005, 008, 013, 014) | Controlled provider timing; real-provider ordering open. |
| Includes cross-formulation property | Per-branch ternary relation, bounded grammar, production-driver hostile replay (004, 006, 007, 011) | Longer histories, deeper trees, and async provider races. |
| Includes optimistic property | Same-root optimistic write during held finite repair; exact public snapshots/events, request options, and retained source-rank distinction (005, 008, 013) | Controlled repair request and bounded history. |
| Central includes property | Pinned transition, route, and batch grammar controls with public differences (004, 006) | Two-descendant rekeys `[3,1]`/`[4,2]` are fixed witnesses only; broad scenario, scalar, and alpha-renaming axes need separate ablation review. |
| Load-subset property | Primary and secondary cleanup errors in helper-level calibration; cleanup-protected setup, pending optimistic settlement, and controlled applied-rejection forwarding (010) | Controlled adapter delivery; real-provider cancellation and nonsettling cleanup callbacks are open. |
| Optimizer semantics oracle | Matching inner-join global aggregate now has exact initial public counterexample and materialized control (005, 011, 013) | Nested QueryRef positive law fails; other join forms and updates unproved. |
| QueryRef user-value oracle | Green source-update and later singleton/empty histories; retained source-identity distinction; exact initial aggregate and `findOne()` counterexamples (005, 008, 013) | Two initial QueryRef product defects; other `singleResult` and join forms open. |
| Virtual row fields oracle | Implicit, expression, and functional root publication with wrong-field control (005, 013) | Nested projections and framework receiving cuts open. |
| Utils property | Non-ring grammar reconstruction, adjacent boundaries, and wrong-comparator controls (004, 006, 013) | Declared value classes and graph shapes only. |
| Electric lifecycle and SDK delivery properties | Labeled concurrent assertion/cleanup faults and setup-failure spy/provider cleanup (006, 010, 014) | Authored HTTP plus installed SDK; live Electric frames not observed. |
| Offline FIFO property | Unsupported timer-count claim removed; executor deadline, order, and outbox counts remain checked (001, 013) | Public caller settlement and deletion-failure behavior belong to the settlement owner. |
| Offline serializer property | Captured seed/shrink-path direct wire replay and simultaneous fault cleanup (007, 010, 014) | Controlled Temporal and fake storage; native receiving witness open. |
| PowerSync correctness oracle | Native SQLite, real SDK callback delivery, exact queued CRUD patch for metadata-bearing `Collection.update` (005, 014) | Held callback and zero-field cases controlled; remote upload unproved. |
| Query DB includes-work oracle | Disconnected branch at preload leaves public rows unchanged with exact acquisition/provider calls (005, 013) | Provider scans, facade allocation, and internal index traversal unmeasured. |

## Product counterexamples and unresolved handoffs

| Boundary and owner | Present observation | Required next witness or decision |
| --- | --- | --- |
| Optimizer nested QueryRef inner join, `optimizer-semantics-oracle.test.ts` | Matching global aggregate yields `[]` at initial public snapshot, expected `[{ total: 30 }]`. | Production correction plus adjacent accepting/rejecting and update histories; keep the materialized formulation as control. |
| Flat aggregate QueryRef join, `subquery-user-value-oracle.test.ts` | Initially matching aggregate row is omitted. | Production correction; run first-publication and source-update histories through the same public check. |
| Joined QueryRef `findOne()`, `subquery-user-value-oracle.test.ts` | Two initial candidates are published instead of the first. | Production correction; keep later singleton/empty/restored controls. |
| Offline settlement, `transaction-settlement.property.test.ts` and README | Caller fulfills after a fulfilled configured `mutationFn` and deletion failure while a fake-storage outbox row remains; README promises success only after durable deletion. | Product decision on provider completion, durable deletion, or separate outcomes, then aligned README, model, driver, restart/idempotency witness. |
| Electric live provider, `e2e/electric.e2e.test.ts` | Controlled SDK frames lack a live-service receiver for the exact snapshot-end/subset-end and tagged move premise. | Capture those frames from a live Electric/PostgreSQL service and compare the same public cut. |
| D2 and load-subset provider handoff, their named owners plus Electric E2E | Controlled event and cancellation timing. | Real-provider event/cancellation witness for the specific timing before a cross-boundary claim. |
| Serializer runtime handoff, `transaction-serializer.property.test.ts` | Controlled Temporal constructors and fake storage. | Native Temporal and browser storage receiving cases. |
| PowerSync remote path, `correctness-oracle.test.ts` | Local SQLite and SDK watcher; no backend upload fixture. | Remote upload receiving witness and separate held callback/zero-field Collection path if those claims are made. |

The [coverage map](../oracle-coverage.md) retains additional scoped owner cells.
These open rows are evidence boundaries, not exemptions from the guide.
