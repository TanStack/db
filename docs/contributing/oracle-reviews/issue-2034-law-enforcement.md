# Temporal persistence: law enforcement audit

Audit base: `bc00255f8dd577214b5fbf049487dab333b5a9ab`. This supplements
HE-008 and CR3-001. The question is whether the law reaches a discriminating
assertion, not whether the reported example or surrounding suite passes.

## Conclusion and reviewer assessment

The previous closure statement was too strong. The production repairs still
satisfy the expanded checks, but three wrong implementations passed the relevant
old assertions: a validator that changes a caller's Date, a coordinator boundary
that silently swallows asynchronous index failure, and release with a newly
copied options object. The latter already had reference-identity checks in other
acquisition histories; those did not establish that the rich local/follower
receiving history enforced the same promise.

CodeRabbit's index finding remains accurate and its two-call-site repair is
appropriate. Hire for that scoped control-flow review. Its review did not supply
executable law coverage. Our earlier evaluation added a useful reproduction but
did not sufficiently challenge read-only builtin state, independent collaborator
outcomes, or the identity observer. This follow-up repairs those test gaps.
No production behavior, transport domain, or failure policy changes.

## Laws, authority, and enforcement

| Law and authority                                                                                                                                                                                                   | Independent expectation and reachable histories                                                                                                                                                                                                                                                                                                                                                                                                    | Production path and assertion cuts                                                                                                                                                                                                                                                                                                                                                                                                            | Calibration and scope                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admission is read-only, even if a later field is rejected. The wire API validates caller-owned data; freezing a wrapper does not authorize mutation of builtin state.                                               | Compare explicit timestamp, byte, container, key-shape and alias observations with independently specified before/after values. Cross successful validation with an invalid limit after a rich predicate, and retain the original expectation after rejection. The Node receiving owner captures a pre-validation structured clone. Include Date, buffer/view, Map, Set, and shared records; the receiving owner retains all supported rich kinds. | Real validation and encoding. Compare caller state immediately after each call or caught error. Browser receiving compares against a pre-validation snapshot, not live input.                                                                                                                                                                                                                                                                 | Date-mutating validator passed 22 old targeted checks. It now fails three assertions: accepted input, rejected suffix, and rich receiving. Finite graphs and schema positions are explicit; this does not claim arbitrary proxy safety.                                                                                                                |
| Projection creates a fresh, detached data snapshot at each call while preserving aliases within the appropriate schema role. Established wire-value semantics and the existing fresh-projection law.                | Capture literal before/after graphs. Between calls mutate Date time, bytes, a shared record, and Map/Set contents. First output must retain before values, second must carry after values. Rich receiving covers cycles, sparse arrays, typed arrays, maps, sets, dates, regexps and special scalars.                                                                                                                                              | Real encoder plus actual Browser coordinator code through controlled local/follower transport. Compare output meaning with captured expectations, identity against caller nodes, backing-buffer aliases, and per-call freshness. Separate role fixtures reject an object reused under an incompatible schema.                                                                                                                                 | Returning a caller Date as the snapshot fails two final assertions; rejected-suffix control still passes. Existing identity-cache and role-confusion witnesses remain. No real-browser scheduling claim follows from the controlled transport.                                                                                                         |
| Live lifecycle references stay local and release uses the exact object delivered to the owner. Existing acquisition identity contract.                                                                              | Local route retains exact signal/subscription; follower route excludes both. Each release must use its corresponding delivered options reference, once.                                                                                                                                                                                                                                                                                            | Real coordinator receiving and release. Check local references on delivery, field absence remotely, release count and reference identity after both releases.                                                                                                                                                                                                                                                                                 | Replacing release options with `{ ...options }` passes the former rich-fixture deep-equality assertion and fails the new `toBe` assertion. Neighboring acquisition tests retain their own exact-reference checks.                                                                                                                                      |
| Wire rejection precedes remote retry/owner admission and is rechecked when a retained request changes route. Approved exclusion of native Temporal from the wire contract, not from supported local SQLite storage. | Independent hostile values and named error paths; both native kinds and string controls; immediate remote demand, held hydration followed by role change, local success followed by gap recovery; release/abort versus retained demand.                                                                                                                                                                                                            | Existing persisted and Browser owners. Assert exact error/path, zero owner/RPC entry for invalid requests, no retry admission, and expected terminal Collection state for invalid retained recovery. Valid neighboring demands must dispatch.                                                                                                                                                                                                 | Prior no-admission mutant has 49 reached failures with two controls; omitted detachment check has three failures with a passing DataView control. Existing error/retirement histories remain green. Wire support policy is unchanged.                                                                                                                  |
| Admission must not construct discarded full request snapshots; each attempted coordinator request has at most one detached payload copy. User-authorized HE-008 work law.                                           | Independent schedule predicts zero, one, or two attempts. Six routes crossed with 0/1/33 bytes: follower, ownership transition, retry, abort, release, gap recovery. Counters measure buffer and ordinary-record copying, including descendants, with positive controls.                                                                                                                                                                           | Real persisted wrapper and wire encoder behind controlled coordinator. At settlement assert attempt count, label and bytes, caller isolation, shared backing buffers, signal exclusion, and both copy budgets.                                                                                                                                                                                                                                | Final assertions reject all 18 cases with original guards. This measures those copy operations and the discarded-full-snapshot design, not every allocation primitive or elapsed time. Separate validation traversal remains intentional.                                                                                                              |
| Failure of an optional index cannot fail Collection readiness or ordinary data access, and must remain observable through its existing warning channel. Existing best-effort index boundary.                        | Twelve serializer cases: startup/runtime crossed with both supported Temporal kinds, ZonedDateTime, Duration, and missing globals for each supported kind. Twenty-four collaborator histories: startup/runtime × local/coordinator/both × synchronous/held settlement × success/failure, with a healthy sibling.                                                                                                                                   | Real Collection index addition, serializer and persisted wrapper. At collaborator entry/held cut assert no Collection error and no premature warning. While runtime work is held, assert ready status and the unchanged row. After settlement assert exact local/coordinator call multiplicity, exact warning causes by reference, no unhandled rejection, ready status and exact row. After a further subset load assert the same row again. | Original serializer boundary and local-only repair each fail eight cases with four supported controls in the final matrix. A swallowed coordinator Promise rejection passes 13 previous index checks but fails four new delayed-failure cases; 20 controls pass. Broader index semantics stay with Collection and real SQLite expression-index owners. |
| Local index completion evidence must describe completed successful work, and coordinator RPC must occur outside the local hydration scope. Existing local completion and scheduling contracts.                      | A held local result cannot yet authorize its coordinator request. After failure its marker/capability are false/absent; after success both identify the completed adapter. Sibling outcomes are independent. Existing crossed-tab grammar varies 2–4 tabs, 1–2 indexes, and routing direction.                                                                                                                                                     | New optional-index matrix asserts intermediate absence of target coordinator entry before local settlement, then exact marker and adapter identity. Existing controlled-scope and generated crossed-tab owner asserts coordinator entry after local scope release.                                                                                                                                                                            | Removing the local await fails eight intermediate assertions while sixteen controls pass. The initial mutant run also contaminated two following cases with delayed errors; cleanup now drains rejection delivery before removing the observer. Those collateral failures are not credited as kills.                                                   |

