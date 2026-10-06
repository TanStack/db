# Infinite-query first-paint oracle

- Reviewed semantic commit: `415a8d4a1ee0b950eca6f06f25c250adab05a15d`
- Comparison main: `987f6ca0dfc404de8c76bd8c2b840421cc26311e`
- Owner: `packages/db/tests/conformance/infinite-suite-oracle.ts`, scenario `[first-paint-ready]`
- Supporting contract: `packages/db/tests/conformance/infinite-contract.ts` (`InfiniteQueryObservedHandle.firstPaint`, `mountObserved`)
- Per-driver recorders: React `packages/react-db/tests/infinite-query-conformance.test.tsx`, Vue `packages/vue-db/tests/infinite-query-conformance.test.ts`, Svelte `packages/svelte-db/tests/infinite-query-conformance.svelte.test.ts`
- Independent cross-hook reference: `packages/react-db/tests/infinite-query-first-commit-parity.test.tsx`
- Runtime: local Node, Vitest. React ran in full. Vue and Svelte ran before the rebase and again under per-framework spot checks. CI runs every package suite.

## New term

This change introduces the observation term **first paint**. A first paint is
the first value a framework binding publishes to its consumer after mount. The
term is not in the project glossary yet. Each driver records the first paint
through its own native commit hook, because the frameworks reach it through
different cuts:

- React records every layout commit and keeps the first. `current()` cannot
  serve the law, because React can coalesce the idle commit before `renderHook`
  returns.
- Vue reads the hook result immediately after setup. Its `watchEffect` with
  `flush: 'sync'` already subscribed and produced the first value.
- Svelte reads the construction snapshot before `flushSync`, which is its first
  render value, ahead of the subscribing `$effect`.

The term describes a cross-framework observation. It does not combine or split a
production concept.

## Requirement outcomes

| Requirement | Result |
| --- | --- |
| ORC-001 | Pass. The law: for a synchronously loaded source, `useLiveInfiniteQuery` shows the ready first page on the first paint, with no empty idle paint before data. Limit: synchronous eager sources and the query-callback input form. The recorder observes a framework commit value, not a browser paint. |
| ORC-002 | Pass. The expected first page `['1','2','3']` comes from the source rows and the `orderBy(rank desc)` plus `pageSize` arguments, independent of the hook output. The parity test adds `useLiveQuery` as a documented prior-behavior reference. Neither reads the controller snapshot logic to compute the expectation. |
| ORC-003 | Pass. The scenario prose states the law and why `current()` cannot observe it. The contract comment states the first-paint obligation and the per-framework cut. The driver records the real hook; the checkpoint reads `firstPaint()` after flush. |
| ORC-004 | Not applicable. The trigger is a generated property that claims history coverage. This is a fixed example scenario over one synchronous source. It makes no generated-history coverage claim. |
| ORC-005 | Pass. Each driver mounts the real framework hook and records the real first paint through the framework commit hook, then flushes to `ready`. The checkpoint is the first recorded paint. |
| ORC-006 | Pass. Mutant calibration: reverting React or Svelte to `startSync: false` makes `[first-paint-ready]` fail at the first-paint checkpoint with `{ status: 'idle', ids: [] }`. This is an assertion failure at the intended checkpoint, not a setup error. The fixed `startSync: true` passes. |
| ORC-007 | Not applicable. The trigger is an important generated property. This scenario has no random campaign. Direct replay is running the named `[first-paint-ready]` scenario in each driver package. |
| ORC-008 | Not applicable. The change adds no production state and no stateful model. `firstPaint()` is a single test-only observation; it does not introduce, remove, combine, or split a modeled state. |
| ORC-009 | Pass. The one new term is "first paint", declared above with its per-framework mapping. No production concept is combined or split. |
| ORC-010 | Pass. The React recorder keeps the first observed commit and throws when no commit was observed, so it cannot silently report an empty paint. Cleanup uses the suite's existing `track()` and lifetime teardown; it does not replace the assertion. |
| ORC-011 | Pass. The parity test is an independent second formulation: it asserts that `useLiveQuery` and `useLiveInfiniteQuery` agree on the first commit for the same synchronous source. No further distinct semantic classifier was identified. |
| ORC-012 | Pass. This versioned record accounts for ORC-001 through ORC-014 at the reviewed semantic commit above. The pull-request description alone did not satisfy this requirement. |
| ORC-013 | Pass. The scenario protects a reusable cross-framework boundary law. The distinguishing witness is the mutant: `startSync: false` fails for React and Svelte at the first-paint checkpoint, while the fix passes. Vue's distinct sync-subscribe cut stays green under both, which the law allows. |
| ORC-014 | Not applicable. No controlled provider or host supplies a premise. The source is a standard synchronous mock collection shared with the rest of the suite. |

