import { describe, expect, it } from "vitest"
import { compileExpression } from "../../../src/query/compiler/evaluators.js"
import { Func, PropRef, Value } from "../../../src/query/ir.js"
import { toExpression } from "../../../src/query/builder/ref-proxy.js"
import { and } from "../../../src/query/builder/operators/index.js"
import type {
  BasicExpression,
  CompiledExpression,
  EvaluatorFactory,
} from "../../../src/query/ir.js"

describe(`custom operators`, () => {
  // Define factory for the "between" operator
  const betweenFactory: EvaluatorFactory = (
    compiledArgs: Array<CompiledExpression>,
    _isSingleRow: boolean
  ): CompiledExpression => {
    const valueEval = compiledArgs[0]!
    const minEval = compiledArgs[1]!
    const maxEval = compiledArgs[2]!

    return (data: any) => {
      const value = valueEval(data)
      const min = minEval(data)
      const max = maxEval(data)

      if (value === null || value === undefined) {
        return null // 3-valued logic
      }

      return value >= min && value <= max
    }
  }

  // Builder function for "between" operator
  function between(value: any, min: any, max: any): BasicExpression<boolean> {
    return new Func(
      `between`,
      [toExpression(value), toExpression(min), toExpression(max)],
      betweenFactory
    )
  }

  describe(`custom operator pattern`, () => {
    it(`allows creating a custom "between" operator`, () => {
      // Test the custom operator
      const func = between(new Value(5), new Value(1), new Value(10))
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(true)
    })

    it(`custom "between" operator returns false when out of range`, () => {
      const func = between(new Value(15), new Value(1), new Value(10))
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(false)
    })

    it(`custom "between" operator handles null with 3-valued logic`, () => {
      const func = between(new Value(null), new Value(1), new Value(10))
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(null)
    })

    it(`allows creating a custom "startsWith" operator`, () => {
      const startsWithFactory: EvaluatorFactory = (
        compiledArgs: Array<CompiledExpression>,
        _isSingleRow: boolean
      ): CompiledExpression => {
        const strEval = compiledArgs[0]!
        const prefixEval = compiledArgs[1]!

        return (data: any) => {
          const str = strEval(data)
          const prefix = prefixEval(data)

          if (str === null || str === undefined) {
            return null
          }
          if (typeof str !== `string` || typeof prefix !== `string`) {
            return false
          }

          return str.startsWith(prefix)
        }
      }

      function startsWith(str: any, prefix: any): BasicExpression<boolean> {
        return new Func(
          `startsWith`,
          [toExpression(str), toExpression(prefix)],
          startsWithFactory
        )
      }

      const func = startsWith(new Value(`hello world`), new Value(`hello`))
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(true)
    })

    it(`custom operator works with property references`, () => {
      // Define a custom "isEmpty" operator
      const isEmptyFactory: EvaluatorFactory = (
        compiledArgs: Array<CompiledExpression>,
        _isSingleRow: boolean
      ): CompiledExpression => {
        const valueEval = compiledArgs[0]!

        return (data: any) => {
          const value = valueEval(data)

          if (value === null || value === undefined) {
            return true
          }
          if (typeof value === `string`) {
            return value.length === 0
          }
          if (Array.isArray(value)) {
            return value.length === 0
          }

          return false
        }
      }

      function isEmpty(value: any): BasicExpression<boolean> {
        return new Func(`isEmpty`, [toExpression(value)], isEmptyFactory)
      }

      // Test with a property reference
      const func = isEmpty(new PropRef([`users`, `name`]))
      const compiled = compileExpression(func)

      expect(compiled({ users: { name: `` } })).toBe(true)
      expect(compiled({ users: { name: `John` } })).toBe(false)
      expect(compiled({ users: { name: null } })).toBe(true)
    })

    it(`allows creating a custom "modulo" operator`, () => {
      const moduloFactory: EvaluatorFactory = (
        compiledArgs: Array<CompiledExpression>,
        _isSingleRow: boolean
      ): CompiledExpression => {
        const leftEval = compiledArgs[0]!
        const rightEval = compiledArgs[1]!

        return (data: any) => {
          const left = leftEval(data)
          const right = rightEval(data)

          if (left === null || left === undefined) {
            return null
          }
          if (right === 0) {
            return null // Division by zero
          }

          return left % right
        }
      }

      function modulo(left: any, right: any): BasicExpression<number> {
        return new Func(
          `modulo`,
          [toExpression(left), toExpression(right)],
          moduloFactory
        )
      }

      const func = modulo(new Value(10), new Value(3))
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(1)
    })

    it(`custom operator can be used in nested expressions`, () => {
      // Use the "between" operator with an "and" operator
      const func = and(
        between(new Value(5), new Value(1), new Value(10)),
        between(new Value(15), new Value(10), new Value(20))
      )
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(true)
    })

    it(`custom operator with extended behavior`, () => {
      // Define a custom version of "length" that also handles objects
      const customLengthFactory: EvaluatorFactory = (
        compiledArgs: Array<CompiledExpression>,
        _isSingleRow: boolean
      ): CompiledExpression => {
        const valueEval = compiledArgs[0]!

        return (data: any) => {
          const value = valueEval(data)

          if (typeof value === `string`) {
            return value.length
          }
          if (Array.isArray(value)) {
            return value.length
          }
          if (value && typeof value === `object`) {
            return Object.keys(value).length
          }

          return 0
        }
      }

      function customLength(value: any): BasicExpression<number> {
        return new Func(
          `customLength`,
          [toExpression(value)],
          customLengthFactory
        )
      }

      const func = customLength(new Value({ a: 1, b: 2, c: 3 }))
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(3)
    })
  })

  describe(`builder function pattern`, () => {
    it(`demonstrates the full pattern for custom operators`, () => {
      // This demonstrates the full pattern users would use

      // 1. The builder function was already defined above (between)
      // It includes both the factory and the builder function

      // 2. Use it like any other operator
      const expr = between(new PropRef([`users`, `age`]), 18, 65)

      // 3. Compile and execute
      const compiled = compileExpression(expr)

      expect(compiled({ users: { age: 30 } })).toBe(true)
      expect(compiled({ users: { age: 10 } })).toBe(false)
      expect(compiled({ users: { age: 70 } })).toBe(false)
    })
  })
})
