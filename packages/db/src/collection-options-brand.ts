export const collectionOptionsBrand: unique symbol = Symbol.for(
  `@tanstack/db.collectionOptions`,
) as never

export function hasCollectionOptionsBrandValue(
  value: unknown,
): value is { readonly [collectionOptionsBrand]: true } {
  return (
    typeof value === `object` &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[collectionOptionsBrand] === true
  )
}
