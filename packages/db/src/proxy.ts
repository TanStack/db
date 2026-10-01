/**
 * A utility for creating a proxy that captures changes to an object
 * and provides a way to retrieve those changes.
 */

import { deepEqualsInternal, isTemporal } from './utils'

// Resolve draft handles before calling native Map/Set membership methods.
const draftCopies = new WeakMap<object, object>()
function defineDataProperty(
  object: object,
  key: PropertyKey,
  value: unknown,
): void {
  if (key !== `__proto__`) {
    ;(object as Record<PropertyKey, unknown>)[key] = value
    return
  }
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function unwrapDraft(value: unknown): unknown {
  return value !== null && typeof value === `object`
    ? (draftCopies.get(value) ?? value)
    : value
}

/**
 * Set of array methods that iterate with callbacks and may return elements.
 * Hoisted to module scope to avoid creating a new Set on every property access.
 */
const CALLBACK_ITERATION_METHODS = new Set([
  `find`,
  `findLast`,
  `findIndex`,
  `findLastIndex`,
  `filter`,
  `map`,
  `flatMap`,
  `forEach`,
  `some`,
  `every`,
  `reduce`,
  `reduceRight`,
])

/**
 * Set of array methods that modify the array in place.
 */
const ARRAY_MODIFYING_METHODS = new Set([
  `pop`,
  `push`,
  `shift`,
  `unshift`,
  `splice`,
  `sort`,
  `reverse`,
  `fill`,
  `copyWithin`,
])

/**
 * Set of Map/Set iterator methods.
 */
const MAP_SET_ITERATOR_METHODS = new Set([
  `entries`,
  `keys`,
  `values`,
  `forEach`,
])

/**
 * Check if a value is a proxiable object (not Date, RegExp, or Temporal)
 */
function isProxiableObject(
  value: unknown,
): value is Record<string | symbol, unknown> {
  return (
    value !== null &&
    typeof value === `object` &&
    !((value as any) instanceof Date) &&
    !((value as any) instanceof RegExp) &&
    !isTemporal(value)
  )
}

/**
 * Creates a wrapper for methods that modify a collection (array, Map, Set).
 * The wrapper calls the method and marks the change tracker as modified.
 */
function createModifyingMethodHandler<T extends object>(
  methodFn: (...args: Array<unknown>) => unknown,
  changeTracker: ChangeTracker<T>,
  markChanged: (tracker: ChangeTracker<T>) => void,
): (...args: Array<unknown>) => unknown {
  return function (...args: Array<unknown>) {
    const result = methodFn.apply(changeTracker.copy_, args)
    markChanged(changeTracker)
    return result
  }
}

/**
 * Use the native live iterator, but expose tracked values. Editing an entry
 * changes its owned draft copy in place; it must not delete/reinsert a Set slot.
 */
function createMapSetIteratorHandler<T extends object>(
  methodName: string,
  prop: string | symbol,
  changeTracker: ChangeTracker<T>,
  collectionProxy: unknown,
  memoizedCreateChangeProxy: (
    obj: Record<string | symbol, unknown>,
    parent?: ChangeParent,
  ) => { proxy: Record<string | symbol, unknown> },
): ((...args: Array<unknown>) => unknown) | undefined {
  if (!MAP_SET_ITERATOR_METHODS.has(methodName) && prop !== Symbol.iterator) {
    return undefined
  }

  return (...args) => {
    const copy = changeTracker.copy_ as Map<unknown, unknown> | Set<unknown>
    const isMap = copy instanceof Map
    if (isMap && methodName === `keys`) return copy.keys()

    const track = (value: unknown) =>
      isProxiableObject(value)
        ? memoizedCreateChangeProxy(value, {
            tracker: changeTracker as unknown as ChangeTracker<
              Record<string | symbol, unknown>
            >,
            prop: ``,
            retainIdentity: true,
          }).proxy
        : value

    if (methodName === `forEach`) {
      const callback = args[0]
      if (typeof callback !== `function`)
        throw new TypeError(`forEach callback must be a function`)
      return copy.forEach((value, key) => {
        const tracked = track(value)
        callback.call(args[1], tracked, isMap ? key : tracked, collectionProxy)
      })
    }

    const entries = copy.entries()
    const pairs =
      methodName === `entries` || (isMap && prop === Symbol.iterator)
    return {
      next() {
        const result = entries.next()
        if (result.done) return result
        const [key, value] = result.value
        const tracked = track(value)
        return {
          done: false,
          value: pairs ? [isMap ? key : tracked, tracked] : tracked,
        }
      },
      [Symbol.iterator]() {
        return this
      },
    }
  }
}

// Update type for ChangeTracker
interface ChangeParent {
  tracker: ChangeTracker<Record<string | symbol, unknown>>
  prop: string | symbol
  // Map/Set entries already belong to the parent's private copy.
  retainIdentity?: boolean
}

interface ChangeTracker<T extends object> {
  valueCopies: WeakMap<object, unknown>
  originalObject: T
  modified: boolean
  copy_: T
  assigned_: Record<string | symbol, boolean>
  parent?: ChangeParent
  target: T
}

/**
 * Deep clones an object while preserving special types like Date and RegExp
 */

interface TypedArray {
  length: number
  [index: number]: number
}

function deepClone<T extends unknown>(
  obj: T,
  visited = new WeakMap<object, unknown>(),
  detach = false,
): T {
  // A draft handle and its underlying copy must share one cycle identity.
  obj = unwrapDraft(obj) as T
  // Handle null and undefined
  if (obj === null || obj === undefined) {
    return obj
  }

  // Handle primitive types
  if (typeof obj !== `object`) {
    return obj
  }

  // If we've already cloned this object, return the cached clone
  if (visited.has(obj as object)) {
    return visited.get(obj as object) as T
  }

  if (obj instanceof Date) {
    const clone = new Date(obj.getTime())
    visited.set(obj, clone)
    return clone as T
  }

  if (obj instanceof RegExp) {
    const clone = new RegExp(obj.source, obj.flags)
    clone.lastIndex = obj.lastIndex
    visited.set(obj, clone)
    return clone as T
  }

  if (obj instanceof URL) {
    const clone = new URL(obj.href)
    visited.set(obj, clone)
    return clone as T
  }

  if (Array.isArray(obj)) {
    const arrayClone = new Array<unknown>(obj.length)
    visited.set(obj as object, arrayClone)
    obj.forEach((item, index) => {
      arrayClone[index] = deepClone(item, visited, detach)
    })
    return arrayClone as unknown as T
  }

  // Handle TypedArrays
  if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    // Create an instance of the same type by length, then copy the values.
    // A subclass constructor need not forward a source array to super.
    const TypedArrayConstructor = Object.getPrototypeOf(obj).constructor
    const clone = new TypedArrayConstructor(
      (obj as unknown as TypedArray).length,
    ) as unknown as TypedArray
    visited.set(obj as object, clone)
    for (let i = 0; i < (obj as unknown as TypedArray).length; i++) {
      clone[i] = (obj as unknown as TypedArray)[i]!
    }
    return clone as unknown as T
  }

  if (obj instanceof Map) {
    const clone = new Map() as Map<unknown, unknown>
    visited.set(obj as object, clone)
    obj.forEach((value, key) => {
      clone.set(key, deepClone(value, visited, detach))
    })
    return clone as unknown as T
  }

  if (obj instanceof Set) {
    const clone = new Set()
    visited.set(obj as object, clone)
    obj.forEach((value) => {
      clone.add(deepClone(value, visited, detach))
    })
    return clone as unknown as T
  }

  // Handle Temporal objects
  if (isTemporal(obj)) {
    // Temporal objects are immutable, so we can return them directly
    // This preserves all their internal state correctly
    return obj
  }

  // Arbitrary instances may carry private/native state we cannot reconstruct.
  // Keep them by reference at publication, rather than silently flattening them.
  if (detach) {
    const prototype = Object.getPrototypeOf(obj)
    if (prototype !== Object.prototype && prototype !== null) return obj
  }

  const clone = {} as Record<string | symbol, unknown>
  visited.set(obj as object, clone)

  // Own enumerable string keys, then every own symbol key, in native order.
  // A Reflect.ownKeys loop with an enumerability check is shorter but slower
  // on this hot path.
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // Copy data properties without invoking Object.prototype.__proto__.
      defineDataProperty(
        clone,
        key,
        deepClone(
          (obj as Record<string | symbol, unknown>)[key],
          visited,
          detach,
        ),
      )
    }
  }

  for (const sym of Object.getOwnPropertySymbols(obj)) {
    clone[sym] = deepClone(
      (obj as Record<string | symbol, unknown>)[sym],
      visited,
      detach,
    )
  }

  return clone as T
}

