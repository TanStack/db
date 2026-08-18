import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  and,
  coalesce,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  not,
  or,
} from '../../src/query/index.js'
import { PropRef, Value } from '../../src/query/ir.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  LoadSubsetOptions,
  NonSingleResult,
  UtilsRecord,
} from '../../src/types.js'
import type { BasicExpression, OrderBy } from '../../src/query/ir.js'
import type { Ref } from '../../src/query/index.js'

// Sample types for testing
type Order = {
  id: number
  scheduled_at: string
  status: string
  address_id: number
}

type Charge = {
  id: number
  address_id: number
  amount: number
}

// Sample data
const sampleOrders: Array<Order> = [
  {
    id: 1,
    scheduled_at: `2024-01-15`,
    status: `queued`,
    address_id: 1,
  },
  {
    id: 2,
    scheduled_at: `2024-01-10`,
    status: `queued`,
    address_id: 2,
  },
  {
    id: 3,
    scheduled_at: `2024-01-20`,
    status: `completed`,
    address_id: 1,
  },
]

const sampleCharges: Array<Charge> = [
  { id: 1, address_id: 1, amount: 100 },
  { id: 2, address_id: 2, amount: 200 },
]

type ChargersCollection = Collection<
  Charge,
  string | number,
  UtilsRecord,
  never,
  Charge
> &
  NonSingleResult

type OrdersCollection = Collection<
  Order,
  string | number,
  UtilsRecord,
  never,
  Order
> &
  NonSingleResult

type ForwardingCase = {
  name: string
  build: (order: Ref<Order>) => BasicExpression<boolean>
  expected: BasicExpression<boolean>
}

const forwardingCases: ReadonlyArray<ForwardingCase> = [
  {
    name: `equality`,
    build: (order) => eq(order.status, `queued`),
    expected: eq(new PropRef([`status`]), new Value(`queued`)),
  },
  {
    name: `greater than`,
    build: (order) => gt(order.id, 1),
    expected: gt(new PropRef([`id`]), new Value(1)),
  },
  {
    name: `greater than or equal`,
    build: (order) => gte(order.id, 1),
    expected: gte(new PropRef([`id`]), new Value(1)),
  },
  {
    name: `less than`,
    build: (order) => lt(order.id, 3),
    expected: lt(new PropRef([`id`]), new Value(3)),
  },
  {
    name: `less than or equal`,
    build: (order) => lte(order.id, 3),
    expected: lte(new PropRef([`id`]), new Value(3)),
  },
  {
    name: `IN`,
    build: (order) => inArray(order.id, [1, 2, 3]),
    expected: inArray(new PropRef([`id`]), [1, 2, 3]),
  },
  {
    name: `NOT`,
    build: (order) => not(eq(order.status, `completed`)),
    expected: not(eq(new PropRef([`status`]), new Value(`completed`))),
  },
  {
    name: `IS NULL`,
    build: (order) => isNull(order.status),
    expected: isNull(new PropRef([`status`])),
  },
  {
    name: `OR`,
    build: (order) =>
      or(eq(order.status, `queued`), eq(order.status, `completed`)),
    expected: or(
      eq(new PropRef([`status`]), new Value(`queued`)),
      eq(new PropRef([`status`]), new Value(`completed`)),
    ),
  },
  {
    name: `nested AND/OR`,
    build: (order) =>
      and(
        gt(order.id, 1),
        or(eq(order.status, `queued`), eq(order.status, `completed`)),
      ),
    expected: and(
      gt(new PropRef([`id`]), new Value(1)),
      or(
        eq(new PropRef([`status`]), new Value(`queued`)),
        eq(new PropRef([`status`]), new Value(`completed`)),
      ),
    ),
  },
]

