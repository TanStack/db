import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import type { ChangeMessage } from '../src/types.js'

type Row = { id: string; version: number }
type Mode = `granular` | `wholesale`
type Reaction =
  | `none`
  | `nested`
  | `throw`
  | `nestedThrow`
  | `removePeer`
  | `addPeer`
  | `dispose`
type Command =
  | { type: `subscribe`; listener: number }
  | { type: `unsubscribe`; listener: number }
  | {
      type: `publish`
      version: number
      nestedVersion: number
      reactor: number
      peer: number
      reaction: Reaction
    }
  | { type: `dispose` }

type RecordedChange =
  | { type: `insert` | `delete`; key: string; version: number }
  | {
      type: `update`
      key: string
      version: number
      previousVersion: number
    }
type VisibleRow = { key: string; version: number }
type Delivery = {
  listener: number
  changes: Array<RecordedChange> | undefined
  rows: Array<VisibleRow>
  bootstrap: boolean
}
type ListenerModel = { active: boolean; version?: number }
type Model = {
  disposed: boolean
  sourceVersion?: number
  listeners: Map<number, ListenerModel>
  order: Array<number>
  deliveries: Array<Delivery>
}
type CommandType = Command[`type`]
type Reach = {
  commands: Record<CommandType, number>
  reactions: Record<Reaction, number>
}
type DeliveryFault =
  | `dropPeerAfterThrow`
  | `duplicateBootstrap`
  | `reentrantOutOfOrder`
type RunOptions = {
  fault?: DeliveryFault
  reach?: Reach
}

/**
 * # Which listeners may receive each live-query publication?
 *
 * The model is an eligibility ledger, not a second dispatch queue. Each
 * listener is active or inactive and may hold one reconstructed row version.
 * A publication snapshots eligible listeners in subscription order. Reentrant
 * publications join the FIFO behind it. Removing, adding, throwing, or
 * disposing during delivery affects later work according to the table below.
 *
 * Generated subscribe, unsubscribe, publish, and dispose histories drive both
 * granular and wholesale observers. The driver compares exact listener order,
 * multiplicity, raw batches, reconstructed rows, bootstrap flags, and the first
 * surfaced error after every command. Fixed histories prove every command and
 * reaction is reachable; injected faults calibrate the observations.
 *
 * Hydration, status scheduling, resource ownership, and multi-row layout have
 * separate focused owners. This model stays one-row on purpose: listener
 * eligibility is independent of query layout.
 *
 * ## Contract and ownership table

| Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
| --- | --- | --- | --- | --- |
| bootstrap mode | subscribe before/after one visible row, granular/wholesale | createLiveQueryObserver -> subscribe/attach/seed | exact raw batch and reconstructed rows after subscribe | this generated oracle; one fixed key, no layout/order claim |
| publication eligibility | subscribe, unsubscribe, add/remove peer during dispatch | notify -> emit -> flushPublications | exact target order, multiplicity, raw batch, reconstructed/direct rows after each command | this generated oracle |
| FIFO reentry | a listener publishes one nested update | emit -> publicationQueue -> flushPublications | outer delivery precedes nested delivery for every eligible listener | this generated oracle; one nested level per command |
| disposal | top-level or listener-triggered disposal | dispose -> detach/queue clear | in-flight cutoff and absence of later delivery | this generated oracle |
| listener failures | ordinary/reentrant/dispose, two failures, thrown undefined | flushPublications failure capture | peer rows and first rethrown error | focused `live-query-observer.test.ts` test `delivers peer publications before reporting a listener failure`; not duplicated here beyond one throwing reactor |
| logical subscription identity | same callback subscribed twice | SubscriptionRecord lifecycle | independent teardown/call count | focused `live-query-observer.test.ts` test `treats two subscriptions with the same callback as independent` |
| readiness/stale ready | unsubscribe/resubscribe and dispose before markReady | status listener -> notify(undefined) | exact ready-notify count | focused `live-query-observer.test.ts` tests `fires the ready notify once...`, `emits exactly one post-bootstrap...`; stale-ready calibration below |
| hydration handoff | server seed followed by live readiness | DbClient hydrate -> syncHydrationState/handoffHydrationSeed | atomic visible rows/batch at handoff | focused `live-query-observer.test.ts` tests `shows a hydrated result...` and `delivers an atomic hydrated-to-live diff...` |
| stale server data | server snapshot arrives after live readiness | client event -> syncHydrationState/markLiveResultAuthoritative | live rows remain visible and stale snapshot is consumed | focused `live-query-observer.test.ts` test `ignores a server snapshot that arrives after browser sync is ready` |
| errors | live/status or streamed error before/after hydration authority | status/client event -> getError/getSnapshot | error identity, status, and retained rows | focused `live-query-observer.test.ts` tests `publishes a live error...`, `exposes a streamed query error...`, and `ignores a server failure...` |
| source authority | abandoned read, consumed seed, or later observer | syncHydrationState -> markLiveResultAuthoritative/_consumeLiveQueryResult | which server/live result remains authoritative | focused `live-query-observer.test.ts` tests `does not consume...abandoned render`, `does not replay...later observer`, and the stale-server tests |
| client resource lifecycle | preload/dehydrate/cleanup and streamed results | DbClient live-query registry | result/error/cleanup ownership | focused `db-client.test.ts`; framework/native wiring remains outside this oracle |

 * The generated owner compares one-row insert/update histories. It preserves the
raw callback batch, but does not claim multi-row layout/order, hydration,
status scheduling, preload, framework wiring, or native boundaries.
 */

