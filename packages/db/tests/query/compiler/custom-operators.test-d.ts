import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../../src/collection/index.js'
import {
  Func,
  add,
  comparison,
  createLiveQueryCollection,
  defineOperator,
  eq,
  gt,
  isUnknown,
  numeric,
  transform,
} from '../../../src/query/index.js'
import { PropRef, Value } from '../../../src/query/ir.js'
import { mockSyncCollectionOptions } from '../../utils.js'
import type {
  CompiledArgsFor,
  ExpressionArg,
  ExpressionArgs,
  TypedCompiledExpression,
  TypedEvaluatorFactory,
} from '../../../src/query/index.js'
import type {
  CompiledExpression,
  EvaluatorFactory,
} from '../../../src/query/ir.js'
import type { RefLeaf } from '../../../src/query/builder/types.js'

// Sample data type for tests
type TestItem = {
  id: number
  name: string
  value: number
  category: string
  active: boolean
}

const sampleItems: Array<TestItem> = [
  { id: 1, name: `Alpha`, value: 10, category: `A`, active: true },
  { id: 2, name: `Beta`, value: 25, category: `A`, active: false },
]

function createTestCollection() {
  return createCollection(
    mockSyncCollectionOptions<TestItem>({
      id: `test-custom-operators-types`,
      getKey: (item) => item.id,
      initialData: sampleItems,
    }),
  )
}

