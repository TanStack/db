/**
 * A utility for creating a proxy that captures changes to an object
 * and provides a way to retrieve those changes.
 */

import { deepEquals, isTemporal } from './utils'

// A draft proxy's get trap answers this key with its private copy, so draft
// handles resolve before native Map/Set membership methods.
const DRAFT_COPY: unique symbol = Symbol(`draftCopy`)
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
  if (value === null || typeof value !== `object`) return value
  try {
    return (value as Record<symbol, unknown>)[DRAFT_COPY] ?? value
  } catch {
    // A revoked proxy is not a draft.
    return value
  }
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
 * Creates a Symbol.iterator handler for arrays that yields proxied elements.
 */
function createArrayIteratorHandler<T extends object>(
  changeTracker: ChangeTracker<T>,
  memoizedCreateChangeProxy: (
    obj: Record<string | symbol, unknown>,
    parent?: {
      tracker: ChangeTracker<Record<string | symbol, unknown>>
      prop: string | symbol
    },
  ) => { proxy: Record<string | symbol, unknown> },
): () => Iterator<unknown> {
  return function () {
    const array = changeTracker.copy_ as unknown as Array<unknown>
    let index = 0

    return {
      next() {
        if (index >= array.length) {
          return { done: true, value: undefined }
        }

        const element = array[index]
        let proxiedElement = element

        if (isProxiableObject(element)) {
          const nestedParent = {
            tracker: changeTracker as unknown as ChangeTracker<
              Record<string | symbol, unknown>
            >,
            prop: String(index),
          }
          const { proxy: elementProxy } = memoizedCreateChangeProxy(
            element,
            nestedParent,
          )
          proxiedElement = elementProxy
        }

        index++
        return { done: false, value: proxiedElement }
      },
      [Symbol.iterator]() {
        return this
      },
    }
  }
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

// Add TypedArray interface with proper type
interface TypedArray {
  length: number
  [index: number]: number
}

// Update type for ChangeTracker
interface ChangeParent {
  tracker: ChangeTracker<Record<string | symbol, unknown>>
  prop: string | symbol
  // Map/Set entries already belong to the parent's private copy.
  retainIdentity?: boolean
}

interface ChangeTracker<T extends object> {
  // Shared by one update's drafts and dropped with them.
  valueCopies: Map<object, unknown>
  originalObject: T
  modified: boolean
  copy_: T
  // A Map, not a null-prototype object: those start in dictionary mode,
  // where reading their keys is slow.
  assigned_: Map<string | symbol, boolean>
  parent?: ChangeParent
  target: T
}

/**
 * Deep clones an object while preserving special types like Date and RegExp
 */

function deepClone<T extends unknown>(
  obj: T,
  // Lives only for this clone, so a Map avoids weak-reference bookkeeping.
  visited = new Map<object, unknown>(),
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

  // Plain objects, the common case, skip the special-type checks below.
  const prototype = Object.getPrototypeOf(obj)
  if (prototype === Object.prototype || prototype === null) {
    return clonePlainObject(obj, visited, detach)
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
    // Get the constructor to create a new instance of the same type
    const TypedArrayConstructor = Object.getPrototypeOf(obj).constructor
    const clone = new TypedArrayConstructor(
      (obj as unknown as TypedArray).length,
    ) as unknown as TypedArray
    visited.set(obj as object, clone)

    // Copy the values
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
  if (detach) return obj
  return clonePlainObject(obj, visited, detach)
}

function clonePlainObject<T extends object>(
  obj: T,
  visited: Map<object, unknown>,
  detach: boolean,
): T {
  const clone = {} as Record<string | symbol, unknown>
  visited.set(obj as object, clone)

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // Copy data properties without invoking Object.prototype.__proto__.
      const value = (obj as Record<string | symbol, unknown>)[key]
      defineDataProperty(
        clone,
        key,
        value === null || typeof value !== `object`
          ? value
          : deepClone(value, visited, detach),
      )
    }
  }

  const symbolProps = Object.getOwnPropertySymbols(obj)
  for (const sym of symbolProps) {
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
  if (left === right) return true
  if (
    left === null ||
    right === null ||
    typeof left !== `object` ||
    typeof right !== `object`
  )
    return deepEquals(left, right)
  if (paired.has(left)) return paired.get(left) === right
  paired.set(left, right)
  try {
    if (left instanceof Set || right instanceof Set) {
      if (
        !(left instanceof Set) ||
        !(right instanceof Set) ||
        left.size !== right.size
      )
        return false
      const values = [...right]
      return [...left].every((value, index) =>
        draftValuesEqual(value, values[index], paired),
      )
    }
    if (left instanceof RegExp || right instanceof RegExp)
      return (
        left instanceof RegExp &&
        right instanceof RegExp &&
        deepEquals(left, right) &&
        left.lastIndex === right.lastIndex
      )
    if (left instanceof Map || right instanceof Map) {
      if (
        !(left instanceof Map) ||
        !(right instanceof Map) ||
        left.size !== right.size
      )
        return false
      const entries = [...right]
      return [...left].every(
        ([key, value], index) =>
          (key === entries[index]![0] || Object.is(key, entries[index]![0])) &&
          draftValuesEqual(value, entries[index]![1], paired),
      )
    }
    // Native leaf values retain their existing equality contract. Traverse
    // ordinary containers so a nested Set or RegExp cannot bypass refinement.
    if (
      left instanceof Date ||
      right instanceof Date ||
      ArrayBuffer.isView(left) ||
      ArrayBuffer.isView(right) ||
      isTemporal(left) ||
      isTemporal(right)
    )
      return deepEquals(left, right)
    if (Array.isArray(left) !== Array.isArray(right)) return false
    if (Array.isArray(left) && left.length !== (right as Array<unknown>).length)
      return false
    const keys = (value: object) =>
      Reflect.ownKeys(value).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(value, key),
      )
    const leftKeys = keys(left)
    if (leftKeys.length !== keys(right).length) return false
    return leftKeys.every(
      (key) =>
        Object.prototype.propertyIsEnumerable.call(right, key) &&
        draftValuesEqual(
          (left as Record<PropertyKey, unknown>)[key],
          (right as Record<PropertyKey, unknown>)[key],
          paired,
        ),
    )
  } finally {
    paired.delete(left)
  }
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
  // Cache proxies for nested objects
  // This prevents creating multiple proxies for the same object
  // and handles circular references
  const proxyCache = new Map<object, object>()

  // Existing values share one private copy per row. Newly inserted objects
  // retain normal references during the callback; the result is detached below.
  const valueCopies = parent?.tracker.valueCopies ?? new Map<object, unknown>()
  const changeTracker: ChangeTracker<T> = {
    valueCopies,
    copy_: parent
      ? ((valueCopies.get(target) ?? target) as T)
      : deepClone(target, valueCopies),
    // The root target is the stored row, which the draft never writes, so it
    // is its own baseline. A nested target is a draft copy that writes reach.
    originalObject: parent ? deepClone(target) : target,
    modified: false,
    assigned_: new Map(),
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
        state.parent.tracker.assigned_.set(state.parent.prop, true)
      }

      // Mark parent as changed
      markChanged(state.parent.tracker)
    }
  }

  // Check if all properties in the current state have reverted to original values
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
    // If there are no assigned properties, object is unchanged
    if (state.assigned_.size === 0) {
      return true
    }

    // Check each assigned property
    for (const [prop, assigned] of state.assigned_) {
      // Property was deleted, so it's different from original
      if (!assigned) return false
      // A field the original lacks was added, even when it holds undefined.
      if (!Object.hasOwn(state.originalObject, prop)) return false
      const currentValue = (state.copy_ as any)[prop]
      const originalValue = (state.originalObject as any)[prop]

      // If the value is not equal to original, something is still changed
      if (!draftValuesEqual(currentValue, originalValue)) {
        return false
      }
    }

    // All assigned properties match their original values
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
      parentState.assigned_ = new Map()

      // Continue up the chain
      if (parentState.parent) {
        checkParentStatus(parentState.parent.tracker)
      }
    }
  }

  // Whether a value equals the original's own value for a field.
  function isOriginalValue(prop: string | symbol, value: unknown): boolean {
    const original = changeTracker.originalObject
    return (
      Object.hasOwn(original, prop) &&
      draftValuesEqual(value, original[prop as keyof T])
    )
  }

  // Records a write the draft now holds. Assignment and defineProperty share
  // it so they report the same change.
  function recordWrite(prop: string | symbol, reverted: boolean) {
    if (!reverted) {
      changeTracker.assigned_.set(prop.toString(), true)
      markChanged(changeTracker)
      return
    }
    changeTracker.assigned_.delete(prop.toString())
    if (checkIfReverted(changeTracker)) {
      changeTracker.modified = false
      changeTracker.assigned_ = new Map()
      if (parent) checkParentStatus(parent.tracker)
    } else {
      changeTracker.modified = true
    }
  }

  // Create a proxy for the target object
  function createObjectProxy<TObj extends object>(obj: TObj): TObj {
    // If we've already created a proxy for this object, return it
    if (proxyCache.has(obj)) {
      return proxyCache.get(obj) as TObj
    }

    // Create a proxy for the object
    const proxy = new Proxy(obj, {
      get(ptarget, prop, receiver) {
        if (prop === DRAFT_COPY) return changeTracker.copy_
        const value = changeTracker.copy_[prop as keyof T]

        // If it's a getter, return the value directly
        const desc = Object.getOwnPropertyDescriptor(ptarget, prop)
        if (desc?.get) {
          return value
        }

        // If the value is a function, bind it to the ptarget
        if (typeof value === `function`) {
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
              methodName === `entries`
            ) {
              return value.bind(receiver)
            }

            // Handle array Symbol.iterator for for...of loops
            if (prop === Symbol.iterator) {
              return createArrayIteratorHandler(
                changeTracker,
                memoizedCreateChangeProxy,
              )
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

          // Create a proxy for the nested object
          const { proxy: nestedProxy } = memoizedCreateChangeProxy(
            value,
            nestedParent,
          )

          // Cache the proxy
          proxyCache.set(value, nestedProxy)

          return nestedProxy
        }

        return value
      },

      set(ptarget, prop, value) {
        // An accessor the callback defined behaves as on a plain object; a
        // getter without a setter rejects even a write of its own value.
        if (Reflect.getOwnPropertyDescriptor(ptarget, prop)?.get) {
          return Reflect.set(ptarget, prop, value)
        }
        const currentValue = changeTracker.copy_[prop as keyof T]

        // Only track the change if the value is actually different
        if (
          !Object.hasOwn(changeTracker.copy_, prop) ||
          !draftValuesEqual(currentValue, value)
        ) {
          const reverted = isOriginalValue(prop, value)
          // A revert restores a copy so the draft never aliases the row.
          changeTracker.copy_[prop as keyof T] = reverted
            ? deepClone(changeTracker.originalObject[prop as keyof T])
            : value
          recordWrite(prop, reverted)
        }

        return true
      },

      defineProperty(ptarget, prop, descriptor) {
        // Forward the defineProperty to the target to maintain Proxy invariants
        // This allows Object.seal() and Object.freeze() to work on the proxy
        const result = Reflect.defineProperty(ptarget, prop, descriptor)
        // Accessors count by the value they read, as assignment would.
        if (result) {
          recordWrite(prop, isOriginalValue(prop, Reflect.get(ptarget, prop)))
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
          // A hidden original field is not row data, so as with a plain
          // delete of it, removing it is not a change.
          const hadPropertyInOriginal =
            Object.prototype.propertyIsEnumerable.call(
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
              changeTracker.assigned_.delete(stringProp)

              // If this is the last change and we're not a nested object,
              // mark the object as unmodified
              if (changeTracker.assigned_.size === 0) {
                changeTracker.modified = false
              } else {
                // We still have changes, keep as modified
                changeTracker.modified = true
              }
            } else {
              // Mark this property as deleted
              changeTracker.assigned_.set(stringProp, false)
              markChanged(changeTracker)
            }
          }

          return result
        }

        return true
      },
    })

    // Cache the proxy
    proxyCache.set(obj, proxy)

    return proxy
  }

  // Create a proxy for the target object
  // Use the unfrozen copy_ as the proxy target to avoid Proxy invariant violations
  // when the original target is frozen (e.g., from Immer)
  const proxy = createObjectProxy(changeTracker.copy_ as unknown as T)

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

      const assigned = changeTracker.assigned_
      if (assigned.size === 0) {
        return changeTracker.copy_
      }

      const result: Record<string, any | undefined> = {}
      let mayHaveChangedAliases = false
      for (const key of assigned.keys()) {
        if (
          typeof (changeTracker.copy_ as any)[key] === `object` ||
          typeof (changeTracker.originalObject as any)[key] === `object`
        ) {
          mayHaveChangedAliases = true
          break
        }
      }
      const pairedRoots = mayHaveChangedAliases
        ? new Map<object, object>([
            [changeTracker.copy_, changeTracker.originalObject],
          ])
        : undefined

      // Iterate through keys in keyObj
      for (const key in changeTracker.copy_) {
        const value: unknown = changeTracker.copy_[key]
        const original: unknown = changeTracker.originalObject[key]
        // Compare child contents, stopping only at paired root backedges. A
        // child's own changes still count even when it also points to this row.
        if (
          (assigned.get(key) === true ||
            (mayHaveChangedAliases &&
              !draftValuesEqual(
                value instanceof Set ? Array.from(value) : value,
                original instanceof Set ? Array.from(original) : original,
                pairedRoots,
              ))) &&
          key in changeTracker.copy_
        ) {
          defineDataProperty(result, key, changeTracker.copy_[key])
        }
      }

      for (const [key, isAssigned] of assigned) {
        if (!isAssigned) {
          defineDataProperty(result, key as string, undefined)
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

// Whether every own field of a plain object is a primitive or a function.
function isFlatPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key in value) {
    const field = (value as Record<string, unknown>)[key]
    if (field !== null && typeof field === `object`) return false
  }
  return Object.getOwnPropertySymbols(value).length === 0
}