const reactions: ReadonlyArray<Reaction> = [
  `none`,
  `nested`,
  `throw`,
  `nestedThrow`,
  `removePeer`,
  `addPeer`,
  `dispose`,
]
const historyProperties = {
  granular: `live-query-observer.granular-history`,
  wholesale: `live-query-observer.wholesale-history`,
} as const

const listener = fc.integer({ min: 0, max: 3 })
const command = fc.oneof(
  fc.record({ type: fc.constant(`subscribe` as const), listener }),
  fc.record({ type: fc.constant(`unsubscribe` as const), listener }),
  fc.record({
    type: fc.constant(`publish` as const),
    version: fc.integer({ min: -20, max: 20 }),
    nestedVersion: fc.integer({ min: -20, max: 20 }),
    reactor: listener,
    peer: listener,
    reaction: fc.constantFrom<Reaction>(...reactions),
  }),
  fc.constant({ type: `dispose` } as const),
)

let collectionId = 0

function emptyReach(): Reach {
  return {
    commands: { subscribe: 0, unsubscribe: 0, publish: 0, dispose: 0 },
    reactions: {
      none: 0,
      nested: 0,
      throw: 0,
      nestedThrow: 0,
      removePeer: 0,
      addPeer: 0,
      dispose: 0,
    },
  }
}

function recordedChanges(
  changes: Array<ChangeMessage<Row, string>> | undefined,
): Array<RecordedChange> | undefined {
  return changes?.map((change) =>
    change.type === `update`
      ? {
          type: change.type,
          key: change.key,
          version: change.value.version,
          previousVersion: change.previousValue!.version,
        }
      : {
          type: change.type,
          key: change.key,
          version: change.value.version,
        },
  )
}

function visibleRows(rows: ReadonlyMap<string, Row>): Array<VisibleRow> {
  return Array.from(rows, ([key, row]) => ({ key, version: row.version }))
}

function publicationChanges(
  version: number,
  previousVersion: number | undefined,
): Array<RecordedChange> {
  return previousVersion === undefined
    ? [{ type: `insert`, key: `row`, version }]
    : [
        {
          type: `update`,
          key: `row`,
          version,
          previousVersion,
        },
      ]
}

function activeListeners(model: Model): Array<number> {
  return model.order.filter((id) => model.listeners.get(id)?.active)
}

