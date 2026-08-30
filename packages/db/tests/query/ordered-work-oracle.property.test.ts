import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { CollectionSubscription } from '../../src/collection/subscription.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { ReverseIndex } from '../../src/indexes/reverse-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { eq } from '../../src/query/builder/functions.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { PropRef } from '../../src/query/ir.js'
import { TotalOrder } from '../../src/query/total-order.js'
import { makeComparator } from '../../src/utils/comparison.js'
import {
  WindowState,
  diffPublications,
} from '../../src/query/live/window-state.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import type * as DbIvm from '@tanstack/db-ivm'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { CompareOptions } from '../../src/query/builder/types.js'
import type {
  ChangeMessage,
  CurrentStateAsChangesOptions,
  StringCollationConfig,
} from '../../src/types.js'
import type { OrderBy, OrderByDirection } from '../../src/query/ir.js'

const keyComparisonCounter = vi.hoisted(() => ({ count: 0 }))

vi.mock(`@tanstack/db-ivm`, async (importOriginal) => {
  const actual = await importOriginal<typeof DbIvm>()
  return {
    ...actual,
    compareKeys: (left: string | number, right: string | number) => {
      keyComparisonCounter.count++
      return actual.compareKeys(left, right)
    },
  }
})

type RankedRow = {
  id: string
  rank: number
  included: boolean
}

class CountingReadonlyMap<TKey, TValue> implements ReadonlyMap<TKey, TValue> {
  private readonly valuesByKey: Map<TKey, TValue>
  iterationReads = 0
  membershipReads = 0
  valueReads = 0

  constructor(entries: Iterable<readonly [TKey, TValue]> = []) {
    this.valuesByKey = new Map(entries)
  }

  get size(): number {
    return this.valuesByKey.size
  }

  private *countIterator<T>(
    iterator: Iterator<T>,
  ): Generator<T, undefined, unknown> {
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      this.iterationReads++
      yield next.value
    }
    return undefined
  }

  [Symbol.iterator](): Generator<[TKey, TValue], undefined, unknown> {
    return this.countIterator(this.valuesByKey[Symbol.iterator]())
  }

  entries(): Generator<[TKey, TValue], undefined, unknown> {
    return this.countIterator(this.valuesByKey.entries())
  }

  keys(): Generator<TKey, undefined, unknown> {
    return this.countIterator(this.valuesByKey.keys())
  }

  values(): Generator<TValue, undefined, unknown> {
    return this.countIterator(this.valuesByKey.values())
  }

  forEach(
    callback: (
      value: TValue,
      key: TKey,
      map: ReadonlyMap<TKey, TValue>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.valuesByKey.forEach((value, key) => {
      this.iterationReads++
      callback.call(thisArg, value, key, this)
    })
  }

  get(key: TKey): TValue | undefined {
    this.valueReads++
    return this.valuesByKey.get(key)
  }

  has(key: TKey): boolean {
    this.membershipReads++
    return this.valuesByKey.has(key)
  }
}

type PublicKeyRankedRow = Omit<RankedRow, `id`> & {
  id: string | number
}

type OrderedWork = {
  keys: Array<string>
  sourceReads: Array<string>
  expectedValueReads: number
  valueReads: number
  expectedBucketReads: number
  bucketReads: number
  expectedCursorCalls: number
  cursorCalls: number
  expectedBucketYields: number
  bucketYields: number
  unexpectedTraversalCalls: number
  expectedKeyComparisons: number
  keyComparisons: number
  totalOrderComparisons: number
}

type OrderedReadProbe = {
  getValueReads: () => number
  getBucketReads: () => number
  getCursorCalls: () => number
  getUnexpectedTraversalCalls: () => number
  restore: () => void
}

function isArrayIndex(property: PropertyKey): boolean {
  if (typeof property !== `string` || property.length === 0) return false
  const index = Number(property)
  return Number.isSafeInteger(index) && index >= 0 && String(index) === property
}

const traversalMethods = new Set<PropertyKey>([
  Symbol.iterator,
  `entries`,
  `keys`,
  `values`,
  `forEach`,
])

function observeUnexpectedTraversals<T extends object>(
  target: T,
  onTraversal: () => void,
): T {
  return new Proxy(target, {
    get(inner, property) {
      const member = Reflect.get(inner, property, inner) as unknown
      if (typeof member !== `function`) return member
      return (...args: Array<unknown>) => {
        if (traversalMethods.has(property)) onTraversal()
        return Reflect.apply(member, inner, args) as unknown
      }
    },
  })
}

function observeOrderedIndexReads(
  index: BasicIndex<string> | BTreeIndex<string>,
  indexKind: `basic` | `btree`,
  direction: OrderByDirection,
): OrderedReadProbe {
  let valueReads = 0
  let bucketReads = 0
  let cursorCalls = 0
  let unexpectedTraversalCalls = 0

  if (indexKind === `basic`) {
    const internals = index as unknown as {
      sortedValues: Array<unknown>
      valueMap: Map<unknown, ReadonlySet<string>>
      indexedKeys: Set<string>
    }
    const sortedValues = internals.sortedValues
    const valueMap = internals.valueMap
    const indexedKeys = internals.indexedKeys
    internals.sortedValues = new Proxy(sortedValues, {
      get(target, property, receiver) {
        if (isArrayIndex(property)) valueReads++
        return Reflect.get(target, property, receiver) as unknown
      },
    })
    internals.valueMap = new Proxy(valueMap, {
      get(target, property) {
        const member = Reflect.get(target, property, target) as unknown
        if (property === `get`) {
          return (value: unknown) => {
            bucketReads++
            return target.get(value)
          }
        }
        if (typeof member === `function`) {
          return (...args: Array<unknown>) => {
            unexpectedTraversalCalls++
            return member.apply(target, args)
          }
        }
        return member
      },
    })
    internals.indexedKeys = observeUnexpectedTraversals(indexedKeys, () => {
      unexpectedTraversalCalls++
    })
    return {
      getValueReads: () => valueReads,
      getBucketReads: () => bucketReads,
      getCursorCalls: () => cursorCalls,
      getUnexpectedTraversalCalls: () => unexpectedTraversalCalls,
      restore: () => {
        internals.sortedValues = sortedValues
        internals.valueMap = valueMap
        internals.indexedKeys = indexedKeys
      },
    }
  }

  const internals = index as unknown as {
    orderedEntries: {
      nextHigherPair: (key?: unknown) => readonly [unknown, unknown] | undefined
      nextLowerPair: (key?: unknown) => readonly [unknown, unknown] | undefined
    }
    valueMap: Map<unknown, ReadonlySet<string>>
    indexedKeys: Set<string>
  }
  const orderedEntries = internals.orderedEntries
  const valueMap = internals.valueMap
  const indexedKeys = internals.indexedKeys
  const expectedMethod =
    direction === `asc` ? `nextHigherPair` : `nextLowerPair`
  internals.orderedEntries = new Proxy(orderedEntries, {
    get(target, property) {
      if (property !== expectedMethod) unexpectedTraversalCalls++
      const member = Reflect.get(target, property, target) as unknown
      if (typeof member !== `function`) return member
      return (...args: Array<unknown>) => {
        if (property === expectedMethod) cursorCalls++
        const result = member.apply(target, args) as
          | readonly [unknown, unknown]
          | undefined
        if (property === `nextHigherPair` || property === `nextLowerPair`) {
          if (result !== undefined) {
            valueReads++
            bucketReads++
          }
        }
        return result
      }
    },
  })
  internals.valueMap = observeUnexpectedTraversals(valueMap, () => {
    unexpectedTraversalCalls++
  })
  internals.indexedKeys = observeUnexpectedTraversals(indexedKeys, () => {
    unexpectedTraversalCalls++
  })
  return {
    getValueReads: () => valueReads,
    getBucketReads: () => bucketReads,
    getCursorCalls: () => cursorCalls,
    getUnexpectedTraversalCalls: () => unexpectedTraversalCalls,
    restore: () => {
      internals.orderedEntries = orderedEntries
      internals.valueMap = valueMap
      internals.indexedKeys = indexedKeys
    },
  }
}

function orderedWorkCampaigns(property: string, fixedSeed: number) {
  return [
    {
      label: `fixed seed ${fixedSeed}`,
      options: { numRuns: oracleRuns(40), seed: fixedSeed },
    },
    {
      label: `random or replayed seed`,
      options: oraclePropertyOptions(40, property),
    },
  ] as const
}

function orderBy(
  direction: OrderByDirection,
  nulls: `first` | `last` = `first`,
): OrderBy {
  return [
    {
      expression: new PropRef([`rank`]),
      compareOptions: { direction, nulls },
    },
  ]
}

function orderByWithOptions(compareOptions: CompareOptions): OrderBy {
  return [{ expression: new PropRef([`rank`]), compareOptions }]
}

const publicKeyIndexCompareOptions = {
  direction: `asc`,
  nulls: `last`,
  stringSort: `locale`,
} satisfies CompareOptions

function publicKeyOrderBy(direction: OrderByDirection): OrderBy {
  return orderByWithOptions({
    ...publicKeyIndexCompareOptions,
    direction,
    nulls: direction === `asc` ? `last` : `first`,
  })
}

function comparePublicKeys(
  left: string | number,
  right: string | number,
): number {
  if (typeof left !== typeof right) {
    return typeof left === `string` ? -1 : 1
  }
  if (typeof left === `number` && typeof right === `number`) {
    const leftIsNaN = Number.isNaN(left)
    const rightIsNaN = Number.isNaN(right)
    if (leftIsNaN || rightIsNaN) {
      if (leftIsNaN && rightIsNaN) return 0
      return leftIsNaN ? 1 : -1
    }
  }
  return left < right ? -1 : left > right ? 1 : 0
}

const orderedIndexCompatibilityCases = ([`basic`, `btree`] as const).flatMap(
  (indexKind) =>
    ([`asc`, `desc`] as const).flatMap((indexDirection) =>
      ([`first`, `last`] as const).flatMap((indexNulls) =>
        ([`asc`, `desc`] as const).flatMap((queryDirection) =>
          ([`first`, `last`] as const).map((queryNulls) => ({
            indexKind,
            indexDirection,
            indexNulls,
            queryDirection,
            queryNulls,
            compatible:
              indexDirection === queryDirection
                ? indexNulls === queryNulls
                : indexNulls !== queryNulls,
          })),
        ),
      ),
    ),
)

const stringComparisonVariants = [
  {
    name: `the same locale options`,
    collation: {
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: true, sensitivity: `base` },
    },
    compatible: true,
  },
  {
    name: `lexical string order`,
    collation: { stringSort: `lexical` },
    compatible: false,
  },
  {
    name: `another locale`,
    collation: {
      stringSort: `locale`,
      locale: `de`,
      localeOptions: { numeric: true, sensitivity: `base` },
    },
    compatible: false,
  },
  {
    name: `another numeric option`,
    collation: {
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: false, sensitivity: `base` },
    },
    compatible: false,
  },
  {
    name: `another sensitivity option`,
    collation: {
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: true, sensitivity: `accent` },
    },
    compatible: false,
  },
] satisfies Array<{
  name: string
  collation: StringCollationConfig
  compatible: boolean
}>

const orderedStringCompatibilityCases = ([`basic`, `btree`] as const).flatMap(
  (indexKind) =>
    ([`asc`, `desc`] as const).flatMap((queryDirection) =>
      stringComparisonVariants.map(({ name, collation, compatible }) => ({
        name,
        indexKind,
        queryDirection,
        compareOptions: {
          ...collation,
          direction: queryDirection,
          nulls:
            queryDirection === `asc` ? (`last` as const) : (`first` as const),
        } satisfies CompareOptions,
        compatible,
      })),
    ),
)

