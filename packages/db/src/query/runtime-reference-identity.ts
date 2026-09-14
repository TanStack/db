export type RuntimeReferenceIdentity = [
  `runtimeReference`,
  namespace: string,
  sequence: number,
]

type ReferenceIdStore<TKey> = {
  get: (key: TKey) => number | undefined
  set: (key: TKey, value: number) => unknown
}

export function createRuntimeReferenceIdentityFactory(): (
  value: object | symbol,
) => RuntimeReferenceIdentity {
  const referenceIds = new WeakMap<object, number>()
  let localSymbolIds: ReferenceIdStore<symbol> | undefined
  let registeredSymbolIds: Map<string, number> | undefined
  let namespace: string | undefined
  let sequence = 0

  const getReferenceId = <TKey>(
    ids: ReferenceIdStore<TKey>,
    key: TKey,
  ): number => {
    let referenceId = ids.get(key)
    if (referenceId === undefined) {
      referenceId = ++sequence
      ids.set(key, referenceId)
    }
    return referenceId
  }

  return (value) => {
    namespace ??= createRuntimeReferenceNamespace()
    let referenceId: number
    if (typeof value === `symbol`) {
      const registeredKey = Symbol.keyFor(value)
      if (registeredKey === undefined) {
        localSymbolIds ??= createLocalSymbolIdStore()
        referenceId = getReferenceId(localSymbolIds, value)
      } else {
        registeredSymbolIds ??= new Map<string, number>()
        referenceId = getReferenceId(registeredSymbolIds, registeredKey)
      }
    } else {
      referenceId = getReferenceId(referenceIds, value)
    }
    return [`runtimeReference`, namespace, referenceId]
  }
}

function createLocalSymbolIdStore(): ReferenceIdStore<symbol> {
  const weakIds = new WeakMap<
    object,
    number
  >() as unknown as ReferenceIdStore<symbol>
  const probe = Symbol()

  try {
    weakIds.set(probe, 0)
    if (weakIds.get(probe) === 0) return weakIds
  } catch {
    // Older runtimes reject symbols as weak keys. Retain them rather than
    // collapse distinct symbols and corrupt equality.
  }

  return new Map<symbol, number>()
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
