// Node 22 and 24 lack these methods used by @powersync/standalone-client.
// Test subprocesses import this same host setup; consumer compatibility still
// requires the separate SDK release. This is not an exact polyfill.

function defineMapMethod(name: string, implementation: unknown) {
  if (name in Map.prototype) return

  Object.defineProperty(Map.prototype, name, {
    value: implementation,
    writable: true,
    enumerable: false,
    configurable: true,
  })
}

defineMapMethod(
  `getOrInsert`,
  function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (this.has(key)) return this.get(key)
    this.set(key, value)
    return value
  },
)

defineMapMethod(
  `getOrInsertComputed`,
  function (
    this: Map<unknown, unknown>,
    key: unknown,
    callbackfn: (key: unknown) => unknown,
  ) {
    if (typeof callbackfn !== `function`) {
      throw new TypeError(`callbackfn is not a function`)
    }
    if (this.has(key)) return this.get(key)

    const value = callbackfn(key)
    this.set(key, value)
    return value
  },
)
