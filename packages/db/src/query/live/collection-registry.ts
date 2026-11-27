import { LIVE_QUERY_INTERNAL } from './internal.js'
import type { Collection } from '../../collection/index.js'
import type { CollectionConfigBuilder } from './collection-config-builder.js'

/**
 * Retrieves the builder attached to a config object via its internal utils.
 *
 * @param config - The collection config object
 * @returns The attached builder, or `undefined` if none exists
 */
export function getBuilderFromConfig(
  config: object,
): CollectionConfigBuilder<any, any> | undefined {
  return (config as any).utils?.[LIVE_QUERY_INTERNAL]?.getBuilder?.()
}

/**
 * Retrieves the builder of a live query collection, however the collection was
 * created. Used to discover dependencies when a live query reads another one.
 *
 * @param collection - The collection to look up
 * @returns The builder, or `undefined` if it is not a live query collection
 */
export function getCollectionBuilder(
  collection: Collection<any, any, any>,
): CollectionConfigBuilder<any, any> | undefined {
  return getBuilderFromConfig(collection.config)
}
