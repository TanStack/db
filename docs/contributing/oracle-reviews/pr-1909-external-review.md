# PR #1909 external review

Review target: `0ba54cd50bca908348940eb2020ec4f244450dc9`. The supplied
medium-effort review named four findings, one test gap, and one broader
cross-PR observation. This record separates the code fact from the proposed
behavioral consequence.

| ID | Disposition | Evidence and remaining question |
| --- | --- | --- |
| R1 | refuted | `waitForJoinedDemand` does run on custom-collation full-source and unindexed fallback paths. A held child-demand fixture reaches both paths for Collections and Effects, then publishes the correct `none` window. Setting the gate to `false` makes all four cells publish a matched parent that should be absent. The full-source path still needs the publication gate for an anti-join. The indexed-only restriction proposed by the review is unsafe. |
| R2 | confirmed-open | Ordered Effects track published rows for every ordered source, and the classifier reads that map even outside a held repair or joined-filter window. The suggested duplicate insert for an already published key has no valid public history yet. An equal-value source update produced no D2 delta with either classifier. A second joined contributor received a distinct composite output key. A temporary comparison found no event-type divergence through 2,048 valid plain ordered Effect mutations; their public rows matched an independent window model. Provide a valid query and source sequence that sends an insert for a callback-visible key without its matching delete before changing this branch. |
| R3 | confirmed-open | The builder tracks completion of one `DemandUpdate.ready` per plan; the Effect checks the controller's pending acquisition segments. These can differ for a microtask after segment settlement. A controlled shared-source fixture held child demand for both consumers, observed neither publish before settlement, and then observed each publish the correct anti-join row. Collection callbacks arrived before the Effect callback, so reads of both consumers differed briefly between independent callbacks. No incorrect row or stuck gate appeared. A claimed gate error still needs a sequence that separates it from ordinary callback order. |
| R4 | fixed-now | Removed the redundant `hasJoinedFilterWindow()` scan from the builder's flush guard. The remaining `.some()` still requires `waitForJoinedDemand` and pending joined work. |
| R5 | fixed-now | Added four oracle cells crossing Collection/Effect with custom collation/unindexed root loading and held child demand. The custom path checks one unbounded request; the unindexed path checks prefix then full-source fallback. Both check complete anti-join publication. Disabling the gate kills all four cells. |
| R6 | deferred | The broader #1907 pattern is outside this review's code target. This PR now covers the two fallback regimes named here. The [#1907 review record](pr-1907-accepted-delete-ownership.md) remains the destination for its own guard and oracle claims. |

The review identified a real test gap and a redundant guard. Its proposed
restriction of the joined-demand gate would introduce a visible anti-join bug.
The Effect classifier and split demand bookkeeping remain evidence gaps rather
than confirmed product failures.

## Follow-up probes

For R2, a temporary test compared `classifyImmediateDelta` and
`classifyHeldDelta` at every ordinary ordered Effect flush and failed if their
event types differed. It ran 64 deterministic histories of 32 valid source
mutations each. The histories crossed insertion, deletion, replacement, filter
membership, order changes, and top-two displacement over five keys. After
every mutation, the Effect's accumulated public rows matched an independent
filter/sort/window recomputation. No classifier divergence occurred. The
instrumented ordered-work, Effect, Effect-disposal, and pagination owners also
passed 426 tests without a divergent event type. The temporary instrumentation
was removed. These are sampled histories, not a proof for every query shape.

For R3, a temporary fixture gave one on-demand root and child source to a
live-query Collection and an Effect. It held the child's request while both
consumers evaluated a custom-collation `none` filter. Both stayed empty before
release and ended with only the unmatched root. The callback sequence was
Collection, Collection, Effect; each callback's own result was correct. A read
of both consumers during the first Collection callback saw the Effect's earlier
state. Their callback schedules are separate, so that observation alone does
not show that either pending-work definition released at an invalid point.
The temporary fixture was removed; no product change was justified by it.

## Follow-up review of demand scope and wake-up

The later review was checked against `2a6b119f0dd85370d9f179b8a942fc163f08ea13`.
It contained two new product failures and several repeat or speculative claims.

