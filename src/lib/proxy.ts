/**
 * A utility for creating a proxy that captures changes to an object
 * and provides a way to retrieve those changes.
 */

type ChangeTracker<T> = {
  changes: Record<string | symbol, unknown>
  originalObject: T
  modified: boolean
  copy_?: T
  assigned_: Record<string | symbol, boolean>
  parent?: {
    tracker: ChangeTracker<unknown>
    prop: string | symbol
  }
}

/**
 * Deep clones an object while preserving special types like Date and RegExp
 */
function deepClone<T>(obj: T, visited = new WeakMap<object, unknown>()): T {
  if (obj === null || typeof obj !== `object`) {
    return obj
  }

  // Handle circular references
  if (visited.has(obj as object)) {
    return visited.get(obj as object)
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as unknown as T
  }

  let clone: unknown

  if (Array.isArray(obj)) {
    clone = []
    visited.set(obj as object, clone)
    obj.forEach((item, index) => {
      clone[index] = deepClone(item, visited)
    })
    return clone as T
  }

  if (obj instanceof Map) {
    clone = new Map()
    visited.set(obj as object, clone)
    obj.forEach((value, key) => {
      clone.set(key, deepClone(value, visited))
    })
    return clone as unknown as T
  }

  if (obj instanceof Set) {
    clone = new Set()
    visited.set(obj as object, clone)
    obj.forEach((value) => {
      clone.add(deepClone(value, visited))
    })
    return clone as unknown as T
  }

  clone = {} as Record<string | symbol, unknown>
  visited.set(obj as object, clone)

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      clone[key] = deepClone(
        (obj as Record<string | symbol, unknown>)[key],
        visited
      )
    }
  }

  const symbolProps = Object.getOwnPropertySymbols(obj)
  for (const sym of symbolProps) {
    clone[sym] = deepClone(
      (obj as Record<string | symbol, unknown>)[sym],
      visited
    )
  }

  return clone as T
}

/**
 * Deep equality check that handles special types like Date, RegExp, Map, and Set
 */
function deepEqual<T>(a: T, b: T): boolean {
  // Handle primitive types
  if (a === b) return true

  // If either is null or not an object, they're not equal
  if (
    a === null ||
    b === null ||
    typeof a !== `object` ||
    typeof b !== `object`
  ) {
    return false
  }

  // Handle Date objects
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  // Handle RegExp objects
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags
  }

  // Handle Map objects
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false

    for (const [key, val] of a.entries()) {
      if (!b.has(key) || !deepEqual(val, b.get(key))) {
        return false
      }
    }

    return true
  }

  // Handle Set objects
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false

    // Convert to arrays for comparison
    const aValues = Array.from(a)
    const bValues = Array.from(b)

    // Simple comparison for primitive values
    if (aValues.every((val) => typeof val !== `object`)) {
      return aValues.every((val) => b.has(val))
    }

    // For objects in sets, we need to do a more complex comparison
    // This is a simplified approach and may not work for all cases
    return aValues.length === bValues.length
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false

    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }

    return true
  }

  // Handle plain objects
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)

  if (keysA.length !== keysB.length) return false

  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as unknown)[key], (b as unknown)[key])
  )
}

/**
 * Creates a proxy that tracks changes to the target object
 *
 * @param target The object to proxy
 * @param parent Optional parent information
 * @returns An object containing the proxy and a function to get the changes
 */
