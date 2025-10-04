import type { Collection } from "../../collection/index.js"
import type { CollectionConfigBuilder } from "./collection-config-builder.js"

const BUILDER_SYMBOL = Symbol.for(`@tanstack/db.collection-config-builder`)

const collectionBuilderRegistry = new WeakMap<
  Collection<any, any, any>,
  CollectionConfigBuilder<any, any>
>()

export function attachBuilderToConfig(
  config: object,
  builder: CollectionConfigBuilder<any, any>
): void {
  Object.defineProperty(config, BUILDER_SYMBOL, {
    value: builder,
    configurable: false,
    enumerable: false,
    writable: false,
  })
}

export function getBuilderFromConfig(
  config: object
): CollectionConfigBuilder<any, any> | undefined {
  return (config as any)[BUILDER_SYMBOL]
}

export function registerCollectionBuilder(
  collection: Collection<any, any, any>,
  builder: CollectionConfigBuilder<any, any>
): void {
  collectionBuilderRegistry.set(collection, builder)
}

export function getCollectionBuilder(
  collection: Collection<any, any, any>
): CollectionConfigBuilder<any, any> | undefined {
  return collectionBuilderRegistry.get(collection)
}