For each row the law is stated independently of production, its declared
histories reach the relevant code, and asserted observations distinguish the
named wrong design. No known counterexample remains inside these stated
boundaries. Finite witnesses and specific mutants do not establish a universal
proof over arbitrary graphs, hosts, or future implementations. In particular,
construction counters are calibrated sensors, not a total-allocation metric.

## Finding ledger and loss audit

| ID     | Audit finding                                                                                                                                        | Disposition and durable destination                                                                                                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LA-001 | Live-input expected values can hide validation mutation of builtin state.                                                                            | fixed-now: before-validation snapshots and accepted/rejected input checks in the existing persisted and Browser owners; demonstrated old false green.                                                                                                   |
| LA-002 | Rich graph alias checks did not independently establish detachment and later-call freshness for mutable builtins.                                    | fixed-now: explicit source detachment plus before/after mutation histories; shared-Date mutant rejected.                                                                                                                                                |
| LA-003 | The serializer reproduction did not fully encode independent collaborator failure, delayed settlement, error observability, and truthful completion. | fixed-now: 12 serialization cases and 24 collaborator histories; swallowed-error false green and early-completion mutants calibrated.                                                                                                                   |
| LA-004 | Reconcile wire-domain, retirement, and copy-work claims with actual observers.                                                                       | already-fixed for the production law: existing hostile/path/retirement and copy-budget owners apply. Tightened the work witness's label and record-identity observations and reran original guards. Preserve the explicit allocation/host limits above. |
| LA-005 | Rich receiving release used deep equality for a reference-identity law.                                                                              | fixed-now: exact reference/count assertion; copied-release mutant passes the former observer and fails the replacement.                                                                                                                                 |

