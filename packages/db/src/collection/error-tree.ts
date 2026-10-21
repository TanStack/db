import { getCollectionBuilder } from '../query/live/collection-registry.js'
import type { ErrorTreeNode } from '../types'
import type { CollectionImpl } from './index.js'

/** A Collection that another Collection reads, under its query alias. */
export interface ErrorTreeSource {
  readonly alias: string
  /** Tells apart two sources under one alias, such as two includes. */
  readonly id?: string
  readonly collection: CollectionImpl<any, any, any, any, any>
  readonly kind?: ErrorTreeNode[`kind`]
}

// One cached node per Collection and source. A node keeps its identity until
// its own fields or one of its children change, so a change replaces only the
// nodes on its path and readers can compare nodes with `===`.
const nodeCache = new WeakMap<object, Map<string, ErrorTreeNode>>()

/**
 * Build the error tree for a Collection. A base Collection is one node. A live
 * query is a node with one child per source alias, in query order, and each
 * child that is itself a live query recurses. The tree is read from current
 * state, so every node mirrors its Collection at the moment it is read.
 */
export function buildErrorTree(
  collection: CollectionImpl<any, any, any, any, any>,
  { alias, id, kind }: Omit<ErrorTreeSource, `collection`> = {
    alias: `root`,
  },
  // The reader that caches this node, so a source's node lives only as long
  // as the query that reads it.
  owner: object = collection,
): ErrorTreeNode {
  // A live query's tree shape comes from its query definition.
  const builder = getCollectionBuilder(collection)
  const sources = builder?.errorTreeSources() ?? []
  const { failureReason, error } = collection._lifecycle.problems
  const children = sources.map((source) =>
    buildErrorTree(source.collection, source, collection),
  )
  return errorTreeNode(owner, id, {
    alias,
    collectionId: collection.id,
    kind: kind ?? (builder ? `live-query` : `source`),
    status: collection.status,
    failureReason,
    error,
    reloading: collection._lifecycle.reloading,
    sources: children,
  })
}

/**
 * A node from its own facts and its children. It has errors when it or
 * anything below it has a `failureReason` or an `error`.
 */
export function errorTreeNode(
  owner: object,
  id: string | undefined,
  fields: Omit<ErrorTreeNode, `hasErrors`>,
): ErrorTreeNode {
  const { failureReason, error, sources } = fields
  return cachedNode(owner, id ?? fields.alias, {
    ...fields,
    hasErrors:
      failureReason !== null ||
      error !== null ||
      sources.some((child) => child.hasErrors),
  })
}

/**
 * Every node in an error tree that shows a problem of its own, in tree order:
 * a `failureReason` or an `error`. A node whose only problems are below it is
 * not listed; its descendants are.
 */
export function findProblems(tree: ErrorTreeNode): Array<ErrorTreeNode> {
  if (!tree.hasErrors) return []
  const ownProblem = tree.failureReason !== null || tree.error !== null
  return [...(ownProblem ? [tree] : []), ...tree.sources.flatMap(findProblems)]
}

/** Return the cached node for this Collection and alias if nothing changed. */
function cachedNode(
  owner: object,
  key: string,
  next: ErrorTreeNode,
): ErrorTreeNode {
  let nodes = nodeCache.get(owner)
  if (!nodes) nodeCache.set(owner, (nodes = new Map()))
  const previous = nodes.get(key)
  if (previous && sameNode(previous, next)) return previous
  nodes.set(key, next)
  return next
}

function sameNode(a: ErrorTreeNode, b: ErrorTreeNode): boolean {
  return (
    a.collectionId === b.collectionId &&
    a.kind === b.kind &&
    a.status === b.status &&
    a.hasErrors === b.hasErrors &&
    a.failureReason === b.failureReason &&
    a.error === b.error &&
    a.reloading === b.reloading &&
    a.sources.length === b.sources.length &&
    a.sources.every((source, index) => source === b.sources[index])
  )
}
