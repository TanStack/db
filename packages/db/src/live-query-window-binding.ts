import { codedMessage, devBuild } from './error-message.js'
import { UnhashableQueryIRError } from './errors.js'
import { getLiveQueryHash } from './live-query-options.js'
import { createLiveQueryCollection } from './query/live-query-collection.js'
import {
  assertLiveQueryWindowManyResult,
  compareLiveQueryWindowDependencies,
  createLiveQueryWindowController,
  getLiveQueryWindowCollectionWarning,
  getLiveQueryWindowInputKind,
  liveQueryWindowMatches,
  normalizeLiveQueryWindowPageSize,
  resolveLiveQueryWindowInput,
  shouldPreserveLiveQueryWindowPageCount,
} from './live-query-window-controller.js'
import type { Collection } from './collection/index.js'
import type { DbClient } from './client.js'
import type { LiveQueryKey } from './live-query-options.js'
import type { LiveQueryWindowController } from './live-query-window-controller.js'

/**
 * Window binding: what one mounted infinite-query hook keeps between updates.
 *
 * Every framework adapter's `useLiveInfiniteQuery` reaches the same decision
 * on each render or reactive rerun. It keeps the binding when nothing changed,
 * replaces only the window controller when the page shape changed, or binds a
 * new window collection when the input changed. A new controller keeps the
 * loaded page count when the old pages still describe the new query.
 * Adapters own only their framework's subscription and disposal of
 * `controller`.
 */

// Live queries created here are cleaned up immediately (0 disables GC).
const WINDOW_COLLECTION_GC_TIME_MS = 1

/** Validated infinite-query page shape. */
export interface LiveQueryWindowPageShape {
  pageSize: number
  /** First result-page label, not a server cursor or remote offset. */
  initialPageParam: number
}

/**
 * Read an infinite-query config's page shape. `getNextPageParam` is rejected:
 * the hook widens an ordered live query and has no server cursor to advance.
 */
export function readLiveQueryWindowPageShape(config: {
  pageSize?: number
  initialPageParam?: number
}): LiveQueryWindowPageShape {
  if (`getNextPageParam` in config) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `getNextPageParam is not supported by useLiveInfiniteQuery. Use an on-demand collection and fulfill meta.loadSubsetOptions in queryFn for server pagination.`
        : codedMessage(246),
    )
  }
  return {
    pageSize: normalizeLiveQueryWindowPageSize(config.pageSize),
    initialPageParam: config.initialPageParam ?? 0,
  }
}

/**
 * When a query input compiles again.
 *
 * - `identity`: when its identity dependencies change by structure, as for a
 *   derived query identity or a `queryKey`.
 * - `dependencies`: when a dependency changes by reference, as for a
 *   dependency list.
 * - `always`: on every update, as for a reactive rerun, which happens only
 *   when something the query reads changed.
 */
export type LiveQueryWindowRecompile = `identity` | `dependencies` | `always`

export interface LiveQueryWindowUpdate extends LiveQueryWindowPageShape {
  /**
   * A supplied live-query Collection, or a callback that returns the query.
   * The binding calls the callback only when it compiles a new window
   * collection, except in `always` mode, where it calls it on every update.
   */
  input: unknown
  /** The query input's identity dependencies. */
  dependencies?: ReadonlyArray<unknown>
  /** Context compared by reference, such as the `DbClient` a query binds to. */
  scope?: unknown
  /** Hydration identity for a client-backed window. */
  client?: DbClient
  queryKey?: LiveQueryKey
  recompile: LiveQueryWindowRecompile
}

export interface LiveQueryWindowBinding extends LiveQueryWindowPageShape {
  /** The supplied Collection; `undefined` for a query input. */
  supplied: Collection<any, any, any> | undefined
  dependencies: ReadonlyArray<unknown> | undefined
  scope: unknown
  collection: Collection<any, any, any>
  /** The transport identity of this binding's initial query window. */
  queryHash: string | undefined
  /** Whether this binding created `collection` from a query. */
  ownsCollection: boolean
  controller: LiveQueryWindowController<any, any>
  /**
   * A developer hint about a newly bound supplied collection's window, for the
   * adapter to print once. Production builds carry none.
   */
  warning: string | undefined
}

/**
 * Bind an infinite-query update. Returns `previous` when it still serves the
 * update; otherwise returns a new binding whose controller the adapter
 * subscribes and later disposes.
 *
 * `uncommitted` is a binding built by an earlier update that never took
 * effect, such as a React render that did not commit. When it answers this
 * update, its window collection is reused instead of compiling another.
 */
