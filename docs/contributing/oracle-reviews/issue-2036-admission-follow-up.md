# Accepted sync transactions after persistence reads

## Status and revisions

The high-effort review found a real adjacent failure in PR #2037 at
`5688e232eff34eeac555f2586a34672bad25865b`. The earlier merge-ready assessment is
withdrawn. The local repair passes the tests below. The maintainer has now
specified persisted-baseline precedence; the dated follow-up below supersedes
the initial pending-policy assessment. No broad bug-class closure is claimed.

This record supplements the [original audit](issue-2036-queued-hydration-publication.md).
The initial evaluation checked that exact PR head and these candidate blobs:

- Production: `9c5d3563c0e2e72005c1ed9b5756c951b3035857`.
- Oracle: `048adb1f38d39e73614407b6eb7ad190fe47b580`.
- Pre-PR comparison: `cfb03f201bb21d82b7f537a9fbe59d3623f395d6`.

The author and bot commits remain intact. The first evaluation left changes
local while the policy question was pending. The dated follow-up records the
subsequent maintainer decision and verification. Historical hashes identify
historical evidence; they are not silently replaced with new hashes. The initial
formatting-only successor reflowed one `flatMap` expression.

## Missing history and repair

The existing metadata-ownership test already supports beginning during H1 and
committing after H1 finishes. The old 24-cell grammar only begins before any
hydration. It cannot reconstruct this supported admission timing.

The new eight-cell grammar begins during H1, retains its captured metadata
ownership, and commits after H1 finishes. H1's adapter scope remains held after
its task completes. In ordinary mode, one or two later subset loads reserve the
mutex first. In immediate mode, existing admission logic holds those loads
behind the source. The driver records the load count at source durability to
prove these different orders. The other axis is whether H1 supplied the source
key. All receipts settle before rows, metadata and status are compared.

At the reviewed head, all four ordinary cases reject the source receipt with
`a persisted sync transaction cannot cross a hydration cycle`, retain the old
row, and set Collection status to `error`. The four immediate cases pass.
Instrumentation confirms ordinary admission is accepted at sequence 1 but
publication checks sequence 2 or 3. The original matrix always has
`queuedBecauseHydrating === false` at source admission.

The candidate retires `openTransaction.hydrationSequence` only after ordinary
commit admission. The publication check remains unconditional. Queued replay
retains its sequence, and all transactions retain their captured
`hydrationContext`. The flag is not cleared or reinterpreted: it also controls
metadata treatment and immediate replay. The candidate is two production lines
smaller than the PR, and adds three lines over the integration main.

## Lossless review reconciliation

The reviewer supplied eight numbered findings and two omitted notes. Each is
retained separately below. Overlap does not remove an item.

| ID | Technical judgment | Action and durable value |
| --- | --- | --- |
| H01 | Confirmed P1. Four legal ordinary histories reproduce accepted-commit failure at the receipt/status/row checkpoint. | `fixed-now` locally. Eight adjacent histories remain in the persistence oracle. |
| H02 | Correct distinction between captured hydration ownership and commit's replay branch. Clearing the existing flag would conflate other responsibilities. | `duplicate` of H01. The suggested retirement of the sequence on ordinary admission is the implemented alternative. |
| H03 | Confirmed missing timing dimension. Instrumentation proves the original matrix never flags its source transactions. | `fixed-now`. The new grammar varies timing, captured key membership, count and admission order. |
| H04 | Confirmed scope change, not a proven corruption result. Accepted inserts and deletes survive queued collection-reset and coordinator full-reload notifications on the PR; they reject on pre-PR main. | `fixed-now` oracle coverage after the maintainer decision below. Accepted sync transactions follow the older persisted baseline. Compatible rereads and ordered truncate replay now have 90 permanent histories; invalidated resume points remain outside this evidence. |
| H05 | The claimed contradiction is refuted: the comment says fresh inserts reset metadata, not complete row values. A quiescent pre-PR comparison preserves omitted detail in all 24 cases. The reference does not import production classifiers. | `refuted` as a defect in this scheduling change. Added prose identifies retained legacy upsert/partial-value behavior. This is compatibility evidence, not an independent proof that all legacy insert semantics are ideal. |
| H06 | The original prose explicitly limited the result to 24 histories, but its checked broad title could imply more coverage. H01 defeats that wider reading. | `fixed-now`. The coverage item is open, with supported histories and remaining reset, cancellation, cleanup and failure witnesses named. |
| H07 | The old record identifies an older blob. The claim that formatting invalidates the results is too strong: the exact reviewed head passes its 39 focused checks, and fresh controls reproduce the intended failures. | `fixed-now` evidence receipt. This record preserves historical provenance and pins the tested local candidate blobs. |
| H08 | Recording occurred before adapter completion, but the claimed false green is refuted. Injecting a rejection after that recording makes all 24 original cases fail on receipt/status/durable-state assertions. | `fixed-now` recorder precision: record titles after adapter success. No expectation is weakened. |
| H09 | Confirmed behavior change without a demonstrated defect. A delete issued while its public row is absent removes the row after later hydration supplies it. Receipts fulfill and public/durable state agree. | `fixed-now` permanent delete dimension in the 90-history grammar, including on-demand commits before the persisted row is public. The omitted-public-delete mutant fails all ten no-truncate delete histories. |
| H10 | The speculative leftover-replay/reset failure was not reproduced. Two commits queued during H1 drain before a reset queued behind that scope, on both reviewed head and candidate. | `confirmed-open` with an evidence gap, not a confirmed product defect. A smallest failing schedule is still required; the owner and bounded successful control are recorded in the coverage map. |

