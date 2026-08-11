/**
 * Cross-adapter live-query conformance harness — shared contract.
 *
 * ONE behavioral spec for `useLiveQuery`, run against every framework adapter.
 * Each adapter provides a thin `LiveQueryDriver` and the shared suite in
 * `suite.ts` does the rest.
 *
 * Realm safety: the driver — not the scenarios — creates source collections and
 * supplies query operators, both imported from the *adapter's* copy of
 * `@tanstack/db`. This keeps collection instances and expression nodes in the
 * same module realm as the adapter's hook, avoiding the dual-package
 * `instanceof CollectionImpl` mismatch. Scenarios never import `@tanstack/db`.
 *
 * Expected-fail policy: `knownGaps` lists scenario KEYS this adapter does not
 * yet satisfy. Populate it EMPIRICALLY — port a behavior, run it, and only add
 * the key if it actually fails. The behavior matrix tells you where to look;
 * the test run tells you what's broken. When a gap closes, `it.fails` errors
 * ("expected to fail but passed") prompting you to delete the key.
 */
import type { Collection } from '@tanstack/db'

/** Default row shape used by the base scenarios (a "person"). */
export interface Row {
  id: string
  name: string
  age: number
  team: string
}

/**
 * A realm-correct source collection plus sync-driven mutators. Generic over the
 * row type so relational scenarios (join, includes) can build differently-shaped
 * related collections; keyed by `id` in every case.
 */
export interface SourceHandle<T extends { id: string } = Row> {
  collection: Collection<any, any, any>
  insert: (row: T) => void
  update: (row: T) => void
  remove: (row: T) => void
}

/**
 * A source whose readiness the scenario controls, for loading/eager/ready
 * transitions. Starts in `loading` (synced, not ready) so scenarios can `emit`
 * rows while still loading and then `markReady`.
 */
export interface DeferredSourceHandle<
  T extends { id: string } = Row,
> extends SourceHandle<T> {
  /** Write rows without marking ready — exercises the eager (visible-while-loading) path. */
  emit: (rows: ReadonlyArray<T>) => void
  /** Transition the source from `loading` to `ready`. */
  markReady: () => void
}

/**
 * The subset of `@tanstack/db` query operators scenarios need, supplied by the
 * driver from the adapter's realm. Grows as engine scenarios are ported.
 */
export interface DbOps {
  eq: (a: any, b: any) => any
  gt: (a: any, b: any) => any
  count: (a: any) => any
  sum: (a: any) => any
  coalesce: (...args: Array<any>) => any
  /** Build an optimistic action: onMutate applies optimistic state, mutationFn confirms. */
  createOptimisticAction: (config: {
    onMutate: (variables: any) => void
    mutationFn: (variables: any) => Promise<any>
  }) => (variables?: any) => { isPersisted: { promise: Promise<any> } }
}

/** Normalized, adapter-agnostic view of a live query's current result. */
export interface ConformanceResult {
  /** Array for list queries; a single row (or undefined) for `findOne`. */
  data: any
  /**
   * The keyed result map (`undefined` when disabled). Exposed so scenarios can
   * assert the granular map stays in sync with `data` — e.g. that stale keys
   * from a previous collection don't linger after a recompile.
   */
  state: ReadonlyMap<any, any> | undefined
  status: string
  isReady: boolean
  isError: boolean
  isEnabled: boolean
}

/** A query-builder callback, e.g. `(q) => q.from({ items: source.collection })`. */
export type QueryBuild = (q: any) => any

/** A mounted live query under test. */
export interface LiveQueryHandle {
  current: () => ConformanceResult
  /** Let the framework scheduler + core sync settle, then resolve. */
  flush: () => Promise<void>
  /**
   * Run a state-mutating callback inside the framework's update scope, then
   * settle (React `act`, Vue `nextTick`, Svelte `flushSync`, Solid `batch`).
   * Needed when a mutation notifies synchronously, e.g. optimistic actions.
   */
  apply: (fn: () => void) => Promise<void>
  unmount: () => void
}

/**
 * A mounted query whose input parameter can change after mount, for
 * recompilation and disabled/enabled transitions. `setParam` re-renders with the
 * new value and settles.
 */
export interface ControllableHandle<P> extends LiveQueryHandle {
  setParam: (param: P) => Promise<void>
}

/** What each adapter package implements and hands to `runSuite`. */
export interface LiveQueryDriver {
  name: string
  /** Operators from the adapter's `@tanstack/db` realm. */
  ops: DbOps
  /** Create a realm-correct source collection + mutators, keyed by `id`. */
  makeSource: <T extends { id: string }>(
    initialData: ReadonlyArray<T>,
  ) => SourceHandle<T>
  /** Create a source that starts `loading` and readies on demand (keyed by `id`). */
  makeDeferredSource: <T extends { id: string }>() => DeferredSourceHandle<T>
  /**
   * Create a pre-built live-query collection to pass straight to the hook.
   * `startSync: false` yields a not-yet-syncing collection (isReady false).
   */
  makePrecreated: (
    build: QueryBuild,
    opts?: { startSync?: boolean },
  ) => { collection: Collection<any, any, any> }
  /** Create a source whose sync fails, driving it into `error` status. */
  makeErrorSource: () => { collection: Collection<any, any, any> }
  /** Mount a live query from a query-builder callback. */
  mount: (build: QueryBuild) => LiveQueryHandle
  /**
   * Mount a live query whose input depends on a parameter that can change after
   * mount. `build` returns a query, or `null`/`undefined` to represent disabled.
   */
  mountControllable: <P>(
    build: (q: any, param: P) => any,
    initial: P,
  ) => ControllableHandle<P>
  /** Mount a pre-created collection passed directly to the hook. */
  mountCollection: (collection: Collection<any, any, any>) => LiveQueryHandle
  /** Mount via the config-object input form (`{ query: build }`). */
  mountConfig: (build: QueryBuild) => LiveQueryHandle
  /** Mount an explicitly-disabled query (adapter's own null/undefined form). */
  mountDisabled: () => LiveQueryHandle
  /** Scenario keys this adapter is empirically known NOT to satisfy yet. */
  knownGaps?: ReadonlyArray<string>
  /**
   * How the adapter surfaces a query error (see the `error-status` scenario):
   * - `flag` (default): a readable `isError`/`status === 'error'` on the result.
   * - `throw`: reading the errored result throws, for a framework error boundary
   *   to catch (e.g. Solid's `createResource`/`<ErrorBoundary>` model).
   */
  errorSurface?: `flag` | `throw`
  features?: { serverSnapshot?: boolean; suspense?: boolean }
}
