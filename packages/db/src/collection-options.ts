import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { CollectionConfig, UtilsRecord } from './types.js'

export const collectionOptionsBrand: unique symbol = Symbol.for(
  `@tanstack/db.collectionOptions`,
) as never

export const collectionOptionsFactory: unique symbol = Symbol.for(
  `@tanstack/db.collectionOptions.factory`,
) as never

export type CollectionOptionsIdentity<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
  TClient = unknown,
> = {
  readonly id: string
  readonly [collectionOptionsBrand]: true
  readonly [collectionOptionsFactory]: (
    client: TClient,
  ) => CollectionConfig<T, TKey, TSchema, TUtils>
}

export function hasCollectionOptionsBrand(
  value: unknown,
): value is CollectionOptionsIdentity<any, string | number, any, any, any> {
  return (
    typeof value === `object` &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[collectionOptionsBrand] === true
  )
}
