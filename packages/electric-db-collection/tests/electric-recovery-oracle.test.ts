import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'
import type {
  PersistedCollectionCoordinator,
  PersistedTx,
  PersistenceAdapter,
  ProtocolEnvelope,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils, ElectricSyncMode } from '../src/electric'

type Item = Row & { id: number; name: string; stable: string }
type Subscriber = (messages: Array<Message<Item>>) => void
type Exposure = { cut: string; rows: Array<Item> }

function expectWholeRecoveryTrace(
  entries: Array<Exposure>,
  allowed: Array<Array<Item>>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, allowed, entries })).toBeLessThan(
      allowed.length,
    )
  }
}
const subscribers: Array<Subscriber> = []
const mockSubscribe = vi.fn((callback: Subscriber) => {
  subscribers.push(callback)
  return vi.fn()
})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(() => ({
    subscribe: mockSubscribe,
    requestSnapshot: vi.fn().mockResolvedValue(undefined),
    fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
    forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
    isUpToDate: false,
    shapeHandle: `shape-current`,
    lastOffset: `20_0`,
  })),
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const oldRow: Item = { id: 1, name: `old`, stable: `stable-1` }
const freshRow: Item = { id: 2, name: `fresh`, stable: `stable-2` }
const upToDate: Message<Item> = { headers: { control: `up-to-date` } }

function change(
  operation: `insert` | `update` | `delete`,
  value: Partial<Item>,
): Message<Item> {
  return { key: String(value.id), value: value as Item, headers: { operation } }
}

