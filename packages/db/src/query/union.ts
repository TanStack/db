import { CollectionImpl, createCollection } from '../collection/index.js'
import { UnionKeyConflictError } from '../errors.js'
import { createLiveQueryCollection } from './live-query-collection.js'
import type { CollectionSubscription } from '../collection/subscription.js'
import type {
  ChangeMessage,
  ChangeMessageOrDeleteKeyMessage,
  SyncConfig,
} from '../types.js'
import type { InitialQueryBuilder, QueryBuilder } from './builder/index.js'
import type { Context, GetResult } from './builder/types.js'

type SourceCollection<
  TOutput extends object,
  TKey extends string | number,
> = CollectionImpl<TOutput, TKey, any, any, any>

export type UnionCollection<
  TOutput extends object,
  TKey extends string | number,
> = CollectionImpl<TOutput, TKey, any, any, any> & {
  add: (collection: SourceCollection<TOutput, TKey>) => void
  remove: (collection: SourceCollection<TOutput, TKey>) => void
  hasSource: (collection: SourceCollection<TOutput, TKey>) => boolean
  sources: () => Array<SourceCollection<TOutput, TKey>>
}

type SyncState<TOutput extends object, TKey extends string | number> = {
  collection: CollectionImpl<TOutput, TKey, any, any, any>
  begin: () => void
  write: (message: ChangeMessageOrDeleteKeyMessage<TOutput, TKey>) => void
  commit: () => void
  markReady: () => void
}

type SourceRecord<TKey extends string | number> = {
  subscription?: CollectionSubscription
  statusUnsubscribe?: () => void
  subscriptionReady?: boolean
  keys: Set<TKey>
}

type SourceDelta<TSource> = {
  added?: TSource
  removed?: TSource
}

class SourceRefTracker<TKey extends string | number, TSource> {
  private sourceByResultKey = new Map<TKey, TSource>()
  private sourceRefCounts = new Map<TSource, number>()

  addReference(resultKey: TKey, source: TSource): SourceDelta<TSource> {
    const previousSource = this.sourceByResultKey.get(resultKey)
    const delta: SourceDelta<TSource> = {}

    if (previousSource && previousSource !== source) {
      delta.removed = this.decrementSource(previousSource)
    }

    if (!previousSource || previousSource !== source) {
      delta.added = this.incrementSource(source)
      this.sourceByResultKey.set(resultKey, source)
    }

    return delta
  }

  removeReference(resultKey: TKey): SourceDelta<TSource> {
    const previousSource = this.sourceByResultKey.get(resultKey)
    if (!previousSource) {
      return {}
    }

    this.sourceByResultKey.delete(resultKey)
    return { removed: this.decrementSource(previousSource) }
  }

  private incrementSource(source: TSource): TSource | undefined {
    const current = this.sourceRefCounts.get(source) ?? 0
    const next = current + 1
    this.sourceRefCounts.set(source, next)
    return next === 1 ? source : undefined
  }

  private decrementSource(source: TSource): TSource | undefined {
    const current = this.sourceRefCounts.get(source) ?? 0
    const next = current - 1
    if (next <= 0) {
      this.sourceRefCounts.delete(source)
      return source
    }
    this.sourceRefCounts.set(source, next)
    return undefined
  }
}

let unionCollectionCounter = 0

class UnionCollectionManager<
  TOutput extends object,
  TKey extends string | number,
