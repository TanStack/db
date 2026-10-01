import { PropRef, Value, isBasicOrAggregateExpression } from '../ir.js'
import { REF_PROXY_BRAND, isRefProxy } from './ref-proxy-identity.js'
import { getWrapperExpressionName } from './wrapper-identity.js'
import type { BasicExpression } from '../ir.js'
import type { IsPlainObject, RefLeaf } from './types.js'
import type { VirtualRowProps } from '../../virtual-props.js'

export { isRefProxy } from './ref-proxy-identity.js'

export interface RefProxy<T = any> {
  /** @internal */
  readonly __refProxy: true
  /** @internal */
  readonly __path: Array<string>
  /** @internal */
  readonly __sourceAlias?: string
  /** @internal */
  readonly __type: T
}

/**
 * Virtual properties available on all row ref proxies.
 * These allow querying on sync status, origin, key, and collection ID.
 */
export type VirtualPropsRefProxy<
  TKey extends string | number = string | number,
> = {
  readonly [K in keyof VirtualRowProps<TKey>]: RefLeaf<VirtualRowProps<TKey>[K]>
}

// Strip nullish members before deciding whether a schema field is traversable,
// then restore them outside the proxy so the schema still requires a guard.
// The tuple guard keeps exact null/undefined fields as leaves: `never` would
// otherwise satisfy the plain-object check.
type SingleRowField<V, TKey extends string | number> = [
  NonNullable<V>,
] extends [never]
  ? RefLeaf<V>
  : IsPlainObject<NonNullable<V>> extends true
    ?
        | SingleRowRefProxy<NonNullable<V>, TKey, false>
        | Extract<V, null | undefined>
    : RefLeaf<V>

/**
 * Type for creating a RefProxy for a single row/type without namespacing
 * Used in collection indexes and where clauses
 *
 * Inferred row roots include virtual properties ($synced, $origin, $key,
 * $collectionId). The default exported shape is suitable for reusable helpers
 * that can accept either roots or recursively traversed user objects. Use the
 * third parameter as `true` when a helper specifically requires a row root.
 */
export type SingleRowRefProxy<
  T,
  TKey extends string | number = string | number,
  IncludeVirtualProps extends boolean = false,
> =
  T extends Record<string, any>
    ? {
        [K in keyof T]: SingleRowField<T[K], TKey>
      } & RefProxy<T> &
        (IncludeVirtualProps extends true ? VirtualPropsRefProxy<TKey> : {})
    : RefProxy<T> &
        (IncludeVirtualProps extends true ? VirtualPropsRefProxy<TKey> : {})

/**
 * Creates a proxy object that records property access paths for a single row
 * Used in collection indexes and where clauses
 */
export function createSingleRowRefProxy<
  T extends Record<string, any>,
  TKey extends string | number = string | number,
