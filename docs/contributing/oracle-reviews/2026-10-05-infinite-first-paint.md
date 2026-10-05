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
