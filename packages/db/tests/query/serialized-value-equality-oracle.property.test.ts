/**
 * # Do value classes with `toJSON()` compare by value in queries?
 *
 * Law and source: a class instance that defines `toJSON()` and is not one of
 * the built-in value types (Date, Temporal, binary data) is a value. Query
 * equality compares two such instances by their serialized value, so `eq`,
 * exact index lookups, live-query `where` clauses and join conditions match a
 * distinct instance that serializes to the same value. A plain value equal to
 * that serialization stays unequal, and query identity and
 * `getStableValueHash` follow the same relation. Authority: issue #2459 and
 * the "Value classes" section of `docs/guides/live-queries.md`.
 *
 * A Map, Set or ArrayBuffer is a built-in value even when a subclass defines
 * `toJSON()`: it keeps its built-in rule, comparing by reference, so it never
 * equals a value class that serializes alike. Authority: the same section's
 * built-in rule, which names these types.
 *
 * A range predicate uses the documented order of value classes: their
 * serialized value, never `valueOf()`. A primitive sorts before a value class
 * and any other object after it. Equal captures are one query, so a predicate
 * must not depend on anything outside the serialization. Plain records, arrays
 * and other excluded objects keep reference semantics without their `toJSON`
 * property being read. Arrays compare element by element in one order that
 * agrees with sorting; where sorting would order an excluded object leaf by
 * reference, the range ties, so two captures with one query identity keep one
 * result whether they share that object or hold a distinct one of the same
 * shape. An array that the row and the capture share is ordered like a copy of
 * it.
 *
 * An index and a filter follow the stored row. A sync write can replace a
 * reference-valued field with a deep-equal instance. An unfiltered subscriber
 * is told nothing, a subscriber filtered on the old instance loses the row, one
 * filtered on the new instance gains it, one whose filter still matches is told
 * nothing, and a later update must still remove that row from the index. A
 * query reads the new instance too: its joins, functional filters, ordered
 * results and filters downstream of a projection follow it, as do pooled views,
 * and a row it keeps is not republished. An Effect's update for one row survives a deep-equal
 * replacement of another row in the same batch.
 *
 * Why an example can miss the failure: a probe that is the stored instance
 * matches under reference equality too, an index can agree with a scan until
 * the instance that represents a group of equal values leaves it, and a join
 * can match through one side's index while the other side compares
 * references.
 *
 * Model: `modelEq` compares record references by their table and ID fields.
 * It never calls `toJSON()` and imports no query normalization. A text value
 * spelled like a record reference is a different kind, and null is UNKNOWN.
 * A built-in carrier (a Map, Set or ArrayBuffer subclass whose `toJSON()`
 * spells a record reference) compares by reference, and every materialized
 * value is a fresh instance, so it equals nothing.
 *
 * History grammar: up to four source rows and three join rows hold a record
 * reference, its text look-alike, a built-in carrier look-alike, or null, over
 * two tables and two IDs. The
 * source has no index, a BasicIndex, or a BTreeIndex. Up to three synced
 * updates follow; a weighted one replaces a row's reference with a distinct
 * equal instance, so an index must keep a group when its first instance
 * leaves. Every row, update and probe builds a fresh instance, so no match
 * can come from reference identity.
 *
 * Production driver: `currentStateAsChanges({ where })` before and after the
 * index is created (an index spy confirms the indexed route), a live-query
 * Collection filtered by `eq` against the probe, and an inner join of the
 * source with the join rows on their references, read after the initial load
 * and after every update. Query identity, demand keys and
 * `getStableValueHash` are read for two distinct equal probes. Each stored
 * built-in carrier is also a reference probe: a filtered subscription, a live
 * query, a functional filter, a filter over a projection, and a join with a
 * Collection that holds the same instance, an Effect, and pooled views with
 * attached and detached observers. Each row also has a subscription and a
 * pooled view filtered on its ID, which stay matched, and an unfiltered live
 * query and an Effect watch every row. Subscriptions and queries are read
 * straight after each commit, before anything yields, and Effects after they
 * have run.
 *
 * Refinement check: every read returns exactly the model's keys or pairs, and
 * the identities of equal probes are equal, while a record probe's identity
 * differs from its text look-alike's and from an unequal record's, including
 * inside a nested query key. Each record instance has its own `valueOf()`, so
 * a range read that used it disagrees with the model. A built-in carrier spelled like the
 * probe never matches it, in a scan, an index, a filter or a join, and sorts
 * as its own run. Every reader of a reference probe holds exactly the rows
 * that store its instance. The unfiltered subscription and live query, the ID
 * filter and the Effect each receive one update when the row's value changed
 * and nothing when it was replaced by a deep-equal row.
 *
 * A `distinct` query shows an instance some row still holds.
 *
 * Known omissions: `inArray`, on-demand and persisted sources, exact-output (`select`) identity, which keeps reference
 * semantics, and classes whose `toJSON()` throws or returns a non-JSON value.
 */
import { fc } from '@fast-check/vitest'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import {
  and,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  lt,
  lte,
} from '../../src/query/index.js'
import {
  getLoadSubsetDemandKey,
  getQueryIdentity,
  getStableValueHash,
} from '../../src/query/ir-stable-identity.js'
import { createEffect } from '../../src/query/effect.js'
import { createPooledLiveQuery } from '../../src/query/pooled-live-query.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { getRuntimeReferenceIdentity } from '../../src/query/runtime-reference-identity.js'
import { DEFAULT_COMPARE_OPTIONS } from '../../src/utils.js'
import { ascComparator } from '../../src/utils/comparison.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../utils.js'
import { createDeferred } from '../../src/deferred.js'

const property = `serialized-value.query-equality`

// A built query is the builder class this entry point takes.
const poolQuery = (query: unknown) => createPooledLiveQuery(query as never)

const reachStates = [
  // A row matched a probe that is a distinct, equal instance.
  `distinct-instance-matched`,
  // An update replaced a matching reference with a distinct equal instance
  // while an index held it.
  `indexed-equal-replacement`,
  // A join matched references held by two Collections.
  `join-matched`,
  // An ordered read held two distinct, equal record references.
  `ordered-equal-run`,
  // A source row held a built-in carrier spelled like a record probe.
  `builtin-lookalike-held`,
  // A range read compared a distinct record equal to the probe.
  `range-equal-record`,
  // Identity compared a record probe with an unequal record.
  `unequal-record-probe`,
  // A plain record or array held a toJSON accessor that must not be read.
  `excluded-accessor-held`,
  // An array range compared captures with shared and distinct object leaves.
  `mixed-array-range`,
  // A sync write replaced an indexed reference value with a deep-equal one.
  `indexed-reference-replaced`,
  // A deep-equal replacement took a row out of a filter on its old instance.
  `reference-filter-left`,
  // A deep-equal replacement put a row into a filter on its new instance.
  `reference-filter-entered`,
  // A deep-equal replacement left a filter's answer unchanged.
  `reference-filter-kept`,
  // An array range compared a row that holds the capture array itself.
  `shared-array-range`,
  // A deep-equal replacement left a filter that still matches the row.
  `reference-filter-stayed-matched`,
  // A deep-equal replacement ended a join on a shared instance.
  `shared-reference-join-left`,
  // A batch held a deep-equal replacement and another row's real update.
  `effect-update-beside-replacement`,
  // A deep-equal replacement moved a row in a pooled group's order.
  `pooled-order-moved`,
  // A deep-equal replacement retired the instance a `distinct` query showed.
  `distinct-shown-replaced`,
] as const
type ReachState = (typeof reachStates)[number]

type Table = `user` | `org`
type RefSpec =
  | { kind: `record`; table: Table; id: `a` | `b` }
  | { kind: `text`; table: Table; id: `a` | `b` }
  | { kind: `builtin`; carrier: Carrier; table: Table; id: `a` | `b` }
  | { kind: `null` }
type Carrier = `Map` | `Set` | `ArrayBuffer` | `PlainRecord` | `Array`
type UnequalBy = `table` | `id` | `both`
type IndexMode = `none` | `basic` | `btree`
type History = {
  rows: Array<RefSpec>
  joinRows: Array<RefSpec>
  index: IndexMode
  // `sameValue` replaces the row's current value with a distinct, equal
  // instance; otherwise the row takes `value`. `row` wraps to the rows.
  updates: Array<{ row: number; value: RefSpec; sameValue: boolean }>
  probe: Extract<RefSpec, { kind: `record` | `text` }>
  unequalBy: UnequalBy
}

let nextRank = 0

/** A record reference shaped like the `surrealdb` SDK's `RecordId`. */
class RecordRef {
  readonly table: string
  readonly id: string
  // Differs per instance, so an order that reads valueOf() splits equal values.
  readonly rank = nextRank++
  constructor(table: string, id: string) {
    this.table = table
    this.id = id
  }
  toString(): string {
    return `${this.table}:${this.id}`
  }
  toJSON(): string {
    return this.toString()
  }
  valueOf(): number {
    return this.rank
  }
  equals(other: unknown): boolean {
    return (
      other instanceof RecordRef &&
      other.table === this.table &&
      other.id === this.id
    )
  }
}

// Built-in carriers: subclasses of Map, Set and ArrayBuffer whose toJSON()
// spells a record reference, as RecordRef's does.
class RecordMap extends Map<never, never> {
  readonly ref: string
  constructor(ref: string) {
    super()
    this.ref = ref
  }
  toJSON(): string {
    return this.ref
  }
}
class RecordSet extends Set<never> {
  readonly ref: string
  constructor(ref: string) {
    super()
    this.ref = ref
  }
  toJSON(): string {
    return this.ref
  }
}
class RecordBuffer extends ArrayBuffer {
  readonly ref: string
  constructor(ref: string) {
    super(0)
    this.ref = ref
  }
  toJSON(): string {
    return this.ref
  }
}

// Excluded objects keep reference semantics, so their toJSON is never read.
function withThrowingToJSON<T extends object>(target: T): T {
  return Object.defineProperty(target, `toJSON`, {
    get() {
      throw new Error(`an excluded object's toJSON was read`)
    },
  })
}

type Row = { id: string; ref: object | string | null }
type ScopedRow = Row & { version: number }

