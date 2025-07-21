/**
 * A utility for creating a proxy that captures changes to an object
 * and provides a way to retrieve those changes.
 */

/**
 * Simple debug utility that only logs when debug mode is enabled
 * Set DEBUG to true in localStorage to enable debug logging
 */
function debugLog(...args: Array<unknown>): void {
  // Check if we're in a browser environment
  const isBrowser =
    typeof window !== `undefined` && typeof localStorage !== `undefined`

  // In browser, check localStorage for debug flag
  if (isBrowser && localStorage.getItem(`DEBUG`) === `true`) {
    console.log(`[proxy]`, ...args)
  }
  // In Node.js environment, check for environment variable (though this is primarily for browser)
  else if (
    // true
    !isBrowser &&
    typeof process !== `undefined` &&
    process.env.DEBUG === `true`
  ) {
    console.log(`[proxy]`, ...args)
  }
}

// Add TypedArray interface with proper type
interface TypedArray {
  length: number
  [index: number]: number
}

// Update type for ChangeTracker
interface ChangeTracker<T extends object> {
  originalObject: T
  modified: boolean
  copy_: T
  proxyCount: number
  assigned_: Record<string | symbol, boolean>
  parent?:
    | {
        tracker: ChangeTracker<Record<string | symbol, unknown>>
        prop: string | symbol
      }
    | {
        tracker: ChangeTracker<Record<string | symbol, unknown>>
        prop: string | symbol
        updateMap: (newValue: unknown) => void
      }
    | {
        tracker: ChangeTracker<Record<string | symbol, unknown>>
        prop: unknown
        updateSet: (newValue: unknown) => void
      }
  target: T
}

/**
 * Deep clones an object while preserving special types like Date and RegExp
 */

function deepClone<T extends unknown>(
  obj: T,
  visited = new WeakMap<object, unknown>()
): T {
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
    return new Date(obj.getTime()) as unknown as T
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as unknown as T
  }

  if (Array.isArray(obj)) {
    const arrayClone = [] as Array<unknown>
    visited.set(obj as object, arrayClone)
    obj.forEach((item, index) => {
      arrayClone[index] = deepClone(item, visited)
    })
    return arrayClone as unknown as T
  }

  // Handle TypedArrays
  if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    // Get the constructor to create a new instance of the same type
    const TypedArrayConstructor = Object.getPrototypeOf(obj).constructor
    const clone = new TypedArrayConstructor(
      (obj as unknown as TypedArray).length
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
      clone.set(key, deepClone(value, visited))
    })
    return clone as unknown as T
  }

  if (obj instanceof Set) {
    const clone = new Set()
    visited.set(obj as object, clone)
    obj.forEach((value) => {
      clone.add(deepClone(value, visited))
    })
    return clone as unknown as T
  }

  const clone = {} as Record<string | symbol, unknown>
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

    const entries = Array.from(a.entries())
    for (const [key, val] of entries) {
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

  // Handle TypedArrays
  if (
    ArrayBuffer.isView(a) &&
    ArrayBuffer.isView(b) &&
    !(a instanceof DataView) &&
    !(b instanceof DataView)
  ) {
    const typedA = a as unknown as TypedArray
    const typedB = b as unknown as TypedArray
    if (typedA.length !== typedB.length) return false

    for (let i = 0; i < typedA.length; i++) {
      if (typedA[i] !== typedB[i]) return false
    }

    return true
  }

  // Handle plain objects
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)

  if (keysA.length !== keysB.length) return false

  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as any)[key], (b as any)[key])
  )
}

