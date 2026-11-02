# Evaluation of the nine-item Query DB review

The reviewed head is `03a7b3ba15c4826c3e0a901c3634e82231f71729`, based on
`30e85464ed2b9b12c5f10981a062427a1fc8daaa`. The human supplied nine unverified
claims. This is the author's experimental evaluation, not a new independent
review. The full raw claims, append-only ledger, patches, and logs remain in
`/private/tmp/callback-metadata/2332-nine-item-review-20261102/`. Commands below
use repository files and do not depend on that directory.

## Law, experiment, and inference

No product-law change needs a decision. The accepted adapter duty remains:
an autonomous refetch preserves each served ordered prefix or reports that
pages may have shifted. `LoadSubsetFn` in `packages/db/src/types.ts` and the
ordered-request/recovery section of `packages/db/src/query/live/ARCHITECTURE.md`
own that duty. The existing coverage owner also permits an earlier-end report
without an optimistic hold. It limits reports, rather than requiring the
minimum possible number under every visible state.

The independent model still sorts backend rows, filters markers, and computes
the window and required source coverage. Its public comparisons did not change.
The report reason is a separate work law. Changed key membership or an earlier
end can justify a report. A change only to an unrelated payload field cannot.

| Law and authority | Existing enforcement | Decisive experiment | Inference and repair |
| --- | --- | --- | --- |
| Prefix/report duty and settled coverage: LoadSubsetFn and architecture | The original constructive grammar covered limit 1, offset 0 and the moved held row. Its reach also counted update holds without proving a delivered repair. | Restoring the equal-key guard fails ordinary source coverage after release. A limit-1-only earlier-end predicate also fails that comparison at width 2. | Widen the primary grammar and require the deleted boundary, omitted gap, public report, and subsequent real repair acquisition. Retain the ordinary coverage comparison at release. |
| Reports need an ordered-prefix reason: existing owner report-work law and architecture's order-equal update rule | Any changed row value counted as a reason, and no campaign edited only a non-order payload field. | A report-on-any-values mutant passed all five old campaigns. The extended fixed campaign rejects it on a label-only refetch at step 1. | Count changed key membership or an earlier end, independently of complete value equality. Add label-only commands and negative controls while retaining full source-value comparisons. |

The production predicate still checks an earlier end independently of key
changes. A named `hasLaterPage` helper makes its other branch explicit. Its
short-circuit behavior, acquisition loop guard and report coalescing are
unchanged. The review requires no new state, fallback, retry, or core change.

## Histories and reach

The constructive grammar now varies numeric finite cursor pages, limits 1–3,
offsets 0–1, one/two order terms, static/function keys, explicit refetch/Query
invalidation, gap ranks 1–3, and a first row ID from 0–16. It creates a first
page of `limit + offset` rows and a final page of `limit` rows. That final
page remains full when its deleted held boundary moves earlier. The new gap
is in neither old nor new standalone answer.

Each generated history has label-only edits before and after the hold. These
are legal backend edits and use the same public model, driver and comparisons.
They do not move numeric order. Both campaigns retain 24 generated histories
and minimum 24 for each of two states:

- A same-key earlier end while the hold persists.
- That end is the deleted held boundary, an omitted backend row lies strictly
  between its old and new end, its report reaches the Collection, and a real
  core `refetch: true` acquisition follows that event.

Both states reached 24/24 in both final campaigns. The recorder derives the gap
from independent backend values and request answers. It wraps the public sync
adapter boundary only to record acquisition options. Query metadata normalizes
away `refetch`, so observing provider metadata alone cannot prove that path.
The real QueryClient, Query adapter and core ordered loader still execute.

A structural set runs 48 shared-model histories: three widths, two offsets,
four hold regimes (boundary delete, boundary update, unrelated delete, no
hold), and earlier/later ends. All six delete-gap width/offset states require
one fixed witness. All six reached once. In this set, earlier ends each
reported once, including without a hold. Later ends each reported zero times.
All settled source coverage comparisons passed. This measures behavior under
the established contract. It does not invent a new zero-report law for earlier
ends without a hold.