describe(`loadSubset with subqueries`, () => {
  let chargesCollection: ChargersCollection
  const cleanups: Array<{ cleanup: () => void | Promise<void> }> = []

  afterEach(async () => {
    const results = await Promise.allSettled(
      cleanups
        .splice(0)
        .reverse()
        .map((value) => value.cleanup()),
    )
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === `rejected`,
    )
    if (failure) throw failure.reason
  })

  beforeEach(() => {
    // Create charges collection
    chargesCollection = createCollection<Charge>({
      id: `charges`,
      getKey: (charge) => charge.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const charge of sampleCharges) {
            write({ type: `insert`, value: charge })
          }
          commit()
          markReady()
        },
      },
    })
    cleanups.push(chargesCollection)
  })

  function createOrdersCollectionWithTracking(): {
    collection: OrdersCollection
    loadSubsetCalls: Array<LoadSubsetOptions>
  } {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Order>({
      id: `orders`,
      getKey: (order) => order.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const order of sampleOrders) {
            write({ type: `insert`, value: order })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  it.each(forwardingCases)(
    `forwards the $name predicate exactly once`,
    async ({ build, expected }) => {
      const { collection: ordersCollection, loadSubsetCalls } =
        createOrdersCollectionWithTracking()
      const query = createLiveQueryCollection((q) =>
        q.from({ order: ordersCollection }).where(({ order }) => build(order)),
      )
      cleanups.push(ordersCollection, query)

      await query.preload()
      expect(loadSubsetCalls).toHaveLength(1)
      expect(loadSubsetCalls[0]?.where).toEqual(expected)
      expect(loadSubsetCalls[0]?.orderBy).toBeUndefined()
      expect(loadSubsetCalls[0]?.limit).toBeUndefined()
    },
  )

  it(`should call loadSubset with where clause for direct query`, async () => {
    const today = `2024-01-12`
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const directQuery = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => gte(order.scheduled_at, today))
        .where(({ order }) => eq(order.status, `queued`)),
    )
    cleanups.push(ordersCollection, directQuery)

    await directQuery.preload()

    // Verify loadSubset was called
    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    // Verify the last call (or any call) has the where clause
    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]
    expect(lastCall).toBeDefined()
    expect(lastCall!.where).toBeDefined()

    const expectedWhereClause = and(
      gte(new PropRef([`scheduled_at`]), new Value(today)),
      eq(new PropRef([`status`]), new Value(`queued`)),
    )

    expect(lastCall!.where).toEqual(expectedWhereClause)
  })

  it(`should call loadSubset with where clause for subquery`, async () => {
    const today = `2024-01-12`
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const subqueryQuery = createLiveQueryCollection((q) => {
      // Build subquery with filters
      const prepaidOrderQ = q
        .from({ prepaidOrder: ordersCollection })
        .where(({ prepaidOrder }) => gte(prepaidOrder.scheduled_at, today))
        .where(({ prepaidOrder }) => eq(prepaidOrder.status, `queued`))

      // Use subquery in main query
      return q
        .from({ charge: chargesCollection })
        .fullJoin({ prepaidOrder: prepaidOrderQ }, ({ charge, prepaidOrder }) =>
          eq(charge.address_id, prepaidOrder.address_id),
        )
    })
    cleanups.push(ordersCollection, subqueryQuery)

    await subqueryQuery.preload()

    // Verify loadSubset was called for the orders collection
    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    // Verify the last call (or any call) has the where clause
    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]
    expect(lastCall).toBeDefined()
    expect(lastCall!.where).toBeDefined()

    const expectedWhereClause = and(
      gte(new PropRef([`scheduled_at`]), new Value(today)),
      eq(new PropRef([`status`]), new Value(`queued`)),
    )

    expect(lastCall!.where).toEqual(expectedWhereClause)
  })

  it(`should call loadSubset with orderBy clause for direct query`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const directQuery = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.scheduled_at, `desc`)
        .limit(2),
    )
    cleanups.push(ordersCollection, directQuery)

    await directQuery.preload()

    // Verify loadSubset was called
    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    // Verify the last call has the orderBy clause and limit
    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]
    expect(lastCall).toBeDefined()
    expect(lastCall!.orderBy).toBeDefined()
    expect(lastCall!.limit).toBe(2)

    const expectedOrderBy: OrderBy = [
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `desc`, nulls: `first` },
      },
    ]

    expect(lastCall!.orderBy).toEqual(expectedOrderBy)
  })

  it(`should call loadSubset with orderBy clause for subquery`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const subqueryQuery = createLiveQueryCollection((q) => {
      // Build subquery with orderBy and limit
      const prepaidOrderQ = q
        .from({ prepaidOrder: ordersCollection })
        .orderBy(({ prepaidOrder }) => prepaidOrder.scheduled_at, `desc`)
        .limit(2)

      // Use subquery in main query
      return q
        .from({ charge: chargesCollection })
        .fullJoin({ prepaidOrder: prepaidOrderQ }, ({ charge, prepaidOrder }) =>
          eq(charge.address_id, prepaidOrder.address_id),
        )
    })
    cleanups.push(ordersCollection, subqueryQuery)

    await subqueryQuery.preload()

    // Verify loadSubset was called for the orders collection
    expect(loadSubsetCalls.length).toBeGreaterThan(0)

    // Verify the last call has the orderBy clause and limit
    const lastCall = loadSubsetCalls[loadSubsetCalls.length - 1]
    expect(lastCall).toBeDefined()
    expect(lastCall!.orderBy).toBeDefined()
    expect(lastCall!.limit).toBe(2)

    const expectedOrderBy: OrderBy = [
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `desc`, nulls: `first` },
      },
    ]

    expect(lastCall!.orderBy).toEqual(expectedOrderBy)
  })

  it(`does not forward a computed subquery order to loadSubset`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) => {
      const orderedOrders = q
        .from({ order: ordersCollection })
        .select(({ order }) => ({
          address_id: order.address_id,
          sortKey: coalesce(order.scheduled_at, `1970-01-01`),
        }))
        .orderBy(({ $selected }) => $selected.sortKey, `desc`)
        .limit(2)

      return q
        .from({ charge: chargesCollection })
        .fullJoin({ order: orderedOrders }, ({ charge, order }) =>
          eq(charge.address_id, order.address_id),
        )
    })
    cleanups.push(ordersCollection, query)

    await query.preload()

    expect(loadSubsetCalls).not.toHaveLength(0)
    const lastCall = loadSubsetCalls.at(-1)
    expect(lastCall?.orderBy).toBeUndefined()
    expect(lastCall?.limit).toBeUndefined()
  })
})