Current totals: ten raw items = seven fixed locally + one duplicate + one
refuted + one open evidence gap. H04 was initially a design decision and H09
was initially deferred; the dated follow-up resolves both within its stated
scope. H10 still lacks a failing history. No item is discarded.

## Initial evaluation: evidence and limits

The final candidate passes 23 package test files: 746 tests, two existing TODOs,
and no type errors. Standalone TypeScript passes. ESLint reports no errors and
22 existing `require-await` warnings. No warnings occur in the added block.
The same cached third-party toolchain limitation as the original audit applies.
DB and DB-IVM resolve to builds from this worktree.

| Control | Result at the intended checkpoint |
| --- | --- |
| Restore the reviewed publication guard | Four new ordinary cases fail receipt/status/row comparison. |
| Restore integration-main production | Original 24 cases and four new ordinary cases fail. |
| Remove ordinary commit validation | Existing begin-before/commit-after test fails its missing-throw assertion. |
| Retire captured metadata context with the sequence | Four owner-supplied cases fail metadata comparison. |
| Remove ordinary insert's explicit metadata deletion | All 12 original insert cases fail metadata comparison; updates pass. |
| Reject adapter write after the original early recorder | All 24 original cases fail, disproving the proposed false-green mechanism. |
| Establish baseline before source writes on pre-PR production | All 24 original row/metadata comparisons pass, supporting compatibility. |
| Queue reset or coordinator full reload before accepted insert/delete | Six route/operation probes pass on reviewed head and candidate, and fail on pre-PR main. The subset route is the comparison control. |
| Queue two hydration-owned commits, then reset | Both replay receipts fulfill and the second value survives reset; no leftover failure is established. |

Every negative result above is an assertion failure, not a timeout or setup
failure. Temporary mutants were removed and candidate hashes rechecked. An
initial nonexistent config path and one transient formatting syntax error were
setup failures, corrected and excluded from behavioral evidence.

The reset probes use real runtime coordinator-message handling and a controlled
adapter. They do not establish browser cross-tab delivery or choose reset
precedence. RFC #1659 invariant 7 allows durability/replay or observable failure;
it does not by itself choose the result of accepted work across a full reset.
Source-truncate notification, schema-changing resets, native-host execution,
and arbitrary reset/replay interleavings remain outside these probes.

## Initial evaluation: oracle-guide delta audit

| Requirement | Follow-up evidence |
| --- | --- |
| ORC-001 | Supported begin-during/commit-after history derives from the existing metadata-ownership contract; full-reset policy remains explicitly open. |
| ORC-002 | Constant source records and captured key-membership expectations are independent of production sequence/queue helpers. The new source insert supplies its complete expected row. |
| ORC-003 | Local prose states the law, finite grammar, adapter hold, immediate-order difference, observations and settlement checkpoint. |
| ORC-004 | Four ordinary failing histories are reconstructed; four immediate histories preserve the alternate legal order. Captured key membership distinguishes wrong metadata rebinding. |
| ORC-005 | Real source begin/write/commit and subset paths run. Adapter counts witness the source-versus-hydration ordering; receipts, full rows, metadata and status are compared. |
| ORC-006 | Old guard, metadata-context loss, commit-check loss and stale insert metadata all fail the intended assertions. |
| ORC-007 | Not triggered by these bounded enumerations. Existing generated campaigns remain unchanged. |
| ORC-008 | No state is added to the independent reference model. |
| ORC-009 | Shared terms retain glossary meaning; captured metadata ownership and replay admission are explicitly distinguished. |
| ORC-010 | Observations precede bounded cleanup; load and scope gates release in `finally`; each unload is inside the existing cleanup helper. |
| ORC-011 | The named insert-semantics concern is compared with pre-PR quiescent behavior. This establishes compatibility only; ideal legacy insert semantics are not independently proved. No product expectation was rewritten. |
| ORC-012 | All ten review inputs, exact revision/blob receipts, requirement outcomes and unresolved boundaries are preserved here. No class closure is asserted. |
| ORC-013 | Original and adjacent admission timings distinguish the old guard from the candidate; captured key membership kills context loss. |
| ORC-014 | Evidence remains at controlled adapter/coordinator boundaries. Live Electric/OPFS schedules retain their named receiving owner in the coverage map. |