let count = 0
function getProxyCount() {
  count += 1
  return count
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
  parent?: {
    tracker: ChangeTracker<Record<string | symbol, unknown>>
    prop: string | symbol
  }
): {
  proxy: T

  getChanges: () => Record<string | symbol, any>
} {
  const changeProxyCache = new Map<object, object>()

  function memoizedCreateChangeProxy<
    TInner extends Record<string | symbol, any | undefined>,
  >(
    innerTarget: TInner,
    innerParent?: {
      tracker: ChangeTracker<Record<string | symbol, unknown>>
      prop: string | symbol
    }
  ): {
    proxy: TInner
    getChanges: () => Record<string | symbol, any>
  } {
    debugLog(`Object ID:`, innerTarget.constructor.name)
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
  // Create a WeakMap to cache proxies for nested objects
  // This prevents creating multiple proxies for the same object
  // and handles circular references
  const proxyCache = new Map<object, object>()

  // Create a change tracker to track changes to the object
  const changeTracker: ChangeTracker<T> = {
    copy_: deepClone(target),
    originalObject: deepClone(target),
    proxyCount: getProxyCount(),
    modified: false,
    assigned_: {},
    parent,
    target, // Store reference to the target object
  }

  debugLog(
    `createChangeProxy called for target`,
    target,
    changeTracker.proxyCount
  )
  // Mark this object and all its ancestors as modified
  // Also propagate the actual changes up the chain
  function markChanged(state: ChangeTracker<object>) {
    if (!state.modified) {
      state.modified = true
    }

    // Propagate the change up the parent chain
    if (state.parent) {
      debugLog(`propagating change to parent`)

      // Check if this is a special Map parent with updateMap function
      if (`updateMap` in state.parent) {
        // Use the special updateMap function for Maps
        state.parent.updateMap(state.copy_)
      } else if (`updateSet` in state.parent) {
        // Use the special updateSet function for Sets
        state.parent.updateSet(state.copy_)
      } else {
        // Update parent's copy with this object's current state
        state.parent.tracker.copy_[state.parent.prop] = state.copy_
        state.parent.tracker.assigned_[state.parent.prop] = true
      }

      // Mark parent as changed
      markChanged(state.parent.tracker)
    }
  }

  // Check if all properties in the current state have reverted to original values
  function checkIfReverted(
    state: ChangeTracker<Record<string | symbol, unknown>>
  ): boolean {
    debugLog(
      `checkIfReverted called with assigned keys:`,
      Object.keys(state.assigned_)
    )

    // If there are no assigned properties, object is unchanged
    if (
      Object.keys(state.assigned_).length === 0 &&
      Object.getOwnPropertySymbols(state.assigned_).length === 0
    ) {
      debugLog(`No assigned properties, returning true`)
      return true
    }

    // Check each assigned regular property
    for (const prop in state.assigned_) {
      // If this property is marked as assigned
      if (state.assigned_[prop] === true) {
        const currentValue = state.copy_[prop]
        const originalValue = (state.originalObject as any)[prop]

        debugLog(
          `Checking property ${String(prop)}, current:`,
          currentValue,
          `original:`,
          originalValue
        )

        // If the value is not equal to original, something is still changed
        if (!deepEqual(currentValue, originalValue)) {
          debugLog(`Property ${String(prop)} is different, returning false`)
          return false
        }
      } else if (state.assigned_[prop] === false) {
        // Property was deleted, so it's different from original
        debugLog(`Property ${String(prop)} was deleted, returning false`)
        return false
      }
    }

    // Check each assigned symbol property
    const symbolProps = Object.getOwnPropertySymbols(state.assigned_)
    for (const sym of symbolProps) {
      if (state.assigned_[sym] === true) {
        const currentValue = (state.copy_ as any)[sym]
        const originalValue = (state.originalObject as any)[sym]

        // If the value is not equal to original, something is still changed
        if (!deepEqual(currentValue, originalValue)) {
          debugLog(`Symbol property is different, returning false`)
          return false
        }
      } else if (state.assigned_[sym] === false) {
        // Property was deleted, so it's different from original
        debugLog(`Symbol property was deleted, returning false`)
        return false
      }
    }

    debugLog(`All properties match original values, returning true`)
    // All assigned properties match their original values
    return true
  }

  // Update parent status based on child changes
  function checkParentStatus(
    parentState: ChangeTracker<Record<string | symbol, unknown>>,
    childProp: string | symbol | unknown
  ) {
    debugLog(`checkParentStatus called for child prop:`, childProp)

    // Check if all properties of the parent are reverted
    const isReverted = checkIfReverted(parentState)
    debugLog(`Parent checkIfReverted returned:`, isReverted)

    if (isReverted) {
      debugLog(`Parent is fully reverted, clearing tracking`)
      // If everything is reverted, clear the tracking
      parentState.modified = false
      parentState.assigned_ = {}

      // Continue up the chain
      if (parentState.parent) {
        debugLog(`Continuing up the parent chain`)
        checkParentStatus(parentState.parent.tracker, parentState.parent.prop)
      }
    }
  }

  // Create a proxy for the target object
  function createObjectProxy<TObj extends object>(obj: TObj): TObj {
    debugLog(`createObjectProxy`, obj)
    // If we've already created a proxy for this object, return it
    if (proxyCache.has(obj)) {
      debugLog(`proxyCache found match`)
      return proxyCache.get(obj) as TObj
    }

    // Create a proxy for the object
    const proxy = new Proxy(obj, {
      get(ptarget, prop) {
        debugLog(`get`, ptarget, prop)
        const value =
          changeTracker.copy_[prop as keyof T] ??
          changeTracker.originalObject[prop as keyof T]

        const originalValue = changeTracker.originalObject[prop as keyof T]

        debugLog(`value (at top of proxy get)`, value)

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
            const modifyingMethods = new Set([
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

            if (modifyingMethods.has(methodName)) {
              return function (...args: Array<unknown>) {
                const result = value.apply(changeTracker.copy_, args)
                markChanged(changeTracker)
                return result
              }
            }
          }

          // For Map and Set methods that modify the collection
          if (ptarget instanceof Map || ptarget instanceof Set) {
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
              return function (...args: Array<unknown>) {
                const result = value.apply(changeTracker.copy_, args)
                markChanged(changeTracker)
                return result
              }
            }

            // Handle iterator methods for Map and Set
            const iteratorMethods = new Set([
              `entries`,
              `keys`,
              `values`,
              `forEach`,
              Symbol.iterator,
            ])

            if (iteratorMethods.has(methodName) || prop === Symbol.iterator) {
              return function (this: unknown, ...args: Array<unknown>) {
                const result = value.apply(changeTracker.copy_, args)

                // For forEach, we need to wrap the callback to track changes
                if (methodName === `forEach`) {
                  const callback = args[0]
                  if (typeof callback === `function`) {
                    // Replace the original callback with our wrapped version
                    const wrappedCallback = function (
                      this: unknown,
                      // eslint-disable-next-line
                      value: unknown,
                      key: unknown,
                      collection: unknown
                    ) {
                      // Call the original callback
                      const cbresult = callback.call(
                        this,
                        value,
                        key,
                        collection
                      )
                      // Mark as changed since the callback might have modified the value
                      markChanged(changeTracker)
                      return cbresult
                    }
                    // Call forEach with our wrapped callback
                    return value.apply(ptarget, [
                      wrappedCallback,
                      ...args.slice(1),
                    ])
                  }
                }

                // For iterators (entries, keys, values, Symbol.iterator)
                if (
                  methodName === `entries` ||
                  methodName === `values` ||
                  methodName === Symbol.iterator.toString() ||
                  prop === Symbol.iterator
                ) {
                  // If it's an iterator, we need to wrap the returned iterator
                  // to track changes when the values are accessed and potentially modified
                  const originalIterator = result

                  // For values() iterator on Maps, we need to create a value-to-key mapping
                  const valueToKeyMap = new Map()
                  if (methodName === `values` && ptarget instanceof Map) {
                    // Build a mapping from value to key for reverse lookup
                    // Use the copy_ (which is the current state) to build the mapping
                    for (const [
                      key,
                      mapValue,
                    ] of changeTracker.copy_.entries()) {
                      valueToKeyMap.set(mapValue, key)
                    }
                  }

                  // For Set iterators, we need to create an original-to-modified mapping
                  const originalToModifiedMap = new Map()
                  if (ptarget instanceof Set) {
                    // Initialize with original values
                    for (const setValue of changeTracker.copy_.values()) {
                      originalToModifiedMap.set(setValue, setValue)
                    }
                  }

                  // Create a proxy for the iterator that will mark changes when next() is called
                  return {
                    next() {
                      const nextResult = originalIterator.next()

                      // If we have a value and it's an object, we need to track it
                      if (
                        !nextResult.done &&
                        nextResult.value &&
                        typeof nextResult.value === `object`
                      ) {
                        // For entries, the value is a [key, value] pair
                        if (
                          methodName === `entries` &&
                          Array.isArray(nextResult.value) &&
                          nextResult.value.length === 2
                        ) {
                          // The value is at index 1 in the [key, value] pair
                          if (
                            nextResult.value[1] &&
                            typeof nextResult.value[1] === `object`
                          ) {
                            const mapKey = nextResult.value[0]
                            // Create a special parent tracker that knows how to update the Map
                            const mapParent = {
                              tracker: changeTracker,
                              prop: mapKey,
                              updateMap: (newValue: unknown) => {
                                // Update the Map in the copy
                                if (changeTracker.copy_ instanceof Map) {
                                  changeTracker.copy_.set(mapKey, newValue)
                                }
                              },
                            }

                            // Create a proxy for the value and replace it in the result
                            const { proxy: valueProxy } =
                              memoizedCreateChangeProxy(
                                nextResult.value[1],
                                mapParent
                              )
                            nextResult.value[1] = valueProxy
                          }
                        } else if (
                          methodName === `values` ||
                          methodName === Symbol.iterator.toString() ||
                          prop === Symbol.iterator
                        ) {
                          // If the value is an object, create a proxy for it
                          if (
                            typeof nextResult.value === `object` &&
                            nextResult.value !== null
                          ) {
                            // For Map values(), try to find the key using our mapping
                            if (
                              methodName === `values` &&
                              ptarget instanceof Map
                            ) {
                              const mapKey = valueToKeyMap.get(nextResult.value)
                              if (mapKey !== undefined) {
                                // Create a special parent tracker for this Map value
                                const mapParent = {
                                  tracker: changeTracker,
                                  prop: mapKey,
                                  updateMap: (newValue: unknown) => {
                                    // Update the Map in the copy
                                    if (changeTracker.copy_ instanceof Map) {
                                      changeTracker.copy_.set(mapKey, newValue)
                                    }
                                  },
                                }

                                const { proxy: valueProxy } =
                                  memoizedCreateChangeProxy(
                                    nextResult.value,
                                    mapParent
                                  )
                                nextResult.value = valueProxy
                              }
                            } else if (ptarget instanceof Set) {
                              // For Set, we need to track modifications and update the Set accordingly
                              const setOriginalValue = nextResult.value
                              const setParent = {
                                tracker: changeTracker,
                                prop: setOriginalValue, // Use the original value as the prop
                                updateSet: (newValue: unknown) => {
                                  // Update the Set in the copy by removing old value and adding new one
                                  if (changeTracker.copy_ instanceof Set) {
                                    changeTracker.copy_.delete(setOriginalValue)
                                    changeTracker.copy_.add(newValue)
                                    // Update our mapping for future iterations
                                    originalToModifiedMap.set(
                                      setOriginalValue,
                                      newValue
                                    )
                                  }
                                },
                              }

                              const { proxy: valueProxy } =
                                memoizedCreateChangeProxy(
                                  nextResult.value,
                                  setParent
                                )
                              nextResult.value = valueProxy
                            } else {
                              // For other cases, use a symbol as a placeholder
                              const tempKey = Symbol(`iterator-value`)
                              const { proxy: valueProxy } =
                                memoizedCreateChangeProxy(nextResult.value, {
                                  tracker: changeTracker,
                                  prop: tempKey,
                                })
                              nextResult.value = valueProxy
                            }
                          }
                        }
                      }

                      return nextResult
                    },
                    [Symbol.iterator]() {
                      return this
                    },
                  }
                }

                return result
              }
            }
          }
          return value.bind(ptarget)
        }

        // If the value is an object, create a proxy for it
        if (
          value &&
          typeof value === `object` &&
          !((value as any) instanceof Date) &&
          !((value as any) instanceof RegExp)
        ) {
          // Create a parent reference for the nested object
          const nestedParent = {
            tracker: changeTracker,
            prop: String(prop),
          }

          // Create a proxy for the nested object
          const { proxy: nestedProxy } = memoizedCreateChangeProxy(
            originalValue,
            nestedParent
          )

          // Cache the proxy
          proxyCache.set(value, nestedProxy)

          return nestedProxy
        }

        return value
      },

      set(_sobj, prop, value) {
        const currentValue = changeTracker.copy_[prop as keyof T]
        debugLog(
          `set called for property ${String(prop)}, current:`,
          currentValue,
          `new:`,
          value
        )

        // Only track the change if the value is actually different
        if (!deepEqual(currentValue, value)) {
          // Check if the new value is equal to the original value
          // Important: Use the originalObject to get the true original value
          const originalValue = changeTracker.originalObject[prop as keyof T]
          const isRevertToOriginal = deepEqual(value, originalValue)
          debugLog(
            `value:`,
            value,
            `original:`,
            originalValue,
            `isRevertToOriginal:`,
            isRevertToOriginal
          )

          if (isRevertToOriginal) {
            debugLog(`Reverting property ${String(prop)} to original value`)
            // If the value is reverted to its original state, remove it from changes
            delete changeTracker.assigned_[prop.toString()]

            // Make sure the copy is updated with the original value
            debugLog(`Updating copy with original value for ${String(prop)}`)
            changeTracker.copy_[prop as keyof T] = deepClone(originalValue)

            // Check if all properties in this object have been reverted
            debugLog(`Checking if all properties reverted`)
            const allReverted = checkIfReverted(changeTracker)
            debugLog(`All reverted:`, allReverted)

            if (allReverted) {
              debugLog(`All properties reverted, clearing tracking`)
              // If all have been reverted, clear tracking
              changeTracker.modified = false
              changeTracker.assigned_ = {}

              // If we're a nested object, check if the parent needs updating
              if (parent) {
                debugLog(`Updating parent for property:`, parent.prop)
                checkParentStatus(parent.tracker, parent.prop)
              }
            } else {
              // Some properties are still changed
              debugLog(`Some properties still changed, keeping modified flag`)
              changeTracker.modified = true
            }
          } else {
            debugLog(`Setting new value for property ${String(prop)}`)

            // Set the value on the copy
            changeTracker.copy_[prop as keyof T] = value

            // Track that this property was assigned - store using the actual property (symbol or string)
            changeTracker.assigned_[prop.toString()] = true

            // Mark this object and its ancestors as modified
            debugLog(`Marking object and ancestors as modified`, changeTracker)
            markChanged(changeTracker)
          }
        } else {
          debugLog(`Value unchanged, not tracking`)
        }

        return true
      },

      defineProperty(_ptarget, prop, descriptor) {
        // const result = Reflect.defineProperty(
        //   changeTracker.copy_,
        //   prop,
        //   descriptor
        // )
        // if (result) {
        if (`value` in descriptor) {
          changeTracker.copy_[prop as keyof T] = deepClone(descriptor.value)
          changeTracker.assigned_[prop.toString()] = true
          markChanged(changeTracker)
        }
        // }
        // return result
        return true
      },

      deleteProperty(dobj, prop) {
        debugLog(`deleteProperty`, dobj, prop)
        const stringProp = typeof prop === `symbol` ? prop.toString() : prop

        if (stringProp in dobj) {
          // Check if the property exists in the original object
          const hadPropertyInOriginal =
            stringProp in changeTracker.originalObject

          // Delete the property from the copy
          // Use type assertion to tell TypeScript this is allowed
          delete (changeTracker.copy_ as Record<string | symbol, unknown>)[prop]

          // If the property didn't exist in the original object, removing it
          // should revert to the original state
          if (!hadPropertyInOriginal) {
            delete changeTracker.copy_[stringProp]
            delete changeTracker.assigned_[stringProp]

            // If this is the last change and we're not a nested object,
            // mark the object as unmodified
            if (
              Object.keys(changeTracker.assigned_).length === 0 &&
              Object.getOwnPropertySymbols(changeTracker.assigned_).length === 0
            ) {
              changeTracker.modified = false
            } else {
              // We still have changes, keep as modified
              changeTracker.modified = true
            }
          } else {
            // Mark this property as deleted
            changeTracker.assigned_[stringProp] = false
            changeTracker.copy_[stringProp as keyof T] = undefined as T[keyof T]
            markChanged(changeTracker)
          }
        }

        return true
      },
    })

    // Cache the proxy
    proxyCache.set(obj, proxy)

    return proxy
  }

  // Create a proxy for the target object
  const proxy = createObjectProxy(target)

  // Return the proxy and a function to get the changes
  return {
    proxy,
    getChanges: () => {
      debugLog(`getChanges called, modified:`, changeTracker.modified)
      debugLog(changeTracker)

      // First, check if the object is still considered modified
      if (!changeTracker.modified) {
        debugLog(`Object not modified, returning empty object`)
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

      // Iterate through keys in keyObj
      for (const key in changeTracker.copy_) {
        // If the key's value is true and the key exists in valueObj
        if (
          changeTracker.assigned_[key] === true &&
          key in changeTracker.copy_
        ) {
          result[key] = changeTracker.copy_[key]
        }
      }
      debugLog(`Returning copy:`, result)
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
  targets: Array<T>
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
  targets: Array<T>,
  callback: (proxies: Array<T>) => void
): Array<Record<string | symbol, unknown>> {
  const { proxies, getChanges } = createArrayChangeProxy(targets)

  callback(proxies)

  return getChanges()
}
