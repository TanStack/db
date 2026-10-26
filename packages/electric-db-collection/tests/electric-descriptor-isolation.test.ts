// Unit tests for the Electric descriptor surface, moved out of the
// descriptor-isolation oracle, which owns the law. These compare production with
// hand-written expectations, so they run as ordinary tests.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCollection,
  createTransaction,
  withAcceptedReceipt,
} from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import {
  InvalidPersistedCollectionConfigError,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import { StreamAbortedError } from '../src/errors'
import { atCheckpoint } from './electric-oracle-lifecycle'
import { storageTargetId, tagPersistence } from './electric-persistence-fixture'
import {
  expectWholeTagRecovery,
  harnessState,
  insert,
  moveOut,
  mustRefetch,
  resetElectricDescriptorHarness,
  streams,
  upToDate,
} from './electric-descriptor-harness'
import { descriptor } from './electric-descriptor-fixture'
import type { StreamHarness } from './electric-descriptor-harness'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'
import type { TestRow } from './electric-persistence-fixture'

vi.mock(`@electric-sql/client`, async () =>
  (await import(`./electric-descriptor-harness`)).createMockedElectricClient(),
)

beforeEach(() => {
  resetElectricDescriptorHarness()
})

function expectMoveOutCheckpoint(observation: {
  status: string
  publicRowPresent: boolean
  durableRowPresent: boolean
}) {
  expect(observation).toEqual({
    status: `ready`,
    publicRowPresent: false,
    durableRowPresent: false,
  })
}

it(`replaces stale durable columns and metadata on insert`, async () => {
  const { adapter, rows } = tagPersistence()
  rows.set(1, {
    value: {
      id: 1,
      name: `old`,
      stable: `old-stable`,
      obsolete: `must disappear`,
    } as TestRow,
    metadata: { tags: [`stale`] },
  })

  await adapter.applyCommittedTx(
    { kind: `eager`, collectionId: `fixture-insert-law` },
    {
      txId: `fresh-insert`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: 1,
          value: { id: 1, name: `fresh`, stable: `fresh-stable` },
          metadataChanged: true,
          metadata: undefined,
        },
      ],
    },
  )

  expect(rows.get(1)).toEqual({
    value: { id: 1, name: `fresh`, stable: `fresh-stable` },
    metadata: undefined,
  })
})

