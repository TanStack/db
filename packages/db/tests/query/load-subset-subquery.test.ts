import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  and,
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
import { Func, PropRef, Value } from '../../src/query/ir.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  LoadSubsetOptions,
  NonSingleResult,
  UtilsRecord,
} from '../../src/types.js'

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

describe(`loadSubset with on-demand sync`, () => {
  function createChargesCollectionWithTracking(): {
    collection: ChargersCollection
    loadSubsetCalls: Array<LoadSubsetOptions>
  } {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Charge>({
      id: `charges`,
      getKey: (charge) => charge.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const charge of sampleCharges) {
            write({ type: `insert`, value: charge })
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

  it(`should call loadSubset with just FROM`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q.from({ order: ordersCollection }),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, EQ operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => eq(order.status, `queued`)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      eq(new PropRef([`status`]), new Value(`queued`)),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, GT operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q.from({ order: ordersCollection }).where(({ order }) => gt(order.id, 5)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(gt(new PropRef([`id`]), new Value(5)))
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, GTE operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => gte(order.id, 5)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(gte(new PropRef([`id`]), new Value(5)))
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, LT operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => lt(order.id, 10)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(lt(new PropRef([`id`]), new Value(10)))
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, LTE operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => lte(order.id, 10)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(lte(new PropRef([`id`]), new Value(10)))
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, IN operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => inArray(order.id, [1, 2, 3])),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      new Func(`in`, [new PropRef([`id`]), new Value([1, 2, 3])]),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, NOT operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => not(eq(order.status, `completed`))),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      not(eq(new PropRef([`status`]), new Value(`completed`))),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, IS NULL operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => isNull(order.status)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(isNull(new PropRef([`status`])))
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, AND operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => and(eq(order.status, `queued`), gt(order.id, 5))),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      and(
        eq(new PropRef([`status`]), new Value(`queued`)),
        gt(new PropRef([`id`]), new Value(5)),
      ),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with chained WHERE`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => eq(order.status, `queued`))
        .where(({ order }) => gt(order.id, 5)),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      and(
        eq(new PropRef([`status`]), new Value(`queued`)),
        gt(new PropRef([`id`]), new Value(5)),
      ),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE, OR operator`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) =>
          or(eq(order.status, `queued`), eq(order.status, `completed`)),
        ),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      or(
        eq(new PropRef([`status`]), new Value(`queued`)),
        eq(new PropRef([`status`]), new Value(`completed`)),
      ),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })
  it(`should call loadSubset with WHERE, AND and OR operators`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) =>
          and(
            gt(order.id, 1),
            or(eq(order.status, `queued`), eq(order.status, `completed`)),
          ),
        ),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      and(
        gt(new PropRef([`id`]), new Value(1)),
        or(
          eq(new PropRef([`status`]), new Value(`queued`)),
          eq(new PropRef([`status`]), new Value(`completed`)),
        ),
      ),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE for subquery`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const subquery = createLiveQueryCollection((q) => {
      const filteredOrdersQ = q
        .from({ order: ordersCollection })
        .where(({ order }) => eq(order.status, `queued`))

      return q.from({ filtered: filteredOrdersQ })
    })

    await subquery.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      eq(new PropRef([`status`]), new Value(`queued`)),
    )
    expect(singleCall!.orderBy).toBeUndefined()
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with ORDER BY 'scheduled_at' implicit ASC, implicit NULLS FIRST`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.scheduled_at),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ])
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with ORDER BY 'scheduled_at' explicit ASC, implicit NULLS FIRST`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.scheduled_at, `asc`),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ])
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with ORDER BY 'scheduled_at' explicit DESC, explicit NULLS LAST`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.scheduled_at, {
          direction: `desc`,
          nulls: `last`,
        }),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `desc`, nulls: `last` },
      },
    ])
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with ORDER BY, multiple columns`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.scheduled_at, `asc`)
        .orderBy(({ order }) => order.id, `desc`),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
      {
        expression: new PropRef([`id`]),
        compareOptions: { direction: `desc`, nulls: `first` },
      },
    ])
    expect(singleCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with ORDER BY and LIMIT`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.id, `asc`)
        .limit(10),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`id`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ])
    expect(singleCall!.limit).toBe(10)
  })

  it.todo(`should call loadSubset with WHERE and INNER JOIN`, async () => {
    const today = `2024-01-12`
    const {
      collection: ordersCollection,
      loadSubsetCalls: orderLoadSubsetCalls,
    } = createOrdersCollectionWithTracking()
    const {
      collection: chargesCollection,
      loadSubsetCalls: chargeLoadSubsetCalls,
    } = createChargesCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ prepaidOrder: ordersCollection })
        .where(({ prepaidOrder }) => gte(prepaidOrder.scheduled_at, today))
        .where(({ prepaidOrder }) => eq(prepaidOrder.status, `queued`))
        .innerJoin({ charge: chargesCollection }, ({ prepaidOrder, charge }) =>
          eq(prepaidOrder.address_id, charge.address_id),
        ),
    )

    await query.preload()

    expect(chargeLoadSubsetCalls.length).toBe(1)
    const chargeCall = chargeLoadSubsetCalls[0]
    expect(chargeCall!.where).toBeUndefined()
    expect(chargeCall!.orderBy).toBeUndefined()
    expect(chargeCall!.limit).toBeUndefined()

    expect(orderLoadSubsetCalls.length).toBe(2)
    const firstOrderCall = orderLoadSubsetCalls[0]
    expect(firstOrderCall!.where).toEqual(
      and(
        and(
          gte(new PropRef([`scheduled_at`]), new Value(today)),
          eq(new PropRef([`status`]), new Value(`queued`)),
        ),
        new Func(`in`, [new PropRef([`address_id`]), new Value([1, 2])]),
      ),
    )
    expect(firstOrderCall!.orderBy).toBeUndefined()
    expect(firstOrderCall!.limit).toBeUndefined()

    // the second call shouldn't happen. All needed data is fetched in the first call. 
    // const secondOrderCall = orderLoadSubsetCalls[1]
    // expect(secondOrderCall!.where).toEqual(
    //   and(
    //     gte(new PropRef([`scheduled_at`]), new Value(today)),
    //     eq(new PropRef([`status`]), new Value(`queued`)),
    //   ),
    // )
    // expect(secondOrderCall!.orderBy).toBeUndefined()
    // expect(secondOrderCall!.limit).toBeUndefined()
  })

  it(`should call loadSubset with WHERE + ORDER BY + LIMIT`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => eq(order.status, `queued`))
        .orderBy(({ order }) => order.scheduled_at, `asc`)
        .limit(5),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(
      eq(new PropRef([`status`]), new Value(`queued`)),
    )
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`scheduled_at`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ])
    expect(singleCall!.limit).toBe(5)
  })

  it.todo(`should call loadSubset for findOne`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .where(({ order }) => eq(order.id, 1))
        .findOne(),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toEqual(eq(new PropRef([`id`]), new Value(1)))
    expect(singleCall!.orderBy).toBeUndefined()
    // TODO: findOne doesn't push down limit: 1 yet
    expect(singleCall!.limit).toBe(1)
  })

  it.todo(`should call loadSubset with LIMIT + OFFSET`, async () => {
    const { collection: ordersCollection, loadSubsetCalls } =
      createOrdersCollectionWithTracking()

    const query = createLiveQueryCollection((q) =>
      q
        .from({ order: ordersCollection })
        .orderBy(({ order }) => order.id, `asc`)
        .offset(20)
        .limit(10),
    )

    await query.preload()

    expect(loadSubsetCalls.length).toBe(1)
    const singleCall = loadSubsetCalls[0]
    expect(singleCall!.where).toBeUndefined()
    expect(singleCall!.orderBy).toEqual([
      {
        expression: new PropRef([`id`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ])
    expect(singleCall!.offset).toBe(20)
    expect(singleCall!.limit).toBe(10)
  })
})