// Row equality compares its enumerable field, so two versions are deep-equal.
// Effect publication equality compares a class by identity and tells them apart.
class PrivateVersion {
  readonly kind = `version`
  #version: number
  constructor(version: number) {
    this.#version = version
  }
  get version(): number {
    return this.#version
  }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// `eq` keeps a pair only when TRUE: null is UNKNOWN, a record reference
// equals a record reference with the same table and ID, a text value equals
// the same text, and the two kinds never equal each other. A built-in carrier
// compares by reference and every value here is a fresh instance, so it
// equals nothing.
function modelEq(left: RefSpec, right: RefSpec): boolean {
  if (left.kind === `null` || right.kind === `null`) return false
  if (left.kind === `builtin` || right.kind === `builtin`) return false
  return (
    left.kind === right.kind &&
    left.table === right.table &&
    left.id === right.id
  )
}

type RangeOp = `gt` | `gte` | `lt` | `lte`

// A record probe's order: text before it, other objects after it, and records
// by their table and ID text. Null is UNKNOWN, so it never matches.
function modelRangeKeys(
  rows: ReadonlyMap<string, RefSpec>,
  probe: Extract<RefSpec, { kind: `record` }>,
  op: RangeOp,
) {
  const spelled = `${probe.table}:${probe.id}`
  const order = (spec: RefSpec): number => {
    if (spec.kind === `text`) return -1
    if (spec.kind === `builtin`) return 1
    if (spec.kind === `null`) return 0
    const value = `${spec.table}:${spec.id}`
    return value < spelled ? -1 : value > spelled ? 1 : 0
  }
  const keep = (result: number) =>
    op === `gt`
      ? result > 0
      : op === `gte`
        ? result >= 0
        : op === `lt`
          ? result < 0
          : result <= 0
  return [...rows]
    .filter(([, spec]) => spec.kind !== `null` && keep(order(spec)))
    .map(([key]) => key)
    .sort()
}

function unequalRecord(
  probe: Extract<RefSpec, { kind: `record` }>,
  by: UnequalBy,
): Extract<RefSpec, { kind: `record` }> {
  const table = probe.table === `user` ? `org` : `user`
  const id = probe.id === `a` ? `b` : `a`
  return {
    kind: `record`,
    table: by === `id` ? probe.table : table,
    id: by === `table` ? probe.id : id,
  }
}

// A sync write whose row is deep-equal to the stored one publishes nothing.
// Row equality compares a Map or a Set by its entries, and each one here is
// empty, so two of one carrier are deep-equal whatever they spell. Each record
// instance carries its own rank, so a record is never deep-equal.
function modelSilent(previous: RefSpec, next: RefSpec): boolean {
  if (previous.kind === `null` || next.kind === `null`)
    return previous.kind === next.kind
  if (previous.kind === `record` || previous.kind !== next.kind) return false
  if (previous.kind === `builtin`) {
    const carrier = (next as typeof previous).carrier
    if (previous.carrier !== carrier) return false
    if (carrier === `Map` || carrier === `Set`) return true
  }
  return previous.table === next.table && previous.id === next.id
}

function modelKeys(rows: ReadonlyMap<string, RefSpec>, probe: RefSpec) {
  return [...rows]
    .filter(([, value]) => modelEq(value, probe))
    .map(([key]) => key)
    .sort()
}

// Sorting keeps equal values together: each sort class occupies one run. A
// built-in carrier equals only itself, so it is its own class.
function sortClass(spec: RefSpec, key: string): string {
  if (spec.kind === `null`) return `null`
  if (spec.kind === `builtin`) return `builtin:${key}`
  return `${spec.kind}:${spec.table}:${spec.id}`
}

function expectContiguousRuns(
  keys: ReadonlyArray<string>,
  rows: ReadonlyMap<string, RefSpec>,
  label: string,
): void {
  expect([...keys].sort(), `${label}: keys`).toEqual([...rows.keys()].sort())
  const closed = new Set<string>()
  let current: string | undefined
  for (const key of keys) {
    const next = sortClass(rows.get(key)!, key)
    if (next === current) continue
    expect(closed.has(next), `${label}: ${next} split by ${current}`).toBe(
      false,
    )
    if (current !== undefined) closed.add(current)
    current = next
  }
}

function modelPairs(
  rows: ReadonlyMap<string, RefSpec>,
  joinRows: ReadonlyMap<string, RefSpec>,
) {
  const pairs: Array<string> = []
  for (const [left, value] of rows)
    for (const [right, joinValue] of joinRows)
      if (modelEq(value, joinValue)) pairs.push(`${left}|${right}`)
  return pairs.sort()
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const tableArbitrary = fc.constantFrom<Table>(`user`, `org`)
const idArbitrary = fc.constantFrom<`a` | `b`>(`a`, `b`)
const probeArbitrary = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant(`record` as const),
      table: tableArbitrary,
      id: idArbitrary,
    }),
  },
  fc.record({
    kind: fc.constant(`text` as const),
    table: tableArbitrary,
    id: idArbitrary,
  }),
)
const carrierArbitrary = fc.constantFrom<Carrier>(
  `Map`,
  `Set`,
  `ArrayBuffer`,
  `PlainRecord`,
  `Array`,
)
const builtinArbitrary = fc.record({
  kind: fc.constant(`builtin` as const),
  carrier: carrierArbitrary,
  table: tableArbitrary,
  id: idArbitrary,
})
const refArbitrary: fc.Arbitrary<RefSpec> = fc.oneof(
  { weight: 6, arbitrary: probeArbitrary },
  { weight: 2, arbitrary: builtinArbitrary },
  fc.record({ kind: fc.constant(`null` as const) }),
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  rows: fc.array(refArbitrary, { minLength: 1, maxLength: 4 }),
  joinRows: fc.array(refArbitrary, { maxLength: 3 }),
  index: fc.constantFrom<IndexMode>(`none`, `basic`, `btree`),
  updates: fc.array(
    fc.record({
      row: fc.nat({ max: 3 }),
      value: refArbitrary,
      sameValue: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  probe: probeArbitrary,
  unequalBy: fc.constantFrom<UnequalBy>(`table`, `id`, `both`),
})

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function materializeCarrier(carrier: Carrier, ref: string): object {
  switch (carrier) {
    case `Map`:
      return new RecordMap(ref)
    case `Set`:
      return new RecordSet(ref)
    case `ArrayBuffer`:
      return new RecordBuffer(ref)
    case `PlainRecord`:
      return withThrowingToJSON({ ref })
    case `Array`:
      return withThrowingToJSON([ref])
  }
}

// Every call builds a fresh instance, so equal references are never the same
// object.
function materialize(spec: RefSpec): object | string | null {
  switch (spec.kind) {
    case `record`:
      return new RecordRef(spec.table, spec.id)
    case `text`:
      return `${spec.table}:${spec.id}`
    case `builtin`:
      return materializeCarrier(spec.carrier, `${spec.table}:${spec.id}`)
    case `null`:
      return null
  }
}

function rowKey(index: number) {
  return `r${index}`
}

function joinKey(index: number) {
  return `j${index}`
}

let collectionId = 0
// More than a history's rows, so a limit never hides a match.
const MAX_ORDERED_ROWS = 8

async function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  // Later resources read earlier ones, so they are cleaned up first.
  const cleanups: Array<() => unknown> = []
  const cleanup = (step: () => unknown) => cleanups.unshift(step)
  await withOracleCleanup(async () => {
    const run = collectionId++
    const indexType =
      history.index === `basic`
        ? BasicIndex
        : history.index === `btree`
          ? BTreeIndex
          : undefined
    const model = new Map(
      history.rows.map((spec, index) => [rowKey(index), spec] as const),
    )
    const joinModel = new Map(
      history.joinRows.map((spec, index) => [joinKey(index), spec] as const),
    )
    // The instance each row stores: a reference probe matches by identity.
    const stored = new Map(
      history.rows.map(
        (spec, index) => [rowKey(index), materialize(spec)] as const,
      ),
    )
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `serialized-value-source-${run}`,
        getKey: (row) => row.id,
        initialData: [...stored].map(([id, ref]) => ({ id, ref })),
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    cleanup(() => source.cleanup())
    const joined = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `serialized-value-join-${run}`,
        getKey: (row) => row.id,
        initialData: history.joinRows.map((spec, index) => ({
          id: joinKey(index),
          ref: materialize(spec),
        })),
        autoIndex: `off`,
      }),
    )
    cleanup(() => joined.cleanup())
    await source.stateWhenReady()
    await joined.stateWhenReady()

    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(materialize(history.probe)),
    ])
    const scanKeys = () =>
      source
        .currentStateAsChanges({ where })!
        .map((change) => String(change.key))
        .sort()

    expect(scanKeys(), `initial scan`).toEqual(modelKeys(model, history.probe))

    const index =
      indexType === undefined ? undefined : source.createIndex((row) => row.ref)
    const lookup = index === undefined ? undefined : vi.spyOn(index, `lookup`)

    const filtered = createLiveQueryCollection({
      id: `serialized-value-filter-${run}`,
      query: (q) =>
        q
          .from({ item: source })
          .where(({ item }) => eq(item.ref, materialize(history.probe))),
    })
    cleanup(() => filtered.cleanup())
    const pairs = createLiveQueryCollection({
      id: `serialized-value-pairs-${run}`,
      query: (q) =>
        q
          .from({ item: source })
          .join(
            { other: joined },
            ({ item, other }) => eq(item.ref, other.ref),
            `inner`,
          )
          .select(({ item, other }) => ({
            item: item.id,
            other: other.id,
          })),
    })
    cleanup(() => pairs.cleanup())
    await filtered.preload()
    await pairs.preload()

    const recordProbe =
      history.probe.kind === `record` ? history.probe : undefined
    const rangeOps = { gt, gte, lt, lte }
    const ranges = recordProbe
      ? (Object.keys(rangeOps) as Array<RangeOp>).map((op) => {
          const live = createLiveQueryCollection({
            id: `serialized-value-${op}-${run}`,
            query: (q) =>
              q
                .from({ item: source })
                .where(({ item }) =>
                  rangeOps[op](
                    item.ref as never,
                    materialize(recordProbe) as never,
                  ),
                ),
          })
          cleanup(() => live.cleanup())
          return { op, live }
        })
      : []
    for (const range of ranges) await range.live.preload()

    const published: Array<string> = []
    const unfiltered = source.subscribeChanges((changes) => {
      for (const change of changes) published.push(String(change.key))
    })
    cleanup(() => unfiltered.unsubscribe())

    type ReferenceProbe = {
      instance: object
      scan: () => Array<string>
      subscribed: Set<string>
      readers: Record<string, () => Array<string>>
      // Effects run after the commit, so they are read once they have.
      effectReaders: Record<string, () => Array<string>>
    }
    const referenceProbes: Array<ReferenceProbe> = []
    const projected = createLiveQueryCollection({
      id: `serialized-value-projected-${run}`,
      query: (q) =>
        q
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, ref: item.ref })),
    })
    cleanup(() => projected.cleanup())
    await projected.preload()
    // Joined on row IDs, so a replacement changes no join key.
    const links = createCollection(
      mockSyncCollectionOptions<{ id: string; item: string }>({
        id: `serialized-value-links-${run}`,
        getKey: (row) => row.id,
        initialData: [...model.keys()].map((key) => ({ id: key, item: key })),
        autoIndex: `off`,
      }),
    )
    cleanup(() => links.cleanup())
    await links.stateWhenReady()
    const joinedProjection = (ordered: boolean) => {
      const query = createLiveQueryCollection({
        id: `serialized-value-joined-${ordered}-${run}`,
        query: (q) => {
          const joined = q
            .from({ link: links })
            .join(
              { item: source },
              ({ link, item }) => eq(link.item, item.id),
              `inner`,
            )
          return (
            ordered ? joined.orderBy(({ link }) => link.id) : joined
          ).select(({ item }) => ({ id: item.id, ref: item.ref }))
        },
      })
      cleanup(() => query.cleanup())
      return query
    }
    const joinedProjections = {
      'filter over a joined projection': joinedProjection(false),
      'filter over an ordered join': joinedProjection(true),
    }
    await Promise.all(
      Object.values(joinedProjections).map((query) => query.preload()),
    )

    // Readers of every row. A deep-equal replacement must reach none of them.
    const stableEvents = new Map<string, Array<string>>()
    const pooledStableEvents = new Map<string, Array<string>>()
    const pooledResidualEvents = new Map<string, Array<string>>()
    const pooledKeptObservers: Array<
      ReturnType<typeof createLiveQueryObserver<Row, string>>
    > = []
    for (const key of model.keys()) {
      const pooledEvents: Array<string> = []
      pooledStableEvents.set(key, pooledEvents)
      const pooledStable = poolQuery(
        new Query()
          .from({ item: source })
          .where(({ item }) => eq(item.id, key)),
      )!
      cleanup(() => pooledStable.cleanup())
      const pooledSubscription = pooledStable.subscribeChanges((changes) => {
        for (const change of changes) pooledEvents.push(change.type)
      })
      cleanup(() => pooledSubscription.unsubscribe())
      // Its residual conjunct always passes, so the row stays matched.
      const pooledResidual = poolQuery(
        new Query()
          .from({ item: source })
          .where(({ item }) => and(eq(item.id, key), gte(item.id, key))),
      )!
      cleanup(() => pooledResidual.cleanup())
      const residualEvents: Array<string> = []
      pooledResidualEvents.set(key, residualEvents)
      const residualSubscription = pooledResidual.subscribeChanges(
        (changes) => {
          for (const change of changes) residualEvents.push(change.type)
        },
      )
      cleanup(() => residualSubscription.unsubscribe())
      for (const view of [pooledStable, pooledResidual]) {
        const observer = createLiveQueryObserver<Row, string>(view as never)
        cleanup(() => observer.dispose())
        pooledKeptObservers.push(observer)
      }
      const events: Array<string> = []
      stableEvents.set(key, events)
      const stable = source.subscribeChanges(
        (changes) => {
          for (const change of changes) events.push(change.type)
        },
        {
          includeInitialState: true,
          whereExpression: new Func<boolean>(`eq`, [
            new PropRef([`id`]),
            new Value(key),
          ]),
        },
      )
      cleanup(() => stable.unsubscribe())
    }
    const everyRow = createLiveQueryCollection({
      id: `serialized-value-every-row-${run}`,
      query: (q) => q.from({ item: source }),
    })
    cleanup(() => everyRow.cleanup())
    await everyRow.preload()
    const livePublished: Array<string> = []
    const everyRowChanges = everyRow.subscribeChanges(
      (changes) => {
        for (const change of changes)
          livePublished.push(`${change.type}:${String(change.key)}`)
      },
      { includeInitialState: true },
    )
    cleanup(() => everyRowChanges.unsubscribe())
    const effectEvents: Array<string> = []
    const effect = createEffect<Row, string>({
      id: `serialized-value-effect-${run}`,
      query: (q) => q.from({ item: source }),
      skipInitial: true,
      onEnter: (event) => {
        effectEvents.push(`enter:${event.key}`)
      },
      onExit: (event) => {
        effectEvents.push(`exit:${event.key}`)
      },
      onUpdate: (event) => {
        effectEvents.push(`update:${event.key}`)
      },
    })
    cleanup(() => effect.dispose())
    await new Promise((resolve) => setTimeout(resolve, 0))

    const watchReference = async (instance: object) => {
      const referenceWhere = new Func<boolean>(`eq`, [
        new PropRef([`ref`]),
        new Value(instance),
      ])
      const subscribed = new Set<string>()
      const subscription = source.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) subscribed.delete(String(change.key))
            else subscribed.add(String(change.key))
          }
        },
        { includeInitialState: true, whereExpression: referenceWhere },
      )
      cleanup(() => subscription.unsubscribe())
      const live = createLiveQueryCollection({
        id: `serialized-value-reference-${run}-${referenceProbes.length}`,
        query: (q) =>
          q
            .from({ item: source })
            .where(({ item }) => eq(item.ref, instance as never)),
      })
      cleanup(() => live.cleanup())
      const position = referenceProbes.length
      const functional = createLiveQueryCollection({
        id: `serialized-value-functional-${run}-${position}`,
        query: (q) =>
          q.from({ item: source }).fn.where((row) => row.item.ref === instance),
      })
      cleanup(() => functional.cleanup())
      const downstream = createLiveQueryCollection({
        id: `serialized-value-downstream-${run}-${position}`,
        query: (q) =>
          q
            .from({ item: projected })
            .where(({ item }) => eq(item.ref as never, instance as never)),
      })
      cleanup(() => downstream.cleanup())
      const peer = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `serialized-value-peer-${run}-${position}`,
          getKey: (row) => row.id,
          initialData: [{ id: `peer`, ref: instance }],
          autoIndex: `off`,
        }),
      )
      cleanup(() => peer.cleanup())
      await peer.stateWhenReady()
      const sharedJoin = createLiveQueryCollection({
        id: `serialized-value-shared-join-${run}-${position}`,
        query: (q) =>
          q
            .from({ item: source })
            .join(
              { other: peer },
              ({ item, other }) => eq(item.ref, other.ref),
              `inner`,
            )
            .select(({ item }) => ({ id: item.id })),
      })
      cleanup(() => sharedJoin.cleanup())
      const ordered = createLiveQueryCollection({
        id: `serialized-value-ordered-${run}-${position}`,
        query: (q) =>
          q
            .from({ item: source })
            .fn.where((row) => row.item.ref === instance)
            .orderBy(({ item }) => item.id)
            .limit(MAX_ORDERED_ROWS),
      })
      cleanup(() => ordered.cleanup())
      const orderedProjection = createLiveQueryCollection({
        id: `serialized-value-ordered-projection-${run}-${position}`,
        query: (q) =>
          q
            .from({ item: source })
            .orderBy(({ item }) => item.id)
            .select(({ item }) => ({ id: item.id, ref: item.ref })),
      })
      cleanup(() => orderedProjection.cleanup())
      const overOrdered = createLiveQueryCollection({
        id: `serialized-value-over-ordered-${run}-${position}`,
        query: (q) =>
          q
            .from({ item: orderedProjection })
            .where(({ item }) => eq(item.ref as never, instance as never)),
      })
      cleanup(() => overOrdered.cleanup())
      await Promise.all(
        [live, functional, downstream, sharedJoin, ordered, overOrdered].map(
          (query) => query.preload(),
        ),
      )
      const inEffect = new Set<string>()
      const referenceEffect = createEffect<Row, string>({
        id: `serialized-value-reference-effect-${run}-${position}`,
        query: (q) =>
          q.from({ item: source }).fn.where((row) => row.item.ref === instance),
        onEnter: (event) => {
          inEffect.add(event.key)
        },
        onExit: (event) => {
          inEffect.delete(event.key)
        },
      })
      cleanup(() => referenceEffect.dispose())
      await new Promise((resolve) => setTimeout(resolve, 0))
      const idsOf = (query: { toArray: Array<{ id: string }> }) => () =>
        query.toArray.map((row) => row.id).sort()
      const overJoins: Record<string, () => Array<string>> = {}
      for (const [name, base] of Object.entries(joinedProjections)) {
        const overJoin = createLiveQueryCollection({
          id: `serialized-value-over-join-${name}-${run}-${position}`,
          query: (q) =>
            q
              .from({ item: base })
              .where(({ item }) => eq(item.ref as never, instance as never)),
        })
        cleanup(() => overJoin.cleanup())
        await overJoin.preload()
        overJoins[name] = idsOf(overJoin)
      }
      // A pooled view needs an equality to group by, so each row has its own.
      const pooledObservers = [...model.keys()].flatMap((key) => {
        const view = poolQuery(
          new Query()
            .from({ item: source })
            .where(({ item }) =>
              and(eq(item.id, key), eq(item.ref, instance as never)),
            ),
        )!
        cleanup(() => view.cleanup())
        const attached = createLiveQueryObserver<Row, string>(view as never)
        cleanup(() => attached.dispose())
        const stopAttached = attached.subscribe(() => {})
        cleanup(stopAttached)
        const detached = createLiveQueryObserver<Row, string>(view as never)
        cleanup(() => detached.dispose())
        return [{ attached, detached }]
      })
      const pooledIds = (which: `attached` | `detached`) => () =>
        pooledObservers
          .flatMap((observers) =>
            (observers[which].getSnapshot().data as Array<Row>).map(
              (row) => row.id,
            ),
          )
          .sort()
      referenceProbes.push({
        instance,
        scan: () =>
          source
            .currentStateAsChanges({ where: referenceWhere })!
            .map((change) => String(change.key))
            .sort(),
        subscribed,
        readers: {
          'live query': idsOf(live),
          'functional filter': idsOf(functional),
          'filter over a projection': idsOf(downstream),
          'shared-reference join': idsOf(sharedJoin),
          'ordered query': idsOf(ordered),
          'filter over an ordered projection': idsOf(overOrdered),
          ...overJoins,
          'pooled view, attached': pooledIds(`attached`),
          'pooled view, detached': pooledIds(`detached`),
        },
        effectReaders: { Effect: () => [...inEffect].sort() },
      })
    }
    for (const [key, spec] of model) {
      if (spec.kind === `builtin`)
        await watchReference(stored.get(key) as object)
    }

    const distinctRefs = createLiveQueryCollection({
      id: `serialized-value-distinct-${run}`,
      query: (q) =>
        q
          .from({ item: source })
          .select(({ item }) => ({ ref: item.ref }))
          .distinct(),
    })
    cleanup(() => distinctRefs.cleanup())
    await distinctRefs.preload()

    const orderedKeys = () =>
      source
        .currentStateAsChanges({
          orderBy: [
            {
              expression: new PropRef([`ref`]),
              compareOptions: DEFAULT_COMPARE_OPTIONS,
            },
          ],
        })!
        .map((change) => String(change.key))

    const holdersOf = (instance: object) =>
      [...stored].filter(([, value]) => value === instance).map(([key]) => key)
    const checkEffectReaders = (checkpoint: string) => {
      for (const [position, probe] of referenceProbes.entries()) {
        for (const [reader, read] of Object.entries(probe.effectReaders)) {
          expect(
            read(),
            `${checkpoint}: reference probe ${position}: ${reader}`,
          ).toEqual(holdersOf(probe.instance))
        }
      }
    }

    const check = (checkpoint: string) => {
      const expectedKeys = modelKeys(model, history.probe)
      const expectedPairs = modelPairs(model, joinModel)
      expect(scanKeys(), `${checkpoint}: scan`).toEqual(expectedKeys)
      for (const [position, probe] of referenceProbes.entries()) {
        const holders = holdersOf(probe.instance)
        const label = `${checkpoint}: reference probe ${position}`
        expect(probe.scan(), `${label}: scan`).toEqual(holders)
        expect([...probe.subscribed].sort(), `${label}: subscription`).toEqual(
          holders,
        )
        for (const [reader, read] of Object.entries(probe.readers)) {
          expect(read(), `${label}: ${reader}`).toEqual(holders)
        }
      }
      const held = new Set<unknown>(stored.values())
      for (const row of distinctRefs.toArray) {
        expect(
          held.has(row.ref),
          `${checkpoint}: distinct row holds a live instance`,
        ).toBe(true)
      }
      expectContiguousRuns(orderedKeys(), model, `${checkpoint}: ordered`)
      const recordClasses = [...model.values()]
        .filter((spec) => spec.kind === `record`)
        .map((spec) => sortClass(spec, ``))
      if (new Set(recordClasses).size < recordClasses.length)
        reach(`ordered-equal-run`)
      const probe = history.probe
      if (
        probe.kind === `record` &&
        [...model.values()].some(
          (spec) =>
            spec.kind === `builtin` &&
            spec.table === probe.table &&
            spec.id === probe.id,
        )
      )
        reach(`builtin-lookalike-held`)
      if (lookup !== undefined) {
        lookup.mockClear()
        expect(scanKeys(), `${checkpoint}: indexed scan`).toEqual(expectedKeys)
        expect(lookup, `${checkpoint}: index route`).toHaveBeenCalled()
      }
      expect(
        filtered.toArray.map((row) => row.id).sort(),
        `${checkpoint}: live-query where`,
      ).toEqual(expectedKeys)
      expect(
        pairs.toArray.map((row) => `${row.item}|${row.other}`).sort(),
        `${checkpoint}: join`,
      ).toEqual(expectedPairs)
      if (history.probe.kind === `record` && expectedKeys.length > 0)
        reach(`distinct-instance-matched`)
      if (recordProbe !== undefined) {
        for (const { op, live } of ranges) {
          expect(
            live.toArray.map((row) => row.id).sort(),
            `${checkpoint}: ${op}`,
          ).toEqual(modelRangeKeys(model, recordProbe, op))
        }
        if (expectedKeys.length > 0) reach(`range-equal-record`)
      }
      if (
        [...model.values()].some(
          (spec) =>
            spec.kind === `builtin` &&
            (spec.carrier === `PlainRecord` || spec.carrier === `Array`),
        )
      )
        reach(`excluded-accessor-held`)
      if (
        expectedPairs.some((pair) => {
          const [left] = pair.split(`|`)
          return model.get(left!)!.kind === `record`
        })
      )
        reach(`join-matched`)
    }

    check(`initial load`)
    checkEffectReaders(`initial load`)

    for (const [step, update] of history.updates.entries()) {
      const key = rowKey(update.row % history.rows.length)
      const previous = model.get(key)!
      const value = update.sameValue ? previous : update.value
      if (
        index !== undefined &&
        update.sameValue &&
        modelEq(previous, history.probe)
      )
        reach(`indexed-equal-replacement`)
      if (
        index !== undefined &&
        update.sameValue &&
        previous.kind === `builtin`
      )
        reach(`indexed-reference-replaced`)
      const silent = modelSilent(previous, value)
      const instance = materialize(value)
      const watched = referenceProbes.some(
        (probe) => probe.instance === stored.get(key),
      )
      if (value.kind === `builtin`) await watchReference(instance as object)
      if (silent) reach(`reference-filter-stayed-matched`)
      const replaced = stored.get(key)
      if (
        silent &&
        typeof replaced === `object` &&
        replaced !== null &&
        distinctRefs.toArray.some((row) => row.ref === replaced)
      )
        reach(`distinct-shown-replaced`)
      if (silent && watched) {
        reach(`reference-filter-left`)
        reach(`shared-reference-join-left`)
      }
      if (silent && value.kind === `builtin`) reach(`reference-filter-entered`)
      if (silent && referenceProbes.length > 0 && value.kind !== `builtin`)
        reach(`reference-filter-kept`)
      model.set(key, value)
      stored.set(key, instance)
      published.length = 0
      livePublished.length = 0
      effectEvents.length = 0
      for (const events of stableEvents.values()) events.length = 0
      for (const events of pooledStableEvents.values()) events.length = 0
      for (const events of pooledResidualEvents.values()) events.length = 0
      const keptSnapshots = pooledKeptObservers.map((observer) =>
        observer.getSnapshot(),
      )
      source.utils.begin()
      source.utils.write({ type: `update`, value: { id: key, ref: instance } })
      source.utils.commit()
      expect(published, `update ${step}: unfiltered subscriber`).toEqual(
        silent ? [] : [key],
      )
      for (const [stableKey, events] of stableEvents) {
        expect(events, `update ${step}: ID filter on ${stableKey}`).toEqual(
          !silent && stableKey === key ? [`update`] : [],
        )
      }
      for (const [stableKey, events] of pooledStableEvents) {
        expect(
          events,
          `update ${step}: pooled ID view on ${stableKey}`,
        ).toEqual(!silent && stableKey === key ? [`update`] : [])
      }
      for (const [stableKey, events] of pooledResidualEvents) {
        expect(
          events,
          `update ${step}: pooled residual view on ${stableKey}`,
        ).toEqual(!silent && stableKey === key ? [`update`] : [])
      }
      if (silent) {
        for (const [position, observer] of pooledKeptObservers.entries()) {
          expect(
            observer.getSnapshot(),
            `update ${step}: pooled snapshot ${position} kept`,
          ).toBe(keptSnapshots[position])
        }
      }
      expect(livePublished, `update ${step}: unfiltered live query`).toEqual(
        silent ? [] : [`update:${key}`],
      )
      // Membership is read before anything yields: a reader that catches up a
      // microtask later is stale for code that runs after the commit.
      check(`update ${step}`)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(effectEvents, `update ${step}: Effect`).toEqual(
        silent ? [] : [`update:${key}`],
      )
      checkEffectReaders(`update ${step}`)
    }

    // Identity: two distinct, equal probes are one query and one demand,
    // and hash alike; a record probe differs from its text look-alike.
    const queryFor = (value: unknown) =>
      getQueryIR(
        new Query()
          .from({ item: source })
          .where(({ item }) => eq(item.ref, value as never)),
      )
    const demandFor = (value: unknown) =>
      getLoadSubsetDemandKey({
        where: new Func<boolean>(`eq`, [
          new PropRef([`ref`]),
          new Value(value),
        ]),
      })
    const first = materialize(history.probe)
    const second = materialize(history.probe)
    expect(
      getQueryIdentity(queryFor(first)),
      `equal probes: query identity`,
    ).toBe(getQueryIdentity(queryFor(second)))
    expect(demandFor(first), `equal probes: demand key`).toBe(demandFor(second))
    expect(getStableValueHash(first), `equal probes: value hash`).toBe(
      getStableValueHash(second),
    )
    if (history.probe.kind === `record`) {
      const text = materialize({ ...history.probe, kind: `text` })
      expect(
        getQueryIdentity(queryFor(first)),
        `record and text: query identity`,
      ).not.toBe(getQueryIdentity(queryFor(text)))
      expect(getStableValueHash(first), `record and text: value hash`).not.toBe(
        getStableValueHash(text),
      )
    }
    if (recordProbe !== undefined) {
      reach(`unequal-record-probe`)
      const unequal = materialize(unequalRecord(recordProbe, history.unequalBy))
      const nestedKey = (value: unknown) =>
        getStableValueHash([`items`, { owners: [value] }], `queryKey`)
      expect(
        getQueryIdentity(queryFor(first)),
        `unequal records: query identity`,
      ).not.toBe(getQueryIdentity(queryFor(unequal)))
      expect(demandFor(first), `unequal records: demand key`).not.toBe(
        demandFor(unequal),
      )
      expect(getStableValueHash(first), `unequal records: value hash`).not.toBe(
        getStableValueHash(unequal),
      )
      expect(nestedKey(first), `equal records: nested query key`).toBe(
        nestedKey(second),
      )
      expect(nestedKey(first), `unequal records: nested query key`).not.toBe(
        nestedKey(unequal),
      )

      // Array ranges: an object leaf does not break a tie, so a shared and a
      // distinct leaf of one shape are one query with one result.
      const sharedLeaf = { shape: 1 }
      const mixed = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `serialized-value-mixed-${run}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `m`, ref: [sharedLeaf, materialize(recordProbe)!] },
          ],
          autoIndex: `off`,
        }),
      )
      cleanup(() => mixed.cleanup())
      await mixed.stateWhenReady()
      const spelled = (spec: { table: string; id: string }) =>
        `${spec.table}:${spec.id}`
      const others = [
        recordProbe,
        unequalRecord(recordProbe, history.unequalBy),
      ]
      for (const [position, other] of others.entries()) {
        const expected =
          spelled(recordProbe) >= spelled(other) ? [`m`] : ([] as Array<string>)
        const captures = [sharedLeaf, { shape: 1 }].map((leaf) => [
          leaf,
          materialize(other),
        ])
        const identities = captures.map((capture) =>
          getQueryIdentity(
            getQueryIR(
              new Query()
                .from({ item: mixed })
                .where(({ item }) => gte(item.ref as never, capture as never)),
            ),
          ),
        )
        expect(identities[0], `mixed array: identity`).toBe(identities[1])
        for (const [leaf, capture] of captures.entries()) {
          const live = createLiveQueryCollection({
            id: `serialized-value-mixed-${run}-${position}-${leaf}`,
            query: (q) =>
              q
                .from({ item: mixed })
                .where(({ item }) => gte(item.ref as never, capture as never)),
          })
          cleanup(() => live.cleanup())
          await live.preload()
          expect(
            live.toArray.map((row) => row.id),
            `mixed array: ${leaf === 0 ? `shared` : `distinct`} leaf`,
          ).toEqual(expected)
        }
      }
      reach(`mixed-array-range`)

      // Array ranges: a row that holds the capture array itself is ordered
      // like a row that holds a copy. The row [capture] sorts after capture,
      // because its first element is an array where the capture's is the
      // nested array's record, and an array sorts after a value class.
      const sharedArray = [[materialize(recordProbe)]]
      const nested = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `serialized-value-nested-${run}`,
          getKey: (row) => row.id,
          initialData: [{ id: `n`, ref: [sharedArray] }],
          autoIndex: `off`,
        }),
      )
      cleanup(() => nested.cleanup())
      await nested.stateWhenReady()
      const arrayCaptures = [sharedArray, [[materialize(recordProbe)]]]
      const nestedOps = [
        [`gt`, gt, [`n`]],
        [`lte`, lte, []],
      ] as const
      for (const [name, op, expected] of nestedOps) {
        const nestedIdentities = arrayCaptures.map((capture) =>
          getQueryIdentity(
            getQueryIR(
              new Query()
                .from({ item: nested })
                .where(({ item }) => op(item.ref as never, capture as never)),
            ),
          ),
        )
        expect(nestedIdentities[0], `nested array ${name}: identity`).toBe(
          nestedIdentities[1],
        )
        for (const [copy, capture] of arrayCaptures.entries()) {
          const live = createLiveQueryCollection({
            id: `serialized-value-nested-${run}-${name}-${copy}`,
            query: (q) =>
              q
                .from({ item: nested })
                .where(({ item }) => op(item.ref as never, capture as never)),
          })
          cleanup(() => live.cleanup())
          await live.preload()
          expect(
            live.toArray.map((row) => row.id),
            `nested array ${name}: ${copy === 0 ? `shared` : `copied`} capture`,
          ).toEqual(expected)
        }
      }
      reach(`shared-array-range`)

      // One batch replaces row a with a deep-equal row and really updates row
      // b, whose projection holds a class with readable private state.
      const scoped = createCollection(
        mockSyncCollectionOptions<ScopedRow>({
          id: `serialized-value-scoped-${run}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `a`, ref: new Map(), version: 0 },
            { id: `b`, ref: null, version: 0 },
          ],
          autoIndex: `off`,
        }),
      )
      cleanup(() => scoped.cleanup())
      await scoped.stateWhenReady()
      const updates: Record<`ordered` | `unordered`, Array<string>> = {
        ordered: [],
        unordered: [],
      }
      const projection = (row: { item: ScopedRow }) => ({
        id: row.item.id,
        state: new PrivateVersion(row.item.version),
      })
      for (const variant of [`ordered`, `unordered`] as const) {
        const scopedEffect = createEffect({
          id: `serialized-value-scoped-${variant}-${run}`,
          query: (q) =>
            variant === `ordered`
              ? q
                  .from({ item: scoped })
                  .orderBy(({ item }) => item.id)
                  .limit(2)
                  .fn.select(projection)
              : q.from({ item: scoped }).fn.select(projection),
          skipInitial: true,
          onUpdate: (event) => {
            updates[variant].push(String(event.key))
          },
        })
        cleanup(() => scopedEffect.dispose())
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      scoped.utils.begin()
      scoped.utils.write({
        type: `update`,
        value: { id: `a`, ref: new Map(), version: 0 },
      })
      scoped.utils.write({
        type: `update`,
        value: { id: `b`, ref: null, version: 1 },
      })
      scoped.utils.commit()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(updates, `Effect updates beside a replacement`).toEqual({
        ordered: [`b`],
        unordered: [`b`],
      })
      reach(`effect-update-beside-replacement`)

      // Objects order by reference, so a deep-equal replacement can move a row.
      const firstRef = new Map()
      const ordering = createCollection(
        mockSyncCollectionOptions<ScopedRow>({
          id: `serialized-value-ordering-${run}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `a`, ref: firstRef, version: 0 },
            { id: `b`, ref: new Map(), version: 0 },
          ],
          autoIndex: `off`,
        }),
      )
      cleanup(() => ordering.cleanup())
      await ordering.stateWhenReady()
      const orderedByRef = () =>
        new Query()
          .from({ item: ordering })
          .where(({ item }) => eq(item.version, 0))
          .orderBy(({ item }) => item.ref)
      const orderedLive = createLiveQueryCollection({
        id: `serialized-value-ordering-live-${run}`,
        query: () => orderedByRef() as never,
      })
      cleanup(() => orderedLive.cleanup())
      await orderedLive.preload()
      const orderedPool = poolQuery(orderedByRef())!
      cleanup(() => orderedPool.cleanup())
      const orderedObserver = createLiveQueryObserver<ScopedRow, string>(
        orderedPool as never,
      )
      cleanup(() => orderedObserver.dispose())
      const orderOf = () =>
        (orderedObserver.getSnapshot().data as Array<ScopedRow>).map(
          (row) => row.id,
        )
      expect(orderOf(), `pooled order before`).toEqual(
        orderedLive.toArray.map((row) => (row as ScopedRow).id),
      )
      ordering.utils.begin()
      ordering.utils.write({
        type: `update`,
        value: { id: `a`, ref: new Map(), version: 0 },
      })
      ordering.utils.commit()
      // A query built now reads the stored rows in their current order.
      expect(
        orderedLive.toArray.map((row) => (row as ScopedRow).id),
        `live order after a replacement`,
      ).toEqual([`b`, `a`])
      const orderedFresh = createLiveQueryCollection({
        id: `serialized-value-ordering-fresh-${run}`,
        query: () => orderedByRef() as never,
      })
      cleanup(() => orderedFresh.cleanup())
      await orderedFresh.preload()
      expect(
        orderedFresh.toArray.map((row) => (row as ScopedRow).id),
        `fresh order after a replacement`,
      ).toEqual([`b`, `a`])
      expect(orderOf(), `pooled order after a replacement`).toEqual([`b`, `a`])
      reach(`pooled-order-moved`)
    }
  }, cleanups)
}

describe(`value classes compare by their serialized value`, () => {
  oracleProperty({
    id: property,
    law: {
      statement: `Query equality, exact index lookup, live-query filters and joins match distinct class instances whose toJSON() values are equal, never a plain value equal to that serialization; query identity and getStableValueHash follow the same relation and separate unequal values. Range predicates order a value class by that serialization, never valueOf(), and order an array the row and the capture share like a copy of it. A Map, Set or ArrayBuffer subclass with toJSON() keeps its built-in rule and never equals a value class, and a plain record or array keeps reference semantics without its toJSON property being read. When a sync write replaces such a value with a deep-equal instance, a filter on either instance, a join, a functional filter, a filter over a projection or an ordered result and a pooled view follow the stored one by the time the commit returns, an ordered query takes the new instance's position, a distinct query shows an instance some row still holds, a subscriber, live query or Effect that keeps the row is told nothing, and another row's update in the same batch still reaches an Effect.`,
      authority: `Issue #2459 and the "Value classes" section of docs/guides/live-queries.md.`,
      limits: `One toJSON() class over two tables and two IDs, its text look-alike, empty Map, Set and ArrayBuffer subclass look-alikes, plain records and arrays with a throwing toJSON accessor (never probes), and null; up to four source rows, three join rows and three synced updates; range reads use record probes; no inArray, on-demand or persisted sources, or exact-output identity.`,
    },
    owns: [
      'src/utils/comparison.ts#normalizeValue',
      'src/utils.ts#serializedClassValue',
      'src/utils/comparison.ts#compareValues',
      'src/collection/state.ts#CollectionStateManager.commitPendingTransactions',
      'src/collection/subscription.ts#CollectionSubscription.visibleChanges',
      'src/query/effect.ts#classifyDelta',
      'src/query/pooled-live-query.ts#Partition.apply',
      'src/collection/changes.ts#CollectionChangesManager.enrichChangeWithVirtualProps',
      'src/query/pooled-live-query.ts#PooledLiveQuery._stateRevision',
      'src/collection/change-events.ts#markSilentReplacement',
      'src/collection/change-events.ts#isSilentReplacement',
      'src/query/ir-stable-identity.ts#getStableValueHash',
      'src/indexes/basic-index.ts#BasicIndex.lookup',
      'src/indexes/btree-index.ts#BTreeIndex.lookup',
    ],
    histories: {
      arbitrary: historyArbitrary,
      runs: 60,
      fixedSeeds: [2459],
      states: reachStates,
      fixed: [
        {
          // Replay: seed 778307668, path 26:1:1:6:6:9:8:8.
          name: `a replaced indexed Map leaves the index when its row updates`,
          history: {
            rows: [
              { kind: `text`, table: `user`, id: `a` },
              { kind: `builtin`, carrier: `Map`, table: `user`, id: `a` },
            ],
            joinRows: [],
            index: `btree`,
            updates: [
              {
                row: 3,
                value: { kind: `record`, table: `user`, id: `a` },
                sameValue: true,
              },
              { row: 1, value: { kind: `null` }, sameValue: false },
            ],
            probe: { kind: `record`, table: `user`, id: `a` },
            unequalBy: `table`,
          },
        },
        {
          // Replay: seed -1898981439, path 57:4:3:3:3:3:7:6:6:6:6:6.
          name: `a plain record updated to a carrier with the same fields`,
          history: {
            rows: [
              {
                kind: `builtin`,
                carrier: `PlainRecord`,
                table: `org`,
                id: `a`,
              },
              { kind: `text`, table: `user`, id: `a` },
            ],
            joinRows: [],
            index: `none`,
            updates: [
              {
                row: 0,
                value: {
                  kind: `builtin`,
                  carrier: `ArrayBuffer`,
                  table: `org`,
                  id: `a`,
                },
                sameValue: false,
              },
            ],
            probe: { kind: `record`, table: `user`, id: `a` },
            unequalBy: `table`,
          },
        },
      ],
      constructed: [
        {
          name: `an indexed reference value is replaced by a deep-equal one and then updated`,
          enters: [
            `indexed-reference-replaced`,
            `mixed-array-range`,
            `shared-array-range`,
            `reference-filter-left`,
            `reference-filter-entered`,
            `reference-filter-stayed-matched`,
            `shared-reference-join-left`,
            `effect-update-beside-replacement`,
            `pooled-order-moved`,
            `distinct-shown-replaced`,
          ],
          build: (generated): History => {
            const carriers: ReadonlyArray<Carrier> = [
              `Map`,
              `Set`,
              `PlainRecord`,
              `Array`,
            ]
            const probe = {
              kind: `record` as const,
              table: generated.probe.table,
              id: generated.probe.id,
            }
            return {
              ...generated,
              rows: [
                { kind: `text`, table: probe.table, id: probe.id },
                {
                  kind: `builtin`,
                  carrier: carriers[generated.rows.length % carriers.length]!,
                  table: probe.table,
                  id: probe.id,
                },
              ],
              index: generated.index === `basic` ? `basic` : `btree`,
              updates: [
                { row: 1, value: probe, sameValue: true },
                { row: 1, value: { kind: `null` }, sameValue: false },
              ],
              probe,
            }
          },
        },
        {
          name: `a deep-equal text row is replaced beside a reference filter`,
          enters: [`reference-filter-kept`],
          build: (generated): History => ({
            ...generated,
            rows: [
              { kind: `text`, table: generated.probe.table, id: `a` },
              {
                kind: `builtin`,
                carrier: generated.rows.length % 2 === 0 ? `Map` : `Set`,
                table: generated.probe.table,
                id: `b`,
              },
            ],
            updates: [
              {
                row: 0,
                value: { kind: `null` },
                sameValue: true,
              },
            ],
          }),
        },
        {
          name: `an indexed group keeps an equal reference after its first instance is replaced`,
          enters: [
            `distinct-instance-matched`,
            `indexed-equal-replacement`,
            `join-matched`,
            `ordered-equal-run`,
            `range-equal-record`,
            `unequal-record-probe`,
          ],
          build: (generated): History => {
            const probe = {
              kind: `record` as const,
              table: generated.probe.table,
              id: generated.probe.id,
            }
            return {
              ...generated,
              rows: [probe, probe, ...generated.rows.slice(2)],
              joinRows: [probe, ...generated.joinRows.slice(1)],
              index: generated.index === `basic` ? `basic` : `btree`,
              updates: [
                { row: 0, value: probe, sameValue: true },
                ...generated.updates.slice(0, 2),
              ],
              probe,
            }
          },
        },
        {
          name: `a built-in carrier spelled like the record probe sits among equal records`,
          enters: [
            `builtin-lookalike-held`,
            `distinct-instance-matched`,
            `join-matched`,
            `ordered-equal-run`,
          ],
          build: (generated): History => {
            const probe = {
              kind: `record` as const,
              table: generated.probe.table,
              id: generated.probe.id,
            }
            const carriers: ReadonlyArray<Carrier> = [
              `Map`,
              `Set`,
              `ArrayBuffer`,
            ]
            const lookalike = {
              kind: `builtin` as const,
              carrier: carriers[generated.rows.length % carriers.length]!,
              table: probe.table,
              id: probe.id,
            }
            return {
              ...generated,
              rows: [probe, lookalike, probe, ...generated.rows.slice(3)],
              joinRows: [lookalike, probe, ...generated.joinRows.slice(2)],
              probe,
            }
          },
        },
        {
          name: `excluded objects with a toJSON accessor sit among equal records`,
          enters: [
            `excluded-accessor-held`,
            `distinct-instance-matched`,
            `range-equal-record`,
            `unequal-record-probe`,
          ],
          build: (generated): History => {
            const probe = {
              kind: `record` as const,
              table: generated.probe.table,
              id: generated.probe.id,
            }
            const excluded = (carrier: Carrier) => ({
              kind: `builtin` as const,
              carrier,
              table: probe.table,
              id: probe.id,
            })
            return {
              ...generated,
              rows: [
                probe,
                excluded(`PlainRecord`),
                excluded(`Array`),
                ...generated.rows.slice(3),
              ],
              joinRows: [
                excluded(`PlainRecord`),
                probe,
                ...generated.joinRows.slice(2),
              ],
              probe,
            }
          },
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: History }, observe) =>
      recordAssertionJudgment(property, plan, observe, () =>
        runHistory(plan.history, (state) => observe(`reach`, state)),
      ),
    check: forwardAssertionJudgment,
  })
})