// Generic value equality intentionally ignores some native state. Draft
// assignments must also preserve Set contents/order and RegExp match position.
function draftValuesEqual(
  left: unknown,
  right: unknown,
  paired = new Map<object, object>(),
): boolean {
  return deepEqualsInternal(left, right, paired, true)
}

/**
 * Creates a proxy that tracks changes to the target object
 *
 * @param target The object to proxy
 * @param parent Optional parent information
 * @returns An object containing the proxy and a function to get the changes
 */
export function createChangeProxy<
  T extends Record<string | symbol, any | undefined>,
>(
  target: T,
  parent?: ChangeParent,
): {
  proxy: T

  getChanges: () => Record<string | symbol, any>
} {
  const changeProxyCache = new Map<object, object>()

  function memoizedCreateChangeProxy<
    TInner extends Record<string | symbol, any | undefined>,
  >(
    innerTarget: TInner,
    innerParent?: ChangeParent,
  ): {
    proxy: TInner
    getChanges: () => Record<string | symbol, any>
  } {
    if (changeProxyCache.has(innerTarget)) {
      return changeProxyCache.get(innerTarget) as {
        proxy: TInner
        getChanges: () => Record<string | symbol, any>
      }
    } else {
      const changeProxy = createChangeProxy(innerTarget, innerParent)
      changeProxyCache.set(innerTarget, changeProxy)
      return changeProxy
    }
  }
  // Existing values share one private copy per row. Newly inserted objects
  // retain normal references during the callback; the result is detached below.
  const valueCopies =
    parent?.tracker.valueCopies ?? new WeakMap<object, unknown>()
  const changeTracker: ChangeTracker<T> = {
    valueCopies,
    copy_: parent
      ? ((valueCopies.get(target) ?? target) as T)
      : deepClone(target, valueCopies),
    originalObject: deepClone(target),
    modified: false,
    assigned_: Object.create(null),
    parent,
    target, // Store reference to the target object
  }

  // Mark this object and all its ancestors as modified
  // Also propagate the actual changes up the chain
  function markChanged(state: ChangeTracker<object>) {
    if (!state.modified) {
      state.modified = true
    }

    // Propagate the change up the parent chain
    if (state.parent) {
      if (
        !state.parent.retainIdentity &&
        state.parent.tracker.copy_[state.parent.prop] === state.copy_
      ) {
        // Only mark an edge that still points to this child. A retained handle
        // must not reinstall itself after the callback replaces or deletes it.
        state.parent.tracker.assigned_[state.parent.prop] = true
      }

      // Mark parent as changed
      markChanged(state.parent.tracker)
    }
  }

  // Check if all properties in the current state have reverted to original values.
  // assigned_ keys are always strings: traps record `prop.toString()`.
  function checkIfReverted(
    state: ChangeTracker<Record<string | symbol, unknown>>,
  ): boolean {
    if (state.copy_ instanceof Map || state.copy_ instanceof Set) {
      // Compare entry contents: these containers have no assigned properties.
      return draftValuesEqual(
        Array.from(state.copy_),
        Array.from(
          state.originalObject as unknown as
            | Map<unknown, unknown>
            | Set<unknown>,
        ),
      )
    }
    for (const prop in state.assigned_) {
      // false marks a deletion, which always differs from the original. A key
      // added with the value undefined differs from an absent key.
      if (
        !state.assigned_[prop] ||
        Object.hasOwn(state.copy_, prop) !==
          Object.hasOwn(state.originalObject, prop) ||
        !draftValuesEqual(
          state.copy_[prop],
          (state.originalObject as any)[prop],
        )
      ) {
        return false
      }
    }
    return true
  }

  // Update parent status based on child changes
  function checkParentStatus(
    parentState: ChangeTracker<Record<string | symbol, unknown>>,
  ) {
    // Check if all properties of the parent are reverted
    const isReverted = checkIfReverted(parentState)

    if (isReverted) {
      // If everything is reverted, clear the tracking
      parentState.modified = false
      parentState.assigned_ = Object.create(null)

      // Continue up the chain. The parent's edge to this object no longer
      // counts as a change when the parent's value equals its original; a
      // replaced object can revert to its own snapshot and still differ.
      const edge = parentState.parent
      if (edge) {
        if (
          draftValuesEqual(
            edge.tracker.copy_[edge.prop],
            edge.tracker.originalObject[edge.prop],
          )
        )
          delete edge.tracker.assigned_[edge.prop]
        checkParentStatus(edge.tracker)
      }
    }
  }

  // Create a proxy for the target object.
  // Use the unfrozen copy_ as the proxy target to avoid Proxy invariant violations
  // when the original target is frozen (e.g., from Immer)
  const proxy = new Proxy(changeTracker.copy_, {
    get(ptarget, prop, receiver) {
      const value = changeTracker.copy_[prop as keyof T]

      // If it's a getter, return the value directly
      const desc = Object.getOwnPropertyDescriptor(ptarget, prop)
      if (desc?.get) {
        return value
      }

      // If the value is a function, bind it to the ptarget
      if (typeof value === `function`) {
        // A function stored as data is returned as stored, like any value. A
        // call then sees the draft as `this`, so its writes are tracked. Only
        // inherited methods (Array, Map, Set) need the handling below.
        if (Object.hasOwn(ptarget, prop)) return value

        // For Array methods that modify the array
        if (Array.isArray(ptarget)) {
          const methodName = prop.toString()

          if (ARRAY_MODIFYING_METHODS.has(methodName)) {
            return createModifyingMethodHandler(
              value,
              changeTracker,
              markChanged,
            )
          }

          // Native callbacks and iterators read through the draft itself.
          // This also tracks the callback array and implicit reduce seed.
          if (
            CALLBACK_ITERATION_METHODS.has(methodName) ||
            methodName === `values` ||
            methodName === `entries` ||
            prop === Symbol.iterator
          ) {
            return value.bind(receiver)
          }
        }

        // For Map and Set methods that modify the collection
        if (ptarget instanceof Map || ptarget instanceof Set) {
          const methodName = prop.toString()

          const resolveValue = (entry: unknown) => {
            const raw = unwrapDraft(entry)
            return raw !== null && typeof raw === `object`
              ? (valueCopies.get(raw) ?? raw)
              : raw
          }

          if (
            methodName === `has` ||
            methodName === `delete` ||
            methodName === `add` ||
            methodName === `set`
          ) {
            return (...args: Array<unknown>) => {
              if (ptarget instanceof Set) args[0] = resolveValue(args[0])
              else if (methodName === `set`) args[1] = resolveValue(args[1])
              const result = value.apply(ptarget, args)
              if (methodName !== `has`) markChanged(changeTracker)
              return result === ptarget ? receiver : result
            }
          }

          if (ptarget instanceof Map && methodName === `get`) {
            return (key: unknown) => {
              const entry = ptarget.get(key)
              return isProxiableObject(entry)
                ? memoizedCreateChangeProxy(entry, {
                    tracker: changeTracker,
                    prop: ``,
                    retainIdentity: true,
                  }).proxy
                : entry
            }
          }

          if (methodName === `clear`) {
            return createModifyingMethodHandler(
              value,
              changeTracker,
              markChanged,
            )
          }

          // Handle iterator methods for Map and Set
          const iteratorHandler = createMapSetIteratorHandler(
            methodName,
            prop,
            changeTracker,
            receiver,
            memoizedCreateChangeProxy,
          )
          if (iteratorHandler) {
            return iteratorHandler
          }
        }
        return value.bind(ptarget)
      }

      // If the value is an object (but not Date, RegExp, or Temporal), create a proxy for it
      if (isProxiableObject(value)) {
        // Create a parent reference for the nested object
        const nestedParent = {
          tracker: changeTracker,
          prop: String(prop),
        }

        // Create (or reuse) the proxy for the nested object
        return memoizedCreateChangeProxy(value, nestedParent).proxy
      }

      return value
    },

    set(_sobj, prop, value) {
      const currentValue = changeTracker.copy_[prop as keyof T]

      // Only track the change if the value is actually different
      if (
        !Object.hasOwn(changeTracker.copy_, prop) ||
        !draftValuesEqual(currentValue, value)
      ) {
        // Check if the new value is equal to the original value
        // Important: Use the originalObject to get the true original value
        const originalValue = changeTracker.originalObject[prop as keyof T]
        const isRevertToOriginal =
          Object.hasOwn(changeTracker.originalObject, prop) &&
          draftValuesEqual(value, originalValue)

        if (isRevertToOriginal) {
          // If the value is reverted to its original state, remove it from changes
          delete changeTracker.assigned_[prop.toString()]

          // Make sure the copy is updated with the original value
          changeTracker.copy_[prop as keyof T] = deepClone(originalValue)

          // Some properties may still be changed; checkParentStatus clears
          // tracking here and up the chain once everything is reverted.
          changeTracker.modified = true
          checkParentStatus(changeTracker)
        } else {
          // Set the value on the copy
          changeTracker.copy_[prop as keyof T] = value

          // Track that this property was assigned - store using the actual property (symbol or string)
          changeTracker.assigned_[prop.toString()] = true

          // Mark this object and its ancestors as modified
          markChanged(changeTracker)
        }
      }

      return true
    },

    defineProperty(ptarget, prop, descriptor) {
      // Forward the defineProperty to the target to maintain Proxy invariants
      // This allows Object.seal() and Object.freeze() to work on the proxy
      const result = Reflect.defineProperty(ptarget, prop, descriptor)
      if (result && `value` in descriptor) {
        changeTracker.copy_[prop as keyof T] = deepClone(descriptor.value)
        changeTracker.assigned_[prop.toString()] = true
        markChanged(changeTracker)
      }
      return result
    },

    getOwnPropertyDescriptor(ptarget, prop) {
      // Forward to target to maintain Proxy invariants for seal/freeze
      return Reflect.getOwnPropertyDescriptor(ptarget, prop)
    },

    preventExtensions(ptarget) {
      // Forward to target to allow Object.seal() and Object.preventExtensions()
      return Reflect.preventExtensions(ptarget)
    },

    isExtensible(ptarget) {
      // Forward to target to maintain consistency
      return Reflect.isExtensible(ptarget)
    },

    deleteProperty(dobj, prop) {
      const stringProp = typeof prop === `symbol` ? prop.toString() : prop

      if (Object.hasOwn(dobj, prop)) {
        // Check if the property exists in the original object
        const hadPropertyInOriginal = Object.hasOwn(
          changeTracker.originalObject,
          prop,
        )

        // Forward the delete to the target using Reflect
        // This respects Object.seal/preventExtensions constraints
        const result = Reflect.deleteProperty(dobj, prop)

        if (result) {
          // If the property didn't exist in the original object, removing it
          // should revert to the original state
          if (!hadPropertyInOriginal) {
            delete changeTracker.assigned_[stringProp]

            // Deleting an added key is a revert. Like the set trap, clear
            // tracking here and up the chain once everything is reverted.
            changeTracker.modified = true
            checkParentStatus(changeTracker)
          } else {
            // Mark this property as deleted
            changeTracker.assigned_[stringProp] = false
            markChanged(changeTracker)
          }
        }

        return result
      }

      return true
    },
  })
  draftCopies.set(proxy, changeTracker.copy_)

  // Return the proxy and a function to get the changes
  return {
    proxy,
    getChanges: () => {
      // First, check if the object is still considered modified
      if (!changeTracker.modified) {
        return {}
      }

      // If we have a copy, return it directly
      // Check if valueObj is actually an object
      if (
        typeof changeTracker.copy_ !== `object` ||
        Array.isArray(changeTracker.copy_)
      ) {
        return changeTracker.copy_
      }

      if (Object.keys(changeTracker.assigned_).length === 0) {
        return changeTracker.copy_
      }

      const result: Record<string, any | undefined> = {}
      const mayHaveChangedAliases = Object.keys(changeTracker.assigned_).some(
        (key) =>
          typeof changeTracker.copy_[key] === `object` ||
          typeof changeTracker.originalObject[key] === `object`,
      )
      const pairedRoots = new Map<object, object>([
        [changeTracker.copy_, changeTracker.originalObject],
      ])

      // Iterate through keys in keyObj
      for (const key in changeTracker.copy_) {
        const value: unknown = changeTracker.copy_[key]
        const original: unknown = changeTracker.originalObject[key]
        // Compare child contents, stopping only at paired root backedges. A
        // child's own changes still count even when it also points to this row.
        if (
          changeTracker.assigned_[key] === true ||
          (mayHaveChangedAliases &&
            !draftValuesEqual(
              value instanceof Set ? Array.from(value) : value,
              original instanceof Set ? Array.from(original) : original,
              pairedRoots,
            ))
        ) {
          defineDataProperty(result, key, changeTracker.copy_[key])
        }
      }

      for (const key of Object.keys(changeTracker.assigned_)) {
        if (changeTracker.assigned_[key] === false) {
          defineDataProperty(result, key, undefined)
        }
      }

      return result as unknown as Record<string | symbol, unknown>
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
  targets: Array<T>,
): {
  proxies: Array<T>
  getChanges: () => Array<Record<string | symbol, unknown>>
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
  callback: (proxy: T) => void,
): Record<string | symbol, unknown> {
  const { proxy, getChanges } = createChangeProxy(target)

  callback(proxy)

  return deepClone(getChanges(), undefined, true)
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
  targets: Array<T>,
  callback: (proxies: Array<T>) => void,
): Array<Record<string | symbol, unknown>> {
  const { proxies, getChanges } = createArrayChangeProxy(targets)

  callback(proxies)

  return deepClone(getChanges(), undefined, true)
}
