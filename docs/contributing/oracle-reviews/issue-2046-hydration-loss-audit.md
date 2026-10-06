# Hydration source durability: loss audit and oracle strengthening

## Identity and scope

Date: 2026-10-06. Production baseline is
`65992aacda530fde89f4c8ffa803b60cd708c425` (`origin/main`). Worktree branch:
`codex/issue-2046-red-oracles`. The tests are uncommitted; the executable SHA-256
bindings below identify their reviewed content without pretending that the
production commit contains these tests. Production and the lockfile remain
unchanged. The [initial review](issue-2046-hydration-commit-deadlock.md) remains
an historical record of the smaller 24-core/12-browser candidate.

The user requested Field Lab's **Hidden-signal recovery assay (`loss-audit`)**
and separately authorized improving the oracle. The candidate was frozen before
three fresh, read-only scanners received separate sources with sibling findings
hidden: S1 the oracle guide; S2 persistence contracts; S3 the existing oracle
portfolio. Recovery and implementation judgment are separated below. No Field
Log, external message, production fix, commit, push, or PR was created.

This improves enforcement of the local composition: source transactions buffered
by persisted hydration must use the current scoped adapter, preserve their
ordered durable obligations, settle each acceptance/receipt at its own boundary,
and release that scope for ordinary/peer work. It does not claim all persistence
laws universally proved or the production bug repaired.

Frozen candidate SHA-256 (paths are repository relative):

| File | SHA-256 |
|---|---|
| `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` | `412f3ba03af8f1d82da5c6a6f8d3dd15c975261646d988bf9995a4ce30415e55` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit.opfs.ts` | `ae78b9254ab52c2fbb9a29dd9042aef8c4502efd0ae43b46e7914bca88328e4f` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit-oracle.opfs.spec.ts` | `8cdb922972059c9a0a5d667f03a9d8b1802ff6cd1ec35aa6305f4d437c55c0ce` |
| `docs/contributing/oracle-reviews/issue-2046-hydration-commit-deadlock.md` | `7954be179200f8c80da08488c45bb779fbc5e9dde8d58b8e88159ce27145a4a1` |
| `docs/contributing/oracle-coverage.md` | `e84ea6d6455f9d1c91590a5242754f84ee64a700218f9bd26061c80dcee3ba90` |

## Source-by-source recovery ledger

Pointers in this section refer to the frozen candidate or unchanged production
baseline, not moving line numbers after the edits. `P` is the core
`persisted-oracle.test.ts`; `B` is `hydration-commit.opfs.ts`; `R` is the initial
review; `C` is `src/persisted.ts` in persistence-core. `S` is
`shared-logical-scheduling-oracle.test.ts`; `F` is browser
`tests/shared-driver-fairness-oracle.ts`; `PC` is browser
`tests/per-collection-coordinator-oracle.test.ts`.

These 23 source-specific recoveries preserve overlapping support. They are not
23 distinct bugs or an instruction to restore every possible cross-product.

