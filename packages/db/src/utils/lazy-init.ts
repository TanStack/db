/**
 * Wraps a factory function in a Proxy to defer initialization until first access.
 * This prevents async operations (like creating Tanstack DB Collections) from running
 * in Cloudflare Workers' global scope.
 *
 * @param factory - A function that creates and returns the resource.
 *                  Must be a callback to defer execution; passing the value directly
 *                  would evaluate it at module load time, triggering the Cloudflare error.
 * @returns A Proxy that lazily initializes the resource on first property access
 *
 * @example
 * ```ts
 * export const myCollection = lazyInitForWorkers(() =>
 *   createCollection(queryCollectionOptions({
 *     queryKey: ["myData"],
 *     queryFn: async () => fetchData(),
 *     // ... other options
 *   }))
 * );
 * ```
 */
export function lazyInitForWorkers<T extends object>(factory: () => T): T {
  // Closure: This variable is captured by getInstance() and the Proxy traps below.
  // It remains in memory as long as the returned Proxy is referenced, enabling singleton behavior.
  let instance: T | null = null

  function getInstance() {
    if (!instance) {
      instance = factory()
    }
    return instance
  }

  return new Proxy({} as T, {
    get(_target, prop, _receiver) {
      const inst = getInstance()
      return Reflect.get(inst, prop, inst)
    },
    set(_target, prop, value, _receiver) {
      const inst = getInstance()
      return Reflect.set(inst, prop, value, inst)
    },
    deleteProperty(_target, prop) {
      const inst = getInstance()
      return Reflect.deleteProperty(inst, prop)
    },
    has(_target, prop) {
      const inst = getInstance()
      return Reflect.has(inst, prop)
    },
    ownKeys(_target) {
      const inst = getInstance()
      return Reflect.ownKeys(inst)
    },
    getOwnPropertyDescriptor(_target, prop) {
      const inst = getInstance()
      return Reflect.getOwnPropertyDescriptor(inst, prop)
    },
    getPrototypeOf(_target) {
      const inst = getInstance()
      return Reflect.getPrototypeOf(inst)
    },
    setPrototypeOf(_target, proto) {
      const inst = getInstance()
      return Reflect.setPrototypeOf(inst, proto)
    },
    isExtensible(_target) {
      const inst = getInstance()
      return Reflect.isExtensible(inst)
    },
    preventExtensions(_target) {
      const inst = getInstance()
      return Reflect.preventExtensions(inst)
    },
    defineProperty(_target, prop, descriptor) {
      const inst = getInstance()
      return Reflect.defineProperty(inst, prop, descriptor)
    },
    apply(_target, _thisArg, argumentsList) {
      const inst = getInstance()
      return Reflect.apply(inst as any, inst, argumentsList)
    },
    construct(_target, argumentsList, _newTarget) {
      const inst = getInstance()
      return Reflect.construct(inst as any, argumentsList, inst as any)
    },
  })
}
