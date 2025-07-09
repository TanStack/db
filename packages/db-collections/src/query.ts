import { QueryObserver } from "@tanstack/query-core"
import type {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core"
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"

export interface QueryCollectionConfig<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
> {
  queryKey: TQueryKey
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promise<Array<TItem>>
  queryClient: QueryClient

  // Query-specific options
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

  // Standard Collection configuration properties
  id?: string
  getKey: CollectionConfig<TItem>[`getKey`]
  schema?: CollectionConfig<TItem>[`schema`]
  sync?: CollectionConfig<TItem>[`sync`]
  startSync?: CollectionConfig<TItem>[`startSync`]

  // Direct persistence handlers
  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to void or { refetch?: boolean } to control refetching
   */
  onInsert?: CollectionConfig<TItem>[`onInsert`]

  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to void or { refetch?: boolean } to control refetching
   */
  onUpdate?: CollectionConfig<TItem>[`onUpdate`]

  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to void or { refetch?: boolean } to control refetching
   */
  onDelete?: CollectionConfig<TItem>[`onDelete`]
  // TODO type returning { refetch: boolean }
}

/**
 * Type for the refetch utility function
 */
export type RefetchFn = () => Promise<void>

/**
 * Query collection utilities type
 */
export interface QueryCollectionUtils extends UtilsRecord {
  refetch: RefetchFn
}

/**
 * Creates query collection options for use with a standard Collection
 *
 * @param config - Configuration options for the Query collection
 * @returns Collection options with utilities
 */
export function queryCollectionOptions<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
>(
  config: QueryCollectionConfig<TItem, TError, TQueryKey>
): CollectionConfig<TItem> & { utils: QueryCollectionUtils } {
  const {
    queryKey,
    queryFn,
    queryClient,
    enabled,
    refetchInterval,
    retry,
    retryDelay,
    staleTime,
    getKey,
    onInsert,
    onUpdate,
    onDelete,
    ...baseCollectionConfig
  } = config

  // Validate required parameters
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!queryKey) {
    throw new Error(`[QueryCollection] queryKey must be provided.`)
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!queryFn) {
    throw new Error(`[QueryCollection] queryFn must be provided.`)
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!queryClient) {
    throw new Error(`[QueryCollection] queryClient must be provided.`)
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!getKey) {
    throw new Error(`[QueryCollection] getKey must be provided.`)
  }

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

        const currentSyncedItems = new Map(collection.syncedData)
        const newItemsMap = new Map<string | number, TItem>()
        newItemsArray.forEach((item) => {
          const key = getKey(item)
          newItemsMap.set(key, item)
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
            write({ type: `delete`, value: oldItem })
          } else if (
            !shallowEqual(
              oldItem as Record<string, any>,
              newItem as Record<string, any>
            )
          ) {
            // Only update if there are actual differences in the properties
            write({ type: `update`, value: newItem })
          }
        })

        newItemsMap.forEach((newItem, key) => {
          if (!currentSyncedItems.has(key)) {
            write({ type: `insert`, value: newItem })
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

    return async () => {
      actualUnsubscribeFn()
      await queryClient.cancelQueries({ queryKey })
      queryClient.removeQueries({ queryKey })
    }
  }

  /**
   * Refetch the query data
   * @returns Promise that resolves when the refetch is complete
   */
  const refetch: RefetchFn = async (): Promise<void> => {
    return queryClient.refetchQueries({
      queryKey: queryKey,
    })
  }

  // Create wrapper handlers for direct persistence operations that handle refetching
  const wrappedOnInsert = onInsert
    ? async (params: InsertMutationFnParams<TItem>) => {
        const handlerResult = (await onInsert(params)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = onUpdate
    ? async (params: UpdateMutationFnParams<TItem>) => {
        const handlerResult = (await onUpdate(params)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  const wrappedOnDelete = onDelete
    ? async (params: DeleteMutationFnParams<TItem>) => {
        const handlerResult = (await onDelete(params)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  return {
    ...baseCollectionConfig,
    getKey,
    sync: { sync: internalSync },
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      refetch,
    },
  }
}
