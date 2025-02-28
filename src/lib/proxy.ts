/**
 * A utility for creating a proxy that captures changes to an object
 * and provides a way to retrieve those changes.
 */

type ChangeTracker<T> = {
  changes: Record<string, unknown>
  originalObject: T
}

/**
 * Creates a proxy that tracks changes to the target object
 *
 * @param target The object to proxy
 * @returns An object containing the proxy and a function to get the changes
 */
export function createChangeProxy<T extends object>(
  target: T
): {
  proxy: T
  getChanges: () => Record<string, unknown>
} {
  const changeTracker: ChangeTracker<T> = {
    changes: {},
    originalObject: target,
  }

  const handler: ProxyHandler<T> = {
    set(obj, prop, value) {
      const stringProp = String(prop)

      // Only track the change if the value is actually different
      if (obj[prop as keyof T] !== value) {
        changeTracker.changes[stringProp] = value
      }

      // Set the value on the original object
      obj[prop as keyof T] = value
      return true
    },
  }

  return {
    proxy: new Proxy(target, handler),
    getChanges: () => changeTracker.changes,
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
  getChanges: () => Record<string, unknown>[]
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
): Record<string, unknown> {
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
): Record<string, unknown>[] {
  const { proxies, getChanges } = createArrayChangeProxy(targets)

  callback(proxies)

  return getChanges()
}