it(`restarts a provider session before an old subset can publish into a new cache`, async () => {
  const durable = new Map<string, Map<number, TestRow>>([
    [`cache-old`, new Map()],
  ])
  let currentStorageId = `cache-old`
  let claimedStorageId = `cache-old`
  let expired = false
  const claimId = `one-run-claim`
  let oldToDeliver: StreamHarness | undefined
  let deliverDuringRecovery = false
  const adapter: PersistenceAdapter = {
    runInHydrationScope: async (task) => {
      if (deliverDuringRecovery) {
        deliverDuringRecovery = false
        oldToDeliver?.completeSnapshot([
          insert(3, `late-during-rotation`),
          { headers: { control: `subset-end` } },
        ])
      }
      return task(adapter)
    },
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId: currentStorageId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      }),
    renewCacheGenerationClaim: () =>
      Promise.resolve(expired ? undefined : Date.now() + 10_000),
    rotateCacheGeneration: () => {
      currentStorageId = `cache-new`
      claimedStorageId = currentStorageId
      durable.set(currentStorageId, new Map())
      deliverDuringRecovery = true
      expired = false
      return Promise.resolve({
        storageCollectionId: currentStorageId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      })
    },
    releaseCacheGenerationClaim: () => Promise.resolve(),
    loadSubset: (id) =>
      Promise.resolve(
        Array.from(durable.get(storageTargetId(id)) ?? [], ([key, value]) => ({
          key,
          value,
        })),
      ),
    loadResumeSnapshot: (id) =>
      Promise.resolve({
        rows: Array.from(
          durable.get(storageTargetId(id)) ?? [],
          ([key, value]) => ({
            key,
            value,
          }),
        ),
        keySet: {
          status:
            storageTargetId(id) === `cache-old` ? `consistent` : `incompatible`,
        },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: (id, tx) => {
      expect(storageTargetId(id)).toBe(claimedStorageId)
      const rows = durable.get(storageTargetId(id))!
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(Number(mutation.key))
        else
          rows.set(
            Number(mutation.key),
            structuredClone(mutation.value) as TestRow,
          )
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      TestRow,
      string | number,
      never,
      ElectricCollectionUtils<TestRow>
    >({
      ...descriptor(`original`, false, `on-demand`),
      id: `late-provider-row`,
      persistence: { adapter },
    }),
  )
  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    const old = streams[0]!
    oldToDeliver = old
    old.send([
      insert(1, `old`),
      // 779 is visible only through the old snapshot. Explicit txid 778 is
      // listed as active so the two evidence paths remain distinguishable.
      {
        headers: {
          control: `snapshot-end`,
          xmin: `778`,
          xmax: `800`,
          xip_list: [`778`],
        },
      },
      { headers: { control: `up-to-date`, txids: [778] } },
    ])
    await collection.stateWhenReady()
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`old`))
    await expect(collection.utils.awaitTxId(778)).resolves.toBe(true)
    await expect(collection.utils.awaitTxId(779)).resolves.toBe(true)
    old.holdSnapshots = true
    old.ignoreUnsubscribe = true
    const oldWait = collection.utils.awaitTxId(801, 10_000).then(
      () => undefined,
      (error: unknown) => error,
    )
    const oldMatch = collection.utils
      .awaitMatch(
        (message) => `value` in message && message.value.id === 9,
        10_000,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    const firstDemand = Promise.resolve(
      collection._sync.loadSubset({ limit: 1 }),
    )
    await atCheckpoint(old.snapshotRequested(), `old request`)
    let handlerEntered!: () => void
    const handlerStart = new Promise<void>((resolve) => {
      handlerEntered = resolve
    })
    const mutation = createTransaction({
      mutationFn: async () => {
        handlerEntered()
        await collection.utils.awaitTxId(802, 10_000)
      },
    })
    mutation.mutate(() =>
      collection.insert({ id: 10, name: `optimistic`, stable: `stable-10` }),
    )
    const handlerOutcome = mutation.isPersisted.promise.then(
      () => undefined,
      (error: unknown) => error,
    )
    await atCheckpoint(handlerStart, `old mutation handler wait`)

    harnessState.holdNewSnapshots = true
    expired = true
    const secondDemand = Promise.resolve(
      collection._sync.loadSubset({ limit: 2 }),
    )
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(await oldWait).toBeInstanceOf(StreamAbortedError)
    expect(await oldMatch).toBeInstanceOf(StreamAbortedError)
    expect(await handlerOutcome).toBeInstanceOf(StreamAbortedError)
    const fresh = streams[1]!
    await vi.waitFor(() => expect(fresh.pendingSnapshotCount()).toBe(1))
    fresh.send([insert(2, `fresh`), { headers: { control: `subset-end` } }])
    fresh.completeSnapshot()
    await vi.waitFor(() => expect(fresh.pendingSnapshotCount()).toBe(1))
    fresh.send([{ headers: { control: `subset-end` } }])
    fresh.completeSnapshot()
    await vi.waitFor(() => expect(fresh.pendingSnapshotCount()).toBe(1))
    fresh.send([{ headers: { control: `subset-end` } }])
    fresh.completeSnapshot()
    await atCheckpoint(
      Promise.all([firstDemand, secondDemand]),
      `replayed demands`,
    )
    expect(collection.get(1)).toBeUndefined()
    expect(collection.get(2)?.name).toBe(`fresh`)
    expect(collection.get(10)).toBeUndefined()

    // The old txid and snapshot once acknowledged mutations, but their
    // source rows were cleared during cache rotation. The replacement
    // session must observe both kinds of evidence anew.
    let replacementWaitSettled = false
    const replacementWait = collection.utils.awaitTxId(778, 1_000).then(() => {
      replacementWaitSettled = true
    })
    await Promise.resolve()
    const txidSettledBeforeFreshEvidence = replacementWaitSettled
    let replacementSnapshotWaitSettled = false
    const replacementSnapshotWait = collection.utils
      .awaitTxId(779, 1_000)
      .then(() => {
        replacementSnapshotWaitSettled = true
      })
    await Promise.resolve()
    const snapshotSettledBeforeFreshEvidence = replacementSnapshotWaitSettled
    fresh.send([
      {
        headers: {
          control: `snapshot-end`,
          xmin: `778`,
          xmax: `800`,
          xip_list: [`778`],
        },
      },
      { headers: { control: `up-to-date`, txids: [778] } },
    ])
    await atCheckpoint(replacementWait, `replacement txid evidence`)
    await atCheckpoint(replacementSnapshotWait, `replacement snapshot evidence`)
    expect(txidSettledBeforeFreshEvidence).toBe(false)
    expect(snapshotSettledBeforeFreshEvidence).toBe(false)

    old.send([
      insert(4, `late-after-restart`),
      { headers: { control: `subset-end` } },
    ])
    await Promise.resolve()
    expect(collection.get(3)).toBeUndefined()
    expect(collection.get(4)).toBeUndefined()
    expect([...durable.get(`cache-new`)!.keys()]).toEqual([2])
  } finally {
    await atCheckpoint(collection.cleanup(), `provider restart cleanup`)
  }
})

