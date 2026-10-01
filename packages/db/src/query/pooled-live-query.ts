import { SortedMap } from '../SortedMap.js'
import { normalizeValue } from '../utils/comparison.js'
import { isVirtualPropName } from '../virtual-props.js'
import { getPersistedReadinessSource } from '../persisted-readiness.js'
import { LiveQueryObserverDisposedError } from '../errors.js'
import { getLiveQueryStatusFlags } from '../live-query-adapter.js'
import { getWhereExpression } from './ir.js'
import { createLiveQueryCollection } from './live-query-collection.js'
import type { BasicExpression, QueryIR } from './ir.js'
import type { BaseQueryBuilder } from './builder/index.js'
import type { Collection, CollectionImpl } from '../collection/index.js'
import type { ChangeMessage, CollectionStatus } from '../types.js'
import type { CollectionEventHandler } from '../collection/events.js'
import type {
  LiveQueryObserver,
  LiveQueryObserverListener,
  LiveQuerySnapshot,
} from '../live-query-observer.js'
import type { DehydratedLiveQueryResult } from '../client.js'

/**
 * Live queries that filter one source Collection only by `eq(field, literal)`
 * share one partition of that source per filtered field set. Each query reads
 * the bucket for its literal tuple, so mounting many queries of one shape
 * costs a lookup each instead of a compiled graph and a source subscription.
 *
 * A bucket holds the rows the partition's source subscription has published,
 * keyed by the same normalized equality that `eq` uses: a Date equals its
 * timestamp, `NaN` equals `NaN`, `-0` equals `0`, and nullish values match no
 * literal.
 */

type Row = Record<string, unknown>
type Listener = (changes: Array<ChangeMessage<Row, string | number>>) => void
type StatusListener = CollectionEventHandler<`status:change`>

interface Bucket {
  // Key order, as in a live-query Collection without orderBy.
  rows: SortedMap<string | number, Row>
  listeners: Set<Listener>
  revision: number
  layoutRevision: number
  // Rows as entries, rebuilt after a change.
  entries: Array<[string | number, Row]> | undefined
}

const partitionsBySource = new WeakMap<object, Map<string, Partition>>()

// Typed so that 1, '1', and true stay distinct.
function equalityKey(value: unknown): string | undefined {
  const normalized = normalizeValue(value)
  const type = typeof normalized
  return type === `string` || type === `number` || type === `boolean`
    ? `${type}:${String(normalized)}`
    : undefined
}

function readPath(row: Row, path: Array<string>): unknown {
  try {
    let value: unknown = row
    for (const segment of path) value = (value as Row | undefined)?.[segment]
    return value
  } catch {
    // The full predicate treats a throwing read as false.
    return undefined
  }
}

