import { Collection } from "@tanstack/db"
import { QueryObserver } from "@tanstack/query-core"
import type {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core"
import type { CollectionConfig, SyncConfig } from "@tanstack/db"

export interface QueryCollectionConfig<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
> extends Omit<CollectionConfig<TItem>, `sync`> {
  queryKey: TQueryKey
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promise<Array<TItem>>
  getId: (item: TItem) => string

  enabled?: boolean
  refetchInterval?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`refetchInterval`]
  retry?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`retry`]
  retryDelay?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`retryDelay`]
  staleTime?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`staleTime`]
  queryClient: QueryClient
}

export class QueryCollection<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
> extends Collection<TItem> {
  public readonly queryConfig: QueryCollectionConfig<TItem, TError, TQueryKey>
  private queryClient: QueryClient

  constructor(config: QueryCollectionConfig<TItem, TError, TQueryKey>) {
    const {
      queryKey,
      queryFn,
      queryClient,
      enabled,
      refetchInterval,
      retry,
      retryDelay,
      staleTime,
      ...baseCollectionConfig
    } = config

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!queryKey)
      throw new Error(`[QueryCollection] queryKey must be provided.`)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!queryFn) throw new Error(`[QueryCollection] queryFn must be provided.`)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!queryClient)
      throw new Error(`[QueryCollection] queryClient must be provided.`)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!baseCollectionConfig.getId) {
      throw new Error(`[QueryCollection] getId must be provided.`)
    }

    const getIdFn = baseCollectionConfig.getId

    const internalSync: SyncConfig<TItem>[`sync`] = (params) => {
      const { begin, write, commit, collection } = params

      const observerOptions: QueryObserverOptions<
        Array<TItem>,
        TError,
        Array<TItem>,
        Array<TItem>,
        TQueryKey
      > = {
        queryKey: queryKey,
        queryFn: queryFn,
        enabled: enabled,
        refetchInterval: refetchInterval,
        retry: retry,
        retryDelay: retryDelay,
        staleTime: staleTime,
        structuralSharing: true,
        notifyOnChangeProps: `all`,
      }

      const localObserver = new QueryObserver<
        Array<TItem>,
        TError,
        Array<TItem>,
        Array<TItem>,
        TQueryKey
      >(queryClient, observerOptions)

      const actualUnsubscribeFn = localObserver.subscribe((result) => {
        if (result.isSuccess) {
          const newItemsArray = result.data

          if (
            !Array.isArray(newItemsArray) ||
            newItemsArray.some((item) => typeof item !== `object`)
          ) {
            console.error(
              `[QueryCollection] queryFn did not return an array of objects. Skipping update.`,
              newItemsArray
            )
            return
          }

          const currentSyncedItems = new Map(collection.syncedData.state)
          const newItemsMap = new Map<string, TItem>()
          newItemsArray.forEach((item) => {
            try {
              const key = getIdFn(item)
              newItemsMap.set(key, item)
            } catch (e) {
              console.error(
                `[QueryCollection] Error getting primary key for an item. Skipping item:`,
                item,
                e
              )
            }
          })

          begin()

          // Helper function for shallow equality check of objects
          const shallowEqual = (
            obj1: Record<string, any>,
            obj2: Record<string, any>
          ): boolean => {
            // Get all keys from both objects
            const keys1 = Object.keys(obj1)
            const keys2 = Object.keys(obj2)

            // If number of keys is different, objects are not equal
            if (keys1.length !== keys2.length) return false

            // Check if all keys in obj1 have the same values in obj2
            return keys1.every((key) => {
              // Skip comparing functions and complex objects deeply
              if (typeof obj1[key] === `function`) return true
              if (typeof obj1[key] === `object` && obj1[key] !== null) {
                // For nested objects, just compare references
                // A more robust solution might do recursive shallow comparison
                // or let users provide a custom equality function
                return obj1[key] === obj2[key]
              }
              return obj1[key] === obj2[key]
            })
          }

          currentSyncedItems.forEach((oldItem, key) => {
            const newItem = newItemsMap.get(key)
            if (!newItem) {
              write({ type: `delete`, key, value: oldItem })
            } else if (
              !shallowEqual(
                oldItem as Record<string, any>,
                newItem as Record<string, any>
              )
            ) {
              // Only update if there are actual differences in the properties
              write({ type: `update`, key, value: newItem })
            }
          })

          newItemsMap.forEach((newItem, key) => {
            if (!currentSyncedItems.has(key)) {
              write({ type: `insert`, key, value: newItem })
            }
          })

          commit()
        } else if (result.isError) {
          console.error(
            `[QueryCollection] Error observing query ${String(queryKey)}:`,
            result.error
          )
        }
      })

      return actualUnsubscribeFn
    }

    super({
      ...baseCollectionConfig,
      sync: { sync: internalSync },
    })

    this.queryConfig = config
    this.queryClient = queryClient
  }

  public async invalidate(): Promise<void> {
    console.log(
      `[QueryCollection] invalidate() called for ${String(this.queryConfig.queryKey)}`
    )
    try {
      await this.queryClient.invalidateQueries({
        queryKey: this.queryConfig.queryKey,
      })
      console.log(
        `[QueryCollection] Invalidation successful for ${String(this.queryConfig.queryKey)}.`
      )
    } catch (error) {
      console.error(
        `[QueryCollection] Error during invalidate for ${String(this.queryConfig.queryKey)}:`,
        error
      )
      throw error
    }
  }
}

export function createQueryCollection<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
>(
  config: QueryCollectionConfig<TItem, TError, TQueryKey>
): QueryCollection<TItem, TError, TQueryKey> {
  return new QueryCollection(config)
}
