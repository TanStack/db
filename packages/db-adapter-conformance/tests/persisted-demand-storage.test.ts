/** Calibrate input tracking separately from the shared product judgment. */
import { expect, test } from 'vitest'
import { storageLedger } from './persisted-demand-receiving-driver'
import type {
  PersistedCollectionPersistence,
  PersistenceAdapter,
  RegularScope,
} from '../../db-sqlite-persistence-core/src'

function adapter(): PersistenceAdapter {
  return {
    loadSubset: () => Promise.resolve([]),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
}

for (const route of [`direct`, `collection`, `mode`] as const) {
  test(`tracks held storage through the ${route} adapter route`, async () => {
    let release!: (rows: []) => void
    const held = new Promise<[]>((resolve) => {
      release = resolve
    })
    const actual = adapter()
    actual.loadSubset = function () {
      expect(this).toBe(actual)
      return held
    }
    const resolved = { adapter: actual }
    let resolverReceiver: unknown
    const input: PersistedCollectionPersistence = {
      adapter: route === `direct` ? actual : adapter(),
      resolvePersistenceForCollection(options) {
        resolverReceiver = this
        expect(options).toEqual({ collectionId: `test`, mode: `sync-present` })
        return resolved
      },
      resolvePersistenceForMode(mode) {
        resolverReceiver = this
        expect(mode).toBe(`sync-present`)
        return resolved
      },
    }
    const ledger = storageLedger(input)
    const selected =
      route === `collection`
        ? ledger.persistence.resolvePersistenceForCollection!({
            collectionId: `test`,
            mode: `sync-present`,
          })
        : route === `mode`
          ? ledger.persistence.resolvePersistenceForMode!(`sync-present`)
          : ledger.persistence
    const promise = selected.adapter.loadSubset(
      { kind: `eager`, collectionId: `test` },
      {},
    )
    try {
      expect(promise).toBe(held)
      expect(ledger.diagnostic(new Set())).toEqual({
        revision: 1,
        pending: 1,
        receipts: 0,
      })
      if (route !== `direct`) expect(resolverReceiver).toBe(input)
      let finished = false
      const barrier = ledger
        .barrier({ barrier: async () => {} }, new Set())
        .then(() => {
          finished = true
        })
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(finished).toBe(false)
      release([])
      await barrier
      expect(ledger.diagnostic(new Set())).toEqual({
        revision: 2,
        pending: 0,
        receipts: 0,
      })
    } finally {
      release([])
      await promise
    }
  })
}

test(`preserves callable storage capabilities and their original promise`, async () => {
  const actual = adapter()
  const queued = Promise.resolve()
  const afterQueuedWork = () => queued
  const scope: RegularScope = Object.assign(
    <T>(task: (value: PersistenceAdapter) => Promise<T>) => task(actual),
    { afterQueuedWork },
  )
  actual.runInRegularScope = scope
  const ledger = storageLedger({ adapter: actual })
  expect(ledger.persistence.adapter.runInRegularScope!.afterQueuedWork).toBe(
    afterQueuedWork,
  )
  expect(ledger.persistence.adapter.runInRegularScope!.afterQueuedWork()).toBe(
    queued,
  )
  const result = Promise.resolve(42)
  expect(
    ledger.persistence.adapter.runInRegularScope!((value) => {
      expect(value).toBe(actual)
      return result
    }),
  ).toBe(result)
  await result
})
