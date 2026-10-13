import type { CollectionErrorInfo, ErrorTreeNode } from '../types'
import type { CollectionImpl } from './index.js'

/** A Collection that another Collection reads, under its query alias. */
export interface ErrorTreeSource {
  readonly alias: string
  /** Tells apart two sources under one alias, such as two includes. */
  readonly id?: string
  readonly collection: CollectionImpl<any, any, any, any, any>
  readonly kind?: ErrorTreeNode[`kind`]
  /** An include's per-row child Collections, for its `instances` roll-up. */
  readonly instances?: () => ReadonlyArray<
    CollectionImpl<any, any, any, any, any>
  >
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
  { alias, id, kind, instances }: Omit<ErrorTreeSource, `collection`> = {
    alias: `root`,
  },
): ErrorTreeNode {
  const sources = collection._errorTreeSources?.() ?? []
  const lifecycle = collection._lifecycle
  const error: CollectionErrorInfo | null =
    lifecycle.gateProblem ?? lifecycle.health.error
  const children = sources.map((source) =>
    buildErrorTree(source.collection, source),
  )
  return errorTreeNode(collection, id, {
    alias,
    collectionId: collection.id,
    kind: kind ?? (collection._errorTreeSources ? `live-query` : `source`),
    status: collection.status,
    error,
    ...(instances ? { instances: countInstances(instances()) } : {}),
    sources: children,
  })
}

/**
 * A node from its own facts and its children. The node is in error when it
 * has a problem, and has errors when it or anything below it does.
 */
export function errorTreeNode(
  owner: object,
  id: string | undefined,
  fields: Omit<ErrorTreeNode, `isError` | `hasErrors`>,
): ErrorTreeNode {
  const { error, instances, sources } = fields
  return cachedNode(owner, id ?? fields.alias, {
    ...fields,
    isError: error !== null,
    hasErrors:
      error !== null ||
      (instances?.inError ?? 0) > 0 ||
      sources.some((child) => child.hasErrors),
  })
}

function countInstances(
  collections: ReadonlyArray<CollectionImpl<any, any, any, any, any>>,
): { total: number; inError: number } {
  let inError = 0
  for (const instance of collections) {
    if (instance.status === `error` || instance.health.isError) inError++
  }
  return { total: collections.length, inError }
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
    a.isError === b.isError &&
    a.hasErrors === b.hasErrors &&
    a.error === b.error &&
    a.instances?.total === b.instances?.total &&
    a.instances?.inError === b.instances?.inError &&
    a.sources.length === b.sources.length &&
    a.sources.every((source, index) => source === b.sources[index])
  )
}