export function createChangeProxy<T extends object>(
  target: T,
  parent?: { tracker: ChangeTracker<unknown>; prop: string | symbol }
): {
  proxy: T
  getChanges: () => Record<string | symbol, unknown>
} {
  // Create a WeakMap to cache proxies for nested objects
  // This prevents creating multiple proxies for the same object
  // and handles circular references
  const proxyCache = new WeakMap<object, object>()

  // Create a change tracker to track changes to the object
  const changeTracker: ChangeTracker<T> = {
    changes: {},
    originalObject: deepClone(target),
    modified: false,
    assigned_: {},
    parent,
  }

  // Mark this object and all its ancestors as modified
  function markChanged(state: ChangeTracker<unknown>) {
    if (!state.modified) {
      state.modified = true

      // Propagate the change up the parent chain
      if (state.parent) {
        markChanged(state.parent.tracker)
      }
    }
  }

  // Create a proxy for the target object
  function createObjectProxy<U extends object>(obj: U): U {
    // If we've already created a proxy for this object, return it
    if (proxyCache.has(obj)) {
      return proxyCache.get(obj) as U
    }

    // Create a proxy for the object
    const proxy = new Proxy(obj, {
      get(target, prop) {
        const value = target[prop as keyof U]

        // If it's a getter, return the value directly
        const desc = Object.getOwnPropertyDescriptor(target, prop)
        if (desc?.get) {
          return value
        }

        // If the value is a function, bind it to the target
        if (typeof value === `function`) {
          // For Map and Set methods that modify the collection
          if (target instanceof Map || target instanceof Set) {
            const methodName = prop.toString()
            const modifyingMethods = new Set([
              `set`,
              `delete`,
              `clear`,
              `add`,
              `pop`,
              `push`,
              `shift`,
              `unshift`,
              `splice`,
              `sort`,
              `reverse`,
            ])

            if (modifyingMethods.has(methodName)) {
              return function (...args: unknown[]) {
                const result = value.apply(target, args)
                markChanged(changeTracker)
                return result
              }
            }
          }
          return value.bind(target)
        }

        // If the value is an object, create a proxy for it
        if (
          value &&
          typeof value === `object` &&
          !(value instanceof Date) &&
          !(value instanceof RegExp)
        ) {
          // Create a parent reference for the nested object
          const nestedParent = {
            tracker: changeTracker,
            prop: String(prop),
          }

          // Create a proxy for the nested object
          const { proxy: nestedProxy } = createChangeProxy(value, nestedParent)

          // Cache the proxy
          proxyCache.set(value, nestedProxy)

          return nestedProxy
        }

        return value
      },

      set(obj, prop, value) {
        const stringProp = String(prop)
        const currentValue = obj[prop as keyof U]

        // Special handling for array length changes
        if (Array.isArray(obj) && prop === `length`) {
          const newLength = Number(value)
          const oldLength = obj.length

          // Create a new array with the desired length
          const newArray = Array.from({ length: newLength }, (_, i) =>
            i < oldLength ? obj[i] : undefined
          )

          // Track the change in the parent object since 'arr' is the property name
          if (parent) {
            parent.tracker.changes[parent.prop] = newArray
            parent.tracker.assigned_[parent.prop] = true
            markChanged(parent.tracker)
          }

          // Update the original array
          obj.length = newLength
          return true
        }

        // Only track the change if the value is actually different
        if (!deepEqual(currentValue, value)) {
          // Check if the new value is equal to the original value
          const originalValue = changeTracker.originalObject[prop as keyof T]
          const isRevertToOriginal = deepEqual(value, originalValue)

          if (isRevertToOriginal) {
            // If the value is reverted to its original state, remove it from changes
            delete changeTracker.changes[stringProp]
            delete changeTracker.assigned_[stringProp]

            // Check if there are still any changes
            const hasRemainingChanges =
              Object.keys(changeTracker.assigned_).length > 0

            // Only update modified status if we're not a nested property of another object
            if (!hasRemainingChanges && !parent) {
              changeTracker.modified = false
            }
          } else {
            // Create a copy of the object if it doesn't exist
            prepareCopy(changeTracker)

            // Set the value on the copy
            if (changeTracker.copy_) {
              changeTracker.copy_[prop as keyof T] = value
            }

            // Set the value on the original object
            obj[prop as keyof U] = value

            // Track that this property was assigned
            changeTracker.assigned_[stringProp] = true

            // Track the change - handle both normal and symbol properties
            if (typeof prop === `symbol`) {
              changeTracker.changes[prop as unknown as string] =
                deepClone(value)
            } else {
              changeTracker.changes[stringProp] = deepClone(value)
            }

            // Mark this object and its ancestors as modified
            markChanged(changeTracker)
          }
        }

        return true
      },

      defineProperty(target, prop, descriptor) {
        const stringProp = String(prop)

        // Define the property on the target
        const result = Object.defineProperty(target, prop, descriptor)

        if (result) {
          // Track the change if the property has a value
          if (`value` in descriptor) {
            changeTracker.changes[stringProp] = deepClone(descriptor.value)
            changeTracker.assigned_[stringProp] = true
            markChanged(changeTracker)
          }
        }

        return result
      },

      setPrototypeOf(target, proto) {
        // Allow setting prototype but don't track it as a change
        return Object.setPrototypeOf(target, proto)
      },

      deleteProperty(obj, prop) {
        const stringProp = String(prop)

        if (stringProp in obj) {
          // Check if the property exists in the original object
          const hadPropertyInOriginal =
            stringProp in changeTracker.originalObject

          // Create a copy of the object if it doesn't exist
          prepareCopy(changeTracker)

          // Delete the property from the copy
          if (changeTracker.copy_) {
            delete changeTracker.copy_[prop as keyof T]
          }

          // Delete the property from the original object
          delete obj[prop as keyof U]

          // If the property didn't exist in the original object, removing it
          // should revert to the original state
          if (!hadPropertyInOriginal) {
            delete changeTracker.changes[stringProp]
            delete changeTracker.assigned_[stringProp]

            // If this is the last change and we're not a nested object,
            // mark the object as unmodified
            if (Object.keys(changeTracker.assigned_).length === 0 && !parent) {
              changeTracker.modified = false
            }
          } else {
            // Mark this property as deleted
            changeTracker.assigned_[stringProp] = false
            changeTracker.changes[stringProp] = undefined
            markChanged(changeTracker)
          }
        }

        return true
      },
    })

    // Cache the proxy
    proxyCache.set(obj, proxy)

    return proxy as U
  }

  // Create a proxy for the target object
  const proxy = createObjectProxy(target)

  // Return the proxy and a function to get the changes
  return {
    proxy,
    getChanges: () => {
      // If there are assigned properties, return the changes
      if (Object.keys(changeTracker.assigned_).length > 0) {
        // If we have a copy, use it to construct the changes
        if (changeTracker.copy_) {
          const changes: Record<string | symbol, unknown> = {}

          // Add all assigned properties
          for (const key in changeTracker.assigned_) {
            if (changeTracker.assigned_[key] === true) {
              // Property was assigned
              changes[key] = deepClone(changeTracker.copy_[key as keyof T])
            } else if (changeTracker.assigned_[key] === false) {
              // Property was deleted
              changes[key] = undefined
            }
          }

          // Handle symbol properties
          const symbolProps = Object.getOwnPropertySymbols(changeTracker.copy_)
          for (const sym of symbolProps) {
            changes[sym] = deepClone(changeTracker.copy_[sym as keyof T])
          }

          return changes
        }

        // Fall back to the existing changes object if no copy exists
        return changeTracker.changes
      }

      // If the object is modified but has no direct changes (nested changes),
      // and we're the root object, return the full object
      if (changeTracker.modified && !parent) {
        return changeTracker.copy_
          ? deepClone(changeTracker.copy_)
          : deepClone(target)
      }

      // No changes
      return {}
    },
  }
}