describe(`Custom Operator Types`, () => {
  describe(`defineOperator return types`, () => {
    test(`defineOperator returns a function that produces Func<T>`, () => {
      // With fully typed TArgs, evaluate callback is typed
      const between = defineOperator<
        boolean,
        [value: number, min: number, max: number]
      >({
        name: `between`,
        compile:
          ([valueArg, minArg, maxArg]) =>
          (data) => {
            const value = valueArg(data)
            if (isUnknown(value)) return null
            return value >= minArg(data) && value <= maxArg(data)
          },
      })

      // The returned function should return Func<boolean>
      expectTypeOf(between).toBeFunction()
      expectTypeOf(between).returns.toEqualTypeOf<Func<boolean>>()
    })

    test(`defineOperator with explicit return type and transform helper`, () => {
      // Use TArgs with transform helper
      const double = defineOperator<number, [value: number]>({
        name: `double`,
        compile: transform((v) => v * 2),
      })

      expectTypeOf(double).returns.toEqualTypeOf<Func<number>>()
    })

    test(`defineOperator with string return type and transform helper`, () => {
      const prefix = defineOperator<string, [value: unknown]>({
        name: `prefix`,
        compile: transform((v) => `prefix_${v}`),
      })

      expectTypeOf(prefix).returns.toEqualTypeOf<Func<string>>()
    })

    test(`defineOperator with union return type`, () => {
      const maybe = defineOperator<boolean | null, [value: unknown]>({
        name: `maybe`,
        compile:
          ([arg]) =>
          (data) => {
            const value = arg(data)
            if (isUnknown(value)) return null
            return Boolean(value)
          },
      })

      expectTypeOf(maybe).returns.toEqualTypeOf<Func<boolean | null>>()
    })

    test(`defineOperator without generic defaults to unknown`, () => {
      const generic = defineOperator({
        name: `generic`,
        compile:
          ([arg]) =>
          (data) =>
            arg!(data),
      })

      expectTypeOf(generic).returns.toEqualTypeOf<Func<unknown>>()
    })
  })

  describe(`defineOperator argument types`, () => {
    test(`typed operator with TArgs generic`, () => {
      // Define with explicit argument types
      const between = defineOperator<boolean, [number, number, number]>({
        name: `between`,
        compile:
          ([valueArg, minArg, maxArg]) =>
          (data) => {
            const value = valueArg(data)
            return value >= minArg(data) && value <= maxArg(data)
          },
      })

      // Should accept literal numbers
      const result = between(5, 1, 10)
      expectTypeOf(result).toEqualTypeOf<Func<boolean>>()

      // Should also accept RefLeaf<number> (from query context)
      const refResult = between({} as RefLeaf<number>, 1, {} as RefLeaf<number>)
      expectTypeOf(refResult).toEqualTypeOf<Func<boolean>>()
    })

    test(`typed operator with string arguments`, () => {
      const startsWith = defineOperator<boolean, [string, string]>({
        name: `startsWith`,
        compile:
          ([strArg, prefixArg]) =>
          (data) => {
            const str = strArg(data)
            const prefix = prefixArg(data)
            return typeof str === `string` && str.startsWith(prefix)
          },
      })

      // Should accept string literals
      const result = startsWith(`hello`, `he`)
      expectTypeOf(result).toEqualTypeOf<Func<boolean>>()

      // Should also accept RefLeaf<string>
      const refResult = startsWith({} as RefLeaf<string>, `prefix`)
      expectTypeOf(refResult).toEqualTypeOf<Func<boolean>>()
    })

    test(`ExpressionArg type allows value or expression`, () => {
      // ExpressionArg<number> should accept:
      type NumArg = ExpressionArg<number>

      // - literal number
      expectTypeOf<number>().toMatchTypeOf<NumArg>()
      // - RefLeaf<number>
      expectTypeOf<RefLeaf<number>>().toMatchTypeOf<NumArg>()
      // - Func<number>
      expectTypeOf<Func<number>>().toMatchTypeOf<NumArg>()
    })

    test(`ExpressionArgs maps tuple of types`, () => {
      type Args = ExpressionArgs<[number, string, boolean]>

      // Should be a tuple of ExpressionArg types
      expectTypeOf<Args>().toMatchTypeOf<
        [ExpressionArg<number>, ExpressionArg<string>, ExpressionArg<boolean>]
      >()
    })

    test(`operator accepts literal number arguments`, () => {
      // Fully typed with TArgs - evaluate callback gets typed args
      const between = defineOperator<
        boolean,
        [value: number, min: number, max: number]
      >({
        name: `between`,
        compile:
          ([valueArg, minArg, maxArg]) =>
          (data) => {
            const value = valueArg(data)
            return value >= minArg(data) && value <= maxArg(data)
          },
      })

      // Should accept literal numbers
      const result = between(5, 1, 10)
      expectTypeOf(result).toEqualTypeOf<Func<boolean>>()
    })

    test(`operator accepts literal string arguments`, () => {
      // Fully typed with TArgs
      const startsWith = defineOperator<boolean, [str: string, prefix: string]>(
        {
          name: `startsWith`,
          compile:
            ([strArg, prefixArg]) =>
            (data) => {
              const str = strArg(data)
              const prefix = prefixArg(data)
              return str.startsWith(prefix)
            },
        },
      )

      // Should accept literal strings
      const result = startsWith(`hello`, `he`)
      expectTypeOf(result).toEqualTypeOf<Func<boolean>>()
    })

    test(`operator accepts Value IR nodes as arguments`, () => {
      // Fully typed with TArgs
      const double = defineOperator<number, [value: number]>({
        name: `double`,
        compile: transform((v) => v * 2),
      })

      // Should accept Value nodes
      const result = double(new Value(10))
      expectTypeOf(result).toEqualTypeOf<Func<number>>()
    })

    test(`operator accepts PropRef IR nodes as arguments`, () => {
      // Fully typed with TArgs
      const isPositive = defineOperator<boolean, [value: number]>({
        name: `isPositive`,
        compile:
          ([arg]) =>
          (data) =>
            arg(data) > 0,
      })

      // Should accept PropRef nodes
      const result = isPositive(new PropRef([`users`, `age`]))
      expectTypeOf(result).toEqualTypeOf<Func<boolean>>()
    })

    test(`operator accepts other Func expressions as arguments`, () => {
      const isTrue = defineOperator<boolean>({
        name: `isTrue`,
        compile:
          ([arg]) =>
          (data) =>
            arg!(data) === true,
      })

      // Should accept other Func expressions (nested operators)
      const nestedResult = isTrue(gt(new Value(5), new Value(3)))
      expectTypeOf(nestedResult).toEqualTypeOf<Func<boolean>>()
    })

    test(`operator accepts mixed argument types`, () => {
      // Fully typed with TArgs
      const between = defineOperator<
        boolean,
        [value: number, min: number, max: number]
      >({
        name: `between`,
        compile:
          ([valueArg, minArg, maxArg]) =>
          (data) => {
            const value = valueArg(data)
            return value >= minArg(data) && value <= maxArg(data)
          },
      })

      // Should accept mix of PropRef, literal, and Value
      const result = between(new PropRef([`items`, `value`]), 10, new Value(20))
      expectTypeOf(result).toEqualTypeOf<Func<boolean>>()
    })

    test(`operator function accepts any number of arguments`, () => {
      const concat = defineOperator<string>({
        name: `concat`,
        compile: (args) => (data) => args.map((a) => a(data)).join(``),
      })

      // Should accept variable number of arguments
      const result1 = concat(`a`)
      const result2 = concat(`a`, `b`)
      const result3 = concat(`a`, `b`, `c`, `d`, `e`)

      expectTypeOf(result1).toEqualTypeOf<Func<string>>()
      expectTypeOf(result2).toEqualTypeOf<Func<string>>()
      expectTypeOf(result3).toEqualTypeOf<Func<string>>()
    })
  })

  describe(`defineOperator evaluate callback types`, () => {
    test(`evaluate callback receives typed CompiledArgsFor<TArgs>`, () => {
      defineOperator<boolean, [value: number, min: number, max: number]>({
        name: `between`,
        compile: (compiledArgs) => {
          // compiledArgs should be typed tuple with named elements
          expectTypeOf(compiledArgs).toEqualTypeOf<
            CompiledArgsFor<[value: number, min: number, max: number]>
          >()

          // Destructuring preserves names
          const [value, min, max] = compiledArgs

          // Each is TypedCompiledExpression<number>
          expectTypeOf(value).toEqualTypeOf<TypedCompiledExpression<number>>()
          expectTypeOf(min).toEqualTypeOf<TypedCompiledExpression<number>>()
          expectTypeOf(max).toEqualTypeOf<TypedCompiledExpression<number>>()

          return (data) => {
            // Calling the compiled expressions returns the typed value
            const v = value(data)
            expectTypeOf(v).toEqualTypeOf<number>()
            return true
          }
        },
      })
    })

    test(`evaluate callback with string args is typed`, () => {
      defineOperator<boolean, [str: string, prefix: string]>({
        name: `startsWith`,
        compile: ([str, prefix]) => {
          // Both are TypedCompiledExpression<string>
          expectTypeOf(str).toEqualTypeOf<TypedCompiledExpression<string>>()
          expectTypeOf(prefix).toEqualTypeOf<TypedCompiledExpression<string>>()

          return (data) => {
            // Calling returns string
            const s = str(data)
            const p = prefix(data)
            expectTypeOf(s).toEqualTypeOf<string>()
            expectTypeOf(p).toEqualTypeOf<string>()
            return s.startsWith(p)
          }
        },
      })
    })

    test(`evaluate callback second parameter is isSingleRow boolean`, () => {
      defineOperator<boolean, [number]>({
        name: `test`,
        compile: (_compiledArgs, isSingleRow) => {
          expectTypeOf(isSingleRow).toEqualTypeOf<boolean>()
          return () => true
        },
      })
    })

    test(`TypedEvaluatorFactory type is correctly structured`, () => {
      type MyFactory = TypedEvaluatorFactory<[a: number, b: string]>

      // Should be a function that takes typed args
      expectTypeOf<MyFactory>().toMatchTypeOf<
        (
          args: CompiledArgsFor<[a: number, b: string]>,
          isSingleRow: boolean,
        ) => CompiledExpression
      >()
    })

    test(`CompiledArgsFor preserves tuple structure`, () => {
      type Args = CompiledArgsFor<[value: number, min: number, max: number]>

      // Should be a tuple of typed compiled expressions
      expectTypeOf<Args>().toEqualTypeOf<
        [
          value: TypedCompiledExpression<number>,
          min: TypedCompiledExpression<number>,
          max: TypedCompiledExpression<number>,
        ]
      >()
    })
  })

  describe(`factory helper types`, () => {
    test(`comparison helper returns TypedEvaluatorFactory`, () => {
      // Without type param, use type-safe comparison for unknown
      const factory = comparison((a, b) => a === b)

      // comparison returns TypedEvaluatorFactory<[T, T]>
      expectTypeOf(factory).toMatchTypeOf<
        TypedEvaluatorFactory<[unknown, unknown]>
      >()
    })

    test(`comparison with type param is fully typed`, () => {
      const factory = comparison<number>((a, b) => {
        // a and b are typed as number
        expectTypeOf(a).toEqualTypeOf<number>()
        expectTypeOf(b).toEqualTypeOf<number>()
        return a > b
      })

      expectTypeOf(factory).toMatchTypeOf<
        TypedEvaluatorFactory<[number, number]>
      >()
    })

    test(`transform helper returns TypedEvaluatorFactory`, () => {
      const factory = transform((v) => String(v))

      expectTypeOf(factory).toMatchTypeOf<TypedEvaluatorFactory<[unknown]>>()
    })

    test(`transform with type params is fully typed`, () => {
      const factory = transform<number, string>((v) => {
        // v is typed as number
        expectTypeOf(v).toEqualTypeOf<number>()
        return String(v)
      })

      expectTypeOf(factory).toMatchTypeOf<TypedEvaluatorFactory<[number]>>()
    })

    test(`numeric helper returns TypedEvaluatorFactory for numbers`, () => {
      const factory = numeric((a, b) => {
        // a and b are typed as number
        expectTypeOf(a).toEqualTypeOf<number>()
        expectTypeOf(b).toEqualTypeOf<number>()
        return a + b
      })

      expectTypeOf(factory).toMatchTypeOf<
        TypedEvaluatorFactory<[number, number]>
      >()
    })

    test(`factories work with defineOperator and typed args`, () => {
      // comparison infers types from TArgs
      const myGt = defineOperator<boolean, [left: number, right: number]>({
        name: `gt`,
        compile: comparison((a, b) => a > b),
      })
      expectTypeOf(myGt).returns.toEqualTypeOf<Func<boolean>>()

      // transform infers type from TArgs
      const double = defineOperator<number, [value: number]>({
        name: `double`,
        compile: transform((v) => v * 2),
      })
      expectTypeOf(double).returns.toEqualTypeOf<Func<number>>()

      // numeric is always [number, number]
      const mod = defineOperator<number, [left: number, right: number]>({
        name: `mod`,
        compile: numeric((a, b) => a % b),
      })
      expectTypeOf(mod).returns.toEqualTypeOf<Func<number>>()
    })

    test(`factories type callback params based on TArgs`, () => {
      // When used with defineOperator, the callback params should match TArgs
      defineOperator<boolean, [a: number, b: number]>({
        name: `gt`,
        compile: comparison((a, b) => {
          // In this context, a and b should be inferred from usage
          return a > b
        }),
      })

      defineOperator<string, [value: string]>({
        name: `upper`,
        compile: transform((v) => {
          // v should be inferred from usage
          return v.toUpperCase()
        }),
      })
    })
  })

  describe(`custom operators in queries`, () => {
    const testCollection = createTestCollection()

    test(`custom operator accepts ref proxies in query context`, () => {
      // Fully typed with TArgs
      const between = defineOperator<
        boolean,
        [value: number, min: number, max: number]
      >({
        name: `between`,
        compile:
          ([valueArg, minArg, maxArg]) =>
          (data) => {
            const value = valueArg(data)
            return value >= minArg(data) && value <= maxArg(data)
          },
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            // items.value is a RefLeaf<number>, min/max are literals
            .where(({ items }) => between(items.value, 10, 20))
            .select(({ items }) => ({
              id: items.id,
              name: items.name,
              value: items.value,
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          id: number
          name: string
          value: number
        }>
      >()
    })

    test(`custom operator accepts multiple ref proxies`, () => {
      // Fully typed with TArgs
      const addValues = defineOperator<number, [a: number, b: number]>({
        name: `addValues`,
        compile: numeric((a, b) => a + b),
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            // Both args are RefLeaf<number>
            .select(({ items }) => ({
              id: items.id,
              combined: addValues(items.value, items.id),
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          id: number
          combined: number
        }>
      >()
    })

    test(`custom operator accepts string ref proxies`, () => {
      // Fully typed with TArgs
      const toUpper = defineOperator<string, [value: string]>({
        name: `toUpper`,
        compile: transform((v) => v.toUpperCase()),
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            // items.name is RefLeaf<string>
            .select(({ items }) => ({
              id: items.id,
              upperName: toUpper(items.name),
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          id: number
          upperName: string
        }>
      >()
    })

    test(`custom operator can be nested with built-in operators`, () => {
      // Fully typed with TArgs
      const double = defineOperator<number, [value: number]>({
        name: `double`,
        compile: transform((v) => v * 2),
      })

      // The key test: custom operator can be passed to built-in operator
      const doubledValue = double(new Value(10))
      expectTypeOf(doubledValue).toEqualTypeOf<Func<number>>()

      // And built-in operator accepts the custom operator result
      // add() returns BasicExpression which can be Func or other expression types
      const addedResult = add(doubledValue, new Value(5))
      // Just verify add accepts a Func and returns something
      expectTypeOf(addedResult).not.toBeNever()
    })

    test(`built-in operator can be nested inside custom operator`, () => {
      // Fully typed with TArgs
      const isPositive = defineOperator<boolean, [value: number]>({
        name: `isPositive`,
        compile:
          ([arg]) =>
          (data) =>
            arg(data) > 0,
      })

      const result = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ items: testCollection })
            // Nest built-in operator inside custom operator
            .where(({ items }) => isPositive(add(items.value, items.id)))
            .select(({ items }) => ({
              id: items.id,
            })),
      })

      expectTypeOf(result.toArray).toEqualTypeOf<
        Array<{
          id: number
        }>
      >()
    })
  })

  describe(`Func IR node types`, () => {
    test(`Func type parameter affects node type`, () => {
      const booleanFunc = new Func<boolean>(`test`, [])
      expectTypeOf(booleanFunc).toMatchTypeOf<Func<boolean>>()

      const numberFunc = new Func<number>(`test`, [])
      expectTypeOf(numberFunc).toMatchTypeOf<Func<number>>()

      const stringFunc = new Func<string>(`test`, [])
      expectTypeOf(stringFunc).toMatchTypeOf<Func<string>>()
    })

    test(`Func with factory is still properly typed`, () => {
      // TypedEvaluatorFactory needs to be cast to EvaluatorFactory for direct Func construction
      const factory = comparison((a, b) => a === b)
      const func = new Func<boolean>(
        `eq`,
        [],
        factory as unknown as EvaluatorFactory,
      )

      expectTypeOf(func).toMatchTypeOf<Func<boolean>>()
      expectTypeOf(func.name).toEqualTypeOf<string>()
      expectTypeOf(func.type).toEqualTypeOf<`func`>()
    })

    test(`Func args array accepts BasicExpression types`, () => {
      const func = new Func<boolean>(`test`, [
        new Value(10),
        new PropRef([`users`, `age`]),
        eq(new Value(1), new Value(2)),
      ])

      expectTypeOf(func).toMatchTypeOf<Func<boolean>>()
      expectTypeOf(func.args).toBeArray()
    })
  })
})
