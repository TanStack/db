import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../../src/collection/index.js'
import {
  Aggregate,
  avg,
  count,
  createLiveQueryCollection,
  defineAggregate,
  sum,
} from '../../../src/query/index.js'
import { PropRef, Value } from '../../../src/query/ir.js'
import { toExpression } from '../../../src/query/builder/ref-proxy.js'
import { mockSyncCollectionOptions } from '../../utils.js'
import type {
  AggregateConfig,
  AggregateFactory,
  ExpressionArg,
  ValueExtractor,
} from '../../../src/query/index.js'
import type { RefLeaf } from '../../../src/query/builder/types.js'

// Sample data type for tests
type TestItem = {
  id: number
  category: string
  price: number
  quantity: number
}

const sampleItems: Array<TestItem> = [
  { id: 1, category: `A`, price: 10, quantity: 2 },
  { id: 2, category: `A`, price: 20, quantity: 3 },
  { id: 3, category: `B`, price: 15, quantity: 1 },
]

function createTestCollection() {
  return createCollection(
    mockSyncCollectionOptions<TestItem>({
      id: `test-custom-aggregates-types`,
      getKey: (item) => item.id,
      initialData: sampleItems,
    }),
  )
}

describe(`Custom Aggregate Types`, () => {
  describe(`defineAggregate return types`, () => {
    test(`defineAggregate returns a function that produces Aggregate<T>`, () => {
      const product = defineAggregate<number>({
        name: `product`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) => {
            let result = 1
            for (const [value, multiplicity] of values) {
              for (let i = 0; i < multiplicity; i++) {
                result *= value
              }
            }
            return result
          },
        }),
        valueTransform: `numeric`,
      })

      // The returned function should accept unknown arg and return Aggregate<number>
      expectTypeOf(product).toBeFunction()
      expectTypeOf(product).returns.toEqualTypeOf<Aggregate<number>>()
    })

    test(`defineAggregate with nullable return type`, () => {
      const median = defineAggregate<number | null>({
        name: `median`,
        factory: (valueExtractor) => ({
          preMap: (data: any) => [valueExtractor(data)],
          reduce: (values: Array<[Array<number>, number]>) => {
            const allValues: Array<number> = []
            for (const [valueArray, multiplicity] of values) {
              for (const value of valueArray) {
                for (let i = 0; i < multiplicity; i++) {
                  allValues.push(value)
                }
              }
            }
            return allValues
          },
          postMap: (allValues: Array<number>) => {
            if (allValues.length === 0) return null
            const sorted = [...allValues].sort((a, b) => a - b)
            return sorted[Math.floor(sorted.length / 2)]!
          },
        }),
        valueTransform: `raw`,
      })

      expectTypeOf(median).returns.toEqualTypeOf<Aggregate<number | null>>()
    })

    test(`defineAggregate with array return type`, () => {
      const collect = defineAggregate<Array<number>>({
        name: `collect`,
        factory: (valueExtractor) => ({
          preMap: (data: any) => [valueExtractor(data)],
          reduce: (values: Array<[Array<number>, number]>) => {
            const allValues: Array<number> = []
            for (const [valueArray, multiplicity] of values) {
              for (const value of valueArray) {
                for (let i = 0; i < multiplicity; i++) {
                  allValues.push(value)
                }
              }
            }
            return allValues
          },
        }),
        valueTransform: `raw`,
      })

      expectTypeOf(collect).returns.toEqualTypeOf<Aggregate<Array<number>>>()
    })

    test(`defineAggregate without generic defaults to unknown`, () => {
      const generic = defineAggregate({
        name: `generic`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[unknown, number]>) => values[0]?.[0],
        }),
        valueTransform: `raw`,
      })

      expectTypeOf(generic).returns.toEqualTypeOf<Aggregate<unknown>>()
    })
  })

  describe(`defineAggregate argument types`, () => {
    test(`typed aggregate with TArg generic`, () => {
      // Define with explicit argument type
      const typedSum = defineAggregate<number, number>({
        name: `sum`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) =>
            values.reduce((acc, [v, m]) => acc + v * m, 0),
        }),
        valueTransform: `numeric`,
      })

      // Should accept literal number
      const result = typedSum(10)
      expectTypeOf(result).toEqualTypeOf<Aggregate<number>>()

      // Should also accept RefLeaf<number>
      const refResult = typedSum({} as RefLeaf<number>)
      expectTypeOf(refResult).toEqualTypeOf<Aggregate<number>>()
    })

    test(`typed aggregate with string argument type`, () => {
      const concatAgg = defineAggregate<string, string>({
        name: `concat`,
        factory: (valueExtractor) => ({
          preMap: (data: any) => String(valueExtractor(data)),
          reduce: (values: Array<[string, number]>) =>
            values.map(([v]) => v).join(`,`),
        }),
        valueTransform: `raw`,
      })

      // Should accept string literal
      const result = concatAgg(`hello`)
      expectTypeOf(result).toEqualTypeOf<Aggregate<string>>()

      // Should also accept RefLeaf<string>
      const refResult = concatAgg({} as RefLeaf<string>)
      expectTypeOf(refResult).toEqualTypeOf<Aggregate<string>>()
    })

    test(`ExpressionArg type allows value or expression for aggregates`, () => {
      // ExpressionArg<string> should accept:
      type StrArg = ExpressionArg<string>

      // - literal string
      expectTypeOf<string>().toMatchTypeOf<StrArg>()
      // - RefLeaf<string>
      expectTypeOf<RefLeaf<string>>().toMatchTypeOf<StrArg>()
    })

    test(`aggregate accepts literal number argument`, () => {
      const sumAgg = defineAggregate<number>({
        name: `sum`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) =>
            values.reduce((acc, [v, m]) => acc + v * m, 0),
        }),
        valueTransform: `numeric`,
      })

      // Should accept literal number
      const result = sumAgg(10)
      expectTypeOf(result).toEqualTypeOf<Aggregate<number>>()
    })

    test(`aggregate accepts Value IR node as argument`, () => {
      const product = defineAggregate<number>({
        name: `product`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: () => 1,
        }),
        valueTransform: `numeric`,
      })

      // Should accept Value node
      const result = product(new Value(10))
      expectTypeOf(result).toEqualTypeOf<Aggregate<number>>()
    })

    test(`aggregate accepts PropRef IR node as argument`, () => {
      const sumAgg = defineAggregate<number>({
        name: `sum`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) =>
            values.reduce((acc, [v, m]) => acc + v * m, 0),
        }),
        valueTransform: `numeric`,
      })

      // Should accept PropRef node
      const result = sumAgg(new PropRef([`items`, `price`]))
      expectTypeOf(result).toEqualTypeOf<Aggregate<number>>()
    })

    test(`aggregate accepts string literal argument`, () => {
      const concatAgg = defineAggregate<string>({
        name: `concat`,
        factory: (valueExtractor) => ({
          preMap: (data: any) => String(valueExtractor(data)),
          reduce: (values: Array<[string, number]>) =>
            values.map(([v]) => v).join(`,`),
        }),
        valueTransform: `raw`,
      })

      // Should accept string literal
      const result = concatAgg(`hello`)
      expectTypeOf(result).toEqualTypeOf<Aggregate<string>>()
    })
  })

  describe(`defineAggregate factory callback types`, () => {
    test(`factory callback receives ValueExtractor`, () => {
      defineAggregate<number>({
        name: `test`,
        factory: (valueExtractor) => {
          // valueExtractor should be ValueExtractor type
          expectTypeOf(valueExtractor).toMatchTypeOf<ValueExtractor>()

          return {
            preMap: valueExtractor,
            reduce: () => 0,
          }
        },
        valueTransform: `numeric`,
      })
    })

    test(`factory callback returns object with preMap and reduce`, () => {
      defineAggregate<number>({
        name: `test`,
        factory: (valueExtractor) => {
          const result = {
            preMap: valueExtractor,
            reduce: (_values: Array<[number, number]>) => 0,
          }

          // Should have preMap and reduce
          expectTypeOf(result.preMap).toMatchTypeOf<ValueExtractor>()
          expectTypeOf(result.reduce).toBeFunction()

          return result
        },
        valueTransform: `numeric`,
      })
    })

    test(`factory callback can return optional postMap`, () => {
      defineAggregate<number>({
        name: `test`,
        factory: (valueExtractor) => ({
          preMap: (data: any) => {
            const value = valueExtractor(data)
            return { sum: value, n: 1 }
          },
          reduce: (_values: Array<[{ sum: number; n: number }, number]>) => ({
            sum: 0,
            n: 0,
          }),
          postMap: (acc: { sum: number; n: number }) => {
            expectTypeOf(acc).toEqualTypeOf<{ sum: number; n: number }>()
            return acc.n > 0 ? acc.sum / acc.n : 0
          },
        }),
        valueTransform: `raw`,
      })
    })

    test(`AggregateFactory type is correctly typed`, () => {
      const factory: AggregateFactory = (valueExtractor) => {
        expectTypeOf(valueExtractor).toMatchTypeOf<ValueExtractor>()
        return {
          preMap: valueExtractor,
          reduce: () => 0,
        }
      }

      expectTypeOf(factory).toMatchTypeOf<AggregateFactory>()
    })
  })

  describe(`custom aggregates in queries`, () => {
    const testCollection = createTestCollection()

    test(`custom aggregate accepts ref proxy in query context`, () => {
      const product = defineAggregate<number>({
        name: `product`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) => {
            let result = 1
            for (const [value, multiplicity] of values) {
              for (let i = 0; i < multiplicity; i++) {
                result *= value
              }
            }
            return result
          },
        }),
        valueTransform: `numeric`,
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            .groupBy(({ items }) => items.category)
            // items.price is RefLeaf<number>
            .select(({ items }) => ({
              category: items.category,
              priceProduct: product(items.price),
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          category: string
          priceProduct: number
        }>
      >()

      const item = result.get(`A`)
      expectTypeOf(item).toEqualTypeOf<
        | {
            category: string
            priceProduct: number
          }
        | undefined
      >()
    })

    test(`custom aggregate with different ref proxy field`, () => {
      const sumAgg = defineAggregate<number>({
        name: `customSum`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) =>
            values.reduce((acc, [v, m]) => acc + v * m, 0),
        }),
        valueTransform: `numeric`,
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            .groupBy(({ items }) => items.category)
            // items.quantity is RefLeaf<number>
            .select(({ items }) => ({
              category: items.category,
              totalQty: sumAgg(items.quantity),
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          category: string
          totalQty: number
        }>
      >()
    })

    test(`custom aggregate alongside built-in aggregates`, () => {
      const variance = defineAggregate<number>({
        name: `variance`,
        factory: (valueExtractor: ValueExtractor) => ({
          preMap: (data: any) => {
            const value = valueExtractor(data)
            return { sum: value, sumSq: value * value, n: 1 }
          },
          reduce: (
            values: Array<[{ sum: number; sumSq: number; n: number }, number]>,
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
        valueTransform: `raw`,
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            .groupBy(({ items }) => items.category)
            .select(({ items }) => ({
              category: items.category,
              // Built-in aggregates
              totalPrice: sum(items.price),
              avgPrice: avg(items.price),
              itemCount: count(items.id),
              // Custom aggregate
              priceVariance: variance(items.price),
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          category: string
          totalPrice: number
          avgPrice: number
          itemCount: number
          priceVariance: number
        }>
      >()
    })

    test(`multiple custom aggregates in same query`, () => {
      const product = defineAggregate<number>({
        name: `product`,
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: () => 1,
        }),
        valueTransform: `numeric`,
      })

      const range = defineAggregate<number>({
        name: `range`,
        factory: (valueExtractor) => ({
          preMap: (data: any) => {
            const v = valueExtractor(data)
            return { min: v, max: v }
          },
          reduce: () => ({ min: 0, max: 0 }),
          postMap: (acc: { min: number; max: number }) => acc.max - acc.min,
        }),
        valueTransform: `raw`,
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            .groupBy(({ items }) => items.category)
            .select(({ items }) => ({
              category: items.category,
              priceProduct: product(items.price),
              priceRange: range(items.price),
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          category: string
          priceProduct: number
          priceRange: number
        }>
      >()
    })
  })

  describe(`Aggregate IR node types`, () => {
    test(`Aggregate type parameter affects node type`, () => {
      const numberAgg = new Aggregate<number>(`sum`, [])
      expectTypeOf(numberAgg).toMatchTypeOf<Aggregate<number>>()

      const arrayAgg = new Aggregate<Array<string>>(`collect`, [])
      expectTypeOf(arrayAgg).toMatchTypeOf<Aggregate<Array<string>>>()

      const nullableAgg = new Aggregate<number | null>(`median`, [])
      expectTypeOf(nullableAgg).toMatchTypeOf<Aggregate<number | null>>()
    })

    test(`Aggregate with config is still properly typed`, () => {
      const config: AggregateConfig = {
        factory: (valueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) =>
            values.reduce((acc, [v, m]) => acc + v * m, 0),
        }),
        valueTransform: `numeric`,
      }

      const agg = new Aggregate<number>(`custom`, [toExpression(10)], config)

      expectTypeOf(agg).toMatchTypeOf<Aggregate<number>>()
      expectTypeOf(agg.name).toEqualTypeOf<string>()
      expectTypeOf(agg.type).toEqualTypeOf<`agg`>()
      expectTypeOf(agg.config).toEqualTypeOf<AggregateConfig | undefined>()
    })

    test(`Aggregate args array accepts BasicExpression types`, () => {
      const agg = new Aggregate<number>(`test`, [
        new Value(10),
        new PropRef([`items`, `price`]),
      ])

      expectTypeOf(agg).toMatchTypeOf<Aggregate<number>>()
      expectTypeOf(agg.args).toBeArray()
    })

    test(`manual Aggregate creation with typed config`, () => {
      const productConfig: AggregateConfig = {
        factory: (valueExtractor: ValueExtractor) => ({
          preMap: valueExtractor,
          reduce: (values: Array<[number, number]>) => {
            let result = 1
            for (const [value, multiplicity] of values) {
              for (let i = 0; i < multiplicity; i++) {
                result *= value
              }
            }
            return result
          },
        }),
        valueTransform: `numeric`,
      }

      function product<T>(arg: T): Aggregate<number> {
        return new Aggregate(`product`, [toExpression(arg)], productConfig)
      }

      expectTypeOf(product).returns.toEqualTypeOf<Aggregate<number>>()

      const agg = product(10)
      expectTypeOf(agg).toMatchTypeOf<Aggregate<number>>()
    })
  })

  describe(`AggregateConfig type`, () => {
    test(`AggregateConfig valueTransform literal types`, () => {
      const numericConfig: AggregateConfig = {
        factory: (ve) => ({ preMap: ve, reduce: () => 0 }),
        valueTransform: `numeric`,
      }
      expectTypeOf(numericConfig.valueTransform).toEqualTypeOf<
        `numeric` | `numericOrDate` | `raw`
      >()

      const rawConfig: AggregateConfig = {
        factory: (ve) => ({ preMap: ve, reduce: () => 0 }),
        valueTransform: `raw`,
      }
      expectTypeOf(rawConfig.valueTransform).toEqualTypeOf<
        `numeric` | `numericOrDate` | `raw`
      >()

      const dateConfig: AggregateConfig = {
        factory: (ve) => ({ preMap: ve, reduce: () => 0 }),
        valueTransform: `numericOrDate`,
      }
      expectTypeOf(dateConfig.valueTransform).toEqualTypeOf<
        `numeric` | `numericOrDate` | `raw`
      >()
    })

    test(`AggregateConfig factory type`, () => {
      const config: AggregateConfig = {
        factory: (valueExtractor) => {
          expectTypeOf(valueExtractor).toMatchTypeOf<ValueExtractor>()
          return {
            preMap: valueExtractor,
            reduce: () => 0,
          }
        },
        valueTransform: `numeric`,
      }

      expectTypeOf(config.factory).toMatchTypeOf<AggregateFactory>()
    })
  })
})