it(`aborts one demand while its provider session restarts`, async () => {
  let storageCollectionId = `cache-old`
  let expired = false
  let releaseRotation!: () => void
  let rotationEntered!: () => void
  const rotationGate = new Promise<void>((resolve) => {
    releaseRotation = resolve
  })
  const entered = new Promise<void>((resolve) => {
    rotationEntered = resolve
  })
  const adapter: PersistenceAdapter = {
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId,
        claimId: `abort-claim`,
        expiresAtMs: Date.now() + 10_000,
      }),
    renewCacheGenerationClaim: () =>
      Promise.resolve(expired ? undefined : Date.now() + 10_000),
    rotateCacheGeneration: async () => {
      rotationEntered()
      await rotationGate
      storageCollectionId = `cache-new`
      expired = false
      return {
        storageCollectionId,
        claimId: `abort-claim`,
        expiresAtMs: Date.now() + 10_000,
      }
    },
    releaseCacheGenerationClaim: () => Promise.resolve(),
    loadSubset: () => Promise.resolve([]),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      TestRow,
      string | number,
      never,
      ElectricCollectionUtils<TestRow>
    >({
      ...descriptor(`original`, false, `on-demand`),
      id: `abort-during-provider-restart`,
      persistence: { adapter },
    }),
  )
  const aborter = new AbortController()
  let releasedOutcome = `pending`
  let siblingOutcome = `pending`
  let sibling: Promise<void> | undefined
  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    const old = streams[0]!
    old.send([upToDate])
    await collection.stateWhenReady()
    old.holdSnapshots = true
    old.ignoreUnsubscribe = true
    const released = Promise.resolve(
      collection._sync.loadSubset({ limit: 1, signal: aborter.signal }),
    ).then(
      () => {
        releasedOutcome = `fulfilled`
      },
      (error: unknown) => {
        releasedOutcome =
          typeof error === `object` && error !== null && `name` in error
            ? String(error.name)
            : `rejected`
      },
    )
    await atCheckpoint(old.snapshotRequested(), `old held request`)

    harnessState.holdNewSnapshots = true
    expired = true
    sibling = Promise.resolve(collection._sync.loadSubset({ limit: 2 })).then(
      () => {
        siblingOutcome = `fulfilled`
      },
    )
    void sibling.catch(() => undefined)
    await atCheckpoint(entered, `cache rotation entered`)
    aborter.abort()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const outcomeAtHeldRotation = releasedOutcome
    expect(siblingOutcome).toBe(`pending`)

    releaseRotation()
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    const fresh = streams[1]!
    await vi.waitFor(() => expect(fresh.pendingSnapshotCount()).toBe(1))
    fresh.send([insert(2, `fresh`), { headers: { control: `subset-end` } }])
    fresh.completeSnapshot()
    await atCheckpoint(Promise.all([released, sibling]), `demand outcomes`)
    expect(outcomeAtHeldRotation).toBe(`AbortError`)
    expect(releasedOutcome).toBe(`AbortError`)
    expect(siblingOutcome).toBe(`fulfilled`)
    expect(collection.get(2)?.name).toBe(`fresh`)
  } finally {
    releaseRotation()
    await sibling?.catch(() => undefined)
    await atCheckpoint(collection.cleanup(), `restart abort cleanup`)
  }
})

it(`cleans up during a held provider-session restart`, async () => {
  let storageCollectionId = `cache-old`
  let expired = false
  let releaseRotation!: () => void
  let rotationEntered!: () => void
  const rotationGate = new Promise<void>((resolve) => {
    releaseRotation = resolve
  })
  const entered = new Promise<void>((resolve) => {
    rotationEntered = resolve
  })
  const adapter: PersistenceAdapter = {
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId,
        claimId: `cleanup-claim`,
        expiresAtMs: Date.now() + 10_000,
      }),
    renewCacheGenerationClaim: () =>
      Promise.resolve(expired ? undefined : Date.now() + 10_000),
    rotateCacheGeneration: async () => {
      rotationEntered()
      await rotationGate
      storageCollectionId = `cache-new`
      return {
        storageCollectionId,
        claimId: `cleanup-claim`,
        expiresAtMs: Date.now() + 10_000,
      }
    },
    releaseCacheGenerationClaim: () => Promise.resolve(),
    loadSubset: () => Promise.resolve([]),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      TestRow,
      string | number,
      never,
      ElectricCollectionUtils<TestRow>
    >({
      ...descriptor(`original`, false, `on-demand`),
      id: `cleanup-during-provider-restart`,
      persistence: { adapter },
    }),
  )
  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    streams[0]!.send([upToDate])
    await collection.stateWhenReady()

    expired = true
    const demand = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
    void demand.catch(() => undefined)
    await atCheckpoint(entered, `held cache rotation`)
    const cleanup = collection.cleanup()
    releaseRotation()
    await atCheckpoint(cleanup, `cleanup after held rotation`)
    await demand.catch(() => undefined)
    expect(streams).toHaveLength(1)
    expect(collection.status).toBe(`cleaned-up`)
  } finally {
    releaseRotation()
  }
})