function fixture(
  syncMode: ElectricSyncMode,
  coordinator?: PersistedCollectionCoordinator,
) {
  const rows = new Map<string | number, Item>([[oldRow.id, { ...oldRow }]])
  const metadata = new Map<string, unknown>([
    [
      `electric:resume`,
      {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `shape-old`,
        shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
        updatedAt: 1,
      },
    ],
  ])
  let hydrationGate = Promise.resolve()
  const commits: Array<PersistedTx> = []
  const adapter: PersistenceAdapter = {
    loadSubset: () => {
      const snapshot = Array.from(rows, ([key, value]) => ({
        key,
        value: { ...value },
      }))
      return hydrationGate.then(() => snapshot)
    },
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_collectionId, tx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, structuredClone(mutation.value))
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else {
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...structuredClone(mutation.value),
          } as Item)
        }
      }
      commits.push(structuredClone(tx))
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electricCollectionOptions<Item>({
        id: `persisted-recovery-${syncMode}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode,
        getKey: (row) => row.id,
        startSync: false,
      }),
      persistence: { adapter, coordinator },
    }),
  )
  const publicRows = () =>
    Array.from(collection.values(), ({ id, name, stable }) => ({
      id,
      name,
      stable,
    })).sort((a, b) => a.id - b.id)
  const durableRows = () =>
    structuredClone([...rows.values()].sort((a, b) => a.id - b.id))
  const exposures: Array<Exposure> = []
  const record = (cut: string) => {
    exposures.push({ cut, rows: structuredClone(publicRows()) })
  }
  let stopObserving = () => {}
  const start = () => {
    stopObserving()
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => record(`event`), {
      includeInitialState: false,
    })
    stopObserving = () => subscription.unsubscribe()
    record(`started`)
  }
  return {
    collection,
    rows,
    metadata,
    commits,
    publicRows,
    durableRows,
    exposures,
    record,
    start,
    stopObserving: () => stopObserving(),
    pauseHydration: (gate: Promise<void>) => {
      hydrationGate = gate
    },
  }
}

const scenarios = ([`eager`, `progressive`] as const).flatMap((syncMode) =>
  [false, true].flatMap((empty) =>
    ([`before`, `after`] as const).map((hydration) => ({
      syncMode,
      empty,
      hydration,
    })),
  ),
)

describe(`persisted Electric recovery laws`, () => {
  beforeEach(() => {
    subscribers.length = 0
    vi.clearAllMocks()
  })

  it(`keeps repaired intermediate publications in the persisted recovery record`, async () => {
    const f = fixture(`eager`)
    try {
      f.start()
      await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
      await vi.waitFor(() => expect(subscribers).toHaveLength(1))
      const cut = f.exposures.length
      f.record(`before`)
      subscribers[0]!([change(`update`, { id: 1, name: `wrong` }), upToDate])
      subscribers[0]!([change(`update`, { id: 1, name: `correct` }), upToDate])
      f.record(`repaired`)
      const correct = [{ ...oldRow, name: `correct` }]
      expect(f.publicRows()).toEqual(correct)
      const entries = f.exposures.slice(cut)
      expect(entries[0]!.rows).toEqual([oldRow])
      expect(
        entries.some(
          ({ cut: kind, rows }) =>
            kind === `event` && rows[0]?.name === `wrong`,
        ),
      ).toBe(true)
      expect(() =>
        expectWholeRecoveryTrace(entries, [[oldRow], correct]),
      ).toThrow()
      expectWholeRecoveryTrace(entries, [
        [oldRow],
        [{ ...oldRow, name: `wrong` }],
        correct,
      ])
    } finally {
      f.stopObserving()
      await f.collection.cleanup()
    }
  })

  function externalPublisher() {
    let receive: ((message: ProtocolEnvelope<unknown>) => void) | undefined
    let id = ``
    let term = 100
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `local`,
      subscribe: (collectionId, callback) => {
        id = collectionId
        receive = callback
        return () => {
          receive = undefined
        }
      },
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: () => Promise.resolve(),
      requestEnsurePersistedIndex: () => Promise.resolve(),
      requestEnsureRemoteSubset: () => Promise.resolve(),
    }
    return {
      coordinator,
      publish: (
        row: Item,
        deleted: boolean,
        fullReload: boolean,
        metadata: Map<string, unknown>,
      ) => {
        const revision = term++
        metadata.set(`oracle:publication`, revision)
        receive?.({
          v: 1,
          dbName: id,
          collectionId: id,
          senderId: `peer`,
          ts: Date.now(),
          payload: {
            type: `tx:committed`,
            term: revision,
            seq: 1,
            txId: `peer-${term}`,
            latestRowVersion: term,
            requiresFullReload: fullReload,
            changedRows: deleted ? [] : [{ key: row.id, value: row }],
            deletedKeys: deleted ? [row.id] : [],
            collectionMetadataMutations: [
              { type: `set`, key: `oracle:publication`, value: revision },
            ],
          },
        })
        return revision
      },
    }
  }

  it.each(
    ([`eager`, `progressive`, `on-demand`] as const).flatMap((syncMode) =>
      [false, true].map((fullReload) => ({ syncMode, fullReload })),
    ),
  )(
    `$syncMode merges stream deltas into independently published rows, fullReload=$fullReload`,
    async ({ syncMode, fullReload }) => {
      const peer = externalPublisher()
      const f = fixture(syncMode, peer.coordinator)
      try {
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        if (syncMode === `on-demand`) await f.collection._sync.loadSubset({})
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        subscribers[0]!([upToDate])
        const cut = f.exposures.length
        f.record(`before peer`)
        f.rows.set(freshRow.id, structuredClone(freshRow))
        peer.publish(freshRow, false, fullReload, f.metadata)
        f.record(`after peer delivery`)
        await vi.waitFor(() =>
          expect(f.publicRows()).toEqual([oldRow, freshRow]),
        )
        f.record(`peer settled`)
        expectWholeRecoveryTrace(f.exposures.slice(cut), [
          [oldRow],
          [oldRow, freshRow],
        ])
        const streamCut = f.exposures.length
        f.record(`before stream delta`)
        subscribers[0]!([
          change(`update`, { id: freshRow.id, name: `changed` }),
          upToDate,
        ])
        const expected = [oldRow, { ...freshRow, name: `changed` }]
        f.record(`after stream delta`)
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
          [oldRow, freshRow],
          expected,
        ])
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  fcTest.prop(
    [
      fc.array(
        fc.record({
          id: fc.integer({ min: 2, max: 4 }),
          name: fc.string({ maxLength: 8 }),
          deleted: fc.boolean(),
          fullReload: fc.boolean(),
        }),
        { minLength: 1, maxLength: 8 },
      ),
    ],
    {
      numRuns: 20,
      examples: [
        [
          [
            { id: 2, name: `external`, deleted: false, fullReload: false },
            { id: 2, name: `removed`, deleted: true, fullReload: true },
          ],
        ],
      ],
    },
  )(
    `independent persistence publications and stream deltas agree with complete-row state`,
    async (commands) => {
      subscribers.length = 0
      const peer = externalPublisher()
      const f = fixture(`on-demand`, peer.coordinator)
      const expected = new Map([[oldRow.id, structuredClone(oldRow)]])
      const expectedRows = () =>
        structuredClone([...expected.values()].sort((a, b) => a.id - b.id))
      try {
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1), {
          interval: 1,
        })
        await f.collection._sync.loadSubset({})
        subscribers[0]!([upToDate])
        for (const command of commands) {
          const before = expectedRows()
          const cut = f.exposures.length
          f.record(`before peer ${JSON.stringify(command)}`)
          const row = {
            id: command.id,
            name: command.name,
            stable: `peer-${command.id}`,
          }
          if (command.deleted) {
            f.rows.delete(row.id)
            expected.delete(row.id)
          } else {
            f.rows.set(row.id, structuredClone(row))
            expected.set(row.id, structuredClone(row))
          }
          const revision = peer.publish(
            row,
            command.deleted,
            command.fullReload,
            f.metadata,
          )
          f.record(`after peer revision ${revision}`)
          // An unchanged row set is not proof that the peer publication ran.
          // Its metadata marker commits with the rows, including empty deletes.
          await vi.waitFor(
            () =>
              expect(
                f.collection._state.syncedCollectionMetadata.get(
                  `oracle:publication`,
                ),
              ).toBe(revision),
            { interval: 1 },
          )
          expect(f.publicRows()).toEqual(expectedRows())
          f.record(`peer revision ${revision} settled`)
          const afterPeer = expectedRows()
          expectWholeRecoveryTrace(f.exposures.slice(cut), [before, afterPeer])
          const streamCut = f.exposures.length
          f.record(`before stream revision ${revision}`)
          subscribers[0]!([
            change(`update`, { id: row.id, name: `stream` }),
            upToDate,
          ])
          if (!command.deleted) expected.set(row.id, { ...row, name: `stream` })
          f.record(`after stream revision ${revision}`)
          expect(f.publicRows()).toEqual(expectedRows())
          await vi.waitFor(
            () => expect(f.durableRows()).toEqual(expectedRows()),
            { interval: 1 },
          )
          expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
            afterPeer,
            expectedRows(),
          ])
        }
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  it.each(scenarios)(
    `$syncMode invalid resume replaces omitted cached rows: empty=$empty, hydration=$hydration callback`,
    async ({ syncMode, empty, hydration }) => {
      const f = fixture(syncMode)
      const gate = deferred()
      try {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        expect(vi.mocked(ShapeStream).mock.calls[0]?.[0]).toMatchObject({
          offset: `10_0`,
          handle: `shape-old`,
        })
        const invalidCut = f.exposures.length
        f.record(`before invalid resume`)
        subscribers[0]!([
          change(`delete`, { id: 1 }),
          change(`update`, { id: 2, name: `partial` }),
          upToDate,
        ])
        f.record(`after invalid resume`)
        await vi.waitFor(() => expect(f.collection.status).toBe(`error`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `reset`,
          }),
        )
        expect(f.publicRows()).toEqual([oldRow])
        expect(f.durableRows()).toEqual([oldRow])
        expectWholeRecoveryTrace(f.exposures.slice(invalidCut), [[oldRow]])

        f.stopObserving()
        await f.collection.cleanup()
        f.pauseHydration(gate.promise)
        const recoveryCut = f.exposures.length
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(2))
        expect(vi.mocked(ShapeStream).mock.calls[1]?.[0]).toMatchObject({
          offset: undefined,
          handle: undefined,
        })
        // Fresh progressive mode hydrates persisted rows only on demand.
        const hydrationDone =
          syncMode === `progressive`
            ? Promise.resolve(f.collection._sync.loadSubset({ limit: 10 }))
            : undefined
        const hydrationOutcome = hydrationDone?.then(
          () => undefined,
          (error: unknown) => ({ error }),
        )
        const awaitHydration = async () => {
          const outcome = await hydrationOutcome
          if (outcome) throw outcome.error
        }
        if (hydration === `before`) {
          gate.resolve()
          await awaitHydration()
          await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        }
        f.record(`before replacement data`)
        const partialCut = f.exposures.length
        const expected = empty ? [] : [freshRow]
        subscribers[1]!(
          expected.map((row) => change(`insert`, structuredClone(row))),
        )
        f.record(`after replacement data`)
        subscribers[1]!([{ headers: { control: `subset-end` } }])
        f.record(`after subset completion`)
        expectWholeRecoveryTrace(f.exposures.slice(partialCut), [
          hydration === `before` ? [oldRow] : [],
        ])
        subscribers[1]!([upToDate])
        f.record(`after replacement commit`)
        // Preserve the original hydration-after-commit cells: the final
        // control is delivered before releasing the paused hydration gate.
        gate.resolve()
        await awaitHydration()
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `resume`,
            requiresTagState: false,
            offset: `20_0`,
          }),
        )
        // The source's complete snapshot defines both results. A reset marker
        // plus a fresh offset is not proof that the old materialization left.
        expect.soft(f.publicRows()).toEqual(expected)
        expect.soft(f.durableRows()).toEqual(expected)
        f.record(`replacement ready`)
        expectWholeRecoveryTrace(f.exposures.slice(recoveryCut), [
          [],
          [oldRow],
          expected,
        ])
      } finally {
        gate.resolve()
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  it.each([`eager`, `progressive`] as const)(
    `%s valid resume retains cached rows and their unchanged fields`,
    async (syncMode) => {
      const f = fixture(syncMode)
      try {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        subscribers[0]!([
          change(`update`, { id: 1, name: `changed` }),
          upToDate,
        ])
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        const expected = [{ ...oldRow, name: `changed` }]
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expect(f.commits.every((tx) => !tx.truncate)).toBe(true)
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )
})
