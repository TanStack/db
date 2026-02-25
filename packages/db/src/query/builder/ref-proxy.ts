import { PropRef, Value } from '../ir.js'
import { JavaScriptOperatorInQueryError } from '../../errors.js'
import type { BasicExpression } from '../ir.js'
import type { RefLeaf } from './types.js'

/**
 * Creates a handler for Symbol.toPrimitive that throws an error when
 * JavaScript tries to coerce a RefProxy to a primitive value.
 * This catches misuse like string concatenation, arithmetic, etc.
 */
function getOperatorTypeFromHint(hint: string): string {
  switch (hint) {
    case `number`:
      return `arithmetic`
    case `string`:
      return `string concatenation`
    default:
      return `comparison`
  }
}

function createToPrimitiveHandler(
  path: Array<string>,
): (hint: string) => never {
  return (hint: string) => {
    const pathStr = path.length > 0 ? path.join(`.`) : `<root>`
    throw new JavaScriptOperatorInQueryError(
      getOperatorTypeFromHint(hint),
      `Attempted to use "${pathStr}" in a JavaScript ${hint} context.\n` +
        `Query references can only be used with query functions, not JavaScript operators.`,
    )
  }
}

export interface RefProxy<T = any> {
  /** @internal */
  readonly __refProxy: true
  /** @internal */
  readonly __path: Array<string>
  /** @internal */
  readonly __type: T
}

/**
 * Type for creating a RefProxy for a single row/type without namespacing
 * Used in collection indexes and where clauses
 */
export type SingleRowRefProxy<T> =
  T extends Record<string, any>
    ? {
        [K in keyof T]: T[K] extends Record<string, any>
          ? SingleRowRefProxy<T[K]> & RefProxy<T[K]>
          : RefLeaf<T[K]>
      } & RefProxy<T>
    : RefProxy<T>

/**
 * Creates a proxy object that records property access paths for a single row
 * Used in collection indexes and where clauses
 */
export function createSingleRowRefProxy<
  T extends Record<string, any>,
