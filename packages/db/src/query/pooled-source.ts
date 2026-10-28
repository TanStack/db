import type { CollectionImpl } from '../collection/index.js'

// A pooled view's source Collection. A view registers here when it is
// created, so the live-query observer finds the source without bundling
// pooling into apps that never import `pooledLiveQueries`.
const pooledSources = new WeakMap<
  object,
  CollectionImpl<any, any, any, any, any>
>()

export function registerPooledSource(
  view: object,
  source: CollectionImpl<any, any, any, any, any>,
): void {
  pooledSources.set(view, source)
}

export function getPooledLiveQuerySource(
  value: unknown,
): CollectionImpl<any, any, any, any, any> | undefined {
  return typeof value === `object` && value !== null
    ? pooledSources.get(value)
    : undefined
}
