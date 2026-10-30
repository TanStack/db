# Issue #2310: equal rows in restarted publication

Reviewed source: [issue #2310](https://github.com/TanStack/db/issues/2310),
including its complete body and no comments, retrieved 2026-10-30.
Base and current HEAD: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.
The repair is an uncommitted diff on `codex/issue-2310-publication`.
Production and oracle repairs were made. No product-law change is needed.

## Law, experiment, and inference

A direct subscription survives Collection cleanup. Cleanup discards source rows
without sending subscriber deletes. After restart, successful reacquisition
publishes the new source replacement: an equal row actually restored by that
source remains present, an omitted row leaves, and a changed row updates.
An equal restored row needs no redundant callback. Failed replacement keeps
the prior subscriber snapshot; an obsolete acquisition cannot authorize it.

Authority: the public `Collection.subscribeChanges` change-message contract,
the existing publication owner's opening contract and independent row model,
and the shared lifecycle grammar's cleanup, restart, cancellation and settlement
rules. The coverage map assigns these observations to the Collection lifecycle
publication owner. This is enforcement of existing replacement membership, not
a new policy for source completeness or retention time.

| Law | Existing instrument | Decisive experiment | Inference and repair |
| --- | --- | --- | --- |
| Successful replacement includes every restored row, even one equal to the retained subscriber row | The shared lifecycle model selects current attempts; the independent publication model uses Maps to compute source and subscriber membership. The driver compares exact callback batches, source rows and callback-applied rows after each command. | Exact issue seed/path fails at command 5. Current attempt 1 in sync run 1 writes `{id:'b', value:1}`; attempt 0 belongs to the ended run. Source rows contain b, but the subscriber receives delete b. | Production drops the equal delta before adding it to private replacement rows. Retain that delta while a direct private replacement exists; its final diff suppresses a redundant public update. |
| Ordinary source writes obey the same replacement law | Same owner, model and comparison; no new expected-result computation | Before production edits, the new source-delivery lane restores equal independent row c while demand a holds publication. Settlement deletes c unexpectedly, alongside the legitimate deletion of omitted d. | A patch restricted to acquisition keys would miss the class. The predicate covers both real source delivery paths. |
| Omitted rows leave, failed replacement stays private, obsolete settlements are inert, and nonbuffered equal writes stay silent | Same model and observation cuts | Generated neighbors cross missing/equal/changed rows, six demand lifetimes, current resolve/reject and obsolete outcomes. A mutant retaining omitted rows fails; canceled and absent current attempts are measured as no-ops. | Preserve the existing final diff, stale-row cleanup and cancellation semantics. No model or comparison was relaxed. |

The repair-location judgment is production. Neither the driver nor the model
needs a changed expectation. The actual source write supplies membership before
the disputed publication cut, so there is no missing-provider-information
hypothesis at this controlled boundary.

## Reach and grammar

The original general grammar already generated the counterexample; the defect
was not a false-green model. Its finite random budget did not reliably exercise
cleanup/restart with an equal restored row. The added constructive crossing
makes that distinction durable and measures reach.

`subscription-lifecycle.restart-publication` runs both delivery paths:
acquisition writes and ordinary independent source writes. Each generated input
runs every combination of:

- six demand histories: pending, settled, two live demands, aborted, released,
  and no owner;
- three prior-row relations: absent, equal, changed;
- current resolve and reject commands, with a successful truncate replay after
  rejection.

The demand key (a/b), independent value (0–5), and obsolete resolve/reject outcome
vary. The fixture's acquisition rows use attempt IDs, so the grammar derives
which initial value will equal the restarted write. Omitted independent d
prevents a keep-all-rows implementation from passing.

There are 72 declared history states. Each is reached **12 times per campaign**,
separately for acquisition and ordinary-source paths, in the normal fixed-seed
and random runs: 1,728 histories total. The reach counter and an exact-count
assertion enforce these counts. For aborted, released and absent owners, the
current-settlement command is explicitly checked as unexecuted; its label is
not evidence of a successful or failed acquisition. Both actual current
outcomes are structurally required for the live-owner histories.

Reconstruction: the exact nine-command issue history is retained as input to
`runPublicationHistory`, without separate expected values. The general grammar
and original seed/path remain unchanged. Ablation: removing equality loses the
reported defect; removing ordinary source delivery admits an acquisition-only
repair; removing omission admits stale-row retention. Range: both demand keys,
all six independent values, old pending/settled/canceled demand, zero/one/two
live owners, and late obsolete outcomes. Exclusion: source operations always
commit valid complete transactions; the fixture fences writes with their
acquisition signal. An aborted attempt cannot legally supply replacement rows.

## RED, GREEN, and calibration

All RED results below preceded production edits. The original model and shared
comparison remained unchanged throughout.

```sh
TANSTACK_DB_ORACLE_SEED=-1439698414 \
TANSTACK_DB_ORACLE_PATH=1:22 \
TANSTACK_DB_ORACLE_PROPERTY=subscription-lifecycle.publication-history \
pnpm --filter @tanstack/db exec vitest run \
  tests/collection-subscription-lifecycle-publication-oracle.property.test.ts \
  -t 'matches row publications for a random or replayed seed' \
  --maxWorkers=2 --coverage.enabled=false
```

Original RED: one assertion fails at `assertPublications`, command 5:
observed delete b(value 1), expected no batch. Repaired GREEN: one test passes.

The extended owner's fixed seed 2310 and random campaigns also failed before
production edits on both acquisition and ordinary-source paths. The
ordinary-source mismatch at command 7 incorrectly deleted restored c. The
legitimate deletion of omitted d and insertion of demand a remained visible,
so this is a publication assertion failure, not setup or missing execution.

The new property's direct replay is also GREEN:

```sh
TANSTACK_DB_ORACLE_SEED=2310 TANSTACK_DB_ORACLE_PATH=0:0:0 \
TANSTACK_DB_ORACLE_PROPERTY=subscription-lifecycle.restart-publication \
pnpm --filter @tanstack/db exec vitest run \
  tests/collection-subscription-lifecycle-publication-oracle.property.test.ts \
  -t 'matches restarted row publication' \
  --maxWorkers=2 --coverage.enabled=false
```

This selects only the replayed campaign and runs both delivery paths: two tests
pass. Normal campaigns use the same grammar, driver, model, comparisons and
12-input budget; one uses seed 2310 and one chooses a random seed.

| Temporary production mutant | Result at the intended comparison |
| --- | --- |
| Original equal-delta suppression, removing the private-replacement predicate | Original regression and all four generated tests fail at publication assertions. |
| Preserve equal deltas only for acquisition keys a/b | The original b regression passes, but both source-delivery campaigns fail: restored c is wrongly deleted. This rejects a one-trace repair. |
| Put omitted stale rows back into the final replacement | All four campaigns fail publication assertions because omitted d survives. |

Each mutant was restored before the next experiment. None survives, times out,
or fails during setup. Mutant passes are not reported as repaired-branch GREEN.

The eight-suite surrounding run passed **646 tests**, covering lifecycle
publication, lifecycle histories, lifecycle oracle, replay oracle, ordinary
lifecycle/publication examples, reentrancy, and cleanup/restart. The final
publication owner alone passed **143 tests** after stronger reach assertions.
`pnpm --filter @tanstack/db exec tsc --noEmit` passed. Final lint, formatting,
code-weight measurements and any later verification are appended below.

## Limits and oracle-guide audit

The closure claim is direct Collection subscriptions × the bounded histories
above × the public Collection sync boundary × per-command exact callbacks,
source rows and callback-applied subscriber rows. The changed predicate applies
only when a direct private-rows map exists. Delegated graph publication keeps
its prior path. These experiments do not establish compiled includes behavior,
a framework's scheduling, or an external provider's completeness or cancellation.
The controlled rows have string keys and numeric values; virtual fields,
arbitrary object equality, optimistic writes and reentrant adapter callbacks
remain with their existing owners. No known reachable violation of this bounded
law remains; generated passing histories are not a universal proof.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Existing API/publication contract and limits stated above; no new product law. |
| ORC-002 | Existing independent Map model unchanged; production supplies only observations. |
| ORC-003 | Opening law and adjacent grammar prose explain membership, source delivery, histories, observations and checkpoints. |
| ORC-004 | Reconstruction, ablation, range and exclusion recorded above. |
| ORC-005 | Real Collection API and sync writes; exact callback/source/subscriber comparisons at every command. Actual restart and current/no-op settlement execution are checked. No missing source fact identified. |
| ORC-006 | Three hostile production mutants fail at the intended publication assertions. |
| ORC-007 | Fixed/random campaigns have equal budgets and mechanics; original and new seed/path replay commands were executed. No `fc.commands` replay path applies. |
| ORC-008 | No reference-model state added, removed or merged. |
| ORC-009 | Existing glossary terms retained. Demand-history labels describe grammar premises; canceled/absent current attempts are not classified as settlements. |
| ORC-010 | Existing driver preserves primary mismatch and secondary cleanup failures with `AggregateError`; its cleanup is unchanged. |
| ORC-011 | No new shared semantic-fault hypothesis requiring a second formulation. Counterexample comes from independent source/subscriber disagreement, not merely production/model agreement. |
| ORC-012 | This record identifies the reviewed HEAD and final code/test diff; applicable requirements are accounted for. |
| ORC-013 | Equal/changed/absent and omitted-row neighbors distinguish suppression from membership; narrow-fix and retain-omitted mutants are rejected. |
| ORC-014 | No real-provider or native-host claim is made. This is a controlled Collection boundary. |
| ORC-015 | Every declared history state reaches the driver and comparisons 12 times per normal campaign; each receiving path has separate reach. |
| ORC-016 | Regression and all generated histories replay the shared model/driver/comparison; no separate expected answer was added. |

## Lossless finding ledger

Source-order IDs preserve the issue's separate claims and requirements. No
comments, footnotes or capped findings were present. Raw source and append-only
working evidence are retained locally in `.review-2310/`; that scratch directory
is not part of the proposed change.

| ID | Original claim or action | Evidence / verdict | Action | Durable value and destination |
| --- | --- | --- | --- | --- |
| R1 | Cleanup/restart publication deletes retained b; reproduced on main c351fc04d and PR #2307 1d619bb; cause explicitly undiagnosed | Confirmed production defect on the reported main commit with exact seed/path. PR head replay is reported evidence from the issue, not independently rerun here. | fixed-now | Exact shared replay plus generated membership crossing in the primary publication owner. |
| R2 | Identify the selected attempt and establish authority before changing implementation or model | Attempt 1, new sync run 1; source b is installed before settlement publication. Existing replacement law authorizes no delete. | fixed-now | Law, root cause and repair-location judgment above. |
| R3 | Preserve the nine-command history; cross rows, demand lifetimes and current/obsolete outcomes; require RED/GREEN/mutant | Both receiving paths fail unchanged production; all 72 constructed states are measured; original and narrow/broad mutants are rejected. | fixed-now | Primary oracle and coverage-map addition. No expectations, exclusions or existing budgets changed. |
| R4 | Keep separate from Solid PR #2307; #2121 retired-truncate, #1921 deferral handles, #2294 ordered replay and #2302 ordered retirement/provenance are distinct; maintainer requested a separate issue | Approved scope in #2310. The final production diff touches only Collection subscription reconciliation, not Solid, an ordered loader or the model. Historical related-PR claims were context, not independently audited. | accepted-design | This scope record. No GitHub issue or PR was changed. |

Sibling S1: ordinary source delivery of an equal independent retained row also
vanishes. This is confirmed and fixed under the same law, with its own generated
receiving path and pre-edit RED. It is separate from the four raw items.

Reviewer assessment: high accuracy and signal, strong replay evidence and clear
prioritization. The report correctly distinguished a mismatch from a diagnosed
production bug and required the authority/neighbor audit. It proposed no
premature implementation cure. Hire recommendation: positive for diagnostic
work demonstrated by this report; a single issue does not establish broader
review performance.

Loss audit: **4 raw items = 3 fixed-now + 1 accepted-design**. No confirmed-open,
deferred, stale, refuted, design-decision or duplicate items remain. S1 is also
fixed. Item accounting and bounded implementation/oracle enforcement are
complete. PR readiness is **not assessed**: no PR was requested, created or
pushed with the repair, and whole-repository CI was not evaluated.

## Final verification and code weight

Code/test diff SHA-256, computed from `git diff --` for `subscription.ts`, the
publication owner and `oracle-config.ts`:
`2544ec5a5e5e2727a22be470ae53d3ca4ef4e6d31900cc326501cea60b877e27`.
This identifies the uncommitted repair in addition to its base HEAD.

`pnpm size:compare --files` completed successfully against the same merge-base.
The final Collection subscription module grows **24 minified bytes**. The db
package grows **5 gzip bytes** and shrinks **4 Brotli bytes**. The typical app
grows **7 gzip bytes / 76 Brotli bytes**; all other package bundles are unchanged.
The production change reuses the existing private-row map and final diff;
it introduces no state, recovery path or helper. Refactoring the predicate from
an explicit undefined comparison to its equivalent Map truthiness reduced
module growth from 33 to 24 minified bytes, db gzip growth from 7 to 5 bytes,
and typical-app gzip growth from 9 to 7 bytes. Retaining the final diff and
stale-row removal is necessary: the omitted-row mutant demonstrates why removing
that work is incorrect. The remaining predicate growth pays for distinguishing
replacement membership from public delta equality. Tests and evidence documentation
grow separately and do not ship in the package.

Formatting and `git diff --check` pass. The original 60-input broad fixed/random
campaign budgets are unchanged; the new 12-input structural campaigns add
coverage rather than replacing those budgets.

Worktree setup: `.worktrees/codex-issue-2310-publication`, branch
`codex/issue-2310-publication`, based on freshly fetched `origin/main` at the
recorded HEAD. Initial publication to
`origin/codex/issue-2310-publication` succeeded. `pnpm install` succeeded without
local overrides. The repair and evidence remain uncommitted; no PR was created.

Exact surrounding verification command:

```sh
pnpm --filter @tanstack/db exec vitest run \
  tests/collection-subscription-lifecycle-publication-oracle.property.test.ts \
  tests/collection-subscription-lifecycle-history-oracle.property.test.ts \
  tests/collection-subscription-lifecycle-oracle.test.ts \
  tests/collection-subscription-replay-oracle.property.test.ts \
  tests/collection-subscription-lifecycle.test.ts \
  tests/collection-subscription-lifecycle-publication.test.ts \
  tests/collection-subscription-reentrancy-oracle.test.ts \
  tests/collection-cleanup-restart-oracle.test.ts \
  --maxWorkers=2 --coverage.enabled=false
```

Final TypeScript checking and focused ESLint both pass with no diagnostics.
`pnpm lint:changed` also passes with no reports; no oracle run budget was lowered
or removed. The final eight-suite run remains GREEN at 646 tests.

## Prep-pr follow-up on current main

The preceding `c351fc04d` entries describe the original investigation. During
prep-pr, `origin/main` advanced to
`bfd1da1a7e752d66fd667adfd3cdf54f60732b22` with the separate Effect membership
repair (#2301). This branch fast-forwarded with its uncommitted changes
preserved. The code/test diff SHA-256 remains
`2544ec5a5e5e2727a22be470ae53d3ca4ef4e6d31900cc326501cea60b877e27`.
No source or oracle repair was added during quality review.

At this current HEAD, the same eight-suite verification command above passes
**646 tests** and `pnpm --filter @tanstack/db exec tsc --noEmit` is clean.
An independent reviewer additionally ran the shared issue replay and four new
campaigns (**5 passed**) and the original exact seed/path replay (**1 passed**).
Both the independent correctness review and a separate simplification review
recommend no code changes. They agree that equal restored membership belongs
in the private replacement and the final diff owns redundant-update suppression.
The simplifier considered delivery-parameter and typed-owner-metadata alternatives
but declined them because the existing bounded grammar remains clear and small.

The complete review outputs and lossless evaluation are retained in local
`.review-2310/` scratch. There are no behavioral findings or law decisions to
resolve. Two declined style alternatives were evaluated, and the duplicated
request for current-head evidence is closed by this append. The review did not
change any law, exclusion, comparison, generator or run budget. This supplements
the earlier oracle-rubric audit; its finite direct-subscription limits remain.

The required size comparison also succeeds against `bfd1da1a7`: subscription
**+24 minified bytes**, db **+5 gzip / +39 Brotli bytes**, typical app
**+7 gzip / +76 Brotli bytes**. Other package bundles are unchanged. These are
the current-base measurements; the earlier measurements remain attributed to
the original base.

Local quality review is complete. PR readiness remains unproven until the
changeset, committed/pushed head and PR checks have been prepared and verified.


## CI replay registration follow-up

PR #2313 first ran at `ebdd2140d6a25efdc6c747070f1385d4b367449d`.
The replay shard found a missing manifest owner for the newly registered
`subscription-lifecycle.restart-publication` property. The property's direct
Vitest replay was valid, but the guarded replay portfolio could not discover
its owner. This was a test-registration omission, not a changed product law
or a mismatch in the independent publication model.

The existing `named oracle replay manifest` tests reproduce RED locally:
one failure names that property as `no-named-owner`. Adding its suffix beside
`publication-history` in `oracle-replay-manifest.ts` gives GREEN: all six
manifest tests pass. The same check rejects the omitted mapping, so it also
calibrates the registration repair. No production, model, history, comparison,
exclusion or run budget changed.

```sh
pnpm --filter @tanstack/db exec vitest run tests/oracle-replay.test.ts \
  -t 'named oracle replay manifest' --maxWorkers=2 --coverage.enabled=false

TANSTACK_DB_ORACLE_SEED=2310 TANSTACK_DB_ORACLE_PATH=0:0:0 \
TANSTACK_DB_ORACLE_PROPERTY=subscription-lifecycle.restart-publication \
pnpm --filter @tanstack/db exec node --import tsx tests/oracle-replay.ts \
  tests/collection-subscription-lifecycle-publication-oracle.property.test.ts \
  -t 'matches restarted row publication' --maxWorkers=2 --coverage.enabled=false
```

The guarded replay now passes both delivery paths and reports two successful
witnesses with the requested property, seed and path. This supplements the
earlier direct replay and closes the missing portfolio-discovery boundary.

## Production-weight refactor

The maintainer requested broader refactoring after PR #2313 reached
`e453634da7339e79d892a2bf198f0e5556828b12`. This follow-up preserves behavior:

- Update `publishedRows` and `sentKeys` in one pass before calling the consumer.
  Delete the two single-use tracking methods and the callback alias.
- Keep the three source listener removal callbacks in one ordered array.
  Registration and removal retain their order. Unsubscription detaches the
  array before invoking callbacks through `runAllCallbacks`, which still attempts
  every callback and rethrows the first exact failure value.
- Initialize that array at registration, removing an unused initial allocation.
  Cleanup-start registration can call synchronously, but the initial subscription
  has no demands, rows or replay, and that path does not read the listener array
  or expose the subscription to a consumer.

The equal-row production predicate remains intact. No contract, model, grammar,
comparison, exclusion, replay registration or run budget changed. The existing
owners exercise the unchanged contract, so this internal refactor needs no new
oracle law or examples. The final production file's SHA-256 is
`f2ee13496359611fa5fe22066df96d80dec88a77fa18693af2fcfeff4ce29bc4`.

### Measured shipped bytes

`pnpm size:compare --files` compares the complete PR with merge-base
`bfd1da1a7e752d66fd667adfd3cdf54f60732b22`, after fetching `origin/main`.
Negative values mean fewer shipped bytes. Test and documentation additions
remain outside these production bundles.

| Build | Gzip delta | Brotli delta |
| --- | ---: | ---: |
| Full DB package | -28 | -43 |
| Typical app | -32 | -8 |
| App with Effect | -33 | +4 |
| App with groupBy | -38 | +22 |
| App with includes | -33 | +92 |
| App with join | -33 | +76 |
| App with local storage | -32 | -110 |
| App with optimistic action | -33 | +54 |
| App with paced mutations | -33 | +26 |

The subscription module shrinks **73 minified bytes** against the base. Other
package bundles remain unchanged. Every measured app shrinks under gzip.
Brotli results vary across feature scenarios, so the claim is negative weight
for the typical app and full DB bundle, not for every compressed app.

The original PR grew 24 minified bytes, 5 DB gzip bytes and 7 typical-app gzip
bytes. Fusing the loops while retaining a single helper reduced the module but
still grew both gzip bundles by 2 bytes. A generic Map-fold helper also left
the DB gzip bundle 2 bytes larger and hid simple bookkeeping behind an
abstraction. Inlining the loop reduced DB gzip by 5 bytes but grew DB Brotli
by 88 bytes. The ordered listener array removes parallel optional fields and
wrapper callbacks, paying for the fix with simpler existing machinery. A
redundant callback alias and initial array allocation were then removed for
clarity and fewer allocations, without tuning names, comments or formatting.

### Review and verification

Independent correctness review found no defect or optional suggestion. It
checked tracking before reentry, repeated keys, callback throws, listener handle
ownership, synchronous cleanup registration, idempotence, cleanup order and
exact first-error propagation. Its selected final-wrapper checks passed 20 tests.
The simplification reviewer proposed one P3 item: remove the unused initial
listener array. That proposal was accepted under the maintainer's refactoring
request and verified with TypeScript and the surrounding suites.

Lossless evaluation: **one raw suggestion = one fixed-now item**. No
confirmed-open, deferred, refuted, stale, design-decision or duplicate item
remains. Both reviews receive a hire recommendation for this scope: accurate
boundary analysis, useful validation and no unsupported contract changes.
The raw reports and item ledger remain in local scratch. The source-order
suggestion and its full rationale are preserved above.

The exact eight-suite command recorded earlier passes **646 tests** on the
final refactor, with no type errors. `pnpm --filter @tanstack/db exec tsc --noEmit`,
ESLint, Prettier, `pnpm lint:changed`, and `git diff --check` pass. The latter
reports no lowered or removed oracle budget.

The final-head sensitivity check temporarily restored the original equality
suppression while retaining the refactor. All four restart campaigns failed
at the shared publication comparison. Restoring the exact production file
made all four campaigns pass (139 unrelated owner tests deselected):

```sh
pnpm --filter @tanstack/db exec vitest run \
  tests/collection-subscription-lifecycle-publication-oracle.property.test.ts \
  -t 'matches restarted row publication' \
  --maxWorkers=2 --coverage.enabled=false
```

This is renewed sensitivity evidence after an internal refactor. The earlier
oracle-first RED, two distinguishing mutants and direct-subscription limits
still govern the original repair. No temporary mutant remains. Local review
and implementation work are complete; final pushed-head CI is checked separately.