it(`rejects a demand after provider-session restart fails`, async () => {
  const options = descriptor(`original`, false, `on-demand`)
  const rotationError = new Error(`cache rotation failed`)
  const params = {
    collection: { utils: {}, getKeyFromItem: (row: TestRow) => row.id },
    begin: () => {},
    write: () => {},
    commit: () => true,
    markReady: () => {},
    markError: () => {},
    truncate: () => {},
    metadata: {
      collection: { get: () => undefined, set: () => {} },
      row: { get: () => undefined, set: () => {} },
      persistence: {
        protocol: `@tanstack/db/sync-persistence`,
        version: 1,
        managedCacheGeneration: true,
        hydrateBaseline: async () => {},
        startScopedRecovery: async () => {},
        reserveCommitTurn: () => {},
        scanPersistedRows: async () => [],
        resumeSnapshot: {
          certify: async () => {},
          getKeySetEvidence: () => undefined,
          expectCurrentCommit: () => {},
        },
      },
    },
  } as unknown as Parameters<typeof options.sync.sync>[0]
  const run = options.sync.sync(params)
  if (typeof run !== `object` || !run.restartAfterScopedRecovery) {
    throw new Error(`Missing managed Electric restart hook`)
  }
  await expect(
    run.restartAfterScopedRecovery(Promise.reject(rotationError)),
  ).rejects.toBe(rotationError)
  const demand = Promise.resolve(run.loadSubset?.({ limit: 1 }))
  try {
    const watchdog = (async () => {
      for (let turn = 0; turn < 50; turn++) await Promise.resolve()
      throw new Error(`Demand did not reject while the run was active`)
    })()
    await expect(Promise.race([demand, watchdog])).rejects.toBe(rotationError)
  } finally {
    await run.cleanup?.()
  }
})

it.each([`resolves`, `rejects`] as const)(
  `lets only the replacement session decide readiness when a retired acceptance %s`,
  async (outcome) => {
    const options = descriptor(`original`, false, `on-demand`)
    const readiness: Array<string> = []
    let status = `loading`
    let releaseAcceptance!: () => void
    let failAcceptance!: (error: Error) => void
    const acceptance = new Promise<void>((resolve, reject) => {
      releaseAcceptance = resolve
      failAcceptance = reject
    })
    void acceptance.catch(() => undefined)
    let holdNextCommit = true
    const params = {
      collection: {
        utils: {},
        getKeyFromItem: (row: TestRow) => row.id,
        _state: { syncedData: new Map() },
        get status() {
          return status
        },
      },
      begin: () => {},
      write: () => {},
      // The first commit's acceptance is held, as a persistence wrapper
      // accepts after its durable step.
      commit: () => {
        if (!holdNextCommit) return true
        holdNextCommit = false
        return withAcceptedReceipt(Promise.resolve(), acceptance)
      },
      markReady: () => {
        readiness.push(`ready`)
        status = `ready`
      },
      markError: () => {
        readiness.push(`error`)
        status = `error`
      },
      truncate: () => {},
      metadata: {
        collection: { get: () => undefined, set: () => {} },
        row: { get: () => undefined, set: () => {} },
        persistence: {
          protocol: `@tanstack/db/sync-persistence`,
          version: 1,
          managedCacheGeneration: true,
          hydrateBaseline: async () => {},
          startScopedRecovery: async () => {},
          reserveCommitTurn: () => {},
          scanPersistedRows: async () => [],
          resumeSnapshot: {
            certify: async () => {},
            getKeySetEvidence: () => undefined,
            expectCurrentCommit: () => {},
          },
        },
      },
    } as unknown as Parameters<typeof options.sync.sync>[0]
    const run = options.sync.sync(params)
    if (typeof run !== `object` || !run.restartAfterScopedRecovery) {
      throw new Error(`Missing managed Electric restart hook`)
    }
    try {
      streams[0]!.send([upToDate])
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(readiness, `first snapshot committed, not accepted`).toEqual([])

      await atCheckpoint(
        Promise.resolve(run.restartAfterScopedRecovery(Promise.resolve())),
        `cache rotation`,
      )
      if (outcome === `resolves`) releaseAcceptance()
      else failAcceptance(new Error(`retired generation write aborted`))
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(readiness, `retired acceptance ${outcome}`).toEqual([])

      expect(streams).toHaveLength(2)
      streams[1]!.send([upToDate])
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(readiness, `replacement snapshot`).toEqual([`ready`])
    } finally {
      releaseAcceptance()
      await run.cleanup?.()
    }
  },
)

