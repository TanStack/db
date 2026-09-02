import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createTransaction } from '../../src/transactions.js'
import { projectSyncTransactions } from '../load-subset-full-flow-model.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'

type Row = { id: string; group: string }

describe(`loadSubset transaction refinement`, () => {
  it.each([`at-commit`, `while-parked`, `after-publication-starts`] as const)(
    `matches the independent receipt and publication model when aborting %s`,
    async (abortPhase) => {
      const sourceId = `transaction-refinement-${abortPhase}`
      const transactionId = `subset-transaction`
      const remoteRow: Row = { id: `remote`, group: `requested` }
      const history: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `stageSyncTransaction`,
          transactionId,
          sourceId,
          rowKeys: [remoteRow.id],
        },
        {
          type: `commitSyncTransaction`,
          transactionId,
          parked: true,
          signalAborted: abortPhase === `at-commit`,
        },
      ]
      const controller = new AbortController()
      const persistence = createDeferred<void>()
      const publishedBatches: Array<Array<string>> = []
      const callbackReads: Array<Array<string>> = []
      const source = createCollection<Row>({
        id: sourceId,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: ({ signal }) => {
                begin()
                write({ type: `insert`, value: remoteRow })
                if (abortPhase === `at-commit`) controller.abort()
                return commit(signal)
              },
            }
          },
        },
      })
      source.startSyncImmediate()
      const blocker = createTransaction({
        mutationFn: () => persistence.promise,
      })
      blocker.mutate(() =>
        source.insert({ id: `local`, group: `outside-request` }),
      )
      const subscription = source.subscribeChanges(
        (changes) => {
          const remoteKeys = changes
            .filter((change) => change.key === remoteRow.id)
            .map((change) => String(change.key))
          if (remoteKeys.length === 0) return
          publishedBatches.push(remoteKeys)
          callbackReads.push(source.has(remoteRow.id) ? [remoteRow.id] : [])
          if (abortPhase === `after-publication-starts`) {
            controller.abort()
          }
        },
        { includeInitialState: false },
      )
      const load = source._sync.loadSubset({ signal: controller.signal })
      expect(load).toBeInstanceOf(Promise)

      try {
        if (abortPhase === `while-parked`) {
          controller.abort()
          history.push({ type: `abortSyncTransaction`, transactionId })
        } else if (abortPhase === `after-publication-starts`) {
          history.push(
            { type: `enterSyncApplication`, transactionId },
            { type: `publishSyncTransaction`, transactionId },
            { type: `abortSyncTransaction`, transactionId },
            { type: `settleSyncReceipt`, transactionId },
          )
        }

        persistence.resolve()
        await blocker.isPersisted.promise

        if (abortPhase !== `after-publication-starts`) {
          await expect(load).rejects.toMatchObject({ name: `AbortError` })
        } else {
          await expect(load).resolves.toEqual(
            expect.objectContaining({ collectionId: sourceId }),
          )
        }

        const expected = projectSyncTransactions(history)
        const visibleRows = source.has(remoteRow.id)
          ? [{ sourceId, rowKey: remoteRow.id }]
          : []

        expect(visibleRows).toEqual(expected.visibleRows)
        expect(publishedBatches).toEqual(
          expected.publishedBatches.map((batch) =>
            batch.map(({ rowKey }) => rowKey),
          ),
        )
        expect(callbackReads).toEqual(
          expected.callbackReads.map((rows) =>
            rows.map(({ rowKey }) => rowKey),
          ),
        )
        expect(expected.receipts).toEqual([
          {
            transactionId,
            state:
              abortPhase === `after-publication-starts`
                ? `resolved`
                : `rejected`,
          },
        ])
      } finally {
        persistence.resolve()
        await blocker.isPersisted.promise.catch(() => undefined)
        subscription.unsubscribe()
        await source.cleanup()
      }
    },
  )
})
