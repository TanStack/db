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
      Promise.resolve(Array.from(metadata, ([key, value]) => ({ key, value }))),
    applyCommittedTx: (_collectionId, tx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, mutation.value)
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else {
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...mutation.value,
          } as Item)
        }
      }
      commits.push(tx)
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
  const durableRows = () => [...rows.values()].sort((a, b) => a.id - b.id)
  return {
    collection,
    rows,
    metadata,
    commits,
    publicRows,
    durableRows,
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
        f.collection.startSyncImmediate()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        if (syncMode === `on-demand`) await f.collection._sync.loadSubset({})
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        subscribers[0]!([upToDate])
        f.rows.set(freshRow.id, freshRow)
        peer.publish(freshRow, false, fullReload, f.metadata)
        await vi.waitFor(() =>
          expect(f.publicRows()).toEqual([oldRow, freshRow]),
        )
        subscribers[0]!([
          change(`update`, { id: freshRow.id, name: `changed` }),
          upToDate,
        ])
        const expected = [oldRow, { ...freshRow, name: `changed` }]
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
      } finally {
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
      const expected = new Map([[oldRow.id, oldRow]])
      const expectedRows = () =>
        [...expected.values()].sort((a, b) => a.id - b.id)
      try {
        f.collection.startSyncImmediate()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1), {
          interval: 1,
        })
        await f.collection._sync.loadSubset({})
        subscribers[0]!([upToDate])
        for (const command of commands) {
          const row = {
            id: command.id,
            name: command.name,
            stable: `peer-${command.id}`,
          }
          if (command.deleted) {
            f.rows.delete(row.id)
            expected.delete(row.id)
          } else {
            f.rows.set(row.id, row)
            expected.set(row.id, row)
          }
          const revision = peer.publish(
            row,
            command.deleted,
            command.fullReload,
            f.metadata,
          )
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
          subscribers[0]!([
            change(`update`, { id: row.id, name: `stream` }),
            upToDate,
          ])
          if (!command.deleted) expected.set(row.id, { ...row, name: `stream` })
          expect(f.publicRows()).toEqual(expectedRows())
          await vi.waitFor(
            () => expect(f.durableRows()).toEqual(expectedRows()),
            { interval: 1 },
          )
        }
      } finally {
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
        f.collection.startSyncImmediate()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        expect(vi.mocked(ShapeStream).mock.calls[0]?.[0]).toMatchObject({
          offset: `10_0`,
          handle: `shape-old`,
        })
        subscribers[0]!([
          change(`delete`, { id: 1 }),
          change(`update`, { id: 2, name: `partial` }),
          upToDate,
        ])
        await vi.waitFor(() => expect(f.collection.status).toBe(`error`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `reset`,
          }),
        )
        expect(f.publicRows()).toEqual([oldRow])
        expect(f.durableRows()).toEqual([oldRow])

        await f.collection.cleanup()
        f.pauseHydration(gate.promise)
        f.collection.startSyncImmediate()
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
        if (hydration === `before`) {
          gate.resolve()
          await hydrationDone
          await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        }
        const expected = empty ? [] : [freshRow]
        subscribers[1]!([
          ...expected.map((row) => change(`insert`, row)),
          upToDate,
        ])
        gate.resolve()
        await hydrationDone
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `resume`,
            offset: `20_0`,
          }),
        )
        // The source's complete snapshot defines both results. A reset marker
        // plus a fresh offset is not proof that the old materialization left.
        expect.soft(f.publicRows()).toEqual(expected)
        expect.soft(f.durableRows()).toEqual(expected)
      } finally {
        gate.resolve()
        await f.collection.cleanup()
      }
    },
  )

  it.each([`eager`, `progressive`] as const)(
    `%s valid resume retains cached rows and their unchanged fields`,
    async (syncMode) => {
      const f = fixture(syncMode)
      try {
        f.collection.startSyncImmediate()
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
        await f.collection.cleanup()
      }
    },
  )
})
