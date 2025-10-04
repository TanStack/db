import type { Collection } from "../../collection/index.js"
import type { CollectionConfigBuilder } from "./collection-config-builder.js"

const BUILDER_SYMBOL = Symbol.for(`@tanstack/db.collection-config-builder`)

const collectionBuilderRegistry = new WeakMap<
  Collection<any, any, any>,
  CollectionConfigBuilder<any, any>
>()

/**
 * Attaches a builder to a config object via a non-enumerable symbol property.
 * Used for dependency tracking between live queries.
 *
 * @param config - The collection config object to attach the builder to
 * @param builder - The builder instance to attach
 */
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

/**
 * Retrieves the builder attached to a config object.
 *
 * @param config - The collection config object
 * @returns The attached builder, or `undefined` if none exists
 */
export function getBuilderFromConfig(
  config: object
): CollectionConfigBuilder<any, any> | undefined {
  return (config as any)[BUILDER_SYMBOL]
}

/**
 * Registers a builder for a collection in the global registry.
 * Used to detect when a live query depends on another live query,
 * enabling the scheduler to ensure parent queries run first.
 *
 * @param collection - The collection to register the builder for
 * @param builder - The builder that produces this collection
 */
export function registerCollectionBuilder(
  collection: Collection<any, any, any>,
  builder: CollectionConfigBuilder<any, any>
): void {
  collectionBuilderRegistry.set(collection, builder)
}

/**
 * Retrieves the builder registered for a collection.
 * Used to discover dependencies when a live query subscribes to another live query.
 *
 * @param collection - The collection to look up
 * @returns The registered builder, or `undefined` if none exists
 */
export function getCollectionBuilder(
  collection: Collection<any, any, any>
): CollectionConfigBuilder<any, any> | undefined {
  return collectionBuilderRegistry.get(collection)
}
