import { BaseQueryBuilder, IR, isCollection } from '@tanstack/db'
import type { DbClient } from '@tanstack/db'

const sourceObjectTokens = new WeakMap<object, number>()
let nextSourceObjectToken = 0

export function getSourceObjectToken(source: object): number {
  let id = sourceObjectTokens.get(source)
  if (id === undefined) {
    id = ++nextSourceObjectToken
    sourceObjectTokens.set(source, id)
  }
  return id
}

export function getPreparedSources(
  preparedValue: unknown,
  client?: DbClient,
  hookName?: string,
): Array<{ id: string }> {
  if (isCollection(preparedValue)) return [preparedValue]
  const query =
    preparedValue instanceof BaseQueryBuilder
      ? preparedValue
      : preparedValue &&
          typeof preparedValue === `object` &&
          `query` in preparedValue &&
          preparedValue.query instanceof BaseQueryBuilder
        ? preparedValue.query
        : undefined
  if (!query) return []
  return IR.collectSourceRefs(query._getQuery()).map((source) => {
    if (source.type === `descriptorRef`) {
      if (!client && hookName) {
        throw new Error(
          `[${hookName}] Collection descriptor "${source.alias}" requires a DbClient when the query is consumed. Wrap this component in <DbProvider client={client}> or use a concrete Collection.`,
        )
      }
      return IR.requireCollectionSource(source)
    }
    return source.collection
  })
}

/** The source object each Collection ID named while one hook is mounted. */
export type SourceIdBindings = {
  unscoped: Map<string, number>
  byClient: WeakMap<DbClient, Map<string, number>>
}

export function createSourceIdBindings(): SourceIdBindings {
  return { unscoped: new Map(), byClient: new WeakMap() }
}

/**
 * Derived query identity names each source by its Collection ID. While a hook
 * is mounted, an ID must keep naming one source object in each client scope,
 * or the hook could reuse a live query that reads the old source. Claims the
 * prepared value's sources, or calls `release` and throws on a collision so a
 * rejected render keeps no sync-start deferral.
 */
export function claimSourceIds(
  bindings: SourceIdBindings,
  preparedValue: unknown,
  client: DbClient | undefined,
  hookName: string,
  release: () => void,
): void {
  const prior = client ? bindings.byClient.get(client) : bindings.unscoped
  const seen = new Map<string, number>()
  for (const source of getPreparedSources(preparedValue, client, hookName)) {
    const token = getSourceObjectToken(source)
    const previous = seen.get(source.id) ?? prior?.get(source.id)
    if (previous !== undefined && previous !== token) {
      release()
      throw new Error(
        `[${hookName}] Source Collection "${source.id}" was replaced by a different Collection with the same ID while this hook is mounted. Unmount the hook and clean up its previous source and client scope before reusing the ID.`,
      )
    }
    seen.set(source.id, token)
  }
  const claimed = prior ?? new Map<string, number>()
  for (const [id, token] of seen) claimed.set(id, token)
  if (client) bindings.byClient.set(client, claimed)
}

/**
 * Resumes every deferred sync start, then rethrows the first startup error, so
 * one failing source cannot keep a later shared source deferred.
 */
export function resumeSyncStarts(
  collections: Set<{ _resumeSyncStart: () => void }>,
): void {
  const pending = Array.from(collections)
  collections.clear()
  const errors: Array<unknown> = []
  for (const collection of pending) {
    try {
      collection._resumeSyncStart()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw errors[0]
}
