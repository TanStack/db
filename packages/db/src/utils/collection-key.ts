import type { CollectionLike } from '../types.js'

export function getCollectionKeyPath<
  T extends object,
  TKey extends string | number,
>(collection: CollectionLike<T, TKey>): ReadonlyArray<string> | undefined {
  return collection.getKeyPath?.()
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
