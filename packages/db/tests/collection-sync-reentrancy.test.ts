import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { SyncConfig } from '../src/types.js'

type Row = {
  id: number
  value: string
}

type SyncOps = Parameters<SyncConfig<Row, number>[`sync`]>[0]

type ListenerAction = `commit` | `abort`

type ListenerScenario = {
  beforeOpen: ReadonlyArray<ListenerAction>
  leaveOpen: boolean
  afterOpen: ReadonlyArray<ListenerAction>
}

const listenerActionArbitrary = fc.constantFrom<ListenerAction>(
  `commit`,
  `abort`,
)

const listenerScenarioArbitrary: fc.Arbitrary<ListenerScenario> = fc.record({
  beforeOpen: fc.array(listenerActionArbitrary, { maxLength: 2 }),
  leaveOpen: fc.boolean(),
  afterOpen: fc.array(listenerActionArbitrary, { maxLength: 2 }),
})

function enumerateActions(maxLength: number): Array<Array<ListenerAction>> {
  const histories: Array<Array<ListenerAction>> = [[]]
  for (let length = 1; length <= maxLength; length++) {
    const previous = histories.filter(
      (history) => history.length === length - 1,
    )
    histories.push(
      ...previous.flatMap((history) =>
        ([`commit`, `abort`] as const).map((action) => [...history, action]),
      ),
    )
  }
  return histories
}

const exhaustiveListenerScenarios: Array<ListenerScenario> = enumerateActions(
  2,
).flatMap((beforeOpen) =>
  enumerateActions(2).flatMap((afterOpen) =>
    [false, true].map((leaveOpen) => ({
      beforeOpen,
      leaveOpen,
      afterOpen,
    })),
  ),
)

let generatedHarnessId = 0

function createSyncHarness(id: string) {
  let sync!: SyncOps
  const collection = createCollection<Row, number>({
    id,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (ops) => {
        sync = ops
        ops.markReady()
      },
    },
  })

  return {
    collection,
    get sync() {
      return sync
    },
  }
}

function stageInsert(
  sync: SyncOps,
  row: Row,
  options?: { immediate?: boolean },
): void {
  sync.begin(options)
  sync.write({ type: `insert`, value: row })
}