| ID | Disposition | Evidence and destination |
| --- | --- | --- |
| A1 | fixed-now | A direct LEFT-join anti-join stopped after its first root page while a separate include demand was held. Collection and Effect both made the next cursor request before that unrelated demand settled after the gate was scoped to the joined source and its plans. Two ordered-work oracle cells retain the RED/GREEN trace. |
| A2 | refuted | A zero-change source callback can schedule another loader pass, but the loader's last page, prefix, and tie-boundary latches prevent the stated no-progress request loop. Existing underfilled joined-window oracle cells finish with bounded, distinct requests. Disabling the last-page latch makes all 20 underfilled-source cells fail at the provider-request cap. |
| A3 | design-decision | Collection still reads plan settlement; Effect still reads controller segment state. Both now use one source-scoped pending-work predicate. The distinct state owners have no demonstrated incorrect release; the earlier shared-source probe remains in R3 above. |
| A4 | refuted | Full-source custom collation still needs the joined-demand publication gate. The earlier hostile mutant made four Collection/Effect fallback cells publish an incorrect anti-join row; the custom cell checks one full-source request. |
| A5 | duplicate of A1/A3 | The repeated scope concern led to the A1 fixture. The remaining state-owner question is A3. |
| B1 | fixed-now | The source/plan/status gate is now one helper. The old methods were similar but had different state queries, so they were not verbatim copies. A further refactor removed Collection's per-run loader callback registry and redundant scheduler state; the resulting PR is net-negative in production lines. |
| B2 | duplicate of A4 | Disabling the full-source gate is the killed mutant, not a safe fix. |
| B3 | confirmed-open | The ordinary ordered Effect classifier concern is R2 above. The prior 2,048-step differential found no legal event-type difference; a minimal divergent source history remains needed. |
| B4 | duplicate of A2 | The second no-progress-loop claim adds no new path. |
| B5 | fixed-now | A held empty joined truncate replay produced no replacement delta to wake Effect. A root update stayed at its old callback-visible value after replay settled. Listening for the joined subscription's `ready` transition released the delta. The ordered-work oracle retains the RED/GREEN case. Collection already has a replay-success wake-up. |
| B6 | duplicate of B1 | A shared predicate removes one scope definition. The Collection scheduler refactor supplies the net-negative code reduction; Collection and Effect still own separate public publication paths. |

The second review supplied the missing unrelated-demand and empty-replay
histories. The alleged infinite loop did not survive the no-progress check.

## Code-weight refactor

The existing D2 graph and `OrderedSourceLoader` now drive ordered continuation
on every Collection graph turn, matching the Effect runner's existing schedule.
The Collection builder keeps one loader set per sync run and fences queued jobs
by sync generation. The transaction scheduler already deduplicates and clears
jobs, so the builder's second per-context callback registry and clear listener
were removed. Collection and Effect also use one dependency-graph scheduling
helper rather than separate transaction scheduling implementations. The source
loader's fixed-point latches still bound requests when a graph turn receives
no new rows. Effect's immediate and held delta classification now share one
classifier; only ordered Effects pass callback-visible row state. A single
monotonically increasing demand generation replaces per-plan generation
bookkeeping.

Against merge base `afbeb44eef48d92b6e30ae5fd2843b938ee9163c`, the seven
changed production TypeScript files contain 215 added and 331 deleted lines
(net **−116 raw lines**). Counting nonblank, noncomment diff lines gives 197
added and 221 deleted (net **−24 executable lines**). This measure excludes
architecture prose, tests, and review records. It is a line-count check, not a
claim that each old state was redundant: the joined-source demand and public
publication gates remain necessary for correctness.

The full `packages/db/tests` run passed 6,603 tests across 186 files after the
production refactor. The ordered-work oracle passed 93 cells, including the
unrelated-demand and empty-replay repairs. The scheduler test exercised 81
cases, including repeated-alias failure ownership across falsy failures.

## Ordered continuation and window follow-up

Code target: `0cbc7ae0` (production change `450b9d3c`). The later CodeRabbit comment at
`https://github.com/TanStack/db/pull/1909#discussion_r4124008382` identified
three additional failure mechanisms. Its suggestion to run the local CodeRabbit
CLI is separate from those findings.

| ID | Disposition | Public or state-level witness |
| --- | --- | --- |
| CR2-1 | fixed-now | A bounded ordered repair paused for joined demand and then stopped before it refilled the public window. The ordered-work oracle failed on the missing third row before the fix. An explicit retry also lost its window generation at the same gate. The loader-state test failed on the missing retry request before the fix. Both tests pass with retained continuation and retry intent. |
| CR2-2 | fixed-now | `setWindow()` settled while an existing joined demand still held a required root continuation. The public ordered-work oracle failed before the fix. It now holds joined and root work separately. Its resolve, failure, retirement, and stale-rejection cells pass. |
| CR2-3 | fixed-now | Cursor invalidation erased an authoritative repair continuation. A later public-row deletion exposed an underfilled window before the fix. The oracle now observes the refill after joined settlement. Reset and request failure still clear the continuation. |
| CR2-4 | deferred | The `coderabbit` executable is unavailable locally. The PR check will run on the pushed commit. |

The follow-up also simplified Effect source ingestion and Collection graph
scheduling. Collection now checks ordered loaders inside one fixed-point loop.
A public-query oracle observes a synchronous root refill before its second
joined demand. Deleting the post-loader graph step made that oracle fail at the
second-demand assertion. This was an assertion failure, not a timeout or setup
failure. The step remains in production. The [field-lab loss audit](pr-1909-final-graph-loss-audit.md)
records source-supported distinctions that the short refactor summary omitted.
It does not treat those omissions as product regressions.

