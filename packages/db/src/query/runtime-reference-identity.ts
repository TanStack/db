export type RuntimeReferenceIdentity = [
  `runtimeReference`,
  namespace: string,
  sequence: number,
]

export function createRuntimeReferenceIdentityFactory(): (
  value: object | symbol,
) => RuntimeReferenceIdentity {
  const referenceIds = new WeakMap<object, number>()
  const symbolIds = new Map<symbol, number>()
  let namespace: string | undefined
  let sequence = 0

  return (value) => {
    namespace ??= createRuntimeReferenceNamespace()
    let referenceId =
      typeof value === `symbol` ? symbolIds.get(value) : referenceIds.get(value)
    if (referenceId === undefined) {
      referenceId = ++sequence
      if (typeof value === `symbol`) symbolIds.set(value, referenceId)
      else referenceIds.set(value, referenceId)
    }
    return [`runtimeReference`, namespace, referenceId]
  }
}

let runtimeReferenceIdentityFactory:
  | ReturnType<typeof createRuntimeReferenceIdentityFactory>
  | undefined

export function getRuntimeReferenceIdentity(
  value: object | symbol,
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