// Range predicates order a value class by its serialized value. Arrays order
// element by element, whether or not they hold a value class, in one total
// order that agrees with sorting: a null sorts first, then primitives, value
// classes by their serialized value, Temporal values, other objects, and nested
// arrays after any value that is not an array; a shorter prefix sorts first.
// Where sorting would order two other objects by reference, range predicates
// treat the arrays as equal from that element on, since equal captures are one
// query. Values that are not arrays keep the native operators, including their
// throws, unless one holds a value class. The model recomputes these orders
// from term specs; it never reads an instance.
type OrderTerm =
  | { k: `num`; v: number }
  | { k: `text`; v: string }
  | { k: `null` }
  | { k: `record`; table: Table; id: `a` | `b` }
  | { k: `shaped`; table: Table; id: `a` | `b`; idFirst: boolean }
  | { k: `leaf`; shape: number }
  | { k: `bytes` }
  | { k: `date`; day: number }
  | { k: `array`; items: Array<OrderTerm> }
  // An array whose last element is the array itself.
  | { k: `loop`; items: Array<OrderTerm> }
type OrderHistory = { pairs: Array<[OrderTerm, OrderTerm]> }

const orderStates = [
  // A value class met an object that has none.
  `class-before-object`,
  // A value class met a primitive.
  `primitive-before-class`,
  // A nested array met an object.
  `array-after-object`,
  // An array pair came up again inside its own comparison.
  `cycle-closed`,
  // A null met a non-null element.
  `null-element`,
  // Values without a value class used the native operators.
  `native-order`,
  // The native operators threw for a Temporal value.
  `native-throws`,
  // Two Temporal values compared.
  `temporal-pair`,
  // Equal serialized records spelled their keys in different orders.
  `shaped-key-order`,
  // A typed array subclass with toJSON() was compared.
  `typed-array-excluded`,
  // The sort order compared two plain objects.
  `objects-sorted-apart`,
  // Two array elements that sorting orders by reference tied the arrays.
  `objects-tied`,
  // A Temporal element met another object without a value class.
  `kinds-ranked`,
  // A number element met a text element.
  `mixed-primitives`,
  // Arrays without a value class ordered by their elements.
  `plain-arrays-ordered`,
  // Three arrays in a strict chain were checked for transitivity.
  `transitive-chain`,
  // An array pair that sorting orders without references was checked
  // against sorting.
  `sort-agreed`,
] as const
type OrderState = (typeof orderStates)[number]

