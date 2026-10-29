/**
 * Exact Query guidance handlers receive a real QueryClient and Query adapter.
 * The shared documentation grammar and mutation judgment own all expectations.
 * queryFn response delivery is held before it returns server rows; no automatic
 * fetch is supplied by the fixture. This is a controlled backend receiver.
 */
import { resolve } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'
import { createDeferred } from '../../db/src/deferred'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleReplayTest } from '../../db/tests/oracle-config'
import {
  checkDocumentedMutation,
  documentedMutationHistories,
} from '../../db/tests/documented-mutations-oracle'
import {
  createDocumentedReach,
  runDocumentedMutation,
  selectDocumentedHistories,
} from '../../db/tests/documented-mutations-support'
import type { DocumentedRow } from '../../db/tests/documented-mutations-oracle'
import type { QueryCollectionConfig } from '../src/query'

const histories = selectDocumentedHistories(
  documentedMutationHistories(`query`),
)
const reach = createDocumentedReach(`query`, histories)
afterAll(() => reach.finish())

oracleReplayTest(test).each(histories)(
  `runs the actual documented handler: $id`,
  async (history) => {
    reach.begin(history.id)
    await runDocumentedMutation(
      history,
      resolve(process.cwd(), `../..`),
      (controls) => {
        const client = new QueryClient({
          defaultOptions: {
            queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
          },
        })
        const sourceRequested = createDeferred<void>(),
          sourceGate = createDeferred<void>()
        let started = false
        const queryFn = vi.fn(async () => {
          if (started) {
            sourceRequested.resolve()
            await sourceGate.promise
          }
          return controls.server()
        })
        type Config = QueryCollectionConfig<DocumentedRow>
        const collection = createCollection(
          queryCollectionOptions<DocumentedRow>({
            queryKey: [`documented`, history.id],
            queryClient: client,
            queryFn,
            getKey: (row) => row.id,
            onInsert: controls.handler as NonNullable<Config[`onInsert`]>,
            onUpdate: controls.handler as NonNullable<Config[`onUpdate`]>,
            onDelete: controls.handler as NonNullable<Config[`onDelete`]>,
          }),
        )
        const refetch = collection.utils.refetch
        collection.utils.refetch = (...args) =>
          controls.confirmation(() => refetch(...args))
        const writeBatch = collection.utils.writeBatch,
          writeInsert = collection.utils.writeInsert,
          writeUpdate = collection.utils.writeUpdate,
          writeUpsert = collection.utils.writeUpsert
        collection.utils.writeBatch = (...args) =>
          controls.confirmation(() => writeBatch(...args))
        collection.utils.writeInsert = (...args) =>
          controls.confirmation(() => writeInsert(...args))
        collection.utils.writeUpdate = (...args) =>
          controls.confirmation(() => writeUpdate(...args))
        collection.utils.writeUpsert = (...args) =>
          controls.confirmation(() => writeUpsert(...args))
        return {
          collection,
          start: async () => {
            await collection.preload()
            started = true
          },
          deliver: () => {
            sourceGate.resolve()
            return Promise.resolve()
          },
          sourceRequested: sourceRequested.promise,
          late: async () => {
            sourceGate.resolve()
            await collection.utils.refetch()
          },
          fetches: () => queryFn.mock.calls.length,
          providerRequests: () => 0,
          cleanup: async () => {
            await collection.cleanup()
            client.clear()
          },
        }
      },
      reach.reach,
    )
  },
)

declareOracle({
  check: [checkDocumentedMutation],
  grammar: [documentedMutationHistories],
})
