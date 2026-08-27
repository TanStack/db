export type RuntimeReferenceIdentity = [
  `runtimeReference`,
  namespace: string,
  sequence: number,
]

export function createRuntimeReferenceIdentityFactory(): (
  value: object | symbol,
) => RuntimeReferenceIdentity {
  let namespace: string | undefined
  const referenceIds = new WeakMap<object, number>()
  // Symbols cannot be WeakMap keys. Stable identity for the same live symbol
  // therefore costs one strong entry for this factory's lifetime. Eviction
  // would let a later lookup assign a different identity and corrupt cache
  // equality, so keep this explicit until JavaScript offers weak symbol keys.
  const symbolReferenceIds = new Map<symbol, number>()
  let sequence = 0

  return (value) => {
    namespace ??= createRuntimeReferenceNamespace()
    let referenceId: number | undefined
    if (typeof value === `symbol`) {
      referenceId = symbolReferenceIds.get(value)
      if (referenceId === undefined) {
        referenceId = ++sequence
        symbolReferenceIds.set(value, referenceId)
      }
    } else {
      referenceId = referenceIds.get(value)
      if (referenceId === undefined) {
        referenceId = ++sequence
        referenceIds.set(value, referenceId)
      }
    }
    return [`runtimeReference`, namespace, referenceId]
  }
}

let runtimeReferenceIdentityFactory:
  | ReturnType<typeof createRuntimeReferenceIdentityFactory>
  | undefined

export function getRuntimeReferenceIdentity(
  value: object,
): RuntimeReferenceIdentity {
  runtimeReferenceIdentityFactory ??= createRuntimeReferenceIdentityFactory()

  return runtimeReferenceIdentityFactory(value)
}

function createRuntimeReferenceNamespace(): string {
  const randomValues = new Uint32Array(4)
  const runtimeCrypto = Reflect.get(globalThis, `crypto`) as
    | { getRandomValues?: (values: Uint32Array) => Uint32Array }
    | undefined
  if (typeof runtimeCrypto?.getRandomValues === `function`) {
    runtimeCrypto.getRandomValues(randomValues)
    return Array.from(randomValues, (value) => value.toString(36)).join(`-`)
  }

  // Reference equality cannot survive a runtime boundary. A per-runtime nonce
  // prevents a persisted key from matching an unrelated reference after a
  // reload, even on platforms without Web Crypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
