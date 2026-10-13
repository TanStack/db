import type { CollectionErrorInfo, ErrorTreeNode } from '../types'
import type { CollectionImpl } from './index.js'

/** A Collection that another Collection reads, under its query alias. */
export interface ErrorTreeSource {
  readonly alias: string
  readonly collection: CollectionImpl<any, any, any, any, any>
}

/**
 * Build the error tree for a Collection. A base Collection is one node. A live
 * query is a node with one child per source alias, in query order, and each
 * child that is itself a live query recurses. The tree is read from current
 * state, so every node mirrors its Collection at the moment it is read.
 */
export function buildErrorTree(
  collection: CollectionImpl<any, any, any, any, any>,
  alias: string = `root`,
): ErrorTreeNode {
  const sources = collection._errorTreeSources?.() ?? []
  const lifecycle = collection._lifecycle
  const error: CollectionErrorInfo | null =
    lifecycle.gateProblem ?? lifecycle.health.error
  const children = sources.map((source) =>
    buildErrorTree(source.collection, source.alias),
  )
  return {
    alias,
    collectionId: collection.id,
    kind: collection._errorTreeSources ? `live-query` : `source`,
    status: collection.status,
    isError: error !== null,
    hasErrors: error !== null || children.some((child) => child.hasErrors),
    error,
    sources: children,
  }
}
