import { MultiSet } from "@tanstack/db-ivm"
import { convertToBasicExpression } from "../compiler/expressions.js"
import type { FullSyncState } from "./types.js"
import type { MultiSetArray, RootStreamBuilder } from "@tanstack/db-ivm"
import type { Collection } from "../../collection.js"
import type { ChangeMessage, SyncConfig } from "../../types.js"
import type { Context, GetResult } from "../builder/types.js"
import type { BasicExpression } from "../ir.js"
import type { CollectionConfigBuilder } from "./collection-config-builder.js"
import type { CollectionSubscription } from "../../collection-subscription.js"

export class CollectionSubscriber<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  // Keep track of the biggest value we've sent so far (needed for orderBy optimization)
  private biggest: any = undefined

  constructor(
    private collectionId: string,
    private collection: Collection,
    private config: Parameters<SyncConfig<TResult>[`sync`]>[0],
    private syncState: FullSyncState,
    private collectionConfigBuilder: CollectionConfigBuilder<TContext, TResult>
  ) {}

  subscribe(): CollectionSubscription {
    const collectionAlias = findCollectionAlias(
      this.collectionId,
      this.collectionConfigBuilder.query
    )
    const whereClause = this.getWhereClauseFromAlias(collectionAlias)

    if (whereClause) {
      // Convert WHERE clause to BasicExpression format for collection subscription
      const whereExpression = convertToBasicExpression(
        whereClause,
        collectionAlias!
      )

      if (whereExpression) {
        // Use index optimization for this collection
        return this.subscribeToChanges(whereExpression)
      } else {
        // This should not happen - if we have a whereClause but can't create whereExpression,
        // it indicates a bug in our optimization logic
        throw new Error(
          `Failed to convert WHERE clause to collection filter for collection '${this.collectionId}'. ` +
            `This indicates a bug in the query optimization logic.`
        )
      }
    } else {
      // No WHERE clause for this collection, use regular subscription
      return this.subscribeToChanges()
    }
  }

  private subscribeToChanges(whereExpression?: BasicExpression<boolean>) {
    let subscription: CollectionSubscription
    if (
      Object.hasOwn(
        this.collectionConfigBuilder.optimizableOrderByCollections,
        this.collectionId
      )
    ) {
      subscription = this.subscribeToOrderedChanges(whereExpression)
    } else {
      // If the collection is lazy then we should not include the initial state
      const includeInitialState =
        !this.collectionConfigBuilder.lazyCollections.has(this.collectionId)

      subscription = this.subscribeToMatchingChanges(
        whereExpression,
        includeInitialState
      )
    }
    const unsubscribe = () => {
      subscription.unsubscribe()
    }
    this.syncState.unsubscribeCallbacks.add(unsubscribe)
    return subscription
  }

  private sendChangesToPipeline(
    changes: Iterable<ChangeMessage<any, string | number>>,
    callback?: () => boolean
  ) {
    const input = this.syncState.inputs[this.collectionId]!
    const sentChanges = sendChangesToInput(
      input,
      changes,
      this.collection.config.getKey
    )

    // Do not provide the callback that loads more data
    // if there's no more data to load
    // otherwise we end up in an infinite loop trying to load more data
    const dataLoader = sentChanges > 0 ? callback : undefined

    // We need to call `maybeRunGraph` even if there's no data to load
    // because we need to mark the collection as ready if it's not already
    // and that's only done in `maybeRunGraph`
    this.collectionConfigBuilder.maybeRunGraph(
      this.config,
      this.syncState,
      dataLoader
    )
  }

  private subscribeToMatchingChanges(
    whereExpression: BasicExpression<boolean> | undefined,
    includeInitialState: boolean = false
  ) {
    const sendChanges = (
      changes: Array<ChangeMessage<any, string | number>>
    ) => {
      this.sendChangesToPipeline(changes)
    }

    const subscription = this.collection.subscribeChanges(sendChanges, {
      includeInitialState,
      whereExpression,
    })

    return subscription
  }

  private subscribeToOrderedChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    const { offset, limit, comparator, dataNeeded, index } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!

    const sendChangesInRange = (
      changes: Iterable<ChangeMessage<any, string | number>>
    ) => {
      // Split live updates into a delete of the old value and an insert of the new value
      // and filter out changes that are bigger than the biggest value we've sent so far
      // because they can't affect the topK (and if later we need more data, we will dynamically load more data)
      const splittedChanges = splitUpdates(changes)
      let filteredChanges = splittedChanges
      if (dataNeeded!() === 0) {
        // If the topK is full [..., maxSentValue] then we do not need to send changes > maxSentValue
        // because they can never make it into the topK.
        // However, if the topK isn't full yet, we need to also send changes > maxSentValue
        // because they will make it into the topK
        filteredChanges = filterChangesSmallerOrEqualToMax(
          splittedChanges,
          comparator,
          this.biggest
        )
      }

      this.sendChangesToPipelineWithTracking(filteredChanges, subscription)
    }

    // Subscribe to changes and only send changes that are smaller than the biggest value we've sent so far
    // values that are bigger don't need to be sent because they can't affect the topK
    const subscription = this.collection.subscribeChanges(sendChangesInRange, {
      whereExpression,
    })

    subscription.setOrderByIndex(index)

    // Load the first `offset + limit` values from the index
    // i.e. the K items from the collection that fall into the requested range: [offset, offset + limit[
    subscription.requestLimitedSnapshot({
      limit: offset + limit,
    })

    return subscription
  }

  // This function is called by maybeRunGraph
  // after each iteration of the query pipeline
  // to ensure that the orderBy operator has enough data to work with
  loadMoreIfNeeded(subscription: CollectionSubscription) {
    const orderByInfo =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]

    if (!orderByInfo) {
      // This query has no orderBy operator
      // so there's no data to load
      return true
    }

    const { dataNeeded } = orderByInfo

    if (!dataNeeded) {
      // This should never happen because the topK operator should always set the size callback
      // which in turn should lead to the orderBy operator setting the dataNeeded callback
      throw new Error(
        `Missing dataNeeded callback for collection ${this.collectionId}`
      )
    }

    // `dataNeeded` probes the orderBy operator to see if it needs more data
    // if it needs more data, it returns the number of items it needs
    const n = dataNeeded()
    if (n > 0) {
      this.loadNextItems(n, subscription)
    }
    return true
  }

  private sendChangesToPipelineWithTracking(
    changes: Iterable<ChangeMessage<any, string | number>>,
    subscription: CollectionSubscription
  ) {
    const { comparator } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!
    const trackedChanges = this.trackSentValues(changes, comparator)
    this.sendChangesToPipeline(
      trackedChanges,
      this.loadMoreIfNeeded.bind(this, subscription)
    )
  }

  // Loads the next `n` items from the collection
  // starting from the biggest item it has sent
  private loadNextItems(n: number, subscription: CollectionSubscription) {
    const { valueExtractorForRawRow } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!
    const biggestSentRow = this.biggest
    const biggestSentValue = biggestSentRow
      ? valueExtractorForRawRow(biggestSentRow)
      : biggestSentRow
    // Take the `n` items after the biggest sent value
    subscription.requestLimitedSnapshot({
      limit: n,
      minValue: biggestSentValue,
    })
  }

  private getWhereClauseFromAlias(
    collectionAlias: string | undefined
  ): BasicExpression<boolean> | undefined {
    const collectionWhereClausesCache =
      this.collectionConfigBuilder.collectionWhereClausesCache
    if (collectionAlias && collectionWhereClausesCache) {
      return collectionWhereClausesCache.get(collectionAlias)
    }
    return undefined
  }

  private *trackSentValues(
    changes: Iterable<ChangeMessage<any, string | number>>,
    comparator: (a: any, b: any) => number
  ) {
    for (const change of changes) {
      if (!this.biggest) {
        this.biggest = change.value
      } else if (comparator(this.biggest, change.value) < 0) {
        this.biggest = change.value
      }

      yield change
    }
  }
}

