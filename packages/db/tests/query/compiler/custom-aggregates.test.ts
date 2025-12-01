import { beforeAll, describe, expect, it } from "vitest"
import { createCollection } from "../../../src/collection/index.js"
import {
  avg,
  count,
  createLiveQueryCollection,
  sum,
} from "../../../src/query/index.js"
import { Aggregate } from "../../../src/query/ir.js"
import { toExpression } from "../../../src/query/builder/ref-proxy.js"
import {
  getAggregateConfig,
  registerAggregate,
} from "../../../src/query/compiler/aggregate-registry.js"
import { mockSyncCollectionOptions } from "../../utils.js"
import type { ValueExtractor } from "../../../src/query/compiler/aggregate-registry.js"

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

// Custom aggregate builder function (follows the same pattern as sum, count, etc.)
function product<T>(arg: T): Aggregate<number> {
  return new Aggregate(`product`, [toExpression(arg)])
}

function variance<T>(arg: T): Aggregate<number> {
  return new Aggregate(`variance`, [toExpression(arg)])
}

describe(`Custom Aggregates`, () => {
  beforeAll(() => {
    // Register custom aggregates for testing
    // Aggregate functions must implement the IVM aggregate interface:
    // { preMap: (data) => V, reduce: (values: [V, multiplicity][]) => V, postMap?: (V) => R }

    // Custom product aggregate: multiplies all values together
    registerAggregate(`product`, {
      factory: (valueExtractor: ValueExtractor) => ({
        preMap: valueExtractor,
        reduce: (values: Array<[number, number]>) => {
          let product = 1
          for (const [value, multiplicity] of values) {
            // For positive multiplicity, multiply the value that many times
            // For negative multiplicity, divide (inverse operation for IVM)
            if (multiplicity > 0) {
              for (let i = 0; i < multiplicity; i++) {
                product *= value
              }
            } else if (multiplicity < 0) {
              for (let i = 0; i < -multiplicity; i++) {
                product /= value
              }
            }
          }
          return product
        },
      }),
      valueTransform: `numeric`,
    })

    // Custom variance aggregate (simplified - population variance)
    // Stores { sum, sumSq, n } to compute variance
    registerAggregate(`variance`, {
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
          for (const [{ sum, sumSq, n }, multiplicity] of values) {
            totalSum += sum * multiplicity
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
    })
  })

  describe(`registerAggregate`, () => {
    it(`registers a custom aggregate in the registry`, () => {
      const config = getAggregateConfig(`product`)
      expect(config).toBeDefined()
      expect(config.valueTransform).toBe(`numeric`)
      expect(typeof config.factory).toBe(`function`)
    })

    it(`retrieves custom aggregate config (case-insensitive)`, () => {
      const config1 = getAggregateConfig(`Product`)
      const config2 = getAggregateConfig(`PRODUCT`)
      expect(config1).toBeDefined()
      expect(config2).toBeDefined()
    })
  })

  describe(`custom aggregate builder functions`, () => {
    it(`creates an Aggregate IR node for product`, () => {
      const agg = product(10)
      expect(agg.type).toBe(`agg`)
      expect(agg.name).toBe(`product`)
      expect(agg.args).toHaveLength(1)
    })

    it(`creates an Aggregate IR node for variance`, () => {
      const agg = variance(10)
      expect(agg.type).toBe(`agg`)
      expect(agg.name).toBe(`variance`)
      expect(agg.args).toHaveLength(1)
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