Against merge base `afbeb44eef48d92b6e30ae5fd2843b938ee9163c`, the
seven production TypeScript files have 318 added and 431 deleted lines. Net
production size is **−113 raw lines**. Excluding blank and comment-only diff
lines gives 299 added and 303 deleted, or **−4 executable lines**. The DB
oracle campaign passed 2,627 tests across 42 files. The DB runtime suite
passed 6,609 tests across 186 files with Vitest typechecking disabled. Package
TypeScript, changed-file ESLint, Prettier, and `git diff --check` passed.

### Oracle guide review for this follow-up

- **ORC-001–003:** The ordered-work oracle names the ordered-window and
  publication contract, uses an independent filter/sort/window reference, and
  keeps its grammar, driver, and public checkpoint visible. The loader-state
  case is a focused state refinement of explicit retry admission.
- **ORC-004:** This follow-up adds bounded deterministic cells and makes no new
  generated-grammar claim. The existing generated grammar is unchanged. The
  new cells reconstruct the named joined-demand, repair, window-move, failure,
  retirement, and refill witnesses. Multiple simultaneous joined plans and a
  public-query failed-retry overlap remain outside this coverage, as the
  coverage map states.
- **ORC-005–006:** The driver uses public live-query Collections and Effects.
  It checks rows, requests, window settlement, and callback batches at named
  checkpoints. The pre-fix runs failed at those observations. The graph-step
  mutant failed at a public second-demand assertion.
- **ORC-007:** The existing important generated property runs fixed and random
  campaigns with direct seed/path replay. These follow-up cells are bounded
  deterministic controls, so they add no separate generated campaign.
- **ORC-008–009:** The reference model gains no state or new vocabulary.
  Window participants in production remain distinct from reference rows.
- **ORC-010:** Each new async control resolves its held promises during cleanup.
  `withHistoryCleanup` retains the primary assertion and reports cleanup
  failures separately.
- **ORC-011:** No new shared semantic fault hypothesis requires a second
  formulation in this follow-up. The independent filter/sort/window reference
  remains the primary result model. Remote relation hints remain a separate
  feature.
- **ORC-012:** This versioned section records outcomes for ORC-001 through
  ORC-011 against the code target and names the remaining in-scope witnesses.

The repaired claim covers finite local joined-filter windows, the named
joined-demand and window-move histories, Collection and Effect public rows,
and the specified settlement checkpoints. It does not claim all legal demand
interleavings. The coverage map owns the two remaining witnesses above.

## Shipped-byte consolidation

Code target: `b69c189c`. Three independent scouts inspected graph scheduling,
ordered demand, Effect state, package exports, and dependency drag. They
measured proposed cuts in isolated builds before the final edit. The chosen
changes remove two unused scheduler extension paths, two redundant Effect
fields, and unused Collection scheduler overrides. The core scheduler and D2
graph remain necessary for variable query dependencies and coherent
publication.

`Scheduler.onClear()` had no production caller, and no production dependency
implemented `hasPendingGraphRun()`. `Scheduler` is absent from the package root
exports. The change retires those internal extension contracts. A direct
unsupported source import can no longer attach a clear listener or provide an
out-of-queue pending dependency. The scheduler test now checks queued-job
cancellation, reuse of a cleared context, prerequisite requeue, exact failure
identity, and later successful work. Existing Collection and Effect tests still
check coherent public batches, rollback, stale settlement, and loader failure.
The architecture now says that only queued jobs block scheduler dependencies.
The [second field-lab loss audit](pr-1909-code-weight-loss-audit.md) preserves
source details omitted by this short reduction.

The byte assay built the same package path with Vite 7.3.2 `--minify`, then
bundled selected ESM exports with esbuild 0.27.7. It used gzip level 9 and
Brotli quality 11. Every row compares the identical absolute path and toolchain.
Values are bytes; negative deltas save bytes.

| Consumer import | Change from prior PR head: min / gzip / Brotli | Final PR against merge base: min / gzip / Brotli |
| --- | ---: | ---: |
| Full `@tanstack/db` index | −484 / −112 / −44 | +93 / −75 / −330 |
| `createLiveQueryCollection` | −325 / −81 / −113 | +638 / +44 / +19 |
| `createEffect` | −457 / −97 / −244 | +318 / +104 / −71 |
| Both query exports | −489 / −106 / +8 | +89 / −58 / +118 |

The named query imports remain slightly larger than the merge base under some
byte measures. The full import has fewer compressed bytes but 93 more minified
bytes. These receipts do not establish a universal net-negative shipped size.
`@tanstack/pacer-lite` contributes no bytes to the measured query imports, so
the scouts found no query-path dependency drag to remove. The remaining
optional scheduler dependency argument saved only 15 gzip bytes in a trial and
would retire another internal test contract; it was left intact.

The DB oracle campaign passed 2,627 tests across 42 files with no type errors.
The full DB runtime suite passed 6,605 tests across 186 files with Vitest
typechecking disabled. Package TypeScript, changed-file ESLint, Prettier, and
diff checks passed. Against the merge base, production TypeScript is **−156
raw lines** and **−35 nonblank, noncomment lines**. This count includes the
scheduler file; it excludes tests and documentation.
