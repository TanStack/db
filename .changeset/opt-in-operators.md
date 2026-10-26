---
'@tanstack/db': minor
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
'@tanstack/vue-db': patch
'@tanstack/solid-db': patch
'@tanstack/angular-db': patch
---

Breaking: grouping, includes, and pooling are now opt-in. An app bundles an operator's code only when it imports the value for that operator. Joins do not change. A typical app is about 7.5 kB smaller after gzip. This app has a query collection, a filtered live query, and React `useLiveQuery`.

- An include needs `include()`, `toArray()`, or `materialize()`. Change `issues: q.from(...)` in `select()` to `issues: include(q.from(...))`. A subquery in `select()` without one of these throws `IncludeOperatorRequiredError`.
- Aggregates such as `count()` need no change. A `groupBy` with no aggregate takes `groupKeys()`: `.groupBy(groupKeys(({ todo }) => todo.status))`. Without it, the query throws `GroupingOperatorRequiredError`.
- Hooks do not pool live queries by default. To share one partition among many equality-filtered queries, pass `pool: pooledLiveQueries` in the hook's query config: `useLiveQuery({ query, pool: pooledLiveQueries })`. Results do not change. Angular's `{ params, query }` form takes `pool` the same way. For adapter authors: the `pool` option of `resolveLiveQueryValue` is now `pooledLiveQueries` or `false`, not a boolean.
- Code that builds query IR by hand must supply the operator code. `IR.Aggregate` takes `groupingCompiler` as its third argument. `IR.IncludesSubquery` takes `includesRuntime` as its fifth argument, before `parentFilters`. Import both from `@tanstack/db`. Queries that the query builder builds need no change.