## 2026-10-05: persisted-baseline precedence decision

The maintainer specified: "persisted reads are by definition more stale than a
new network read" and requested an oracle update. For the compatible-baseline
histories here, persisted rows precede newer accepted sync transactions from the
sync adapter. Reading those rows cannot revoke acceptance. An authoritative
truncate replay has its own position in source order: it supersedes earlier
writes, and later sync transactions apply to that replacement.

The previous recommendation to preserve rejection after every reset or full
reload is withdrawn. The six original probes supplied coordinator notifications
that requested another persistence read. They did not establish an invalidated
resume point or a schema-changing destructive reset. Observable failure remains
required when work actually fails; it does not justify rejecting valid work.

### Final candidate and verification

The follow-up starts from PR head
`5688e232eff34eeac555f2586a34672bad25865b`. These exact final blobs are the
verification receipt, independent of the later commit that stores this record:

- Production: `9c5d3563c0e2e72005c1ed9b5756c951b3035857` (unchanged from the initial local repair).
- Oracle: `fff6e71f309c9340de9555c1937675d1e6d21200`.
- Original implementation comparison: `cfb03f201bb21d82b7f537a9fbe59d3623f395d6`.

The 24 original and eight adjacent histories remain. The new 90-case grammar
has five mode/route combinations, three source operations, three truncate-replay
positions, and two schedules. On-demand Collections acquire a subset or receive
reset/full-reload notifications. Eager Collections receive those notifications.
Each insert/update/delete history runs with no truncate replay, replay before
the change, and replay after it. Commit acceptance occurs either before the
queued read runs or after its publication. Expected results do not depend on
that timing.

The reference computes the final snapshot directly from source order. A later
replacement wins. Otherwise the newer change decides the shared key, and
unrelated baseline rows survive only without a truncate replay. Row values are
complete and metadata is explicit, so this extension does not redefine partial
updates or the omitted-field question in H05. The cursor is opaque collection
metadata, not proof of a compatible provider resume point.

The driver holds an earlier persistence write and invokes the real Collection,
persisted wrapper, and coordinator-message handler. The loaded rows and durable
completion trace prove that the older baseline runs before the newer source
changes. The final checkpoint compares every operation outcome, Collection
status, exact public/durable rows, row metadata, and cursor metadata before
cleanup. The mixed operation list includes applied receipts and a subset-load
promise; it does not treat them as the same boundary.

| Verification | Result |
| --- | --- |
| New grammar on the local repair | All 90 histories pass. |
| Original implementation on the new grammar | All 45 queued histories fail at the outcome/row/status comparison; all 45 serial controls pass. |
| Omit public application of source truncate | All 60 histories containing truncate replay fail final comparisons. The 30 histories without it pass. |
| Omit public application of source delete | All ten no-truncate delete histories fail exact public-row comparison. The other 80 histories pass; truncate makes the omitted delete unobservable at their final checkpoint. |
| Final configured package suite | 23 files pass, 837 checks pass, two existing TODOs, and no type errors. |
| Standalone TypeScript | Exit 0. |
| ESLint | Exit 0, no errors, 22 existing require-await warnings outside the new block. |
| Experimental Prettier CLI and whitespace check | Pass. |

The mutant runs produced assertion failures, not timeouts or setup failures.
Their test revision preceded the final mixed-operation naming and parameter
formatting changes. The final suite ran on the exact oracle blob above. Every
mutant was removed; the production hash matches the initial local repair.

Local logs and mutation scripts remain in `.review-2036-2037/high-effort/` and
are not PR content. Earlier cached tool links broke. Fresh installation failed
at the configured registry with 403 and at the public registry with a fetch
failure. Verification used local cached packages: Node 24.19.0, Vitest 3.2.4,
TypeScript 5.9.3, Prettier 3.9.9, and compatible Rollup 4.59.0 instead of locked
4.64.0. Package imports resolve to DB and DB-IVM builds from this checkout.
The lockfile and package manifests did not change. CI must check the locked
toolchain. Failed dependency/formatter setup attempts and the initial recorder
type error are excluded from RED evidence. The optional changeset validation
script is absent; the existing patch changeset covers the only changed package.

