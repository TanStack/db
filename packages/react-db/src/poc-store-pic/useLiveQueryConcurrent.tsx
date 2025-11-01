import {
  createContext,
  memo,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import {
  BaseQueryBuilder,
  CollectionImpl,
  createLiveQueryCollection,
} from "@tanstack/db"
import type {
  Collection,
  CollectionConfigSingleRowOption,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from "@tanstack/db"
import { CollectionStore, CollectionSnapshot } from "./CollectionStore"
import { StoreManager } from "./StoreManager"

const DEFAULT_GC_TIME_MS = 1

export type UseLiveQueryStatus = CollectionStatus | `disabled`

// ============================================================================
// Context and Provider
// ============================================================================

const storeManagerContext = createContext<StoreManager | null>(null)

/**
 * An awkward kludge which attempts to signal back to the stores when a
 * transition containing store updates has been committed to the React tree.
 */
const CommitTracker = memo(
  ({ storeManager }: { storeManager: StoreManager }) => {
    const [allSnapshots, setAllSnapshots] = useState(
      storeManager.getAllCommittedSnapshots()
    )

    useEffect(() => {
      const unsubscribe = storeManager.subscribe(() => {
        const allSnapshots = storeManager.getAllPendingSnapshots()
        setAllSnapshots(allSnapshots)
      })
      return () => {
        unsubscribe()
        storeManager.sweep()
      }
    }, [storeManager])

    useLayoutEffect(() => {
      storeManager.commitAllSnapshots(allSnapshots)
    }, [storeManager, allSnapshots])

    return null
  }
)

/**
 * Provider that enables concurrent-safe store behavior
 * Wrap your app (or subtree) with this to use useLiveQueryConcurrent
 */
export function CollectionStoreProvider({ children }: { children: ReactNode }) {
  const [storeManager] = useState(() => new StoreManager())
  return (
    <storeManagerContext.Provider value={storeManager}>
      <CommitTracker storeManager={storeManager} />
      {children}
    </storeManagerContext.Provider>
  )
}

// ============================================================================
// Core Hook: useCollectionStore
// ============================================================================

/**
 * Tearing-resistant hook for consuming a Collection using the store pic pattern
 *
 * Attempts to avoid tearing where the application state is updating as
 * part of a transition and a sync state change causes a new component to mount.
 *
 * Implementation notes:
 * - Mounts with the pending/transition snapshot initially
 * - Fixes up to committed snapshot in useLayoutEffect if mounting sync
 * - Schedules a transition update if mounting mid-transition
 */
function useCollectionStore<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  store: CollectionStore<TResult, TKey, TUtils>
): CollectionSnapshot<TResult, TKey> {
  const storeManager = useContext(storeManagerContext)
  if (storeManager == null) {
    throw new Error(
      "Expected useCollectionStore to be rendered within a CollectionStoreProvider."
    )
  }

  const previousStoreRef = useRef(store)
  if (store !== previousStoreRef.current) {
    throw new Error(
      "useCollectionStore does not currently support dynamic stores"
    )
  }

  // Counterintuitively we initially render with the transition/pending snapshot
  // instead of the committed snapshot. This is required in order for us to
  // handle the case where we mount as part of a transition which is actively
  // changing the state we observe. In that case, if we _don't_ mount with the
  // pending snapshot, there's no place where we can schedule a fixup which
  // will get entangled with the transition that is rendering us. React forces
  // all setStates fired during render into their own lane, and by the time
  // our useLayoutEffect fires, the transition will already be completed.
  //
  // Instead we must initially render with the pending snapshot and then
  // trigger a sync fixup setState in the useLayoutEffect if we are mounting
  // sync and thus should be showing the committed snapshot.
  const [snapshot, setSnapshot] = useState<CollectionSnapshot<TResult, TKey>>(
    () => store.getPendingSnapshot()
  )

  useLayoutEffect(() => {
    // Ensure our store is managed by the tracker
    storeManager.addStore(store)

    const mountPendingSnapshot = store.getPendingSnapshot()
    const mountCommittedSnapshot = store.getCommittedSnapshot()

    // If we are mounting as part of a sync update mid transition, our initial
    // render value was wrong and we must trigger a sync fixup update.
    // Similarly, if a sync state update was triggered between the moment we
    // rendered and now (e.g. in some sibling component's useLayoutEffect) we
    // need to trigger a fixup.
    //
    // Both of these cases manifest as our initial render snapshot not matching
    // the currently committed snapshot.
    if (snapshot !== mountCommittedSnapshot) {
      setSnapshot(mountCommittedSnapshot)
    }

    // If we mounted mid-transition, and that transition is still ongoing, we
    // mounted with the pre-transition snapshot but are not ourselves part of
    // the transition. We must ensure we update to the new snapshot along with
    // the rest of the UI when the transition resolves
    if (mountPendingSnapshot !== mountCommittedSnapshot) {
      // Here we tell React to update us to the new pending snapshot. Since all
      // state updates are propagated to React components in transitions, we
      // assume there is a transition currently happening, and (unsafely)
      // depend upon current transition entanglement semantics which we expect
      // will ensure this update gets added to the currently pending
      // transition. Our goal is that when the transition that was pending
      // while we were mounting resolves, it will also include rerendering
      // this component to reflect the new snapshot.
      startTransition(() => {
        setSnapshot(mountPendingSnapshot)
      })
    }

    const unsubscribe = store.subscribe(() => {
      const snapshot = store.getPendingSnapshot()
      setSnapshot(snapshot)
    })

    return () => {
      unsubscribe()
      storeManager.removeStore(store)
    }
    // We intentionally ignore `snapshot` since we only care about its value on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return snapshot
}

// ============================================================================
// useLiveQueryConcurrent Hook Overloads
// ============================================================================

// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQueryConcurrent<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true
}

// Overload 2: Accept query function that can return undefined/null
export function useLiveQueryConcurrent<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder
  ) => QueryBuilder<TContext> | undefined | null,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>> | undefined
  data: InferResultType<TContext> | undefined
  collection: Collection<GetResult<TContext>, string | number, {}> | undefined
  status: UseLiveQueryStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

// Overload 3: Accept config object
export function useLiveQueryConcurrent<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true
}

