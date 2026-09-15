# Cursor adapter: contract, experiments and implementation

Work arising from https://github.com/TanStack/db/issues/863. The independent
test-first experiment now exercises the public `createCursorPager` helper in
`src/cursor-pagination.ts`. Keep the existing output-row peek-ahead contract.

The separate [no-peek experiment results](./NO-PEEK-RESULTS.md) evaluate an
opt-in publication-bound continuation fact. That candidate does not change the
cursor experiment or the existing production controller.

## Contract before implementation

- A pager belongs to one source/filter/total-order sequence. The adapter creates
  separate pagers for separate scopes; it never shares a single latest cursor.
- A successful read returns exactly the requested offset/limit slice, or fewer
  rows only at authoritative exhaustion. Undefined limit drains the source.
- Backend cursors are opaque and point after the backend response, not after
  the UI slice. Retain the unreturned tail before advancing that cursor.
- Zero limit performs no transport work. Short and empty nonterminal pages do
  not establish exhaustion. A repeated cursor fails clearly rather than loops.
- Reads of one pager serialize. Reader cancellation rejects that reader but
  does not cancel Query's shared acquisition or discard its valid page. Use
  QueryClient cancellation to stop transport; reset rejects old reads. Failed
  acquisitions leave the previous cached result available and can cause Query
  to rebuild the prefix when retried. These are Query's semantics, replacing
  the prototype's rule that an aborted reader must discard its response.
- Query owns cache expiry, garbage collection and invalidation. Use a distinct
  infinite-query key for each source/filter/order, beside the row prefix under
  a shared resource prefix. Never put pages inside the row collection's prefix:
  manual row writes target queries beneath it. Raw-array writes defensively skip
  other cache formats; selected response formats still require separate prefixes.
  For forced refresh, cancel the shared prefix before invalidating both caches;
  invalidation alone can join an old in-flight append. Collection refetch alone may reuse
  fresh pages. Reset removes pages, but does not refresh collection rows.
- The internal page format and full prefix are fixed: inherited `select` and
  `maxPages` settings cannot change them. Explicit acquisition cancellation rejects its
  waiting reads with AbortError without starting new work; a silent cancelling
  refetch moves waiters to the replacement. Aborted readers release their own
  queue position without cancelling transport. Cached reads
  need not wait for a deeper peer acquisition.
- Rows are immutable request/cache values. Reading may return a fresh array;
  cross-read object identity is not promised.

The backend supplies a stable ordered sequence within a pagination interval. This is
not a promise of snapshot consistency from arbitrary changing HTTP endpoints.
An adapter must define its real endpoint's cursor validity/invalidation rules.

## Oracle and responsibility boundary

`model.ts` filters/sorts the complete independent dataset and slices it. It has
no cursor or acquisition state. Generated histories vary windows, ties, backend
page size, source scope, failure/retry and reset. Fixed products retain empty,
zero, unlimited, peer and backend/UI boundary witnesses. Fault controls must
fail value/protocol assertions, not merely fail setup or time out.

The fake backend alone understands its token table. The production pager
must obtain rows by traversing those tokens; the backend does not remove rows
already delivered or infer missing progress for the pager.

Layers earn separate credit: model calibration; pager against opaque transport;
real QueryClient/QueryCollection/live-window integration. The last layer must
observe production publications, not manufacture them in the fixture.

## Work queue

- [x] Calibrate independent reference and demonstrate a one-page reader fails.
- [x] Implement test-only pager; retain red/green evidence.
- [x] Generated windows, page repartition equivalence, scope/reset, work checks.
- [x] Held response, abort, failure/retry, healthy peer, late reset checks.
- [x] Real QueryCollection and window-controller integration; unchanged peek-ahead.
- [x] Focused tests, types, lint, stress; record exact commands and limits.

## Chosen implementation and explicit exclusions

- Use Query's infinite-query page cache, not a parallel TTL/registry. Loading
  more fetches the missing suffix while pages are fresh. Expiry or invalidation
  rebuilds the loaded sequence from the beginning. Query measures freshness
  from the latest successful acquisition, including page growth. This differs
  from the earlier suggestion to date a session from its oldest page.
- The fresh-pager-per-queryFn prototype was rejected: it would repeat fetching
  on ordinary page growth. Creating a helper per call is now safe **only
  because its stable QueryClient/key retains pages outside that helper**.
- Page queries have no lasting observer. Their inactive `gcTime` controls
  retention even when the outer collection is visible. Memory can still grow
  with fetched data inside that interval; no per-page size/eviction policy.