| ID | Supported material omitted from the frozen reduction | Support and loss point | Drop mechanism |
|---|---|---|---|
| S1-1 | Each receipt pending, not just an aggregate pending | ORC-005; guide 818–825; P19243–19250; R79–84. A pending preload/sibling masks early fulfillment. A standalone all-fulfilled Promise-shape control also read pending after the candidate's single microtask. | Observation compression and insufficient reaction drain |
| S1-2 | Immutable primary evidence survives all cleanup failures | ORC-010; B220–247 publishes after cleanup and retains a live errors array. Collection cleanup/dispose can erase the capture or skip database close. | Cleanup treated only as release; late/shallow capture |
| S1-3 | Review binds the actual executable revision | ORC-012; R6–8 identifies production HEAD, not new test content. | Baseline identity substituted for oracle identity |
| S1-4 | Existing direct replay stays direct | ORC-007; P121–126 guards existing suites, but P19121 uses unconditional describe. New red cases can contaminate another property's replay. | Local finite-test classification hid package integration |
| S1-5 | Expected records remain independent of mutable driver inputs | ORC-002; P197,19240,19272 reuse baseline/source objects to compute expectations. | Formula independence mistaken for record independence |
| S1-6 | Supplied adapter expires with its callback | ORC-001/005/013; R53–56 cites lifetime, but P19178–19197 uses a permanently callable bound store. | Two-sided scope law reduced to no public reentry |
| S2-1 | Acceptance/durability differ from visibility under optimistic work | C3943–3954,1412–1426,2744–2754; P19243–19250 aggregates receipts; existing causal replay P18613–18745 uses the same adapter for both routes. | Settlement observations collapsed |
| S2-2 | Correct current loan and per-Collection adapter identity | C438–445,880–884,978–999; P19178–19188 reuses one scoped object/store. | Identity/lifetime projection |
| S2-3 | Ordinary work remains scheduled, including during another Collection's hydrate | C2828–2834,446–449; B193–202 only starts an empty peer. Temporal overlap alone is not nested dependency. | Dependency relation replaced by scope-active flag |
| S2-4 | Metadata/truncate require durability; only a truly empty transaction does not | C2817–2823,2890–2939,4477–4486; P19144–19146 and19272–19281 only inspect distinct inserts/keys. | Zero row mutations equated with no durable obligation |
| S2-5 | Durability error envelope, prefix/suffix fencing, no implicit rollback | C898–901,2713–2719,2792–2805; errors.ts52–90; all scoped stores succeed. | Failure category compressed |
| S2-6 | Failed incremental reads may preserve independent source work; baseline failure is terminal | C2397–2423,2531–2533; P14283–14387 uses an unscheduled adapter. | Request-local and terminal failures merged |
| S2-7 | Abort timing and successor dependency determine the result | P90–96,3863–4047; C2769–2805; no signals/dependencies in the new matrix. | Abort/cleanup grouped into one future category |
| S2-8 | Cleanup invalidates queued work; old continuations cannot alter a replacement run | C2203–2288,2732–2733,2755,2852,4668–4726; P19286–19296 only cleans settled work. | History truncated before replacement |
| S3-1 | Independent receipt observations at held reads already exist | P8594–8666,806–856 versus19243–19253. | Existing observation granularity lost in composition |
| S3-2 | Same-key source precedence, deletion, truncate and FIFO | P67–77,11804–11811,12005–12014,12169–12430; disjoint baseline/source keys cannot witness stale overwrite or resurrection. | Input simplification/explicit operation exclusion |
| S3-3 | Metadata-only versus empty work, captured row-metadata ownership, sequence evidence | P2683–2716,3769,11629–11786; PC3766–3952. Candidate observes only rows and keys. | Result projection drops metadata and sequence |
| S3-4 | Startup/replay/durability failures differ from request-local failures; rejected hydrate releases peers | P750–856,9089–9160,9587–9706,4172–4246,4701–4859,14283–14482; S343–374. | Explicit exclusion compressed into generic failure |
| S3-5 | Independent/dependent and pre-/post-application aborts differ | P3705–3763,9192–9405,3863–3939,11097–11219,4880,5023. | Signal timing and dependency erased |
| S3-6 | Handler may await acceptance while its own optimistic publication is pending | P9995–10079,18614–18740; P18639 supplies no distinct scoped route. | Causal distinction hidden by “commit settles” |
| S3-7 | Scope non-interleaving, ordinary route after exit, K=1/FIFO fairness | S4–18,263–299,343–374; F4–18 and fairness tests256–295,574–619. B193–229 observes eventual peer readiness only. | Identity/order laws reduced to completion |
| S3-8 | Adapter also belongs to correct Collection/schema/elected owner | PC123–135,2437–2506,3645–3952; B158–200 uses same schema and only A writes. | Empty peer hides contamination and owner identity |
| S3-9 | Replacement fencing is different from successful harness teardown | P7206,7330,17739–17810,5177,5293; candidate never replaces a pending run. | Lifecycle distinctions collapsed |

All scanners cautioned against turning recovery into an unrestricted Cartesian
product of the persistence portfolio. The guide does not require random
campaigns for this finite matrix or a second formulation without a named
shared-fault hypothesis. Existing open-transaction/hydration restrictions are
characterized limitations, not newly invented product laws.