The production follow-up remains +4/-6 lines against the published PR, or
+3/-0 against its integration main. The oracle follow-up is +457/-5 lines
against the published PR, including the earlier eight-history repair. This
precedence extension adds no production state or behavior beyond that repair.

### Additional review and loss audit

A fresh correctness review found no blocking model, driver, or product defect.
The simplification review recommended only clearer naming for the mixed wait
list. It recommended keeping the finite grammar and all observations intact.

| ID | Raw finding or note | Evaluation and disposition |
| --- | --- | --- |
| P01 | The new receipts list also contains a subset-load promise. | Direct source confirms the terminology mismatch. `fixed-now`: use pendingOperations/retainOperation and name both settlement kinds. |
| P02 | The final checkpoint does not establish intermediate publication or individual receipt timing. | Correct limit of the declared settled-result law. `deferred` stronger claim to the persistence-history owner and coverage map. |
| P03 | Controlled notifications do not establish real cross-tab delivery or invalidated-resume behavior. | Correct controlled-boundary limit. `deferred` to the named persistence-history and browser OPFS/Electric owners in the coverage map. |
| P04 | Pending-reset-policy and missing-delete documentation is stale after the new evidence. | Direct source confirms both statements need revision. `fixed-now` in the coverage map and this record. |

The new review totals are four = two fixed-now + two deferred with named owners.
The original ten-item totals are seven fixed-now + one duplicate + one refuted
+ one confirmed-open evidence gap. H10 still needs the reviewer's smallest
failing schedule. The original reviewer remains a strong hire for finding the
supported begin-during/commit-after history by inspection. Its overlapping
items and overstated test-integrity claims retain their original dispositions.

### Oracle-guide audit for the precedence extension

| Requirement | Outcome |
| --- | --- |
| ORC-001 | The maintainer decision establishes precedence. The glossary defines sync transaction, applied receipt, publication and truncate replay. Compatible-baseline and settled-result limits are explicit. |
| ORC-002 | The reference derives exact snapshots from ordered replacement and newer insert/update/delete effects. It reads no production flags, sequence counters or classifications. |
| ORC-003 | Prose precedes the grammar, explains the independent algebra, describes controlled production scheduling, and names the final observations. |
| ORC-004 | Bounded enumeration covers 5 mode/routes × 3 operations × 3 replay positions × 2 schedules. Each axis changes a path, effect or precedence boundary. Both notification routes, eager startup, absent-key delete, and both replacement orders are reconstructible. Invalidated resume points, errors and still-open cross-read transactions are excluded explicitly. |
| ORC-005 | Real begin/write/truncate/commit, subset acquisition and coordinator-message handling run. Exact loaded baseline, pre-release observations and completion traces witness the path. All modeled rows, metadata and cursor values reach comparisons. |
| ORC-006 | The original guard fails 45 queued histories while serial controls pass. Public-truncate and public-delete mutants fail 60 and ten histories respectively at assertions. |
| ORC-007 | Not triggered: the extension is a bounded enumeration, not a random generated property. Existing generated campaigns remain intact. |
| ORC-008 | No mutable reference state is introduced. The reference directly computes the final snapshot from input source order. |
| ORC-009 | Shared concepts use glossary terms. Source-step labels identify input sync transactions, while the mixed wait list distinguishes applied receipts from subset-load settlement. |
| ORC-010 | Observations precede cleanup. The held persistence gate releases in finally, retained rejections are observed, and the existing bounded cleanup helper preserves primary and secondary failures. |
| ORC-011 | Serial controls supply a second scheduling formulation for the same source history. Original production agrees with the reference on all 45 controls, while queued cases expose the guard error. H05's separate quiescent compatibility evidence remains intact. |
| ORC-012 | Both review inventories reconcile above. Exact head/blob receipts, all applicable requirement outcomes, limitations and coverage-map destinations are retained. |
| ORC-013 | Before/after truncate distinguishes ordered replacement from unconditional source preservation. Queued/serial controls distinguish acceptance from publication timing. Eager/on-demand no-truncate deletes distinguish already-public and absent-key admission. |
| ORC-014 | The claim is limited to controlled compatible notifications and recording adapters. The coverage map names live Electric/browser OPFS, invalidated resume points, schema changes, and intermediate publication as separate receiving evidence. |

No broad closure claim follows. Cancellation, cleanup, read failure, arbitrary
buffered replay/reset interleavings, and the semantic basis of the still-open
transaction restriction retain their named persistence-history owner.