function deliver(
  model: Model,
  targets: ReadonlyArray<number>,
  version: number,
  bootstrap: boolean,
  changes: Array<RecordedChange>,
): void {
  for (const id of targets) {
    if (model.disposed) return
    model.deliveries.push({
      listener: id,
      changes,
      rows: [{ key: `row`, version }],
      bootstrap,
    })
    model.listeners.get(id)!.version = version
  }
}

function subscribeModel(model: Model, mode: Mode, id: number): boolean {
  if (model.disposed || model.listeners.get(id)?.active) return false
  model.listeners.set(id, { active: true })
  model.order = [...model.order.filter((candidate) => candidate !== id), id]
  if (mode === `granular` && model.sourceVersion !== undefined) {
    deliver(model, [id], model.sourceVersion, true, [
      { type: `insert`, key: `row`, version: model.sourceVersion },
    ])
  }
  return true
}

function unsubscribeModel(model: Model, id: number): boolean {
  const record = model.listeners.get(id)
  if (!record?.active || model.disposed) return false
  record.active = false
  return true
}

function publishModel(
  model: Model,
  mode: Mode,
  commandValue: Extract<Command, { type: `publish` }>,
): { reactor?: number; peer?: number; addedPeer?: boolean; failure?: Error } {
  const previousVersion = model.sourceVersion
  const changed = previousVersion !== commandValue.version
  model.sourceVersion = commandValue.version
  if (model.disposed || !changed) return {}
  const targets = activeListeners(model)
  if (targets.length === 0) return {}
  const reactor = targets[commandValue.reactor % targets.length]!
  const peer =
    commandValue.reaction === `addPeer`
      ? commandValue.peer
      : targets[commandValue.peer % targets.length]!
  const failure =
    commandValue.reaction === `throw` || commandValue.reaction === `nestedThrow`
      ? new Error(`listener ${reactor} failed`)
      : undefined
  let nestedTargets: Array<number> | undefined
  let lateBootstrap: number | undefined
  let addedPeer = false
  let disposedDuringDelivery = false

  for (const id of targets) {
    if (disposedDuringDelivery) break
    deliver(
      model,
      [id],
      commandValue.version,
      false,
      publicationChanges(commandValue.version, previousVersion),
    )
    if (id !== reactor) continue
    if (
      commandValue.reaction === `nested` ||
      commandValue.reaction === `nestedThrow`
    ) {
      model.sourceVersion = commandValue.nestedVersion
      if (commandValue.nestedVersion !== commandValue.version) {
        nestedTargets = activeListeners(model)
      }
    } else if (commandValue.reaction === `removePeer`) {
      model.listeners.get(peer)!.active = false
    } else if (commandValue.reaction === `addPeer`) {
      if (!model.listeners.get(peer)?.active) {
        model.listeners.set(peer, { active: true })
        model.order = [
          ...model.order.filter((candidate) => candidate !== peer),
          peer,
        ]
        addedPeer = true
        if (mode === `granular`) lateBootstrap = peer
      }
    } else if (commandValue.reaction === `dispose`) {
      disposeModel(model)
      disposedDuringDelivery = true
    }
  }
  if (nestedTargets && !disposedDuringDelivery) {
    deliver(
      model,
      nestedTargets,
      commandValue.nestedVersion,
      false,
      publicationChanges(commandValue.nestedVersion, commandValue.version),
    )
  }
  if (lateBootstrap !== undefined && !disposedDuringDelivery) {
    deliver(model, [lateBootstrap], commandValue.version, true, [
      { type: `insert`, key: `row`, version: commandValue.version },
    ])
  }
  return { reactor, peer, addedPeer, failure }
}

function disposeModel(model: Model): void {
  model.disposed = true
  for (const listenerModel of model.listeners.values()) {
    listenerModel.active = false
  }
}

function assertHistory(
  history: ReadonlyArray<Command>,
  checkpoint: number,
  actual: ReadonlyArray<Delivery>,
  expected: ReadonlyArray<Delivery>,
): void {
  expect(actual, JSON.stringify({ history, checkpoint })).toEqual(expected)
}

