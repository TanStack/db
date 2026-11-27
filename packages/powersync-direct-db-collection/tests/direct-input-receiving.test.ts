import { expect, test } from 'vitest'
import { createDirectInputLedger } from './direct-input-receiving'
import type { StreamLease } from '@powersync/standalone-client'
import type {
  PersistedCollectionPersistence,
  PersistenceAdapter,
  RegularScope,
} from '../../db-sqlite-persistence-core/src'

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
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

test(`SDK observation forwards the original promise, signal and lease receiver`, async () => {
  const input = createDirectInputLedger()
  const pending = deferred<void>()
  const controller = new AbortController()
  let releases = 0
  const actual: StreamLease = {
    waitForSync(signal) {
      expect(this).toBe(actual)
      expect(signal).toBe(controller.signal)
      return pending.promise
    },
    release() {
      expect(this).toBe(actual)
      releases++
    },
  }
  const lease = input.receiveStreamLease(actual)
  expect(lease.waitForSync(controller.signal)).toBe(pending.promise)
  expect(input.snapshot().pendingSDK).toBe(1)
  lease.release()
  expect(releases).toBe(1)
  expect(input.snapshot().pendingSDK).toBe(0)
  const reason = Object.create(null)
  pending.reject(reason)
  await expect(pending.promise).rejects.toBe(reason)
  expect(input.snapshot().work.at(-1)).toMatchObject({
    state: `rejected`,
    error: `[unprintable cleanup error]`,
    ignored: true,
  })
})

test(`an aborted SDK wait supplies no further provider-input obligation`, async () => {
  const input = createDirectInputLedger()
  const controller = new AbortController()
  const pending = deferred<void>()
  input
    .receiveStreamLease({
      waitForSync: () => pending.promise,
      release: () => {},
    })
    .waitForSync(controller.signal)
  controller.abort()
  await input.drain(`provider`)
  expect(input.snapshot().pendingSDK).toBe(0)
  pending.resolve()
})

test(`provider cuts retain held receipt and storage diagnostics while applied cuts wait`, async () => {
  const input = createDirectInputLedger()
  const receipt = deferred<void>()
  const storage =
    deferred<Awaited<ReturnType<PersistenceAdapter['loadSubset']>>>()
  expect(input.receipt(true)).toBe(true)
  expect(input.receipt(receipt.promise)).toBe(receipt.promise)
  const actual = adapter()
  actual.loadSubset = () => storage.promise
  expect(
    input
      .persistence({ adapter: actual })
      .adapter.loadSubset({ kind: `eager`, collectionId: `saved` }, {}),
  ).toBe(storage.promise)
  const provider = await input.drain(`provider`)
  expect(provider.pendingReceipts).toBe(1)
  expect(provider.pendingStorage).toEqual([`loadSubset`])
  let applied = false
  const completion = input.drain().then(() => {
    applied = true
  })
  for (let index = 0; index < 6; index++) await turn()
  expect(applied).toBe(false)
  receipt.resolve()
  storage.resolve([])
  await completion
  expect(applied).toBe(true)
})

test(`resolved persistence forwards exact arguments, receiver and result promise`, async () => {
  const input = createDirectInputLedger()
  const result =
    deferred<Awaited<ReturnType<PersistenceAdapter['loadSubset']>>>()
  const actual = adapter()
  const target = { kind: `eager`, collectionId: `saved` } as const
  const options = { limit: 2 }
  const context = { cacheGenerationClaimId: `claim` }
  actual.loadSubset = function (
    receivedTarget,
    receivedOptions,
    receivedContext,
  ) {
    expect(this).toBe(actual)
    expect(receivedTarget).toBe(target)
    expect(receivedOptions).toBe(options)
    expect(receivedContext).toBe(context)
    return result.promise
  }
  const child: PersistedCollectionPersistence = { adapter: actual }
  const scope = { collectionId: `saved`, mode: `sync-present` } as const
  const root: PersistedCollectionPersistence = {
    adapter: adapter(),
    resolvePersistenceForCollection(received) {
      expect(this).toBe(root)
      expect(received).toBe(scope)
      return child
    },
    resolvePersistenceForMode(mode) {
      expect(this).toBe(root)
      expect(mode).toBe(`sync-present`)
      return child
    },
  }
  const wrapped = input.persistence(root)
  const resolved = wrapped.resolvePersistenceForCollection!(scope)
  expect(resolved).toBe(wrapped.resolvePersistenceForMode!(`sync-present`))
  expect(resolved.adapter.loadSubset(target, options, context)).toBe(
    result.promise,
  )
  expect(input.snapshot().pendingStorage).toEqual([`loadSubset`])
  const reason = new Error(`storage rejected`)
  result.reject(reason)
  await expect(result.promise).rejects.toBe(reason)
  await input.drain()
  expect(input.snapshot().work.at(-1)).toMatchObject({ state: `rejected` })
})

test(`storage method properties survive forwarding`, () => {
  const input = createDirectInputLedger()
  const actual = adapter()
  const afterQueuedWork = () => Promise.resolve()
  const scope: RegularScope = Object.assign(
    <T>(task: (value: PersistenceAdapter) => Promise<T>) => task(actual),
    { afterQueuedWork },
  )
  actual.runInRegularScope = scope
  expect(
    input.persistence({ adapter: actual }).adapter.runInRegularScope!
      .afterQueuedWork,
  ).toBe(afterQueuedWork)
})

test(`a request opened while deliver waits receives one checkpoint`, async () => {
  const input = createDirectInputLedger()
  let requestRevision = 0
  let delivered = 0
  const result = await input.receive({
    requestRevision: () => requestRevision,
    requestOpen: () => requestRevision > 0,
    deliver: async () => {
      await turn()
      requestRevision = 1
      delivered++
      return requestRevision
    },
  })
  expect(delivered).toBe(1)
  expect(result.deliveredRequest).toBe(1)
})

test(`actual successor requests receive the same authored input once`, async () => {
  const input = createDirectInputLedger()
  const authored = [{ id: `a` }]
  const deliveries: Array<{ revision: number; rows: typeof authored }> = []
  let requestRevision = 1
  await input.receive({
    requestRevision: () => requestRevision,
    requestOpen: () => true,
    deliver: async () => {
      const captured = requestRevision
      deliveries.push({ revision: captured, rows: authored })
      if (captured === 1) {
        await turn()
        requestRevision = 2
      }
      return captured
    },
  })
  expect(deliveries.map((value) => value.revision)).toEqual([1, 2])
  expect(deliveries.every((value) => value.rows === authored)).toBe(true)
})

test(`resuming a held application answers only the actual later successor`, async () => {
  const input = createDirectInputLedger()
  const receipt = deferred<void>()
  input.receipt(receipt.promise)
  let revision = 1
  const delivered: Array<number> = []
  const delivery = {
    requestRevision: () => revision,
    requestOpen: () => true,
    deliver: () => {
      delivered.push(revision)
      return Promise.resolve(revision)
    },
  }
  const cut = await input.receive({ ...delivery, cut: `provider` })
  expect(cut.pendingReceipts).toBe(1)
  expect(delivered).toEqual([1])
  receipt.resolve()
  const continued = input.continue({
    ...delivery,
    deliveredRequest: cut.deliveredRequest!,
  })
  await turn()
  revision = 2
  await continued
  expect(delivered).toEqual([1, 2])
})
