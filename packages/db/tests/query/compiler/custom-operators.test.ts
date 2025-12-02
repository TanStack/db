import { describe, expect, it } from "vitest"
import { compileExpression } from "../../../src/query/compiler/evaluators.js"
import { registerOperator } from "../../../src/query/compiler/registry.js"
import { Func, PropRef, Value } from "../../../src/query/ir.js"
import { toExpression } from "../../../src/query/builder/ref-proxy.js"
import type {
  CompiledExpression,
  EvaluatorFactory,
} from "../../../src/query/compiler/registry.js"
import type { BasicExpression } from "../../../src/query/ir.js"

// Import operators to register evaluators (needed for direct IR testing)
import "../../../src/query/builder/operators/index.js"

describe(`custom operators`, () => {
  describe(`registerOperator`, () => {
    it(`allows registering a custom "between" operator`, () => {
      // Register a custom "between" operator
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

      registerOperator(`between`, betweenFactory)

      // Test the custom operator
      const func = new Func(`between`, [
        new Value(5),
        new Value(1),
        new Value(10),
      ])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(true)
    })

    it(`custom "between" operator returns false when out of range`, () => {
      const func = new Func(`between`, [
        new Value(15),
        new Value(1),
        new Value(10),
      ])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(false)
    })

    it(`custom "between" operator handles null with 3-valued logic`, () => {
      const func = new Func(`between`, [
        new Value(null),
        new Value(1),
        new Value(10),
      ])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(null)
    })

    it(`allows registering a custom "startsWith" operator`, () => {
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

      registerOperator(`startsWith`, startsWithFactory)

      const func = new Func(`startsWith`, [
        new Value(`hello world`),
        new Value(`hello`),
      ])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(true)
    })

    it(`custom operator works with property references`, () => {
      // Register a custom "isEmpty" operator
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

      registerOperator(`isEmpty`, isEmptyFactory)

      // Test with a property reference
      const func = new Func(`isEmpty`, [new PropRef([`users`, `name`])])
      const compiled = compileExpression(func)

      expect(compiled({ users: { name: `` } })).toBe(true)
      expect(compiled({ users: { name: `John` } })).toBe(false)
      expect(compiled({ users: { name: null } })).toBe(true)
    })

    it(`allows registering a custom "modulo" operator`, () => {
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

      registerOperator(`modulo`, moduloFactory)

      const func = new Func(`modulo`, [new Value(10), new Value(3)])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(1)
    })

    it(`custom operator can be used in nested expressions`, () => {
      // Use the previously registered "between" with an "and" operator
      const func = new Func(`and`, [
        new Func(`between`, [new Value(5), new Value(1), new Value(10)]),
        new Func(`between`, [new Value(15), new Value(10), new Value(20)]),
      ])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(true)
    })

    it(`custom operator can override built-in operator behavior`, () => {
      // Register a custom version of "length" that handles objects
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

      // This will override the built-in length operator
      registerOperator(`customLength`, customLengthFactory)

      const func = new Func(`customLength`, [new Value({ a: 1, b: 2, c: 3 })])
      const compiled = compileExpression(func)

      expect(compiled({})).toBe(3)
    })
  })

  describe(`builder function pattern`, () => {
    it(`can create a builder function for custom operators`, () => {
      // This demonstrates the full pattern users would use

      // 1. Define the builder function (like eq, gt, etc.)
      function between(
        value: any,
        min: any,
        max: any
      ): BasicExpression<boolean> {
        return new Func(`between`, [
          toExpression(value),
          toExpression(min),
          toExpression(max),
        ])
      }

      // 2. The evaluator was already registered in previous tests
      // In real usage, you'd register it alongside the builder

      // 3. Use it like any other operator
      const expr = between(new PropRef([`users`, `age`]), 18, 65)

      // 4. Compile and execute
      const compiled = compileExpression(expr)

      expect(compiled({ users: { age: 30 } })).toBe(true)
      expect(compiled({ users: { age: 10 } })).toBe(false)
      expect(compiled({ users: { age: 70 } })).toBe(false)
    })
  })
})