function deliveryVersion(delivery: Delivery): number | undefined {
  return delivery.rows.find(({ key }) => key === `row`)?.version
}

function injectDeliveryFault(
  actual: ReadonlyArray<Delivery>,
  fault: DeliveryFault | undefined,
): Array<Delivery> {
  const corrupted = [...actual]
  if (fault === `dropPeerAfterThrow`) {
    const index = corrupted.findIndex(
      (delivery) =>
        delivery.listener === 1 &&
        !delivery.bootstrap &&
        deliveryVersion(delivery) === 1,
    )
    if (index >= 0) corrupted.splice(index, 1)
  } else if (fault === `duplicateBootstrap`) {
    const index = corrupted.findIndex((delivery) => delivery.bootstrap)
    if (index >= 0) corrupted.splice(index, 0, corrupted[index]!)
  } else if (fault === `reentrantOutOfOrder`) {
    const outer = corrupted.findIndex(
      (delivery) => delivery.listener === 1 && deliveryVersion(delivery) === 1,
    )
    const nested = corrupted.findIndex(
      (delivery) => delivery.listener === 1 && deliveryVersion(delivery) === 2,
    )
    if (outer >= 0 && nested >= 0) {
      const outerDelivery = corrupted[outer]!
      corrupted[outer] = corrupted[nested]!
      corrupted[nested] = outerDelivery
    }
  }
  return corrupted
}