## Bug-class closure

The claim is bounded, not universal.

- Boundary. Contract: ready first page on the first paint for a synchronous
  source. History: mount of a query-form `useLiveInfiniteQuery` over a
  synchronous eager source, plus React dependency replacement. Production path:
  the React, Vue, and Svelte hooks that build the live-query window collection.
  Observation: the first paint status and first-page ids.
- Distinguishing witnesses. Original: `startSync: false` yields an idle first
  paint for React and Svelte. Adjacent: Vue's `watchEffect({ flush: 'sync' })`
  yields a ready first paint even with `startSync: false`, which shows the law
  constrains the observable first paint, not the flag.
- Rejected wrong design. `startSync: false`, the production defect, is rejected
  at the first-paint checkpoint for React and Svelte.

Unresolved in-scope cells remain open under the owner above:

- Pre-created collection input form, rather than the query callback.
- Suspense, concurrent, or StrictMode first paint.

Out-of-scope cells, where an empty or loading first paint is correct:

- Asynchronous or on-demand sources that are not yet loaded.
- `dbClient`-materialized sources whose sync is deferred to commit.

## Verification

- react-db: the full suite passed locally (330 tests), including this scenario
  and the mutant run.
- Vue and Svelte: `[first-paint-ready]` and the package suites passed under spot
  checks. I could not re-run them against the latest `main` locally, because the
  sandbox npm proxy returned 403 for unrelated security-bumped dependencies. CI
  runs every package suite.
- This record does not mark any CI check green.

## Addendum: duplicate pre-commit render fix

A follow-up review found a regression from `startSync: true`: because the hooks
built a new collection per render and only recorded it at commit, a duplicate
pre-commit render (React StrictMode, a discarded concurrent render, or a
Suspense retry) started a second collection and loaded an on-demand source's
first page twice. `useLiveQuery` avoids this with a render-time instance memo
(its pool excludes window and on-demand queries, so the pool is not the cause).

Fix: React now records each render's state in a render-time ref and reuses it
when every identity input matches, while committed state is still recorded at
subscribe so an abandoned render cannot overwrite preserved pages. Svelte's
`$derived` controller now reuses the previous controller when nothing that
defines it changed, instead of rebuilding on every recompute.

Regression: `packages/react-db/tests/infinite-query-strictmode-dedup.test.tsx`
mounts an on-demand source under StrictMode and asserts the first peek-ahead
window loads once. It fails (two loads) when the memo is recorded only at
commit, and passes with the render-time reuse. This closes the StrictMode part
of the previously unresolved cell. The pre-created-collection input form and
Suspense or concurrent first paint remain open under the owner above.

A later review found that the React reuse could bind a collection that GC had
already cleaned up. A committed component keeps its refs across a suspended
update, so the update's uncommitted collection survived to the retry, and the
retry committed an empty `cleaned-up` page before recovering. The reuse now
requires a collection that is not `cleaned-up`.
`packages/react-db/tests/infinite-query-stale-reuse.test.tsx` covers both a
fresh-mount retry and a mounted suspended update after GC. The mounted-update
case fails without the liveness check and passes with it.

## Addendum: start-sync gate replaces render-time reuse

A further review found that the two reuse mechanisms above caused new
defects. In Svelte, the reuse guard returned the previous controller when the
`deps` getters were unchanged, so the hook ignored reactive state read directly
inside the query callback. In React, `renderedRef` could keep a stale page
count. It did not dedupe React 18 StrictMode renders, and it duplicated the
identity rules.

Both mechanisms are removed. The duplicate page requests came only from
on-demand sources, which load asynchronously and gain nothing from an early
start. `canStartLiveQueryWindowSyncInRender` now starts sync during render only
when no source collection is on-demand. Eager sources keep the ready first
paint. On-demand queries start when the subscription commits.

Evidence at this change:

- `infinite-query-strictmode-dedup.test.tsx` passes with one first-page load.
  It fails with two loads when the gate always starts sync.
- `useLiveInfiniteQuery.svelte.test.ts` adds a test where state read inside the
  query callback, with no deps, rebuilds the query. It fails with the removed
  Svelte guard and passes now.
- `infinite-query-stale-reuse.test.tsx` passes. A retry after GC binds a live
  collection and shows the ready first page.
- Local suites passed: react-db 333, vue-db 121, svelte-db 118, and the db
  infinite calibration 9.

Known limit: an eager collection started during render has only the 50 ms
unsubscribed GC floor before its commit. If a commit arrives later than that,
GC may clean the collection up first. `useLiveQuery` shares this exposure. No
test reaches this case.

## Addendum: nested on-demand sources and retained-page windows

A review of `725e37a28ac81e3d5041d990eb4abeebedc60399` reproduced two
regressions from starting sync in render:

- The start gate read only a query's immediate sources. A live-query
  Collection does not copy its sources' sync mode, so an on-demand source
  behind one passed the gate. An abandoned React Suspense render then sent a
  page request. The gate now follows each live-query Collection to the sources
  it reads.
- A dependency replacement that keeps page depth built its collection with a
  one-page window and started it in render. React committed a `ready` result
  with fewer rows than the retained pages and `hasNextPage: false`, then
  corrected it. React and Svelte now size the new window for every retained
  page.

Evidence, produced on the working tree above that commit:

- `packages/react-db/tests/infinite-query-render-start.test.tsx` has three
  tests. A wrapped on-demand source gets no acquisition from an abandoned
  render, and a committed control acquires it. Every ready commit after an
  equal dependency replacement keeps all retained rows and continuation.
- Mutants: without the nested walk, only the abandoned-render test fails. With
  a one-page window, only the retained-pages test fails.
- `useLiveInfiniteQuery.svelte.test.ts` checks that no on-demand source, direct
  or wrapped, is acquired at construction or by a superseded recompute before
  the subscribing effect runs, and that one is acquired after it runs. Against
  a `db` build without the nested walk, the wrapped case loaded once at
  construction.
- Local suites: react-db 336, vue-db 121, svelte-db 119, and the db infinite
  calibration 9.

Svelte's retained-page window was fixed by the same rule, but no test observes
an intermediate Svelte value. The coverage map lists that cell.

## Addendum: publication laws in the shared oracle

This entry moves the laws found in the earlier reviews into the shared
infinite-query suite where they are framework-independent, and leaves only
pre-commit work to the drivers.

| Law | Owner |
| --- | --- |
| A synchronous source's first published value is ready with the first page. | Shared `first-paint-ready` |
| Every ready value in a fixed-source, fixed-query scenario equals the source prefix for its own page count, with matching pages and continuation. | Shared, in 11 scenarios including `equal-dependency-depth` and `circular-dependency` |
| A mount requests an on-demand first window once. | Shared `on-demand-paging` |
| A render that never commits, or a superseded pre-commit recompute, does not acquire an on-demand source, direct or wrapped; commit does. | React `infinite-query-render-cuts.test.tsx`, Svelte hook tests |
| A StrictMode double render requests an on-demand first window once. | React render cuts |
| After GC reclaims an abandoned render's collection, the retry's first commit is the ready first page. | React render cuts |

Each shared handle now records every value its framework published, which
replaces the single first-paint recorder. Pre-commit work stays in drivers,
because Vue's setup is its commit.

Evidence, produced on the working tree above `0f0e05cbb`:

- With a one-page replacement window, `equal-dependency-depth` and
  `circular-dependency` fail in React and in Svelte. The Svelte half of the
  retained-page regression was real; no earlier test could observe it.
- With `startSync: false`, `first-paint-ready` fails in React and Svelte.
- In the React render-cuts file, removing the nested walk fails only the
  wrapped abandoned-render test. Starting every source in render also fails the
  StrictMode test.
- The four React-only files from earlier entries are merged into one. Their
  retained-page test is dropped, because the shared law covers it in every
  driver.
- Local suites: react-db 335, vue-db 121, svelte-db 119, and the db infinite
  calibration 9.

A probe found one more open cell. A supplied collection that has not started
publishes an idle first value in React and Svelte, and a ready one in Vue.
`useLiveQuery` starts a supplied collection in render. The infinite hook does
not, and a React test requires that an abandoned render leave a supplied
collection unsubscribed. Closing this cell changes that contract, so it is
recorded for decision rather than changed here.

## Addendum: supplied collections match useLiveQuery

Decision: the maintainer chose to make `useLiveInfiniteQuery` behave like
`useLiveQuery` for a supplied collection, and to reverse the rule from #1675
that no supplied collection starts before commit. That rule came from a #1675
review, which asked that collection construction be inert so that a render
that never commits leaves no resources behind. This PR keeps the purpose of
that rule with two safeguards: GC reclaims an abandoned start, and on-demand
sources still wait for commit. The contract test
`does not activate a supplied collection for an abandoned render` is replaced
by `reclaims a supplied collection that an abandoned render started`.

A supplied collection starts during render only when no source behind it is
on-demand and its window already holds the requested rows from offset 0. A
shifted or narrower window waits for the controller to adjust it at commit.
Both hooks now validate a query or collection before starting it, so a
rejected `.findOne()` query never reads its source.

Evidence, produced on the working tree above `083247d18`:

- The shared `first-paint-ready-collection` scenario failed in React and
  Svelte with an idle first value, and passed in Vue, before the change. All
  three drivers pass after it.
- `collection-window-normalization` now checks every ready value. A supplied
  gate that ignores the window fails it.
