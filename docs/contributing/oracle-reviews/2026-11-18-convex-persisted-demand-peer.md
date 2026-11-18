# Convex persisted demand: a larger saved peer behind a finite online prefix

This receiver extends the primary persisted-demand model without adding a
second expected-result model. The governing law comes from "On-demand
Collections offline" in the SQLite persistence guide: an exact saved demand
keeps its rows and offline coverage until source evidence ends them. A finite
provider prefix does not establish that a saved row outside the prefix was
deleted.

The shared driver and suite are
`db-adapter-conformance/tests/persisted-demand-peer-driver.ts` and
`persisted-demand-peer-oracle-suite.ts`. Node and Chromium/OPFS supply actual
closed/reopened storage and a fresh actual Convex SDK. The SDK receives
controlled WebSocket transitions, including nonexhausted pages.

## Frozen pre-edit evidence

[The v2 snapshot](2026-11-18-convex-persisted-demand-peer-pre-edit-v2.json)
records exact sources, host logs and checks. Convex production stayed at
`3f9a9a2f16a613897dab4eea4dedc72b66515bd38f523c9eae2659fae7d2b317`
through this authoring and both-host execution. This is the first repair
attempt described in the broader saved-demand report, before any second
production repair.

The finite grammar preserves the original four cases and adds four boundary
cases: source size eight/nine, unchanged/changed provider prefix values, and
distinct/tied prefix boundary ranks. In the tied case, saved `row-5` shares
rank four with delivered `row-4`, but the actual finite reply excludes
`row-5`. A wrong inclusive-rank deletion can therefore be distinguished from
a strict-prefix repair.

Every history first establishes the larger five-row demand online. It closes
storage, creates fresh provider and storage instances, and starts a smaller
two-row demand. While its provider acquisition waits, a real optimistic
transaction holds application. The larger demand's persisted restore then
accepts its saved suffix. Pending core receipts and
`acceptedSyncedEntries()` prove acceptance; the public exposed base still
contains only rows one/two, and the larger raw provider acquisition count is
zero. Only the smaller finite provider prefix is delivered. The provider then
holds later work before the optimistic transaction releases.

On both hosts, all eight histories reach each of the first five declared
states; all four tied histories reach the tied-boundary state. All eight
semantic comparisons reject the first repair attempt at **saved suffix after
finite prefix applies**: public source rows and SQLite hold only rows one
through four. The primary model retains the saved suffix. Both deliberately
wrong-result calibrations have RED clean baselines, so those two failures are
derivative and are not counted as calibration kills. Two framework checks
pass. Each host therefore reports **10 failed, 2 passed**.

Commands, from the respective package directories:

```sh
pnpm exec vitest run tests/persisted-demand-peer-oracle.test.ts --testTimeout=30000 --coverage.enabled=false
pnpm exec vitest run --config vitest.adapter-oracles.config.ts e2e/adapter-persisted-demand-peer-oracle.browser.test.ts
```

Both package TypeScript checks, scoped ESLint, formatting and `git diff
--check` pass. The ordinary browser attempt initially failed before setup
because sandbox policy disallowed its localhost listener. The approved command
then ran actual Chromium/OPFS; the recorded semantic RED is that completed run.

## Judgment and limits

`persistedCoverageRows`, `expectedObservations` and `coverageViolations` from
the primary persistence oracle judge every cut. Source values compare within
the larger demanded first-five-row window. SQLite compares every authored
saved row, including extra rows that earlier provider pages supplied. When the
primary model predicts readiness, the larger query's whole values and preload
fulfillment compare too. Each actual acquisition has its own wait premise.
Public rows, status and preload are captured before the independent durable
read, so that read cannot change an earlier cut's clock premise.

Provider rows and load outcomes are source facts. Adapter-emitted replacement
transactions are recorded only as diagnostics. They cannot authorize deleting
the saved suffix in the reference model. Storage/provider drains are finite
and do not poll readiness, fallback settlement or expected row values. Online
preload is awaited only to establish the saved-coverage premise. Cleanup
preserves semantic records and reports separate cleanup/browser failures.

ORC-001 through ORC-005 and ORC-008 through ORC-010 are satisfied by the
authority, unchanged model, literate shared driver, finite grammar, positive
premises and observations above. ORC-006 remains pending a repaired clean
baseline and semantic fault controls. ORC-007's generated-campaign obligation
does not apply to this finite enumerated grammar. ORC-011 identified no further
shared-model fault hypothesis. This source-bound record supplies ORC-012;
strict/tied boundary cases supply ORC-013. Both actual SDK/host paths receive
the same primary judgment under ORC-014. Enumerated reach is declared and
measured under ORC-015. Every history and calibration reuses the same driver
and judgment under ORC-016.

This record establishes a legal counterexample and the pre-edit gate. It
does not claim a GREEN repair, a mutation kill, deployed-service behavior,
arbitrary filters/cursors, deletions, changing ranks, retention expiry,
concurrent tabs or whole-adapter completeness. The existing four-row common
receiver remains unchanged by this peer extension. Final repair and mutant
evidence must supersede this pre-edit status.

## Repaired candidate

After both independent reviewers approved the pre-edit gate, the main agent
changed Convex's startup and prefix handling. The final-source rerun is
[candidate v2](2026-11-18-convex-persisted-demand-peer-candidate-v2.json):
**12/12 Node and 12/12 Chromium/OPFS GREEN**, with every common declared state
reached eight times and the tied-boundary state four times per host. The exact
production fingerprints are `options.ts` **690a8ed3…**, `pagination.ts`
**1328c4bf…**, and `subscription.ts` **375baafa…**. The shared driver remains
**4236f406…** and the suite **786106db…**, unchanged from the approved pre-edit
witness.

Both calibrations now have GREEN clean baselines and reject their intended
wrong source/durable suffix observations. These are checker controls; the
main agent coordinates separate production mutants. The source-bound final
candidate therefore supplies GREEN and calibration evidence, while the
mutation gate remains separate. An earlier successful run began before the
main agent added synchronous-commit-throw token cleanup. Its logs are retained
as `final-candidate.log`; all current GREEN claims use the fresh frozen-source
`final-candidate-v2.log` runs.
