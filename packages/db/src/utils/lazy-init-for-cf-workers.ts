/**
 * Wraps a factory function in a Proxy to defer initialization until first access.
 * This prevents async operations (Like creating Tanstack DB Collections) from running in Cloudflare Workers' global scope.
 *
 * @param factory - A function that creates and returns the resource.
 *                  Must be a callback to defer execution; passing the value directly
 *                  would evaluate it at module load time, triggering the Cloudflare error.
 * @returns A Proxy that lazily initializes the resource on first property access
 *
 * @example
 * ```ts
 * export const myCollection = lazyInitForCFWorkers(() =>
 *   createCollection(queryCollectionOptions({
 *     queryKey: ["myData"],
 *     queryFn: async () => fetchData(),
 *     // ... other options
 *   }))
 * );
 * ```
 */
export function lazyInitForCFWorkers<T extends object>(factory: () => T): T {
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
    get(_target, prop, receiver) {
      const inst = getInstance()
      return Reflect.get(inst, prop, receiver)
    },
    set(_target, prop, value, receiver) {
      const inst = getInstance()
      return Reflect.set(inst, prop, value, receiver)
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
    defineProperty(_target, prop, descriptor) {
      const inst = getInstance()
      return Reflect.defineProperty(inst, prop, descriptor)
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
    apply(_target, thisArg, args) {
      const inst = getInstance()
      return Reflect.apply(inst as any, thisArg, args)
    },
    construct(_target, args, newTarget) {
      const inst = getInstance()
      return Reflect.construct(inst as any, args, newTarget)
    },
  })
}
