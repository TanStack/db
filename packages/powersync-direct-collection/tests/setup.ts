// We run tests on Node 24, which is missing these methods used by @powersync/standalone-client. This is not an exact
// polyfill, but good enough to run the client.

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
