# PR 2307: native stores and oracle review

This record covers code commit `2e962b1797e69066de52344fad9ea71811bc843e`. It supersedes the implementation
account at published head `ca5597803ac385a945105785c498f28d7082488f`.
Documentation-only commits can follow this code commit. Source SHA-256 at that commit:

- Solid materializer: `2aa43e691bf9a84101cd3ed92fbdfc28601d01523261b217ff1c0a9ed79443cb`.
- Core select compiler: `959faf4dc755cf381af07e1381730ce5ac5b78e1a6544992e61c5cd872523a8d`.

Historical findings and experiments remain in the
[materialization review](2026-10-30-solid-row-materialization-review.md) and
[snapshot review](2026-10-30-solid-row-snapshot-isolation.md).

## Laws and accepted design

Framework materialization borrows Collection values. It preserves admitted user
values and retained `Collection.get`, `ChangeMessage.previousValue`, and actual
`PendingMutation.original` references. Authority is immutable updates, those
public snapshot contracts, and the shared framework result contract. Core source
admission supplies a premise, not an expected normalization algorithm.

The maintainer chose live nested getters, efficient shared acyclic graphs, and
native stores. Changed nested source containers may replace their owned proxy.
Consumers must read the current path reactively. Captured old nested proxies
need not follow replacement. Unchanged source containers retain identity.
Ordinary root data rows stay stable. Core can evaluate root getters before
adapter admission. Cyclic support remains a separate maintainer decision.

Core selection preserves enumerable own source fields, including user symbols
and ordinary inherited-name shadows. Authority is live-queries.md's "Include
all user fields" and live/ARCHITECTURE.md's public-boundary preservation.
Accepted nested destinations such as `toString` are ordinary own fields.
Authored unsafe alias-path restrictions remain separately enforced.

## Implementation and shipped size

The Solid helper is 136 formatted lines, down from 330. A per-row WeakMap
memoizes detached immutable nested native stores by source identity. Native
stores supply getter tracking and notifications. Root setters replace changed
nested values. An own-key shim handles inherited names, explicit undefined,
omission, and descriptor visibility. Root accessor rows may replace their wrapper.
Unchanged source rows return before copying, although whole-result iteration
still visits rows. No constant-time whole-hook claim follows.

The same externalized hook bundle uses 4,789 minified / 2,026 gzip bytes,
compared with 6,825 / 2,714 for the previous custom implementation: savings of
2,036 minified / 688 gzip bytes. The originally reviewed cut used 3,988 / 1,797.
These are isolated hook measurements, not release-package size or app timings.

Core uses one own-enumerable-field copy helper for both merge branches. It
creates data properties rather than invoking inherited setters. Nested merges
create missing own destination containers before reading them. This also fixes
silent omission at an accepted `toString` destination without changing authored
alias rejection or the existing handling of conflicting own scalar fields.

## Review ledger and repairs

The original F1-F10, S1, and R1-R4 retain their raw claims, evidence, and verdicts
in the historical review. Native stores replace their earlier reconciliation
mechanisms while retaining their laws. Original ten-item totals remain nine
`fixed-now` and one `accepted-design` for the explicitly separate cyclic policy.
S1 and R1-R4 remain five `fixed-now` items.

| ID | Challenged claim | Final disposition and durable improvement |
| --- | --- | --- |
| O1 | Exact direct array-prototype identity rejects legal derived wrappers. | `fixed-now`: inherited capability and independent subclass-method result, positive wrapper plus lost/wrong-method controls. |
| O2 | A null starting value receives mutable-alias reach credit. | `fixed-now`: require actual nonnull shared source identity before credit. |
| O3 | The second React registration supplies DbClient evidence. | `fixed-now`: both registrations use derived identity. Current claims and historical corrections say so. No DbClient credit. |
| O4 | Empty mutation receipts receive original reach without observations. | `fixed-now`: draft sources require nonempty actual receipts. Empty-receipt rejection calibration. |
| O5 | Inherited-name own admission can become undefined. | `fixed-now`: shared inherited-name grammar and explicit own admission before native setter comparison. |
| O6 | Changed source elements must remount exactly twice. | `fixed-now`: compare current values at replacement, then constrain subsequent unchanged admissions. The approved law permits native retained-element updates. |
| O7 | Extreme graph paths miss interior corruption. | `fixed-now`: complete value/shape comparison with pair memoization and three mixed-path corruption controls. |
| S2 | Native stores can replace custom reconciliation if changed nested proxies may replace. | `accepted-design`: explicit maintainer approval. Current-path consumers and unchanged-source identity remain tested. |
| O8 | Core loses an own root `__proto__` source field. | `fixed-now`: own field creation, root/nested selection and all receiving paths. Maintainer explicitly authorized fixing Core in this PR. |
| O9 | A nested cleanup failure skips root cleanup in the new Core driver. | `fixed-now`: nested existing cleanup helpers. Actual fault injection preserves the error and attempts both cleanups. |
| O10 | Object.entries also omits enumerable user symbols. | `fixed-now`: own-key enumeration plus enumerable filtering. Symbol field grammar distinguishes string-only fixes. |
| O11 | Newly required root-symbol draft admission is an unsupported premise. | `fixed-now`: require that admission only for controlled sync sources. Every actual admitted-value/current/retained/original comparison remains. Drafts/proxy-revert and #1820 own top-level symbol-write policy. |
| O12 | An accepted nested `toString` destination is skipped as an inherited function. | `fixed-now`: create an own destination before lookup. Destination grammar and same-model real-host receivers cover direct and deeper containers. |

