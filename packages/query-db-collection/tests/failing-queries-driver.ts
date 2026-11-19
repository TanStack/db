/** Real Query cache/fetch and select receivers for the latest-error oracle. */
import { createCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createPersistedQueryAdapter } from './query-persistence-harness'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { FailingQueryHistory } from './failing-queries-oracle'

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The production driver. After each step it records, as relations: how many
 * errors this fetch injects, their values and messages, and whether select
 * consumed an injected application refusal. Fetch-stage errors reject queryFn;
 * select-stage errors travel in an otherwise fulfilled raw response. Listed
 * causes and the shown cause use value numbers (-1 for an uninjected cause).
 * The driver also records the shown message, whether each
 * listed failure that was listed before keeps its `at`, whether the node and
 * its `failureReason` object are the same objects as before the step, and
 * how many `health:change` events the step announced.
 */
export async function recordFailingQueries(
  history: FailingQueryHistory,
  observe: (checkpoint: string, value: unknown) => void,
  persistence: PersistedCollectionPersistence = {
    adapter: createPersistedQueryAdapter(),
  },
): Promise<void> {
  const { persisted, index } = history
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const failing = new Map<number, `fresh` | `shared`>()
  const shared = new Error(`offline`)
  // The error value each failed fetch threw, in fetch order, and the
  // distinct values in the order they were first thrown.
  const thrown: Array<Error> = []
  const values: Array<Error> = []
  const selectRefusals = new Set<Error>()
  let revision = 0
  type ResponseRow = { id: number; refusal?: Error; revision: number }
  const options = queryCollectionOptions({
    id: `failing-queries-${persisted}-${index}`,
    queryKey: [`failing-queries`, persisted, index],
    queryClient: client,
    getKey: (row: { id: number }) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    select: (rows: Array<ResponseRow>) => {
      for (const row of rows) {
        if (row.refusal) {
          selectRefusals.add(row.refusal)
          throw row.refusal
        }
      }
      return rows.map(({ id }) => ({ id }))
    },
    queryFn: (ctx): Promise<Array<ResponseRow>> => {
      const limit = (
        ctx.meta?.loadSubsetOptions as { limit?: number } | undefined
      )?.limit
      const fails = failing.get(limit!)
      const row = { id: limit!, revision: revision++ }
      if (!fails) return Promise.resolve([row])
      const error =
        fails === `shared`
          ? shared
          : new Error(`subset ${limit} failure ${thrown.length}`)
      thrown.push(error)
      if (!values.includes(error)) values.push(error)
      if (history.failureStage === `select`)
        return Promise.resolve([{ ...row, refusal: error }])
      return Promise.reject(error)
    },
  })
  const collection = createCollection(
    persisted
      ? (persistedCollectionOptions({
          ...options,
          persistence,
        }) as unknown as typeof options)
      : options,
  )
  const consoleError = console.error
  const consoleWarn = console.warn
  console.error = () => {}
  console.warn = () => {}
  const refetch = async (limit: number) => {
    if (history.failureStage === `select`) {
      // A Query fetch may fulfill before an asynchronous persisted result
      // applies. A refreshed subset load owes applied settlement, so it gives
      // Node and OPFS the same documented comparison cut without polling the
      // expected health value into existence.
      await Promise.resolve(
        collection._sync.loadSubset({ limit, refetch: true }),
      ).catch(() => undefined)
      return
    }
    const query = client
      .getQueryCache()
      .findAll()
      .find(
        (q) =>
          (q.meta?.loadSubsetOptions as { limit?: number } | undefined)
            ?.limit === limit,
      )!
    await query.fetch().catch(() => undefined)
    await flushPromises()
  }
  let healthChanges = 0
  const stopHealth = collection.on(`health:change`, () => {
    healthChanges++
  })
  return withOracleCleanup(async () => {
    await collection._sync.loadSubset({ limit: 1 })
    await collection._sync.loadSubset({ limit: 2 })
    await flushPromises()
    for (const { subset, fails } of history.fetches) {
      const before = {
        node: collection.health,
        failureReason: collection.health.failureReason,
        changes: healthChanges,
      }
      if (fails) failing.set(subset, fails)
      else failing.delete(subset)
      const thrownBefore = thrown.length
      selectRefusals.clear()
      await refetch(subset)
      const problem = collection.health.failureReason
      observe(`step`, {
        thrownDelta: thrown.length - thrownBefore,
        threw:
          thrown.length > thrownBefore ? values.indexOf(thrown.at(-1)!) : null,
        threwMessage:
          thrown.length > thrownBefore ? thrown.at(-1)!.message : null,
        listed: (problem?.errors ?? []).map((entry) =>
          values.indexOf(entry.cause as Error),
        ),
        shown: problem === null ? null : values.indexOf(problem.cause as Error),
        shownMessage: problem?.message ?? null,
        atKept: (problem?.errors ?? []).map((entry) => {
          const kept = before.failureReason?.errors.find(
            (prior) => prior.cause === entry.cause,
          )
          return kept === undefined ? null : kept.at === entry.at
        }),
        sameNode: collection.health === before.node,
        sameFailureReason: problem === before.failureReason,
        changes: healthChanges - before.changes,
        refusalReached:
          !fails ||
          (history.failureStage === `select` &&
            selectRefusals.has(thrown.at(-1)!)),
        status: collection.status,
        // The law retains user row data. These four reserved virtual root
        // fields are Collection attribution, owned by the virtual-props oracle.
        // Keep every other field, so a leaked response/revision is visible.
        rows: collection.toArray
          .sort((left, right) => left.id - right.id)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(
                ([key]) =>
                  ![
                    `$collectionId`,
                    `$hasPendingWrites`,
                    `$key`,
                    `$origin`,
                  ].includes(key),
              ),
            ),
          ),
        observers: client
          .getQueryCache()
          .findAll()
          .reduce((count, query) => count + query.getObserversCount(), 0),
      })
    }
  }, [
    stopHealth,
    () => {
      console.error = consoleError
      console.warn = consoleWarn
    },
    () => collection.cleanup(),
    () => client.clear(),
  ])
}