class Partition {
  private readonly buckets = new Map<string, Bucket>()
  private subscription: { unsubscribe: () => void } | undefined
  private stopStatusEvents: (() => void) | undefined
  // One source status listener serves every view of this partition.
  readonly statusListeners = new Set<StatusListener>()
  private listenerCount = 0
  private releaseTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly source: CollectionImpl<any, any, any, any, any>,
    private readonly paths: Array<Array<string>>,
    private readonly onEmpty: () => void,
  ) {}

  bucketKeyOf(row: Row | undefined): string | undefined {
    if (row === undefined) return undefined
    const parts: Array<string> = []
    for (const path of this.paths) {
      const key = equalityKey(readPath(row, path))
      if (key === undefined) return undefined
      parts.push(key)
    }
    return JSON.stringify(parts)
  }

  bucket(key: string): Bucket {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = {
        rows: new SortedMap(),
        listeners: new Set(),
        revision: 0,
        layoutRevision: 0,
        entries: undefined,
      }
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  /** Start the shared source subscription; release it when unused. */
  retain(): void {
    if (!this.subscription) {
      this.subscription = this.source.subscribeChanges(
        (changes) =>
          this.apply(changes as Array<ChangeMessage<Row, string | number>>),
        { includeInitialState: true },
      )
      this.stopStatusEvents = this.source.on(`status:change`, (event) => {
        for (const listener of [...this.statusListeners]) listener(event)
      })
    }
    this.scheduleRelease()
  }

  listen(bucket: Bucket, listener: Listener): () => void {
    this.addListener(bucket, listener)
    return () => this.removeListener(bucket, listener)
  }

  addListener(bucket: Bucket, listener: Listener): void {
    this.retain()
    bucket.listeners.add(listener)
    this.listenerCount++
  }

  removeListener(bucket: Bucket, listener: Listener): void {
    if (!bucket.listeners.delete(listener)) return
    this.listenerCount--
    this.scheduleRelease()
  }

  private scheduleRelease(): void {
    if (this.releaseTimer !== undefined) clearTimeout(this.releaseTimer)
    this.releaseTimer = undefined
    if (this.listenerCount > 0) return
    // A rendered query may subscribe shortly after construction.
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = undefined
      if (this.listenerCount > 0) return
      this.subscription?.unsubscribe()
      this.subscription = undefined
      this.stopStatusEvents?.()
      this.stopStatusEvents = undefined
      this.buckets.clear()
      this.onEmpty()
    }, 1000)
  }

  private apply(changes: Array<ChangeMessage<Row, string | number>>): void {
    const touched = new Map<
      Bucket,
      Array<ChangeMessage<Row, string | number>>
    >()
    const record = (
      bucket: Bucket,
      change: ChangeMessage<Row, string | number>,
    ) => {
      const list = touched.get(bucket)
      if (list) list.push(change)
      else touched.set(bucket, [change])
      if (change.type !== `update`) bucket.layoutRevision++
    }
    for (const change of changes) {
      const next =
        change.type === `delete` ? undefined : this.bucketKeyOf(change.value)
      const previous =
        change.type === `insert`
          ? undefined
          : this.bucketKeyOf(
              change.type === `delete` ? change.value : change.previousValue,
            )
      if (previous !== undefined && previous !== next) {
        const bucket = this.bucket(previous)
        const old = bucket.rows.get(change.key)
        if (bucket.rows.delete(change.key)) {
          record(bucket, { type: `delete`, key: change.key, value: old! })
        }
      }
      if (next !== undefined) {
        const bucket = this.bucket(next)
        const existed = bucket.rows.has(change.key)
        bucket.rows.set(change.key, change.value)
        record(
          bucket,
          existed
            ? { ...change, type: `update` }
            : { type: `insert`, key: change.key, value: change.value },
        )
      }
    }
    for (const [bucket, bucketChanges] of touched) {
      bucket.revision++
      bucket.entries = undefined
      for (const listener of [...bucket.listeners]) listener(bucketChanges)
    }
  }
}

type Conjunct = { path: Array<string>; pathKey: string; literalKey: string }

// Adds `eq(alias.field, literal)` conjuncts to `out`; false for anything else.
function collectConjuncts(
  expression: BasicExpression,
  alias: string,
  out: Array<Conjunct>,
): boolean {
  if (expression.type !== `func`) return false
  const args = expression.args
  if (expression.name === `and`) {
    for (const arg of args) if (!collectConjuncts(arg, alias, out)) return false
    return true
  }
  if (expression.name !== `eq` || args.length !== 2) return false
  const left = args[0]!
  const right = args[1]!
  const ref = left.type === `ref` ? left : right
  const literal = left.type === `val` ? left : right
  if (ref.type !== `ref` || literal.type !== `val`) return false
  const refPath = ref.path
  if (
    refPath[0] !== alias ||
    refPath.length < 2 ||
    isVirtualPropName(refPath[1]!)
  ) {
    return false
  }
  const literalKey = equalityKey(literal.value)
  if (literalKey === undefined) return false
  const path = refPath.slice(1)
  out.push({ path, pathKey: JSON.stringify(path), literalKey })
  return true
}

/**
 * The equality conjuncts of a query that a partition can serve, or undefined
 * when any other clause or operand is present.
 */
function poolableShape(
  query: QueryIR,
):
  | { paths: Array<Array<string>>; shapeKey: string; bucketKey: string }
  | undefined {
  if (
    query.from.type !== `collectionRef` ||
    query.select ||
    query.join ||
    query.groupBy ||
    query.having ||
    query.orderBy ||
    query.limit !== undefined ||
    query.offset !== undefined ||
    query.distinct ||
    query.singleResult ||
    query.fnSelect ||
    query.fnWhere?.length ||
    query.fnHaving?.length ||
    !query.where?.length
  ) {
    return undefined
  }
  const conjuncts: Array<Conjunct> = []
  for (const where of query.where) {
    if (
      !collectConjuncts(getWhereExpression(where), query.from.alias, conjuncts)
    ) {
      return undefined
    }
  }
  if (conjuncts.length > 1) {
    conjuncts.sort((a, b) => (a.pathKey < b.pathKey ? -1 : 1))
  }
  return {
    paths: conjuncts.map(({ path }) => path),
    shapeKey: conjuncts.map(({ pathKey }) => pathKey).join(`,`),
    bucketKey: JSON.stringify(conjuncts.map(({ literalKey }) => literalKey)),
  }
}

