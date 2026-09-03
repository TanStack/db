import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createTransaction } from '../../src/transactions.js'

type Row = { id: string; group: string }

describe(`loadSubset transaction refinement`, () => {
  it.each([`at-commit`, `while-parked`, `after-publication-starts`] as const)(
    `matches the independent receipt and publication model when aborting %s`,
    async (abortPhase) => {
      const sourceId = `transaction-refinement-${abortPhase}`
      const remoteRow: Row = { id: `remote`, group: `requested` }
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
        }

        persistence.resolve()
        await blocker.isPersisted.promise

        if (abortPhase !== `after-publication-starts`) {
          await expect(load).rejects.toMatchObject({ name: `AbortError` })
        } else {
          await expect(load).resolves.toBeUndefined()
        }

        const published = abortPhase === `after-publication-starts`
        expect(source.has(remoteRow.id)).toBe(published)
        expect(publishedBatches).toEqual(published ? [[remoteRow.id]] : [])
        expect(callbackReads).toEqual(published ? [[remoteRow.id]] : [])
      } finally {
        persistence.resolve()
        await blocker.isPersisted.promise.catch(() => undefined)
        subscription.unsubscribe()
        await source.cleanup()
      }
    },
  )
})
