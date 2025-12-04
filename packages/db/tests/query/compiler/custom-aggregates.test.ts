import { describe, expect, it } from "vitest"
import { createCollection } from "../../../src/collection/index.js"
import {
  Aggregate,
  avg,
  count,
  createLiveQueryCollection,
  sum,
} from "../../../src/query/index.js"
import { toExpression } from "../../../src/query/builder/ref-proxy.js"
import { mockSyncCollectionOptions } from "../../utils.js"
import type {
  AggregateConfig,
  ValueExtractor,
} from "../../../src/query/index.js"

interface TestItem {
  id: number
  category: string
  price: number
  quantity: number
}

const sampleItems: Array<TestItem> = [
  { id: 1, category: `A`, price: 10, quantity: 2 },
  { id: 2, category: `A`, price: 20, quantity: 3 },
  { id: 3, category: `B`, price: 15, quantity: 1 },
  { id: 4, category: `B`, price: 25, quantity: 4 },
]

function createTestCollection() {
  return createCollection<TestItem>(
    mockSyncCollectionOptions({
      id: `test-custom-aggregates`,
      getKey: (item) => item.id,
      initialData: sampleItems,
    })
  )
}

// Custom aggregate configs (following the same pattern as built-in aggregates)
const productConfig: AggregateConfig = {
  factory: (valueExtractor: ValueExtractor) => ({
    preMap: valueExtractor,
    reduce: (values: Array<[number, number]>) => {
      let result = 1
      for (const [value, multiplicity] of values) {
        // For positive multiplicity, multiply the value that many times
        // For negative multiplicity, divide (inverse operation for IVM)
        if (multiplicity > 0) {
          for (let i = 0; i < multiplicity; i++) {
            result *= value
          }
        } else if (multiplicity < 0) {
          for (let i = 0; i < -multiplicity; i++) {
            result /= value
          }
        }
      }
      return result
    },
  }),
  valueTransform: `numeric`,
}

const varianceConfig: AggregateConfig = {
  factory: (valueExtractor: ValueExtractor) => ({
    preMap: (data: any) => {
      const value = valueExtractor(data)
      return { sum: value, sumSq: value * value, n: 1 }
    },
    reduce: (
      values: Array<[{ sum: number; sumSq: number; n: number }, number]>
    ) => {
      let totalSum = 0
      let totalSumSq = 0
      let totalN = 0
      for (const [{ sum: s, sumSq, n }, multiplicity] of values) {
        totalSum += s * multiplicity
        totalSumSq += sumSq * multiplicity
        totalN += n * multiplicity
      }
      return { sum: totalSum, sumSq: totalSumSq, n: totalN }
    },
    postMap: (acc: { sum: number; sumSq: number; n: number }) => {
      if (acc.n === 0) return 0
      const mean = acc.sum / acc.n
      return acc.sumSq / acc.n - mean * mean
    },
  }),
  valueTransform: `raw`, // We handle the transformation in preMap
}

// Custom aggregate builder functions (pass config as 3rd argument to Aggregate)
function product<T>(arg: T): Aggregate<number> {
  return new Aggregate(`product`, [toExpression(arg)], productConfig)
}

function variance<T>(arg: T): Aggregate<number> {
  return new Aggregate(`variance`, [toExpression(arg)], varianceConfig)
}

describe(`Custom Aggregates`, () => {
  describe(`custom aggregate builder functions`, () => {
    it(`creates an Aggregate IR node for product with embedded config`, () => {
      const agg = product(10)
      expect(agg.type).toBe(`agg`)
      expect(agg.name).toBe(`product`)
      expect(agg.args).toHaveLength(1)
      expect(agg.config).toBe(productConfig)
    })

    it(`creates an Aggregate IR node for variance with embedded config`, () => {
      const agg = variance(10)
      expect(agg.type).toBe(`agg`)
      expect(agg.name).toBe(`variance`)
      expect(agg.args).toHaveLength(1)
      expect(agg.config).toBe(varianceConfig)
    })
  })

  describe(`custom aggregates in queries`, () => {
    it(`product aggregate multiplies values in a group`, () => {
      const collection = createTestCollection()

      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ items: collection })
            .groupBy(({ items }) => items.category)
            .select(({ items }) => ({
              category: items.category,
              priceProduct: product(items.price),
            })),
      })

      expect(result.size).toBe(2)

      const categoryA = result.get(`A`)
      const categoryB = result.get(`B`)

      expect(categoryA?.priceProduct).toBe(200) // 10 * 20
      expect(categoryB?.priceProduct).toBe(375) // 15 * 25
    })

    it(`variance aggregate calculates population variance`, () => {
      const collection = createTestCollection()

      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ items: collection })
            .groupBy(({ items }) => items.category)
            .select(({ items }) => ({
              category: items.category,
              priceVariance: variance(items.price),
            })),
      })

      expect(result.size).toBe(2)

      // Category A: prices 10, 20 -> mean = 15, variance = ((10-15)² + (20-15)²) / 2 = 25
      const categoryA = result.get(`A`)
      expect(categoryA?.priceVariance).toBe(25)

      // Category B: prices 15, 25 -> mean = 20, variance = ((15-20)² + (25-20)²) / 2 = 25
      const categoryB = result.get(`B`)
      expect(categoryB?.priceVariance).toBe(25)
    })

    it(`custom aggregates work alongside built-in aggregates`, () => {
      const collection = createTestCollection()

      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ items: collection })
            .groupBy(({ items }) => items.category)
            .select(({ items }) => ({
              category: items.category,
              totalPrice: sum(items.price),
              avgPrice: avg(items.price),
              itemCount: count(items.id),
              priceProduct: product(items.price),
            })),
      })

      expect(result.size).toBe(2)

      const categoryA = result.get(`A`)
      expect(categoryA?.totalPrice).toBe(30) // 10 + 20
      expect(categoryA?.avgPrice).toBe(15) // (10 + 20) / 2
      expect(categoryA?.itemCount).toBe(2)
      expect(categoryA?.priceProduct).toBe(200) // 10 * 20
    })

    it(`custom aggregates work with single-group aggregation (empty GROUP BY)`, () => {
      const collection = createTestCollection()

      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ items: collection })
            .groupBy(() => ({}))
            .select(({ items }) => ({
              totalProduct: product(items.price),
            })),
      })

      expect(result.size).toBe(1)
      // 10 * 20 * 15 * 25 = 75000
      expect(result.toArray[0]?.totalProduct).toBe(75000)
    })
  })
})
