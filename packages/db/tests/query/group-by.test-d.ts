import { describe, expectTypeOf, test } from "vitest"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"
import {
  and,
  avg,
  count,
  eq,
  gt,
  gte,
  lt,
  max,
  min,
  or,
  sum,
} from "../../src/query/builder/functions.js"

// Sample data types for comprehensive GROUP BY testing
type Order = {
  id: number
  customer_id: number
  amount: number
  status: string
  date: string
  product_category: string
  quantity: number
  discount: number
  sales_rep_id: number | null
}

// Sample order data
const sampleOrders: Array<Order> = [
  {
    id: 1,
    customer_id: 1,
    amount: 100,
    status: `completed`,
    date: `2023-01-01`,
    product_category: `electronics`,
    quantity: 2,
    discount: 0,
    sales_rep_id: 1,
  },
  {
    id: 2,
    customer_id: 1,
    amount: 200,
    status: `completed`,
    date: `2023-01-15`,
    product_category: `electronics`,
    quantity: 1,
    discount: 10,
    sales_rep_id: 1,
  },
]

function createOrdersCollection() {
  return createCollection(
    mockSyncCollectionOptions<Order>({
      id: `test-orders`,
      getKey: (order) => order.id,
      initialData: sampleOrders,
    })
  )
}

describe(`Query GROUP BY Types`, () => {
  const ordersCollection = createOrdersCollection()

  test(`group by customer_id with aggregates return type`, () => {
    const customerSummary = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
            avg_amount: avg(orders.amount),
            min_amount: min(orders.amount),
            max_amount: max(orders.amount),
          })),
    })

    const customer1 = customerSummary.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
          avg_amount: number
          min_amount: number
          max_amount: number
        }
      | undefined
    >()
  })

  test(`group by status return type`, () => {
    const statusSummary = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.status)
          .select(({ orders }) => ({
            status: orders.status,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
            avg_amount: avg(orders.amount),
          })),
    })

    const completed = statusSummary.get(`completed`)
    expectTypeOf(completed).toEqualTypeOf<
      | {
          status: string
          total_amount: number
          order_count: number
          avg_amount: number
        }
      | undefined
    >()
  })

  test(`group by product_category return type`, () => {
    const categorySummary = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.product_category)
          .select(({ orders }) => ({
            product_category: orders.product_category,
            total_quantity: sum(orders.quantity),
            order_count: count(orders.id),
            total_amount: sum(orders.amount),
          })),
    })

    const electronics = categorySummary.get(`electronics`)
    expectTypeOf(electronics).toEqualTypeOf<
      | {
          product_category: string
          total_quantity: number
          order_count: number
          total_amount: number
        }
      | undefined
    >()
  })

  test(`multiple column grouping return type`, () => {
    const customerStatusSummary = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => [orders.customer_id, orders.status])
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            status: orders.status,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
          })),
    })

    const customer1Completed = customerStatusSummary.get(`[1,"completed"]`)
    expectTypeOf(customer1Completed).toEqualTypeOf<
      | {
          customer_id: number
          status: string
          total_amount: number
          order_count: number
        }
      | undefined
    >()
  })

  test(`group by with WHERE return type`, () => {
    const completedOrdersSummary = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .where(({ orders }) => eq(orders.status, `completed`))
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
          })),
    })

    const customer1 = completedOrdersSummary.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
        }
      | undefined
    >()
  })

  test(`HAVING with count filter return type`, () => {
    const highVolumeCustomers = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
          }))
          .having(({ orders }) => gt(count(orders.id), 2)),
    })

    const customer1 = highVolumeCustomers.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
        }
      | undefined
    >()
  })

  test(`HAVING with sum filter return type`, () => {
    const highValueCustomers = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
            avg_amount: avg(orders.amount),
          }))
          .having(({ orders }) => gte(sum(orders.amount), 450)),
    })

    const customer1 = highValueCustomers.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
          avg_amount: number
        }
      | undefined
    >()
  })

  test(`HAVING with avg filter return type`, () => {
    const consistentCustomers = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
            avg_amount: avg(orders.amount),
          }))
          .having(({ orders }) => gte(avg(orders.amount), 200)),
    })

    const customer1 = consistentCustomers.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
          avg_amount: number
        }
      | undefined
    >()
  })

  test(`HAVING with multiple AND conditions return type`, () => {
    const premiumCustomers = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
            avg_amount: avg(orders.amount),
          }))
          .having(({ orders }) =>
            and(gt(count(orders.id), 1), gte(sum(orders.amount), 450))
          ),
    })

    const customer1 = premiumCustomers.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
          avg_amount: number
        }
      | undefined
    >()
  })

  test(`HAVING with multiple OR conditions return type`, () => {
    const interestingCustomers = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
            min_amount: min(orders.amount),
          }))
          .having(({ orders }) =>
            or(gt(count(orders.id), 2), lt(min(orders.amount), 100))
          ),
    })

    const customer1 = interestingCustomers.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          total_amount: number
          order_count: number
          min_amount: number
        }
      | undefined
    >()
  })

  test(`GROUP BY with null values return type`, () => {
    const salesRepSummary = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.sales_rep_id)
          .select(({ orders }) => ({
            sales_rep_id: orders.sales_rep_id,
            total_amount: sum(orders.amount),
            order_count: count(orders.id),
          })),
    })

    const salesRep1 = salesRepSummary.get(1)
    expectTypeOf(salesRep1).toEqualTypeOf<
      | {
          sales_rep_id: number | null
          total_amount: number
          order_count: number
        }
      | undefined
    >()
  })

  test(`comprehensive stats with all aggregate functions return type`, () => {
    const comprehensiveStats = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ orders: ordersCollection })
          .groupBy(({ orders }) => orders.customer_id)
          .select(({ orders }) => ({
            customer_id: orders.customer_id,
            order_count: count(orders.id),
            total_amount: sum(orders.amount),
            avg_amount: avg(orders.amount),
            min_amount: min(orders.amount),
            max_amount: max(orders.amount),
            total_quantity: sum(orders.quantity),
            avg_quantity: avg(orders.quantity),
            min_quantity: min(orders.quantity),
            max_quantity: max(orders.quantity),
          })),
    })

    const customer1 = comprehensiveStats.get(1)
    expectTypeOf(customer1).toEqualTypeOf<
      | {
          customer_id: number
          order_count: number
          total_amount: number
          avg_amount: number
          min_amount: number
          max_amount: number
          total_quantity: number
          avg_quantity: number
          min_quantity: number
          max_quantity: number
        }
      | undefined
    >()
  })
})