> {
  private sources = new Set<SourceCollection<TOutput, TKey>>()
  private sourceRecords = new Map<
    SourceCollection<TOutput, TKey>,
    SourceRecord<TKey>
  >()
  private keyOwners = new Map<TKey, SourceCollection<TOutput, TKey>>()
  private resultKeys = new WeakMap<TOutput, TKey>()
  private syncState?: SyncState<TOutput, TKey>
  private primarySource?: SourceCollection<TOutput, TKey>
  private isInError = false

  constructor(
    private readonly id: string,
    initialSources: Array<SourceCollection<TOutput, TKey>>,
  ) {
    initialSources.forEach((source) => this.addSource(source))
  }

  getKeyFromItem(item: TOutput): TKey {
    const storedKey = this.resultKeys.get(item)
    if (storedKey !== undefined) {
      return storedKey
    }
    if (!this.primarySource) {
      throw new Error(
        `Union collection "${this.id}" has no sources to derive a key from.`,
      )
    }
    return this.primarySource.config.getKey(item)
  }

  addSource(source: SourceCollection<TOutput, TKey>): void {
    if (!(source instanceof CollectionImpl)) {
      throw new Error(
        `Union collection "${this.id}" only accepts Collection instances.`,
      )
    }
    if (this.sources.has(source)) {
      return
    }
    this.sources.add(source)
    this.sourceRecords.set(source, { keys: new Set() })
    this.primarySource ??= source
    if (this.syncState) {
      this.subscribeToSource(source)
      this.updateReady()
    }
  }

  removeSource(source: SourceCollection<TOutput, TKey>): void {
    if (!this.sources.has(source)) {
      return
    }

    if (this.syncState) {
      this.unsubscribeFromSource(source)
      this.deleteKeysForSource(source)
    }

    this.sources.delete(source)
    this.sourceRecords.delete(source)

    if (this.primarySource === source) {
      this.primarySource = this.sources.values().next().value
    }

    if (this.syncState) {
      this.updateReady()
    }
  }

  hasSource(source: SourceCollection<TOutput, TKey>): boolean {
    return this.sources.has(source)
  }

  listSources(): Array<SourceCollection<TOutput, TKey>> {
    return Array.from(this.sources)
  }

  getSyncConfig(): SyncConfig<TOutput, TKey> {
    return {
      sync: ({ collection, begin, write, commit, markReady }) => {
        this.syncState = {
          collection: collection as CollectionImpl<
            TOutput,
            TKey,
            any,
            any,
            any
          >,
          begin,
          write: write as SyncState<TOutput, TKey>[`write`],
          commit,
          markReady,
        }

        this.seedKeyOwners()
        this.sources.forEach((source) => this.subscribeToSource(source))
        this.updateReady()

        return () => {
          this.sources.forEach((source) => this.unsubscribeFromSource(source))
          this.syncState = undefined
        }
      },
      rowUpdateMode: `full`,
    }
  }

  private subscribeToSource(source: SourceCollection<TOutput, TKey>) {
    if (!this.syncState) {
      return
    }

    const record = this.sourceRecords.get(source)!
    if (record.subscription) {
      return
    }

    this.assertNoKeyConflicts(source)

    const subscription = source.subscribeChanges(
      (changes) => this.applyChanges(source, changes),
      {
        includeInitialState: true,
        onStatusChange: (event) => {
          record.subscriptionReady = event.status === `ready`
          this.updateReady()
        },
      },
    )
    record.subscription = subscription
    record.subscriptionReady = subscription.status === `ready`

    record.statusUnsubscribe = source.on(`status:change`, (event) => {
      if (event.status === `error`) {
        this.transitionToError(
          `Source collection "${source.id}" entered error state`,
        )
        return
      }
      if (event.status === `cleaned-up`) {
        this.transitionToError(
          `Source collection "${source.id}" was cleaned up while union "${this.id}" depends on it.`,
        )
        return
      }
      this.updateReady()
    })

    if (subscription.status === `loadingSubset`) {
      record.subscriptionReady = false
    }
  }

  private unsubscribeFromSource(source: SourceCollection<TOutput, TKey>) {
    const record = this.sourceRecords.get(source)
    if (!record) {
      return
    }
    record.subscription?.unsubscribe()
    record.statusUnsubscribe?.()
    record.subscription = undefined
    record.statusUnsubscribe = undefined
    record.subscriptionReady = undefined
  }

  private applyChanges(
    source: SourceCollection<TOutput, TKey>,
    changes: Array<ChangeMessage<TOutput>>,
  ) {
    if (!this.syncState || this.isInError) {
      return
    }

    const record = this.sourceRecords.get(source)
    if (!record) {
      return
    }

    const { begin, commit } = this.syncState
    begin()

    try {
      for (const change of changes) {
        this.applyChange(source, record, change)
      }
    } catch (error) {
      commit()
      throw error
    }

    commit()
  }

  private applyChange(
    source: SourceCollection<TOutput, TKey>,
    record: SourceRecord<TKey>,
    change: ChangeMessage<TOutput>,
  ) {
    const key = change.key as TKey
    const existingOwner = this.keyOwners.get(key)

    if (change.type === `delete`) {
      if (!existingOwner) {
        return
      }
      if (existingOwner !== source) {
        this.throwKeyConflict(key, existingOwner, source)
      }
      this.keyOwners.delete(key)
      record.keys.delete(key)
      this.syncState!.write({ type: `delete`, key })
      return
    }

    if (existingOwner && existingOwner !== source) {
      this.throwKeyConflict(key, existingOwner, source)
    }

    if (!existingOwner) {
      this.keyOwners.set(key, source)
      record.keys.add(key)
    }

    this.resultKeys.set(change.value, key)

    const exists = this.syncState!.collection.has(key)
    this.syncState!.write({
      type: exists ? `update` : `insert`,
      value: change.value,
    })
  }

  private deleteKeysForSource(source: SourceCollection<TOutput, TKey>) {
    if (!this.syncState) {
      return
    }

    const record = this.sourceRecords.get(source)
    if (!record || record.keys.size === 0) {
      return
    }

    const { begin, commit, write } = this.syncState
    begin()
    for (const key of record.keys) {
      this.keyOwners.delete(key)
      write({ type: `delete`, key })
    }
    commit()
    record.keys.clear()
  }

  private updateReady() {
    if (!this.syncState || this.isInError) {
      return
    }

    if (this.sources.size === 0) {
      this.syncState.markReady()
      return
    }

    const allSourcesReady = Array.from(this.sources).every((source) =>
      source.isReady(),
    )
    const allSubscriptionsReady = Array.from(this.sources).every((source) => {
      const record = this.sourceRecords.get(source)
      return record?.subscriptionReady !== false
    })

    if (allSourcesReady && allSubscriptionsReady) {
      this.syncState.markReady()
    }
  }

  private transitionToError(message: string) {
    if (this.isInError) {
      return
    }
    this.isInError = true
    console.error(`[Union Collection Error] ${message}`)
    this.syncState?.collection._lifecycle.setStatus(`error`)
  }

  private seedKeyOwners() {
    for (const source of this.sources) {
      const record = this.sourceRecords.get(source)
      if (!record) {
        continue
      }

      const initialChanges = source.currentStateAsChanges()
      if (!initialChanges) {
        continue
      }

      for (const change of initialChanges) {
        if (change.type === `delete`) {
          continue
        }
        const key = change.key as TKey
        const existingOwner = this.keyOwners.get(key)
        if (existingOwner && existingOwner !== source) {
          this.throwKeyConflict(key, existingOwner, source)
        }
        if (!existingOwner) {
          this.keyOwners.set(key, source)
          record.keys.add(key)
        }
      }
    }
  }

  private assertNoKeyConflicts(source: SourceCollection<TOutput, TKey>) {
    const initialChanges = source.currentStateAsChanges()
    if (!initialChanges) {
      return
    }

    for (const change of initialChanges) {
      if (change.type === `delete`) {
        continue
      }
      const existingOwner = this.keyOwners.get(change.key as TKey)
      if (existingOwner && existingOwner !== source) {
        this.throwKeyConflict(change.key as TKey, existingOwner, source)
      }
    }
  }

  private throwKeyConflict(
    key: TKey,
    existing: SourceCollection<TOutput, TKey>,
    incoming: SourceCollection<TOutput, TKey>,
  ): never {
    this.transitionToError(
      `Key "${String(key)}" already exists in collection "${existing.id}"`,
    )
    throw new UnionKeyConflictError(this.id, key, existing.id, incoming.id)
  }
}