/** A value class whose toJSON() returns a record, keys in either order. */
class ShapedRef {
  readonly rank = nextRank++
  #serializations = 0
  get serializations(): number {
    return this.#serializations
  }
  constructor(
    readonly table: string,
    readonly id: string,
    readonly idFirst: boolean,
  ) {}
  toJSON() {
    this.#serializations++
    return this.idFirst
      ? { id: this.id, table: this.table }
      : { table: this.table, id: this.id }
  }
  valueOf(): number {
    return this.rank
  }
}

/** A typed array subclass with toJSON(): binary data keeps its own rule. */
class RecordBytes extends Uint8Array {
  toJSON(): string {
    return `user:a`
  }
}

function materializeTerm(term: OrderTerm): unknown {
  switch (term.k) {
    case `num`:
    case `text`:
      return term.v
    case `null`:
      return null
    case `record`:
      return new RecordRef(term.table, term.id)
    case `shaped`:
      return new ShapedRef(term.table, term.id, term.idFirst)
    case `leaf`:
      return { shape: term.shape }
    case `bytes`:
      return new RecordBytes(0)
    case `date`:
      return Temporal.PlainDate.from({ year: 2024, month: 1, day: term.day })
    case `array`:
      return term.items.map(materializeTerm)
    case `loop`: {
      const array: Array<unknown> = term.items.map(materializeTerm)
      array.push(array)
      return array
    }
  }
}