The general 80-fixed/80-random campaigns and the existing 40 held histories
remain. Their grammar and three reach minima of 3 are unchanged. Final general
fixed reach was 39/54/20 and random reach was 42/48/18. Those states are lagging
refetch after continuation, lagging refetch during a hold, and reporting over a
full window. They do not independently claim the new delete-gap reach.

Grammar controls: the exact original CI history still replays the shared
model. Wider pages reject a limit-1 repair. Label-only and later-end controls
reject irrelevant-report rules. Update, unrelated-delete and no-hold histories
exercise neighboring release paths without claiming that each needs a report.
The constructor excludes absent held keys, overlapping holds, out-of-gap ranks,
and a provider that ignores continuation. Numeric order is intentional: locale
order uses full-source acquisition and remains in the general campaign.

## Item ledger

All nine raw items retain separate IDs. The local audit stores every original
claim and proposed fix with its evidence and durable value.

| ID | Technical verdict and evidence | PR action | Durable value |
| --- | --- | --- | --- |
| R01 | Confirmed classifier gap. The arbitrary-values mutant passed all five old campaigns, then failed the extended work comparison on a label-only refetch. The historical “no comparison weakened” claim was too broad. | Fixed now: distinguish changed keys/earlier end from arbitrary value differences. Correct the historical record and coverage prose. | Preserve report-work judgment separately from complete public row-value judgment. |
| R02 | The observed unheld report is real: all six unheld earlier-end structural histories report once and preserve coverage. Calling it a contract violation is unsupported. The existing owner explicitly permits earlier-end reports without holds, and the loader judges whether repair is needed. | Accepted design under the existing prefix/report contract. Do not couple this adapter report predicate to optimistic transaction state. | Keep deterministic report counts and neighboring later-end/label controls. A stricter minimal-report promise would need a separate design decision. |
| R03 | The reported public gap is real, but the accepted architecture assigns autonomous page-refetch completeness/reporting to adapters. Restoring the adapter's equal-key guard reproduces the omitted source row. Core intentionally distinguishes new rows from order changes to contributed rows. | Accepted design: repair the adapter's violated duty. No universal fix for other adapters is claimed. A different core protocol is an unverified architectural proposal. | Keep the real core receiver and missing-gap comparison. Other adapters must independently fulfill the same LoadSubsetFn duty. |
| R04 | Confirmed width/control gap. The old grammar's width/offset/held-row restrictions were real. The extended width-2 witness rejects a limit-1-only predicate. A held-row-only reporting mutant survives all new page-end campaigns and structural histories, including unrelated/no holds. That survivor preserves the tested public contract rather than proving a bug. | Fixed now: generate wider pages, offsets, row IDs and payload controls, and add 48 structural neighboring histories. | Distinguish a surviving wrong implementation from a contract-permitted optimization. General campaigns do not borrow the new reach claim. |
| R05 | Confirmed overclaim. Original reach did not prove a deleted held boundary, an omitted gap, or report delivery and repair. | Fixed now: require that full premise and receiver path, minimum 24 in each campaign, plus six fixed width/offset witnesses. | Keep premise reach distinct from the ordinary public coverage assertion that kills the defect. |
| R06 | Confirmed prose mismatch. “Different rows” blurred values and ordering, and “changes only in place” did not state the required end condition. | Fixed now in executable contract, coverage owner and historical review correction. | Use key membership, leading-order end and complete row values as distinct observations. |
| R07 | Confirmed portability gap. The historical commands used temporary configurations. The disclosed local/CI Vitest version difference is also real. | Fixed now: commit repository-relative source-runner and focused typecheck configurations, plus commands below. Keep local 3.2.4 versus CI 4.1.12 explicit. | Commands and source bindings reproduce experiments without access to private logs. New-head CI remains separate evidence. |
| R08 | Confirmed clarity issue. The comment had lost its named subject. AGENTS permits reducing helpers, so inlining itself is not a blanket policy violation. | Fixed now: restore `hasLaterPage` and attach its comment to that predicate. Measure and disclose the byte cost. | Retain useful names and readable branches even when a different form compresses better. |
| R09 | Confirmed timeout diagnostic gap. A forced 1 ms outer test timeout now prints the chosen random seed, 291584404, through `onTestFailed`. | Fixed now: choose the seed before fast-check and register the same failure printer as the general campaign. Restore the normal deadline after the probe. | A timeout identifies its campaign even when fast-check cannot produce a shrink path. |