export function bindLiveQueryWindow(
  previous: LiveQueryWindowBinding | null,
  update: LiveQueryWindowUpdate,
  uncommitted?: LiveQueryWindowBinding | null,
): LiveQueryWindowBinding {
  // A reactive rerun resolves its input first: a getter may return a
  // supplied Collection.
  const resolved =
    update.recompile === `always`
      ? resolveLiveQueryWindowInput<any>(update.input)
      : undefined
  const supplied =
    resolved === undefined
      ? getLiveQueryWindowInputKind(update.input) === `collection`
        ? (update.input as Collection<any, any, any>)
        : undefined
      : resolved.kind === `collection`
        ? resolved.collection
        : undefined
  const inputKind = supplied ? `collection` : `query`
  const previousKind = previous
    ? previous.supplied
      ? `collection`
      : `query`
    : undefined
  // A snapshot: a caller may change its dependency array in place.
  const dependencies = supplied ? undefined : [...(update.dependencies ?? [])]

  const change = compareUpdate(previous, update, dependencies)
  const needsNewCollection =
    previous === null ||
    previousKind !== inputKind ||
    (supplied ? previous.supplied !== supplied : change.recompile)
  const pageShapeChanged =
    previous === null ||
    previous.pageSize !== update.pageSize ||
    previous.initialPageParam !== update.initialPageParam
  if (!needsNewCollection && !pageShapeChanged) return previous

  const initialPageCount = shouldPreserveLiveQueryWindowPageCount({
    hasPreviousController: previous !== null,
    previousInputKind: previousKind,
    inputKind,
    sameCollection: supplied !== undefined && previous?.supplied === supplied,
    dependenciesChanged: change.dependenciesChanged,
    dependenciesStructurallyEqual: change.dependenciesStructurallyEqual,
    pageShapeChanged,
  })
    ? Math.max(1, previous!.controller.getSnapshot().pages.length)
    : 1
  // The peek-ahead window for every retained page.
  const requiredLimit = initialPageCount * update.pageSize + 1

  let collection = previous?.collection
  let queryHash = previous?.queryHash
  let ownsCollection = previous?.ownsCollection ?? false
  let warning: string | undefined
  if (needsNewCollection) {
    if (
      !supplied &&
      uncommitted?.ownsCollection &&
      !compareUpdate(uncommitted, update, dependencies).recompile &&
      uncommitted.collection.status !== `cleaned-up` &&
      uncommitted.collection.status !== `error` &&
      liveQueryWindowMatches(uncommitted.collection, requiredLimit)
    ) {
      // Nothing has taken effect since the earlier update built this
      // collection, and its window is exactly the retained pages, so its first
      // rows are correct. A collection in terminal error, such as after its
      // source restarted, cannot serve the query again.
      collection = uncommitted.collection
      queryHash = uncommitted.queryHash
      ownsCollection = true
    } else {
      const window = openWindowCollection(
        resolved ?? resolveLiveQueryWindowInput<any>(update.input),
        requiredLimit,
        update,
      )
      collection = window.collection
      queryHash = window.queryHash
      ownsCollection = window.ownsCollection
      warning = window.warning
    }
  }

  return {
    supplied,
    dependencies,
    scope: update.scope,
    pageSize: update.pageSize,
    initialPageParam: update.initialPageParam,
    collection: collection!,
    queryHash,
    ownsCollection,
    controller: createLiveQueryWindowController(collection, {
      pageSize: update.pageSize,
      initialPageParam: update.initialPageParam,
      initialPageCount,
      client: update.client,
      queryHash,
    }),
    warning,
  }
}

/** How an update's query identity differs from a binding's. */
function compareUpdate(
  binding: LiveQueryWindowBinding | null,
  update: LiveQueryWindowUpdate,
  dependencies: ReadonlyArray<unknown> | undefined,
): {
  recompile: boolean
  dependenciesChanged: boolean
  dependenciesStructurallyEqual: boolean
} {
  const comparison = compareLiveQueryWindowDependencies(
    binding?.dependencies,
    dependencies ?? [],
  )
  const scopeChanged = binding?.scope !== update.scope
  const dependenciesChanged =
    scopeChanged ||
    (update.recompile === `identity`
      ? !comparison.structurallyEqual
      : comparison.changed)
  return {
    recompile: update.recompile === `always` || dependenciesChanged,
    dependenciesChanged,
    // An identity that changed differs by structure by definition.
    dependenciesStructurallyEqual:
      !scopeChanged &&
      update.recompile !== `identity` &&
      comparison.structurallyEqual,
  }
}

/**
 * Bind the window collection for a resolved input, starting its sync now when
 * its first published rows are already correct. A created collection's window
 * covers every retained page, so it never publishes fewer rows than the
 * controller's pages; the controller grows it with `setWindow`. A supplied
 * window that the controller must still adjust waits for the subscription.
 */
function openWindowCollection(
  input: ReturnType<typeof resolveLiveQueryWindowInput<any>>,
  requiredLimit: number,
  update: LiveQueryWindowUpdate,
): {
  collection: Collection<any, any, any>
  queryHash: string | undefined
  ownsCollection: boolean
  warning: string | undefined
} {
  const prepared =
    input.kind === `collection`
      ? input.collection
      : { query: input.query.limit(requiredLimit).offset(0) }
  let queryHash: string | undefined
  if (update.client) {
    try {
      queryHash = getLiveQueryHash(prepared, update.queryKey)
    } catch (error) {
      if (!(error instanceof UnhashableQueryIRError) || update.queryKey?.length)
        throw error
    }
  }
  if (input.kind === `collection`) {
    const warning = getLiveQueryWindowCollectionWarning(
      input.collection,
      update.pageSize + 1,
    )
    if (liveQueryWindowMatches(input.collection, requiredLimit)) {
      input.collection.startSyncImmediate()
    }
    return {
      collection: input.collection,
      queryHash,
      ownsCollection: false,
      warning,
    }
  }
  const collection = createLiveQueryCollection({
    query: (prepared as { query: typeof input.query }).query,
    gcTime: WINDOW_COLLECTION_GC_TIME_MS,
  })
  assertLiveQueryWindowManyResult(collection)
  // Like useLiveQuery, start sync during render once the query is valid. A
  // render reads only rows the sources already hold, and sends no request
  // until the subscription attaches.
  collection.startSyncImmediate()
  return { collection, queryHash, ownsCollection: true, warning: undefined }
}