async function runHistory(
  mode: Mode,
  history: Array<Command>,
  options: RunOptions = {},
): Promise<Reach> {
  let current: Row | undefined
  let publish!: (version: number) => void
  const source = createCollection<Row, string>({
    id: `observer-history-${collectionId++}`,
    getKey: ({ id }) => id,
    startSync: false,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publish = (version) => {
          const next = { id: `row`, version }
          const previous = current
          current = next
          begin()
          write({ type: previous ? `update` : `insert`, value: next })
          commit()
        }
        markReady()
      },
    },
  })
  source.startSyncImmediate()
  const observer = createLiveQueryObserver(source, { mode })
  const model: Model = {
    disposed: false,
    listeners: new Map(),
    order: [],
    deliveries: [],
  }
  const actual: Array<Delivery> = []
  const reconstructed = new Map<number, Map<string, Row>>()
  const unsubscribers = new Map<number, () => void>()
  const queuedBootstraps = new Set<number>()
  const reach = options.reach ?? emptyReach()
  let subscribingListener: number | undefined
  let armed:
    | {
        reactor: number
        peer: number
        reaction: Reaction
        nestedVersion: number
        addedPeer?: boolean
        failure?: Error
      }
    | undefined

  const subscribe = (id: number, bootstrapQueued = false): void => {
    reconstructed.set(id, new Map())
    if (bootstrapQueued) queuedBootstraps.add(id)
    subscribingListener = id
    const unsubscribe = observer.subscribe((changes) => {
      const rows = reconstructed.get(id)!
      if (mode === `granular`) {
        for (const change of changes ?? []) {
          if (change.type === `delete`) rows.delete(change.key)
          else rows.set(change.key, change.value)
        }
      } else {
        rows.clear()
        for (const [key, row] of observer.getSnapshot().state ?? []) {
          rows.set(key, row)
        }
      }
      actual.push({
        listener: id,
        changes: recordedChanges(changes),
        rows: visibleRows(rows),
        bootstrap: subscribingListener === id || queuedBootstraps.delete(id),
      })

      if (!armed || armed.reactor !== id) return
      const reaction = armed
      armed = undefined
      if (
        reaction.reaction === `nested` ||
        reaction.reaction === `nestedThrow`
      ) {
        publish(reaction.nestedVersion)
        reach.reactions[reaction.reaction]++
      } else if (reaction.reaction === `removePeer`) {
        unsubscribers.get(reaction.peer)?.()
        unsubscribers.delete(reaction.peer)
        reach.reactions.removePeer++
      } else if (reaction.reaction === `addPeer` && reaction.addedPeer) {
        subscribe(reaction.peer, mode === `granular`)
        reach.reactions.addPeer++
      } else if (reaction.reaction === `dispose`) {
        observer.dispose()
        reach.reactions.dispose++
      } else if (reaction.reaction === `none`) {
        reach.reactions.none++
      } else if (reaction.reaction === `throw`) {
        reach.reactions.throw++
      }
      if (reaction.failure) throw reaction.failure
    })
    subscribingListener = undefined
    unsubscribers.set(id, unsubscribe)
  }

  try {
    for (const [checkpoint, nextCommand] of history.entries()) {
      if (nextCommand.type === `subscribe`) {
        const accepted = subscribeModel(model, mode, nextCommand.listener)
        if (accepted) {
          subscribe(nextCommand.listener)
          reach.commands.subscribe++
        }
      } else if (nextCommand.type === `unsubscribe`) {
        if (unsubscribeModel(model, nextCommand.listener)) {
          unsubscribers.get(nextCommand.listener)?.()
          unsubscribers.delete(nextCommand.listener)
          reach.commands.unsubscribe++
        }
      } else if (nextCommand.type === `dispose`) {
        if (!model.disposed) {
          disposeModel(model)
          observer.dispose()
          unsubscribers.clear()
          reach.commands.dispose++
        }
      } else {
        const expectedOutcome = publishModel(model, mode, nextCommand)
        reach.commands.publish++
        armed =
          expectedOutcome.reactor === undefined
            ? undefined
            : {
                reactor: expectedOutcome.reactor,
                peer: expectedOutcome.peer!,
                reaction: nextCommand.reaction,
                nestedVersion: nextCommand.nestedVersion,
                addedPeer: expectedOutcome.addedPeer,
                failure: expectedOutcome.failure,
              }
        let caught: unknown
        try {
          publish(nextCommand.version)
        } catch (error) {
          caught = error
        }
        expect(caught).toBe(expectedOutcome.failure)
        armed = undefined
      }

      assertHistory(
        history,
        checkpoint,
        injectDeliveryFault(actual, options.fault),
        model.deliveries,
      )
      expect(visibleRows(source.state)).toEqual(
        model.sourceVersion === undefined
          ? []
          : [{ key: `row`, version: model.sourceVersion }],
      )
      for (const [id, listenerModel] of model.listeners) {
        expect(reconstructed.get(id)?.get(`row`)?.version).toBe(
          listenerModel.version,
        )
      }
      if (!model.disposed) {
        expect(visibleRows(observer.getSnapshot().state ?? new Map())).toEqual(
          model.sourceVersion === undefined
            ? []
            : [{ key: `row`, version: model.sourceVersion }],
        )
      }
    }
    return reach
  } finally {
    observer.dispose()
    await source.cleanup()
  }
}

function reactionHistory(reaction: Reaction): Array<Command> {
  return [
    { type: `subscribe`, listener: 0 },
    { type: `subscribe`, listener: 1 },
    {
      type: `publish`,
      version: 1,
      nestedVersion: 2,
      reactor: 0,
      peer: reaction === `addPeer` ? 2 : 1,
      reaction,
    },
  ]
}

async function runStaleReadyHistory(
  mode: Mode,
  injectStaleReady: boolean,
): Promise<void> {
  let markReady!: () => void
  const source = createCollection<Row, string>({
    id: `observer-stale-ready-${collectionId++}`,
    getKey: ({ id }) => id,
    startSync: false,
    sync: {
      sync: (operations) => {
        markReady = operations.markReady
      },
    },
  })
  source.startSyncImmediate()
  const observer = createLiveQueryObserver(source, { mode })
  let readyNotifications = 0
  const readyListener = (
    changes: Array<ChangeMessage<Row, string>> | undefined,
  ): void => {
    if (changes === undefined) readyNotifications++
  }

  try {
    observer.subscribe(readyListener)
    observer.dispose()
    markReady()
    if (injectStaleReady) readyListener(undefined)
    expect(readyNotifications).toBe(0)
  } finally {
    observer.dispose()
    await source.cleanup()
  }
}