## Separate evaluation and implemented restoration

The user separately requested improvements. The implementation restores the
following distinctions while reusing existing primary owners:

- **Individual obligations:** Each receipt and each `whenSyncAccepted` promise
  is observed independently at held-read and held-durability cuts. A task
  boundary drains reactions while the gate remains causally held. A permanent
  wrong-answer test proves a fulfilled receipt cannot hide behind its sibling.
- **Independent values and ordering:** An immutable input edit log recomputes
  the last row/metadata edit. Inputs are cloned before the driver sees them.
  Exact transaction data, FIFO turns, sequence/row-version numbers, durable
  prefixes and final public/durable state are checked. `put` means a full
  source update/upsert in this core driver; the OPFS driver separately performs
  literal inserts, updates and deletes.
- **Scope lifetime:** Each controlled callback lends a fresh adapter identity.
  Nested calls, ordinary same-run tail commits, a second on-demand hydration,
  and reopen distinguish the current loan from public reentry and cached loans.
- **Transaction shapes:** Twelve history templates cover one/two distinct
  upserts, same-key replacement/delete, metadata-plus-truncate/replacement,
  row/collection metadata set/delete, metadata-only, truncate-only, empty,
  atomic multi-row, independent pre-abort, and first/second durable failure.
  Each runs for three phases, two scope modes and two baseline sizes: **144**
  histories. A populated baseline shares the source key, making precedence
  observable. Empty work must not allocate a durable sequence.
- **Failure classes:** Held first/second storage failures preserve exact cause,
  code/path, shared terminal error, durable prefix, suffix rejection and later
  same-run rejection. Publication rollback is not invented. Existing startup
  read-failure and incremental request-local failure witnesses now lend a
  distinct scoped adapter. The latter retains its successful overlapping retry.
- **Acceptance before visibility:** The existing causal replay witness now
  lends a distinct adapter, holds the optimistic handler after acceptance,
  checks the durable row and still-pending/absent public result, then releases
  publication. A repair cannot wait on the handler that awaits acceptance.
- **Cleanup as an action:** Four additional histories cross startup/subscription
  with scoped/unscheduled adapters, clean up while a source receipt is queued,
  reject that receipt, release the old read, restart and reject late old-control
  publication while fresh source work succeeds. The no-write claim is limited
  to work not yet issued to storage.
- **Receiving host:** **24** actual Chromium OPFS histories retain the original
  three phases, two coordinators and two baseline cases, adding single-insert
  versus rich transaction histories. A=11, B=22 and C=33 are separate schema
  adapters on the same database. A's nested work, B's cold hydration and C's
  ordinary source write must finish without cross-contamination. No additional
  SQL may enter the provider while the owning read is held. Exact metadata,
  schemas, rows and reopen are compared. The exact scope containing the held
  SELECT must exit; another scope's exit cannot satisfy that obligation.
- **Causal cycle detection:** Browser instrumentation matches the transaction
  ID passed with a live scoped adapter to its erroneous public-adapter call.
  Merely overlapping ordinary work cannot trigger the cycle observation.
- **Failure fidelity:** Browser observations are deep-copied before teardown.
  Every cleanup failure is retained separately, coordinator disposal cannot skip
  database close, and red cycles close the worker/context. A permanent browser
  calibration injects first and last cleanup failures and checks both diagnostics
  plus the intact primary observation. All setup after opening the database is
  inside its cleanup guard.
- **Replay/provenance:** The finite matrix and strengthened fixed routing witnesses now use an explicit replay guard.
  The versioned content hashes below bind this evidence to the changed files.

The controlled probe forwards invalid routes so the harness can release its
gates and clean up. It therefore proves routing, not a simulated scheduler.
The OPFS receiver supplies the real non-preemptible scope and self-cycle premise.