/**
 * Creates proxies for an array of objects and tracks changes to each
 *
 * @param targets Array of objects to proxy
 * @returns An object containing the array of proxies and a function to get all changes
 */
export function createArrayChangeProxy<T extends object>(
  targets: T[]
): {
  proxies: T[]
  getChanges: () => Record<string | symbol, unknown>[]
} {
  const proxiesWithChanges = targets.map((target) => createChangeProxy(target))

  return {
    proxies: proxiesWithChanges.map((p) => p.proxy),
    getChanges: () => proxiesWithChanges.map((p) => p.getChanges()),
  }
}

/**
 * Creates a proxy for an object, passes it to a callback function,
 * and returns the changes made by the callback
 *
 * @param target The object to proxy
 * @param callback Function that receives the proxy and can make changes to it
 * @returns The changes made to the object
 */
export function withChangeTracking<T extends object>(
  target: T,
  callback: (proxy: T) => void
): Record<string | symbol, unknown> {
  const { proxy, getChanges } = createChangeProxy(target)

  callback(proxy)

  return getChanges()
}

/**
 * Creates proxies for an array of objects, passes them to a callback function,
 * and returns the changes made by the callback for each object
 *
 * @param targets Array of objects to proxy
 * @param callback Function that receives the proxies and can make changes to them
 * @returns Array of changes made to each object
 */
export function withArrayChangeTracking<T extends object>(
  targets: T[],
  callback: (proxies: T[]) => void
): Record<string | symbol, unknown>[] {
  const { proxies, getChanges } = createArrayChangeProxy(targets)

  callback(proxies)

  return getChanges()
}

/**
 * Creates a shallow copy of the target object if it doesn't already exist
 */
function prepareCopy<T>(state: ChangeTracker<T>) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(state.originalObject)
  }
}

/**
 * Creates a shallow copy of an object
 */
function shallowCopy<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return [...obj] as unknown as T
  }

  if (obj instanceof Map) {
    return new Map(obj) as unknown as T
  }

  if (obj instanceof Set) {
    return new Set(obj) as unknown as T
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as unknown as T
  }

  if (obj !== null && typeof obj === `object`) {
    return { ...obj } as T
  }

  return obj
}