- A supplied gate that ignores on-demand sources fails the supplied-input case
  of the React render-cuts abandoned-render test.
- `findone-runtime` now requires an unread source. Starting before validation
  fails it with two subscribers.
- `live-query-window-controller.test.ts` adds a controlled-premise witness for
  a commit that arrives after the 50 ms GC floor. The collection is cleaned up
  first, and subscribing restarts it without publishing a non-ready value. A
  restart guard that skips cleaned-up collections fails it. Delivering the
  subscribe handshake's publications to the listener does not. The witness
  drives the controller directly, because a test DOM cannot hold a React
  commit, so it does not prove React scheduling.
- The walk from a live-query Collection to its sources is one shared helper,
  `everySourceCollection`, which the observer's persisted-readiness check also
  uses.
- Local suites: react-db 338, vue-db 122, svelte-db 120, and the full db suite
  of 8267 tests.

Still open: an on-demand source that loads synchronously publishes ready
first in `useLiveQuery` and idle first in `useLiveInfiniteQuery`, because the
infinite hook defers on-demand sources to commit. The two hooks differ there
until that choice is made. With a DbClient, a source that is first created
during render waits for commit in both hooks, by the deferral contract from
#1564.

## Addendum: on-demand sources follow useLiveQuery

Decision: the maintainer chose that `useLiveInfiniteQuery` follow
`useLiveQuery` for on-demand sources too, unless that is plainly wrong. The
two rules conflict for an on-demand source. Ready on the first paint needs a
request during render, and no request before commit forbids one.
`useLiveQuery` starts on-demand sources in render, so the infinite hook now
does too. The start gate is removed, and the law that a render that never
commits sends no on-demand request is retired. A parity law replaces it: under
the same history, the infinite hook acquires an on-demand source as often as
`useLiveQuery` does, and commits the same first value.

Two parts of `useLiveQuery` were matched in substance, not copied:

- `useLiveQuery` dedupes a React 19 StrictMode double render with a
  render-time instance memo. The infinite hook now keeps the window collection
  from its latest render and reuses it when the query identity matches, the
  collection is not `cleaned-up`, and its window holds the retained pages. It
  keeps only the collection. Each render still builds its own controller and
  page count from committed state. One identity rule serves both the committed
  and the rendered baseline.
- A supplied collection starts in render as in `useLiveQuery`, but only when
  its window already holds the requested rows from offset 0. Starting a
  shifted or narrower window would publish the wrong rows first, which breaks
  the ready-value law.

Evidence, produced on the working tree above `e6a31f6eb`:

- Before the change, an on-demand source that loads synchronously committed
  ready first in `useLiveQuery` and idle first in the infinite hook. With the
  gate removed alone, a StrictMode mount sent two first-window requests in the
  infinite hook and one in `useLiveQuery`. With the memo, both send one, and
  both send the same count for an abandoned render.
- React `infinite-query-render-cuts.test.tsx` compares both hooks for an
  abandoned render with a direct source, a wrapped source, and a supplied
  collection, and for a StrictMode mount. Deferring query collections to
  commit fails the abandoned-render and StrictMode cases. Deferring supplied
  collections fails the supplied case. Removing the memo fails the StrictMode
  case. Removing the memo's liveness check fails the mounted suspended-update
  retry with a `cleaned-up` commit.
- `useLiveInfiniteQuery.svelte.test.ts` compares settled acquisition counts
  with Svelte's `useLiveQuery` after construction and a superseded recompute,
  for direct and wrapped sources. Deferring query collections fails it and
  Svelte `first-paint-ready`. The two hooks issue their requests at different
  moments inside the same tick; only the settled count is compared.
- Local suites: react-db 337, vue-db 122, svelte-db 120, and the full db suite
  of 8267 tests.

Remaining exposure, shared with `useLiveQuery` by this decision: a render that
never commits, including a Suspense render that throws, sends on-demand
requests. On React 18, StrictMode does not keep refs across the double render,
so both hooks send two first-window requests there. Removing early on-demand
requests from both hooks needs a change in the live-query Collection itself.

## Revision index

Each entry's evidence applies to the revision named here. The first section's
table and closure apply to `415a8d4a1`.

| Entry | Revision |
| --- | --- |
| Record and requirement outcomes | `415a8d4a1` (record added in `1c74a335d`) |
| Duplicate pre-commit render fix | `a4af6a251` |
| Cleaned-up reuse liveness check | `fc5f136a5` |
| Start-sync gate replaces render-time reuse | `b31b84ff9` |
| Nested on-demand sources and retained-page windows | `2b461f8cd` |
| Publication laws in the shared oracle | `083247d18` |
| Supplied collections match useLiveQuery | `e6a31f6eb` |
| On-demand sources follow useLiveQuery | the commit that adds this entry, on top of `e6a31f6eb` |