/**
 * Finds the alias for a collection ID in the query
 */
function findCollectionAlias(
  collectionId: string,
  query: any
): string | undefined {
  // Check FROM clause
  if (
    query.from?.type === `collectionRef` &&
    query.from.collection?.id === collectionId
  ) {
    return query.from.alias
  }

  // Check JOIN clauses
  if (query.join) {
    for (const joinClause of query.join) {
      if (
        joinClause.from?.type === `collectionRef` &&
        joinClause.from.collection?.id === collectionId
      ) {
        return joinClause.from.alias
      }
    }
  }

  return undefined
}

/**
 * Helper function to send changes to a D2 input stream
 */
function sendChangesToInput(
  input: RootStreamBuilder<unknown>,
  changes: Iterable<ChangeMessage>,
  getKey: (item: ChangeMessage[`value`]) => any
): number {
  const multiSetArray: MultiSetArray<unknown> = []
  for (const change of changes) {
    const key = getKey(change.value)
    if (change.type === `insert`) {
      multiSetArray.push([[key, change.value], 1])
    } else if (change.type === `update`) {
      multiSetArray.push([[key, change.previousValue], -1])
      multiSetArray.push([[key, change.value], 1])
    } else {
      // change.type === `delete`
      multiSetArray.push([[key, change.value], -1])
    }
  }

  if (multiSetArray.length !== 0) {
    input.sendData(new MultiSet(multiSetArray))
  }

  return multiSetArray.length
}

/** Splits updates into a delete of the old value and an insert of the new value */
function* splitUpdates<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (change.type === `update`) {
      yield { type: `delete`, key: change.key, value: change.previousValue! }
      yield { type: `insert`, key: change.key, value: change.value }
    } else {
      yield change
    }
  }
}

function* filterChanges<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
  f: (change: ChangeMessage<T, TKey>) => boolean
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (f(change)) {
      yield change
    }
  }
}

/**
 * Filters changes to only include those that are smaller or equal to the provided max value
 * @param changes - Iterable of changes to filter
 * @param comparator - Comparator function to use for filtering
 * @param maxValue - Range to filter changes within (range boundaries are exclusive)
 * @returns Iterable of changes that fall within the range
 */
function* filterChangesSmallerOrEqualToMax<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
  comparator: (a: any, b: any) => number,
  maxValue: any
): Generator<ChangeMessage<T, TKey>> {
  yield* filterChanges(changes, (change) => {
    return !maxValue || comparator(change.value, maxValue) <= 0
  })
}
