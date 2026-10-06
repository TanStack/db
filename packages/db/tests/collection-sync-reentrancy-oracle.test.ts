/**
 * What does a sync listener see when it starts sync work during a publication?
 *
 * Contract: a publication is not reentrant. Work a listener commits while a
 * batch publishes queues behind that batch. It applies after the batch closes,
 * in staging order, and publishes once as the next batch. A commit whose signal
 * is already aborted cancels only that open, last transaction and rejects its
 * receipt. A transaction the listener leaves open stays queued, applies
 * nothing, and publishes when it commits. Layout marks, truncates, and errors
 * raised by a listener follow the same queue order.
 *
 * Model: for the generated listener histories, the expected applied keys and
 * batches come from the scenario alone. The outer key publishes first. The
 * keys of the committed actions follow as one batch, in action order. The
 * open key, if any, publishes alone after its commit. Every aborted action
 * rejects and applies nothing. The grammar places up to two commit or abort
 * actions before and after an optional open transaction. A bounded loop
 * enumerates every such history; the fixed and random seeds sample the same
 * grammar.
 *
 * Production path and observation: public sync `begin`, `write`, and
 * `commit`, and `subscribeChanges`. The driver records the keys written to the
 * synced base, each batch's keys, the listener nesting depth, and receipt
 * outcomes. It compares them after the outer commit returns and after the
 * receipts settle.
 *
 * Limits: the pinned tests cover layout marks, truncates, listener errors, and
 * subset release. The generated grammar covers only listener commits, aborts,
 * and one open transaction. Optimistic settlement belongs to
 * `optimistic-history-oracle.ts`.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { CollectionChangesManager } from '../src/collection/changes.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import { createDeferred } from '../src/deferred.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { SyncConfig } from '../src/types.js'

type Row = {
  id: number
  value: string
}

type SyncOps = Parameters<SyncConfig<Row, number>[`sync`]>[0]

type OrderedRow = Row & { rank: number }
type OrderedSync = Parameters<SyncConfig<OrderedRow, number>[`sync`]>[0]

type LayoutCallback = {
  changes: Array<number>
  keys: Array<number>
  values: Array<string>
  markedReceiptSettled: boolean
  revision: number
}

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

function stageInsert(sync: SyncOps, row: Row): void {
  sync.begin()
  sync.write({ type: `insert`, value: row })
}

function installInitialOrderedRows(sync: OrderedSync): void {
  sync.begin()
  sync.write({
    type: `insert`,
    value: { id: 1, value: `one`, rank: 0 },
  })
  sync.write({
    type: `insert`,
    value: { id: 2, value: `two`, rank: 1 },
  })
  sync.commit()
  sync.markReady()
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
    batches.push(changes.map((change) => change.key))

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

    // The listener's committed work applies after the outer batch closes and
    // publishes as one batch; listener delivery never nests.

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
  it.each([`cleanup`, `discard`] as const)(
    `releases queued messages when %s retires a deferral`,
    (ending) => {
      const changes = new CollectionChangesManager<Row, number>()
      const handle = changes.deferPublication()
      changes.emitEvents([
        { type: `insert`, key: 1, value: { id: 1, value: `queued` } },
      ])

      const retired = (
        changes as unknown as { deferral?: { publications: Array<unknown> } }
      ).deferral
      if (!retired) throw new Error(`deferral did not open`)
      expect(retired.publications).toHaveLength(1)

      if (ending === `cleanup`) changes.cleanup()
      else handle.discard()
      expect(retired.publications).toHaveLength(0)
      handle.publish()
    },
  )

  it(`publishes nested deferrals as one coherent batch`, async () => {
    const harness = createSyncHarness(`nested-publication-cycle`)
    const { collection } = harness
    const callbacks: Array<{ changes: Array<string>; visibleValue: string }> =
      []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map((change) => change.value.value),
          visibleValue: collection.get(1)!.value,
        })
      },
      { includeInitialState: false },
    )

    try {
      const outer = collection._deferPublication()
      stageInsert(harness.sync, { id: 1, value: `first` })
      harness.sync.commit()
      const inner = collection._deferPublication()
      harness.sync.begin()
      harness.sync.write({
        type: `update`,
        value: { id: 1, value: `second` },
      })
      harness.sync.commit()

      inner.publish()
      expect(callbacks).toEqual([])
      outer.publish()
      expect(callbacks).toEqual([
        { changes: [`first`, `second`], visibleValue: `second` },
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`starts a fresh publication after the previous one closes`, async () => {
    const harness = createSyncHarness(`successive-publication-cycles`)
    const { collection } = harness
    const callbacks: Array<Array<string>> = []
    const subscription = collection.subscribeChanges(
      (changes) => callbacks.push(changes.map((change) => change.value.value)),
      { includeInitialState: false },
    )

    try {
      const first = collection._deferPublication()
      stageInsert(harness.sync, { id: 1, value: `first` })
      harness.sync.commit()
      first.publish()

      const second = collection._deferPublication()
      harness.sync.begin()
      harness.sync.write({
        type: `update`,
        value: { id: 1, value: `second` },
      })
      harness.sync.commit()
      second.publish()

      expect(callbacks).toEqual([[`first`], [`second`]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not let a discarded deferral poison the next publication`, async () => {
    const harness = createSyncHarness(`discarded-publication-cycle`)
    const { collection } = harness
    const callbacks: Array<Array<string>> = []
    const subscription = collection.subscribeChanges(
      (changes) => callbacks.push(changes.map((change) => change.value.value)),
      { includeInitialState: false },
    )

    try {
      const discarded = collection._deferPublication()
      stageInsert(harness.sync, { id: 1, value: `discarded` })
      harness.sync.commit()
      discarded.discard()
      expect(callbacks).toEqual([])

      const published = collection._deferPublication()
      harness.sync.begin()
      harness.sync.write({
        type: `update`,
        value: { id: 1, value: `published` },
      })
      harness.sync.commit()
      published.publish()
      expect(callbacks).toEqual([[`published`]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`lets a publication callback start the next publication cycle`, async () => {
    const harness = createSyncHarness(`publication-cycle-from-callback`)
    const { collection } = harness
    const callbacks: Array<{
      changes: Array<string>
      visibleValue: string
      revision: number
    }> = []
    const initialRevision = collection._stateRevision
    const write = (type: `insert` | `update`, value: string) => {
      harness.sync.begin()
      harness.sync.write({ type, value: { id: 1, value } })
      harness.sync.commit()
    }
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map((change) => change.value.value),
          visibleValue: collection.get(1)!.value,
          revision: collection._stateRevision,
        })

        if (changes[0]?.value.value === `first`) {
          const secondPublication = collection._deferPublication()
          write(`update`, `second`)
          secondPublication.publish()
        }
      },
      { includeInitialState: false },
    )

    try {
      const firstPublication = collection._deferPublication()
      write(`insert`, `first`)
      firstPublication.publish()

      expect(callbacks).toEqual([
        {
          changes: [`first`],
          visibleValue: `first`,
          revision: initialRevision + 1,
        },
        {
          changes: [`second`],
          visibleValue: `second`,
          revision: initialRevision + 2,
        },
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes an internal layout swap with unchanged endpoints`, async () => {
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-middle-swap`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          ops.begin()
          for (let id = 1; id <= 5; id++) {
            ops.write({
              type: `insert`,
              value: { id, value: `value-${id}`, rank: id },
            })
          }
          ops.commit()
          ops.markReady()
        },
      },
    })
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled: false,
          revision: collection._layoutRevision,
        })
      },
      { includeInitialState: false },
    )

    try {
      const revisionBeforeSwap = collection._layoutRevision
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 3, value: `value-3`, rank: 4 },
      })
      sync.write({
        type: `update`,
        value: { id: 4, value: `value-4`, rank: 3 },
      })
      sync.collection._markLayoutChange()
      expect(sync.commit()).toBe(true)

      expect([...collection.keys()]).toEqual([1, 2, 4, 3, 5])
      expect(collection._layoutRevision).toBe(revisionBeforeSwap + 1)
      expect(callbacks).toEqual([
        {
          changes: [3, 4],
          keys: [1, 2, 4, 3, 5],
          values: [`value-1`, `value-2`, `value-4`, `value-3`, `value-5`],
          markedReceiptSettled: false,
          revision: revisionBeforeSwap + 1,
        },
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a parked layout mark when optimistic persistence drains it`, async () => {
    const updatePersistence = createDeferred<void>()
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-prefix-normal-drain`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          installInitialOrderedRows(ops)
        },
      },
      onUpdate: () => updatePersistence.promise,
    })
    let markedReceiptSettled = false
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled,
          revision: collection._layoutRevision,
        })
      },
      { includeInitialState: false },
    )
    const update = collection.update(2, (draft) => {
      draft.value = `optimistic-two`
    })

    try {
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.collection._markLayoutChange()
      const receipt = sync.commit()
      expect(receipt).not.toBe(true)
      if (receipt !== true) {
        void receipt.then(() => {
          markedReceiptSettled = true
        })
      }

      callbacks.length = 0
      const revisionBeforeDrain = collection._layoutRevision
      await Promise.resolve()
      expect(markedReceiptSettled).toBe(false)
      expect([...collection.keys()]).toEqual([1, 2])

      updatePersistence.resolve()
      await update.isPersisted.promise
      if (receipt !== true) await receipt

      expect([...collection.keys()]).toEqual([2, 1])
      expect(collection.toArray.map(({ value }) => value)).toEqual([
        `two`,
        `one`,
      ])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain + 1)
      // Deltas form one batch; their order is not the collection's row order.
      // Assert exact membership while retaining ordered public-read assertions.
      expect(
        callbacks.map((callback) => ({
          ...callback,
          changes: [...callback.changes].sort((a, b) => a - b),
        })),
      ).toEqual([
        {
          changes: [1, 2],
          keys: [2, 1],
          values: [`two`, `one`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 1,
        },
      ])
      expect(markedReceiptSettled).toBe(true)
    } finally {
      updatePersistence.resolve()
      await update.isPersisted.promise.catch(() => undefined)
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`honors a parked layout mark when truncate drains its causal prefix`, async () => {
    const updatePersistence = createDeferred<void>()
    const insertPersistence = createDeferred<void>()
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-prefix-truncate-drain`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          installInitialOrderedRows(ops)
        },
      },
      onUpdate: () => updatePersistence.promise,
      onInsert: () => insertPersistence.promise,
    })
    let markedReceiptSettled = false
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled,
          revision: collection._layoutRevision,
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
      if (firstReceipt !== true) {
        void firstReceipt.then(() => {
          markedReceiptSettled = true
        })
      }

      insert = collection.insert({
        id: 3,
        value: `optimistic-three`,
        rank: 3,
      })
      callbacks.length = 0
      const revisionBeforeDrain = collection._layoutRevision
      expect([...collection.keys()]).toEqual([1, 2, 3])

      sync.begin()
      sync.truncate()
      sync.write({
        type: `insert`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.write({
        type: `insert`,
        value: { id: 2, value: `two`, rank: 1 },
      })
      const truncateReceipt = sync.commit()

      expect(truncateReceipt).toBe(true)
      expect([...collection.keys()]).toEqual([2, 1, 3])
      expect(collection.toArray.map(({ value }) => value)).toEqual([
        `two`,
        `optimistic-one`,
        `optimistic-three`,
      ])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain + 1)
      expect(callbacks).toEqual([
        {
          // Delete the prior public layout [1, 2, 3], not the unpublished
          // rank update's intermediate [2, 1, 3], then replay whole snapshots.
          // Each key is inserted once after the delete prefix.
          changes: [1, 2, 3, 1, 3, 2],
          keys: [2, 1, 3],
          values: [`two`, `optimistic-one`, `optimistic-three`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 1,
        },
      ])
      if (firstReceipt !== true) await firstReceipt
      expect(markedReceiptSettled).toBe(true)
    } finally {
      subscription.unsubscribe()
      updatePersistence.resolve()
      insertPersistence.resolve()
      await update.isPersisted.promise.catch(() => undefined)
      await insert?.isPersisted.promise.catch(() => undefined)
      await collection.cleanup()
    }
  })

  // A truncate marks the Collection ready before it publishes its batch, and a
  // ready callback can write in that window. The callback's messages and the
  // truncate batch together must be valid for every subscriber, and must end
  // at the Collection's rows, whatever optimistic requests were already
  // active. A subscriber without initial state has no sent-key filter to hide
  // a repeated message. A filtered subscriber keeps only rows whose value is
  // `one`, so a removal must reach it with the row it holds. Subscribers
  // receive the truncate's messages only after the Collection is ready. A
  // message that carries a source row is synced and remote unless a prior
  // request owns its key. A subscriber that the callback creates starts from
  // the rows it sees, and a live query becomes ready showing replaced rows.
  //
  // The model overlays active intents, in order, over source rows. Before the
  // truncate, the source holds keys 1 and 4. The replacement holds 1 and 2, so
  // key 4's prefix delete must remain. A prior request is active before the
  // truncate. The callback then writes once against the rows it can see.
  type ReadyIntent =
    | { type: `update` | `insert`; key: number; value: string }
    | { type: `delete`; key: number }
  const overlay = (
    rows: ReadonlyArray<readonly [number, string]>,
    intents: ReadonlyArray<ReadyIntent | undefined>,
  ) => {
    const visible = new Map(rows)
    for (const intent of intents) {
      if (!intent) continue
      if (intent.type === `delete`) visible.delete(intent.key)
      else visible.set(intent.key, intent.value)
    }
    return visible
  }
  const sourceBefore = [
    [1, `one`],
    [4, `four`],
  ] as const
  const replacement = [
    [1, `one-again`],
    [2, `two`],
  ] as const
  const priorIntents: Record<string, ReadyIntent | undefined> = {
    none: undefined,
    'update 1': { type: `update`, key: 1, value: `prior-one` },
    'delete 1': { type: `delete`, key: 1 },
    'insert 3': { type: `insert`, key: 3, value: `prior-three` },
  }
  const callbackIntents = (visible: ReadonlyMap<number, string>) =>
    [1, 2, 3, 4].flatMap((key): Array<ReadyIntent> =>
      visible.has(key)
        ? [
            { type: `update`, key, value: `callback-${key}` },
            { type: `delete`, key },
          ]
        : [{ type: `insert`, key, value: `callback-${key}` }],
    )
  const sourceValues = new Set<string>(
    [...sourceBefore, ...replacement].map(([, value]) => value),
  )
  const describeIntent = (intent: ReadyIntent | undefined) =>
    intent ? `${intent.type} ${intent.key}` : `none`
  const readyCases = ([`onFirstReady`, `status:change`] as const).flatMap(
    (hook) =>
      Object.entries(priorIntents).flatMap(([priorName, prior]) =>
        callbackIntents(overlay(replacement, [prior])).flatMap((callback) =>
          ([`initial`, `raw`, `filtered`] as const).map((subscriber) => ({
            hook,
            priorName,
            prior,
            callback,
            callbackName: describeIntent(callback),
            subscriber,
          })),
        ),
      ),
  )

  it(`enumerates prior requests and legal ready-callback writes`, () => {
    // none and update 1 allow 6 writes, delete 1 allows 5, insert 3 allows 7.
    expect(readyCases).toHaveLength(2 * 24 * 3)
    const labels = new Set(
      readyCases.map(
        ({ priorName, callbackName }) => `${priorName} / ${callbackName}`,
      ),
    )
    for (const witness of [
      `none / delete 1`,
      `none / delete 2`,
      `none / insert 4`,
      `update 1 / delete 1`,
      `none / insert 3`,
      `insert 3 / delete 3`,
      `delete 1 / insert 1`,
    ])
      expect(labels).toContain(witness)
    expect(labels).not.toContain(`delete 1 / delete 1`)
    expect(labels).not.toContain(`insert 3 / insert 3`)
  })

  it.each(readyCases)(
    `publishes valid truncate messages when a $hook callback runs $callbackName after prior $priorName ($subscriber subscriber)`,
    async ({ hook, prior, callback, subscriber }) => {
      const persistence = createDeferred<void>()
      let sync!: SyncOps
      const collection = createCollection<Row, number>({
        id: `truncate-ready-${hook}-${describeIntent(prior)}-${describeIntent(callback)}-${subscriber}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: (ops) => {
            sync = ops
            ops.begin()
            for (const [id, value] of sourceBefore)
              ops.write({ type: `insert`, value: { id, value } })
            ops.commit()
          },
        },
        onInsert: () => persistence.promise,
        onUpdate: () => persistence.promise,
        onDelete: () => persistence.promise,
      })
      const requests: Array<{ isPersisted: { promise: Promise<unknown> } }> = []
      const apply = (intent: ReadyIntent) => {
        requests.push(
          intent.type === `delete`
            ? collection.delete(intent.key)
            : intent.type === `insert`
              ? collection.insert({ id: intent.key, value: intent.value })
              : collection.update(intent.key, (draft) => {
                  draft.value = intent.value
                }),
        )
      }
      await flushPromises()
      const keeps = (value: string) =>
        subscriber !== `filtered` || value === `one`
      // A subscriber without initial state starts from the rows it can see.
      const mirror = new Map<number, string>(
        subscriber === `initial`
          ? []
          : [...collection.state]
              .map(([key, row]) => [key, row.value] as const)
              .filter(([, value]) => keeps(value)),
      )
      const violations: Array<string> = []
      let truncating = false
      const subscription = collection.subscribeChanges(
        (changes) => {
          if (truncating && collection.status !== `ready`)
            violations.push(`delivered while ${collection.status}`)
          for (const change of changes) {
            if (mirror.has(change.key) === (change.type === `insert`))
              violations.push(`${change.type} ${change.key}`)
            if (
              change.type !== `delete` &&
              sourceValues.has(change.value.value) &&
              prior?.key !== change.key &&
              (!change.value.$synced || change.value.$origin !== `remote`)
            )
              violations.push(`source row ${change.key} published as local`)
            if (change.type === `delete`) mirror.delete(change.key)
            else mirror.set(change.key, change.value.value)
          }
        },
        subscriber === `filtered`
          ? {
              includeInitialState: false,
              where: (row) => eq(row.value, `one`),
            }
          : { includeInitialState: subscriber === `initial` },
      )
      let callbackRan = false
      let callbackSubscription: { unsubscribe: () => void } | undefined
      const write = () => {
        if (callbackRan) return
        callbackRan = true
        apply(callback)
        const seen = new Set(collection.state.keys())
        callbackSubscription = collection.subscribeChanges(
          (changes) => {
            for (const change of changes) {
              if (seen.has(change.key) === (change.type === `insert`))
                violations.push(
                  `callback subscriber ${change.type} ${change.key}`,
                )
              if (change.type === `delete`) seen.delete(change.key)
              else seen.add(change.key)
            }
          },
          { includeInitialState: false },
        )
      }
      const live = createLiveQueryCollection((q) => q.from({ row: collection }))
      let liveAtReady: Array<readonly [number, string]> | undefined
      live.onFirstReady(() => {
        liveAtReady = [...live.state]
          .map(([key, row]) => [key as number, row.value] as const)
          .sort(([a], [b]) => a - b)
      })
      void live.preload()
      if (hook === `onFirstReady`) collection.onFirstReady(write)
      else
        collection.on(`status:change`, ({ status }) => {
          if (status === `ready`) write()
        })

      try {
        if (prior) apply(prior)
        expect(
          [...collection.state].map(([key, row]) => [key, row.value]),
        ).toEqual([...overlay(sourceBefore, [prior])])

        sync.begin()
        sync.truncate()
        for (const [id, value] of replacement)
          sync.write({ type: `insert`, value: { id, value } })
        truncating = true
        expect(sync.commit()).toBe(true)

        expect(callbackRan).toBe(true)
        await flushPromises()
        expect(violations).toEqual([])
        const expected = [...overlay(replacement, [prior, callback])].sort(
          ([a], [b]) => a - b,
        )
        const replaced = [...overlay(replacement, [prior])].sort(
          ([a], [b]) => a - b,
        )
        expect([replaced, expected]).toContainEqual(liveAtReady)
        expect([...mirror].sort(([a], [b]) => a - b)).toEqual(
          expected.filter(([, value]) => keeps(value)),
        )
        expect(
          [...collection.state]
            .map(([key, row]) => [key, row.value] as const)
            .sort(([a], [b]) => a - b),
        ).toEqual(expected)
      } finally {
        subscription.unsubscribe()
        callbackSubscription?.unsubscribe()
        await live.cleanup()
        persistence.resolve()
        await Promise.all(
          requests.map((request) =>
            request.isPersisted.promise.catch(() => undefined),
          ),
        )
        await collection.cleanup()
      }
    },
  )

  // A subscriber or a ready callback can throw while a truncate makes the
  // Collection ready. The commit must still settle every receipt it applied
  // and report the error, as it does when the Collection is already ready.
  it.each(
    // An already-ready Collection runs no ready callbacks, so only a
    // subscriber can throw there.
    [
      { alreadyReady: false, thrower: `subscriber` },
      { alreadyReady: false, thrower: `ready callback` },
      { alreadyReady: true, thrower: `subscriber` },
    ] as const,
  )(
    `settles applied receipts when a $thrower throws during a truncate (alreadyReady: $alreadyReady)`,
    async ({ alreadyReady, thrower }) => {
      const failure = new Error(`${thrower} failure`)
      const persistence = createDeferred<void>()
      let sync!: SyncOps
      const collection = createCollection<Row, number>({
        id: `truncate-ready-throw-${thrower}-${alreadyReady}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: (ops) => {
            sync = ops
            ops.begin()
            ops.write({ type: `insert`, value: { id: 1, value: `one` } })
            ops.commit()
            if (alreadyReady) ops.markReady()
          },
        },
        onUpdate: () => persistence.promise,
      })
      await flushPromises()
      const blocker = collection.update(1, (draft) => {
        draft.value = `optimistic`
      })
      let subscription: { unsubscribe: () => void } | undefined
      try {
        sync.begin()
        sync.write({ type: `insert`, value: { id: 2, value: `two` } })
        const held = sync.commit()
        expect(held).not.toBe(true)
        let heldSettled = false
        if (held !== true)
          void held.then(
            () => (heldSettled = true),
            () => (heldSettled = true),
          )
        if (thrower === `subscriber`) {
          subscription = collection.subscribeChanges(() => {
            throw failure
          })
        } else {
          collection.onFirstReady(() => {
            throw failure
          })
        }

        sync.begin()
        sync.truncate()
        sync.write({ type: `insert`, value: { id: 3, value: `three` } })
        expect(() => sync.commit()).toThrow(failure)
        await flushPromises()

        expect(heldSettled).toBe(true)
        expect(collection.status).toBe(`ready`)
        expect(
          [...collection.state]
            .map(([key, row]) => [key, row.value] as const)
            .sort(([left], [right]) => left - right),
        ).toEqual([
          [1, `optimistic`],
          [3, `three`],
        ])
      } finally {
        subscription?.unsubscribe()
        persistence.resolve()
        await blocker.isPersisted.promise.catch(() => undefined)
        await collection.cleanup()
      }
    },
  )

  it(`captures a fresh layout boundary for each reentrant causal prefix`, async () => {
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-reentrant-prefixes`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          installInitialOrderedRows(ops)
        },
      },
    })
    let listenerDepth = 0
    let maxListenerDepth = 0
    let queuedRestore = false
    let innerReceipt: Promise<void> | undefined
    let innerReceiptSettled = false
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        listenerDepth++
        maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled: innerReceiptSettled,
          revision: collection._layoutRevision,
        })

        if (!queuedRestore) {
          queuedRestore = true
          sync.begin()
          sync.write({
            type: `update`,
            value: { id: 1, value: `one`, rank: 0 },
          })
          sync.collection._markLayoutChange()
          const receipt = sync.commit()
          if (receipt === true) {
            throw new Error(`Expected listener-created work to queue`)
          }
          innerReceipt = receipt
          void receipt.then(() => {
            innerReceiptSettled = true
          })
        }

        listenerDepth--
      },
      { includeInitialState: false },
    )

    try {
      const revisionBeforeDrain = collection._layoutRevision
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.collection._markLayoutChange()
      expect(sync.commit()).toBe(true)

      expect([...collection.keys()]).toEqual([1, 2])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain + 2)
      expect(callbacks).toEqual([
        {
          changes: [1],
          keys: [2, 1],
          values: [`two`, `one`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 1,
        },
        {
          changes: [1],
          keys: [1, 2],
          values: [`one`, `two`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 2,
        },
      ])
      expect(maxListenerDepth).toBe(1)
      expect(innerReceipt).toBeDefined()
      await innerReceipt
      expect(innerReceiptSettled).toBe(true)
    } finally {
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
      batches.push(changes.map((change) => change.key))
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
      batches.push(changes.map((change) => change.key))

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
      batches.push(changes.map((change) => change.key))
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
      batches.push(changes.map((change) => change.key))
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

  it(`releases subset demand from a publication callback without nested delivery`, async () => {
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
              return
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

    const batches: Array<Array<number>> = []
    let listenerDepth = 0
    let maxListenerDepth = 0
    const observer = collection.subscribeChanges(
      (changes) => {
        listenerDepth++
        maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
        batches.push(changes.map((change) => change.key))
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
      expect(collection.get(2)).toMatchObject({ id: 2, value: `owned` })
      expect(batches).toEqual([[1]])
      expect(maxListenerDepth).toBe(1)
    } finally {
      owner.unsubscribe()
      observer.unsubscribe()
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
