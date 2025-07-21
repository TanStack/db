import { beforeEach, describe, expect, test } from "vitest"
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
  {
    id: 3,
    customer_id: 2,
    amount: 150,
    status: `pending`,
    date: `2023-01-20`,
    product_category: `books`,
    quantity: 3,
    discount: 5,
    sales_rep_id: 2,
  },
  {
    id: 4,
    customer_id: 2,
    amount: 300,
    status: `completed`,
    date: `2023-02-01`,
    product_category: `electronics`,
    quantity: 1,
    discount: 0,
    sales_rep_id: 2,
  },
  {
    id: 5,
    customer_id: 3,
    amount: 250,
    status: `pending`,
    date: `2023-02-10`,
    product_category: `books`,
    quantity: 5,
    discount: 15,
    sales_rep_id: null,
  },
  {
    id: 6,
    customer_id: 3,
    amount: 75,
    status: `cancelled`,
    date: `2023-02-15`,
    product_category: `electronics`,
    quantity: 1,
    discount: 0,
    sales_rep_id: 1,
  },
  {
    id: 7,
    customer_id: 1,
    amount: 400,
    status: `completed`,
    date: `2023-03-01`,
    product_category: `books`,
    quantity: 2,
    discount: 20,
    sales_rep_id: 2,
  },
]

function createOrdersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Order>({
      id: `test-orders`,
      getKey: (order) => order.id,
      initialData: sampleOrders,
      autoIndex,
    })
  )
}

function createGroupByTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    describe(`Single Column Grouping`, () => {
      let ordersCollection: ReturnType<typeof createOrdersCollection>

      beforeEach(() => {
        ordersCollection = createOrdersCollection(autoIndex)
      })

      test(`group by customer_id with aggregates`, () => {
        const customerSummary = createLiveQueryCollection({
          startSync: true,
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

        expect(customerSummary.size).toBe(3) // 3 customers

        // Customer 1: orders 1, 2, 7 (amounts: 100, 200, 400)
        const customer1 = customerSummary.get(1)
        expect(customer1).toBeDefined()
        expect(customer1?.customer_id).toBe(1)
        expect(customer1?.total_amount).toBe(700)
        expect(customer1?.order_count).toBe(3)
        expect(customer1?.avg_amount).toBe(233.33333333333334) // (100+200+400)/3
        expect(customer1?.min_amount).toBe(100)
        expect(customer1?.max_amount).toBe(400)

        // Customer 2: orders 3, 4 (amounts: 150, 300)
        const customer2 = customerSummary.get(2)
        expect(customer2).toBeDefined()
        expect(customer2?.customer_id).toBe(2)
        expect(customer2?.total_amount).toBe(450)
        expect(customer2?.order_count).toBe(2)
        expect(customer2?.avg_amount).toBe(225) // (150+300)/2
        expect(customer2?.min_amount).toBe(150)
        expect(customer2?.max_amount).toBe(300)

        // Customer 3: orders 5, 6 (amounts: 250, 75)
        const customer3 = customerSummary.get(3)
        expect(customer3).toBeDefined()
        expect(customer3?.customer_id).toBe(3)
        expect(customer3?.total_amount).toBe(325)
        expect(customer3?.order_count).toBe(2)
        expect(customer3?.avg_amount).toBe(162.5) // (250+75)/2
        expect(customer3?.min_amount).toBe(75)
        expect(customer3?.max_amount).toBe(250)
      })

      test(`group by status`, () => {
        const statusSummary = createLiveQueryCollection({
          startSync: true,
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

        expect(statusSummary.size).toBe(3) // completed, pending, cancelled

        // Completed orders: 1, 2, 4, 7 (amounts: 100, 200, 300, 400)
        const completed = statusSummary.get(`completed`)
        expect(completed?.status).toBe(`completed`)
        expect(completed?.total_amount).toBe(1000)
        expect(completed?.order_count).toBe(4)
        expect(completed?.avg_amount).toBe(250)

        // Pending orders: 3, 5 (amounts: 150, 250)
        const pending = statusSummary.get(`pending`)
        expect(pending?.status).toBe(`pending`)
        expect(pending?.total_amount).toBe(400)
        expect(pending?.order_count).toBe(2)
        expect(pending?.avg_amount).toBe(200)

        // Cancelled orders: 6 (amount: 75)
        const cancelled = statusSummary.get(`cancelled`)
        expect(cancelled?.status).toBe(`cancelled`)
        expect(cancelled?.total_amount).toBe(75)
        expect(cancelled?.order_count).toBe(1)
        expect(cancelled?.avg_amount).toBe(75)
      })

      test(`group by product_category`, () => {
        const categorySummary = createLiveQueryCollection({
          startSync: true,
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

        expect(categorySummary.size).toBe(2) // electronics, books

        // Electronics: orders 1, 2, 4, 6 (quantities: 2, 1, 1, 1)
        const electronics = categorySummary.get(`electronics`)
        expect(electronics?.product_category).toBe(`electronics`)
        expect(electronics?.total_quantity).toBe(5)
        expect(electronics?.order_count).toBe(4)
        expect(electronics?.total_amount).toBe(675) // 100+200+300+75

        // Books: orders 3, 5, 7 (quantities: 3, 5, 2)
        const books = categorySummary.get(`books`)
        expect(books?.product_category).toBe(`books`)
        expect(books?.total_quantity).toBe(10)
        expect(books?.order_count).toBe(3)
        expect(books?.total_amount).toBe(800) // 150+250+400
      })
    })

    describe(`Multiple Column Grouping`, () => {
      let ordersCollection: ReturnType<typeof createOrdersCollection>

      beforeEach(() => {
        ordersCollection = createOrdersCollection()
      })

      test(`group by customer_id and status`, () => {
        const customerStatusSummary = createLiveQueryCollection({
          startSync: true,
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

        expect(customerStatusSummary.size).toBe(5) // Different customer-status combinations

        // Customer 1, completed: orders 1, 2, 7
        const customer1Completed = customerStatusSummary.get(`[1,"completed"]`)
        expect(customer1Completed?.customer_id).toBe(1)
        expect(customer1Completed?.status).toBe(`completed`)
        expect(customer1Completed?.total_amount).toBe(700) // 100+200+400
        expect(customer1Completed?.order_count).toBe(3)

        // Customer 2, completed: order 4
        const customer2Completed = customerStatusSummary.get(`[2,"completed"]`)
        expect(customer2Completed?.customer_id).toBe(2)
        expect(customer2Completed?.status).toBe(`completed`)
        expect(customer2Completed?.total_amount).toBe(300)
        expect(customer2Completed?.order_count).toBe(1)

        // Customer 2, pending: order 3
        const customer2Pending = customerStatusSummary.get(`[2,"pending"]`)
        expect(customer2Pending?.customer_id).toBe(2)
        expect(customer2Pending?.status).toBe(`pending`)
        expect(customer2Pending?.total_amount).toBe(150)
        expect(customer2Pending?.order_count).toBe(1)

        // Customer 3, pending: order 5
        const customer3Pending = customerStatusSummary.get(`[3,"pending"]`)
        expect(customer3Pending?.customer_id).toBe(3)
        expect(customer3Pending?.status).toBe(`pending`)
        expect(customer3Pending?.total_amount).toBe(250)
        expect(customer3Pending?.order_count).toBe(1)

        // Customer 3, cancelled: order 6
        const customer3Cancelled = customerStatusSummary.get(`[3,"cancelled"]`)
        expect(customer3Cancelled?.customer_id).toBe(3)
        expect(customer3Cancelled?.status).toBe(`cancelled`)
        expect(customer3Cancelled?.total_amount).toBe(75)
        expect(customer3Cancelled?.order_count).toBe(1)
      })

      test(`group by status and product_category`, () => {
        const statusCategorySummary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => [orders.status, orders.product_category])
              .select(({ orders }) => ({
                status: orders.status,
                product_category: orders.product_category,
                total_amount: sum(orders.amount),
                avg_quantity: avg(orders.quantity),
                order_count: count(orders.id),
              })),
        })

        expect(statusCategorySummary.size).toBe(4) // Different status-category combinations

        // Completed electronics: orders 1, 2, 4
        const completedElectronics = statusCategorySummary.get(
          `["completed","electronics"]`
        )
        expect(completedElectronics?.status).toBe(`completed`)
        expect(completedElectronics?.product_category).toBe(`electronics`)
        expect(completedElectronics?.total_amount).toBe(600) // 100+200+300
        expect(completedElectronics?.avg_quantity).toBe(1.3333333333333333) // (2+1+1)/3
        expect(completedElectronics?.order_count).toBe(3)
      })
    })

    describe(`GROUP BY with WHERE Clauses`, () => {
      let ordersCollection: ReturnType<typeof createOrdersCollection>

      beforeEach(() => {
        ordersCollection = createOrdersCollection()
      })

      test(`group by after filtering with WHERE`, () => {
        const completedOrdersSummary = createLiveQueryCollection({
          startSync: true,
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

        expect(completedOrdersSummary.size).toBe(2) // Only customers 1 and 2 have completed orders

        // Customer 1: completed orders 1, 2, 7
        const customer1 = completedOrdersSummary.get(1)
        expect(customer1?.customer_id).toBe(1)
        expect(customer1?.total_amount).toBe(700) // 100+200+400
        expect(customer1?.order_count).toBe(3)

        // Customer 2: completed order 4
        const customer2 = completedOrdersSummary.get(2)
        expect(customer2?.customer_id).toBe(2)
        expect(customer2?.total_amount).toBe(300)
        expect(customer2?.order_count).toBe(1)
      })

      test(`group by with complex WHERE conditions`, () => {
        const highValueOrdersSummary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .where(({ orders }) =>
                and(
                  gt(orders.amount, 150),
                  or(
                    eq(orders.status, `completed`),
                    eq(orders.status, `pending`)
                  )
                )
              )
              .groupBy(({ orders }) => orders.product_category)
              .select(({ orders }) => ({
                product_category: orders.product_category,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
                avg_amount: avg(orders.amount),
              })),
        })

        // Orders matching criteria: 2 (200), 4 (300), 5 (250), 7 (400)
        expect(highValueOrdersSummary.size).toBe(2) // electronics and books

        const electronics = highValueOrdersSummary.get(`electronics`)
        expect(electronics?.total_amount).toBe(500) // 200+300
        expect(electronics?.order_count).toBe(2)

        const books = highValueOrdersSummary.get(`books`)
        expect(books?.total_amount).toBe(650) // 250+400
        expect(books?.order_count).toBe(2)
      })
    })

    describe(`HAVING Clause with GROUP BY`, () => {
      let ordersCollection: ReturnType<typeof createOrdersCollection>

      beforeEach(() => {
        ordersCollection = createOrdersCollection()
      })

      test(`having with count filter`, () => {
        const highVolumeCustomers = createLiveQueryCollection({
          startSync: true,
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

        // Only customer 1 has more than 2 orders (3 orders)
        expect(highVolumeCustomers.size).toBe(1)

        const customer1 = highVolumeCustomers.get(1)
        expect(customer1?.customer_id).toBe(1)
        expect(customer1?.order_count).toBe(3)
        expect(customer1?.total_amount).toBe(700)
      })

      test(`having with sum filter`, () => {
        const highValueCustomers = createLiveQueryCollection({
          startSync: true,
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

        // Customer 1: 700, Customer 2: 450, Customer 3: 325
        // So customers 1 and 2 should be included
        expect(highValueCustomers.size).toBe(2)

        const customer1 = highValueCustomers.get(1)
        expect(customer1?.customer_id).toBe(1)
        expect(customer1?.total_amount).toBe(700)

        const customer2 = highValueCustomers.get(2)
        expect(customer2?.customer_id).toBe(2)
        expect(customer2?.total_amount).toBe(450)
      })

      test(`having with avg filter`, () => {
        const consistentCustomers = createLiveQueryCollection({
          startSync: true,
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

        // Customer 1: avg 233.33, Customer 2: avg 225, Customer 3: avg 162.5
        // So customers 1 and 2 should be included
        expect(consistentCustomers.size).toBe(2)

        const customer1 = consistentCustomers.get(1)
        expect(customer1?.avg_amount).toBeCloseTo(233.33, 2)

        const customer2 = consistentCustomers.get(2)
        expect(customer2?.avg_amount).toBe(225)
      })

      test(`having with multiple conditions using AND`, () => {
        const premiumCustomers = createLiveQueryCollection({
          startSync: true,
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

        // Must have > 1 order AND >= 450 total
        // Customer 1: 3 orders, 700 total ✓
        // Customer 2: 2 orders, 450 total ✓
        // Customer 3: 2 orders, 325 total ✗
        expect(premiumCustomers.size).toBe(2)

        const customer1 = premiumCustomers.get(1)

        expect(customer1).toBeDefined()
        expect(premiumCustomers.get(2)).toBeDefined()
      })

      test(`having with multiple conditions using OR`, () => {
        const interestingCustomers = createLiveQueryCollection({
          startSync: true,
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

        // Must have > 2 orders OR min order < 100
        // Customer 1: 3 orders ✓ (also min 100, but first condition matches)
        // Customer 2: 2 orders, min 150 ✗
        // Customer 3: 2 orders, min 75 ✓
        expect(interestingCustomers.size).toBe(2)

        const customer1 = interestingCustomers.get(1)

        expect(customer1).toBeDefined()
        expect(interestingCustomers.get(3)).toBeDefined()
      })

      test(`having combined with WHERE clause`, () => {
        const filteredHighValueCustomers = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .where(({ orders }) => eq(orders.status, `completed`))
              .groupBy(({ orders }) => orders.customer_id)
              .select(({ orders }) => ({
                customer_id: orders.customer_id,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
              }))
              .having(({ orders }) => gt(sum(orders.amount), 300)),
        })

        // First filter by completed orders, then group, then filter by sum > 300
        // Customer 1: completed orders 1,2,7 = 700 total ✓
        // Customer 2: completed order 4 = 300 total ✗
        expect(filteredHighValueCustomers.size).toBe(1)

        const customer1 = filteredHighValueCustomers.get(1)
        expect(customer1?.customer_id).toBe(1)
        expect(customer1?.total_amount).toBe(700)
        expect(customer1?.order_count).toBe(3)
      })

      test(`having with min and max filters`, () => {
        const diverseSpendingCustomers = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => orders.customer_id)
              .select(({ orders }) => ({
                customer_id: orders.customer_id,
                total_amount: sum(orders.amount),
                min_amount: min(orders.amount),
                max_amount: max(orders.amount),
                spending_range: max(orders.amount), // We'll calculate range in the filter
              }))
              .having(({ orders }) =>
                and(gte(min(orders.amount), 75), gte(max(orders.amount), 300))
              ),
        })

        // Must have min >= 75 AND max >= 300
        // Customer 1: min 100, max 400 ✓
        // Customer 2: min 150, max 300 ✓
        // Customer 3: min 75, max 250 ✗ (max not >= 300)
        expect(diverseSpendingCustomers.size).toBe(2)

        expect(diverseSpendingCustomers.get(1)).toBeDefined()
        expect(diverseSpendingCustomers.get(2)).toBeDefined()
      })

      test(`having with product category grouping`, () => {
        const popularCategories = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => orders.product_category)
              .select(({ orders }) => ({
                product_category: orders.product_category,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
                avg_quantity: avg(orders.quantity),
              }))
              .having(({ orders }) => gt(count(orders.id), 3)),
        })

        // Electronics: 4 orders ✓
        // Books: 3 orders ✗
        expect(popularCategories.size).toBe(1)

        const electronics = popularCategories.get(`electronics`)
        expect(electronics?.product_category).toBe(`electronics`)
        expect(electronics?.order_count).toBe(4)
      })

      test(`having with no results`, () => {
        const impossibleFilter = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => orders.customer_id)
              .select(({ orders }) => ({
                customer_id: orders.customer_id,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
              }))
              .having(({ orders }) => gt(sum(orders.amount), 1000)),
        })

        // No customer has total > 1000 (max is 700)
        expect(impossibleFilter.size).toBe(0)
      })
    })

    describe(`Live Updates with GROUP BY`, () => {
      let ordersCollection: ReturnType<typeof createOrdersCollection>

      beforeEach(() => {
        ordersCollection = createOrdersCollection()
      })

      test(`live updates when inserting new orders`, () => {
        const customerSummary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => orders.customer_id)
              .select(({ orders }) => ({
                customer_id: orders.customer_id,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
              })),
        })

        expect(customerSummary.size).toBe(3)

        const initialCustomer1 = customerSummary.get(1)
        expect(initialCustomer1?.total_amount).toBe(700)
        expect(initialCustomer1?.order_count).toBe(3)

        // Insert new order for customer 1
        const newOrder: Order = {
          id: 8,
          customer_id: 1,
          amount: 500,
          status: `completed`,
          date: `2023-03-15`,
          product_category: `electronics`,
          quantity: 2,
          discount: 0,
          sales_rep_id: 1,
        }

        ordersCollection.utils.begin()
        ordersCollection.utils.write({ type: `insert`, value: newOrder })
        ordersCollection.utils.commit()

        const updatedCustomer1 = customerSummary.get(1)
        expect(updatedCustomer1?.total_amount).toBe(1200) // 700 + 500
        expect(updatedCustomer1?.order_count).toBe(4) // 3 + 1

        // Insert order for new customer
        const newCustomerOrder: Order = {
          id: 9,
          customer_id: 4,
          amount: 350,
          status: `pending`,
          date: `2023-03-20`,
          product_category: `books`,
          quantity: 1,
          discount: 5,
          sales_rep_id: 2,
        }

        ordersCollection.utils.begin()
        ordersCollection.utils.write({
          type: `insert`,
          value: newCustomerOrder,
        })
        ordersCollection.utils.commit()

        expect(customerSummary.size).toBe(4) // Now 4 customers

        const newCustomer4 = customerSummary.get(4)
        expect(newCustomer4?.customer_id).toBe(4)
        expect(newCustomer4?.total_amount).toBe(350)
        expect(newCustomer4?.order_count).toBe(1)
      })

      test(`live updates when updating existing orders`, () => {
        const statusSummary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => orders.status)
              .select(({ orders }) => ({
                status: orders.status,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
              })),
        })

        const initialPending = statusSummary.get(`pending`)
        const initialCompleted = statusSummary.get(`completed`)

        expect(initialPending?.order_count).toBe(2)
        expect(initialPending?.total_amount).toBe(400) // orders 3, 5
        expect(initialCompleted?.order_count).toBe(4)
        expect(initialCompleted?.total_amount).toBe(1000) // orders 1, 2, 4, 7

        // Update order 3 from pending to completed
        const updatedOrder = {
          ...sampleOrders.find((o) => o.id === 3)!,
          status: `completed`,
        }

        ordersCollection.utils.begin()
        ordersCollection.utils.write({ type: `update`, value: updatedOrder })
        ordersCollection.utils.commit()

        const updatedPending = statusSummary.get(`pending`)
        const updatedCompleted = statusSummary.get(`completed`)

        expect(updatedPending?.order_count).toBe(1) // Only order 5
        expect(updatedPending?.total_amount).toBe(250)
        expect(updatedCompleted?.order_count).toBe(5) // orders 1, 2, 3, 4, 7
        expect(updatedCompleted?.total_amount).toBe(1150) // 1000 + 150
      })

      test(`live updates when deleting orders`, () => {
        const customerSummary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: ordersCollection })
              .groupBy(({ orders }) => orders.customer_id)
              .select(({ orders }) => ({
                customer_id: orders.customer_id,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
              })),
        })

        expect(customerSummary.size).toBe(3)

        const initialCustomer3 = customerSummary.get(3)
        expect(initialCustomer3?.order_count).toBe(2) // orders 5, 6
        expect(initialCustomer3?.total_amount).toBe(325) // 250 + 75

        // Delete order 6 (customer 3)
        const orderToDelete = sampleOrders.find((o) => o.id === 6)!

        ordersCollection.utils.begin()
        ordersCollection.utils.write({ type: `delete`, value: orderToDelete })
        ordersCollection.utils.commit()

        const updatedCustomer3 = customerSummary.get(3)
        expect(updatedCustomer3?.order_count).toBe(1) // Only order 5
        expect(updatedCustomer3?.total_amount).toBe(250)

        // Delete order 5 (customer 3's last order)
        const lastOrderToDelete = sampleOrders.find((o) => o.id === 5)!

        ordersCollection.utils.begin()
        ordersCollection.utils.write({
          type: `delete`,
          value: lastOrderToDelete,
        })
        ordersCollection.utils.commit()

        expect(customerSummary.size).toBe(2) // Customer 3 should be removed
        expect(customerSummary.get(3)).toBeUndefined()
      })
    })

    describe(`Edge Cases and Complex Scenarios`, () => {
      let ordersCollection: ReturnType<typeof createOrdersCollection>

      beforeEach(() => {
        ordersCollection = createOrdersCollection(autoIndex)
      })

      test(`group by with null values`, () => {
        const salesRepSummary = createLiveQueryCollection({
          startSync: true,
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

        expect(salesRepSummary.size).toBe(3) // sales_rep_id: null, 1, 2

        // Sales rep 1: orders 1, 2, 6
        const salesRep1 = salesRepSummary.get(1)
        expect(salesRep1?.sales_rep_id).toBe(1)
        expect(salesRep1?.total_amount).toBe(375) // 100+200+75
        expect(salesRep1?.order_count).toBe(3)

        // Sales rep 2: orders 3, 4, 7
        const salesRep2 = salesRepSummary.get(2)
        expect(salesRep2?.sales_rep_id).toBe(2)
        expect(salesRep2?.total_amount).toBe(850) // 150+300+400
        expect(salesRep2?.order_count).toBe(3)

        // No sales rep (null): order 5 - null becomes the direct value as key
        const noSalesRep = salesRepSummary.get(null as any)
        expect(noSalesRep?.sales_rep_id).toBeNull()
        expect(noSalesRep?.total_amount).toBe(250)
        expect(noSalesRep?.order_count).toBe(1)
      })

      test(`empty collection handling`, () => {
        const emptyCollection = createCollection(
          mockSyncCollectionOptions<Order>({
            id: `empty-orders`,
            getKey: (order) => order.id,
            initialData: [],
          })
        )

        const emptyGroupBy = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ orders: emptyCollection })
              .groupBy(({ orders }) => orders.customer_id)
              .select(({ orders }) => ({
                customer_id: orders.customer_id,
                total_amount: sum(orders.amount),
                order_count: count(orders.id),
              })),
        })

        expect(emptyGroupBy.size).toBe(0)

        // Add data to empty collection
        const newOrder: Order = {
          id: 1,
          customer_id: 1,
          amount: 100,
          status: `completed`,
          date: `2023-01-01`,
          product_category: `electronics`,
          quantity: 1,
          discount: 0,
          sales_rep_id: 1,
        }

        emptyCollection.utils.begin()
        emptyCollection.utils.write({ type: `insert`, value: newOrder })
        emptyCollection.utils.commit()

        expect(emptyGroupBy.size).toBe(1)
        const customer1 = emptyGroupBy.get(1)
        expect(customer1?.total_amount).toBe(100)
        expect(customer1?.order_count).toBe(1)
      })

      test(`group by with all aggregate functions`, () => {
        const comprehensiveStats = createLiveQueryCollection({
          startSync: true,
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

        expect(comprehensiveStats.size).toBe(3)

        const customer1 = comprehensiveStats.get(1)
        expect(customer1?.customer_id).toBe(1)
        expect(customer1?.order_count).toBe(3)
        expect(customer1?.total_amount).toBe(700)
        expect(customer1?.avg_amount).toBeCloseTo(233.33, 2)
        expect(customer1?.min_amount).toBe(100)
        expect(customer1?.max_amount).toBe(400)
        expect(customer1?.total_quantity).toBe(5) // 2+1+2
        expect(customer1?.avg_quantity).toBeCloseTo(1.67, 2)
        expect(customer1?.min_quantity).toBe(1)
        expect(customer1?.max_quantity).toBe(2)
      })
    })
  })
}

describe(`Query GROUP BY Execution`, () => {
  createGroupByTests(`off`)
  createGroupByTests(`eager`)
})