Five audit items = four fixed-now oracle gaps + one already-fixed production
law with strengthened observation and explicit bounds. No new production bug is
claimed. No new deferred work or unresolved design decision. Earlier review
ledgers remain lossless; their accounting totals are not replaced by these five
audit items. This report supersedes their stronger-than-evidence oracle closure
claims for the boundaries examined here.

## Validation and receipts

- Current production: 812 passed, zero failed, one existing TODO across 11
  affected test files. The new focused set passed 32 tests before the final
  full-owner run.
- Date-mutation false green: 22 passed before the test repair; final mutant
  three failed at input-preservation assertions.
- Shared-Date output mutant: two failed, one rejected-suffix control passed.
- Swallowed coordinator rejection: 13 old checks passed; expanded matrix has
  four failures and 20 passing controls.
- Premature index completion: eight intended failures, 16 controls passed after
  cleanup isolation; two initial collateral failures are excluded from evidence.
- Copied release object: former observer passed; exact-reference observer fails.
- Original and partially repaired index boundaries: eight intended failures and
  four supported controls each on the final serializer matrix.
- Original wire guards: 18 intended copy-budget failures on the final observer.

Scratch receipts use `/private/tmp/temporal-audit-*` for focused/mutant results
and reached-source records; `temporal-law-audit-final.json` is the final
11-file run. Source substitutions live only in scratch configs. Production
source is unchanged; tests strengthen two existing oracle owners. The full
append-only audit is `/private/tmp/temporal-law-audit-ledger.md`.

TypeScript passes. ESLint has zero errors and 32 existing warnings across the
two affected owners. Source and report formatting plus whitespace checks pass.

## CI observer correction

CI run `37404114580` on `b700bbf0f` exposed a test-environment mismatch:
the SQLite-core package uses jsdom, while the earlier combined local run used
Node. Both new caller-state cases failed because the expected ArrayBuffer from
`structuredClone` belonged to a different realm. A diagnostic proves its bytes
are still `[7, 8]`, its prototype differs, and the same deep comparison fails
before any production traversal. Its first scratch configuration had a syntax
error; that setup failure is not counted as evidence.

The persisted witness now compares explicit timestamps, bytes, container
contents, property keys and alias relationships with independently specified
before/after observations. It calibrates the fixture before production entry.
It still checks caller isolation after both validation and encoding, on rejection,
and across later projection calls. This does not add cross-realm support to the
product or waive any byte/identity assertion.

The repaired cases pass in jsdom and Node. The input-Date mutation still fails
both jsdom cases; returning a shared Date still fails the success case while the
rejected-suffix control passes. The local SQLite-core selection passed 520 tests
across 11 files with one existing TODO in jsdom. Earlier 812-test evidence remains
an explicitly Node-based affected-owner run. TypeScript, lint and formatting pass.
Receipts: `/private/tmp/temporal-ci-jsdom-red.json`,
`temporal-ci-realm-diagnostic-red.json`, `temporal-ci-core-jsdom-green.json`, and
`temporal-ci-observer-{jsdom,node,date-jsdom,shared-jsdom}.json`.