## 2026-10-05: integration with the current sync API

PR head `4c9962e4ec30e2579dfbbd4bc7ad4e61d10c408f` passed the
standalone-branch checks recorded above. Those results did not establish that
it passed with current main. CI job `112035444776` in run `37388315568`
checked out merge `7ef5161` against main `49abb32ff`. Main commit
`eac6e8b6a` (#2030) had removed `begin({ immediate })`. Three calls in the
new oracle still used that API. Four histories also expected the reservation
that the removed option no longer supplied. CI correctly rejected both the
calls and those ordering observations.

This follow-up merges main `482196ec4c4369ec540b510ced926bb7d82d7231`
without rewriting published history. DB-IVM and DB were rebuilt from the merged
sources before testing. The unmodified integration reproduced all four runtime
failures and all three type-error locations. The earlier local success was a
base-integration gap, not evidence of a flaky test or stale dependency output.

The existing adapter capability `metadata.persistence.reserveCommitTurn()`
replaces the removed option in these fixtures. Its documented contract reserves
an open sync transaction's turn ahead of later subset reads; Electric uses it
for overlapping stream transactions. All 24 original and eight adjacent
histories remain. Their rows, metadata, receipts and exact ordering comparisons
are unchanged. The two admission orders are now named unreserved/reserved
commit turns. The 90 precedence histories and their reference algebra are
unchanged. This repair adds no production behavior beyond main's integration.

### Revision and execution receipt

- Integrated production blob: `314a0ea3ea7a858a7f69bfd33dadda8566100063`.
- Final oracle blob: `68ae72caf3713875b0ba466a9698434eb62cea5b`.
- Calibration oracle blob: `b9459c822b3f47c314dd3b42ebf2dcfa41726873`.
  The only subsequent oracle edit wraps one grammar comment; executable code
  and assertions are identical. The full suite uses the final blob.
- Both dependency builds use main `482196ec4`; this PR does not modify those
  sources. Cached third-party tooling has the same Rollup limitation recorded
  above. The merge imports main's manifests and lockfile without local edits.

| Check on the integrated candidate | Result |
| --- | --- |
| Unmodified integration | Same four ordering failures and three type-error locations as CI. |
| Updated fixture | All 122 histories and their three typechecked definitions pass. |
| Remove sequence retirement | 73 histories fail: the original 24, four unreserved begin-during-read histories, and 45 queued precedence histories. The other 49 runtime histories pass. |
| Restore the reviewed flag-based guard | All four unreserved begin-during-read histories fail; the four reserved controls pass. |
| Omit public truncate | 60 precedence histories fail, 30 pass. |
| Omit public delete | Ten no-truncate delete histories fail, 80 pass. |
| Omit commit-turn reservation from the updated fixture | Four reserved histories fail the exact read-count observation; four unreserved controls pass. |
| Final full package suite | 23 files, 836 passing checks, two existing TODOs, no type errors. |
| Standalone TypeScript | Exit 0. |
| Final package lint | No errors; 25 existing require-await warnings. |

All hostile controls failed at assertions, with no type, timeout, or setup
failure. Every temporary mutation was restored. The only additional correction
sorts two imported names in `sqlite-boolean-arity-oracle.test.ts`; that lint
error was already present on main and does not alter the oracle's behavior.

### Audit delta and loss reconciliation

ORC-001 and ORC-009 now cite the documented commit-turn capability for the
fixture's ordering control. ORC-002's independent expected values do not change.
ORC-003 and ORC-004 retain all histories and describe both supported orders.
ORC-005, ORC-006 and ORC-013 have fresh path and hostile-control evidence above,
including a direct omission control for the replacement API. ORC-007 remains
inapplicable to the bounded enumeration; ORC-008 adds no model state.
ORC-010's cleanup and ORC-011's serial controls remain intact. This appended
revision receipt satisfies ORC-012 for the integration repair. ORC-014 retains
the controlled-adapter limit; calling the same capability as Electric does not
prove live Electric or host delivery. The coverage item remains open.

CI01, the user-reported integration failure, is confirmed and `fixed-now`.
CI02, the inherited import-order lint error, is confirmed and `fixed-now`.
The ten original review items retain seven fixed-now, one duplicate, one refuted,
and one confirmed-open evidence gap (H10). The four additional review items
retain two fixed-now and two deferred to their named owners. Current-head
CodeRabbit review `87aabed8-7ed1-4853-a6c0-d83e12999aeb` has no new code
findings; its repeated docstring metric remains duplicate C04. No review item
or tested history was discarded to make this integration pass.