>(): SingleRowRefProxy<T, TKey, true> {
  const cache = new Map<string, any>()

  function createProxy(path: Array<string>): any {
    const pathKey = JSON.stringify(path)
    if (cache.has(pathKey)) {
      return cache.get(pathKey)
    }

    const proxy = new Proxy({} as any, {
      get(target, prop, receiver) {
        if (prop === `__refProxy`) return true
        if (prop === `__path`) return path
        if (prop === `__sourceAlias`) return undefined
        if (prop === `__type`) return undefined // Type is only for TypeScript inference
        if (prop === REF_PROXY_BRAND) return true
        if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

        const newPath = [...path, String(prop)]
        return createProxy(newPath)
      },

      has(target, prop) {
        if (
          prop === `__refProxy` ||
          prop === `__path` ||
          prop === `__sourceAlias` ||
          prop === `__type`
        )
          return true
        return Reflect.has(target, prop)
      },

      ownKeys(target) {
        return Reflect.ownKeys(target)
      },

      getOwnPropertyDescriptor(target, prop) {
        if (
          prop === `__refProxy` ||
          prop === `__path` ||
          prop === `__sourceAlias` ||
          prop === `__type`
        ) {
          return { enumerable: false, configurable: true }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    })
    cache.set(pathKey, proxy)
    return proxy
  }

  // Return the root proxy that starts with an empty path
  return createProxy([]) as SingleRowRefProxy<T, TKey, true>
}

/**
 * Creates a proxy object that records property access paths
 * Used in callbacks like where, select, etc. to create type-safe references
 */
export function createRefProxy<T extends Record<string, any>>(
  aliases: Array<string>,
): RefProxy<T> & T {
  // Each path has one proxy, cached by its parent under the property name.
  const aliasProxies = new Map<string, any>()
  let accessId = 0 // Monotonic counter to record evaluation order

  function createProxy(path: Array<string>): any {
    let children: Map<string, any> | undefined
    const proxy = new Proxy({} as any, {
      get(target, prop, receiver) {
        if (prop === `__refProxy`) return true
        if (prop === `__path`) return path
        if (prop === `__sourceAlias`) return path[0]
        if (prop === `__type`) return undefined // Type is only for TypeScript inference
        if (prop === REF_PROXY_BRAND) return true
        if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

        children ??= new Map()
        let child = children.get(prop)
        if (child === undefined) {
          child = createProxy([...path, prop])
          children.set(prop, child)
        }
        return child
      },

      has(target, prop) {
        if (
          prop === `__refProxy` ||
          prop === `__path` ||
          prop === `__sourceAlias` ||
          prop === `__type`
        )
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
        if (
          prop === `__refProxy` ||
          prop === `__path` ||
          prop === `__sourceAlias` ||
          prop === `__type`
        ) {
          return { enumerable: false, configurable: true }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    })
    return proxy
  }

  // Create the root proxy with all aliases as top-level properties
  const rootProxy = new Proxy({} as any, {
    get(target, prop, receiver) {
      if (prop === `__refProxy`) return true
      if (prop === `__path`) return []
      if (prop === `__sourceAlias`) return undefined
      if (prop === `__type`) return undefined // Type is only for TypeScript inference
      if (prop === REF_PROXY_BRAND) return true
      if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

      const propStr = String(prop)
      if (aliases.includes(propStr) || aliases.includes(`*`)) {
        let proxy = aliasProxies.get(propStr)
        if (proxy === undefined) {
          proxy = createProxy([propStr])
          aliasProxies.set(propStr, proxy)
        }
        return proxy
      }

      return undefined
    },

    has(target, prop) {
      if (
        prop === `__refProxy` ||
        prop === `__path` ||
        prop === `__sourceAlias` ||
        prop === `__type`
      )
        return true
      if (typeof prop === `string` && aliases.includes(prop)) return true
      return Reflect.has(target, prop)
    },

    ownKeys(_target) {
      return [...aliases, `__refProxy`, `__path`, `__sourceAlias`, `__type`]
    },

    getOwnPropertyDescriptor(target, prop) {
      if (
        prop === `__refProxy` ||
        prop === `__path` ||
        prop === `__sourceAlias` ||
        prop === `__type`
      ) {
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
): RefProxy<T> &
  T & { $selected: SingleRowRefProxy<any, string | number, true> } {
  const baseProxy = createRefProxy(aliases)

  // Create a proxy for $selected that prefixes all paths with '$selected'
  const cache = new Map<string, any>()

  function createSelectedProxy(path: Array<string>): any {
    const pathKey = JSON.stringify(path)
    if (cache.has(pathKey)) {
      return cache.get(pathKey)
    }

    const proxy = new Proxy({} as any, {
      get(target, prop, receiver) {
        if (prop === `__refProxy`) return true
        if (prop === `__path`) return [`$selected`, ...path]
        if (prop === `__sourceAlias`) return `$selected`
        if (prop === `__type`) return undefined
        if (prop === REF_PROXY_BRAND) return true
        if (typeof prop === `symbol`) return Reflect.get(target, prop, receiver)

        const newPath = [...path, String(prop)]
        return createSelectedProxy(newPath)
      },

      has(target, prop) {
        if (
          prop === `__refProxy` ||
          prop === `__path` ||
          prop === `__sourceAlias` ||
          prop === `__type`
        )
          return true
        return Reflect.has(target, prop)
      },

      ownKeys(target) {
        return Reflect.ownKeys(target)
      },

      getOwnPropertyDescriptor(target, prop) {
        if (
          prop === `__refProxy` ||
          prop === `__path` ||
          prop === `__sourceAlias` ||
          prop === `__type`
        ) {
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
  const selectedRootProxy = new Proxy(baseProxy, {
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
  }) as RefProxy<T> &
    T & {
      $selected: SingleRowRefProxy<any, string | number, true>
    }
  return selectedRootProxy
}

/**
 * Converts a value to an Expression.
 * If it's a RefProxy, creates a PropRef. Throws if the value is a
 * ToArrayWrapper, ConcatToArrayWrapper, CaseWhenWrapper, or MaterializeWrapper
 * (these must be used as direct select fields). Otherwise wraps it as a Value.
 */
export function toExpression<T = any>(value: T): BasicExpression<T>
export function toExpression(value: RefProxy<any>): BasicExpression<any>
export function toExpression(value: any): BasicExpression<any> {
  if (isRefProxy(value)) {
    return new PropRef(value.__path, value.__sourceAlias)
  }
  // toArray(), concat(toArray()), and materialize() must be used as direct
  // select fields, not inside expressions
  const name = getWrapperExpressionName(value)
  if (name) {
    throw new Error(
      `${name} cannot be used inside expressions (e.g., coalesce(), eq(), not()). ` +
        `Use ${name} directly as a select field value instead.`,
    )
  }
  // Only constructed expressions are IR; user values may have the same fields.
  if (isBasicOrAggregateExpression(value)) {
    return value as BasicExpression
  }
  return new Value(value)
}

/**
 * Helper to create a Value expression from a literal
 */
export function val<T>(value: T): BasicExpression<T> {
  return new Value(value)
}