async function runListenerScenario(scenario: ListenerScenario): Promise<void> {
  const harness = createSyncHarness(
    `generated-listener-sync-${generatedHarnessId++}`,
  )
  const { collection } = harness
  const appliedKeys: Array<number> = []
  const originalSet = collection._state.syncedData.set.bind(
    collection._state.syncedData,
  )
  vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
    (key, value) => {
      appliedKeys.push(key)
      return originalSet(key, value)
    },
  )
  const batches: Array<Array<number>> = []
  const committedKeys: Array<number> = []
  const committedReceipts: Array<Promise<void>> = []
  const abortedReceipts: Array<PromiseSettledResult<void>> = []
  let openKey: number | undefined
  let nextKey = 2
  let listenerDepth = 0
  let maxListenerDepth = 0
  let ranActions = false

  const runAction = (action: ListenerAction) => {
    const key = nextKey++
    stageInsert(harness.sync, { id: key, value: action })
    if (action === `commit`) {
      committedKeys.push(key)
      const receipt = harness.sync.commit()
      if (receipt !== true) committedReceipts.push(receipt)
      return
    }

    const controller = new AbortController()
    controller.abort()
    const receipt = harness.sync.commit(controller.signal)
    if (receipt !== true) {
      void receipt.then(
        () => abortedReceipts.push({ status: `fulfilled`, value: undefined }),
        (reason) => abortedReceipts.push({ status: `rejected`, reason }),
      )
    }
  }

  const subscription = collection.subscribeChanges((changes) => {
    listenerDepth++
    maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
    batches.push(changes.map((change) => change.key as number))

    if (!ranActions && changes.some(({ key }) => key === 1)) {
      ranActions = true
      scenario.beforeOpen.forEach(runAction)
      if (scenario.leaveOpen) {
        openKey = nextKey++
        stageInsert(harness.sync, { id: openKey, value: `open` })
      }
      scenario.afterOpen.forEach(runAction)
    }

    listenerDepth--
  })

  try {
    stageInsert(harness.sync, { id: 1, value: `outer` })
    harness.sync.commit()

    expect(appliedKeys).toEqual([1, ...committedKeys])
    expect(batches).toEqual([
      [1],
      ...(committedKeys.length > 0 ? [committedKeys] : []),
    ])
    expect(maxListenerDepth).toBe(1)
    await Promise.all(committedReceipts)
    await flushPromises()
    expect(committedReceipts).toHaveLength(committedKeys.length)
    expect(abortedReceipts).toHaveLength(
      scenario.beforeOpen.filter((action) => action === `abort`).length +
        scenario.afterOpen.filter((action) => action === `abort`).length,
    )
    expect(abortedReceipts.every(({ status }) => status === `rejected`)).toBe(
      true,
    )

    if (openKey !== undefined) {
      harness.sync.commit()
      expect(appliedKeys).toEqual([1, ...committedKeys, openKey])
      expect(batches.at(-1)).toEqual([openKey])
    }

    expect(collection._state.pendingSyncedTransactions).toHaveLength(0)
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

const { multiplier, ...replay } = readOracleRunConfig()
const generatedRuns = 30 * multiplier

describe(`sync publication reentrancy`, () => {
  it(`compares layout with the public state before an immediate prefix drain`, async () => {
    type OrderedRow = Row & { rank: number }
    type OrderedSync = Parameters<SyncConfig<OrderedRow, number>[`sync`]>[0]
    const updatePersistence = createDeferred<void>()
    const insertPersistence = createDeferred<void>()
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-prefix-drain`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          ops.begin({ immediate: true })
          ops.write({
            type: `insert`,
            value: { id: 1, value: `one`, rank: 0 },
          })
          ops.write({
            type: `insert`,
            value: { id: 2, value: `two`, rank: 1 },
          })
          ops.commit()
          ops.markReady()
        },
      },
      onUpdate: () => updatePersistence.promise,
      onInsert: () => insertPersistence.promise,
    })
    const callbacks: Array<{
      changes: Array<number>
      keys: Array<number>
      values: Array<string>
    }> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key as number),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
        })
      },
      { includeInitialState: false },
    )
    const update = collection.update(1, (draft) => {
      draft.value = `optimistic-one`
    })
    let insert: ReturnType<typeof collection.insert> | undefined

    try {
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.collection._markLayoutChange()
      const firstReceipt = sync.commit()
      expect(firstReceipt).not.toBe(true)

      insert = collection.insert({
        id: 3,
        value: `optimistic-three`,
        rank: 3,
      })
      callbacks.length = 0
      const revisionBeforeDrain = collection._layoutRevision
      expect([...collection.keys()]).toEqual([1, 2, 3])

      sync.begin({ immediate: true })
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 0 },
      })
      sync.collection._markLayoutChange()
      const secondReceipt = sync.commit()

      expect([...collection.keys()]).toEqual([1, 2, 3])
      expect(collection.toArray.map(({ value }) => value)).toEqual([
        `optimistic-one`,
        `two`,
        `optimistic-three`,
      ])
      expect(callbacks).toEqual([])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain)
      await Promise.all(
        [firstReceipt, secondReceipt]
          .filter((receipt) => receipt !== true)
          .map((receipt) => receipt),
      )

      updatePersistence.resolve()
      insertPersistence.resolve()
      await Promise.all([
        update.isPersisted.promise,
        insert.isPersisted.promise,
      ])
    } finally {
      updatePersistence.resolve()
      insertPersistence.resolve()
      await update.isPersisted.promise.catch(() => undefined)
      await insert?.isPersisted.promise.catch(() => undefined)
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`preserves sync work opened by a listener until it is committed`, async () => {
    const harness = createSyncHarness(`listener-opened-sync-work`)
    const { collection } = harness
    let openedInnerTransaction = false
    const batches: Array<Array<number>> = []

    const subscription = collection.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key as number))
      if (!openedInnerTransaction && changes.some(({ key }) => key === 1)) {
        openedInnerTransaction = true
        stageInsert(harness.sync, { id: 2, value: `inner` })
      }
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(openedInnerTransaction).toBe(true)
      expect(collection.get(2)).toBeUndefined()

      expect(() => harness.sync.commit()).not.toThrow()
      expect(collection.get(2)).toMatchObject({ id: 2, value: `inner` })
      expect(batches).toEqual([[1], [2]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes listener-committed sync work after the outer batch exactly once`, async () => {
    const harness = createSyncHarness(`listener-committed-sync-work`)
    const { collection } = harness
    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    const batches: Array<Array<number>> = []
    let listenerDepth = 0
    let maxListenerDepth = 0
    let committedInnerTransaction = false

    const subscription = collection.subscribeChanges((changes) => {
      listenerDepth++
      maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
      batches.push(changes.map((change) => change.key as number))

      if (!committedInnerTransaction && changes.some(({ key }) => key === 1)) {
        committedInnerTransaction = true
        stageInsert(harness.sync, { id: 2, value: `inner` })
        harness.sync.commit()
      }

      listenerDepth--
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(appliedKeys).toEqual([1, 2])
      expect(batches).toEqual([[1], [2]])
      expect(maxListenerDepth).toBe(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps callback work FIFO across committed, aborted, and open transactions`, async () => {
    const harness = createSyncHarness(`listener-sync-action-order`)
    const { collection } = harness
    const batches: Array<Array<number>> = []
    let ranListenerActions = false

    const subscription = collection.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key as number))
      if (ranListenerActions || !changes.some(({ key }) => key === 1)) return
      ranListenerActions = true

      stageInsert(harness.sync, { id: 2, value: `left-open` })

      stageInsert(harness.sync, { id: 3, value: `committed` })
      harness.sync.metadata!.row.set(3, { source: `listener` })
      harness.sync.metadata!.collection.set(`listener:commit`, 3)
      harness.sync.commit()

      stageInsert(harness.sync, { id: 4, value: `aborted` })
      const controller = new AbortController()
      controller.abort()
      const abortedReceipt = harness.sync.commit(controller.signal)
      if (abortedReceipt !== true) {
        void abortedReceipt.catch(() => undefined)
      }
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(collection.get(3)).toMatchObject({ id: 3, value: `committed` })
      expect(collection.get(4)).toBeUndefined()
      expect(collection._state.syncedMetadata.get(3)).toEqual({
        source: `listener`,
      })
      expect(
        collection._state.syncedCollectionMetadata.get(`listener:commit`),
      ).toBe(3)

      harness.sync.commit()
      expect(collection.get(2)).toMatchObject({ id: 2, value: `left-open` })
      expect(batches).toEqual([[1], [3], [2]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`drains listener-committed transactions in staging order`, async () => {
    const harness = createSyncHarness(`listener-sync-fifo`)
    const { collection } = harness
    const batches: Array<Array<number>> = []
    let stagedInnerTransactions = false

    const subscription = collection.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key as number))
      if (stagedInnerTransactions || !changes.some(({ key }) => key === 1)) {
        return
      }
      stagedInnerTransactions = true

      stageInsert(harness.sync, { id: 2, value: `first` })
      harness.sync.commit()
      stageInsert(harness.sync, { id: 3, value: `second` })
      harness.sync.commit()
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect([...collection._state.syncedData.keys()]).toEqual([1, 2, 3])
      expect(batches).toEqual([[1], [2, 3]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`drains callback work before surfacing a listener error`, async () => {
    const harness = createSyncHarness(`throwing-sync-listener`)
    const { collection } = harness
    const failure = new Error(`listener failed`)
    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    let queuedReceipt: Promise<void> | undefined
    const subscription = collection.subscribeChanges((changes) => {
      if (!changes.some(({ key }) => key === 1)) return
      stageInsert(harness.sync, { id: 2, value: `queued` })
      const receipt = harness.sync.commit()
      if (receipt === true) {
        throw new Error(`Expected callback-created work to queue`)
      }
      queuedReceipt = receipt
      throw failure
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `first` })
      expect(() => harness.sync.commit()).toThrow(failure)
      expect(collection.get(1)).toMatchObject({ id: 1, value: `first` })
      expect(collection.get(2)).toMatchObject({ id: 2, value: `queued` })
      expect(queuedReceipt).toBeDefined()
      await expect(queuedReceipt).resolves.toBeUndefined()

      stageInsert(harness.sync, { id: 3, value: `second` })
      expect(() => harness.sync.commit()).not.toThrow()

      expect(appliedKeys).toEqual([1, 2, 3])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`queues a listener truncate until the outer publication finishes`, async () => {
    const harness = createSyncHarness(`listener-sync-truncate`)
    const { collection } = harness
    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    let stagedTruncate = false
    const subscription = collection.subscribeChanges((changes) => {
      if (stagedTruncate || !changes.some(({ key }) => key === 1)) return
      stagedTruncate = true
      harness.sync.begin()
      harness.sync.truncate()
      harness.sync.write({
        type: `insert`,
        value: { id: 2, value: `replacement` },
      })
      harness.sync.commit()
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(appliedKeys).toEqual([1, 2])
      expect(collection.get(1)).toBeUndefined()
      expect(collection.get(2)).toMatchObject({
        id: 2,
        value: `replacement`,
      })
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`queues listener-triggered source-row garbage collection`, async () => {
    const harness = createSyncHarness(`listener-sync-row-gc`)
    const { collection } = harness
    stageInsert(harness.sync, { id: 2, value: `released` })
    harness.sync.commit()

    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    const batches: Array<Array<number>> = []
    let queuedGarbageCollection = false
    let listenerDepth = 0
    let maxListenerDepth = 0
    const subscription = collection.subscribeChanges(
      (changes) => {
        listenerDepth++
        maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
        batches.push(changes.map((change) => change.key as number))
        if (!queuedGarbageCollection && changes.some(({ key }) => key === 1)) {
          queuedGarbageCollection = true
          void collection._state.deleteSyncedRows([2])
        }
        listenerDepth--
      },
      { includeInitialState: true },
    )
    batches.length = 0

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(appliedKeys).toEqual([1])
      expect(collection.get(2)).toBeUndefined()
      expect(batches).toEqual([[1], [2]])
      expect(maxListenerDepth).toBe(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`releases applied subset coverage from inside its publication callback`, async () => {
    let sync!: SyncOps
    const unloadSubset = vi.fn()
    const collection = createCollection<Row, number>({
      id: `listener-subset-release-row-gc`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          ops.markReady()
          return {
            loadSubset: async () => {
              stageInsert(ops, { id: 2, value: `owned` })
              const receipt = ops.commit()
              if (receipt !== true) await receipt
              return { hasMore: false, appliedRowKeys: [2] }
            },
            unloadSubset,
          }
        },
      },
    })
    let ownerUnsubscribed = false
    const owner = collection.subscribeChanges((changes) => {
      if (ownerUnsubscribed || !changes.some(({ key }) => key === 1)) return
      ownerUnsubscribed = true
      owner.unsubscribe()
    })
    owner.requestSnapshot({ optimizedOnly: false })
    await flushPromises()
    expect(collection._sync.getLoadSubsetCoverage()).toHaveLength(1)

    const batches: Array<Array<number>> = []
    let listenerDepth = 0
    let maxListenerDepth = 0
    const observer = collection.subscribeChanges(
      (changes) => {
        listenerDepth++
        maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
        batches.push(changes.map((change) => change.key as number))
        listenerDepth--
      },
      { includeInitialState: true },
    )
    batches.length = 0

    try {
      stageInsert(sync, { id: 1, value: `outer` })
      expect(() => sync.commit()).not.toThrow()

      expect(ownerUnsubscribed).toBe(true)
      expect(unloadSubset).toHaveBeenCalledOnce()
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
      expect(collection.get(2)).toBeUndefined()
      expect(batches).toEqual([[1], [2]])
      expect(maxListenerDepth).toBe(1)
    } finally {
      owner.unsubscribe()
      observer.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps normal listener sync work queued behind optimistic persistence`, async () => {
    let sync!: SyncOps
    const mutation = createDeferred<void>()
    const collection = createCollection<Row, number>({
      id: `listener-sync-with-optimistic-work`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          ops.markReady()
        },
      },
      onInsert: () => mutation.promise,
    })
    const optimisticTransaction = collection.insert({
      id: 2,
      value: `optimistic`,
    })
    let stagedInnerTransaction = false
    const subscription = collection.subscribeChanges((changes) => {
      if (stagedInnerTransaction || !changes.some(({ key }) => key === 1)) {
        return
      }
      stagedInnerTransaction = true
      stageInsert(sync, { id: 3, value: `queued` })
      sync.commit()
    })

    try {
      stageInsert(sync, { id: 1, value: `outer` }, { immediate: true })
      sync.commit()

      expect(stagedInnerTransaction).toBe(true)
      expect(collection.get(3)).toBeUndefined()

      mutation.resolve()
      await optimisticTransaction.isPersisted.promise

      expect(collection.get(3)).toMatchObject({ id: 3, value: `queued` })
    } finally {
      mutation.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`matches every bounded reentrant listener history`, async () => {
    for (const scenario of exhaustiveListenerScenarios) {
      await runListenerScenario(scenario)
    }
  })

  fcTest.prop([listenerScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1774,
  })(`matches the reentrant drain laws for a fixed seed`, runListenerScenario)

  fcTest.prop(
    [listenerScenarioArbitrary],
    oracleRandomParameters(
      generatedRuns,
      replay,
      `collection-sync.reentrant-drain`,
    ),
  )(
    `matches the reentrant drain laws for a random or replayed seed`,
    runListenerScenario,
  )
})
