/**
 * Exact Electric guidance handlers receive the real Electric adapter. The SDK
 * stream stays controlled: actual awaitTxId registration precedes delivery of
 * its change and up-to-date message. This supplies no live-provider evidence.
 */
import { resolve } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
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
import { createMockStream } from './electric-stream-mock'
import {
  mockStream,
  mockSubscribe,
  resetElectricOracleMocks,
  upToDate,
} from './electric-adapter-support'
import type { Message } from '@electric-sql/client'
import type { DocumentedRow } from '../../db/tests/documented-mutations-oracle'

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(function () {
    return createMockStream(mockStream)
  }),
}))
const histories = selectDocumentedHistories(
  documentedMutationHistories(`electric`),
)
const reach = createDocumentedReach(`electric`, histories)
afterAll(() => reach.finish())

oracleReplayTest(test).each(histories)(
  `runs the actual documented handler: $id`,
  async (history) => {
    reach.begin(history.id)
    await runDocumentedMutation(
      history,
      resolve(process.cwd(), `../..`),
      (controls) => {
        resetElectricOracleMocks()
        let subscriber!: (messages: Array<Message<DocumentedRow>>) => void
        mockSubscribe.mockImplementationOnce((callback) => {
          subscriber = callback
          return () => {}
        })
        const sourceRequested = createDeferred<void>()
        const collection = createCollection(
          electricCollectionOptions<DocumentedRow>({
            id: `documented-${history.id}`,
            shapeOptions: {
              url: `http://test-url`,
              params: { table: `test_table` },
            },
            getKey: (row) => row.id,
            startSync: true,
            onInsert: controls.handler as () => Promise<void>,
            onUpdate: controls.handler as () => Promise<void>,
            onDelete: controls.handler as () => Promise<void>,
          }),
        )
        const awaitTxId = collection.utils.awaitTxId
        collection.utils.awaitTxId = (...args) =>
          controls.confirmation(async () => {
            const pending = awaitTxId(...args)
            sourceRequested.resolve()
            return pending
          })
        let delivered = false
        const message = (
          row: DocumentedRow,
          operation: `insert` | `update` | `delete`,
          txids?: Array<number>,
        ): Message<DocumentedRow> => ({
          key: String(row.id),
          value: structuredClone(row),
          headers: { operation, ...(txids ? { txids } : {}) },
        })
        const deliver = () => {
          if (delivered) return Promise.resolve()
          delivered = true
          const row = controls
            .server()
            .find((item) => item.id === (history.handler.numeric ? 1 : `1`))
          subscriber([
            message(
              row ?? { id: history.handler.numeric ? 1 : `1` },
              history.mutation.operation,
              [55],
            ),
            upToDate,
          ])
          return Promise.resolve()
        }
        return {
          collection,
          start: async () => {
            subscriber([
              ...controls.initial.map((row) => message(row, `insert`)),
              upToDate,
            ])
            await collection.preload()
          },
          sourceRequested: sourceRequested.promise,
          deliver,
          late: deliver,
          fetches: () => 0,
          providerRequests: () =>
            mockStream.requestSnapshot.mock.calls.length +
            mockStream.fetchSnapshot.mock.calls.length +
            mockStream.forceDisconnectAndRefresh.mock.calls.length,
          cleanup: () => collection.cleanup(),
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