Totals: nine raw items = seven fixed-now + two accepted-design. No item is
deferred, merged into another ID, or left confirmed-open. The raw review's
“no tests or mutants” qualification is accurate at intake. All experiments
above ran during this evaluation.

## Executed calibration and reproduction

| Experiment | Outcome |
| --- | --- |
| Original 03a7 baseline | 40 owner tests passed after repairing scratch dependency links. The initial missing-dependency setup failure is retained separately. |
| Arbitrary-values mutant, old campaigns | All five campaigns passed, including all original run budgets. This is a false green. |
| Arbitrary-values mutant, extended fixed campaign | Assertion failure: report at step 1 with no changed keys or earlier end. Seed 20261102, path `0:0:0:0:0`. |
| Original equal-key guard, extended fixed campaign | Ordinary source-coverage failure after release step 7, not a timeout/setup failure. Same seed/path. |
| Limit-1-only earlier-end predicate | Ordinary source-coverage failure after release step 7 at width 2. Seed 20261102, path `1:0:1:1`. |
| Held-row-only earlier-end predicate | Survived both new campaigns and the structural neighbors. This is equivalence within the exercised public domain, not a killed mutant. |
| Full owner after readability refactor | 41 tests passed, including the two existing expected-failure limits. |
| Final affected page-end tests | All three passed after removing an accidental default that turned the intended no-hold control into a delete hold. Both 24/24 reaches and all six structural reaches passed. The other 38 owner tests were unaffected. |
| Guarded value-mutant replay | Reproduced the report-work assertion failure at the captured seed/path. |
| Guarded replay after restoration | Passed one selected replay test, with one witnessed invocation and four recorded fast-check runs. No full fixed/random campaign ran. |
| Guarded original CI replay | Passed one selected test, one witnessed invocation and two recorded fast-check runs. |
| Forced outer test timeout | Timed out at 1 ms and printed seed 291584404. This is diagnostic calibration, not product RED. All temporary mutations/deadlines were restored. |

The stronger reach initially failed on the widened fixture: partial final pages
could admit the gap, and provider metadata lacked the repair flag. Those
intermediate failures are retained in `extended-current.log` and
`reach-debug-fixed.log`. No minimum or comparison was relaxed. The corrected
constructor fills the final page, and the recorder observes the public adapter
boundary instead of inventing a provider-metadata flag.

From the repository root, with the repository's dependencies available:

```sh
pnpm_config_verify_deps_before_run=false pnpm exec vitest run --config packages/query-db-collection/vitest.refetch.config.mjs
pnpm_config_verify_deps_before_run=false pnpm exec tsc -p packages/query-db-collection/tsconfig.refetch.json
pnpm_config_verify_deps_before_run=false pnpm exec eslint packages/query-db-collection/src/query.ts packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts packages/query-db-collection/vitest.refetch.config.mjs
pnpm_config_verify_deps_before_run=false pnpm lint:changed
```

The portable Vitest configuration uses one worker, this checkout's DB/IVM
sources, jsdom, and this package's installed Query Core. It disables coverage
and typechecking for that runtime run. The second command checks types
separately. It works with an ordinary workspace dependency installation. This
evaluation used existing dependency-cache links only, with no installation,
override, lockfile change or dependency-version edit. Local Vitest was 3.2.4.
The normal CI lockfile selects 4.1.12. Local results do not establish the new
CI result.

A direct guarded replay uses only versioned files:

```sh
TANSTACK_DB_ORACLE_PROPERTY=query-db.refetch-held-page-end TANSTACK_DB_ORACLE_SEED=20261102 TANSTACK_DB_ORACLE_PATH=0:0:0:0:0 node --import tsx packages/db/tests/oracle-replay.ts --config packages/query-db-collection/vitest.refetch.config.mjs
```

