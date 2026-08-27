import {
  createSingleRowRefProxy,
  isRefProxy,
} from '../query/builder/ref-proxy.js'
import type { CollectionLike } from '../types.js'

type KeyAccessor = (item: any) => string | number

type KeyAccessorMetadata = {
  getKey: KeyAccessor
  inferred: boolean
  path: ReadonlyArray<string> | undefined
}

const keyAccessorMetadata = new WeakMap<object, KeyAccessorMetadata>()

const keyProbeValues: ReadonlyArray<unknown> = [
  ``,
  `key-probe`,
  0,
  1,
  -1,
  Number.NaN,
  null,
  undefined,
  false,
]

class UnexpectedKeyAccess extends Error {}

function createKeyProbe(
  keyPath: ReadonlyArray<string>,
  keyValue: unknown,
): object {
  const proxies = new Map<string, object>()

  const createProxy = (path: ReadonlyArray<string>): object => {
    const pathKey = path.join(`.`)
    const existing = proxies.get(pathKey)
    if (existing) return existing

    const proxy = new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property === `symbol`) {
            throw new UnexpectedKeyAccess()
          }

          const nextPath = [...path, property]
          if (
            nextPath.length === keyPath.length &&
            nextPath.every((part, index) => part === keyPath[index])
          ) {
            return keyValue
          }

          if (
            nextPath.length < keyPath.length &&
            nextPath.every((part, index) => part === keyPath[index])
          ) {
            return createProxy(nextPath)
          }

          throw new UnexpectedKeyAccess()
        },
      },
    )
    proxies.set(pathKey, proxy)
    return proxy
  }

  return createProxy([])
}

function inferKeyPath(getKey: KeyAccessor): ReadonlyArray<string> | undefined {
  let result: unknown
  try {
    result = getKey(createSingleRowRefProxy())
  } catch {
    return undefined
  }

  if (!isRefProxy(result) || result.__path.length === 0) {
    return undefined
  }

  const path = Object.freeze([...result.__path])
  for (const keyValue of keyProbeValues) {
    try {
      if (!Object.is(getKey(createKeyProbe(path, keyValue)), keyValue)) {
        return undefined
      }
    } catch {
      return undefined
    }
  }

  return path
}

/** @internal Records the collection's existing key accessor for lazy planning. */
export function registerCollectionKeyAccessor(
  collection: object,
  getKey: KeyAccessor,
): void {
  keyAccessorMetadata.set(collection, {
    getKey,
    inferred: false,
    path: undefined,
  })
}

export function getCollectionKeyPath<
  T extends object,
  TKey extends string | number,
>(collection: CollectionLike<T, TKey>): ReadonlyArray<string> | undefined {
  const metadata = keyAccessorMetadata.get(collection)
  if (!metadata) return undefined

  if (!metadata.inferred) {
    metadata.path = inferKeyPath(metadata.getKey)
    metadata.inferred = true
  }
  return metadata.path
}

export function isCollectionKeyPath<
  T extends object,
  TKey extends string | number,
>(
  collection: CollectionLike<T, TKey>,
  fieldPath: ReadonlyArray<string>,
): boolean {
  const keyPath = getCollectionKeyPath(collection)
  return (
    keyPath !== undefined &&
    keyPath.length === fieldPath.length &&
    keyPath.every((part, index) => part === fieldPath[index])
  )
}

export function lookupCollectionKeys<
  T extends object,
  TKey extends string | number,
>(
  collection: CollectionLike<T, TKey>,
  values: ReadonlyArray<unknown>,
): Set<TKey> {
  const matchingKeys = new Set<TKey>()
  for (const value of values) {
    if (
      (typeof value === `string` || typeof value === `number`) &&
      collection.has(value as TKey)
    ) {
      matchingKeys.add(value as TKey)
    }
  }
  return matchingKeys
}