it(`waits for every overlapping cache rotation before restarting Electric`, async () => {
  const options = descriptor(`original`, false, `on-demand`)
  const params = {
    collection: { utils: {}, getKeyFromItem: (row: TestRow) => row.id },
    begin: () => {},
    write: () => {},
    commit: () => true,
    markReady: () => {},
    markError: () => {},
    truncate: () => {},
    metadata: {
      collection: { get: () => undefined, set: () => {} },
      row: { get: () => undefined, set: () => {} },
      persistence: {
        protocol: `@tanstack/db/sync-persistence`,
        version: 1,
        managedCacheGeneration: true,
        hydrateBaseline: async () => {},
        startScopedRecovery: async () => {},
        reserveCommitTurn: () => {},
        scanPersistedRows: async () => [],
        resumeSnapshot: {
          certify: async () => {},
          getKeySetEvidence: () => undefined,
          expectCurrentCommit: () => {},
        },
      },
    },
  } as unknown as Parameters<typeof options.sync.sync>[0]
  const run = options.sync.sync(params)
  if (typeof run !== `object` || !run.restartAfterScopedRecovery) {
    throw new Error(`Missing managed Electric restart hook`)
  }
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  const first = Promise.resolve(run.restartAfterScopedRecovery(firstGate))
  const second = Promise.resolve(run.restartAfterScopedRecovery(secondGate))
  let secondSettled = false
  void second.finally(() => {
    secondSettled = true
  })
  try {
    releaseFirst()
    await atCheckpoint(first, `first cache rotation`)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(secondSettled).toBe(false)
    releaseSecond()
    await atCheckpoint(second, `second cache rotation`)
  } finally {
    releaseFirst()
    releaseSecond()
    await Promise.allSettled([first, second])
    await run.cleanup?.()
  }
})

it(`retires a replacement Electric stream before a second cache rotation`, async () => {
  const options = descriptor(`original`, false, `on-demand`)
  const write = vi.fn()
  const markError = vi.fn()
  const params = {
    collection: {
      utils: {},
      getKeyFromItem: (row: TestRow) => row.id,
      _state: { syncedData: new Map() },
    },
    begin: () => {},
    write,
    commit: () => true,
    markReady: () => {},
    markError,
    truncate: () => {},
    metadata: {
      collection: { get: () => undefined, set: () => {} },
      row: { get: () => undefined, set: () => {} },
      persistence: {
        protocol: `@tanstack/db/sync-persistence`,
        version: 1,
        managedCacheGeneration: true,
        hydrateBaseline: async () => {},
        startScopedRecovery: async () => {},
        reserveCommitTurn: () => {},
        scanPersistedRows: async () => [],
        resumeSnapshot: {
          certify: async () => {},
          getKeySetEvidence: () => undefined,
          expectCurrentCommit: () => {},
        },
      },
    },
  } as unknown as Parameters<typeof options.sync.sync>[0]
  const run = options.sync.sync(params)
  if (typeof run !== `object` || !run.restartAfterScopedRecovery) {
    throw new Error(`Missing managed Electric restart hook`)
  }
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  let second!: Promise<void>
  let secondCalled!: () => void
  const secondStarted = new Promise<void>((resolve) => {
    secondCalled = resolve
  })
  harnessState.onStreamSubscribed = () => {
    if (streams.length !== 2) return
    queueMicrotask(() => {
      second = Promise.resolve(run.restartAfterScopedRecovery!(secondGate))
      secondCalled()
    })
  }
  const first = Promise.resolve(run.restartAfterScopedRecovery(firstGate))
  try {
    releaseFirst()
    await atCheckpoint(secondStarted, `second cache rotation starts`)
    const retiredStream = streams[1]!
    expect(retiredStream.unsubscribe).toHaveBeenCalledOnce()
    retiredStream.ignoreUnsubscribe = true
    retiredStream.send([insert(7, `retired`), upToDate])
    expect(write).not.toHaveBeenCalled()
    expect(markError).not.toHaveBeenCalled()
    releaseSecond()
    await atCheckpoint(second, `second cache rotation completes`)
    expect(streams).toHaveLength(3)
    const fresh = streams[2]!
    const demand = Promise.resolve(run.loadSubset?.({ limit: 1 }))
    await atCheckpoint(fresh.snapshotRequested(), `final provider subset`)
    fresh.send([insert(8, `fresh`), { headers: { control: `subset-end` } }])
    await atCheckpoint(demand, `final provider demand applied`)
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: `insert`,
        value: expect.objectContaining({ id: 8, name: `fresh` }),
      }),
    )
  } finally {
    harnessState.onStreamSubscribed = undefined
    releaseFirst()
    releaseSecond()
    await Promise.allSettled([first, second])
    await run.cleanup?.()
  }
})