For the original CI history, use property `query-db.refetch-ordered-prefix`,
seed `1661743421`, and path
`37:0:3:2:4:7:11:10:9:9:5:3:3:5:8:9:0:0:4:4:2:5:3:4:2:6:5:5:5` in the same
command. To reproduce product RED, temporarily restore the equal-key early
return in `recordOrderedPageResult`, run the page-end campaign, then restore
the repaired source. A narrower mutant changes only `endMovedEarlier` in the
report predicate to `endMovedEarlier && options.limit === 1`.

For classifier calibration, temporarily retain `JSON.stringify(rows)` in each
page record and report when that value changes, while keeping the acquisition
and coalescing guards. The captured value-mutant replay then fails on the
label-only step. Restore all temporary mutations before GREEN verification.

## Readability and compressed size

`pnpm size:compare --base 30e85464ed2b9b12c5f10981a062427a1fc8daaa --exact-base
--packages query-db-collection --files` used the existing exact-base cache.
Package gzip is 14528 B versus 14512 B (+16 B), and Brotli is 50 B smaller.
The typical app grows 10 B gzip and shrinks 83 B Brotli. The prior inline form
measured +5 B package gzip and unchanged app gzip. The restored useful helper
therefore costs bytes. Its explicit name and attached explanation make the
independent earlier-end branch easier to audit. No speculative semantic change
was added to recover those bytes. Tests, runner configurations and review
records do not ship in the package.

## Reviewer assessment and readiness

The reviewer found useful test-integrity, grammar, reach, documentation and
replay gaps. The successful arbitrary-values mutant and width-2 counterexample
make those findings substantive. However, the report treated mutant survival
as sufficient evidence of a bug and proposed a core rewrite without testing
its public contract. Its severity and repair-location claims were less reliable
than its oracle criticism. I would hire this reviewer for adversarial oracle
review, with a requirement to execute counterexamples and distinguish accepted
policy from product defects before prescribing production repairs.

This evaluation closes the identified enforcement gaps for the stated finite
histories. It does not prove all possible histories. External servers,
interval/focus/reconnect scheduling, persisted follower tabs, framework commits,
Effects, arbitrary browser processes, capped/offset-only provider defects and
in-hold window promises remain under the existing owner's declared limits.
The held-row-only survivor is recorded as tested equivalence, not a universal
proof of that optimization.

ORC-001–007: authority, independent judgments, literate layers, grammar controls,
real receiving path, hostile calibration and fixed/random/replay evidence are
recorded above. ORC-008: no reference-model state change. Recorder state splits
key membership, order boundary and payload values. ORC-009: the marker set is
the independent abstraction of the local LEFT-join filter. ORC-010: existing
primary/cleanup error preservation remains. ORC-011: no named shared-fault
hypothesis requiring another reference formulation was established. ORC-012:
this versioned record binds every item and source below. ORC-013: width-2 and
later-end/payload neighbors distinguish wrong boundaries. ORC-014: the claim
ends at the controlled provider with real Query/core under jsdom. ORC-015:
24/24 per campaign plus six structural states. ORC-016: every added history
uses the shared model and comparison, with no independent expected row list.

The item accounting and authorized repairs are complete locally. PR readiness
still requires the pushed head, current CI and all later review deltas. This
evaluation grants no merge authorization for #2332 or any release PR.

## Source binding

SHA256 binds the executable results, independently of documentation-only edits:

```text
packages/query-db-collection/src/query.ts: c08389b698335d4a2fbf300ea59b7d07f9d04bd6d42d4cf070041b1b212c0ad4
packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts: a7a637776d8cb21ce809e03876bbd929958df28dd204689466f1390b8a091d54
packages/query-db-collection/vitest.refetch.config.mjs: 83fdffc3113820d2aa27c90e9ce497af59cd873ef12e210043b6fedd54d0d83a
packages/query-db-collection/tsconfig.refetch.json: e4f8dba9cf648e2cba999baac81e6aa7fd09eb081c716a0e9dca2d8660fe2679
```