This round accounts for twelve oracle findings and one approved native design.
Across F1-F10, S1, R1-R4, O1-O12, and S2: **28 items = 26 fixed-now + two
accepted-design**. No item in this declared repair boundary remains open.
Separate pre-existing policy/lifecycle boundaries below retain their owners.

## Oracle-first experiments

Before native adoption, the extended shared grammar failed inherited-name
preservation on the unchanged 330-line helper. The five neighboring adapters
passed nested-shadow controls. Fifteen shared calibrations and three mixed-path
controls passed before the production switch. The first native full suite
passed 226 tests. Later root-shadow histories exposed O8/O10 in common Core.

Before the Core field-copy edit, its expanded owner gave six failed and 138
passing tests, without type errors. Both `__proto__` and user symbols failed at
root spread, root whole-row, and nested spread. Four public paths at admission,
own undefined, and readmission yielded 72 intended own-field mismatches.
All six real framework gates failed callback/config field preservation while
direct Collection controls passed. Actual source symbol admission was checked.

O12 was discovered during final production review. The first deeper-destination
builder accidentally authored the literal key `wrapper.toString`, while the
model required a nested wrapper. That failure was a driver/model mismatch and
receives no deep-path RED credit. A candidate production edit passed the direct
`toString` cases but exposed this mismatch. The candidate was removed, both
builders were corrected to actual nested objects, and the unfixed compiler was
rebuilt. The corrected pre-edit owner then failed all twelve destination cells
at intended own-field comparisons, with 144 controls passing and no type errors.
Every real framework callback/config receiver also failed its intended
comparison before the final destination repair. Earlier invalid deep-path
experiments are not substituted for these actual-path results.

The public-field model and grammar now live in the directly named companion
`packages/db/tests/conformance/public-field-oracle.ts`. The original Core owner
still executes root Collection plus correlated Collection facade, `toArray`,
and `materialize` drivers. Framework receivers reuse the same scalar models,
stages, and complete row comparison through their own source/mount/flush realm.

## Reach and final GREEN

Shared snapshot coverage retains nine common shapes and ten Solid shapes,
one/two source keys, three updates per key, three inputs, and sync/optimistic
writes. Common groups have eighteen histories, Solid groups twenty. Solid adds
sixty real local-only histories. There are 828 history slots across 45 groups,
including the duplicate React API registration. Every group guards its own
reach. Mutable alias counts are eight common / nine Solid per group. Local-only
original reach requires actual nonempty mutation receipts.

The Solid-specific owner retains 85 histories: 24 identity/lifetime, twelve
reorder, twelve resize, 24 getters, and thirteen graphs. Three additional tests
calibrate mixed-path graph judgment. Work is captured before graph comparison
and retains the 32-enumerations-per-distinct-container budget unchanged.

The Core public-field family has sixty histories and 1,200 path/stage
observations. Its original 819 other observations remain intact. Each cell guards
its four paths and five stages. Six source keys cross root/nested location and
four selection forms. Only nested spread varies destination: `payload`,
`toString`, or actual nested `wrapper.toString`. Removing an axis loses a merge
branch, ownness distinction, source-key class, or receiving boundary. Invalid
unsafe authored aliases remain rejection controls. Bounds are one source row,
one matching parent, scalar strings/undefined, and five stages.

Additional framework destination receivers run twelve histories per input,
five stages per history, through callback and config on each actual host.
Each group asserts twelve histories per stage and six per destination. Fourteen
groups across seven registrations supply 168 histories and 840 comparisons.
Direct Collection has no authored destination and remains a snapshot control.
React's two registrations are the same API, not independent semantic coverage.

Final local results, all with `--maxWorkers=2 --coverage.enabled=false`:

- Complete Solid package: **228 passed**, no type errors.
- Core/query neighborhood, eight files: **344 passed**, no type errors. Includes
  complete context-transport owner, select/alias controls, public-container copy,
  user values, functional projections, and fifteen snapshot calibrations.