class ModelThrows extends Error {}

const isArrayTerm = (term: OrderTerm) => term.k === `array` || term.k === `loop`
const isClassTerm = (term: OrderTerm) =>
  term.k === `record` || term.k === `shaped`
const isObjectTerm = (term: OrderTerm) =>
  term.k !== `num` && term.k !== `text` && term.k !== `null`
const elementsOf = (term: OrderTerm): Array<OrderTerm> =>
  term.k === `loop`
    ? [...term.items, term]
    : term.k === `array`
      ? term.items
      : []
const signOf = (value: number) => (value < 0 ? -1 : value > 0 ? 1 : 0)
// The serialized value, with record keys sorted.
const serializedTerm = (term: OrderTerm) =>
  term.k === `record`
    ? JSON.stringify(`${term.table}:${term.id}`)
    : term.k === `shaped`
      ? JSON.stringify({ id: term.id, table: term.table })
      : undefined

function holdsClass(term: OrderTerm, seen = new Set([term])): boolean {
  if (isClassTerm(term)) return true
  for (const element of elementsOf(term)) {
    if (isClassTerm(element)) return true
    if (isArrayTerm(element) && !seen.has(element)) {
      seen.add(element)
      if (holdsClass(element, seen)) return true
    }
  }
  return false
}

// What `String(value)` gives: Array.prototype.join prints a null as empty and
// a cycle back into an array being joined as empty.
function nativeText(term: OrderTerm, joining: Set<OrderTerm>): string {
  switch (term.k) {
    case `num`:
      return String(term.v)
    case `text`:
      return term.v
    case `leaf`:
      return `[object Object]`
    case `date`:
      return `2024-01-0${term.day}`
    case `array`:
    case `loop`: {
      if (joining.has(term)) return ``
      joining.add(term)
      const text = elementsOf(term)
        .map((element) => nativeText(element, joining))
        .join(`,`)
      joining.delete(term)
      return text
    }
    default:
      // null, typed arrays (empty here) and never a value class.
      return ``
  }
}

// The relational operators: objects become primitives through valueOf, which
// a Temporal value throws from, then toString.
function nativeOrder(left: OrderTerm, right: OrderTerm): number {
  const primitive = (term: OrderTerm): string | number => {
    if (term.k === `num` || term.k === `text`) return term.v
    if (term.k === `date`) throw new ModelThrows()
    return nativeText(term, new Set())
  }
  const a = primitive(left)
  const b = primitive(right)
  if (typeof a === `string` && typeof b === `string`)
    return a < b ? -1 : a > b ? 1 : 0
  const x = Number(a)
  const y = Number(b)
  return x < y ? -1 : x > y ? 1 : 0
}

type ModelVerdict = number | `tie`

function modelOrder(
  left: OrderTerm,
  right: OrderTerm,
  reach: (state: OrderState) => void,
): number {
  const nonNull = (a: OrderTerm, b: OrderTerm): number => {
    if (a.k === `bytes` || b.k === `bytes`) reach(`typed-array-excluded`)
    if (a.k === `date` && b.k === `date`) {
      reach(`temporal-pair`)
      return signOf(a.day - b.day)
    }
    if (isArrayTerm(a) || isArrayTerm(b)) {
      if (!holdsClass(a) && !holdsClass(b)) reach(`plain-arrays-ordered`)
      const result = arrays(a, b, new Map())
      return result === `tie` ? 0 : result
    }
    if (isClassTerm(a) || isClassTerm(b)) return withClass(a, b)
    reach(`native-order`)
    try {
      return nativeOrder(a, b)
    } catch (error) {
      reach(`native-throws`)
      throw error
    }
  }
  // At least one is an array.
  const arrays = (
    a: OrderTerm,
    b: OrderTerm,
    active: Map<OrderTerm, Set<OrderTerm>>,
  ): ModelVerdict => {
    if (isArrayTerm(a) !== isArrayTerm(b)) {
      if (isObjectTerm(isArrayTerm(a) ? b : a)) reach(`array-after-object`)
      return isArrayTerm(a) ? 1 : -1
    }
    let partners = active.get(a)
    if (partners === undefined) active.set(a, (partners = new Set()))
    if (partners.has(b)) {
      reach(`cycle-closed`)
      return 0
    }
    partners.add(b)
    const aItems = elementsOf(a)
    const bItems = elementsOf(b)
    for (
      let index = 0;
      index < Math.min(aItems.length, bItems.length);
      index++
    ) {
      const result = element(aItems[index]!, bItems[index]!, active)
      if (result !== 0) return result
    }
    partners.delete(b)
    return signOf(aItems.length - bItems.length)
  }
  const element = (
    x: OrderTerm,
    y: OrderTerm,
    active: Map<OrderTerm, Set<OrderTerm>>,
  ): ModelVerdict => {
    if (x.k === `null` || y.k === `null`) {
      if (x.k !== y.k) reach(`null-element`)
      return x.k === y.k ? 0 : x.k === `null` ? -1 : 1
    }
    if (x.k === `bytes` || y.k === `bytes`) reach(`typed-array-excluded`)
    if (isArrayTerm(x) || isArrayTerm(y)) return arrays(x, y, active)
    if (isClassTerm(x) || isClassTerm(y)) return withClass(x, y)
    if (isObjectTerm(x) && isObjectTerm(y)) {
      if (x.k === `date` && y.k === `date`) {
        reach(`temporal-pair`)
        return signOf(x.day - y.day)
      }
      if (x.k === `date` || y.k === `date`) {
        reach(`kinds-ranked`)
        return x.k === `date` ? -1 : 1
      }
      reach(`objects-tied`)
      return `tie`
    }
    if (isObjectTerm(x) !== isObjectTerm(y)) return isObjectTerm(x) ? 1 : -1
    return primitives(x, y)
  }
  // Neither is an array and at least one is a value class.
  const withClass = (a: OrderTerm, b: OrderTerm): number => {
    const aText = serializedTerm(a)
    const bText = serializedTerm(b)
    if (aText !== undefined && bText !== undefined) {
      if (a.k === `shaped` && b.k === `shaped` && a.idFirst !== b.idFirst)
        reach(`shaped-key-order`)
      return aText < bText ? -1 : aText > bText ? 1 : 0
    }
    const classSide = aText !== undefined ? a : b
    const other = classSide === a ? b : a
    const classFirst = isObjectTerm(other)
    reach(classFirst ? `class-before-object` : `primitive-before-class`)
    return (classSide === a) === classFirst ? -1 : 1
  }
  // Numbers by value and texts by code units; a number and a text that does
  // not spell one compare equal, as the relational operators do.
  const primitives = (x: OrderTerm, y: OrderTerm): number => {
    if (x.k !== y.k) reach(`mixed-primitives`)
    return nativeOrder(x, y)
  }
  return nonNull(left, right)
}

// How sorting (ascComparator with lexical strings and nulls first) orders two
// arrays, or `reference` where it would read references or recurse forever.
// `tie` marks a first reference read between two objects without a value
// class, where range predicates must tie.
function modelSortOrder(
  left: OrderTerm,
  right: OrderTerm,
): number | `tie` | `reference` {
  const sort = (a: OrderTerm, b: OrderTerm): number | `tie` | `reference` => {
    if (a.k === `null` || b.k === `null`)
      return a.k === b.k ? 0 : a.k === `null` ? -1 : 1
    if (a.k === `loop` || b.k === `loop`) return `reference`
    if (a.k === `array` && b.k === `array`) {
      for (
        let index = 0;
        index < Math.min(a.items.length, b.items.length);
        index++
      ) {
        const result = sort(a.items[index]!, b.items[index]!)
        if (result !== 0) return result
      }
      return signOf(a.items.length - b.items.length)
    }
    if (a.k === `date` && b.k === `date`) return signOf(a.day - b.day)
    if (isObjectTerm(a) && isObjectTerm(b)) {
      const aText = serializedTerm(a)
      const bText = serializedTerm(b)
      if (aText !== undefined || bText !== undefined) {
        if (aText === undefined) return 1
        if (bText === undefined) return -1
        return aText < bText ? -1 : aText > bText ? 1 : 0
      }
      return isArrayTerm(a) ||
        isArrayTerm(b) ||
        a.k === `date` ||
        b.k === `date`
        ? `reference`
        : `tie`
    }
    if (isObjectTerm(a) !== isObjectTerm(b)) return isObjectTerm(a) ? 1 : -1
    return nativeOrder(a, b)
  }
  return sort(left, right)
}