/**
 * One query's view of its bucket. It answers the calls the live-query observer
 * makes; any other Collection member builds the query's live-query Collection
 * once and forwards to it, so `result.collection` keeps its full API.
 */
class PooledLiveQuery {
  readonly isLoadingSubset = false
  // No persisted readiness, single-result config, or layout channel.
  readonly config = undefined
  readonly _subscribeLayoutChanges = undefined
  private readonly bucket: Bucket
  private collection: Collection<any, any, any> | undefined = undefined

  constructor(
    private readonly source: CollectionImpl<any, any, any, any, any>,
    private readonly query: BaseQueryBuilder,
    private readonly partition: Partition,
    bucketKey: string,
  ) {
    this.bucket = partition.bucket(bucketKey)
    partition.retain()
  }

  get status(): CollectionStatus {
    return this.source.status
  }

  get _stateRevision(): number {
    return this.bucket.revision
  }

  get _layoutRevision(): number {
    return this.bucket.layoutRevision
  }

  entries(): Array<[string | number, Row]> {
    return (this.bucket.entries ??= [...this.bucket.rows.entries()])
  }

  subscribeChanges(
    callback: Listener,
    options: { includeInitialState?: boolean } = {},
  ): { unsubscribe: () => void } {
    const unsubscribe = this.partition.listen(this.bucket, callback)
    if (options.includeInitialState) {
      callback(
        [...this.bucket.rows].map(([key, value]) => ({
          type: `insert`,
          key,
          value,
        })),
      )
    }
    return { unsubscribe }
  }

  on(...args: Parameters<CollectionImpl[`on`]>): () => void {
    const [event, listener] = args
    if (event !== `status:change`) return this.source.on(...args)
    const listeners = this.partition.statusListeners
    listeners.add(listener as StatusListener)
    return () => listeners.delete(listener as StatusListener)
  }

  preload(): Promise<void> {
    return this.source.preload()
  }

  /** Observe changes and status without allocating unsubscribe closures. */
  watch(onChanges: Listener, onStatus: StatusListener): void {
    this.partition.addListener(this.bucket, onChanges)
    this.partition.statusListeners.add(onStatus)
  }

  unwatch(onChanges: Listener, onStatus: StatusListener): void {
    this.partition.removeListener(this.bucket, onChanges)
    this.partition.statusListeners.delete(onStatus)
  }

  cleanup(): Promise<void> {
    return this.collection?.cleanup() ?? Promise.resolve()
  }

  private proxy: Collection<any, any, any> | undefined = undefined

  /** This view as the Collection it stands in for. */
  get publicCollection(): Collection<any, any, any> {
    return (this.proxy ??= new Proxy(
      this,
      forwardToCollection,
    ) as unknown as Collection<any, any, any>)
  }

  materialize(): Collection<any, any, any> {
    return (this.collection ??= createLiveQueryCollection({
      query: this.query,
      startSync: true,
    }))
  }
}

/**
 * The wholesale observer for a pooled view without a `DbClient`. Pooled views
 * have no hydration, persisted restore, or single-result mode, so this keeps
 * only the snapshot, subscription, preload, and disposal parts of the general
 * observer contract.
 */
class PooledWholesaleObserver implements LiveQueryObserver<
  Row,
  string | number