- Snapshot receiving groups: React twelve, Preact/Vue/Svelte/Angular six each,
  and Solid nine all pass. New destination receiving groups: React four and
  each other adapter two all pass.
- Builds for Core/dependencies and Solid pass. Changed TypeScript ESLint,
  formatting, `pnpm lint:changed`, and diff checks pass. No budget was lowered.

Svelte initially read stale built Core through package exports. Independent
source-alias checks passed six groups. Rebuilding Core made the normal Svelte
command pass. That stale run receives no repaired-code GREEN credit.

Top-level symbol writes through Core drafts are outside the accepted source
premise. Current and clean-main traces both drop the new root symbol while
preserving nested symbols and own undefined. Initial data admits both. The
existing proxy-revert oracle explicitly states that top-level symbols are not
written, and Drafts/#1820 owns the policy. No actual admitted-value comparison
was removed, and no local-only root-symbol-write reach is claimed.

## Hostile checks and independent review

Temporary production mutants restore source in `finally`. On the final owner:

- Old root merge rejects root source-field comparisons.
- Old nested merge rejects nested source-field comparisons.
- String-only copying rejects user-symbol comparisons.
- Ordinary assignment rejects `__proto__` ownness comparisons.
- Removing own-destination creation rejects direct and deeper destination cells.

All five reach intended assertion failures without type errors. The original
native calibration also rejects missing source memo reuse (24 identity/reorder
histories), omitted `toString` own admission, exact-prototype overconstraint,
empty-receipt credit, and extreme-path-only graph checking. Removing all own
admission caused a post-setup proxy runtime failure, not an assertion kill. An
earlier selector skipped all tests and receives no credit.

Four independent oracle reviewers found O1-O7 and the Core sibling O8. Native
reactivity and graph follow-ups each passed ninety focused tests with no new
finding. Production review independently passed ninety Solid tests and thirteen
Core controls, then found O12. The receiving reviewer reproduced O8/O10,
calibrated O9, confirmed O11's existing authority, and reviewed the final companion
extraction. Its five final probes pass: real Solid callback/config reach,
corrupted-output rejection, preservation of primary plus cleanup diagnostics,
and source cleanup for all twelve mount failures.

Hire recommendation: yes for all four oracle reviewers and the production
reviewer. They supplied executable counterexamples, challenged overconstraints
and false reach, and distinguished driver faults, policy choices, and product
violations. Green bounded tests did not become universal correctness claims.

## Guide audit and limits

| Requirement | Final evidence |
| --- | --- |
| ORC-001 | Public snapshot/source-field authorities and explicit native/getter/acyclic decisions above. |
| ORC-002 | Immutable admitted-source facts, scalar stages, and independent explicit selected shapes. No compiler path walker computes expectations. |
| ORC-003 | Literate contract/model/grammar/path/comparison prose accompanies both owners and the directly named companion. |
| ORC-004 | Reconstruction, axis ablation, bounds and invalid authored-path controls above; exact product/uniqueness calibration remains. |
| ORC-005 | Actual source admission, Core four paths and real host cuts. No missing source fact identified in this finite domain. |
| ORC-006 | Original REDs, final five production mutants, wrong-result and cleanup calibrations. Outcomes are classified above. |
| ORC-007 | Not applicable to finite bounded enumeration. Named cases provide direct replay. Existing random campaign budgets remain unchanged. |
| ORC-008 | Retained source versions remain distinguishable by later updates. Core field computation is stateless. |
| ORC-009 | Source Collection, live-query Collection, materialization forms and host cuts retain glossary terms. Version is only the model's stage selector. |
| ORC-010 | Independent cleanup attempts preserve exact primary and secondary failures; actual Core and framework fault injections pass. Arbitrary constructor-failure combinations are not established. |
| ORC-011 | The shared-normalization fault is removed by relational source facts and alternate legal-source calibration. Projection forms are controls, not claimed independent reference models. |
| ORC-012 | Exact code commit, source hashes, every requirement, dispositions and finite closure boundary appear in this versioned record. |
| ORC-013 | Own undefined/omission/readmission, source location, direct/deeper destinations, and ordinary-name controls distinguish narrow wrong fixes. |
| ORC-014 | Every required actual host supplies its own source/mount/flush premise before each final production repair. No provider or browser-rendering evidence is claimed. |
| ORC-015 | Per-group and per-cell guarded reach and concrete counts above. Invalid literal-dotted driver experiments receive no deep-path credit. |
| ORC-016 | Fixed cells use the shared models and comparisons. Checker controls supply deliberately wrong observations. Supplemental examples remain ordinary tests. |