/**
 * Change tracking for flat rows without proxies. A draft is a shallow copy,
 * and its changes are the fields that differ from the row afterwards under
 * the same equality the draft proxy uses for primitives. Returns undefined
 * when any row has a nested object, a symbol key, or a class prototype, so
 * the caller falls back to the proxy.
 */
export function withFlatChangeTracking<T extends object>(
  targets: Array<T>,
  callback: (drafts: Array<T> | T) => void,
  asArray: boolean,
): Array<Record<string, unknown>> | undefined {
  if (!targets.every(isFlatPlainObject)) return undefined
  const drafts = targets.map((target) => ({ ...target }))
  callback(asArray ? drafts : drafts[0]!)
  return drafts.map((draft, index) => {
    const original = targets[index] as Record<string, unknown>
    const changes: Record<string, unknown> = {}
    let assignedObject = false
    for (const key in draft) {
      const value = (draft as Record<string, unknown>)[key]
      const before = original[key]
      // Only a hidden field can hold an object; compare it as the proxy does.
      if (
        !Object.hasOwn(original, key) ||
        !(
          value === before ||
          Object.is(value, before) ||
          (typeof before === `object` &&
            before !== null &&
            draftValuesEqual(value, before))
        )
      ) {
        defineDataProperty(changes, key, value)
        if (value !== null && typeof value === `object`) assignedObject = true
      }
    }
    for (const key in original) {
      if (!Object.hasOwn(draft, key))
        defineDataProperty(changes, key, undefined)
    }
    // A callback may assign objects; detach them as the proxy path does.
    return assignedObject ? deepClone(changes, undefined, true) : changes
  })
}
