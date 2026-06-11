import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  and,
  createLiveQueryCollection,
  eq,
  gte,
} from '../../src/query/index.js'
import { PropRef, Value } from '../../src/query/ir.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  LoadSubsetOptions,
  NonSingleResult,
  UtilsRecord,
} from '../../src/types.js'
import type { OrderBy } from '../../src/query/ir.js'

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

describe(`loadSubset with subqueries`, () => {
  let chargesCollection: ChargersCollection

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
})
