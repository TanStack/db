import { SortedMap } from '../SortedMap.js'
import { normalizeValue } from '../utils/comparison.js'
import { isVirtualPropName } from '../virtual-props.js'
import { getPersistedReadinessSource } from '../persisted-readiness.js'
import { getWhereExpression } from './ir.js'
import { createLiveQueryCollection } from './live-query-collection.js'
import type { BasicExpression, QueryIR } from './ir.js'
import type { BaseQueryBuilder } from './builder/index.js'
import type { Collection, CollectionImpl } from '../collection/index.js'
import type { ChangeMessage, CollectionStatus } from '../types.js'
import type { CollectionEventHandler } from '../collection/events.js'

/**
 * Live queries that filter one source Collection only by `eq(field, literal)`
 * share one partition of that source per filtered field set. Each query reads
 * the group for its literal tuple, so mounting many queries of one shape
 * costs a lookup each instead of a compiled graph and a source subscription.
 *
 * A group holds the rows the partition's source subscription has published,
 * keyed by the same normalized equality that `eq` uses: a Date equals its
 * timestamp, `NaN` equals `NaN`, `-0` equals `0`, and nullish values match no
 * literal.
 */

type Row = Record<string, unknown>
type Listener = (changes: Array<ChangeMessage<Row, string | number>>) => void
type StatusListener = CollectionEventHandler<`status:change`>

interface PartitionGroup {
  // Key order, as in a live-query Collection without orderBy.
  rows: SortedMap<string | number, Row>
  listeners: Set<Listener>
  revision: number
  layoutRevision: number
}

// Matches the Collection lifecycle's floor for a never-subscribed Collection.
const UNSUBSCRIBED_RELEASE_FLOOR_MS = 50

const partitionsBySource = new WeakMap<object, Map<string, Partition>>()

// Typed so that 1, '1', and true stay distinct.
function equalityKey(value: unknown): string | undefined {
  const normalized = normalizeValue(value)
  const type = typeof normalized
  return type === `string` || type === `number` || type === `boolean`
    ? `${type}:${String(normalized)}`
    : undefined
}

