export type RuntimeReferenceIdentity = [
  `runtimeReference`,
  namespace: string,
  sequence: number,
]

export function createRuntimeReferenceIdentityFactory(): (
  value: object,
) => RuntimeReferenceIdentity {
  const namespace = createRuntimeReferenceNamespace()
  const referenceIds = new WeakMap<object, number>()
  let sequence = 0

  return (value) => {
    let referenceId = referenceIds.get(value)
    if (referenceId === undefined) {
      referenceId = ++sequence
      referenceIds.set(value, referenceId)
    }
    return [`runtimeReference`, namespace, referenceId]
  }
}

export const getRuntimeReferenceIdentity =
  createRuntimeReferenceIdentityFactory()

function createRuntimeReferenceNamespace(): string {
  const randomValues = new Uint32Array(4)
  const runtimeCrypto = Reflect.get(globalThis, `crypto`) as
    | { getRandomValues: (values: Uint32Array) => Uint32Array }
    | undefined
  if (runtimeCrypto !== undefined) {
    runtimeCrypto.getRandomValues(randomValues)
    return Array.from(randomValues, (value) => value.toString(36)).join(`-`)
  }

  // Reference equality cannot survive a runtime boundary. A per-runtime nonce
  // prevents a persisted key from matching an unrelated reference after a
  // reload, even on platforms without Web Crypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