it(`forgets imported txid evidence during initial scoped recovery`, async () => {
  let storageCollectionId = `cache-old`
  const claimId = `initial-claim`
  const adapter: PersistenceAdapter = {
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      }),
    renewCacheGenerationClaim: () => Promise.resolve(Date.now() + 10_000),
    rotateCacheGeneration: () => {
      storageCollectionId = `cache-new`
      return Promise.resolve({
        storageCollectionId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      })
    },
    releaseCacheGenerationClaim: () => Promise.resolve(),
    loadSubset: () => Promise.resolve([]),
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
  const options = descriptor(`original`, false, `on-demand`)
  options.sync.importSyncMeta?.({
    version: 1,
    resume: {
      kind: `resume`,
      offset: `10_0`,
      handle: `old`,
      shapeId: `incompatible`,
      updatedAt: 1,
      requiresTagState: false,
    },
    seenTxids: [778],
  })
  const collection = createCollection(
    persistedCollectionOptions<
      TestRow,
      string | number,
      never,
      ElectricCollectionUtils<TestRow>
    >({
      ...options,
      id: `initial-evidence`,
      persistence: { adapter },
    }),
  )
  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(storageCollectionId).toBe(`cache-new`))
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    let settled = false
    const wait = collection.utils.awaitTxId(778, 1_000).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    streams[0]!.send([{ headers: { control: `up-to-date`, txids: [778] } }])
    await atCheckpoint(wait, `new txid evidence`)
  } finally {
    await atCheckpoint(collection.cleanup(), `initial evidence cleanup`)
  }
})