async function observeOrderedPrefix(
  rows: ReadonlyArray<RankedRow>,
  limit: number | undefined,
  indexKind: `basic` | `btree` = `btree`,
  direction: OrderByDirection = `desc`,
): Promise<OrderedWork> {
  const collection = createCollection(
    localOnlyCollectionOptions<RankedRow>({
      id: `ordered-work-${Math.random()}`,
      getKey: (row) => row.id,
      initialData: [...rows],
    }),
  )

  try {
    await collection.preload()
    const index = collection.createIndex((row) => row.rank, {
      indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `locale`,
        },
      },
    }) as BasicIndex<string> | BTreeIndex<string>

    let expectedKeyComparisons = 0
    let expectedMatches = 0
    let expectedBucketYields = 0
    if (limit === undefined || limit > 0) {
      const keysByRank = new Map<number, Array<string>>()
      const rowsInCollectionOrder = [...rows].sort((left, right) =>
        comparePublicKeys(left.id, right.id),
      )
      for (const { id, rank } of rowsInCollectionOrder) {
        const bucket = keysByRank.get(rank)
        if (bucket === undefined) keysByRank.set(rank, [id])
        else bucket.push(id)
      }
      const expectedRanks = [...keysByRank.keys()].sort((left, right) =>
        direction === `asc` ? left - right : right - left,
      )
      for (const rank of expectedRanks) {
        expectedBucketYields++
        const orderedKeys = [...keysByRank.get(rank)!]
        orderedKeys.sort((left, right) => {
          expectedKeyComparisons++
          return comparePublicKeys(left, right)
        })
        expectedMatches += orderedKeys.filter(
          (key) => rows.find((row) => row.id === key)?.included === true,
        ).length
        if (limit !== undefined && expectedMatches >= limit) break
      }
    }

    // Observe private value traversal and bucket construction independently
    // from public generator yields. A generator can materialize all private
    // values or groups before yielding only the requested prefix.
    const readProbe = observeOrderedIndexReads(index, indexKind, direction)
    const distinctValueCount = new Set(rows.map(({ rank }) => rank)).size
    const expectedValueReads =
      indexKind === `btree` || limit === 0
        ? expectedBucketYields
        : limit === undefined
          ? distinctValueCount
          : Math.min(
              distinctValueCount,
              expectedBucketYields +
                (expectedBucketYields < distinctValueCount ? 1 : 0),
            )

    let bucketYields = 0
    const originalOrderedBuckets = index.orderedBuckets.bind(index)
    const originalOrderedBucketsReversed =
      index.orderedBucketsReversed.bind(index)
    index.orderedBuckets = function* () {
      for (const bucket of originalOrderedBuckets()) {
        bucketYields++
        yield bucket
      }
    }
    index.orderedBucketsReversed = function* () {
      for (const bucket of originalOrderedBucketsReversed()) {
        bucketYields++
        yield bucket
      }
    }

    const sourceReads: Array<string> = []
    const originalGet = collection.get.bind(collection)
    collection.get = (key) => {
      sourceReads.push(String(key))
      return originalGet(key)
    }
    const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)

    try {
      keyComparisonCounter.count = 0
      const changes = collection.currentStateAsChanges({
        where: eq(new PropRef([`included`]), true),
        orderBy: orderBy(direction, direction === `asc` ? `last` : `first`),
        limit,
      })!

      return {
        keys: changes.map(({ key }) => String(key)),
        sourceReads,
        expectedValueReads,
        valueReads: readProbe.getValueReads(),
        expectedBucketReads: expectedBucketYields,
        bucketReads: readProbe.getBucketReads(),
        expectedCursorCalls:
          indexKind === `btree`
            ? expectedBucketYields +
              Number(limit === undefined || expectedMatches < limit)
            : 0,
        cursorCalls: readProbe.getCursorCalls(),
        expectedBucketYields,
        bucketYields,
        unexpectedTraversalCalls: readProbe.getUnexpectedTraversalCalls(),
        expectedKeyComparisons,
        keyComparisons: keyComparisonCounter.count,
        totalOrderComparisons: compareEntries.mock.calls.length,
      }
    } finally {
      compareEntries.mockRestore()
      readProbe.restore()
    }
  } finally {
    await collection.cleanup()
  }
}

function createOrderedPrefixRows(
  options: {
    leadingRejects: number
    limit: number
    extraBoundaryMatches: number
    boundaryRejects: number
    trailingRows: number
  },
  direction: OrderByDirection = `desc`,
): {
  rows: Array<RankedRow>
  expectedKeys: Array<string>
  expectedSourceReads: Array<string>
} {
  const rank = (descendingRank: number) =>
    direction === `desc` ? descendingRank : -descendingRank
  const leading = Array.from(
    { length: options.leadingRejects },
    (_, index): RankedRow => ({
      id: `leading-${index.toString().padStart(2, `0`)}`,
      rank: rank(100 + index),
      included: false,
    }),
  )
  const matchingBoundary = Array.from(
    { length: options.limit + options.extraBoundaryMatches },
    (_, index): RankedRow => ({
      id: `boundary-match-${index.toString().padStart(2, `0`)}`,
      rank: rank(50),
      included: true,
    }),
  ).reverse()
  const rejectedBoundary = Array.from(
    { length: options.boundaryRejects },
    (_, index): RankedRow => ({
      id: `boundary-reject-${index.toString().padStart(2, `0`)}`,
      rank: rank(50),
      included: false,
    }),
  )
  const trailing = Array.from(
    { length: options.trailingRows },
    (_, index): RankedRow => ({
      id: `trailing-${index.toString().padStart(3, `0`)}`,
      rank: rank(10 - index),
      included: true,
    }),
  )
  const expectedKeys = matchingBoundary
    .map(({ id }) => id)
    .sort()
    .slice(0, options.limit)
  const expectedCandidateReads = [
    ...leading,
    ...matchingBoundary,
    ...rejectedBoundary,
  ]
    .sort((left, right) => {
      const valueOrder = left.rank - right.rank
      if (valueOrder !== 0) {
        return direction === `asc` ? valueOrder : -valueOrder
      }
      return comparePublicKeys(left.id, right.id)
    })
    .map(({ id }) => id)
  return {
    rows: [...trailing, ...rejectedBoundary, ...matchingBoundary, ...leading],
    expectedKeys,
    // Every row through the boundary bucket is tested once. The selected rows
    // are then read once more to materialize their change messages.
    expectedSourceReads:
      options.limit === 0 ? [] : [...expectedCandidateReads, ...expectedKeys],
  }
}

