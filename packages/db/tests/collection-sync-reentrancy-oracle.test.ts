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
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import { createDeferred } from '../src/deferred.js'
import {
  declareOracle,
  oracleRandomParameters,
  readOracleRunConfig,
} from './oracle-config.js'
import { flushPromises } from './utils.js'
import {
  createSyncHarness,
  stageInsert,
} from './collection-sync-reentrancy-support.js'
import type { Row, SyncOps } from './collection-sync-reentrancy-support.js'

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

declareOracle({
  check: [runListenerScenario],
  grammar: [listenerScenarioArbitrary, exhaustiveListenerScenarios],
})

const { multiplier, ...replay } = readOracleRunConfig()
const generatedRuns = 30 * multiplier

describe(`sync publication reentrancy`, () => {
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

  declareOracle({
    model: [overlay],
    grammar: [readyCases],
  })

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