- Keep N+1. No metadata setter, no-peek optimization, metadata-only notification,
  eligibility planner, new D2 graph, total-count API, previous-page API, cursor
  persistence promise, backend snapshot guarantee or offset/cursor jump hybrid.
- Query-native key sharing reuses acquisitions. We do not add cross-owner
  cancellation leases or replace Query's own concurrent-fetch semantics.
- The hook and core are unchanged. The maintainer chose to close #863 with this
  partial implementation. Cached opaque-cursor loading ships; metadata/no-peek
  is intentionally excluded, not unfinished work required to close the issue.

## Implementation verification

- Before promotion, request capture returned the mutated caller window and a
  150,000-row page overflowed spread arguments: two assertion/runtime failures.
  The helper captures numeric fields on invocation and avoids argument spread.
- A long-lived cache without invalidation failed all four real-refetch cells,
  retaining old rows. The Query-owned cache with shared-prefix invalidation
  passes backend growth, shrink, empty and regrowth plus later page expansion.
- The frozen candidate passed 87 tests across five files with multiplier 100,
  seed 863: 35,000 cursor histories, 10,000 cache histories and 15,000 no-peek
  experiment histories. The latter are retained experiments, not shipped
  metadata behavior. A loss audit and final package gates follow.

The cache oracle uses a full source snapshot plus a freshness deadline, not a
copy of Query's cache/observer/retry state. The integration test uses the actual
QueryClient, QueryCollection, graph and window controller. The supporting
`pager.ts` only configures an isolated QueryClient for stable-snapshot laws.

## Final implementation gates and loss audit

[Loss audit](./LOSS-AUDIT.md): two source-isolated readers (issue and plans),
plus an explicitly correlated guide audit. Recovered documentation boundaries,
added invalidation fault calibration and QueryClient transport cancellation,
and strengthened all four real-refetch cells. No production changes were
needed after that audit. No prior experiment test was deleted.

The subsequent prep-pr review found three real gaps. The expanded cache oracle
failed eight cells before production changed (seed 863, minimized size/depth
`[1, 1]`): global/key `maxPages`, `select`, their combination, and cancellation
with an existing prefix during growth/refresh. Initial cancellation stayed green.

The fixes pin the internal page format and preserve acquisition rejection even
when Query's fetch API returns reverted cache data. Generated cancellation
histories hold actual response delivery at varied page depths, observe a real
peer fetch join, assert both waiters reject without replacement transport, fence
late completion, and retry. A fresh cached shallow read still completes while a
deeper acquisition is held. The reference remains full filter/sort/slice; no
Query state machine was added to it. The reviewer independently rechecked the
three fixes after implementation.

The cache-publication review then exposed invalidation during held growth and
protocol errors after cache publication. Its oracle was red in four cells before
the fixes. The supported refresh procedure now cancels before invalidation;
response validation runs before Query can publish or resolve shared waiters.
The new five-cell suite retains an invalidation-only fault control and covers
shared readers, retries, malformed final tokens, recovery and bounded slice work.
See LOSS-AUDIT.md for the distinct generator and observation gaps.

Verification for the acquisition-boundary review fixes on base head `3f43deeb6`:

- Full Query DB package: **370 tests in 14 files**, default random-seed lane,
  exit 0, 7.82 seconds.
- Final stress: **116 tests in seven files**, multiplier 100, seed 863, exit 0,
  73.48 seconds. 154,000 generated histories: the previous 135,000 plus
  6,000 nested cancellation/replacement, 3,000 reader abort, 5,000 manual-write
  and 5,000 backend-token isolation histories. 98 tests concern the
  shipping cursor helper; 18 retain the excluded experiment.
- The first stress attempt hit the ordinary five-second test timeout in the
  retry-heavy refresh property, with no assertion mismatch. The final stress
  command uses a 60-second timeout; the default suite limit is unchanged.
- Package TypeScript, targeted ESLint, formatting checks and Vite build pass.
- Browser ESM diagnostic import, esbuild minification, target ES2020:
  `queryCollectionOptions` alone 46,590 bytes / 14,985 gzip; with the helper
  52,014 / 16,999 (+5,424 / +2,014). These boundary fixes add 334 gzip
  bytes to published head `3f43deeb6`. This is an opt-in import comparison,
  not a universal application bundle measurement.

Final stress command, from `packages/query-db-collection`:

```sh
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=100 TANSTACK_DB_ORACLE_SEED=863 \
  ../../node_modules/.bin/vitest run \
  tests/cursor-pagination.oracle.test.ts \
  tests/cursor-pagination.cache-oracle.test.ts \
  tests/cursor-pagination.publication-oracle.test.ts \
  tests/cursor-pagination.boundary-oracle.test.ts \
  tests/cursor-pagination.integration.test.ts \
  tests/cursor-pagination.no-peek.test.ts \
  tests/cursor-pagination.no-peek.integration.test.ts \
  --typecheck.enabled=false --maxWorkers=1 --testTimeout=60000
```

Full-package command: `../../node_modules/.bin/vitest run --typecheck.enabled=false --maxWorkers=2`.
Types are checked separately with `tsc --noEmit -p packages/query-db-collection/tsconfig.json`
from the repository root. The installed local binaries avoid pnpm's unrelated
attempt to replace this checkout's existing node_modules.

## Cache-guard follow-up verification

Against base head `37dc8057c`, the manual-write oracle now crosses raw/selected
responses and raw nested/sibling page keys over generated operation histories.
It checks cache state as well as data, including empty raw-cache seeding. A
no-op cache-write mutant fails because it clears the page query's invalidation.
The refresh oracle also crosses new-per-call and retained pagers, including reads
queued behind growth. See LOSS-AUDIT.md for RED/GREEN evidence and scope.

- Full package: **374 tests / 14 files**, exit 0, 8.98 seconds.
- Stress: **120 tests / seven files**, multiplier 100, seed 863, exit 0,
  83.62 seconds. **174,000 generated histories**: 154,000 from the preceding
  boundary suite plus 10,000 additional manual-write and 10,000 retained-pager
  refresh histories. The stress command above is unchanged.
- Package types, Vite build and formatting pass. ESLint reports no errors and
  two pre-existing `no-shadow` warnings in unchanged parts of `query.ts`.
- Same ES2020 browser diagnostic imports: `queryCollectionOptions` alone
  **46,655 minified / 15,000 gzip**; with `createCursorPager`, **52,079 / 17,017**.
  The guard adds 65 minified bytes and 15/18 gzip bytes respectively over the
  base head. No full-prefix refresh or automatic invalidation policy changed.

## Historical experiment verification receipts

Validated after merging `origin/main` at `3b991173f` into merge head `3c54e89ae`.
The core and db-ivm packages were rebuilt from that checkout for the integration
tests. The experiment remains test-only; these results do not establish the
safety of removing peek-ahead or adding a public metadata API.

- First red: a one-backend-page reader failed four tests. Seed `1729857442`
  shrank the generated failure to two rows, backend page size one, and an
  unlimited read: the reader returned only the first row.
- Negative control: removing the post-response cancellation/generation check
  failed both held-response abort and reset cases. The rejection control still
  passed. Restoring the check restored green; these were assertion failures,
  not timeouts.
- Final green: 48 tests, including 32 backend/UI page-size integration cells
  and a held-response shared-consumer case. Four generated properties ran
  35,000 cases in total at multiplier 100 with seed `863`. A separate normal
  random-seed run also passed.
- Package TypeScript check and lint on all changed TypeScript files passed.

From `packages/query-db-collection`, using the installed local binaries:

```sh
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=100 TANSTACK_DB_ORACLE_SEED=863 \
  ../../node_modules/.bin/vitest run \
  tests/cursor-pagination.oracle.test.ts \
  tests/cursor-pagination.integration.test.ts \
  --typecheck.enabled=false --maxWorkers=1
```

From the repository root:

```sh
./node_modules/.bin/tsc --noEmit -p packages/query-db-collection/tsconfig.json
./node_modules/.bin/eslint packages/query-db-collection/tests/cursor-pagination*.test.ts \
  packages/query-db-collection/tests/cursor-pagination/*.ts packages/db/tests/oracle-config.ts
```

## Integration limits

The integration fixture handles its specific rank/id ordering and rank-equality
tie requests, with an independent cursor sequence for each filter. It rejects
unsupported predicates and cursor hints; it is not a generic IR interpreter.
Transport-count assertions there cover the primary prefix sequence, not the
separate tie-group sequences. The pager-level oracle checks total backend calls
within its single scope.

The real framework window controller runs without React. Assertions compare
public user fields and window state after every ready publication; virtual row
metadata is outside this experiment's contract.

The tests do not establish snapshot consistency for changing endpoints, actual
React/Vue/Svelte rendering, every IR expression or persistence of page caches.
The no-peek experiment uses a manually scoped bridge and remains test-only.