One attempted assertion was rejected during contract review: core truncate can
establish Collection readiness at publication (`collection/state.ts`, truncate
publication path). It cannot establish source durability. The retained test
checks acceptance/receipt pendingness at that cut without inventing a stronger
universal Collection-readiness law. An attempted second subset hydration in an
eager Collection was also an **unreached fixture path**; repeated scope coverage
now uses the legal on-demand path. Neither harness failure is product evidence.

## Verification and hostile calibration

The same narrow temporary scoped-adapter forwarding repair from the initial
review was used only to reach the successful comparison cuts. Every calibration
restored the original production file in `finally`.

| Execution | Result | Classification |
|---|---|---|
| Complete core suite, unchanged production | 48 failed, 480 passed, 1 existing todo | Reached routing assertions: 44 initial nonempty scoped histories, 2 second-scope empty-history continuations, 2 strengthened existing causal/failure witnesses. No timeout/setup failures. |
| OPFS receiver, unchanged production | 8 failed, 17 passed | Reached same-transaction scheduler-cycle assertions in default-coordinator startup/subscription cases. Both workarounds and cleanup calibration pass. |
| Complete core suite, temporary forwarding repair | 528 passed, 1 existing todo | Same histories and comparisons. |
| OPFS receiver, temporary forwarding repair | 25 passed | Same real database, scheduler, peer/schema and cleanup paths. |
| Eight hostile repairs | All rejected by assertions | Counts/checkpoints below; production restored after each campaign. |
| Existing FIFO property's direct replay | 3 passed, 510 skipped, 1 existing todo | Requested replay plus existing global harness checks; no new routing cases execute. |
| Retained-demand replay special case | 361 passed, 151 skipped, 1 existing todo | Its legacy outer guard retains existing fixed tests; the new 149 finite checks and two strengthened routing witnesses are excluded. |
| TypeScript | Core package and focused browser oracle checks passed | Full browser package still needs unrelated Electric/pg dependencies unavailable in this partial install. |
| ESLint | No errors; 22 existing require-await warnings | No new warnings in the added oracle block/browser files. |
| Production/lockfile diff | Empty | No repair or dependency changes retained. |

Eight additional wrong repairs were applied independently on top of that
calibration repair. All reached assertion failures; none timed out, failed
setup, remained unreached, survived, or was equivalent in the tested domain:

| Wrong repair | Failing cases / 149 focused checks | Distinguishing checkpoint |
|---|---:|---|
| Resolve source receipt before durability | 88 | Individual receipt/acceptance at held durability |
| Cache the supplied scoped adapter as the registered adapter | 36 | Ordinary post-scope route / expired loan |
| Drop row and collection metadata | 48 | Durable prefix or final metadata |
| Ignore truncate | 24 | Exact admitted transaction truncate flag |
| Drop row mutations | 148 | Exact admitted transaction or fresh restart row |
| Reverse buffered FIFO | 48 | Exact transaction at durability admission |
| Swallow storage failure | 24 | No suffix admission after rejected durable turn |
| Replace classified storage error with generic error | 24 | Error type/code/path/cause and shared identity |

A standalone Promise-shape probe exposed the frozen aggregate false green. The
retained early-receipt calibration exercises the replacement checker. The final
browser cleanup calibration supplies permanent ORC-010 evidence. Original main
is itself the routing hostile subject in both controlled and actual-host tests.