Closure is bounded by these contracts, finite histories, production paths,
and synchronous Core or settled/held-handler framework observations. It does
not establish arbitrary cycles, deep recursion, getter/setter bodies, hidden
symbols, every descriptor visibility notification, callback atomicity, other
settlement schedules, browser rendering, or external-provider behavior.

Native Solid proxy assignment through Core drafts remains a separate Drafts
support-policy question. Cycles remain the maintainer's separate decision.
The lifecycle publication counterexample at seed `-1439698414`, path `1:22`,
reproduces on clean main and remains separately tracked by the maintainer's
explicit decision in [#2310](https://github.com/TanStack/db/issues/2310).
This PR's Core change concerns selection, not publication expectations.
Final pushed-head CI/review status belongs to the PR and is separate from these
local verification results.

## Integration with main

Main advanced to `0531c50ad419a1b51ad3e27e3632e70be3c6bdb3` before publication.
The merge conflict was confined to appended coverage-map sections. Both the
framework/selection evidence and main's distinct-collision evidence remain.
The production file hashes above are unchanged. The combined tree passes the
Core/dependency build, 344 Core/query tests, all 228 Solid tests, and snapshot
plus destination groups on all six adapters, without type errors. Changed-oracle
lint and diff checks pass. This tests integration with main's Effect and D2
changes without revising their laws or the separate counterexample owners.

## Later CodeRabbit visibility finding

Review `5718065479` covered `3ca65a6a1`; inline `4428014103` identified a
raw/proxy comparison in the root descriptor-visibility branch. The same source
was present after merge commit `11b42a11f`. The claim is correct for the internal
materializer: an unchanged nested payload becomes a native proxy, while the
current raw row contains its unwrapped node. Changing only enumerability then
skipped a native write and left captured-root `Object.keys` consumers stale.

Public-path probes did not supply this premise. Direct sync input and functional
projection through callback, config, and supplied live-query Collection inputs
omit the hidden root field before adapter admission. Core's public row snapshot
enrichment spreads the row, normalizing root descriptors. The snapshot in
`sync.ts` is a reused-row guard, not the admission copy. These probes are missing
public premises, not public-hook RED evidence. No public descriptor-admission
promise follows from this repair.

The internal invariant preserves the helper's existing data-descriptor behavior
and native shape notifications. Twelve helper histories cross six payload kinds
with both initial visibility flags. Fresh immutable roots retain one payload
through unchanged, toggled, returned, and toggled visibility. The independent
comparison derives visible keys from the flag and observes a real Solid render
effect on the captured stable root. It also checks current keys, retained source
descriptors, payload identity, and root identity at each settled host cut.

Before the production edit, the extended owner rejected six object, array, and
native-store histories at the intended enumeration assertion. Six scalar, null,
and undefined controls passed. The repair compares against `unwrap(value)` in
the existing visibility guard. This changes one line and lets the existing
setter restore the exact admitted payload after its notification pulse.

All 240 Solid tests pass without type errors. The old raw/proxy guard mutant
again fails the six container histories at the same assertions, with six
controls passing and no type errors. The source is restored afterward. Solid
build, changed-file ESLint, `pnpm lint:changed`, and diff checks pass. Each of
the twelve histories guards unchanged, hidden, visible, and restored visibility.
The externalized hook now uses 4,792 minified / 2,024 gzip bytes at gzip level 9.
The same command on the parent produces 4,789 / 2,026. The helper remains 136
lines. Its new SHA-256 is
`4041a16af2f55e47f952fba1979796e2410be6c90102c86d52556530eb5d3ed9`.
Core's source hash is unchanged.

Guide audit for this extension: ORC-001/002 use the internal descriptor invariant
and independent visibility flag. ORC-003 keeps the model, grammar, driver, and
limits beside the family. ORC-004 reconstructs both visibility directions and
separates scalar controls from wrapped containers; accessor and mutable-source
updates are excluded. ORC-005/014 claim only the real Solid helper boundary and
record the absent public premise. ORC-006/013 use the six REDs and restored
wrong-guard mutant. ORC-007 does not apply to finite enumeration. ORC-008 has no
stateful reference change. ORC-009 uses existing terms. ORC-010 uses the existing
failure-preserving lifetime. ORC-011 has no identified shared semantic fault:
the visibility flag and JavaScript key enumeration are separate formulations.
ORC-012 records exact source hashes and outcomes here. ORC-015 guards every
declared state per history. ORC-016 runs one reusable comparison over the grammar.

The reviewer found a valid internal edge case but did not establish a public
receiving path. The suggested unconditional pulse is broader than necessary;
the one-line unwrapped comparison preserves existing scalar behavior. Hire
recommendation remains yes for useful source analysis, with that reach limit.
This adds C1 as `fixed-now`: **29 items = 27 fixed-now + two accepted-design**.
The earlier 28-item audit remains unchanged as historical evidence.
