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
 * Array and typed-array methods that modify the value in place.
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
  `set`,
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
  receiver: unknown,
): (...args: Array<unknown>) => unknown {
  return function (...args: Array<unknown>) {
    const result = methodFn.apply(changeTracker.copy_, args)
    markChanged(changeTracker)
    // A method that returns the value itself returns the draft.
    return result === changeTracker.copy_ ? receiver : result
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
  set: (source: TypedArray) => void
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

  const tag = Object.prototype.toString.call(obj)
  const BufferConstructor =
    tag === `[object ArrayBuffer]`
      ? ArrayBuffer
      : tag === `[object SharedArrayBuffer]` &&
          typeof SharedArrayBuffer !== `undefined`
        ? SharedArrayBuffer
        : undefined
  if (BufferConstructor) {
    let byteLength: number | undefined
    try {
      // Validate the native brand across realms; ordinary tagged data is not a buffer.
      byteLength = Object.getOwnPropertyDescriptor(
        BufferConstructor.prototype,
        `byteLength`,
      )!.get!.call(obj)
    } catch {
      // Continue with the ordinary-object copy for a spoofed native tag.
    }
    if (byteLength !== undefined) {
      const clone = new BufferConstructor(byteLength)
      new Uint8Array(clone).set(
        new Uint8Array(obj as unknown as ArrayBufferLike),
      )
      visited.set(obj, clone)
      return clone as T
    }
  }

  if (ArrayBuffer.isView(obj)) {
    // Clone the buffer through the same identity table regardless of traversal
    // order, so standard views retain their ranges and shared backing bytes.
    const buffer = deepClone(obj.buffer, visited, detach)
    const kind = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      Symbol.toStringTag,
    )!.get!.call(obj) as string | undefined
    if (kind === undefined) {
      const clone = new DataView(buffer, obj.byteOffset, obj.byteLength)
      visited.set(obj, clone)
      return clone as T
    }
    const Constructor = Object.getPrototypeOf(obj).constructor as new (
      bufferOrLength: ArrayBufferLike | number,
      byteOffset?: number,
      length?: number,
    ) => TypedArray
    const length = (obj as unknown as TypedArray).length
    // Native constructors from another realm have the same intrinsic source.
    // Preserve the existing single numeric argument for custom constructors.
    const native =
      Function.prototype.toString.call(Constructor) ===
      Function.prototype.toString.call(
        globalThis[kind as keyof typeof globalThis],
      )
    const clone = native
      ? new Constructor(buffer, obj.byteOffset, length)
      : new Constructor(length)
    visited.set(obj, clone)
    clone.set(obj as unknown as TypedArray)
    return clone as T
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
  // Keep them by reference when detaching a change set.
  if (detach) {
    const prototype = Object.getPrototypeOf(obj)
    if (prototype !== Object.prototype && prototype !== null) return obj
  }

  const clone = {} as Record<string | symbol, unknown>
  visited.set(obj as object, clone)

  // Own enumerable string keys and every own symbol key, in native order.
  for (const key of Reflect.ownKeys(obj)) {
    if (
      typeof key === `symbol` ||
      Object.prototype.propertyIsEnumerable.call(obj, key)
    ) {
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

  return clone as T
}

// Generic value equality intentionally ignores some native state. Draft
// assignments must also preserve Set contents/order and RegExp match position.
function draftValuesEqual(
  left: unknown,
  right: unknown,
  paired?: Map<object, object>,
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
    // The root target is the stored row, which the draft never writes, so it
    // is its own baseline. A nested target is a draft copy that writes reach.
    originalObject: parent ? deepClone(target) : target,
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
            Map<unknown, unknown> | Set<unknown>,
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
    if (reverted) {
      delete changeTracker.assigned_[prop.toString()]
      // Some properties may still be changed; checkParentStatus clears
      // tracking here and up the chain once everything is reverted.
      changeTracker.modified = true
      checkParentStatus(changeTracker)
    } else {
      changeTracker.assigned_[prop.toString()] = true
      markChanged(changeTracker)
    }
  }

  const proxy = new Proxy(changeTracker.copy_, {
    get(ptarget, prop, receiver) {
      const value = changeTracker.copy_[prop as keyof T]

      // If it's a getter, return the value directly
      const desc = Object.getOwnPropertyDescriptor(ptarget, prop)
      if (desc?.get) {
        return value
      }

      // The Proxy invariants require a read-only non-configurable value as
      // stored, as after Object.freeze. A raw object can still be written
      // through, so its key counts as changed.
      if (desc?.configurable === false && !desc.writable) {
        if (isProxiableObject(value)) {
          changeTracker.assigned_[String(prop)] = true
          markChanged(changeTracker)
        }
        return value
      }

      // If the value is a function, bind it to the ptarget
      if (typeof value === `function`) {
        // A function stored as data is returned as stored, like any value. A
        // call then sees the draft as `this`, so its writes are tracked. A
        // constructor is not a method. Only inherited methods (Array, Map,
        // Set) need the handling below.
        if (Object.hasOwn(ptarget, prop) || prop === `constructor`) return value

        const methodName = prop.toString()

        // A subarray shares the buffer, so it is a draft whose writes mark
        // this value changed, like a Map value.
        if (methodName === `subarray` && ArrayBuffer.isView(ptarget)) {
          return (...args: Array<unknown>) =>
            memoizedCreateChangeProxy(value.apply(ptarget, args), {
              tracker: changeTracker,
              prop: ``,
              retainIdentity: true,
            }).proxy
        }

        // Array and typed-array methods that modify the value in place
        if (
          ARRAY_MODIFYING_METHODS.has(methodName) &&
          (Array.isArray(ptarget) || ArrayBuffer.isView(ptarget))
        ) {
          return createModifyingMethodHandler(
            value,
            changeTracker,
            markChanged,
            receiver,
          )
        }

        if (Array.isArray(ptarget)) {
          // Other methods, iterators included, read through the draft
          // itself, so returned and callback elements are drafts and searches
          // find them. This also tracks the callback array and implicit
          // reduce seed.
          return value.bind(receiver)
        }

        // For Map and Set methods that modify the collection
        if (ptarget instanceof Map || ptarget instanceof Set) {
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
              receiver,
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
      // A value or an accessor changes what the key reads, counted by the
      // value it reads as an assignment would be. Sealing does not.
      if (
        result &&
        (`value` in descriptor || descriptor.get || descriptor.set)
      ) {
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

// Whether every own field of a plain object holds a primitive or a function.
function isFlatPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key in value) {
    // A getter may return a new value on each read; the proxy reads it once.
    const { value: field, get } = Object.getOwnPropertyDescriptor(value, key)!
    if (get || (field !== null && typeof field === `object`)) return false
  }
  return Object.getOwnPropertySymbols(value).length === 0
}

/**
 * Change tracking for flat rows without proxies. A draft is a shallow copy,
 * and its changes are the fields that differ from the row afterwards under
 * the same equality the draft proxy uses for primitives. Returns undefined
 * when any row has a nested object, a getter, a symbol key, or a class
 * prototype, so the caller falls back to the proxy.
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
