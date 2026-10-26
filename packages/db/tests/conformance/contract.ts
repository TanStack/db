/**
 * Cross-adapter live-query conformance harness — shared contract.
 *
 * A framework hook is a scheduler-specific view of one live-query contract.
 * The shared suite owns the semantic laws: rows, order, keyed state, readiness,
 * errors, enablement, recompilation, and teardown. Each adapter owns only the
 * bridge from its native scheduler into the small `LiveQueryDriver` language.
 * Running one shared scenario through every bridge separates engine semantics
 * from React, Preact, Vue, Solid, Angular, and Svelte timing.
 *
 * Realm safety: the driver — not the scenarios — creates source collections and
 * supplies query operators, both imported from the *adapter's* copy of
 * `@tanstack/db`. This keeps collection instances and expression nodes in the
 * same module realm as the adapter's hook, avoiding the dual-package
 * `instanceof CollectionImpl` mismatch. Scenarios never import `@tanstack/db`.
 *
 * The model is observational rather than a second hook implementation. Each
 * scenario states a source history and the exact normalized result that must be
 * visible after the driver's documented flush cut. Result helpers read raw
 * fields and selected rows; they do not repair malformed adapter output.
 *
 * Query identity (1.0 law, maintainer decisions 2026-10-22 and 2026-10-23).
 * The law depends on how a binding decides to compile again.
 *
 * A binding that compares query identity re-runs its query input and compiles
 * again only when the input's identity changed. React and Preact compare it
 * on every render. Such a binding compiles an input that has no `queryKey`
 * only when the query IR has a stable identity; otherwise it throws
 * `UnhashableQueryIRError`. The identity names each source by its Collection
 * ID, so while the binding is mounted each claimed ID keeps naming one source
 * object: a different object under a claimed ID, in a later query or in the
 * same one, throws
 * `SourceCollectionIdReuseError` before any row from either source is
 * returned. Revisiting the same object is legal, and a new binding starts with
 * no claims. An input with a nonempty `queryKey` owns its identity and skips
 * both checks: a keyed step records no claim and checks none, so a claim
 * made before it still binds a later derived step (maintainer decision
 * 2026-10-23). An empty key is absent, as it is for a `DbClient` preload.
 *
 * A binding that compiles again whenever its reactive reads change (Vue,
 * Solid, Angular, and Svelte without a `DbClient`) compares no identity. It
 * compiles any query input, including one without a stable IR identity, and
 * its rows follow the current input: after a source swap under the same
 * Collection ID, every value it publishes holds only the new source's rows
 * (or none while it loads) and never the old ones,
 * and one query over two same-ID objects reads each of them.
 * A `DbClient` matches queries by identity hash, so a binding backed by one
 * follows the comparing law; that boundary has its own receiving witnesses.
 *
 * Rejection is observed at the adapter's native compile point. The driver
 * surfaces it as a throw from `mount*`, a rejected `setParam`, or a throw from
 * the next `current()` read. After a rejection, no later read exposes rows:
 * each `current()` throws or holds none, so a framework whose memo throws once
 * cannot fall back to the previous query's rows. Each driver releases any
 * native scope that a rejected mount acquired. A reactive driver rejects
 * after mount when its new input fails to compile, as when a re-render drops
 * `groupKeys()`. Vue's computed serves its previous value after it throws
 * once, so vue-db catches the error in a computed that does not throw and
 * clears its rows before it rethrows; before that repair this check failed
 * there. React unmounts a tree whose render throws, so its driver rethrows
 * on later reads. Preact keeps a component whose render throws mounted, so
 * its driver mounts the hook under an error boundary, as an application must
 * to recover, and rethrows on later reads. A Preact component without a
 * boundary is outside this cut. A `DbClient`-backed Svelte query also stays
 * mounted; the Svelte descriptor release oracle reads each of its fields
 * after a rejection.
 *
 * All current scenarios must pass. A future known bug needs an independently
 * approved exact failure signature; a whole-test waiver could hide another bug.
 */
import type { Collection, PooledLiveQueries } from '@tanstack/db'

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
 * An on-demand source whose Collection readiness lags behind its settled
 * subset demand, as a progressive Electric collection does during its full
 * sync. `syncMode` is `on-demand`. Rows written with `emit` are visible at once,
 * but each `loadSubset` request stays pending until `settle`. The Collection
 * stays `loading` until `markReady`.
 *
 * The readiness law (ARCHITECTURE.md law 10) makes the settled request, not
 * the source's `markReady`, the evidence that a query over this source is
 * initially ready. A binding that waits for `markReady` fails at `settle`.
 */
export interface LaggingSourceHandle<
  T extends { id: string } = Row,
> extends DeferredSourceHandle<T> {
  /** Whether a subset request is pending. */
  loadStarted: () => boolean
  /** Settle every pending subset request. */
  settle: () => void
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
  groupKeys: (callback: (refs: any) => any) => any
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
   * The keyed result map (disabled representation is declared by each driver).
   * Exposed so scenarios can
   * assert the granular map stays in sync with `data` — e.g. that stale keys
   * from a previous collection don't linger after a recompile.
   */
  state: ReadonlyMap<any, any> | undefined
  status: string
  isReady: boolean
  persistedStatus?: string
  isPersistedReady?: boolean
  persistedError?: unknown
  isError: boolean
  isEnabled: boolean
}

/** A query-builder callback, e.g. `(q) => q.from({ items: source.collection })`. */
export type QueryBuild = (q: any) => any