// Overload 4: Accept pre-created collection
export function useLiveQueryConcurrent<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true
}

// Overload 5: Accept pre-created collection with singleResult: true
export function useLiveQueryConcurrent<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult
): {
  state: Map<TKey, TResult>
  data: TResult | undefined
  collection: Collection<TResult, TKey, TUtils> & SingleResult
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true
}

// ============================================================================
// Implementation
// ============================================================================

export function useLiveQueryConcurrent(
  configOrQueryOrCollection: any,
  deps: Array<unknown> = []
) {
  // Check if it's already a collection
  const isCollection =
    configOrQueryOrCollection &&
    typeof configOrQueryOrCollection === `object` &&
    typeof configOrQueryOrCollection.subscribeChanges === `function` &&
    typeof configOrQueryOrCollection.startSyncImmediate === `function` &&
    typeof configOrQueryOrCollection.id === `string`

  // Use refs to cache collection and store
  const collectionRef = useRef<Collection<object, string | number, {}> | null>(
    null
  )
  const storeRef = useRef<CollectionStore<object, string | number, {}> | null>(
    null
  )
  const depsRef = useRef<Array<unknown> | null>(null)
  const configRef = useRef<unknown>(null)

  // Check if we need to create/recreate the collection
  const needsNewCollection =
    !collectionRef.current ||
    (isCollection && configRef.current !== configOrQueryOrCollection) ||
    (!isCollection &&
      (depsRef.current === null ||
        depsRef.current.length !== deps.length ||
        depsRef.current.some((dep, i) => dep !== deps[i])))

  if (needsNewCollection) {
    // Clean up old store if exists
    if (storeRef.current) {
      storeRef.current.destroy()
      storeRef.current = null
    }

    if (isCollection) {
      // It's already a collection, use it directly
      configOrQueryOrCollection.startSyncImmediate()
      collectionRef.current = configOrQueryOrCollection
      configRef.current = configOrQueryOrCollection
    } else {
      // Handle different callback return types
      if (typeof configOrQueryOrCollection === `function`) {
        const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
        const result = configOrQueryOrCollection(queryBuilder)

        if (result === undefined || result === null) {
          // Callback returned undefined/null - disabled query
          collectionRef.current = null
        } else if (result instanceof CollectionImpl) {
          // Callback returned a Collection instance
          result.startSyncImmediate()
          collectionRef.current = result
        } else if (result instanceof BaseQueryBuilder) {
          // Callback returned QueryBuilder
          collectionRef.current = createLiveQueryCollection({
            query: configOrQueryOrCollection,
            startSync: true,
            gcTime: DEFAULT_GC_TIME_MS,
          })
        } else if (result && typeof result === `object`) {
          // Assume it's a LiveQueryCollectionConfig
          collectionRef.current = createLiveQueryCollection({
            startSync: true,
            gcTime: DEFAULT_GC_TIME_MS,
            ...result,
          })
        } else {
          throw new Error(
            `useLiveQueryConcurrent callback must return a QueryBuilder, LiveQueryCollectionConfig, Collection, undefined, or null. Got: ${typeof result}`
          )
        }
        depsRef.current = [...deps]
      } else {
        // Config object
        collectionRef.current = createLiveQueryCollection({
          startSync: true,
          gcTime: DEFAULT_GC_TIME_MS,
          ...configOrQueryOrCollection,
        })
        depsRef.current = [...deps]
      }
    }

    // Create store wrapper if we have a collection
    if (collectionRef.current) {
      storeRef.current = new CollectionStore(collectionRef.current)
    }
  }

  // Use the concurrent hook if we have a store
  const snapshot = storeRef.current
    ? useCollectionStore(storeRef.current)
    : null

  // Track last snapshot and returned value separately to avoid recreating
  const returnedSnapshotRef = useRef<CollectionSnapshot<any, any> | null>(null)
  const returnedRef = useRef<any>(null)

  // Rebuild returned object only when snapshot changes
  if (
    !returnedSnapshotRef.current ||
    returnedSnapshotRef.current !== snapshot
  ) {
    if (!snapshot || !collectionRef.current) {
      // Handle null collection case
      returnedRef.current = {
        state: undefined,
        data: undefined,
        collection: undefined,
        status: `disabled`,
        isLoading: false,
        isReady: false,
        isIdle: false,
        isError: false,
        isCleanedUp: false,
        isEnabled: false,
      }
    } else {
      // Capture stable view of entries from snapshot
      const entries = snapshot.entries
      const collection = collectionRef.current
      const config: CollectionConfigSingleRowOption<any, any, any> =
        collection.config
      const singleResult = config.singleResult
      let stateCache: Map<string | number, unknown> | null = null
      let dataCache: Array<unknown> | null = null

      returnedRef.current = {
        get state() {
          if (!stateCache) {
            stateCache = new Map(entries)
          }
          return stateCache
        },
        get data() {
          if (!dataCache) {
            dataCache = entries.map(([, value]) => value)
          }
          return singleResult ? dataCache[0] : dataCache
        },
        collection: collection,
        status: snapshot.status,
        isLoading: snapshot.status === `loading`,
        isReady: snapshot.status === `ready`,
        isIdle: snapshot.status === `idle`,
        isError: snapshot.status === `error`,
        isCleanedUp: snapshot.status === `cleaned-up`,
        isEnabled: true,
      }
    }

    returnedSnapshotRef.current = snapshot
  }

  return returnedRef.current!
}
