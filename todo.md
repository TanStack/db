# Server pagination investigation

Base: `origin/main` at `ad043b745` (verified after fetch on 2026-09-10).
Worktree: `codex-rfc-server-pagination`.

## Accepted implementation

The user approved option A: remove the silently ignored `getNextPageParam`
option, reject it before query construction for untyped callers, and explain
the existing on-demand server-pagination protocol. This is an API migration,
not a new InfiniteQueryObserver bridge or remote cursor registry.

- [x] Remove the callback from React, Vue, and Svelte config types. Keep generic
  config wrappers source-compatible; unrelated return types stay unchanged.
- [x] RED first: all three hook guards failed against baseline with the query
  callback reached before rejection. Logs: `/private/tmp/968-{react,vue,svelte}-red.log`.
- [x] GREEN: reject the removed option before hook resources/query construction.
  Type tests also assert the callback is not advertised.
- [x] Preserve existing successful hook tests without the ignored callback.
- [x] Expand the actual Query DB/React boundary to 36 cells: server page sizes
  1/2/3/5 × UI sizes 1/2/5 × row counts 0/1/8. Each checkpoint compares full
  visible IDs and hasNextPage to an independent array slice.
- [x] Keep eager transport, prefix retention, invalid capped-provider, page-label,
  and explicit-refetch ownership controls. The capped provider violates the
  request protocol; its characterization is not a successful pagination oracle.
- [x] Replace the misleading manual-append pagination example with an on-demand
  fixed-server-page drain example; explain ordering/filter translation,
  cancellation, exhaustion, unlimited loads, and opaque-cursor boundaries.
- [x] Fix the React overview to stop recommending the ignored callback.
- [x] Full React: 220 checks (runtime and type cases), Vue: 96, Svelte: 101.
  Query DB full suite: 195 runtime cases plus its type pass. All GREEN.
  Electric declarations built to satisfy existing cross-package Query DB types.
- [x] Focused lint: no errors or warnings. No core/adapter runtime edits.
- [x] Prepare minor framework changesets and focused PR publication.

Verification logs: `/private/tmp/968-react-full.log`,
`/private/tmp/968-vue-green.log`, `/private/tmp/968-svelte-green.log`,
`/private/tmp/968-query-full.log`, `/private/tmp/968-lint.log`.

Test gap: previous framework tests materialized all rows or supplied the callback
without asserting invocation. The new tests cross the real QueryObserver and
collection/window boundary. They model numeric ascending ID/rank queries only,
not arbitrary endpoint ordering, cursor protocols, retries, or changing datasets.

## Original investigation (historical evidence)

## Work queue

- [x] Read AGENTS and live ARCHITECTURE in full.
- [x] Read report #968 and the current disposition of RFC #1657.
- [x] Read proposed documentation in #1355 without merging it.
- [x] Reproduce eager Query DB + real React useLiveInfiniteQuery behavior.
- [x] Verify the documented on-demand prefix path through the real adapter.
- [x] Cross fixed server page sizes against live-query page growth.
- [x] Identify API decisions and minimal alternatives below.
- [x] Run focused runtime gates and finalize findings (type limits below).
- [x] Parent/user selects API migration vs additional server-page feature.

## Evidence

Seven React integration probes pass on main. They use a real QueryClient,
QueryObserver, Query Collection, live-query compiler/window controller, and
useLiveInfiniteQuery. A separate test fixture evaluates small numeric predicates
with an independent test evaluator, not production expression evaluation.

1. Report shape: eager source initially returns four of eight available rows.
   A page size of two reveals two then four rows. Further fetches do nothing;
   `hasNextPage` is false, QueryFn ran once, `pageParam` is undefined, and the
   supplied `getNextPageParam` callback was never invoked.
2. On-demand provider fulfilling prefix demand: pages grow 2, 4, 6, 8 correctly;
   finite requests have limits 3, 5, 7, 9. Tie requests can also occur. Prior rows
   remain visible across these distinct Query cache entries.
3. A capped provider returning two rows for a limit-three request underfills
   the local window and yields false `hasNextPage` despite eight remote rows.
   This is a deliberately nonconforming adapter, not proof that core can know
   unknown server extent. Main's exact request contract requires fulfilling
   the request (or exhausting that source) before successful settlement.