// Length-prefixed, so no two part lists share an encoding.
function appendGroupKeyPart(groupKey: string, part: string): string {
  return `${groupKey}${part.length}:${part}`
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
  private readonly groups = new Map<string, PartitionGroup>()
  private subscription: { unsubscribe: () => void } | undefined
  private stopStatusEvents: (() => void) | undefined
  // One source status listener serves every view of this partition.
  readonly statusListeners = new Set<StatusListener>()
  private listenerCount = 0
  private gcTime = 0
  private hadListener = false
  /** Set when the source starts cleanup; groups keep their last rows. */
  terminated = false
  private releaseTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly source: CollectionImpl<any, any, any, any, any>,
    private readonly paths: Array<Array<string>>,
    private readonly onEmpty: () => void,
  ) {}

  groupKeyOf(row: Row | undefined): string | undefined {
    if (row === undefined) return undefined
    let groupKey = ``
    for (const path of this.paths) {
      const key = equalityKey(readPath(row, path))
      if (key === undefined) return undefined
      groupKey = appendGroupKeyPart(groupKey, key)
    }
    return groupKey
  }

  // Whether two versions of a row hold the same value in every field.
  private sameFields(a: Row, b: Row): boolean {
    return this.paths.every((path) =>
      Object.is(readPath(a, path), readPath(b, path)),
    )
  }

  group(key: string): PartitionGroup {
    let group = this.groups.get(key)
    if (!group) {
      group = {
        rows: new SortedMap(),
        listeners: new Set(),
        revision: 0,
        layoutRevision: 0,
      }
      this.groups.set(key, group)
    }
    return group
  }

  /**
   * Keep the shared source subscription open. Each view brings its query's
   * `gcTime`; the partition keeps the longest, so it never releases before
   * one of its views' own live-query Collection would have.
   */
  retain(gcTime?: number): void {
    if (gcTime !== undefined) {
      // As for a Collection, a non-positive or non-finite gcTime disables GC.
      const delay = gcTime > 0 && Number.isFinite(gcTime) ? gcTime : Infinity
      this.gcTime = Math.max(this.gcTime, delay)
    }
    if (this.terminated) return
    if (!this.subscription) {
      this.subscription = this.source.subscribeChanges(
        (changes) =>
          this.apply(changes as Array<ChangeMessage<Row, string | number>>),
        { includeInitialState: true },
      )
      this.stopStatusEvents = this.source.on(`status:change`, (event) => {
        // Like a live query, a pooled view fails for good when its source
        // starts cleanup; queries mounted later get a new partition.
        if (event.status === `cleaned-up`) this.terminate()
        const delivered = this.terminated
          ? { ...event, status: `error` as const }
          : event
        for (const listener of [...this.statusListeners]) listener(delivered)
        if (this.terminated) this.stopStatusEvents?.()
      })
    }
    this.scheduleRelease()
  }

  addListener(group: PartitionGroup, listener: Listener): void {
    this.retain()
    this.hadListener = true
    group.listeners.add(listener)
    this.listenerCount++
  }

  removeListener(group: PartitionGroup, listener: Listener): void {
    if (!group.listeners.delete(listener)) return
    this.listenerCount--
    this.scheduleRelease()
  }

  private terminate(): void {
    this.terminated = true
    clearTimeout(this.releaseTimer)
    this.release()
  }

  private release(): void {
    this.subscription?.unsubscribe()
    this.subscription = undefined
    this.onEmpty()
  }

  private scheduleRelease(): void {
    clearTimeout(this.releaseTimer)
    this.releaseTimer = undefined
    if (this.listenerCount > 0 || !Number.isFinite(this.gcTime)) return
    // Like a Collection that synced before anything subscribed, a view built
    // during a render gets a grace period to subscribe when it commits.
    const delay = this.hadListener
      ? this.gcTime
      : Math.max(this.gcTime, UNSUBSCRIBED_RELEASE_FLOOR_MS)
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = undefined
      if (this.listenerCount > 0) return
      this.stopStatusEvents?.()
      this.stopStatusEvents = undefined
      // Views outlive a release and may subscribe again, so they keep their
      // groups for the next subscription to refill.
      for (const group of this.groups.values()) {
        group.rows.clear()
        group.revision++
        group.layoutRevision++
      }
      this.release()
    }, delay)
  }

  private apply(changes: Array<ChangeMessage<Row, string | number>>): void {
    const touched = new Map<
      PartitionGroup,
      Array<ChangeMessage<Row, string | number>>
    >()
    const record = (
      group: PartitionGroup,
      change: ChangeMessage<Row, string | number>,
    ) => {
      const list = touched.get(group)
      if (list) list.push(change)
      else touched.set(group, [change])
      if (change.type !== `update`) group.layoutRevision++
    }
    for (const change of changes) {
      const next =
        change.type === `delete` ? undefined : this.groupKeyOf(change.value)
      const previous =
        change.type === `insert`
          ? undefined
          : change.type === `update` &&
              change.previousValue !== undefined &&
              this.sameFields(change.value, change.previousValue)
            ? next
            : this.groupKeyOf(
                change.type === `delete` ? change.value : change.previousValue,
              )
      if (previous !== undefined && previous !== next) {
        const group = this.group(previous)
        const old = group.rows.get(change.key)
        if (group.rows.delete(change.key)) {
          record(group, { type: `delete`, key: change.key, value: old! })
        }
      }
      if (next !== undefined) {
        const group = this.group(next)
        const existed = group.rows.has(change.key)
        group.rows.set(change.key, change.value)
        record(
          group,
          existed
            ? change.type === `update`
              ? change
              : { ...change, type: `update` }
            : { type: `insert`, key: change.key, value: change.value },
        )
      }
    }
    for (const [group, groupChanges] of touched) {
      group.revision++
      for (const listener of [...group.listeners]) listener(groupChanges)
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
  | { paths: Array<Array<string>>; shapeKey: string; groupKey: string }
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
  // Most shapes have one or two fields; a general sort costs more than both.
  if (conjuncts.length === 2) {
    if (conjuncts[1]!.pathKey < conjuncts[0]!.pathKey) conjuncts.reverse()
  } else if (conjuncts.length > 2) {
    conjuncts.sort((a, b) => (a.pathKey < b.pathKey ? -1 : 1))
  }
  const paths: Array<Array<string>> = []
  let shapeKey = ``
  let groupKey = ``
  for (const { path, pathKey, literalKey } of conjuncts) {
    paths.push(path)
    // Each JSON path delimits itself, so concatenation stays unambiguous.
    shapeKey += pathKey
    groupKey = appendGroupKeyPart(groupKey, literalKey)
  }
  return { paths, shapeKey, groupKey }
}

/**
 * One query's view of its group, read by the live-query observer. Users get
 * `publicCollection` instead, which builds the query's live-query Collection
 * on first use and forwards every member to it.
 */
class PooledLiveQuery {
  readonly isLoadingSubset = false
  // No persisted readiness, single-result config, or layout channel.
  readonly config = undefined
  readonly _subscribeLayoutChanges = undefined
  private readonly group: PartitionGroup
  private collection: Collection<any, any, any> | undefined = undefined

  constructor(
    private readonly source: CollectionImpl<any, any, any, any, any>,
    private readonly query: BaseQueryBuilder,
    private readonly partition: Partition,
    groupKey: string,
    private readonly gcTime: number,
  ) {
    this.group = partition.group(groupKey)
    partition.retain(gcTime)
  }

  get status(): CollectionStatus {
    return this.partition.terminated ? `error` : this.source.status
  }

  get _stateRevision(): number {
    return this.group.revision
  }

  get _layoutRevision(): number {
    return this.group.layoutRevision
  }

  /** The group's rows, in key order. */
  get rows(): SortedMap<string | number, Row> {
    return this.group.rows
  }

  entries(): IterableIterator<[string | number, Row]> {
    return this.group.rows.entries()
  }

  subscribeChanges(
    callback: Listener,
    options: { includeInitialState?: boolean } = {},
  ): { unsubscribe: () => void } {
    this.partition.addListener(this.group, callback)
    if (options.includeInitialState) {
      callback(
        [...this.group.rows].map(([key, value]) => ({
          type: `insert`,
          key,
          value,
        })),
      )
    }
    return {
      unsubscribe: () => this.partition.removeListener(this.group, callback),
    }
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
      gcTime: this.gcTime,
    }))
  }
}

// The observer reads the view itself; users get the live-query Collection.
const forwardToCollection: ProxyHandler<PooledLiveQuery> = {
  get(view, property) {
    const collection = view.materialize()
    const value = Reflect.get(collection, property, collection)
    return typeof value === `function` ? value.bind(collection) : value
  },
  has(view, property) {
    return Reflect.has(view.materialize(), property)
  },
}

/**
 * A pooled view for a query a partition can serve, or undefined. The view is
 * typed as the Collection it stands in for.
 */
export function createPooledLiveQuery(
  query: BaseQueryBuilder,
  // A Collection's default when the adapter gives none.
  { gcTime = 300_000 }: { gcTime?: number } = {},
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
    shape.groupKey,
    gcTime,
  ) as unknown as Collection<any, any, any>
}