describe(`LiveQueryObserver generated histories`, () => {
  for (const mode of [`granular`, `wholesale`] as const) {
    it.each([1813, -1359260562])(
      `${mode} listeners follow the eligibility ledger with fixed seed=%s`,
      async (seed) => {
        await fc.assert(
          fc.asyncProperty(
            fc.array(command, { minLength: 1, maxLength: 30 }),
            async (history) => {
              await runHistory(mode, history)
            },
          ),
          { numRuns: oracleRuns(75), seed },
        )
      },
    )
    it(`${mode} listeners follow the eligibility ledger with a random or replayed seed`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(command, { minLength: 1, maxLength: 30 }),
          async (history) => {
            await runHistory(mode, history)
          },
        ),
        oraclePropertyOptions(75, historyProperties[mode]),
      )
    })
  }

  it.each([`granular`, `wholesale`] as const)(
    `%s listeners joining during dispatch start with the next eligible publication`,
    async (mode) => {
      await runHistory(mode, [
        { type: `subscribe`, listener: 0 },
        {
          type: `publish`,
          version: 1,
          nestedVersion: 0,
          reactor: 0,
          peer: 1,
          reaction: `addPeer`,
        },
        {
          type: `publish`,
          version: 2,
          nestedVersion: 0,
          reactor: 0,
          peer: 0,
          reaction: `none`,
        },
      ])
    },
  )

  it(`executes every command and reaction kind in fixed production histories`, async () => {
    const reach = emptyReach()
    await runHistory(
      `granular`,
      [
        { type: `subscribe`, listener: 0 },
        { type: `unsubscribe`, listener: 0 },
        { type: `dispose` },
      ],
      { reach },
    )
    for (const reaction of reactions) {
      await runHistory(`granular`, reactionHistory(reaction), { reach })
    }

    expect(Object.values(reach.commands).every((count) => count > 0)).toBe(true)
    expect(Object.values(reach.reactions).every((count) => count > 0)).toBe(
      true,
    )
  })

  it.each([`granular`, `wholesale`] as const)(
    `rejects dropped peer delivery after a throwing listener through the %s production path`,
    async (mode) => {
      const history = reactionHistory(`throw`)
      await runHistory(mode, history)
      const reach = emptyReach()
      await expect(
        runHistory(mode, history, { fault: `dropPeerAfterThrow`, reach }),
      ).rejects.toMatchObject({ name: `AssertionError` })
      expect(reach.reactions.throw).toBe(1)
    },
  )

  it(`rejects a duplicate granular bootstrap through the production seed path`, async () => {
    const history: Array<Command> = [
      {
        type: `publish`,
        version: 1,
        nestedVersion: 0,
        reactor: 0,
        peer: 0,
        reaction: `none`,
      },
      { type: `subscribe`, listener: 0 },
    ]
    await runHistory(`granular`, history)
    await expect(
      runHistory(`granular`, history, { fault: `duplicateBootstrap` }),
    ).rejects.toMatchObject({ name: `AssertionError` })
  })

  it.each([`granular`, `wholesale`] as const)(
    `rejects a reentrant publication delivered out of FIFO order through the %s production path`,
    async (mode) => {
      const history = reactionHistory(`nested`)
      await runHistory(mode, history)
      const reach = emptyReach()
      await expect(
        runHistory(mode, history, { fault: `reentrantOutOfOrder`, reach }),
      ).rejects.toMatchObject({ name: `AssertionError` })
      expect(reach.reactions.nested).toBe(1)
    },
  )

  it.each([`granular`, `wholesale`] as const)(
    `rejects a stale ready notification after disposal through the %s status path`,
    async (mode) => {
      await runStaleReadyHistory(mode, false)
      await expect(runStaleReadyHistory(mode, true)).rejects.toMatchObject({
        name: `AssertionError`,
      })
    },
  )
})