>(): SingleRowRefProxy<T> {
  const cache = new Map<string, any>()

  function createProxy(path: Array<string>): any {
    const pathKey = path.join(`.`)
    if (cache.has(pathKey)) {
      return cache.get(pathKey)
    }

    const proxy = new Proxy({} as any, {
      get(target, prop, receiver) {
        if (prop === `__refProxy`) return true
        if (prop === `__path`) return path
        if (prop === `__type`) return undefined // Type is only for TypeScript inference
        // Intercept Symbol.toPrimitive to catch JS coercion attempts
        if (prop === Symbol.toPrimitive) {
          return createToPrimitiveHandler(path)
        }
        if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

        const newPath = [...path, String(prop)]
        return createProxy(newPath)
      },

      has(target, prop) {
        if (prop === `__refProxy` || prop === `__path` || prop === `__type`)
          return true
        return Reflect.has(target, prop)
      },

      ownKeys(target) {
        return Reflect.ownKeys(target)
      },

      getOwnPropertyDescriptor(target, prop) {
        if (prop === `__refProxy` || prop === `__path` || prop === `__type`) {
          return { enumerable: false, configurable: true }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    })

    cache.set(pathKey, proxy)
    return proxy
  }

  // Return the root proxy that starts with an empty path
  return createProxy([]) as SingleRowRefProxy<T>
}

/**
 * Creates a proxy object that records property access paths
 * Used in callbacks like where, select, etc. to create type-safe references
 */
export function createRefProxy<T extends Record<string, any>>(
  aliases: Array<string>,
): RefProxy<T> & T {
  const cache = new Map<string, any>()
  let accessId = 0 // Monotonic counter to record evaluation order

  function createProxy(path: Array<string>): any {
    const pathKey = path.join(`.`)
    if (cache.has(pathKey)) {
      return cache.get(pathKey)
    }

    const proxy = new Proxy({} as any, {
      get(target, prop, receiver) {
        if (prop === `__refProxy`) return true
        if (prop === `__path`) return path
        if (prop === `__type`) return undefined // Type is only for TypeScript inference
        // Intercept Symbol.toPrimitive to catch JS coercion attempts
        if (prop === Symbol.toPrimitive) {
          return createToPrimitiveHandler(path)
        }
        if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

        const newPath = [...path, String(prop)]
        return createProxy(newPath)
      },

      has(target, prop) {
        if (prop === `__refProxy` || prop === `__path` || prop === `__type`)
          return true
        return Reflect.has(target, prop)
      },

      ownKeys(target) {
        const id = ++accessId
        const sentinelKey = `__SPREAD_SENTINEL__${path.join(`.`)}__${id}`
        if (!Object.prototype.hasOwnProperty.call(target, sentinelKey)) {
          Object.defineProperty(target, sentinelKey, {
            enumerable: true,
            configurable: true,
            value: true,
          })
        }
        return Reflect.ownKeys(target)
      },

      getOwnPropertyDescriptor(target, prop) {
        if (prop === `__refProxy` || prop === `__path` || prop === `__type`) {
          return { enumerable: false, configurable: true }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    })

    cache.set(pathKey, proxy)
    return proxy
  }

  // Create the root proxy with all aliases as top-level properties
  const rootProxy = new Proxy({} as any, {
    get(target, prop, receiver) {
      if (prop === `__refProxy`) return true
      if (prop === `__path`) return []
      if (prop === `__type`) return undefined // Type is only for TypeScript inference
      // Intercept Symbol.toPrimitive to catch JS coercion attempts
      if (prop === Symbol.toPrimitive) {
        return createToPrimitiveHandler([])
      }
      if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

      const propStr = String(prop)
      if (aliases.includes(propStr)) {
        return createProxy([propStr])
      }

      return undefined
    },

    has(target, prop) {
      if (prop === `__refProxy` || prop === `__path` || prop === `__type`)
        return true
      if (typeof prop === `string` && aliases.includes(prop)) return true
      return Reflect.has(target, prop)
    },

    ownKeys(_target) {
      return [...aliases, `__refProxy`, `__path`, `__type`]
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop === `__refProxy` || prop === `__path` || prop === `__type`) {
        return { enumerable: false, configurable: true }
      }
      if (typeof prop === `string` && aliases.includes(prop)) {
        return { enumerable: true, configurable: true }
      }
      return undefined
    },
  })

  return rootProxy
}

/**
 * Creates a ref proxy with $selected namespace for SELECT fields
 *
 * Adds a $selected property that allows accessing SELECT fields via $selected.fieldName syntax.
 * The $selected proxy creates paths like ['$selected', 'fieldName'] which directly reference
 * the $selected property on the namespaced row.
 *
 * @param aliases - Array of table aliases to create proxies for
 * @returns A ref proxy with table aliases and $selected namespace
 */
export function createRefProxyWithSelected<T extends Record<string, any>>(
  aliases: Array<string>,
): RefProxy<T> & T & { $selected: SingleRowRefProxy<any> } {
  const baseProxy = createRefProxy(aliases)

  // Create a proxy for $selected that prefixes all paths with '$selected'
  const cache = new Map<string, any>()

  function createSelectedProxy(path: Array<string>): any {
    const pathKey = path.join(`.`)
    if (cache.has(pathKey)) {
      return cache.get(pathKey)
    }

    const proxy = new Proxy({} as any, {
      get(target, prop, receiver) {
        if (prop === `__refProxy`) return true
        if (prop === `__path`) return [`$selected`, ...path]
        if (prop === `__type`) return undefined
        // Intercept Symbol.toPrimitive to catch JS coercion attempts
        if (prop === Symbol.toPrimitive) {
          return createToPrimitiveHandler([`$selected`, ...path])
        }
        if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

        const newPath = [...path, String(prop)]
        return createSelectedProxy(newPath)
      },

      has(target, prop) {
        if (prop === `__refProxy` || prop === `__path` || prop === `__type`)
          return true
        return Reflect.has(target, prop)
      },

      ownKeys(target) {
        return Reflect.ownKeys(target)
      },

      getOwnPropertyDescriptor(target, prop) {
        if (prop === `__refProxy` || prop === `__path` || prop === `__type`) {
          return { enumerable: false, configurable: true }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    })

    cache.set(pathKey, proxy)
    return proxy
  }

  const wrappedSelectedProxy = createSelectedProxy([])

  // Wrap the base proxy to also handle $selected access
  return new Proxy(baseProxy, {
    get(target, prop, receiver) {
      if (prop === `$selected`) {
        return wrappedSelectedProxy
      }
      return Reflect.get(target, prop, receiver)
    },

    has(target, prop) {
      if (prop === `$selected`) return true
      return Reflect.has(target, prop)
    },

    ownKeys(target) {
      return [...Reflect.ownKeys(target), `$selected`]
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop === `$selected`) {
        return {
          enumerable: true,
          configurable: true,
          value: wrappedSelectedProxy,
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  }) as RefProxy<T> & T & { $selected: SingleRowRefProxy<any> }
}

/**
 * Converts a value to an Expression
 * If it's a RefProxy, creates a Ref, otherwise creates a Value
 */
export function toExpression<T = any>(value: T): BasicExpression<T>
export function toExpression(value: RefProxy<any>): BasicExpression<any>
export function toExpression(value: any): BasicExpression<any> {
  if (isRefProxy(value)) {
    return new PropRef(value.__path)
  }
  // If it's already an Expression (Func, Ref, Value) or Agg, return it directly
  if (
    value &&
    typeof value === `object` &&
    `type` in value &&
    (value.type === `func` ||
      value.type === `ref` ||
      value.type === `val` ||
      value.type === `agg`)
  ) {
    return value
  }
  return new Value(value)
}

/**
 * Type guard to check if a value is a RefProxy
 */
export function isRefProxy(value: any): value is RefProxy {
  return value && typeof value === `object` && value.__refProxy === true
}

/**
 * Helper to create a Value expression from a literal
 */
export function val<T>(value: T): BasicExpression<T> {
  return new Value(value)
}

/**
 * Checks a callback function's source code for JavaScript operators that
 * cannot be translated to query operations.
 *
 * Only runs in development mode (NODE_ENV !== 'production') and logs a warning
 * instead of throwing, since regex-based detection can have false positives
 * (e.g., operators inside regex literals).
 *
 * All detection logic is inside the dev check so bundlers can eliminate it
 * entirely from production builds.
 *
 * @param callback - The callback function to check
 *
 * @example
 * // This will log a warning in dev:
 * checkCallbackForJsOperators(({users}) => users.data || [])
 *
 * // This is fine:
 * checkCallbackForJsOperators(({users}) => users.data)
 */
export function checkCallbackForJsOperators<
  T extends (...args: Array<any>) => any,
>(callback: T): void {
  if (process.env.NODE_ENV !== `production`) {
    // Patterns that indicate JavaScript operators being used in query callbacks
    const JS_OPERATOR_PATTERNS = [
      { pattern: /\|\|/, operator: `||`, description: `logical OR` },
      { pattern: /&&/, operator: `&&`, description: `logical AND` },
      { pattern: /\?\?/, operator: `??`, description: `nullish coalescing` },
      {
        // Matches ? followed by : with something in between,
        // but not ?. (optional chaining) or ?? (nullish coalescing)
        pattern: /\?[^.?][^:]*:/,
        operator: `?:`,
        description: `ternary`,
      },
    ]

    const getHintForOperator = (operator: string): string => {
      switch (operator) {
        case `||`:
        case `??`:
          return `Use coalesce() instead: coalesce(value, defaultValue)`
        case `&&`:
          return `Use and() for logical conditions`
        case `?:`:
          return `Use cond() for conditional expressions: cond(condition, trueValue, falseValue)`
        default:
          return `Use the appropriate query function instead`
      }
    }

    // Strip string literals and comments to avoid false positives
    const cleanedSource = callback
      .toString()
      .replace(/`(?:[^`\\]|\\.)*`/g, `""`) // template literals
      .replace(/"(?:[^"\\]|\\.)*"/g, `""`) // double-quoted strings
      .replace(/'(?:[^'\\]|\\.)*'/g, `""`) // single-quoted strings
      .replace(/\/\/[^\n]*/g, ``) // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ``) // multi-line comments

    for (const { pattern, operator, description } of JS_OPERATOR_PATTERNS) {
      if (pattern.test(cleanedSource)) {
        console.warn(
          `[TanStack DB] JavaScript operator "${operator}" detected in query callback.\n\n` +
            `Found JavaScript ${description} operator (${operator}) in query callback.\n` +
            `This operator is evaluated at query construction time, not at query execution time,\n` +
            `which means it will not behave as expected.\n\n` +
            `${getHintForOperator(operator)}\n\n` +
            `Example of incorrect usage:\n` +
            `  .select(({users}) => ({ data: users.data || [] }))\n\n` +
            `Correct usage:\n` +
            `  .select(({users}) => ({ data: coalesce(users.data, []) }))`,
        )
        return // Only warn once per callback
      }
    }
  }
}
