import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQuery } from "../../../src/query2/compiler/index.js"
import { Agg, CollectionRef, Func, Ref, Value } from "../../../src/query2/ir.js"
import type { Query } from "../../../src/query2/ir.js"
import type { CollectionImpl } from "../../../src/collection.js"

// Sample user type for tests
type Sale = {
  id: number
  productId: number
  userId: number
  amount: number
  quantity: number
  region: string
}

// Sample sales data
const sampleSales: Array<Sale> = [
  {
    id: 1,
    productId: 101,
    userId: 1,
    amount: 100,
    quantity: 2,
    region: `North`,
  },
  {
    id: 2,
    productId: 101,
    userId: 2,
    amount: 150,
    quantity: 3,
    region: `North`,
  },
  {
    id: 3,
    productId: 102,
    userId: 1,
    amount: 200,
    quantity: 1,
    region: `South`,
  },
  {
    id: 4,
    productId: 101,
    userId: 3,
    amount: 75,
    quantity: 1,
    region: `South`,
  },
  {
    id: 5,
    productId: 102,
    userId: 2,
    amount: 300,
    quantity: 2,
    region: `North`,
  },
  { id: 6, productId: 103, userId: 1, amount: 50, quantity: 1, region: `East` },
]

describe(`Query2 GROUP BY Pipeline`, () => {
  describe(`Aggregation Functions`, () => {
    test(`groups by single column with aggregates`, () => {
      const salesCollection = { id: `sales` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(salesCollection, `sales`),
        groupBy: [new Ref([`sales`, `productId`])],
        select: {
          productId: new Ref([`sales`, `productId`]),
          totalAmount: new Agg(`sum`, [new Ref([`sales`, `amount`])]),
          totalQuantity: new Agg(`sum`, [new Ref([`sales`, `quantity`])]),
          avgAmount: new Agg(`avg`, [new Ref([`sales`, `amount`])]),
          saleCount: new Agg(`count`, [new Ref([`sales`, `id`])]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, Sale]>()
      const pipeline = compileQuery(query, { sales: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleSales.map((sale) => [[sale.id, sale], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)
      console.log(`NEW DEBUG results:`, JSON.stringify(results, null, 2))

      // Should have 3 groups (productId: 101, 102, 103)
      expect(results).toHaveLength(3)

      // Check Product 101 aggregates (3 sales: 100+150+75=325, 2+3+1=6)
      const product101 = results.find(
        ([_key, result]) => result.productId === 101
      )?.[1]
      expect(product101).toMatchObject({
        productId: 101,
        totalAmount: 325, // 100 + 150 + 75
        totalQuantity: 6, // 2 + 3 + 1
        avgAmount: 325 / 3, // 108.33...
        saleCount: 3,
      })

      // Check Product 102 aggregates (2 sales: 200+300=500, 1+2=3)
      const product102 = results.find(
        ([_key, result]) => result.productId === 102
      )?.[1]
      expect(product102).toMatchObject({
        productId: 102,
        totalAmount: 500, // 200 + 300
        totalQuantity: 3, // 1 + 2
        avgAmount: 250, // 500/2
        saleCount: 2,
      })

      // Check Product 103 aggregates (1 sale: 50, 1)
      const product103 = results.find(
        ([_key, result]) => result.productId === 103
      )?.[1]
      expect(product103).toMatchObject({
        productId: 103,
        totalAmount: 50,
        totalQuantity: 1,
        avgAmount: 50,
        saleCount: 1,
      })
    })

    test(`groups by multiple columns with aggregates`, () => {
      const salesCollection = { id: `sales` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(salesCollection, `sales`),
        groupBy: [
          new Ref([`sales`, `region`]),
          new Ref([`sales`, `productId`]),
        ],
        select: {
          region: new Ref([`sales`, `region`]),
          productId: new Ref([`sales`, `productId`]),
          totalAmount: new Agg(`sum`, [new Ref([`sales`, `amount`])]),
          maxAmount: new Agg(`max`, [new Ref([`sales`, `amount`])]),
          minAmount: new Agg(`min`, [new Ref([`sales`, `amount`])]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, Sale]>()
      const pipeline = compileQuery(query, { sales: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleSales.map((sale) => [[sale.id, sale], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Should have 5 groups: (North,101), (North,102), (South,101), (South,102), (East,103)
      expect(results).toHaveLength(5)

      // Check North + Product 101 (2 sales: 100+150=250)
      const northProduct101 = results.find(
        ([_key, result]) =>
          result.region === `North` && result.productId === 101
      )?.[1]
      expect(northProduct101).toMatchObject({
        region: `North`,
        productId: 101,
        totalAmount: 250, // 100 + 150
        maxAmount: 150,
        minAmount: 100,
      })

      // Check East + Product 103 (1 sale: 50)
      const eastProduct103 = results.find(
        ([_key, result]) => result.region === `East` && result.productId === 103
      )?.[1]
      expect(eastProduct103).toMatchObject({
        region: `East`,
        productId: 103,
        totalAmount: 50,
        maxAmount: 50,
        minAmount: 50,
      })
    })

    test(`GROUP BY with HAVING clause`, () => {
      const salesCollection = { id: `sales` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(salesCollection, `sales`),
        groupBy: [new Ref([`sales`, `productId`])],
        select: {
          productId: new Ref([`sales`, `productId`]),
          totalAmount: new Agg(`sum`, [new Ref([`sales`, `amount`])]),
          saleCount: new Agg(`count`, [new Ref([`sales`, `id`])]),
        },
        having: new Func(`gt`, [new Ref([`totalAmount`]), new Value(100)]),
      }

      const graph = new D2()
      const input = graph.newInput<[number, Sale]>()
      const pipeline = compileQuery(query, { sales: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleSales.map((sale) => [[sale.id, sale], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Should only include groups where total amount > 100
      // Product 101: 325 > 100 ✓
      // Product 102: 500 > 100 ✓
      // Product 103: 50 ≤ 100 ✗
      expect(results).toHaveLength(2)

      const productIds = results.map(([_key, r]) => r.productId).sort()
      expect(productIds).toEqual([101, 102])
    })
  })
})