it(`starts a new subset after retiring an incomplete old stream transaction`, async () => {
  const durable = new Map<string, Map<number, TestRow>>([
    [`cache-old`, new Map()],
  ])
  let storageCollectionId = `cache-old`
  let expired = false
  const claimId = `open-tx-claim`
  const adapter: PersistenceAdapter = {
    claimCacheGeneration: () =>
      Promise.resolve({
        storageCollectionId,
        claimId,
        expiresAtMs: Date.now() + 300,
      }),
    renewCacheGenerationClaim: () =>
      Promise.resolve(expired ? undefined : Date.now() + 300),
    rotateCacheGeneration: () => {
      storageCollectionId = `cache-new`
      durable.set(storageCollectionId, new Map())
      expired = false
      return Promise.resolve({
        storageCollectionId,
        claimId,
        expiresAtMs: Date.now() + 10_000,
      })
    },
    releaseCacheGenerationClaim: () => Promise.resolve(),
    loadSubset: (id) =>
      Promise.resolve(
        Array.from(durable.get(storageTargetId(id)) ?? [], ([key, value]) => ({
          key,
          value,
        })),
      ),
    loadResumeSnapshot: (id) =>
      Promise.resolve({
        rows: Array.from(
          durable.get(storageTargetId(id)) ?? [],
          ([key, value]) => ({
            key,
            value,
          }),
        ),
        keySet: {
          status:
            storageTargetId(id) === `cache-old` ? `consistent` : `incompatible`,
        },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: (id, tx) => {
      const rows = durable.get(storageTargetId(id))!
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(Number(mutation.key))
        else
          rows.set(
            Number(mutation.key),
            structuredClone(mutation.value) as TestRow,
          )
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      TestRow,
      string | number,
      never,
      ElectricCollectionUtils<TestRow>
    >({
      ...descriptor(`original`, false, `on-demand`),
      id: `open-old-transaction`,
      persistence: { adapter },
    }),
  )
  let demand: Promise<void> | undefined
  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    const old = streams[0]!
    old.send([insert(1, `old`), { headers: { control: `up-to-date` } }])
    await collection.stateWhenReady()
    old.send([insert(2, `incomplete`)])
    expect(collection.get(2)).toBeUndefined()
    harnessState.holdNewSnapshots = true
    expired = true
    await vi.waitFor(() => expect(streams).toHaveLength(2), {
      timeout: 2_000,
    })
    const fresh = streams[1]!
    demand = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
      () => undefined,
    )
    await vi.waitFor(() => expect(fresh.pendingSnapshotCount()).toBe(1), {
      timeout: 600,
    })
    fresh.send([{ headers: { control: `subset-end` } }])
    fresh.completeSnapshot()
    await atCheckpoint(demand, `fresh subset after incomplete old transaction`)
    expect(collection.get(2)).toBeUndefined()
  } finally {
    await atCheckpoint(collection.cleanup(), `open transaction cleanup`)
    await demand?.catch(() => undefined)
  }
})

it(`rejects torn or reverted tag-recovery histories even when their last snapshot is correct`, () => {
  const cached = [{ id: 1, name: `cached`, stable: `stable-1` }]
  const replacement = [{ id: 2, name: `replacement`, stable: `stable-2` }]
  const record = (rows: Array<Array<TestRow>>) =>
    rows.map((snapshot, index) => ({
      cut: `cut-${index}`,
      rows: structuredClone(snapshot),
    }))
  expectWholeTagRecovery(record([cached, cached, replacement, replacement]), [
    cached,
    replacement,
  ])
  for (const rows of [
    [cached, [], replacement],
    [cached, [...cached, ...replacement], replacement],
    [cached, replacement, cached, replacement],
  ]) {
    expect(() =>
      expectWholeTagRecovery(record(rows), [cached, replacement]),
    ).toThrow()
  }
})

it.each([`shared storage`, `distinct storage`] as const)(
  `keeps insert acknowledgements on the owner of a reused Electric descriptor ($0)`,
  async (storage) => {
    const readTargets: Array<string> = []
    const adapter: PersistenceAdapter = {
      loadSubset: () => Promise.resolve([]),
      loadResumeSnapshot: (target) => {
        readTargets.push(storageTargetId(target))
        return Promise.resolve({
          rows: [],
          keySet: { status: `consistent` },
          collectionMetadata: [],
          latestTerm: 0,
          latestSeq: 0,
          latestRowVersion: 0,
          resetEpoch: 0,
        })
      },
      loadCollectionMetadata: () => Promise.resolve([]),
      applyCommittedTx: () => Promise.resolve(),
      ensureIndex: () => Promise.resolve(),
    }
    const electricOptions = electricCollectionOptions<TestRow>({
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: false,
      onInsert: () => Promise.resolve({ txid: 200, timeout: 100 }),
    })
    // The Electric descriptor is reusable; each persisted wrapper binds one
    // Collection so its receipt and sync controls cannot move to another owner.
    const persistedOptions = (id: string) =>
      persistedCollectionOptions<
        TestRow,
        string | number,
        never,
        ElectricCollectionUtils<TestRow>
      >({ ...electricOptions, id, persistence: { adapter } })
    const firstOptions = persistedOptions(`first-persisted-owner`)
    const first = createCollection(firstOptions)
    expect(() => createCollection(firstOptions)).toThrow(
      InvalidPersistedCollectionConfigError,
    )
    const secondId =
      storage === `shared storage`
        ? `first-persisted-owner`
        : `second-persisted-owner`
    const second = createCollection(persistedOptions(secondId))
    try {
      first.startSyncImmediate()
      await vi.waitFor(() => expect(streams).toHaveLength(1))
      streams[0]!.send([upToDate])
      await vi.waitFor(() => expect(first.status).toBe(`ready`))
      second.startSyncImmediate()
      await vi.waitFor(() => expect(streams).toHaveLength(2))
      streams[1]!.send([upToDate])
      await vi.waitFor(() => expect(second.status).toBe(`ready`))
      expect(second.id).toBe(secondId)
      expect(new Set(readTargets)).toEqual(
        new Set([`first-persisted-owner`, secondId]),
      )

      const transaction = first.insert({
        id: 1,
        name: `own`,
        stable: `stable-1`,
      })
      void transaction.isPersisted.promise.catch(() => undefined)
      streams[0]!.send([
        insert(1, `own`),
        { headers: { control: `up-to-date`, txids: [200] } },
      ])
      await expect(transaction.isPersisted.promise).resolves.toBeDefined()
      expect(first.get(1)?.name).toBe(`own`)
      expect(second.has(1)).toBe(false)
    } finally {
      await first.cleanup()
      await second.cleanup()
    }
  },
)

it(`rejects a descriptor move-out checkpoint that deletes rows by fail-stopping`, () => {
  expectMoveOutCheckpoint({
    status: `ready`,
    publicRowPresent: false,
    durableRowPresent: false,
  })
  expect(() =>
    expectMoveOutCheckpoint({
      status: `error`,
      publicRowPresent: false,
      durableRowPresent: false,
    }),
  ).toThrow()
})

it.each([`resume`, `fresh`] as const)(
  `restores compatible tags and discards obsolete tags on persisted $0 restart`,
  async (restart) => {
    const { rows, metadata, adapter } = tagPersistence()
    const collection = createCollection(
      persistedCollectionOptions<
        TestRow,
        string | number,
        never,
        ElectricCollectionUtils<TestRow>
      >({
        ...descriptor(`original`, false),
        id: `tag-restart-${restart}`,
        persistence: { adapter },
      }),
    )
    try {
      collection.startSyncImmediate()
      await vi.waitFor(() => expect(streams).toHaveLength(1))
      streams[0]!.send([insert(1, `old`), upToDate])
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      await vi.waitFor(() =>
        expect(metadata.get(`electric:resume`)).toMatchObject({
          kind: `resume`,
          offset: `20_0`,
        }),
      )
      await collection.cleanup()
      if (restart === `fresh`) {
        metadata.set(`electric:resume`, {
          kind: `reset`,
          updatedAt: Date.now() + 1,
        })
      }
      collection.startSyncImmediate()
      await vi.waitFor(() => expect(streams).toHaveLength(2))
      await vi.waitFor(() => expect(collection.get(1)?.stable).toBe(`stable-1`))
      expect(vi.mocked(ShapeStream).mock.calls[1]?.[0]).toMatchObject({
        offset: restart === `resume` ? `20_0` : undefined,
      })
      const currentTag = restart === `resume` ? `old` : `current`
      if (restart === `fresh`)
        streams[1]!.send([insert(1, currentTag), upToDate])
      streams[1]!.send([moveOut(currentTag), upToDate])
      await vi.waitFor(() => expect(collection.has(1)).toBe(false))
      await vi.waitFor(() => expect(rows.has(1)).toBe(false))
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      expectMoveOutCheckpoint({
        status: collection.status,
        publicRowPresent: collection.has(1),
        durableRowPresent: rows.has(1),
      })
    } finally {
      await collection.cleanup()
    }
  },
)

describe.each([`original`, `once-spread`] as const)(
  `%s Electric descriptor`,
  (form) => {
    it.each([false, true])(
      `keeps acknowledgement helpers on their owning collection, eager=%s`,
      async (startSync) => {
        const options = descriptor(form, startSync)
        const first = createCollection({ ...options, id: `first` })
        const second = createCollection({ ...options, id: `second` })
        const firstWait = first.utils.awaitTxId(11, 100)
        const secondWait = second.utils.awaitTxId(22, 100)
        // Observe rejections even if an earlier assertion fails and cleanup
        // aborts a still-pending waiter.
        void firstWait.catch(() => undefined)
        void secondWait.catch(() => undefined)
        try {
          first.config.sync.importSyncMeta?.({ version: 1, seenTxids: [11] })
          second.config.sync.importSyncMeta?.({ version: 1, seenTxids: [22] })
          await expect(firstWait).resolves.toBe(true)
          await expect(secondWait).resolves.toBe(true)
          if (!startSync) expect(streams).toHaveLength(0)

          first.startSyncImmediate()
          second.startSyncImmediate()
          expect(streams).toHaveLength(2)
          const peerMatch = second.utils.awaitMatch(
            (message) => `value` in message && message.value.name === `first`,
            100,
          )
          const ownMatch = first.utils.awaitMatch(
            (message) => `value` in message && message.value.name === `first`,
            100,
          )
          const ownTxid = first.utils.awaitTxId(33, 100)
          const peerTxid = second.utils.awaitTxId(33, 100)
          let peerMatched = false
          let peerAcknowledged = false
          void peerMatch.then(
            () => {
              peerMatched = true
            },
            () => undefined,
          )
          void peerTxid.then(
            () => {
              peerAcknowledged = true
            },
            () => undefined,
          )
          void ownMatch.catch(() => undefined)
          void ownTxid.catch(() => undefined)
          streams[0]!.send([
            insert(1, `first`),
            { headers: { control: `up-to-date`, txids: [33] } },
          ])
          await expect(ownMatch).resolves.toBe(true)
          await expect(ownTxid).resolves.toBe(true)
          expect(peerMatched).toBe(false)
          expect(peerAcknowledged).toBe(false)
          await second.cleanup()
          await expect(peerMatch).rejects.toThrow(/aborted/i)
          await expect(peerTxid).rejects.toThrow(/aborted/i)
          await expect(first.utils.awaitTxId(11, 20)).resolves.toBe(true)
          expect(streams[0]!.unsubscribe).not.toHaveBeenCalled()
          expect(streams[1]!.unsubscribe).toHaveBeenCalledOnce()
        } finally {
          await first.cleanup()
          await second.cleanup()
        }
      },
    )

    it.each(
      [false, true].flatMap((equalKeys) =>
        ([`none`, `reset`, `cleanup`] as const).map((peerAction) => ({
          equalKeys,
          peerAction,
        })),
      ),
    )(
      `keeps tag visibility independent, equal keys=$equalKeys, peer=$peerAction`,
      async ({ equalKeys, peerAction }) => {
        const options = descriptor(form)
        const first = createCollection({ ...options, id: `tag-first` })
        const second = createCollection({ ...options, id: `tag-second` })
        const secondKey = equalKeys ? 1 : 2
        try {
          streams[0]!.send([insert(1, `left`), upToDate])
          streams[1]!.send([insert(secondKey, `right`), upToDate])
          if (peerAction === `reset`) {
            streams[1]!.send([
              mustRefetch,
              insert(secondKey, `right`),
              upToDate,
            ])
          } else if (peerAction === `cleanup`) {
            await second.cleanup()
          }

          expect(first.get(1)?.stable).toBe(`stable-1`)
          streams[0]!.send([moveOut(`left`), upToDate])
          expect(first.has(1)).toBe(false)
          if (peerAction !== `cleanup`) {
            expect(second.get(secondKey)?.name).toBe(`right`)
            streams[1]!.send([moveOut(`right`), upToDate])
            expect(second.has(secondKey)).toBe(false)
          }
        } finally {
          await first.cleanup()
          await second.cleanup()
        }
      },
    )

    it(`discards tag state when the same Collection starts a new sync run`, async () => {
      const collection = createCollection(descriptor(form))
      try {
        streams[0]!.send([insert(1, `old`), upToDate])
        await collection.cleanup()
        collection.startSyncImmediate()
        expect(streams).toHaveLength(2)
        streams[1]!.send([insert(1, `current`), upToDate])
        streams[1]!.send([moveOut(`current`), upToDate])
        expect(collection.has(1)).toBe(false)
      } finally {
        await collection.cleanup()
      }
    })
  },
)