The following historical session-only commands used cached tools and untracked
local-source aliases. No other checkout's production build supplied test
behavior. These commands are **not runnable from a fresh checkout** because
the cache configuration and temporary typecheck project were not committed.
Use the [fresh-checkout instructions below](#reproducing-the-retained-checks-from-a-fresh-checkout)
to run the retained checks with repository configurations.

```sh
node node_modules/vitest/vitest.mjs run --config node_modules/.cache/issue-2046/vitest.config.ts --reporter=dot
node node_modules/vitest/vitest.mjs run --config node_modules/.cache/issue-2046/vitest.config.ts -t 'hydration source durability routing' --reporter=dot
TANSTACK_DB_ORACLE_PROPERTY=sqlite-persistence.source-fifo-order TANSTACK_DB_ORACLE_SEED=2046 TANSTACK_DB_ORACLE_PATH=0 node node_modules/vitest/vitest.mjs run --config node_modules/.cache/issue-2046/vitest.config.ts --reporter=dot
node node_modules/typescript/bin/tsc --noEmit -p packages/db-sqlite-persistence-core/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p /private/tmp/issue-2046-audit/browser-types.json
```

From the browser package:

```sh
PATH="$PWD/../../node_modules/.bin:$PATH" node node_modules/@playwright/test/cli.js test --config playwright.opfs.config.ts hydration-commit-oracle.opfs.spec.ts --reporter=line --timeout=15000
```

Temporary logs, frozen files, calibration patch/scripts and mutation outcomes
are under `/private/tmp/issue-2046-loss-audit/`. The assertions, laws, finite
cases and verdict-critical results are retained here and in the executable
files; future readers need not trust the existence of those temporary logs.

## Guide conformance and remaining boundaries

| Requirement | Outcome and evidence |
|---|---|
| ORC-001 | Scope API, established persisted-history durable/failure laws, and core acceptance/publication authority are named. Limits below remain explicit. |
| ORC-002 | Immutable input edit-log recomputation; cloned inputs; no production queue, classifier or scheduler computes expected state. Browser literal snapshots give a different formulation. |
| ORC-003 | Opening laws/limits, model rationale, grammar, production driver, cuts and comparisons are adjacent in executable files. Model edits distinguish row and collection metadata across truncate. |
| ORC-004 | Bounded enumeration, not an important random property. Reconstruction retains reported startup/subscription/empty/populated traces and both controls. Each template/axis's contribution is stated below. Nearby invalid open transactions crossing another hydration are excluded; the grammar contains only committed independent transactions. No invalid history is silently treated as a successful transaction. |
| ORC-005 | Read-entry, exact transaction admission, each accepted/applied receipt, exact held-scope exit, durable rows/metadata and reopen are witnessed. Diagnostics include duplicates/order/value omissions. Real OPFS supplies the actual receiving path. |
| ORC-006 | Eight independently run hostile designs fail reached assertions; permanent receipt and cleanup controls; unchanged main fails the routing/cycle comparison. |
| ORC-007 | New bounded matrices do not trigger random-campaign requirements. Existing generated campaigns remain under the full suite. The explicit replay smoke check confirms the new matrix is skipped during another property's direct replay. |
| ORC-008 | Reference recomputes snapshots from an input log, not a new state machine. Driver scope tokens, gates and counters are instrumentation. Separate pending/fulfilled/rejected observations cannot be merged: gate release or failure distinguishes them. |
| ORC-009 | Glossary terms are retained: Collection versus subscription readiness, source acceptance versus applied receipt, cleanup/restart. Model-only `put` maps to source full update/upsert; edit-log filtering abstracts independently pre-aborted transactions. |
| ORC-010 | Gates always release; primary failure survives existing core cleanup diagnostics. Browser deep capture precedes cleanup; each failure is retained and database close is attempted. Permanent two-failure calibration passes. |
| ORC-011 | Named shared fault: insert-only source/baseline concatenation and a fake scope could agree on wrong precedence or scheduling. Real SQLite snapshots, independently written rich-history expectations and actual scheduled/ordinary peers distinguish that hypothesis. |
| ORC-012 | This versioned record lists every requirement, exact baseline/content bindings, calibration classifications and unresolved cells. No bug-class closure claimed while production remains red. |
| ORC-013 | Boundary witnesses include scoped versus ordinary, current versus expired loan, metadata-only/truncate-only versus empty, pending versus completed durable turns, first versus second failure, same-key versus disjoint writes, cleanup before storage versus next-run admission. Mutation kills demonstrate the intended distinctions. |
| ORC-014 | The browser receiver supplies the real shared-scope/read/source-commit premise and rich row/metadata operations. Controlled storage rejection, abort and cleanup timing do not claim actual-host I/O/cancellation coverage; owners below retain those handoffs. |

Grammar ablations: removing startup misses eager loading; removing subscription
misses on-demand buffering with already-ready status; removing after-ready loses
the regular route control. Removing scope distinction loses the original bug;
removing default/browser coordinator loses its real workaround. Baseline zero
proves no stored rows are needed; baseline one challenges source precedence.
Distinct and repeated keys distinguish count/order from final membership;
delete and truncate distinguish absence from stale rows; row/collection metadata
and empty transactions distinguish zero mutations from zero obligations. Atomic
batches check transaction granularity. Failure ordinal distinguishes preserved
prefix from abandoned suffix; pre-abort distinguishes abandonment from failure
of independent work. Tail, second on-demand scope and reopen distinguish current
adapter loans, later ordinary use and durable storage. Bounds are 0/1 baseline,
1–3 transactions per core template, 0–3 edits per transaction, 0/1 independently
pre-aborted transaction, and storage failure at ordinal 0/1. Browser rich history
has six transactions plus its ordinary tail. No random-run confidence is used
to extend these bounds.

The laws still have meaningful open compositions. They are retained with owners
in the coverage map, not hidden by the green calibration:

- **Primary persisted-history owner:** dependent aborts, abort during/after
  publication, buffered partial-update recovery, arbitrary queued reloads,
  late already-issued storage success/failure across replacement, and metadata
  inherited from different owning reads need distinct scoped-adapter witnesses.
  Existing tests continue to own their unscoped semantic laws. The new cleanup
  witness does not promise cancellation/rollback of an already-issued write.
- **Shared-driver fairness owner:** K=1 and FIFO under storms already have their
  own models and OPFS receiver. This change proves finite peer progress and
  ordinary-work exclusion at a held hydrate; it does not claim the nested-source
  composition under arbitrary backlogs. Needed witness: nested source commit
  inside a hydrate while both lanes retain a K-bound-distinguishing backlog.
- **Per-Collection coordinator owner:** current-host schema/data isolation is
  now received in OPFS, but elected-owner transfer and cross-tab RPC while
  nested durability is pending remain with its ownership ledger.
- **OPFS receiver:** physical storage failure, abort/cleanup races, other browser
  engines and non-browser hosts need provider-supplied premises. Controlled
  errors in the core suite do not discharge those receiving obligations.
- **Production/history:** the default-coordinator repair remains open; historical
  package release attribution still requires a bisect. A known reachable red
  counterexample prevents closure regardless of the stronger test coverage.

## Reviewed executable content

| File | SHA-256 |
|---|---|
| `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` | `08ba69cdb4bcad7fa1c683d080ac3c51e75642caccf137864c87ca13ac8f17fe` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit.opfs.ts` | `200fd6fb5edd99a000acbb92b7e67b79b4949978953e0de8efbefd4efb2360bd` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit-oracle.opfs.spec.ts` | `48a5b85740c4e7a282ba7fdda53b076c44ac36bda6d2b06e9820554440e8003d` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit.opfs.html` | `28b99007a046019cc8466eb5d51561a55ab2c975d94bb98880e3f09b0f762058` |
| `packages/browser-db-sqlite-persistence/playwright.opfs.config.ts` | `d596da20036070bc4fded9829517aa8c2e69844061d7ac66c4b2233871c184cd` |

Change weight against origin/main: **production 0 lines**; tests/fixtures/config **+1705 / −220 (net +1485)**; documentation **+559 / −0 (net +559)**. The larger test diff includes formatting around two existing witnesses; no production machinery was added.


## Retained repair and current-base verification — 2026-10-06

The user approved the call-local adapter repair and PR preparation after the
RED audit above. The unpublished branch advanced to current `origin/main`,
`a37e69ab6aa35fd6a2a72d727de2b5168d10b1a0`, before retaining the repair. That
base adds Temporal persistence coverage. Its new dependency required linking
an already cached `temporal-polyfill` into this worktree's ignored dependencies.
The initial missing-import run collected no tests and is setup evidence only.
No package manifest or lockfile change belongs to this repair.

`SingleProcessCoordinator.requestApplyCommittedTx` now accepts the interface's
existing optional `scopedAdapter` and selects it for that call. Ordinary work
continues to use the registered adapter. The coordinator does not retain the
loan. This changes two production lines and removes one, for a net addition of
one line. Test and contract-documentation growth is separate from that budget.

The current implementation preserves the existing hydration completion,
acceptance/publication, FIFO, failure and scheduler contracts. It does not add
recovery state, bypass unrelated scheduled work, or replace the default
coordinator. The earlier RED-stage statements remain historical evidence.

| Current-base execution | Result | Reached evidence |
|---|---|---|
| Original core implementation | 48 failed, 566 passed, 1 existing todo | Routing assertions, with no timeout or setup failures |
| Retained repair, complete persisted oracle | 614 passed, 1 existing todo | All existing and added comparisons |
| Original implementation, real Chromium OPFS | 8 failed, 17 passed | Same-transaction scheduled reentry/cycle assertions |
| Retained repair, real Chromium OPFS | 25 passed | All histories and cleanup-failure calibration |
| Eight independent hostile repairs | All rejected by assertions | Early receipt 88, cached scope 36, dropped metadata 48, ignored truncate 24, dropped rows 148, reverse FIFO 48, swallowed failure 24, generic error 24 |
| TypeScript | Core package and focused browser oracle passed | No type errors |
| ESLint | 0 errors, 22 existing warnings | Existing require-await warnings only |
| Formatting and whitespace | Passed | Changed executable files and diff |

The hostile repairs ran separately on the retained repair, and the exact
repaired production file was restored in `finally`. None failed during setup,
timed out, remained unreached, or survived. The counts refer to the 149 focused
checks. Browser GREEN uses the same local source paths as RED. Cached tooling
from another checkout supplies dependencies only, never the production build.

Current executable SHA-256 bindings:

| File | SHA-256 |
|---|---|
| `packages/db-sqlite-persistence-core/src/persisted.ts` | `84ad4e2e5c8c071c44f72dcff007a220484d2a9530a5a0db033efd49b0c03bd4` |
| `packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts` | `7c8fe3aeb32afb66303392c2b79762cf005790cab91c455d64634ba82b9b7845` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit.opfs.ts` | `200fd6fb5edd99a000acbb92b7e67b79b4949978953e0de8efbefd4efb2360bd` |
| `packages/browser-db-sqlite-persistence/e2e/hydration-commit-oracle.opfs.spec.ts` | `48a5b85740c4e7a282ba7fdda53b076c44ac36bda6d2b06e9820554440e8003d` |

Current Vitest commands add `--pool=threads
--pool-options.threads.maxThreads=2 --pool-options.threads.minThreads=1` to the
commands above. Current browser verification uses `--timeout=15000`. Logs and
raw prep-pr reviews are under `/private/tmp/issue-2046-prep-pr/`; this record
preserves the verdict-critical results without requiring those temporary files.

### Original issue ledger: current disposition

This entry updates the original R1–R9 ledger without rewriting its historical
verdicts. R1, R2, R3, R4 and R9 are **fixed-now** within the declared source
hydration grammar and Chromium receiving path. R5, R6 and R7 retain the
approved existing behavior and executable controls: **accepted-design**.
R8 remains **confirmed-open** only for historical release attribution. The
causal source change and current repair are established, but the earliest
published affected version still needs a package bisect. Totals: nine raw
items = five fixed-now + three accepted-design + one confirmed-open.

The scoped routing defect is repaired. The broader scoped lifecycle, fairness
backlog, elected-owner/host handoff and historical-version witnesses listed in
[the coverage map](../oracle-coverage.md#source-durability-inside-a-shared-hydration-scope)
remain separate open evidence. These bounded results do not establish universal
liveness or every persistence composition.

### Prep-pr review and final oracle receipt

The simplifier returned no proposals. Five parallel review angles checked
repository instructions, obvious bugs, history, prior PR decisions and code
comments. Their raw reports preserve 25 source-specific candidates, including
rejected hypotheses and all nine historical review findings. No reviewer found
an introduced production defect. The parent evaluated every candidate without
a severity cap: one fixed-now, ten already-fixed, twelve refuted and two
duplicates. The task-local append-only evaluation ledger retains the full raw
claims, sources, judgments and independent cleanup score. No candidate was
silently filtered or deferred. The reviewers traced the existing contracts
and distinguished introduced defects from historical diagnostic limitations.

Two independent reviewers identified the same preexisting diagnostic weakness
in the strengthened optimistic causal witness. Direct cleanup in `finally`
could replace its primary error. The parent injected two sentinel failures in
that actual witness: the original form reported only the cleanup error. The
existing `cleanupPersistedOracle` helper retained the primary error and logged
the separate cleanup error. Both calibration runs reached their intended error
assertions without timeout. The retained test uses the helper and contains no
sentinel injection. This is oracle diagnostic hardening, not another production
bug or proof of a native cleanup failure. The helper's permanent calibration
continues to exercise primary and cleanup diagnostics.

After this seven-line test increase, the complete persisted oracle again passed
614 tests with one existing todo. Core TypeScript and lint passed with the same
22 warnings, and the file remains formatted. Its final SHA-256 is
`7156c39e8b657367aeea5491065b5836beecfeecc1f1855e344f5a4fcec36f15`.
The other executable hashes above remain unchanged. The eight hostile runs
preceded this diagnostic-only edit and exercised the unchanged 149-case suite.
Direct FIFO replay on the new base passed three checks, skipped 596, and kept
one existing todo. The repair and browser fixture remained unchanged for the
25-check browser GREEN receipt.

Two review qualifications remain explicit. Exact owning-scope exit is observed
for the held startup/subscription histories. The after-ready control does not
establish a universal readiness-versus-scope-exit ordering. Browser reopen here
creates a new Collection over retained persistence, not a physical browser or
worker restart. Native failures and process restart keep their separate owners.

## Reproducing the retained checks from a fresh checkout

These commands use tracked package scripts and configurations. Run them from
the repository root with the repository's supported Node.js and pnpm versions.
Install dependencies and build the core package with its workspace dependencies:

```sh
pnpm install --frozen-lockfile
pnpm --filter '@tanstack/db-sqlite-persistence-core...' build
```

Run the complete persisted oracle through its repository Vitest configuration,
with at most two workers. Coverage and integrated typechecking are disabled
for this focused runtime invocation, as in the historical source-alias run:

```sh
pnpm --filter @tanstack/db-sqlite-persistence-core exec vitest run --config vite.config.ts tests/persisted-oracle.test.ts --coverage.enabled=false --typecheck.enabled=false --pool=threads --pool-options.threads.maxThreads=2 --pool-options.threads.minThreads=1
pnpm --filter @tanstack/db-sqlite-persistence-core exec tsc --noEmit -p tsconfig.json
```

For only the finite routing matrix, add `-t 'hydration source durability routing'`
to the Vitest command. To replay the existing FIFO property, prefix that same
command with `TANSTACK_DB_ORACLE_PROPERTY=sqlite-persistence.source-fifo-order
TANSTACK_DB_ORACLE_SEED=2046 TANSTACK_DB_ORACLE_PATH=0`.

Install Chromium and run the real OPFS receiver. The explicit browser channel
selects the installed Playwright Chromium instead of requiring local Chrome:

```sh
pnpm --filter @tanstack/browser-db-sqlite-persistence exec playwright install --with-deps chromium
PLAYWRIGHT_CHANNEL=chromium pnpm --filter @tanstack/browser-db-sqlite-persistence exec playwright test --config playwright.opfs.config.ts hydration-commit-oracle.opfs.spec.ts --reporter=line --timeout=15000
```

The browser Vite configuration aliases the workspace source packages. These
commands need no `node_modules/.cache/issue-2046` configuration or `/private/tmp`
project. The temporary paths elsewhere in this record identify historical
session artifacts only. The reported historical counts belong to their stated
source/dependency revisions, not to an unexecuted clean installation. The PR's
CI separately runs the tracked package and OPFS configurations.

The documentation follow-up for CodeRabbit review `5431163123` distinguishes
these reproducible entry points from the original session commands and removes
nontechnical personnel commentary. No executable file, oracle law, assertion,
or recorded runtime result changed.