export function union<TOutput extends object, TKey extends string | number>(
  ...collections: Array<SourceCollection<TOutput, TKey>>
): UnionCollection<TOutput, TKey> {
  const id = `union-${++unionCollectionCounter}`
  const manager = new UnionCollectionManager<TOutput, TKey>(id, collections)

  const collection = createCollection<TOutput, TKey>({
    id,
    getKey: manager.getKeyFromItem.bind(manager),
    sync: manager.getSyncConfig(),
  }) as unknown as UnionCollection<TOutput, TKey>

  collection.add = manager.addSource.bind(manager)
  collection.remove = manager.removeSource.bind(manager)
  collection.hasSource = manager.hasSource.bind(manager)
  collection.sources = manager.listSources.bind(manager)

  return collection
}

export function unionFromLiveQuery<
  TContext extends Context,
  TResult extends object = GetResult<TContext> & object,
  TOutput extends object = TResult,
  TKey extends string | number = string | number,
>(
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>,
  mapToCollection: (result: TResult) => SourceCollection<TOutput, TKey>,
): UnionCollection<TOutput, TKey> {
  const unionCollection = union<TOutput, TKey>()
  const liveQueryCollection = createLiveQueryCollection<TContext, TResult>({
    query,
    startSync: true,
  })

  const tracker = new SourceRefTracker<TKey, SourceCollection<TOutput, TKey>>()

  const subscription = liveQueryCollection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        const resultKey = change.key as TKey
        if (change.type === `delete`) {
          const delta = tracker.removeReference(resultKey)
          if (delta.removed) {
            unionCollection.remove(delta.removed)
          }
          continue
        }

        const nextSource = mapToCollection(change.value)
        const delta = tracker.addReference(resultKey, nextSource)
        if (delta.removed) {
          unionCollection.remove(delta.removed)
        }
        if (delta.added) {
          unionCollection.add(delta.added)
        }
      }
    },
    { includeInitialState: true },
  )

  const statusUnsubscribe = unionCollection.on(`status:change`, (event) => {
    if (event.status === `cleaned-up`) {
      subscription.unsubscribe()
      statusUnsubscribe()
    }
  })

  return unionCollection
}