// Records over primitive leaves, so a constructed history can be taken back.
const orderTables = fc.constantFrom<Table>(`user`, `org`)
const orderIds = fc.constantFrom<`a` | `b`>(`a`, `b`)
const orderLeaf = fc.oneof(
  fc.record({
    k: fc.constant(`num` as const),
    v: fc.integer({ min: 0, max: 12 }),
  }),
  fc.record({
    k: fc.constant(`text` as const),
    v: fc.constantFrom(`a`, `b`, `user:a`, `org:a`),
  }),
  fc.record({ k: fc.constant(`null` as const) }),
  fc.record({
    k: fc.constant(`record` as const),
    table: orderTables,
    id: orderIds,
  }),
  fc.record({
    k: fc.constant(`shaped` as const),
    table: orderTables,
    id: orderIds,
    idFirst: fc.boolean(),
  }),
  fc.record({
    k: fc.constant(`leaf` as const),
    shape: fc.integer({ min: 0, max: 1 }),
  }),
  fc.record({ k: fc.constant(`bytes` as const) }),
  fc.record({
    k: fc.constant(`date` as const),
    day: fc.integer({ min: 1, max: 3 }),
  }),
)
const { orderTerm } = fc.letrec<{
  orderTerm: OrderTerm
  orderArray: OrderTerm
  orderLoop: OrderTerm
}>((tie) => ({
  orderTerm: fc.oneof(
    { depthSize: `small` },
    orderLeaf,
    tie(`orderArray`),
    tie(`orderLoop`),
  ),
  orderArray: fc.record({
    k: fc.constant(`array` as const),
    items: fc.array(tie(`orderTerm`), { maxLength: 3 }),
  }),
  orderLoop: fc.record({
    k: fc.constant(`loop` as const),
    items: fc.array(tie(`orderTerm`), { maxLength: 2 }),
  }),
}))
const orderOperand = orderTerm.filter((term) => term.k !== `null`)
const MAX_ORDER_PAIRS = 6
const orderHistoryArbitrary: fc.Arbitrary<OrderHistory> = fc.record({
  pairs: fc.array(fc.tuple(orderOperand, orderOperand), {
    minLength: 1,
    maxLength: MAX_ORDER_PAIRS,
  }),
})
// A constructed history keeps the generated pairs that still fit.
const withPairs = (
  pairs: OrderHistory[`pairs`],
  generated: OrderHistory,
): OrderHistory => ({
  pairs: [...pairs, ...generated.pairs].slice(0, MAX_ORDER_PAIRS),
})

const orderProperty = `serialized-value.array-order`
const rangeEvaluators = ([`gt`, `gte`, `lt`, `lte`] as const).map(
  (name) =>
    [
      name,
      compileSingleRowExpression(
        new Func(name, [new PropRef([`a`]), new PropRef([`b`])]),
      ),
    ] as const,
)
const rangeHolds = {
  gt: (order: number) => order > 0,
  gte: (order: number) => order >= 0,
  lt: (order: number) => order < 0,
  lte: (order: number) => order <= 0,
}

function shapedRefsIn(
  value: unknown,
  seen = new Set<object>(),
): Array<ShapedRef> {
  if (typeof value !== `object` || value === null || seen.has(value)) return []
  seen.add(value)
  if (value instanceof ShapedRef) return [value]
  return Array.isArray(value)
    ? value.flatMap((item) => shapedRefsIn(item, seen))
    : []
}

function identifyObjects(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== `object` || value === null || seen.has(value)) return
  seen.add(value)
  getRuntimeReferenceIdentity(value)
  if (Array.isArray(value))
    for (const item of value) identifyObjects(item, seen)
}

function runOrderHistory(
  history: OrderHistory,
  reach: (state: OrderState) => void,
) {
  // Each pair, and each left operand against a fresh copy of itself.
  const pairs = history.pairs.flatMap(([left, right]) => [
    [left, right] as const,
    [left, left] as const,
  ])
  for (const [position, [left, right]] of pairs.entries()) {
    let order: number | undefined
    try {
      order = modelOrder(left, right, reach)
    } catch (error) {
      if (!(error instanceof ModelThrows)) throw error
    }
    const row = { a: materializeTerm(left), b: materializeTerm(right) }
    // The right operand's objects get runtime identities first, so an order
    // that read references would put a right-hand object first.
    identifyObjects(row.b)
    identifyObjects(row.a)
    if (left.k === `leaf` && right.k === `leaf`) {
      // Two distinct objects without a value class never share a position.
      reach(`objects-sorted-apart`)
      const forward = ascComparator(row.a, row.b, DEFAULT_COMPARE_OPTIONS)
      const backward = ascComparator(row.b, row.a, DEFAULT_COMPARE_OPTIONS)
      expect(Math.sign(forward), `pair ${position}: sort order`).not.toBe(0)
      expect(Math.sign(backward), `pair ${position}: sort order`).toBe(
        -Math.sign(forward),
      )
    }
    for (const [name, evaluate] of rangeEvaluators) {
      const label = `pair ${position}: ${name}`
      if (order === undefined) expect(() => evaluate(row), label).toThrow()
      else expect(evaluate(row), label).toBe(rangeHolds[name](order))
    }
    // An immutable value class is serialized once, however often it compares.
    for (const shaped of shapedRefsIn([row.a, row.b]))
      expect(
        shaped.serializations,
        `pair ${position}: toJSON reads`,
      ).toBeLessThanOrEqual(1)
  }
  checkArrayOrder(
    history.pairs.flat().filter((term) => isArrayTerm(term)),
    reach,
  )
}

const LEXICAL_ORDER = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `lexical`,
} as const

// Range predicates over the history's array operands form one total preorder:
// opposite pairs have opposite signs and the order is transitive, except
// through a number and a text, which the relational operators leave
// unordered. They agree with sorting wherever sorting reads no reference, and
// tie where sorting first orders two objects without a value class by
// reference.
function checkArrayOrder(
  terms: Array<OrderTerm>,
  reach: (state: OrderState) => void,
) {
  const values = terms.map(materializeTerm)
  for (const value of [...values].reverse()) identifyObjects(value)
  const [gtRange, , ltRange] = rangeEvaluators.map(([, evaluate]) => evaluate)
  const sign = new Map<string, number>()
  const unordered = new Set<string>()
  for (const [i, a] of values.entries())
    for (const [j, b] of values.entries()) {
      const pair = `${i},${j}`
      const row = { a, b }
      sign.set(pair, gtRange!(row) ? 1 : ltRange!(row) ? -1 : 0)
      const states = new Set<OrderState>()
      modelOrder(terms[i]!, terms[j]!, (state) => states.add(state))
      if (states.has(`mixed-primitives`)) unordered.add(pair)
      const sort = modelSortOrder(terms[i]!, terms[j]!)
      const label = `operands ${pair}`
      if (sort === `tie`) {
        expect(
          sign.get(pair),
          `${label}: tie where sorting reads references`,
        ).toBe(0)
      } else if (sort !== `reference`) {
        expect(
          Math.sign(ascComparator(a, b, LEXICAL_ORDER)),
          `${label}: sort model`,
        ).toBe(sort)
        expect(sign.get(pair), `${label}: range agrees with sorting`).toBe(sort)
        if (sort !== 0) reach(`sort-agreed`)
      }
    }
  for (const i of values.keys())
    for (const j of values.keys()) {
      expect(sign.get(`${i},${j}`), `operands ${i},${j}: opposite`).toBe(
        -sign.get(`${j},${i}`)! || 0,
      )
      for (const k of values.keys()) {
        const pairs = [`${i},${j}`, `${j},${k}`, `${i},${k}`]
        if (pairs.some((pair) => unordered.has(pair))) continue
        const [first, second, whole] = pairs.map((pair) => sign.get(pair)!)
        if (first! < 0 || second! < 0) continue
        if (first! > 0 && second! > 0) reach(`transitive-chain`)
        const label = `operands ${pairs.join(` `)}: transitive`
        expect(whole, label).toBeGreaterThanOrEqual(
          first! > 0 || second! > 0 ? 1 : 0,
        )
      }
    }
}

const record = (table: Table, id: `a` | `b`): OrderTerm => ({
  k: `record`,
  table,
  id,
})
const array = (...items: Array<OrderTerm>): OrderTerm => ({ k: `array`, items })
const num = (v: number): OrderTerm => ({ k: `num`, v })
const leaf: OrderTerm = { k: `leaf`, shape: 0 }
const date = (day: number): OrderTerm => ({ k: `date`, day })