4. Adapter-local page draining with explicit endpoint `nextPage` works through
   the same actual hook for server page sizes 1, 2, 3, 5. The hook pages remain
   size two; its first request peeks a third row. Later requests use offsets,
   and page-number conversion/draining stays in QueryFn. Core needs no new state.

Why previous tests missed the report: the React hook tests use fully materialized
mock collections. They exercise local peek-ahead, not QueryObserver's transport
context or an endpoint whose page size differs from the requested live window.
The existing test that passes `getNextPageParam` never asserts it runs.

## Minimal coherent options

### A. Clarify existing API and reject or warn on the no-op callback

Recommended scope. Query DB uses QueryObserver, not InfiniteQueryObserver. Its
queryFn receives `meta.loadSubsetOptions`, not a server pageParam. The live hook
widens a local ordered query. `initialPageParam` labels result pageParams; it is
not a server cursor or an initial remote offset.

Document on-demand limit/offset/filter/order translation and show a fixed-page
endpoint adapter that drains to fulfill the requested window, stopping only on
authoritative endpoint exhaustion. Keep arbitrary opaque cursor caching and
resume state inside that adapter. It may need to refetch earlier pages to honor
random offsets or independent queries; that is the honest cost of that endpoint.

Decision needed: remove `getNextPageParam` (pre-1.0 API cleanup plus clear runtime
error for untyped callers) or retain it with a once-per-hook warning. A silent
compatibility option promises more compatibility than exists. It is currently
defined by React, Vue, and Svelte hooks; its comment and generated docs call it a no-op.
No decision is applied in this spike.

Runtime state cost: zero for docs/adapter sample, one warning guard if warning
chosen. A runtime rejection needs no retained state. Test-only cross-package
fixture avoids adding Query dependencies to the React runtime.

### B. New hook/server-page bridge

Not a bug fix to the existing QueryObserver contract. Requires defining which
collection owns cursor history, how independent filters/windows share pages,
restart/invalidation semantics, and how UI hasNextPage maps to remote extent.
An arbitrary query may join/filter/group remote rows; a source's next page is
not necessarily another public result page. This must not be smuggled in as a
boolean or restored coverage registry. No runtime implementation proposed.

## Review of #1355's docs proposal

Useful: on-demand is the recommended alternative; direct writes need an explicit
ownership/refetch policy; function Query keys must distinguish relevant demand.

Do not copy unchanged:

- `staleTime: Infinity` prevents staleness-driven refetch, not explicit refetch,
  invalidation, or configured polling. Those can still replace appended rows.
- `enabled: false` suppresses initial automatic acquisition too, not merely
  later refresh. It needs a separately managed loading path.
- Examples omit orderBy and imply one exact Query cache entry per UI page.
  Real loading can issue prefixes, suffixes, and tie requests; include an
  explicit total order and describe requests rather than promising UI-page keys.
- The adapter must honor filters/order and drain server caps, not simply forward
  limit/offset if the endpoint can silently truncate them.
- Appending with writeInsert fails on duplicate row IDs; writeUpsert can express
  incremental page merging, but a later full-state snapshot still owns removal.

## Boundaries retained

No coverage algebra, outcome registry, new public extent facts, or inferential
claim that a short arbitrary response establishes source exhaustion. The
fixture's nextPage is endpoint-authoritative test data used only inside QueryFn.
The intentionally broken capped-provider probe characterizes missing information;
it must not become a green oracle accepting this provider as correct.

## Verification handoff

From packages/react-db:
`pnpm exec vitest run tests/server-pagination-probe.test.tsx --coverage.enabled=false --maxWorkers=2`
passes all seven probes, no React type errors.

From packages/query-db-collection:
`pnpm exec vitest run tests/server-pagination-boundary.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2`
checks that explicit refetch removes a manually appended eager row despite
staleTime Infinity. Runtime passes. The package-wide type pass is blocked by
unbuilt Electric declarations imported by existing cross-package E2E suites.
A fixture inference error found by that pass was corrected with an explicit
page-response type; no production code changed.

Local builds of db-ivm and db completed. No runtime fix, public API migration,
changeset, commit or PR was made. All probe files and this document are untracked
for parent review; do not stage parent-owned rfc-next-work-plan.md.