> {
  private snapshot: LiveQuerySnapshot<Row, string | number> | undefined
  private snapshotRevision = -1
  private snapshotStatus: CollectionStatus | undefined
  private layoutKeys: Array<string | number> = []
  private layoutRevision = 0
  private readonly records = new Set<{
    listener: LiveQueryObserverListener<Row, string | number>
  }>()
  private watching = false
  private readonly onChanges: Listener = (changes) => this.deliver(changes)
  private readonly onStatus: StatusListener = () => this.deliver(undefined)
  private preloadPromise: Promise<void> | undefined
  private disposed = false

  constructor(
    private readonly view: PooledLiveQuery,
    private readonly onPreload: (() => void) | undefined,
  ) {}

  getSnapshot(): LiveQuerySnapshot<Row, string | number> {
    const status = this.view.status
    if (
      this.snapshot &&
      this.snapshotRevision === this.view._stateRevision &&
      this.snapshotStatus === status
    ) {
      return this.snapshot
    }
    const entries = this.view.entries()
    const keys = entries.map(([key]) => key)
    if (
      keys.length !== this.layoutKeys.length ||
      keys.some((key, index) => key !== this.layoutKeys[index])
    ) {
      this.layoutKeys = keys
      this.layoutRevision++
    }
    this.snapshotRevision = this.view._stateRevision
    this.snapshotStatus = status
    return (this.snapshot = {
      state: new Map(entries),
      data: entries.map(([, value]) => value),
      collection: this.view.publicCollection,
      layoutRevision: this.layoutRevision,
      status,
      ...getLiveQueryStatusFlags(status),
      persistedStatus: `unavailable`,
      isPersistedReady: false,
      persistedError: undefined,
      isEnabled: true,
    })
  }

  getServerSnapshot(): LiveQuerySnapshot<Row, string | number> {
    return this.getSnapshot()
  }

  subscribe(
    listener: LiveQueryObserverListener<Row, string | number>,
  ): () => void {
    if (this.disposed) throw new LiveQueryObserverDisposedError()
    // A record per call, so one listener subscribed twice tears down twice.
    const record = { listener }
    this.records.add(record)
    if (!this.watching) {
      this.watching = true
      this.view.watch(this.onChanges, this.onStatus)
    }
    return () => {
      if (this.records.delete(record) && this.records.size === 0) {
        this.stopWatching()
      }
    }
  }

  private deliver(
    changes: Array<ChangeMessage<Row, string | number>> | undefined,
  ): void {
    const records = this.records.size === 1 ? this.records : [...this.records]
    for (const { listener } of records) listener(changes)
  }

  private stopWatching(): void {
    if (!this.watching) return
    this.watching = false
    this.view.unwatch(this.onChanges, this.onStatus)
  }

  preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise
    this.onPreload?.()
    const promise = this.view.preload()
    this.preloadPromise = promise
    const clear = () => {
      if (this.preloadPromise === promise) this.preloadPromise = undefined
    }
    void promise.then(clear, clear)
    return promise
  }

  preloadForInitialRender(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new LiveQueryObserverDisposedError())
    }
    return this.preload()
  }

  isInitialRenderReady(): boolean {
    return false
  }

  getError(): unknown {
    return undefined
  }

  dehydrate(): DehydratedLiveQueryResult<Row, string | number> {
    return {
      rows: this.view.entries().map(([key, value]) => ({ key, value })),
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.records.clear()
    this.stopWatching()
  }
}

/** A lean observer for a pooled view, or undefined for anything else. */
export function createPooledObserver<
  T extends object,
  TKey extends string | number,
>(
  collection: unknown,
  {
    wholesale,
    client,
    onPreload,
  }: {
    wholesale: boolean
    client: unknown
    onPreload: (() => void) | undefined
  },
): LiveQueryObserver<T, TKey> | undefined {
  if (!(collection instanceof PooledLiveQuery) || !wholesale || client) {
    return undefined
  }
  return new PooledWholesaleObserver(
    collection,
    onPreload,
  ) as unknown as LiveQueryObserver<T, TKey>
}

const forwardToCollection: ProxyHandler<PooledLiveQuery> = {
  get(view, property) {
    if (property in view) return Reflect.get(view, property, view)
    const collection = view.materialize()
    const value = Reflect.get(collection, property, collection)
    return typeof value === `function` ? value.bind(collection) : value
  },
}

/**
 * A pooled view for a query a partition can serve, or undefined. The view is
 * typed as the Collection it stands in for.
 */
export function createPooledLiveQuery(
  query: BaseQueryBuilder,
): Collection<any, any, any> | undefined {
  const ir = query._getQuery()
  const shape = poolableShape(ir)
  if (!shape || ir.from.type !== `collectionRef`) return undefined
  const source = ir.from.collection
  // Persisted restore and on-demand loading need the live-query Collection.
  if (
    source.config.syncMode === `on-demand` ||
    getPersistedReadinessSource(source.config)
  ) {
    return undefined
  }
  let partitions = partitionsBySource.get(source)
  if (!partitions) {
    partitions = new Map()
    partitionsBySource.set(source, partitions)
  }
  const { shapeKey } = shape
  let partition = partitions.get(shapeKey)
  if (!partition) {
    const owner = partitions
    partition = new Partition(source, shape.paths, () => owner.delete(shapeKey))
    partitions.set(shapeKey, partition)
  }
  // Observers read the view directly; users get its `publicCollection`.
  return new PooledLiveQuery(
    source,
    query,
    partition,
    shape.bucketKey,
  ) as unknown as Collection<any, any, any>
}