describe(`value classes order arrays by their serialized value`, () => {
  oracleProperty({
    id: orderProperty,
    law: {
      statement: `Range predicates compare arrays element by element, whether or not they hold a value class, in one total preorder: opposite pairs have opposite signs and the order is transitive. A null sorts first, then primitives, value classes by their serialized value with record keys sorted, Temporal values, other objects, and nested arrays after any value that is not an array; a shorter prefix sorts first, and a pair met again inside its own comparison is equal. Range predicates agree with sorting wherever sorting orders two arrays without reading a reference, and where sorting first orders two other objects by reference they treat the arrays as equal. Values that are not arrays keep the native operators and their throws unless one is a value class, which sorts after a primitive and before any other object; a Temporal pair compares as Temporal values. The sort order keeps two distinct plain objects apart, and each value class instance is serialized at most once.`,
      authority: `Issue #2459, the "Value classes" section of docs/guides/live-queries.md, the compareValues contract in packages/db/src/utils/comparison.ts, and the PR #2460 review (array comparison is one total order that agrees with sorting).`,
      limits: `Numbers 0..12, four texts, records and record-shaped toJSON() classes over two tables and two IDs, one plain object shape, an empty Uint8Array subclass, three PlainDates, null elements, and arrays of up to three terms nested and self-referencing up to fast-check's small depth; one to six operand pairs plus each left operand against a copy, and every pair and triple of the history's array operands. A number and a text are unordered, so transitivity is not checked through such a pair; sorting is compared only where it reads no reference and holds no self-referencing array, and where it orders a Temporal value, an array or another object by reference, range predicates may order them by kind instead. Arrays shared at several depths are covered by fixed tests.`,
    },
    owns: [
      'src/utils/comparison.ts#compareValues',
      'src/utils.ts#serializedClassValue',
    ],
    histories: {
      arbitrary: orderHistoryArbitrary,
      runs: 100,
      fixedSeeds: [2459],
      states: orderStates,
      constructed: [
        {
          name: `a value class sits between primitives and other objects`,
          enters: [
            `class-before-object`,
            `primitive-before-class`,
            `typed-array-excluded`,
            `native-order`,
            `objects-sorted-apart`,
          ],
          build: (generated): OrderHistory =>
            withPairs(
              [
                [array(record(`user`, `a`)), array(leaf)],
                [array(num(3)), array(record(`org`, `b`))],
                [array({ k: `bytes` }), array(num(0))],
                [array({ k: `bytes` }, record(`user`, `a`)), array(num(0))],
                [num(2), num(10)],
                [leaf, { k: `leaf`, shape: 1 }],
              ],
              generated,
            ),
        },
        {
          name: `nested arrays follow objects, nulls lead and cycles close`,
          enters: [`array-after-object`, `cycle-closed`, `null-element`],
          build: (generated): OrderHistory =>
            withPairs(
              [
                [array(array(record(`user`, `a`))), array(leaf)],
                [
                  { k: `loop`, items: [record(`user`, `a`)] },
                  { k: `loop`, items: [record(`user`, `a`)] },
                ],
                [
                  array({ k: `null` }, record(`user`, `b`)),
                  array(num(1), record(`user`, `b`)),
                ],
              ],
              generated,
            ),
        },
        {
          name: `arrays order by their elements in one order with sorting`,
          enters: [
            `native-order`,
            `native-throws`,
            `temporal-pair`,
            `objects-tied`,
            `kinds-ranked`,
            `mixed-primitives`,
            `plain-arrays-ordered`,
            `transitive-chain`,
            `sort-agreed`,
          ],
          build: (generated): OrderHistory =>
            withPairs(
              [
                [array(leaf, num(2)), array(leaf, num(10))],
                [array(num(10)), array(num(5), record(`user`, `a`))],
                [array(date(1), num(2)), array(date(2), leaf)],
                [array(date(1)), array(leaf, { k: `text`, v: `a` })],
                [date(1), leaf],
                [array(num(1)), array({ k: `text`, v: `a` })],
              ],
              generated,
            ),
        },
        {
          name: `a serialized record ignores its key order`,
          enters: [`shaped-key-order`],
          build: (generated): OrderHistory =>
            withPairs(
              [
                [
                  { k: `shaped`, table: `user`, id: `a`, idFirst: true },
                  { k: `shaped`, table: `user`, id: `a`, idFirst: false },
                ],
                [
                  array({ k: `shaped`, table: `org`, id: `b`, idFirst: false }),
                  array(record(`org`, `b`)),
                ],
              ],
              generated,
            ),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: OrderHistory }, observe) =>
      recordAssertionJudgment(orderProperty, plan, observe, () =>
        runOrderHistory(plan.history, (state) => observe(`reach`, state)),
      ),
    check: forwardAssertionJudgment,
  })
})

// Reference-filter histories that cross a truncate replay, a joined load and a
// pooled residual view. Each grammar varies the rows and their changes; a small
// model says what the readers show and what they are told.

// A direct subscriber buffers a truncate replay privately and publishes one
// diff when it completes. A row's reference may be the probe instance or a
// deep-equal copy, before the truncate and at the end of the replay; a copy
// may first arrive as the probe and then be replaced. Model: a filter on the
// probe instance, an Effect joining on it and an Effect whose functional filter
// compares it show exactly the rows that hold
// it, and the replay publishes a delete (exit) for each row that stopped
// matching and an insert (enter) for each that started, and nothing for a row
// that still matches.
type RefState = `absent` | `probe` | `copy`
type ReplayRowSpec = { before: RefState; after: RefState; viaProbe: boolean }
type ReplayHistory = { rows: Array<ReplayRowSpec> }
const replayStates = [
  // A deep-equal replacement during the replay took a row out of the filter.
  `replacement-left-filter`,
  // A row that did not match before the truncate matched after it.
  `entered-filter`,
  // A row that matched came back unchanged and published nothing.
  `unchanged-redelivered`,
  // A row that matched was not delivered again.
  `removed`,
  // The replay delivered a deep-equal copy where the probe had been.
  `replay-delivered-copy`,
] as const
type ReplayState = (typeof replayStates)[number]

const replayRefState = fc.constantFrom<RefState>(`absent`, `probe`, `copy`)
const replayHistoryArbitrary: fc.Arbitrary<ReplayHistory> = fc.record({
  rows: fc.array(
    fc.record({
      before: replayRefState,
      after: replayRefState,
      viaProbe: fc.boolean(),
    }),
    { minLength: 1, maxLength: 3 },
  ),
})

let replayRuns = 0

async function runReplayHistory(
  history: ReplayHistory,
  reach: (state: ReplayState) => void,
) {
  type ReplayRow = { id: string; ref: Map<string, number> }
  const probe = new Map([[`k`, 1]])
  const copy = () => new Map([[`k`, 1]])
  const ids = history.rows.map((_, index) => `r${index}`)
  let begin!: () => void
  let write!: (message: { type: `insert` | `update`; value: ReplayRow }) => void
  let commit!: () => void
  let truncate!: () => void
  const replay = createDeferred<void>()
  let loaded = false
  let replaying = false
  const collection = createCollection<ReplayRow>({
    id: `serialized-value-replay-${replayRuns++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        ;({ begin, write, commit, truncate } = operations)
        operations.markReady()
        return {
          loadSubset: () => {
            if (replaying) return replay.promise
            if (loaded) return true
            loaded = true
            begin()
            for (const [index, row] of history.rows.entries()) {
              if (row.before === `absent`) continue
              write({
                type: `insert`,
                value: {
                  id: ids[index]!,
                  ref: row.before === `probe` ? probe : copy(),
                },
              })
            }
            commit()
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const visible = new Set<string>()
  const events: Array<string> = []
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        events.push(`${change.type}:${String(change.key)}`)
        if (change.type === `delete`) visible.delete(String(change.key))
        else visible.add(String(change.key))
      }
    },
    {
      whereExpression: new Func(`eq`, [new PropRef([`ref`]), new Value(probe)]),
    },
  )
  const matching = (state: (row: ReplayRowSpec) => RefState) =>
    ids.filter((_, index) => state(history.rows[index]!) === `probe`)
  // An Effect reads rows by reference: its join holds a row only while the
  // row's reference is the probe instance.
  const probeSide = createCollection(
    mockSyncCollectionOptions<{ id: string; ref: Map<string, number> }>({
      id: `serialized-value-replay-probe-${replayRuns}`,
      getKey: ({ id }) => id,
      initialData: [{ id: `p`, ref: probe }],
    }),
  )
  const held = new Set<string>()
  const effectEvents: Array<string> = []
  let effect: ReturnType<typeof createEffect> | undefined
  // A second Effect reads the reference in a functional filter, which runs
  // after the subscription and sees only the rows it is sent.
  const filterHeld = new Set<string>()
  const filterEvents: Array<string> = []
  let filterEffect: ReturnType<typeof createEffect> | undefined
  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    expect([...visible].sort(), `before the truncate`).toEqual(
      matching((row) => row.before),
    )
    effect = createEffect({
      query: (q) =>
        q
          .from({ row: collection })
          .join({ p: probeSide }, ({ row, p }) => eq(row.ref, p.ref), `inner`)
          .select(({ row }) => ({ id: row.id })),
      onBatch: (batch) => {
        for (const event of batch) {
          const id = (event.value as { id: string }).id
          effectEvents.push(`${event.type}:${id}`)
          if (event.type === `exit`) held.delete(id)
          else held.add(id)
        }
      },
    })
    filterEffect = createEffect({
      query: (q) =>
        q
          .from({ row: collection })
          .fn.where(({ row }) => row.ref === probe)
          .select(({ row }) => ({ id: row.id })),
      onBatch: (batch) => {
        for (const event of batch) {
          const id = (event.value as { id: string }).id
          filterEvents.push(`${event.type}:${id}`)
          if (event.type === `exit`) filterHeld.delete(id)
          else filterHeld.add(id)
        }
      },
    })
    await flushPromises()
    expect([...held].sort(), `Effect before the truncate`).toEqual(
      matching((row) => row.before),
    )
    expect([...filterHeld].sort(), `filter Effect before the truncate`).toEqual(
      matching((row) => row.before),
    )
    replaying = true
    begin()
    truncate()
    commit()
    await flushPromises()
    for (const [index, row] of history.rows.entries()) {
      if (row.after === `absent`) continue
      const id = ids[index]!
      begin()
      if (row.after === `copy` && row.viaProbe) {
        write({ type: `insert`, value: { id, ref: probe } })
        commit()
        begin()
        write({ type: `update`, value: { id, ref: copy() } })
      } else {
        write({
          type: `insert`,
          value: { id, ref: row.after === `probe` ? probe : copy() },
        })
      }
      commit()
    }
    events.length = 0
    effectEvents.length = 0
    filterEvents.length = 0
    replay.resolve()
    await flushPromises()

    const expectedEvents: Array<string> = []
    const expectedEffectEvents: Array<string> = []
    for (const [index, row] of history.rows.entries()) {
      const id = ids[index]!
      const was = row.before === `probe`
      const is = row.after === `probe`
      if (was && !is) {
        expectedEvents.push(`delete:${id}`)
        expectedEffectEvents.push(`exit:${id}`)
      }
      if (!was && is) {
        expectedEvents.push(`insert:${id}`)
        expectedEffectEvents.push(`enter:${id}`)
      }
      expect(collection.get(id)?.ref === probe, `${id} holds the probe`).toBe(
        is,
      )
      if (was && row.after === `copy` && row.viaProbe)
        reach(`replacement-left-filter`)
      if (!was && is) reach(`entered-filter`)
      if (was && is) reach(`unchanged-redelivered`)
      if (was && row.after === `absent`) reach(`removed`)
      if (was && row.after === `copy` && !row.viaProbe)
        reach(`replay-delivered-copy`)
    }
    expect([...visible].sort(), `after the replay`).toEqual(
      matching((row) => row.after),
    )
    expect([...events].sort(), `replay publication`).toEqual(
      expectedEvents.sort(),
    )
    expect([...held].sort(), `Effect after the replay`).toEqual(
      matching((row) => row.after),
    )
    expect([...effectEvents].sort(), `Effect replay publication`).toEqual(
      expectedEffectEvents.sort(),
    )
    expect([...filterHeld].sort(), `filter Effect after the replay`).toEqual(
      matching((row) => row.after),
    )
    expect(
      [...filterEvents].sort(),
      `filter Effect replay publication`,
    ).toEqual(expectedEffectEvents.sort())
  } finally {
    replay.resolve()
    await flushPromises()
    await effect?.dispose()
    await filterEffect?.dispose()
    subscription.unsubscribe()
    await collection.cleanup()
    await probeSide.cleanup()
  }
}

const replayProperty = `serialized-value.truncate-replay`

describe(`a truncate replay follows reference replacements`, () => {
  oracleProperty({
    id: replayProperty,
    law: {
      statement: `When a direct subscriber's truncate replay completes, a filter on a reference, an Effect that joins on it and an Effect whose functional filter compares it show exactly the rows that hold that instance, and the replay publishes a delete (an Effect exit) for each row that stopped matching, including by a deep-equal replacement, an insert (an Effect enter) for each that started, and nothing for a row that still matches.`,
      authority: `Issue #2459 and the "Value classes" section of docs/guides/live-queries.md.`,
      limits: `One on-demand Collection with a Map-valued reference filter, one Effect with an inner join on that reference, one Effect with a functional filter on it, and one replay; up to three rows, each absent, holding the probe or holding a deep-equal copy before the truncate and after the replay.`,
    },
    owns: [
      'src/collection/subscription.ts#CollectionSubscription.createStateDiff',
    ],
    histories: {
      arbitrary: replayHistoryArbitrary,
      runs: 40,
      fixedSeeds: [2459],
      states: replayStates,
      constructed: [
        {
          name: `a replacement leaves, a row enters and one stays`,
          enters: [
            `replacement-left-filter`,
            `entered-filter`,
            `unchanged-redelivered`,
          ],
          build: (): ReplayHistory => ({
            rows: [
              { before: `probe`, after: `copy`, viaProbe: true },
              { before: `copy`, after: `probe`, viaProbe: false },
              { before: `probe`, after: `probe`, viaProbe: false },
            ],
          }),
        },
        {
          name: `a matching row is not delivered again or comes back as a copy`,
          enters: [`removed`, `replay-delivered-copy`],
          build: (): ReplayHistory => ({
            rows: [
              { before: `probe`, after: `absent`, viaProbe: false },
              { before: `probe`, after: `copy`, viaProbe: false },
            ],
          }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: ReplayHistory }, observe) =>
      recordAssertionJudgment(replayProperty, plan, observe, () =>
        runReplayHistory(plan.history, (state) => observe(`reach`, state)),
      ),
    check: forwardAssertionJudgment,
  })
})

// A deep-equal replacement of a joined reference, or a normal update, loads
// the joined side. The provider answers at once with each joined row moved to
// the new reference, either by a real update or by a deep-equal replacement,
// and may dispose the Effect first. Model: unless disposed, the Effect
// publishes one batch with an update for each joined row that a normal change
// touched: every row after a normal opener, otherwise each really updated row.
type JoinedChange = `real` | `silent`
type EffectLoadHistory = {
  opener: `silent` | `normal`
  rows: Array<JoinedChange>
  dispose: boolean
}
const effectLoadStates = [
  // A real update arrived beside a deep-equal replacement.
  `real-beside-replacement`,
  // A deep-equal replacement opened a load whose rows were all replacements.
  `replacements-only`,
  // The provider disposed the Effect during the load.
  `disposed-during-load`,
  // A normal update opened the load.
  `normal-opener`,
] as const
type EffectLoadState = (typeof effectLoadStates)[number]

const effectLoadHistoryArbitrary: fc.Arbitrary<EffectLoadHistory> = fc.record({
  opener: fc.constantFrom<`silent` | `normal`>(`silent`, `normal`),
  rows: fc.array(fc.constantFrom<JoinedChange>(`real`, `silent`), {
    minLength: 1,
    maxLength: 3,
  }),
  dispose: fc.boolean(),
})

let effectLoadRuns = 0

async function runEffectLoadHistory(
  history: EffectLoadHistory,
  reach: (state: EffectLoadState) => void,
) {
  type Left = { id: string; n: number; ref: Map<string, number> }
  type Right = { id: string; ref: Map<string, number>; version: number }
  const first = new Map([[`k`, 1]])
  const second = new Map([[`k`, 1]])
  const run = effectLoadRuns++
  const rightIds = history.rows.map((_, index) => `R${index}`)
  const left = createCollection(
    mockSyncCollectionOptions<Left>({
      id: `serialized-value-effect-load-left-${run}`,
      getKey: (row) => row.id,
      initialData: [{ id: `l`, n: 0, ref: first }],
    }),
  )
  let loads = 0
  // The provider reaches the Effect that its own load serves.
  const handle: { effect?: ReturnType<typeof createEffect> } = {}
  const right = createCollection<Right>({
    id: `serialized-value-effect-load-right-${run}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            loads++
            if (loads > 1 && history.dispose) void handle.effect!.dispose()
            begin()
            for (const [index, id] of rightIds.entries()) {
              write(
                loads === 1
                  ? { type: `insert`, value: { id, ref: first, version: 0 } }
                  : {
                      type: `update`,
                      value: {
                        id,
                        ref: second,
                        version: history.rows[index] === `real` ? 1 : 0,
                      },
                    },
              )
            }
            commit()
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const batches: Array<Array<string>> = []
  const effect = (handle.effect = createEffect({
    query: (q) =>
      q
        .from({ l: left })
        .join({ r: right }, ({ l, r }) => eq(l.ref, r.ref), `left`)
        .select(({ l, r }) => ({ id: l.id, rid: r.id })),
    onBatch: (events) => {
      batches.push(
        events
          .map(
            (event) => `${event.type}:${(event.value as { rid: string }).rid}`,
          )
          .sort(),
      )
    },
  }))
  try {
    await flushPromises()
    expect(batches, `initial load`).toEqual([
      rightIds.map((id) => `enter:${id}`),
    ])
    batches.length = 0
    left.utils.begin()
    left.utils.write({
      type: `update`,
      value: { id: `l`, n: history.opener === `silent` ? 0 : 1, ref: second },
    })
    expect(() => left.utils.commit(), `opening commit`).not.toThrow()
    await flushPromises()
    expect(loads, `joined loads`).toBe(2)
    for (const [index, id] of rightIds.entries())
      expect(right.get(id)?.version, `${id} version`).toBe(
        history.rows[index] === `real` ? 1 : 0,
      )
    const updated = rightIds
      .filter(
        (_, index) =>
          history.opener === `normal` || history.rows[index] === `real`,
      )
      .map((id) => `update:${id}`)
    expect(batches, `Effect after the load`).toEqual(
      history.dispose || updated.length === 0 ? [] : [updated.sort()],
    )
    if (history.dispose) reach(`disposed-during-load`)
    else if (history.opener === `normal`) reach(`normal-opener`)
    else if (history.rows.every((change) => change === `silent`))
      reach(`replacements-only`)
    if (
      !history.dispose &&
      history.rows.includes(`real`) &&
      history.rows.includes(`silent`)
    )
      reach(`real-beside-replacement`)
  } finally {
    await effect.dispose()
  }
}

const effectLoadProperty = `serialized-value.effect-joined-load`

describe(`an Effect publishes a joined load with its replacements`, () => {
  oracleProperty({
    id: effectLoadProperty,
    law: {
      statement: `A joined source that answers while an Effect applies deep-equal replacements is published in the same batch: an update reaches the Effect for each joined row that a normal change touched, even when the selected output is unchanged, nothing is reported for a row that deep-equal replacements alone kept matched, and the result matches a normal opener's. Disposing the Effect during that pass ends it without an error.`,
      authority: `Issue #2459 and the "Value classes" section of docs/guides/live-queries.md.`,
      limits: `One eager source and one on-demand source joined by a Map reference; one to three joined rows, each moved by a real update or a deep-equal replacement in one synchronous response, which may first dispose the Effect; a deep-equal or a normal left update opens the load.`,
    },
    owns: [
      'src/query/effect.ts#EffectPipelineRunner.runGraph',
      'src/query/effect.ts#EffectPipelineRunner.runGraphToQuiescence',
      'src/query/effect.ts#EffectPipelineRunner.handleSourceChanges',
    ],
    histories: {
      arbitrary: effectLoadHistoryArbitrary,
      runs: 40,
      fixedSeeds: [2459],
      states: effectLoadStates,
      constructed: [
        {
          name: `a real update beside a replacement in one response`,
          enters: [`real-beside-replacement`],
          build: (): EffectLoadHistory => ({
            opener: `silent`,
            rows: [`real`, `silent`],
            dispose: false,
          }),
        },
        {
          name: `a response of replacements alone`,
          enters: [`replacements-only`],
          build: (): EffectLoadHistory => ({
            opener: `silent`,
            rows: [`silent`],
            dispose: false,
          }),
        },
        {
          name: `the provider disposes the Effect`,
          enters: [`disposed-during-load`],
          build: (): EffectLoadHistory => ({
            opener: `silent`,
            rows: [`real`],
            dispose: true,
          }),
        },
        {
          name: `a normal update opens the load`,
          enters: [`normal-opener`, `real-beside-replacement`],
          build: (): EffectLoadHistory => ({
            opener: `normal`,
            rows: [`real`, `silent`],
            dispose: false,
          }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: EffectLoadHistory }, observe) =>
      recordAssertionJudgment(effectLoadProperty, plan, observe, () =>
        runEffectLoadHistory(plan.history, (state) => observe(`reach`, state)),
      ),
    check: forwardAssertionJudgment,
  })
})

// A pooled view, with or without a residual reference filter and optionally
// ordered by a Map field, rechecks which rows pass when it is read. Batches move
// rows between the probe instance and deep-equal copies, replace the sort field
// or a tag with a deep-equal instance, give the tag a new serialization behind
// the same enumerable fields, and really update rows. Model: after each batch,
// attached and detached readers show the rows that pass, in the group's order,
// with their values and their tag's serialization. A batch of deep-equal
// replacements that leaves the group's order and what the readers show as it
// was keeps the attached reader's snapshot and tells its subscriber nothing; a
// batch that changes what they show gives a new snapshot.
type PooledRef = `probe` | `copy`
type PooledOp = {
  row: number
  op: `to-probe` | `to-copy` | `bump` | `touch-at` | `same-tag` | `retag`
}
type PooledHistory = {
  initial: Array<PooledRef>
  residual: boolean
  ordered: boolean
  batches: Array<Array<PooledOp>>
}
const pooledStates = [
  // One batch took a row out and put another in.
  `swap-in-one-batch`,
  // A real update changed a row the view kept.
  `real-update-kept`,
  // A deep-equal replacement put a row into the view.
  `replacement-entered`,
  // A deep-equal replacement took a row out of the view.
  `replacement-left`,
  // A shown tag took a new serialization behind the same enumerable fields.
  `serialization-changed`,
  // Deep-equal replacements left an ordered group's order and the shown rows
  // as they were.
  `ordered-replacement-kept-order`,
  // A deep-equal replacement moved a shown row in an ordered view.
  `ordered-replacement-moved`,
] as const
type PooledState = (typeof pooledStates)[number]

// Moves between the probe and copies are weighted, so swaps stay common.
const pooledOp = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom<PooledOp[`op`]>(`to-probe`, `to-copy`),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom<PooledOp[`op`]>(
      `bump`,
      `touch-at`,
      `same-tag`,
      `retag`,
    ),
  },
)
const pooledHistoryArbitrary: fc.Arbitrary<PooledHistory> = fc.record({
  initial: fc.array(fc.constantFrom<PooledRef>(`probe`, `copy`), {
    minLength: 2,
    maxLength: 3,
  }),
  // Swaps need the residual filter.
  residual: fc.oneof(
    { weight: 3, arbitrary: fc.constant(true) },
    fc.constant(false),
  ),
  ordered: fc.boolean(),
  batches: fc.array(
    fc.array(
      fc.record({
        row: fc.nat({ max: 2 }),
        op: pooledOp,
      }),
      { minLength: 1, maxLength: 3 },
    ),
    { minLength: 1, maxLength: 4 },
  ),
})

