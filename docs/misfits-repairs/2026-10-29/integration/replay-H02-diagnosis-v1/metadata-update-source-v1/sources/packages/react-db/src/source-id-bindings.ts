import { getPreparedLiveQuerySources } from '@tanstack/db'
import type { DbClient } from '@tanstack/db'

/**
 * Reports a descriptor source that no DbClient bound, naming the provider a
 * React tree needs. Returns `undefined` when a client can bind descriptors.
 */
export function getUnboundDescriptorReporter(
  client: DbClient | undefined,
  hookName: string,
): ((alias: string) => never) | undefined {
  if (client) return undefined
  return (alias) => {
    throw new Error(
      `[${hookName}] Collection descriptor "${alias}" requires a DbClient when the query is consumed. Wrap this component in <DbProvider client={client}> or use a concrete Collection.`,
    )
  }
}

export function getPreparedSources(
  preparedValue: unknown,
  client: DbClient | undefined,
  hookName: string,
): Array<{ id: string }> {
  return getPreparedLiveQuerySources(
    preparedValue,
    getUnboundDescriptorReporter(client, hookName),
  )
}