describe(`ordered source work oracle`, () => {
  it.each([`off`, `eager`] as const)(
    `does no setup work for an empty ordered window with auto-indexing %s`,
    async (autoIndex) => {
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-empty-${autoIndex}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, rank: 1, included: true },
            { id: `two`, rank: 2, included: false },
            { id: `three`, rank: 3, included: true },
          ],
          autoIndex,
          ...(autoIndex === `eager` && { defaultIndexType: BTreeIndex }),
        }),
      )

      try {
        await collection.preload()
        let whereExpressionReads = 0
        const where = new Proxy(eq(new PropRef([`included`]), true), {
          get(target, property, receiver) {
            whereExpressionReads++
            return Reflect.get(target, property, receiver) as unknown
          },
        })
        const entries = vi.spyOn(collection, `entries`)
        const get = vi.spyOn(collection, `get`)
        const createIndex = vi.spyOn(collection, `createIndex`)
        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        const indexesBefore = collection.indexes.size

        const changes = collection.currentStateAsChanges({
          where,
          orderBy: orderBy(`asc`, `last`),
          limit: 0,
        })

        expect(changes).toEqual([])
        expect(whereExpressionReads).toBe(0)
        expect(entries).not.toHaveBeenCalled()
        expect(get).not.toHaveBeenCalled()
        expect(createIndex).not.toHaveBeenCalled()
        expect(collection.indexes.size).toBe(indexesBefore)
        expect(compareEntries).not.toHaveBeenCalled()
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`defers live ordered setup until a zero window becomes positive`, async () => {
    const collection = createCollection(
      localOnlyCollectionOptions<RankedRow>({
        id: `ordered-work-live-zero-window`,
        getKey: (row) => row.id,
        initialData: [{ id: `one`, rank: 1, included: true }],
      }),
    )
    let subscription: CollectionSubscription | undefined

    try {
      await collection.preload()
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
        options: { compareOptions: publicKeyIndexCompareOptions },
      }) as BTreeIndex<string>
      subscription = new CollectionSubscription(collection, () => {}, {})
      subscription.setOrderByIndex(index)
      let orderCompilationReads = 0
      const order: OrderBy = [
        {
          expression: new Proxy(new PropRef([`rank`]), {
            get(target, property, receiver) {
              if (property === `type`) orderCompilationReads++
              return Reflect.get(target, property, receiver) as unknown
            },
          }),
          compareOptions: publicKeyIndexCompareOptions,
        },
      ]

      const readProbe = observeOrderedIndexReads(index, `btree`, `asc`)
      try {
        subscription.requestLimitedSnapshot({
          orderBy: order,
          limit: 0,
          trackLoadSubsetPromise: false,
        })
        expect(
          (
            subscription as unknown as {
              orderedWindow: WindowState | undefined
            }
          ).orderedWindow,
        ).toBeUndefined()
        // Freezing the request reads the expression tag once. It must not also
        // construct TotalOrder or compile the frozen expression for no rows.
        expect(orderCompilationReads).toBe(1)
        expect(readProbe.getValueReads()).toBe(0)
        expect(readProbe.getBucketReads()).toBe(0)
        expect(readProbe.getCursorCalls()).toBe(0)
        expect(readProbe.getUnexpectedTraversalCalls()).toBe(0)
      } finally {
        readProbe.restore()
      }

      subscription.requestLimitedSnapshot({
        orderBy: order,
        limit: 1,
        trackLoadSubsetPromise: false,
      })
      expect(
        (
          subscription as unknown as {
            orderedWindow: WindowState | undefined
          }
        ).orderedWindow,
      ).toBeDefined()
    } finally {
      subscription?.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([
    {
      name: `ascending numbers`,
      direction: `asc` as const,
      left: 1,
      right: 2,
      expected: -1,
      expectedReads: {
        direction: 1,
        nulls: 1,
        stringSort: 0,
        locale: 0,
        localeOptions: 0,
        ownKeys: 0,
        descriptors: 0,
        prototype: 0,
      },
    },
    {
      name: `ascending strings`,
      direction: `asc` as const,
      left: `a`,
      right: `b`,
      expected: -1,
      expectedReads: {
        direction: 1,
        nulls: 1,
        stringSort: 1,
        locale: 1,
        localeOptions: 1,
        ownKeys: 0,
        descriptors: 0,
        prototype: 0,
      },
    },
    {
      name: `descending numbers`,
      direction: `desc` as const,
      left: 1,
      right: 2,
      expected: 1,
      expectedReads: {
        direction: 2,
        nulls: 2,
        stringSort: 1,
        locale: 1,
        localeOptions: 1,
        ownKeys: 1,
        descriptors: 5,
        prototype: 0,
      },
    },
    {
      name: `descending strings`,
      direction: `desc` as const,
      left: `a`,
      right: `b`,
      expected: 1,
      expectedReads: {
        direction: 2,
        nulls: 2,
        stringSort: 1,
        locale: 1,
        localeOptions: 1,
        ownKeys: 1,
        descriptors: 5,
        prototype: 0,
      },
    },
  ])(
    `executes the inner comparator once for $name`,
    ({ direction, left, right, expected, expectedReads }) => {
      const reads = {
        direction: 0,
        nulls: 0,
        stringSort: 0,
        locale: 0,
        localeOptions: 0,
        ownKeys: 0,
        descriptors: 0,
        prototype: 0,
      }
      const options = new Proxy(
        {
          direction,
          nulls: `last` as const,
          stringSort: `locale` as const,
          locale: `en`,
          localeOptions: { sensitivity: `base` as const },
        } satisfies CompareOptions,
        {
          get(target, property, receiver) {
            if (typeof property === `string` && property in reads) {
              reads[property as keyof typeof reads]++
            }
            return Reflect.get(target, property, receiver) as unknown
          },
          ownKeys(target) {
            reads.ownKeys++
            return Reflect.ownKeys(target)
          },
          getOwnPropertyDescriptor(target, property) {
            reads.descriptors++
            return Reflect.getOwnPropertyDescriptor(target, property)
          },
          getPrototypeOf(target) {
            reads.prototype++
            return Reflect.getPrototypeOf(target)
          },
        },
      )

      const descriptorCopies = vi.spyOn(Object, `getOwnPropertyDescriptors`)
      const prototypeReads = vi.spyOn(Object, `getPrototypeOf`)
      let actual: number
      let descriptorCopyCount: number
      let prototypeReadCount: number
      try {
        actual = makeComparator(options)(left, right)
        descriptorCopyCount = descriptorCopies.mock.calls.length
        prototypeReadCount = prototypeReads.mock.calls.length
      } finally {
        descriptorCopies.mockRestore()
        prototypeReads.mockRestore()
      }
      expect(descriptorCopyCount).toBe(0)
      expect(prototypeReadCount).toBe(0)
      expect(actual).toBe(expected)
      expect(reads).toEqual(expectedReads)
    },
  )

  it.each([
    { indexKind: `basic`, direction: `asc` },
    { indexKind: `basic`, direction: `desc` },
    { indexKind: `btree`, direction: `asc` },
    { indexKind: `btree`, direction: `desc` },
  ] as const)(
    `does not read worse $indexKind index buckets in $direction order`,
    async ({ indexKind, direction }) => {
      const scenario = createOrderedPrefixRows(
        {
          leadingRejects: 2,
          limit: 2,
          extraBoundaryMatches: 1,
          boundaryRejects: 2,
          trailingRows: 40,
        },
        direction,
      )

      const observed = await observeOrderedPrefix(
        scenario.rows,
        2,
        indexKind,
        direction,
      )

      expect(observed.keys).toEqual(scenario.expectedKeys)
      expect(observed.sourceReads).toEqual(scenario.expectedSourceReads)
      expect(observed.valueReads).toBe(observed.expectedValueReads)
      expect(observed.bucketReads).toBe(observed.expectedBucketReads)
      expect(observed.cursorCalls).toBe(observed.expectedCursorCalls)
      expect(observed.bucketYields).toBe(observed.expectedBucketYields)
      expect(observed.unexpectedTraversalCalls).toBe(0)
      expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
      expect(observed.totalOrderComparisons).toBe(0)
    },
  )

  for (const direction of [`asc`, `desc`] as const) {
    const property =
      direction === `asc`
        ? `ordered-work.forward-prefix`
        : `ordered-work.reverse-prefix`
    const seed = direction === `asc` ? 1_780_103 : 1_780_101
    for (const campaign of orderedWorkCampaigns(property, seed)) {
      fcTest.prop(
        [
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 0, max: 60 }),
          fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        ],
        campaign.options,
      )(
        `bounds ${direction} index reads at the sufficient bucket (${campaign.label})`,
        async (
          leadingRejects,
          limit,
          extraBoundaryMatches,
          boundaryRejects,
          trailingRows,
          indexKind,
        ) => {
          const scenario = createOrderedPrefixRows(
            {
              leadingRejects,
              limit,
              extraBoundaryMatches,
              boundaryRejects,
              trailingRows,
            },
            direction,
          )
          const observed = await observeOrderedPrefix(
            scenario.rows,
            limit,
            indexKind,
            direction,
          )

          expect(observed.keys).toEqual(scenario.expectedKeys)
          expect(observed.sourceReads).toEqual(scenario.expectedSourceReads)
          expect(observed.valueReads).toBe(observed.expectedValueReads)
          expect(observed.bucketReads).toBe(observed.expectedBucketReads)
          expect(observed.cursorCalls).toBe(observed.expectedCursorCalls)
          expect(observed.bucketYields).toBe(observed.expectedBucketYields)
          expect(observed.unexpectedTraversalCalls).toBe(0)
          expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
          expect(observed.totalOrderComparisons).toBe(0)
        },
      )
    }
  }

  for (const direction of [`asc`, `desc`] as const) {
    const property =
      direction === `asc`
        ? `ordered-work.forward-exhaustion`
        : `ordered-work.reverse-exhaustion`
    const seed = direction === `asc` ? 1_780_105 : 1_780_106
    for (const campaign of orderedWorkCampaigns(property, seed)) {
      fcTest.prop(
        [
          fc.integer({ min: 0, max: 60 }),
          fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        ],
        campaign.options,
      )(
        `reads each ${direction} bucket once before proving exhaustion (${campaign.label})`,
        async (rowCount, indexKind) => {
          const rows = Array.from(
            { length: rowCount },
            (_, index): RankedRow => ({
              id: `rejected-${index.toString().padStart(2, `0`)}`,
              rank: Math.floor(index / 2),
              included: false,
            }),
          ).reverse()
          const expectedSourceReads = [...rows]
            .sort((left, right) => {
              const valueOrder = left.rank - right.rank
              if (valueOrder !== 0) {
                return direction === `asc` ? valueOrder : -valueOrder
              }
              return comparePublicKeys(left.id, right.id)
            })
            .map(({ id }) => id)

          const observed = await observeOrderedPrefix(
            rows,
            1,
            indexKind,
            direction,
          )

          expect(observed.keys).toEqual([])
          expect(observed.sourceReads).toEqual(expectedSourceReads)
          expect(observed.valueReads).toBe(observed.expectedValueReads)
          expect(observed.bucketReads).toBe(observed.expectedBucketReads)
          expect(observed.cursorCalls).toBe(observed.expectedCursorCalls)
          expect(observed.bucketYields).toBe(observed.expectedBucketYields)
          expect(observed.unexpectedTraversalCalls).toBe(0)
          expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
          expect(observed.totalOrderComparisons).toBe(0)
        },
      )
    }
  }

  it(`reads the complete tied boundary when every candidate is tied`, async () => {
    const rows = Array.from(
      { length: 25 },
      (_, index): RankedRow => ({
        id: `tied-${index.toString().padStart(2, `0`)}`,
        rank: 1,
        included: index % 2 === 0,
      }),
    ).reverse()

    const observed = await observeOrderedPrefix(rows, 3)
    expect(observed.keys).toEqual([`tied-00`, `tied-02`, `tied-04`])
    expect(observed.sourceReads).toEqual([
      ...rows.map(({ id }) => id).sort(comparePublicKeys),
      `tied-00`,
      `tied-02`,
      `tied-04`,
    ])
    expect(observed.valueReads).toBe(observed.expectedValueReads)
    expect(observed.bucketReads).toBe(observed.expectedBucketReads)
    expect(observed.cursorCalls).toBe(observed.expectedCursorCalls)
    expect(observed.bucketYields).toBe(observed.expectedBucketYields)
    expect(observed.unexpectedTraversalCalls).toBe(0)
    expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
    expect(observed.totalOrderComparisons).toBe(0)
  })

  it.each(
    ([`basic`, `btree`] as const).flatMap((indexKind) =>
      ([`asc`, `desc`] as const).flatMap((direction) =>
        ([`one tie bucket`, `many buckets`] as const).map((bucketShape) => ({
          indexKind,
          direction,
          bucketShape,
        })),
      ),
    ),
  )(
    `does exact unbounded work for $indexKind $direction order with $bucketShape`,
    async ({ indexKind, direction, bucketShape }) => {
      const rows: Array<RankedRow> =
        bucketShape === `one tie bucket`
          ? [
              { id: `d`, rank: 1, included: true },
              { id: `b`, rank: 1, included: false },
              { id: `c`, rank: 1, included: true },
              { id: `a`, rank: 1, included: true },
            ]
          : [
              { id: `d`, rank: 3, included: true },
              { id: `b`, rank: 1, included: false },
              { id: `e`, rank: 3, included: false },
              { id: `c`, rank: 2, included: true },
              { id: `a`, rank: 1, included: true },
            ]
      const orderedRows = [...rows].sort((left, right) => {
        const valueOrder = left.rank - right.rank
        if (valueOrder !== 0) {
          return direction === `asc` ? valueOrder : -valueOrder
        }
        return comparePublicKeys(left.id, right.id)
      })
      const expectedKeys = orderedRows
        .filter(({ included }) => included)
        .map(({ id }) => id)
      const expectedSourceReads = [
        ...orderedRows.map(({ id }) => id),
        ...expectedKeys,
      ]

      const observed = await observeOrderedPrefix(
        rows,
        undefined,
        indexKind,
        direction,
      )

      expect(observed.keys).toEqual(expectedKeys)
      expect(observed.sourceReads).toEqual(expectedSourceReads)
      expect(observed.valueReads).toBe(observed.expectedValueReads)
      expect(observed.bucketReads).toBe(observed.expectedBucketReads)
      expect(observed.cursorCalls).toBe(observed.expectedCursorCalls)
      expect(observed.bucketYields).toBe(observed.expectedBucketYields)
      expect(observed.unexpectedTraversalCalls).toBe(0)
      expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
      expect(observed.totalOrderComparisons).toBe(0)
    },
  )

  it.each([
    { direction: `asc`, indexNulls: `first` },
    { direction: `desc`, indexNulls: `last` },
  ] as const)(
    `stops Basic $direction traversal after a multi-value nullish tie`,
    async ({ direction, indexNulls }) => {
      type NullableRankedRow = Omit<RankedRow, `rank`> & {
        rank: number | null | undefined
      }
      const collection = createCollection(
        localOnlyCollectionOptions<NullableRankedRow>({
          id: `ordered-work-basic-nullish-${direction}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `undefined`, rank: undefined, included: true },
            { id: `null`, rank: null, included: true },
            { id: `one`, rank: 1, included: true },
            { id: `two`, rank: 2, included: true },
          ],
        }),
      )

      try {
        await collection.preload()
        const index = collection.createIndex((row) => row.rank, {
          indexType: BasicIndex,
          options: {
            compareOptions: {
              direction: `asc`,
              nulls: indexNulls,
              stringSort: `locale`,
            },
          },
        }) as BasicIndex<string>
        const readProbe = observeOrderedIndexReads(index, `basic`, direction)

        try {
          const changes = collection.currentStateAsChanges({
            orderBy: orderBy(direction, `first`),
            limit: 1,
          })!

          expect(changes.map(({ key }) => key)).toEqual([`null`])
          // The two exact nullish values form one comparator bucket. Basic
          // reads one worse value to close that group, but it must not scan the
          // second worse value or construct either worse bucket.
          expect(readProbe.getValueReads()).toBe(3)
          expect(readProbe.getBucketReads()).toBe(2)
          expect(readProbe.getUnexpectedTraversalCalls()).toBe(0)
        } finally {
          readProbe.restore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`keeps comparator-equivalent BTree values in one ordered tie class`, async () => {
    type NullableRankedRow = Omit<RankedRow, `rank`> & {
      rank: number | null | undefined
    }
    const rows: Array<NullableRankedRow> = [
      { id: `undefined`, rank: undefined, included: true },
      { id: `null`, rank: null, included: true },
      { id: `one`, rank: 1, included: true },
    ]
    const collection = createCollection(
      localOnlyCollectionOptions<NullableRankedRow>({
        id: `ordered-work-nullish-tie`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )

    try {
      await collection.preload()
      collection.createIndex((row) => row.rank, { indexType: BTreeIndex })

      const changes = collection.currentStateAsChanges({
        orderBy: orderBy(`desc`, `last`),
        limit: rows.length,
      })!

      expect(changes.map(({ key }) => key)).toEqual([
        `one`,
        `null`,
        `undefined`,
      ])
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not reverse an index with incompatible null placement`, async () => {
    type NullableRankedRow = Omit<RankedRow, `rank`> & {
      rank: number | null | undefined
    }
    const collection = createCollection(
      localOnlyCollectionOptions<NullableRankedRow>({
        id: `ordered-work-null-placement`,
        getKey: (row) => row.id,
        initialData: [
          { id: `undefined`, rank: undefined, included: true },
          { id: `null`, rank: null, included: true },
          { id: `one`, rank: 1, included: true },
        ],
      }),
    )

    try {
      await collection.preload()
      collection.createIndex((row) => row.rank, { indexType: BTreeIndex })

      const changes = collection.currentStateAsChanges({
        orderBy: orderBy(`desc`, `first`),
      })!

      expect(changes.map(({ key }) => key)).toEqual([
        `null`,
        `undefined`,
        `one`,
      ])
    } finally {
      await collection.cleanup()
    }
  })

  it.each(orderedIndexCompatibilityCases)(
    `matches $indexKind index $indexDirection/nulls-$indexNulls to query $queryDirection/nulls-$queryNulls: $compatible`,
    async ({
      indexKind,
      indexDirection,
      indexNulls,
      queryDirection,
      queryNulls,
      compatible,
    }) => {
      type NullableRankedRow = Omit<RankedRow, `rank`> & {
        rank: number | null | undefined
      }
      const collection = createCollection(
        localOnlyCollectionOptions<NullableRankedRow>({
          id: `ordered-work-index-compatibility-${indexDirection}-${indexNulls}-${queryDirection}-${queryNulls}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `undefined`, rank: undefined, included: true },
            { id: `null`, rank: null, included: true },
            { id: `one`, rank: 1, included: true },
          ],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
          options: {
            compareOptions: {
              direction: indexDirection,
              nulls: indexNulls,
              stringSort: `locale`,
            },
          },
        })

        const changes = collection.currentStateAsChanges({
          orderBy: orderBy(queryDirection, queryNulls),
          optimizedOnly: true,
        })

        expect(changes?.map(({ key }) => key)).toEqual(
          compatible
            ? queryNulls === `first`
              ? [`null`, `undefined`, `one`]
              : [`one`, `null`, `undefined`]
            : undefined,
        )
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      [
        {
          domain: `signed number`,
          tieKeys: [1, -2],
          rejectedKey: -999,
          laterKey: 999,
        },
        {
          domain: `NaN number`,
          tieKeys: [Number.NaN, 2, -1],
          rejectedKey: -999,
          laterKey: 999,
        },
        {
          domain: `case-sensitive string`,
          tieKeys: [`a`, `A`],
          rejectedKey: `rejected`,
          laterKey: `later`,
        },
        {
          domain: `non-ASCII string`,
          tieKeys: [`é`, `e`, `Ω`, `ß`],
          rejectedKey: `rejected`,
          laterKey: `later`,
        },
        {
          domain: `mixed`,
          tieKeys: [10, `2`, 2, `10`],
          rejectedKey: `rejected`,
          laterKey: `later`,
        },
      ].map((keyCase) => ({ direction, ...keyCase })),
    ),
  )(
    `fully refines a filtered $domain custom-index fallback in $direction order`,
    async ({ direction, domain, tieKeys, rejectedKey, laterKey }) => {
      const tieRank = 1
      const rejectedRank = direction === `asc` ? 0 : 2
      const laterRank = direction === `asc` ? 2 : 0
      const rows: Array<PublicKeyRankedRow> = [
        { id: laterKey, rank: laterRank, included: true },
        ...tieKeys
          .map((id) => ({ id, rank: tieRank, included: true }))
          .reverse(),
        { id: rejectedKey, rank: rejectedRank, included: false },
      ]
      const collection = createCollection(
        localOnlyCollectionOptions<PublicKeyRankedRow, string | number>({
          id: `ordered-work-custom-index-fallback-${direction}-${domain}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )

      try {
        await collection.preload()
        const index = collection.createIndex((row) => row.rank, {
          indexType: BTreeIndex,
          options: { compareOptions: publicKeyIndexCompareOptions },
        }) as BTreeIndex<string | number>
        const requestedCounts: Array<number> = []
        const customIndex = new Proxy(index, {
          get(target, property) {
            if (
              property === `orderedBuckets` ||
              property === `orderedBucketsReversed`
            ) {
              return undefined
            }
            const value = Reflect.get(target, property, target) as unknown
            if (
              typeof value === `function` &&
              (property === `takeFromStart` ||
                property === `takeReversedFromEnd`)
            ) {
              return (count: number, ...args: Array<unknown>) => {
                requestedCounts.push(count)
                return value.apply(target, [count, ...args])
              }
            }
            return typeof value === `function` ? value.bind(target) : value
          },
        })
        collection.indexes.set(index.id, customIndex)
        if (direction === `desc`) {
          expect(
            new ReverseIndex(customIndex).supportsOrderedBucketIteration,
          ).toBe(false)
        }

        const orderedTieKeys = [...tieKeys].sort(comparePublicKeys)
        const indexTieKeys =
          direction === `asc` ? orderedTieKeys : [...orderedTieKeys].reverse()
        const indexScanKeys = [rejectedKey, ...indexTieKeys, laterKey]
        const matchingIndexKeys = [...indexTieKeys, laterKey]
        const rowsByKey = new Map(rows.map((row) => [row.id, row]))
        let expectedTotalOrderComparisons = 0
        const expectedKeys = [...matchingIndexKeys]
          .sort((left, right) => {
            expectedTotalOrderComparisons++
            const leftRow = rowsByKey.get(left)!
            const rightRow = rowsByKey.get(right)!
            const rankOrder = leftRow.rank - rightRow.rank
            if (rankOrder !== 0) {
              return direction === `asc` ? rankOrder : -rankOrder
            }
            return comparePublicKeys(left, right)
          })
          .slice(0, 2)

        const sourceReads: Array<string | number> = []
        const originalGet = collection.get.bind(collection)
        collection.get = (key) => {
          sourceReads.push(key)
          return originalGet(key)
        }
        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            where: eq(new PropRef([`included`]), true),
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          expect(requestedCounts).toEqual([index.keyCount])
          expect(sourceReads).toEqual([
            ...indexScanKeys,
            ...matchingIndexKeys,
            ...expectedKeys,
          ])
          expect(compareEntries).toHaveBeenCalledTimes(
            expectedTotalOrderComparisons,
          )
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    (
      [
        { source: `no index`, IndexType: undefined },
        { source: `opaque BasicIndex`, IndexType: BasicIndex },
        { source: `opaque BTreeIndex`, IndexType: BTreeIndex },
      ] as const
    ).flatMap(({ source, IndexType }) =>
      ([`asc`, `desc`] as const).map((direction) => ({
        source,
        IndexType,
        direction,
      })),
    ),
  )(
    `does exact one-pass work for the $source fallback in $direction order`,
    async ({ source, IndexType, direction }) => {
      const rows: Array<RankedRow> = [
        {
          id: `later`,
          rank: direction === `asc` ? 2 : 0,
          included: true,
        },
        { id: `é`, rank: 1, included: true },
        { id: `e`, rank: 1, included: true },
        {
          id: `rejected`,
          rank: direction === `asc` ? 0 : 2,
          included: false,
        },
      ]
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-full-fallback-${source}-${direction}`,
          getKey: (row) => row.id,
          initialData: rows,
          autoIndex: `off`,
        }),
      )

      try {
        await collection.preload()
        if (IndexType) {
          collection.createIndex((row) => row.rank, {
            indexType: IndexType,
            options: {
              compareOptions: publicKeyIndexCompareOptions,
              compareFn: (left: number, right: number) => right - left,
            },
          })
        }

        let referenceCompilationReads = 0
        const referenceWhere = new Proxy(eq(new PropRef([`included`]), true), {
          get(target, property, receiver) {
            if (property === `type`) referenceCompilationReads++
            return Reflect.get(target, property, receiver) as unknown
          },
        })
        compileSingleRowExpression(referenceWhere)

        let compilationReads = 0
        const where = new Proxy(eq(new PropRef([`included`]), true), {
          get(target, property, receiver) {
            if (property === `type`) compilationReads++
            return Reflect.get(target, property, receiver) as unknown
          },
        })
        const expectedEntries = [...collection.entries()]
        const enumeratedKeys: Array<string | number> = []
        const originalEntries = collection.entries.bind(collection)
        collection.entries = function* () {
          for (const entry of originalEntries()) {
            enumeratedKeys.push(entry[0])
            yield entry
          }
        }
        const sourceReads: Array<string | number> = []
        const originalGet = collection.get.bind(collection)
        collection.get = (key) => {
          sourceReads.push(key)
          return originalGet(key)
        }

        let expectedTotalOrderComparisons = 0
        const expectedKeys = expectedEntries
          .map(([, row]) => row)
          .filter(({ included }) => included)
          .sort((left, right) => {
            expectedTotalOrderComparisons++
            const rankOrder = left.rank - right.rank
            if (rankOrder !== 0) {
              return direction === `asc` ? rankOrder : -rankOrder
            }
            return comparePublicKeys(left.id, right.id)
          })
          .slice(0, 2)
          .map(({ id }) => id)
        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            where,
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          expect(enumeratedKeys).toEqual(expectedEntries.map(([key]) => key))
          expect(sourceReads).toEqual([
            ...expectedEntries.map(([key]) => key),
            ...expectedKeys,
          ])
          expect(compilationReads).toBe(referenceCompilationReads)
          expect(compareEntries).toHaveBeenCalledTimes(
            expectedTotalOrderComparisons,
          )
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`does exact short-circuit work for a multi-term TotalOrder fallback`, async () => {
    type MultiTermRow = RankedRow & { secondary: number }
    const specs: Array<MultiTermRow> = [
      { id: `d`, rank: 2, secondary: 1, included: true },
      { id: `b`, rank: 1, secondary: 2, included: true },
      { id: `a`, rank: 1, secondary: 2, included: true },
      { id: `c`, rank: 1, secondary: 1, included: true },
      { id: `hidden`, rank: 0, secondary: 0, included: false },
    ]
    const reads = { rank: 0, secondary: 0, included: 0 }
    const collection = createCollection(
      localOnlyCollectionOptions<MultiTermRow>({
        id: `ordered-work-multi-term-fallback`,
        getKey: (row) => row.id,
        initialData: specs,
        autoIndex: `off`,
      }),
    )

    try {
      await collection.preload()
      const originalEntries = collection.entries.bind(collection)
      const storedRows = [...originalEntries()].map(([, value]) => value)
      collection.entries = function* () {
        for (const [key, value] of originalEntries()) {
          yield [
            key,
            new Proxy(value, {
              get(target, property, receiver) {
                if (property === `rank`) reads.rank++
                if (property === `secondary`) reads.secondary++
                if (property === `included`) reads.included++
                return Reflect.get(target, property, receiver) as unknown
              },
            }),
          ] as const
        }
      }
      reads.rank = 0
      reads.secondary = 0
      reads.included = 0

      let referenceCompilationReads = 0
      compileSingleRowExpression(
        new Proxy(new PropRef([`rank`]), {
          get(target, property, receiver) {
            if (property === `type`) referenceCompilationReads++
            return Reflect.get(target, property, receiver) as unknown
          },
        }),
      )
      expect(referenceCompilationReads).toBeGreaterThan(0)

      let termCompilationReads = 0
      const trackedTerm = (propertyName: `rank` | `secondary`) =>
        new Proxy(new PropRef([propertyName]), {
          get(target, property, receiver) {
            if (property === `type`) termCompilationReads++
            return Reflect.get(target, property, receiver) as unknown
          },
        })
      const termComparisons: [number, number] = [0, 0]
      const trackedCompareOptions = (term: 0 | 1): CompareOptions =>
        new Proxy(
          {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
          } satisfies CompareOptions,
          {
            get(target, property, receiver) {
              if (property === `direction`) termComparisons[term]++
              return Reflect.get(target, property, receiver) as unknown
            },
          },
        )
      const order: OrderBy = [
        {
          expression: trackedTerm(`rank`),
          compareOptions: trackedCompareOptions(0),
        },
        {
          expression: trackedTerm(`secondary`),
          compareOptions: trackedCompareOptions(1),
        },
      ]

      let expectedComparisons = 0
      let expectedRankReads = 0
      let expectedSecondaryReads = 0
      let expectedKeyComparisons = 0
      const expectedKeys = storedRows
        .filter(({ included }) => included)
        .sort((left, right) => {
          expectedComparisons++
          expectedRankReads += 2
          const rankOrder = left.rank - right.rank
          if (rankOrder !== 0) return rankOrder
          expectedSecondaryReads += 2
          const secondaryOrder = left.secondary - right.secondary
          if (secondaryOrder !== 0) return secondaryOrder
          expectedKeyComparisons++
          return comparePublicKeys(left.id, right.id)
        })
        .map(({ id }) => id)
      const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
      try {
        keyComparisonCounter.count = 0
        const changes = collection.currentStateAsChanges({
          where: eq(new PropRef([`included`]), true),
          orderBy: order,
        })!

        expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
        expect(termCompilationReads).toBe(referenceCompilationReads * 2)
        expect(reads.included).toBe(specs.length)
        expect(reads.rank).toBe(expectedRankReads)
        expect(reads.secondary).toBe(expectedSecondaryReads)
        expect(compareEntries).toHaveBeenCalledTimes(expectedComparisons)
        expect(termComparisons).toEqual([
          expectedComparisons,
          expectedSecondaryReads / 2,
        ])
        expect(keyComparisonCounter.count).toBe(expectedKeyComparisons)
      } finally {
        compareEntries.mockRestore()
      }
    } finally {
      await collection.cleanup()
    }
  })

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      [
        {
          capability: `neither iterator`,
          exposeForward: false,
          exposeReverse: false,
        },
        {
          capability: `the forward iterator only`,
          exposeForward: true,
          exposeReverse: false,
        },
        {
          capability: `the reverse iterator only`,
          exposeForward: false,
          exposeReverse: true,
        },
        {
          capability: `both iterators`,
          exposeForward: true,
          exposeReverse: true,
        },
      ].map((capabilities) => ({ direction, ...capabilities })),
    ),
  )(
    `trusts $capability for a custom index only when it serves $direction order`,
    async ({ direction, exposeForward, exposeReverse }) => {
      const rows: Array<RankedRow> = [
        {
          id: `later`,
          rank: direction === `asc` ? 2 : 0,
          included: true,
        },
        { id: `tie-b`, rank: 1, included: true },
        { id: `tie-a`, rank: 1, included: true },
        {
          id: `rejected`,
          rank: direction === `asc` ? 0 : 2,
          included: false,
        },
      ]
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-custom-capabilities-${direction}-${exposeForward}-${exposeReverse}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )

      try {
        await collection.preload()
        const index = collection.createIndex((row) => row.rank, {
          indexType: BTreeIndex,
          options: { compareOptions: publicKeyIndexCompareOptions },
        }) as BTreeIndex<string>
        const customIndex = new Proxy(index, {
          get(target, property) {
            if (property === `orderedBuckets` && !exposeForward) {
              return undefined
            }
            if (property === `orderedBucketsReversed` && !exposeReverse) {
              return undefined
            }
            const value = Reflect.get(target, property, target) as unknown
            return typeof value === `function` ? value.bind(target) : value
          },
        })
        collection.indexes.set(index.id, customIndex)

        const expectedKeys = rows
          .filter(({ included }) => included)
          .sort((left, right) => {
            const rankOrder = left.rank - right.rank
            if (rankOrder !== 0) {
              return direction === `asc` ? rankOrder : -rankOrder
            }
            return comparePublicKeys(left.id, right.id)
          })
          .slice(0, 2)
          .map(({ id }) => id)
        const usesLazyBuckets =
          exposeForward && (direction === `asc` || exposeReverse)
        expect(
          new ReverseIndex(customIndex).supportsOrderedBucketIteration,
        ).toBe(exposeForward && exposeReverse)

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            where: eq(new PropRef([`included`]), true),
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          if (usesLazyBuckets) {
            expect(compareEntries).not.toHaveBeenCalled()
          } else {
            expect(compareEntries).toHaveBeenCalled()
          }
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    (
      [
        { name: `BasicIndex`, IndexType: BasicIndex },
        { name: `BTreeIndex`, IndexType: BTreeIndex },
      ] as const
    ).flatMap(({ name, IndexType }) =>
      ([`asc`, `desc`] as const).map((direction) => ({
        name,
        IndexType,
        direction,
      })),
    ),
  )(
    `fully refines a $name custom comparator in $direction order`,
    async ({ name, IndexType, direction }) => {
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-custom-comparator-${name}-${direction}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, rank: 1, included: true },
            { id: `two`, rank: 2, included: true },
            { id: `three`, rank: 3, included: true },
          ],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: {
            compareOptions: publicKeyIndexCompareOptions,
            compareFn: (left: number, right: number) => right - left,
          },
        })

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
          })!

          expect(changes.map(({ key }) => key)).toEqual(
            direction === `asc` ? [`one`, `two`] : [`three`, `two`],
          )
          expect(compareEntries).toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  for (const campaign of orderedWorkCampaigns(
    `ordered-work.custom-comparator-fallback`,
    1_780_104,
  )) {
    fcTest.prop(
      [
        fc.array(fc.integer({ min: -20, max: 20 }), {
          minLength: 2,
          maxLength: 8,
        }),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        fc.constantFrom<OrderByDirection>(`asc`, `desc`),
      ],
      campaign.options,
    )(
      `fully refines generated custom comparator indexes (${campaign.label})`,
      async (ranks, requestedLimit, indexKind, direction) => {
        const rows = ranks.map(
          (rank, index): RankedRow => ({
            id: `row-${index.toString().padStart(2, `0`)}`,
            rank,
            included: true,
          }),
        )
        const limit = Math.min(requestedLimit, rows.length)
        const expectedKeys = [...rows]
          .sort((left, right) => {
            const rankOrder = left.rank - right.rank
            if (rankOrder !== 0) {
              return direction === `asc` ? rankOrder : -rankOrder
            }
            return comparePublicKeys(left.id, right.id)
          })
          .slice(0, limit)
          .map(({ id }) => id)
        const collection = createCollection(
          localOnlyCollectionOptions<RankedRow>({
            id: `ordered-work-custom-comparator-property-${Math.random()}`,
            getKey: (row) => row.id,
            initialData: rows,
          }),
        )

        try {
          await collection.preload()
          collection.createIndex((row) => row.rank, {
            indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
            options: {
              compareOptions: publicKeyIndexCompareOptions,
              compareFn: (left: number, right: number) => right - left,
            },
          })

          const compareEntries = vi.spyOn(
            TotalOrder.prototype,
            `compareEntries`,
          )
          try {
            const changes = collection.currentStateAsChanges({
              orderBy: publicKeyOrderBy(direction),
              limit,
            })!

            expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
            expect(compareEntries).toHaveBeenCalled()
          } finally {
            compareEntries.mockRestore()
          }
        } finally {
          await collection.cleanup()
        }
      },
    )
  }

  it(`groups comparator-equivalent values in every built-in index direction`, () => {
    type TextRow = { id: string; value: string }
    const rows: Array<TextRow> = [
      { id: `upper`, value: `A` },
      { id: `lower`, value: `a` },
      { id: `later`, value: `b` },
    ]

    for (const IndexType of [BasicIndex, BTreeIndex]) {
      const index = new IndexType<string>(
        1,
        new PropRef([`value`]),
        undefined,
        {
          compareFn: (left: string, right: string) =>
            left.toLowerCase().localeCompare(right.toLowerCase()),
        },
      )
      index.build(rows.map((row) => [row.id, row]))

      expect(
        [...index.orderedBuckets()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`lower`, `upper`], [`later`]])
      expect(
        [...index.orderedBucketsReversed()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`later`], [`lower`, `upper`]])
      expect(
        [...new ReverseIndex(index).orderedBuckets()].map(([, keys]) =>
          [...keys].sort(),
        ),
      ).toEqual([[`later`], [`lower`, `upper`]])

      index.remove(`lower`, rows[1])
      expect([...index.equalityLookup(`A`)]).toEqual([`upper`])
      expect([...index.equalityLookup(`a`)]).toEqual([])
      expect(
        [...index.orderedBuckets()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`upper`], [`later`]])
    }
  })

  it.each([
    {
      name: `BasicIndex`,
      IndexType: BasicIndex,
      direction: `asc`,
      expectedKeys: [`a`, `z`],
    },
    {
      name: `BasicIndex`,
      IndexType: BasicIndex,
      direction: `desc`,
      expectedKeys: [`m`, `a`],
    },
    {
      name: `BTreeIndex`,
      IndexType: BTreeIndex,
      direction: `asc`,
      expectedKeys: [`a`, `z`],
    },
    {
      name: `BTreeIndex`,
      IndexType: BTreeIndex,
      direction: `desc`,
      expectedKeys: [`m`, `a`],
    },
  ] as const)(
    `keeps the public-key suffix ascending for $name in $direction order`,
    async ({ name, IndexType, direction, expectedKeys }) => {
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-key-suffix-${name}-${direction}`,
          getKey: (row) => row.id,
          initialData: [{ id: `m`, rank: 2, included: true }],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareOptions: publicKeyIndexCompareOptions },
        })
        const z = collection.insert({ id: `z`, rank: 1, included: true })
        await z.isPersisted.promise
        const a = collection.insert({ id: `a`, rank: 1, included: true })
        await a.isPersisted.promise

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
            optimizedOnly: true,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          expect(compareEntries).not.toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    (
      [
        { name: `BasicIndex`, IndexType: BasicIndex },
        { name: `BTreeIndex`, IndexType: BTreeIndex },
      ] as const
    ).flatMap(({ name, IndexType }) =>
      ([`asc`, `desc`] as const).flatMap((direction) =>
        [
          { domain: `signed number`, keys: [1, -2] },
          { domain: `NaN number`, keys: [Number.NaN, 2, -1] },
          { domain: `case-sensitive string`, keys: [`a`, `A`] },
          { domain: `non-ASCII string`, keys: [`é`, `e`, `Ω`, `ß`] },
          { domain: `mixed`, keys: [10, `2`, 2, `10`] },
        ].map(({ domain, keys }) => ({
          name,
          IndexType,
          direction,
          domain,
          keys,
        })),
      ),
    ),
  )(
    `keeps $domain public keys in compareKeys order for $name in $direction order`,
    async ({ name, IndexType, direction, keys }) => {
      const collection = createCollection(
        localOnlyCollectionOptions<PublicKeyRankedRow, string | number>({
          id: `ordered-work-${name}-${direction}-${keys.join(`-`)}`,
          getKey: (row) => row.id,
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareOptions: publicKeyIndexCompareOptions },
        })
        for (const key of keys) {
          const transaction = collection.insert({
            id: key,
            rank: 1,
            included: true,
          })
          await transaction.isPersisted.promise
        }
        let expectedKeyComparisons = 0
        const expectedKeys = [...keys].sort((left, right) => {
          expectedKeyComparisons++
          return comparePublicKeys(left, right)
        })
        const sourceReads: Array<string | number> = []
        const originalGet = collection.get.bind(collection)
        collection.get = (key) => {
          sourceReads.push(key)
          return originalGet(key)
        }

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          keyComparisonCounter.count = 0
          const changes = collection.currentStateAsChanges({
            orderBy: publicKeyOrderBy(direction),
            limit: keys.length,
            optimizedOnly: true,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          expect(sourceReads).toEqual([...expectedKeys, ...expectedKeys])
          expect(keyComparisonCounter.count).toBe(expectedKeyComparisons)
          expect(compareEntries).not.toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  for (const campaign of orderedWorkCampaigns(
    `ordered-work.public-key-suffix`,
    1_780_102,
  )) {
    fcTest.prop(
      [
        fc.uniqueArray(
          fc.oneof(
            fc.integer({ min: -999, max: 999 }),
            fc.constant(Number.NaN),
          ),
          {
            minLength: 2,
            maxLength: 8,
          },
        ),
        fc.integer({ min: 1, max: 16 }),
        fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        fc.constantFrom<OrderByDirection>(`asc`, `desc`),
        fc.constantFrom<`string` | `number` | `mixed`>(
          `string`,
          `number`,
          `mixed`,
        ),
      ],
      campaign.options,
    )(
      `orders dynamic tie keys for every built-in path (${campaign.label})`,
      async (keyNumbers, requestedLimit, indexKind, direction, keyDomain) => {
        const keys: Array<string | number> =
          keyDomain === `string`
            ? keyNumbers.map((key, index) =>
                index % 2 === 0 ? `key-${key}` : `Key-${key}`,
              )
            : keyDomain === `number`
              ? keyNumbers
              : keyNumbers.flatMap((key) => [String(key), key])
        const limit = Math.min(requestedLimit, keys.length)
        const collection = createCollection(
          localOnlyCollectionOptions<PublicKeyRankedRow, string | number>({
            id: `ordered-work-key-property-${Math.random()}`,
            getKey: (row) => row.id,
          }),
        )

        try {
          await collection.preload()
          collection.createIndex((row) => row.rank, {
            indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
            options: { compareOptions: publicKeyIndexCompareOptions },
          })
          for (const key of keys) {
            const transaction = collection.insert({
              id: key,
              rank: 1,
              included: true,
            })
            await transaction.isPersisted.promise
          }

          const compareEntries = vi.spyOn(
            TotalOrder.prototype,
            `compareEntries`,
          )
          try {
            const changes = collection.currentStateAsChanges({
              orderBy: publicKeyOrderBy(direction),
              limit,
              optimizedOnly: true,
            })!

            expect(changes.map(({ key }) => key)).toEqual(
              [...keys].sort(comparePublicKeys).slice(0, limit),
            )
            expect(compareEntries).not.toHaveBeenCalled()
          } finally {
            compareEntries.mockRestore()
          }
        } finally {
          await collection.cleanup()
        }
      },
    )
  }

  it.each(
    ([`basic`, `btree`] as const).flatMap((indexKind) =>
      ([`asc`, `desc`] as const).flatMap((direction) =>
        ([`string`, `nullish`] as const).map((orderDomain) => ({
          indexKind,
          direction,
          orderDomain,
        })),
      ),
    ),
  )(
    `does exact optimized work for $indexKind $direction $orderDomain order values`,
    async ({ indexKind, direction, orderDomain }) => {
      type DomainRow = Omit<RankedRow, `rank`> & {
        rank: string | number | null | undefined
      }
      const rows: Array<DomainRow> =
        orderDomain === `string`
          ? [
              { id: `item-10`, rank: `item-10`, included: true },
              { id: `item-2`, rank: `item-2`, included: true },
            ]
          : [
              { id: `undefined`, rank: undefined, included: true },
              { id: `null`, rank: null, included: true },
              { id: `two`, rank: 2, included: true },
              { id: `one`, rank: 1, included: true },
            ]
      const expectedKeys =
        orderDomain === `string`
          ? direction === `asc`
            ? [`item-2`, `item-10`]
            : [`item-10`, `item-2`]
          : direction === `asc`
            ? [`one`, `two`, `null`, `undefined`]
            : [`null`, `undefined`, `two`, `one`]
      const indexCompareOptions = {
        direction: `asc`,
        nulls: `last`,
        stringSort: `locale`,
        locale: `en`,
        localeOptions: { numeric: true, sensitivity: `base` as const },
      } satisfies CompareOptions
      const queryCompareOptions = {
        ...indexCompareOptions,
        direction,
        nulls: direction === `asc` ? (`last` as const) : (`first` as const),
      } satisfies CompareOptions
      const collection = createCollection(
        localOnlyCollectionOptions<DomainRow>({
          id: `ordered-work-domain-${indexKind}-${direction}-${orderDomain}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )

      try {
        await collection.preload()
        const index = collection.createIndex((row) => row.rank, {
          indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
          options: { compareOptions: indexCompareOptions },
        }) as BasicIndex<string> | BTreeIndex<string>
        const readProbe = observeOrderedIndexReads(index, indexKind, direction)
        const sourceReads: Array<string | number> = []
        let predicateReads = 0
        const originalGet = collection.get.bind(collection)
        collection.get = (key) => {
          sourceReads.push(key)
          const value = originalGet(key)
          return value === undefined
            ? undefined
            : new Proxy(value, {
                get(target, property, receiver) {
                  if (property === `included`) predicateReads++
                  return Reflect.get(target, property, receiver) as unknown
                },
              })
        }
        const bucketCount =
          orderDomain === `string` ? 2 : indexKind === `basic` ? 4 : 3

        try {
          keyComparisonCounter.count = 0
          const changes = collection.currentStateAsChanges({
            where: eq(new PropRef([`included`]), true),
            orderBy: orderByWithOptions(queryCompareOptions),
            optimizedOnly: true,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          expect(sourceReads).toEqual([...expectedKeys, ...expectedKeys])
          expect(predicateReads).toBe(rows.length)
          expect(readProbe.getValueReads()).toBe(bucketCount)
          expect(readProbe.getBucketReads()).toBe(bucketCount)
          expect(readProbe.getCursorCalls()).toBe(
            indexKind === `btree` ? bucketCount + 1 : 0,
          )
          expect(readProbe.getUnexpectedTraversalCalls()).toBe(0)
          expect(keyComparisonCounter.count).toBe(
            orderDomain === `nullish` ? 1 : 0,
          )
        } finally {
          readProbe.restore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`retains requested comparison metadata on an automatic index`, async () => {
    type NullableRankedRow = Omit<RankedRow, `rank`> & {
      rank: string | null | undefined
    }
    const compareOptions = {
      direction: `desc`,
      nulls: `first`,
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: true, sensitivity: `base` },
    } satisfies CompareOptions
    const collection = createCollection(
      localOnlyCollectionOptions<NullableRankedRow>({
        id: `ordered-work-auto-index-options`,
        getKey: (row) => row.id,
        initialData: [
          { id: `undefined`, rank: undefined, included: true },
          { id: `null`, rank: null, included: true },
          { id: `item-2`, rank: `item-2`, included: true },
          { id: `item-10`, rank: `item-10`, included: true },
        ],
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )

    try {
      await collection.preload()
      const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
      try {
        const changes = collection.currentStateAsChanges({
          orderBy: orderByWithOptions(compareOptions),
          limit: 4,
          optimizedOnly: true,
        })

        expect(changes?.map(({ key }) => key)).toEqual([
          `null`,
          `undefined`,
          `item-10`,
          `item-2`,
        ])
        expect(compareEntries).not.toHaveBeenCalled()
      } finally {
        compareEntries.mockRestore()
      }
    } finally {
      await collection.cleanup()
    }
  })

  it.each(orderedStringCompatibilityCases)(
    `matches a $indexKind index against $name in $queryDirection order: $compatible`,
    async ({ indexKind, queryDirection, compareOptions, compatible }) => {
      type TextRankedRow = Omit<RankedRow, `rank`> & { rank: string }
      const indexCompareOptions = {
        direction: `asc`,
        nulls: `last`,
        stringSort: `locale`,
        locale: `en`,
        localeOptions: { numeric: true, sensitivity: `base` },
      } satisfies CompareOptions
      const collection = createCollection(
        localOnlyCollectionOptions<TextRankedRow>({
          id: `ordered-work-string-options-${Math.random()}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `item-10`, rank: `item-10`, included: true },
            { id: `item-2`, rank: `item-2`, included: true },
          ],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
          options: { compareOptions: indexCompareOptions },
        })

        const changes = collection.currentStateAsChanges({
          orderBy: orderByWithOptions(compareOptions),
          optimizedOnly: true,
        })

        expect(changes?.map(({ key }) => key)).toEqual(
          compatible
            ? queryDirection === `asc`
              ? [`item-2`, `item-10`]
              : [`item-10`, `item-2`]
            : undefined,
        )
      } finally {
        await collection.cleanup()
      }
    },
  )
})

type SnapshotFixture = {
  collection: CollectionImpl<RankedRow, string>
  snapshotRevisions: Array<number>
  replace: (row: RankedRow) => void
}

function createSnapshotFixture(
  initialRows: ReadonlyArray<RankedRow>,
): SnapshotFixture {
  let rows = new Map(initialRows.map((row) => [row.id, row]))
  let revision = 0
  const snapshotRevisions: Array<number> = []
  const collection = {
    compareOptions: { stringSort: `lexical` },
    get _stateRevision() {
      return revision
    },
    currentStateAsChanges: (options: CurrentStateAsChangesOptions) => {
      snapshotRevisions.push(revision)
      return [...rows]
        .filter(([, value]) => options.where === undefined || value.included)
        .sort((left, right) =>
          left[1].rank === right[1].rank
            ? left[0].localeCompare(right[0])
            : left[1].rank - right[1].rank,
        )
        .map(
          ([key, value]): ChangeMessage<RankedRow, string> => ({
            type: `insert`,
            key,
            value,
          }),
        )
    },
    entries: () => rows.entries(),
    get: (key: string) => rows.get(key),
  } as unknown as CollectionImpl<RankedRow, string>

  return {
    collection,
    snapshotRevisions,
    replace: (row) => {
      rows = new Map(rows).set(row.id, row)
      revision++
    },
  }
}

function observeWindow<TRow extends RankedRow, TKey extends string | number>(
  window: WindowState<TRow, TKey>,
) {
  return {
    localPrefixSize: window.localPrefixSize,
    rowsNeeded: window.rowsNeeded(),
    publication: window.publicationEntries().map(([key]) => key),
    boundary: window.boundary(),
    requestBoundary: window.requestBoundary(),
    progressBoundary: window.progressBoundary(),
    changes: window.reconcile(new Map()).map(({ key }) => key),
  }
}

function createCoveredWindow(fixture: SnapshotFixture, size: number) {
  const window = new WindowState(
    fixture.collection,
    orderBy(`asc`),
    eq(new PropRef([`included`]), true),
    size,
  )
  window.recordInitialCoverage(undefined, true)
  return window
}

it(`reuses one ordered source snapshot until the collection revision changes`, () => {
  const fixture = createSnapshotFixture([
    { id: `a`, rank: 1, included: true },
    { id: `b`, rank: 2, included: true },
    { id: `hidden`, rank: 0, included: false },
  ])
  const window = createCoveredWindow(fixture, 2)

  expect(observeWindow(window)).toMatchObject({
    localPrefixSize: 2,
    rowsNeeded: 0,
    publication: [`a`, `b`],
  })
  expect(observeWindow(window)).toMatchObject({ publication: [`a`, `b`] })
  expect(fixture.snapshotRevisions).toEqual([0])

  fixture.replace({ id: `b`, rank: -1, included: true })

  expect(observeWindow(window)).toMatchObject({ publication: [`b`, `a`] })
  expect(observeWindow(window)).toMatchObject({ publication: [`b`, `a`] })
  expect(fixture.snapshotRevisions).toEqual([0, 1])
})

it(`does only exact predicate and boundary work when reusing an unbounded snapshot`, async () => {
  const reads = { rank: 0, included: 0 }
  const rows: Array<RankedRow> = [`é`, `e`, `Ω`, `ß`, `A`].map((id) => ({
    id,
    rank: 1,
    included: true,
  }))
  const collection = createCollection(
    localOnlyCollectionOptions<RankedRow>({
      id: `ordered-work-unbounded-snapshot-reuse`,
      getKey: (row) => row.id,
      initialData: rows,
    }),
  )

  try {
    await collection.preload()
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: { compareOptions: publicKeyIndexCompareOptions },
    }) as BTreeIndex<string>
    const expectedKeys = rows.map(({ id }) => id).sort(comparePublicKeys)
    const expectedKeyComparisons = Math.max(0, expectedKeys.length - 1)

    const readProbe = observeOrderedIndexReads(index, `btree`, `asc`)
    const sourceReads: Array<string | number> = []
    const originalGet = collection.get.bind(collection)
    const observedValues = new Map<
      Parameters<typeof originalGet>[0],
      NonNullable<ReturnType<typeof originalGet>>
    >()
    collection.get = (key) => {
      sourceReads.push(key)
      const value = originalGet(key)
      if (value === undefined) return
      let observed = observedValues.get(key)
      if (observed === undefined) {
        observed = new Proxy(value, {
          get(target, property, receiver) {
            if (property === `rank`) reads.rank++
            if (property === `included`) reads.included++
            return Reflect.get(target, property, receiver) as unknown
          },
        })
        observedValues.set(key, observed)
      }
      return observed
    }
    const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
    const window = new WindowState(
      collection,
      publicKeyOrderBy(`asc`),
      eq(new PropRef([`included`]), true),
      3,
    )
    window.recordInitialCoverage(undefined, true)

    try {
      keyComparisonCounter.count = 0
      reads.rank = 0
      reads.included = 0
      expect(observeWindow(window)).toMatchObject({
        publication: expectedKeys.slice(0, 3),
      })
      expect(sourceReads).toEqual([...expectedKeys, ...expectedKeys])
      expect(readProbe.getValueReads()).toBe(1)
      expect(readProbe.getBucketReads()).toBe(1)
      expect(readProbe.getCursorCalls()).toBe(2)
      expect(readProbe.getUnexpectedTraversalCalls()).toBe(0)
      expect(keyComparisonCounter.count).toBe(expectedKeyComparisons)
      expect(compareEntries).not.toHaveBeenCalled()
      expect(reads.included).toBe(rows.length * 5)
      expect(reads.rank).toBe(3)

      const firstReadCount = sourceReads.length
      const firstValueReads = readProbe.getValueReads()
      const firstBucketReads = readProbe.getBucketReads()
      const firstCursorCalls = readProbe.getCursorCalls()
      const firstKeyComparisons = keyComparisonCounter.count
      const firstPredicateReads = reads.included
      const firstOrderTermReads = reads.rank

      expect(observeWindow(window)).toMatchObject({
        publication: expectedKeys.slice(0, 3),
      })
      expect(sourceReads).toHaveLength(firstReadCount)
      expect(readProbe.getValueReads()).toBe(firstValueReads)
      expect(readProbe.getBucketReads()).toBe(firstBucketReads)
      expect(readProbe.getCursorCalls()).toBe(firstCursorCalls)
      expect(keyComparisonCounter.count).toBe(firstKeyComparisons)
      expect(compareEntries).not.toHaveBeenCalled()
      expect(reads.included - firstPredicateReads).toBe(rows.length * 5)
      expect(reads.rank - firstOrderTermReads).toBe(3)
    } finally {
      compareEntries.mockRestore()
      readProbe.restore()
    }
  } finally {
    await collection.cleanup()
  }
})

it(`reuses a multi-term snapshot while extracting each boundary term once`, () => {
  type MultiTermWindowRow = RankedRow & { secondary: number }
  const reads = { rank: 0, secondary: 0 }
  const row = (
    id: string,
    rank: number,
    secondary: number,
  ): MultiTermWindowRow => ({
    id,
    get rank() {
      reads.rank++
      return rank
    },
    get secondary() {
      reads.secondary++
      return secondary
    },
    included: true,
  })
  const rows = new Map<string, MultiTermWindowRow>([
    [`a`, row(`a`, 1, 2)],
    [`b`, row(`b`, 1, 3)],
    [`c`, row(`c`, 2, 1)],
  ])
  let snapshotCalls = 0
  const collection = {
    _stateRevision: 0,
    currentStateAsChanges: () => {
      snapshotCalls++
      return [...rows].map(
        ([key, value]): ChangeMessage<MultiTermWindowRow, string> => ({
          type: `insert`,
          key,
          value,
        }),
      )
    },
    entries: () => rows.entries(),
    get: (key: string) => rows.get(key),
  } as unknown as CollectionImpl<MultiTermWindowRow, string>
  const order: OrderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: { direction: `asc`, nulls: `last` },
    },
    {
      expression: new PropRef([`secondary`]),
      compareOptions: { direction: `asc`, nulls: `last` },
    },
  ]
  const window = new WindowState(collection, order, undefined, 2)
  window.recordInitialCoverage(undefined, true)

  reads.rank = 0
  reads.secondary = 0
  expect(observeWindow(window)).toMatchObject({ publication: [`a`, `b`] })
  expect(snapshotCalls).toBe(1)
  expect(reads).toEqual({ rank: 3, secondary: 3 })

  expect(observeWindow(window)).toMatchObject({ publication: [`a`, `b`] })
  expect(snapshotCalls).toBe(1)
  expect(reads).toEqual({ rank: 6, secondary: 6 })
})

it(`scans each source row once when retaining additional-demand rows`, () => {
  const rows = new Map<string, RankedRow>([
    [`a`, { id: `a`, rank: 1, included: true }],
    [`b`, { id: `b`, rank: 2, included: true }],
    [`c`, { id: `c`, rank: 3, included: true }],
  ])
  let snapshotCalls = 0
  let entryReads = 0
  let retentionChecks = 0
  const collection = {
    _stateRevision: 0,
    currentStateAsChanges: () => {
      snapshotCalls++
      return [...rows].map(
        ([key, value]): ChangeMessage<RankedRow, string> => ({
          type: `insert`,
          key,
          value,
        }),
      )
    },
    entries: function* () {
      for (const entry of rows) {
        entryReads++
        yield entry
      }
    },
    get: (key: string) => rows.get(key),
  } as unknown as CollectionImpl<RankedRow, string>
  const window = new WindowState(collection, orderBy(`asc`), undefined, 1)
  window.recordInitialCoverage(undefined, true)

  const reconcile = (publishedRows: CountingReadonlyMap<string, RankedRow>) => {
    entryReads = 0
    retentionChecks = 0
    const changes = window.reconcile(publishedRows, (candidate) => {
      retentionChecks++
      return candidate.id === `c`
    })
    expect(entryReads).toBe(rows.size)
    expect(retentionChecks).toBe(rows.size)
    expect(publishedRows.iterationReads).toBe(publishedRows.size)
    expect(publishedRows.membershipReads).toBe(2)
    return changes
  }

  expect(reconcile(new CountingReadonlyMap()).map(({ key }) => key)).toEqual([
    `a`,
    `c`,
  ])
  expect(snapshotCalls).toBe(1)
  expect(
    reconcile(
      new CountingReadonlyMap([
        [`a`, rows.get(`a`)!],
        [`b`, rows.get(`b`)!],
      ]),
    ).map(({ type, key }) => `${type}:${key}`),
  ).toEqual([`delete:b`, `insert:c`])
  expect(snapshotCalls).toBe(1)
})

it(`scans each side of a publication diff exactly once`, () => {
  type RowWork = {
    valueReads: number
    keyReads: number
    membershipReads: number
    descriptorReads: number
  }
  const emptyRowWork = (): RowWork => ({
    valueReads: 0,
    keyReads: 0,
    membershipReads: 0,
    descriptorReads: 0,
  })
  const rowWork = {
    published: emptyRowWork(),
    desired: emptyRowWork(),
  }
  const countedRow = (row: RankedRow, side: keyof typeof rowWork): RankedRow =>
    new Proxy(row, {
      get(target, property, receiver) {
        if (typeof property === `string` && Object.hasOwn(target, property)) {
          rowWork[side].valueReads++
        }
        return Reflect.get(target, property, receiver) as unknown
      },
      ownKeys(target) {
        rowWork[side].keyReads++
        return Reflect.ownKeys(target)
      },
      has(target, property) {
        if (typeof property === `string` && Object.hasOwn(target, property)) {
          rowWork[side].membershipReads++
        }
        return Reflect.has(target, property)
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === `string` && Object.hasOwn(target, property)) {
          rowWork[side].descriptorReads++
        }
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
  const publishedRows = new CountingReadonlyMap<string, RankedRow>([
    [`a`, countedRow({ id: `a`, rank: 2, included: true }, `published`)],
    [`b`, { id: `b`, rank: 2, included: true }],
    [`d`, countedRow({ id: `d`, rank: 4, included: true }, `published`)],
  ])
  const desiredRows = new CountingReadonlyMap<string, RankedRow>([
    [`a`, countedRow({ id: `a`, rank: 1, included: true }, `desired`)],
    [`c`, { id: `c`, rank: 3, included: true }],
    [`d`, countedRow({ id: `d`, rank: 4, included: true }, `desired`)],
  ])

  const defaultIterator = vi.spyOn(Map.prototype, Symbol.iterator)
  const entries = vi.spyOn(Map.prototype, `entries`)
  const keys = vi.spyOn(Map.prototype, `keys`)
  const values = vi.spyOn(Map.prototype, `values`)
  const forEach = vi.spyOn(Map.prototype, `forEach`)

  try {
    expect(
      diffPublications(publishedRows, desiredRows).map(
        ({ type, key }) => `${type}:${key}`,
      ),
    ).toEqual([`update:a`, `delete:b`, `insert:c`])
    expect(
      defaultIterator.mock.calls.length +
        entries.mock.calls.length +
        keys.mock.calls.length +
        values.mock.calls.length +
        forEach.mock.calls.length,
    ).toBe(2)
  } finally {
    defaultIterator.mockRestore()
    entries.mockRestore()
    keys.mockRestore()
    values.mockRestore()
    forEach.mockRestore()
  }
  expect(publishedRows.iterationReads).toBe(publishedRows.size)
  expect(publishedRows.membershipReads).toBe(desiredRows.size)
  expect(publishedRows.valueReads).toBe(0)
  expect(desiredRows.iterationReads).toBe(desiredRows.size)
  expect(desiredRows.membershipReads).toBe(0)
  expect(desiredRows.valueReads).toBe(publishedRows.size)
  expect(rowWork).toEqual({
    published: {
      valueReads: 5,
      keyReads: 2,
      membershipReads: 0,
      descriptorReads: 6,
    },
    desired: {
      valueReads: 5,
      keyReads: 2,
      membershipReads: 5,
      descriptorReads: 6,
    },
  })
})

it(`does one source-order comparison per row needed to close the boundary tie`, () => {
  const reads = { rank: 0 }
  const row = (id: string, rank: number): RankedRow => ({
    id,
    get rank() {
      reads.rank++
      return rank
    },
    included: true,
  })
  const rows = new Map<string, RankedRow>([
    [`a`, row(`a`, 1)],
    [`b`, row(`b`, 2)],
    [`c`, row(`c`, 2)],
    [`d`, row(`d`, 2)],
    [`e`, row(`e`, 3)],
  ])
  const collection = {
    _stateRevision: 0,
    currentStateAsChanges: () =>
      [...rows].map(
        ([key, value]): ChangeMessage<RankedRow, string> => ({
          type: `insert`,
          key,
          value,
        }),
      ),
    entries: () => rows.entries(),
    get: (key: string) => rows.get(key),
  } as unknown as CollectionImpl<RankedRow, string>
  const window = new WindowState(collection, orderBy(`asc`), undefined, 2, true)
  window.recordInitialCoverage(undefined, true)
  const compareRows = vi.spyOn(window.totalOrder, `compareRows`)

  try {
    reads.rank = 0
    expect(window.publicationEntries().map(([key]) => key)).toEqual([
      `a`,
      `b`,
      `c`,
      `d`,
    ])
    expect(compareRows).toHaveBeenCalledTimes(3)
    expect(reads.rank).toBe(6)
  } finally {
    compareRows.mockRestore()
  }
})

it(`expands a source boundary through a comparator-equivalent string tie`, () => {
  type CollatedRow = { id: string; value: string }
  const reads = { value: 0 }
  const row = (id: string, value: string): CollatedRow => ({
    id,
    get value() {
      reads.value++
      return value
    },
  })
  const rows = new Map<string, CollatedRow>([
    [`plain`, row(`plain`, `e`)],
    [`accent`, row(`accent`, `é`)],
    [`later`, row(`later`, `z`)],
  ])
  const collection = {
    _stateRevision: 0,
    currentStateAsChanges: () =>
      [...rows].map(
        ([key, value]): ChangeMessage<CollatedRow, string> => ({
          type: `insert`,
          key,
          value,
        }),
      ),
    entries: () => rows.entries(),
    get: (key: string) => rows.get(key),
  } as unknown as CollectionImpl<CollatedRow, string>
  const order: OrderBy = [
    {
      expression: new PropRef([`value`]),
      compareOptions: {
        direction: `asc`,
        nulls: `last`,
        stringSort: `locale`,
        locale: `en`,
        localeOptions: { sensitivity: `base` },
      },
    },
  ]
  const window = new WindowState(collection, order, undefined, 1, true)
  window.recordInitialCoverage(undefined, true)
  expect(
    window.totalOrder.compareRows(rows.get(`plain`)!, rows.get(`accent`)!),
  ).toBe(0)
  const compareRows = vi.spyOn(window.totalOrder, `compareRows`)

  try {
    reads.value = 0
    expect(window.publicationEntries().map(([key]) => key)).toEqual([
      `plain`,
      `accent`,
    ])
    expect(compareRows).toHaveBeenCalledTimes(2)
    expect(reads.value).toBe(4)
  } finally {
    compareRows.mockRestore()
  }
})

it.each([
  {
    name: `one ascending term`,
    direction: `asc` as const,
    orderArity: 1 as const,
    limit: 1,
    sourceRows: [
      { id: `tie-a`, primary: `e`, secondary: 0 },
      { id: `tie-b`, primary: `é`, secondary: 0 },
      { id: `later`, primary: `z`, secondary: 0 },
    ],
    expectedKeys: [`tie-a`, `tie-b`],
  },
  {
    name: `one descending term`,
    direction: `desc` as const,
    orderArity: 1 as const,
    limit: 2,
    sourceRows: [
      { id: `prefix`, primary: `z`, secondary: 0 },
      { id: `tie-a`, primary: `e`, secondary: 0 },
      { id: `tie-b`, primary: `é`, secondary: 0 },
      { id: `later`, primary: `a`, secondary: 0 },
    ],
    expectedKeys: [`prefix`, `tie-a`, `tie-b`],
  },
  {
    name: `one ascending numeric term`,
    direction: `asc` as const,
    orderArity: 1 as const,
    limit: 1,
    sourceRows: [
      { id: `tie-a`, primary: 1, secondary: 0 },
      { id: `tie-b`, primary: 1, secondary: 0 },
      { id: `later`, primary: 2, secondary: 0 },
    ],
    expectedKeys: [`tie-a`, `tie-b`],
  },
  {
    name: `one descending numeric term`,
    direction: `desc` as const,
    orderArity: 1 as const,
    limit: 2,
    sourceRows: [
      { id: `prefix`, primary: 3, secondary: 0 },
      { id: `tie-a`, primary: 1, secondary: 0 },
      { id: `tie-b`, primary: 1, secondary: 0 },
      { id: `later`, primary: 0, secondary: 0 },
    ],
    expectedKeys: [`prefix`, `tie-a`, `tie-b`],
  },
  {
    name: `two ascending terms`,
    direction: `asc` as const,
    orderArity: 2 as const,
    limit: 2,
    sourceRows: [
      { id: `prefix`, primary: `a`, secondary: 0 },
      { id: `tie-a`, primary: `b`, secondary: `e` },
      { id: `tie-b`, primary: `b`, secondary: `é` },
      { id: `later`, primary: `c`, secondary: 0 },
    ],
    expectedKeys: [`prefix`, `tie-a`, `tie-b`],
  },
  {
    name: `two descending terms`,
    direction: `desc` as const,
    orderArity: 2 as const,
    limit: 2,
    sourceRows: [
      { id: `prefix`, primary: `c`, secondary: 0 },
      { id: `tie-a`, primary: `b`, secondary: `e` },
      { id: `tie-b`, primary: `b`, secondary: `é` },
      { id: `later`, primary: `a`, secondary: 0 },
    ],
    expectedKeys: [`prefix`, `tie-a`, `tie-b`],
  },
])(
  `expands source ties for $name`,
  ({ direction, orderArity, limit, sourceRows, expectedKeys }) => {
    type SourceTieRow = {
      id: string
      primary: string | number
      secondary: string | number
    }
    const termReads: [number, number] = [0, 0]
    const termComparisons: [number, number] = [0, 0]
    const rows = new Map<string, SourceTieRow>(
      sourceRows.map((spec) => [
        spec.id,
        {
          id: spec.id,
          get primary() {
            termReads[0]++
            return spec.primary
          },
          get secondary() {
            termReads[1]++
            return spec.secondary
          },
        },
      ]),
    )
    const trackedCompareOptions = (term: 0 | 1): CompareOptions =>
      new Proxy(
        {
          direction,
          nulls: direction === `asc` ? (`last` as const) : (`first` as const),
          stringSort: `locale`,
          locale: `en`,
          localeOptions: { sensitivity: `base` as const },
        } satisfies CompareOptions,
        {
          get(target, property, receiver) {
            if (property === `direction`) termComparisons[term]++
            return Reflect.get(target, property, receiver) as unknown
          },
        },
      )
    const order: OrderBy = [
      {
        expression: new PropRef([`primary`]),
        compareOptions: trackedCompareOptions(0),
      },
      ...(orderArity === 2
        ? [
            {
              expression: new PropRef([`secondary`]),
              compareOptions: trackedCompareOptions(1),
            },
          ]
        : []),
    ]
    const collection = {
      _stateRevision: 0,
      currentStateAsChanges: () =>
        [...rows].map(
          ([key, value]): ChangeMessage<SourceTieRow, string> => ({
            type: `insert`,
            key,
            value,
          }),
        ),
      entries: () => rows.entries(),
      get: (key: string) => rows.get(key),
    } as unknown as CollectionImpl<SourceTieRow, string>
    const window = new WindowState(collection, order, undefined, limit, true)
    window.recordInitialCoverage(undefined, true)
    const compareRows = vi.spyOn(window.totalOrder, `compareRows`)

    try {
      termReads[0] = 0
      termReads[1] = 0
      termComparisons[0] = 0
      termComparisons[1] = 0
      expect(window.publicationEntries().map(([key]) => key)).toEqual(
        expectedKeys,
      )
      expect(compareRows).toHaveBeenCalledTimes(2)
      expect(termReads).toEqual([4, orderArity === 2 ? 2 : 0])
      const optionReadsPerComparison = direction === `asc` ? 1 : 2
      expect(termComparisons).toEqual([
        2 * optionReadsPerComparison,
        orderArity === 2 ? optionReadsPerComparison : 0,
      ])
    } finally {
      compareRows.mockRestore()
    }
  },
)

it(`compiles the ordered predicate once for the lifetime of a window`, () => {
  const fixture = createSnapshotFixture([
    { id: `a`, rank: 1, included: true },
    { id: `hidden`, rank: 0, included: false },
  ])
  let referenceCompilationReads = 0
  const referenceWhere = new Proxy(eq(new PropRef([`included`]), true), {
    get(target, property, receiver) {
      if (property === `type`) referenceCompilationReads++
      return Reflect.get(target, property, receiver)
    },
  })
  compileSingleRowExpression(referenceWhere)
  expect(referenceCompilationReads).toBeGreaterThan(0)

  let compilationReads = 0
  const where = new Proxy(eq(new PropRef([`included`]), true), {
    get(target, property, receiver) {
      if (property === `type`) compilationReads++
      return Reflect.get(target, property, receiver)
    },
  })
  const window = new WindowState(fixture.collection, orderBy(`asc`), where, 1)
  const readsAfterConstruction = compilationReads
  expect(readsAfterConstruction).toBe(referenceCompilationReads)
  window.recordInitialCoverage(undefined, true)

  observeWindow(window)
  observeWindow(window)
  fixture.replace({ id: `a`, rank: 2, included: true })
  observeWindow(window)

  expect(compilationReads).toBe(readsAfterConstruction)
})

it(`invalidates the ordered snapshot after a committed collection write`, async () => {
  const collection = createCollection(
    localOnlyCollectionOptions<RankedRow>({
      id: `ordered-work-revision-write`,
      getKey: (row) => row.id,
      initialData: [
        { id: `a`, rank: 1, included: true },
        { id: `b`, rank: 2, included: true },
      ],
    }),
  )

  try {
    await collection.preload()
    collection.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const snapshotRevisions: Array<number> = []
    const originalSnapshot = collection.currentStateAsChanges.bind(collection)
    collection.currentStateAsChanges = (options) => {
      snapshotRevisions.push(collection._stateRevision)
      return originalSnapshot(options)
    }
    const window = new WindowState(
      collection,
      orderBy(`asc`),
      eq(new PropRef([`included`]), true),
      2,
    )
    window.recordInitialCoverage(undefined, true)

    expect(observeWindow(window).publication).toEqual([`a`, `b`])
    expect(observeWindow(window).publication).toEqual([`a`, `b`])
    const initialRevision = collection._stateRevision
    expect(snapshotRevisions).toEqual([initialRevision])

    collection.update(`b`, (draft) => {
      draft.rank = -1
    })

    expect(observeWindow(window).publication).toEqual([`b`, `a`])
    expect(observeWindow(window).publication).toEqual([`b`, `a`])
    expect(collection._stateRevision).toBeGreaterThan(initialRevision)
    expect(snapshotRevisions).toEqual([
      initialRevision,
      collection._stateRevision,
    ])
  } finally {
    await collection.cleanup()
  }
})

for (const campaign of orderedWorkCampaigns(
  `ordered-work.snapshot-reuse`,
  1_780_102,
)) {
  fcTest.prop(
    [
      fc.array(fc.integer({ min: -20, max: 20 }), {
        minLength: 1,
        maxLength: 12,
      }),
      fc.integer({ min: 1, max: 8 }),
      fc.array(fc.integer({ min: -20, max: 20 }), {
        minLength: 0,
        maxLength: 8,
      }),
    ],
    campaign.options,
  )(
    `takes at most one ordered snapshot per source revision (${campaign.label})`,
    (initialRanks, observationCount, replacementRanks) => {
      const fixture = createSnapshotFixture(
        initialRanks.map((rank, index) => ({
          id: `row-${index}`,
          rank,
          included: index % 3 !== 0,
        })),
      )
      const window = createCoveredWindow(
        fixture,
        Math.min(3, initialRanks.length),
      )

      for (let index = 0; index < observationCount; index++) {
        observeWindow(window)
      }
      for (let index = 0; index < replacementRanks.length; index++) {
        fixture.replace({
          id: `row-${index % initialRanks.length}`,
          rank: replacementRanks[index]!,
          included: index % 2 === 0,
        })
        for (let repeat = 0; repeat < observationCount; repeat++) {
          observeWindow(window)
        }
      }

      expect(fixture.snapshotRevisions).toEqual(
        Array.from(
          { length: replacementRanks.length + 1 },
          (_, index) => index,
        ),
      )
    },
  )
}