/** A value class whose serialization its enumerable fields do not show. */
class PrivateTag {
  readonly kind = `tag`
  #json: string
  constructor(json: string) {
    this.#json = json
  }
  toJSON(): string {
    return this.#json
  }
}

let pooledRuns = 0

async function runPooledHistory(
  history: PooledHistory,
  reach: (state: PooledState) => void,
) {
  type SwapRow = {
    id: string
    team: string
    n: number
    ref: Map<string, number>
    at: Map<string, number>
    tag: PrivateTag
  }
  // Each sort field gets its runtime identity when made, so the group orders
  // rows by when their sort field was made.
  let atCount = 0
  const newAt = () => {
    const at = new Map<string, number>()
    getRuntimeReferenceIdentity(at)
    return { at, seq: atCount++ }
  }
  const probe = new Map([[`k`, 1]])
  const model = history.initial.map((ref, index) => ({
    id: `p${index}`,
    ref,
    n: 0,
    atSeq: 0,
    tag: 0,
  }))
  const stored = model.map((row) => {
    const { at, seq } = newAt()
    row.atSeq = seq
    return {
      id: row.id,
      team: `t`,
      n: 0,
      ref: row.ref === `probe` ? probe : new Map([[`k`, 1]]),
      at,
      tag: new PrivateTag(`tag-0`),
    }
  })
  const source = createCollection(
    mockSyncCollectionOptions<SwapRow>({
      id: `serialized-value-pooled-${pooledRuns++}`,
      getKey: (row) => row.id,
      initialData: stored.map((row) => ({ ...row })),
      autoIndex: `off`,
    }),
  )
  await source.stateWhenReady()
  const base = new Query()
    .from({ item: source })
    .where(({ item }) =>
      history.residual
        ? and(eq(item.team, `t`), eq(item.ref, probe as never))
        : eq(item.team, `t`),
    )
  const view = poolQuery(
    history.ordered ? base.orderBy(({ item }) => item.at as never) : base,
  )!
  const attached = createLiveQueryObserver<SwapRow, string>(view as never)
  let told = 0
  const stop = attached.subscribe(() => void told++)
  const detached = createLiveQueryObserver<SwapRow, string>(view as never)
  const rows = (observer: typeof attached) =>
    (observer.getSnapshot().data as Array<SwapRow>).map(
      (row) => `${row.id}:${row.n}:${row.tag.toJSON()}`,
    )
  // The group's order: by sort field when ordered, then by key.
  const groupOrder = () =>
    [...model]
      .sort((a, b) =>
        history.ordered && a.atSeq !== b.atSeq
          ? a.atSeq - b.atSeq
          : a.id < b.id
            ? -1
            : 1,
      )
      .map((row) => row.id)
  const expected = () =>
    groupOrder()
      .map((id) => model.find((row) => row.id === id)!)
      .filter((row) => !history.residual || row.ref === `probe`)
      .map((row) => `${row.id}:${row.n}:tag-${row.tag}`)
  try {
    expect(rows(attached), `initial: attached`).toEqual(expected())
    expect(rows(detached), `initial: detached`).toEqual(expected())
    for (const [step, batch] of history.batches.entries()) {
      // The last operation on a row in a batch is the one that counts.
      const last = new Map<number, PooledOp[`op`]>()
      for (const { row, op } of batch) if (row < model.length) last.set(row, op)
      const shownBefore = expected()
      const orderBefore = groupOrder().join()
      const before = new Set(shownBefore.map((entry) => entry.split(`:`)[0]))
      const shown = (index: number) =>
        before.has(model[index]!.id) || !history.residual
      let replacementsOnly = true
      await flushPromises()
      const snapshot = attached.getSnapshot()
      told = 0
      source.utils.begin()
      for (const [index, op] of last) {
        const row = model[index]!
        const next = { ...stored[index]! }
        if (op === `bump` || op === `retag`) replacementsOnly = false
        if (op === `bump`) {
          row.n += 1
          next.n = row.n
          if (shown(index)) reach(`real-update-kept`)
        } else if (op === `retag`) {
          row.tag += 1
          next.tag = new PrivateTag(`tag-${row.tag}`)
          if (shown(index)) reach(`serialization-changed`)
        } else if (op === `same-tag`) {
          next.tag = new PrivateTag(`tag-${row.tag}`)
        } else if (op === `touch-at`) {
          const { at, seq } = newAt()
          next.at = at
          row.atSeq = seq
        } else {
          if (op === `to-probe` && row.ref === `copy`)
            reach(`replacement-entered`)
          if (op === `to-copy` && row.ref === `probe`) reach(`replacement-left`)
          row.ref = op === `to-probe` ? `probe` : `copy`
          next.ref = op === `to-probe` ? probe : new Map([[`k`, 1]])
        }
        stored[index] = next
        source.utils.write({ type: `update`, value: { ...next } })
      }
      source.utils.commit()
      const shownAfter = expected()
      const after = new Set(shownAfter.map((entry) => entry.split(`:`)[0]))
      if (
        [...before].some((id) => !after.has(id)) &&
        [...after].some((id) => !before.has(id))
      )
        reach(`swap-in-one-batch`)
      expect(rows(attached), `batch ${step}: attached`).toEqual(shownAfter)
      expect(rows(detached), `batch ${step}: detached`).toEqual(shownAfter)
      await flushPromises()
      const same = shownAfter.join() === shownBefore.join()
      if (!same)
        expect(attached.getSnapshot(), `batch ${step}: new snapshot`).not.toBe(
          snapshot,
        )
      if (replacementsOnly && same && groupOrder().join() === orderBefore) {
        if (history.ordered && shownAfter.length > 0)
          reach(`ordered-replacement-kept-order`)
        expect(attached.getSnapshot(), `batch ${step}: kept snapshot`).toBe(
          snapshot,
        )
        expect(told, `batch ${step}: subscriber told`).toBe(0)
      }
      const ids = (shownRows: Array<string>, present: Set<string>) =>
        shownRows
          .map((entry) => entry.split(`:`)[0]!)
          .filter((id) => present.has(id))
          .join()
      if (
        history.ordered &&
        replacementsOnly &&
        ids(shownAfter, before) !== ids(shownBefore, after)
      )
        reach(`ordered-replacement-moved`)
    }
  } finally {
    stop()
    attached.dispose()
    detached.dispose()
    await view.cleanup()
    await source.cleanup()
  }
}

const pooledSwapProperty = `serialized-value.pooled-residual-swap`

describe(`a residual pooled view rechecks its rows when read`, () => {
  oracleProperty({
    id: pooledSwapProperty,
    law: {
      statement: `A pooled view, with or without a residual reference filter and in key or sort-field order, shows attached and detached readers alike the rows that pass, in order, with their current values, by the time each commit returns, whether deep-equal replacements move rows in or out, swap them in one batch or move them in the order, real updates change them, or a value class takes a new serialization behind the same enumerable fields. A batch of deep-equal replacements that leaves the group's order and the shown rows as they were keeps the attached reader's snapshot and tells its subscriber nothing; a batch that changes the shown rows gives a new snapshot.`,
      authority: `Issue #2459, the "Value classes" section of docs/guides/live-queries.md (a value class compares by its serialized value; a row it keeps is not republished), and the PR #2460 review (a changed serialization is a row change; an unchanged order publishes nothing).`,
      limits: `One pooled group of two or three rows with a Map reference filter or none, ordered by a Map field or by key; up to four batches of up to three row operations. In a residual view, a deep-equal replacement that moves a row only past rows the view filters out is outside the silence claim.`,
    },
    owns: [
      'src/query/pooled-live-query.ts#PooledLiveQuery._stateRevision',
      'src/query/pooled-live-query.ts#Partition.apply',
    ],
    histories: {
      arbitrary: pooledHistoryArbitrary,
      runs: 80,
      fixedSeeds: [2459],
      states: pooledStates,
      constructed: [
        {
          name: `a swap in one batch, then a real update`,
          enters: [
            `swap-in-one-batch`,
            `real-update-kept`,
            `replacement-entered`,
            `replacement-left`,
          ],
          build: (generated): PooledHistory => ({
            initial: [`probe`, `copy`],
            residual: true,
            ordered: generated.ordered,
            batches: [
              [
                { row: 0, op: `to-copy` },
                { row: 1, op: `to-probe` },
              ],
              [{ row: 1, op: `bump` }],
              ...generated.batches,
            ].slice(0, 4),
          }),
        },
        {
          name: `a tag takes a new serialization behind the same fields`,
          enters: [`serialization-changed`],
          build: (generated): PooledHistory => ({
            initial: [`probe`, ...generated.initial.slice(1)],
            residual: generated.residual,
            ordered: generated.ordered,
            batches: [[{ row: 0, op: `retag` }], ...generated.batches].slice(
              0,
              4,
            ),
          }),
        },
        {
          name: `an ordered view keeps its order through deep-equal replacements`,
          enters: [
            `ordered-replacement-kept-order`,
            `ordered-replacement-moved`,
          ],
          build: (generated): PooledHistory => ({
            initial: [`probe`, `probe`],
            residual: generated.residual,
            ordered: true,
            batches: [
              [{ row: 1, op: `touch-at` }],
              [
                { row: 0, op: `same-tag` },
                { row: 1, op: `to-probe` },
              ],
              [{ row: 0, op: `touch-at` }],
              ...generated.batches,
            ].slice(0, 4),
          }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: PooledHistory }, observe) =>
      recordAssertionJudgment(pooledSwapProperty, plan, observe, () =>
        runPooledHistory(plan.history, (state) => observe(`reach`, state)),
      ),
    check: forwardAssertionJudgment,
  })
})