/** A mounted live query under test. */
export interface LiveQueryHandle {
  current: () => ConformanceResult
  /** The live-query Collection currently backing this result. */
  collection: () => Collection<any, any, any> | null
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
  /** Rejects when the adapter rejects the reconfigured query input. */
  setParam: (param: P) => Promise<void>
  /**
   * The `data` value the binding left published at the end of each
   * synchronous turn since mount, in order. Drivers record at their
   * framework's publication points (React and Preact commits, Vue pre-flushes,
   * Svelte pre-effects, Solid render effects, Angular effects) through
   * `publication-log.ts`, which keeps the last value of each turn: a value
   * replaced within one turn is never painted. A law about what a swap may
   * show reads these, not only the value after `setParam` settles.
   */
  publications: () => ReadonlyArray<unknown>
  /**
   * The keyed `state` map's rows at the same publication points. A binding
   * that applies row changes to its map can show rows there that `data`
   * never holds.
   */
  statePublications: () => ReadonlyArray<unknown>
}

/**
 * Shared live-query binding law: an enabled array query exposes row data from
 * its live-query Collection; `findOne` exposes one row or `undefined`. A
 * disabled callback has no live-query Collection, reports `disabled` status,
 * and exposes the adapter's declared `absent` or `empty-reactive` public result.
 *
 * Each adapter implements this driver through its real public hook. `flush`
 * defines the observation cut after framework updates and core sync settle.
 * The runtime suite observes public result data, state, and status. Framework
 * type inference and framework scheduler internals are outside this contract.
 */
export interface LiveQueryDriver {
  name: string
  /** Public disabled data/state policy, not inferred from observed output. */
  disabledRepresentation: `absent` | `empty-reactive`
  /** Operators from the adapter's `@tanstack/db` realm. */
  ops: DbOps
  /**
   * Create a realm-correct source collection + mutators, keyed by `id`. Pass
   * `collectionId` to create another source object under an existing ID.
   */
  makeSource: <T extends { id: string }>(
    initialData: ReadonlyArray<T>,
    collectionId?: string,
  ) => SourceHandle<T>
  /** Create a source that starts `loading` and readies on demand (keyed by `id`). */
  makeDeferredSource: <T extends { id: string }>() => DeferredSourceHandle<T>
  /** Create an on-demand source that lags behind its settled subset (keyed by `id`). */
  makeLaggingSource: <T extends { id: string }>() => LaggingSourceHandle<T>
  /**
   * Create a pre-built live-query collection to pass straight to the hook.
   * `startSync: false` yields a not-yet-syncing collection (isReady false).
   */
  makePrecreated: (
    build: QueryBuild,
    opts?: { startSync?: boolean; gcTime?: number },
  ) => { collection: Collection<any, any, any> }
  /** Create a source whose sync fails, driving it into `error` status. */
  makeErrorSource: () => {
    collection: Collection<any, any, any>
    expectedError: Error
    startup: { returned: true } | { returned: false; error: unknown }
  }
  /** Mount a live query from a query-builder callback. */
  mount: (build: QueryBuild) => LiveQueryHandle
  /**
   * Mount a live query whose input depends on a parameter that can change after
   * mount. `build` returns a query, or `null`/`undefined` to represent disabled.
   * With `pool`, use the adapter's config form for a parameterized query.
   */
  mountControllable: <P>(
    build: (q: any, param: P) => any,
    initial: P,
    opts?: { pool?: PooledLiveQueries },
  ) => ControllableHandle<P>
  /**
   * Mount a controllable query in the config-object form whose `queryKey` is
   * `key(param)`, or none when that returns `undefined`. Every driver that
   * compares query identity supplies it; a reactive binding has no keys.
   */
  mountKeyedControllable?: <P>(
    build: (q: any, param: P) => any,
    key: (param: P) => ReadonlyArray<unknown> | undefined,
    initial: P,
  ) => ControllableHandle<P>
  /** Mount a pre-created collection passed directly to the hook. */
  mountCollection: (collection: Collection<any, any, any>) => LiveQueryHandle
  /** Mount via the config-object input form (`{ query: build, ...opts }`). */
  mountConfig: (
    build: QueryBuild,
    opts?: {
      gcTime?: number
      pool?: PooledLiveQueries
      queryKey?: ReadonlyArray<unknown>
    },
  ) => LiveQueryHandle
  /** Mount an explicitly-disabled query (adapter's own null/undefined form). */
  mountDisabled: () => LiveQueryHandle
  /**
   * Whether the binding compares query identity to decide when to compile
   * again (see the opening query-identity law). The driver declares the
   * adapter's documented policy for the inputs it mounts; the suite does not
   * infer it from observed output. Svelte compares identity only for a query
   * that a `DbClient` backs, and its shared drivers mount none, so they
   * declare `false`.
   */
  comparesQueryIdentity: boolean
  /** No active waivers. Kept empty in drivers to make this boundary explicit. */
  knownGaps?: ReadonlyArray<never>
  /**
   * How the adapter surfaces a query error (see the `error-status` scenario):
   * - `flag` (default): a readable `isError`/`status === 'error'` on the result.
   * - `throw`: reading the errored result throws, for a framework error boundary
   *   to catch (e.g. Solid's `createResource`/`<ErrorBoundary>` model).
   */
  errorSurface?: `flag` | `throw`
  features?: {
    serverSnapshot?: boolean
    suspense?: boolean
    /**
     * Public sharing policy: queries whose config passes `pooledLiveQueries`
     * and that filter only by `eq` on one source share one source subscription
     * per filtered field set, instead of one each. Every other query has a
     * subscription of its own: pooling is opt-in per query.
     */
    pooledEqFilters?: boolean
  }
}
