import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import type { Message } from '@electric-sql/client'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

type TestRow = { id: number; name: string; stable: string }
type TagExposure = { cut: string; rows: Array<TestRow> }

function expectWholeTagRecovery(
  entries: Array<TagExposure>,
  allowed: Array<Array<TestRow>>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, entries, allowed })).toBeLessThan(
      allowed.length,
    )
  }
}
type StreamHarness = {
  send: (messages: Array<Message<TestRow>>) => void
  unsubscribe: ReturnType<typeof vi.fn>
}

const streams: Array<StreamHarness> = []

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => {
      const unsubscribe = vi.fn()
      return {
        subscribe: (send: StreamHarness[`send`]) => {
          streams.push({ send, unsubscribe })
          return unsubscribe
        },
        requestSnapshot: vi.fn().mockResolvedValue(undefined),
        fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
        isUpToDate: false,
        shapeHandle: `shape-current`,
        lastOffset: `20_0`,
      }
    }),
  }
})

const upToDate: Message<TestRow> = { headers: { control: `up-to-date` } }
const mustRefetch: Message<TestRow> = { headers: { control: `must-refetch` } }

function insert(id: number, tag: string): Message<TestRow> {
  return {
    key: String(id),
    value: { id, name: tag, stable: `stable-${id}` },
    headers: {
      operation: `insert`,
      tags: [tag],
    },
  }
}

function moveOut(tag: string): Message<TestRow> {
  return { headers: { event: `move-out`, patterns: [{ pos: 0, value: tag }] } }
}

function descriptor(
  form: `original` | `once-spread`,
  startSync = true,
  syncMode: `eager` | `on-demand` | `progressive` = `eager`,
) {
  const options = electricCollectionOptions<TestRow>({
    shapeOptions: { url: `http://test-url`, params: { table: `test_table` } },
    getKey: (row) => row.id,
    startSync,
    syncMode,
  })
  // Spreading once consumes the options creator's utils getter. Reusing this
  // plain descriptor must be as safe as reading that getter for each instance.
  return form === `once-spread` ? { ...options } : options
}

function tagPersistence() {
  const rows = new Map<
    string | number,
    { value: TestRow; metadata?: unknown }
  >()
  const metadata = new Map<string, unknown>()
  const adapter: PersistenceAdapter = {
    loadSubset: () =>
      Promise.resolve(
        Array.from(rows, ([key, row]) => ({ key, ...structuredClone(row) })),
      ),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_id, transaction) => {
      if (transaction.truncate) rows.clear()
      for (const mutation of transaction.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else
          rows.set(mutation.key, {
            value: {
              ...rows.get(mutation.key)?.value,
              ...structuredClone(mutation.value),
            } as TestRow,
            metadata: structuredClone(
              mutation.metadata ?? rows.get(mutation.key)?.metadata,
            ),
          })
      }
      for (const mutation of transaction.rowMetadataMutations ?? []) {
        const row = rows.get(mutation.key)
        if (row)
          row.metadata =
            mutation.type === `delete`
              ? undefined
              : structuredClone(mutation.value)
      }
      for (const mutation of transaction.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, structuredClone(mutation.value))
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  return { rows, metadata, adapter }
}

const tagHistory = fc.record({
  syncMode: fc.constantFrom(
    `eager` as const,
    `on-demand` as const,
    `progressive` as const,
  ),
  tagged: fc.boolean(),
  legacyResume: fc.boolean(),
  interruptRecovery: fc.boolean(),
  edits: fc.array(
    fc.record({
      id: fc.integer({ min: 1, max: 3 }),
      renameOnly: fc.boolean(),
      tag: fc.constantFrom(`left`, `right`, `other`),
    }),
    { maxLength: 6 },
  ),
  removals: fc.shuffledSubarray([`left`, `right`, `other`], {
    minLength: 3,
    maxLength: 3,
  }),
})

async function runTagHistory(history: {
  syncMode: `eager` | `on-demand` | `progressive`
  tagged: boolean
  legacyResume: boolean
  interruptRecovery: boolean
  edits: Array<{ id: number; renameOnly: boolean; tag: string }>
  removals: Array<string>
}) {
  for (const cold of [false, true]) {
    for (const fresh of [true, false]) {
      const start = streams.length
      const { rows, metadata, adapter } = tagPersistence()
      const model = new Map(
        [1, 2, 3].map((id) => [
          id,
          {
            row: { id, name: `row-${id}`, stable: `stable-${id}` },
            tags: new Set(
              id === 1 ? [`left`] : id === 2 ? [`right`] : [`left`, `right`],
            ),
          },
        ]),
      )
      const create = () =>
        createCollection(
          persistedCollectionOptions<
            TestRow,
            string | number,
            never,
            ElectricCollectionUtils<TestRow>
          >({
            ...descriptor(`original`, false, history.syncMode),
            id: `persisted-tag-history`,
            persistence: { adapter },
          }),
        )
      const first = create()
      let current = first
      let stopRecoveryObservation = () => {}
      const expectedRows = () => [...model.values()].map((entry) => entry.row)
      const publicRows = () =>
        [...current.values()].map(({ id, name, stable }) => ({
          id,
          name,
          stable,
        }))
      const durableRows = () => [...rows.values()].map((entry) => entry.value)
      const check = async () => {
        expect(publicRows(), `cold=${cold}, fresh=${fresh}`).toEqual(
          expectedRows(),
        )
        await vi.waitFor(() => expect(durableRows()).toEqual(expectedRows()), {
          interval: 1,
        })
      }
      const snapshot = (): Array<Message<TestRow>> =>
        [...model.values()].map(({ row, tags }) => ({
          key: String(row.id),
          value: { ...row },
          headers: {
            operation: `insert`,
            ...(history.tagged && { tags: [...tags] }),
          },
        }))
      try {
        first.startSyncImmediate()
        await vi.waitFor(() => expect(streams).toHaveLength(start + 1), {
          interval: 1,
        })
        streams[start]!.send([...snapshot(), upToDate])
        await check()
        for (const [step, edit] of history.edits.entries()) {
          const entry = model.get(edit.id)!
          const previousTags = [...entry.tags]
          entry.row = { ...entry.row, name: `edit-${step}` }
          if (!edit.renameOnly) entry.tags = new Set([edit.tag])
          streams[start]!.send([
            {
              key: String(edit.id),
              value: { ...entry.row },
              headers: {
                operation: `update`,
                ...(history.tagged &&
                  !edit.renameOnly && {
                    tags: [edit.tag],
                    removed_tags: previousTags.filter(
                      (tag) => tag !== edit.tag,
                    ),
                  }),
              },
            },
            upToDate,
          ])
          await check()
        }
        await vi.waitFor(
          () =>
            expect(metadata.get(`electric:resume`)).toMatchObject({
              kind: `resume`,
            }),
          { interval: 1 },
        )
        await first.cleanup()
        if (history.legacyResume) {
          const resume = {
            ...(metadata.get(`electric:resume`) as Record<string, unknown>),
          }
          delete resume.requiresTagState
          metadata.set(`electric:resume`, resume)
        }
        if (fresh)
          metadata.set(`electric:resume`, {
            kind: `reset`,
            updatedAt: Date.now() + 1,
          })
        if (cold) current = create()
        current.startSyncImmediate()
        await vi.waitFor(() => expect(streams).toHaveLength(start + 2), {
          interval: 1,
        })
        // Lazy persistence hydrates cached rows only when a consumer acquires
        // a subset. The stream alone does not materialize that cache.
        if (history.syncMode !== `eager`) await current._sync.loadSubset({})
        await vi.waitFor(() => expect(publicRows()).toEqual(expectedRows()), {
          interval: 1,
        })
        const rebuild =
          fresh || (cold && (history.tagged || history.legacyResume))
        let resumedStream = streams[start + 1]!
        expect(vi.mocked(ShapeStream).mock.calls[start + 1]?.[0]).toMatchObject(
          { offset: rebuild ? undefined : `20_0` },
        )
        if (rebuild) {
          const cachedRows = structuredClone(expectedRows())
          const exposures: Array<TagExposure> = []
          const record = (cut: string) => {
            exposures.push({ cut, rows: structuredClone(publicRows()) })
          }
          const observe = () => {
            const owner = current
            const subscription = owner.subscribeChanges(
              () => {
                exposures.push({
                  cut: `event`,
                  rows: [...owner.values()].map(({ id, name, stable }) => ({
                    id,
                    name,
                    stable,
                  })),
                })
              },
              { includeInitialState: false },
            )
            stopRecoveryObservation = () => subscription.unsubscribe()
          }
          observe()
          record(`before replacement`)
          // Replacement omits a cached row. Its partial delivery must not
          // expose a torn snapshot or erase the still-visible cached rows.
          model.delete(2)
          for (const entry of model.values()) entry.tags = new Set([`fresh`])
          resumedStream.send(snapshot())
          record(`after partial replacement`)
          expect(publicRows()).toEqual(cachedRows)
          // A concurrent subset request finishing is not completion of the
          // full replacement snapshot used to recover cold membership.
          if (!fresh && cold && (history.tagged || history.legacyResume)) {
            resumedStream.send([{ headers: { control: `subset-end` } }])
            record(`after subset completion`)
            expect(publicRows()).toEqual(cachedRows)
          }
          expectWholeTagRecovery(exposures, [cachedRows])
          if (history.interruptRecovery) {
            const abandoned = resumedStream
            stopRecoveryObservation()
            await current.cleanup()
            current.startSyncImmediate()
            await vi.waitFor(() => expect(streams).toHaveLength(start + 3), {
              interval: 1,
            })
            if (history.syncMode !== `eager`) await current._sync.loadSubset({})
            await vi.waitFor(() => expect(publicRows()).toEqual(cachedRows), {
              interval: 1,
            })
            expect(
              vi.mocked(ShapeStream).mock.calls[start + 2]?.[0],
            ).toMatchObject({ offset: undefined })
            observe()
            record(`replacement lifecycle hydrated`)
            const metadataBefore = structuredClone(
              current.config.sync.exportSyncMeta?.(),
            )
            const abandonedSend = vi.spyOn(abandoned, `send`)
            try {
              abandoned.send([insert(999, `abandoned`), upToDate])
              expect(abandonedSend).toHaveBeenCalledOnce()
            } finally {
              abandonedSend.mockRestore()
            }
            record(`after abandoned callback`)
            expect(current.config.sync.exportSyncMeta?.()).toEqual(
              metadataBefore,
            )
            expectWholeTagRecovery(exposures, [cachedRows])
            resumedStream = streams[start + 2]!
            resumedStream.send(snapshot())
            record(`after restarted partial replacement`)
            expectWholeTagRecovery(exposures, [cachedRows])
          }
          resumedStream.send([upToDate])
          record(`after replacement commit`)
          await check()
          record(`replacement settled`)
          expectWholeTagRecovery(exposures, [
            cachedRows,
            structuredClone(expectedRows()),
          ])
          stopRecoveryObservation()
        }
        for (const tag of history.tagged
          ? [...history.removals, `fresh`]
          : []) {
          // Membership is a set law, independent of Electric's tag index.
          for (const [id, entry] of model) {
            entry.tags.delete(tag)
            if (entry.tags.size === 0) model.delete(id)
          }
          resumedStream.send([moveOut(tag), upToDate])
          await check()
        }
      } finally {
        stopRecoveryObservation()
        await current.cleanup()
        if (current !== first) await first.cleanup()
      }
    }
  }
}

fcTest.prop([tagHistory], { seed: 42712, numRuns: oracleRuns(6) })(
  `persisted tag histories preserve membership across warm and cold restart (fixed)`,
  runTagHistory,
)
fcTest.prop(
  [tagHistory],
  oraclePropertyOptions(10, `electric.persisted-tag-history`),
)(
  `persisted tag histories preserve membership across warm and cold restart (random)`,
  runTagHistory,
)

beforeEach(() => {
  streams.length = 0
  vi.clearAllMocks()
})

it.each([`eager`, `on-demand`, `progressive`] as const)(
  `delivers abandoned tag-recovery callbacks after replacement starts in %s mode`,
  async (syncMode) => {
    await runTagHistory({
      syncMode,
      tagged: true,
      legacyResume: false,
      interruptRecovery: true,
      edits: [],
      removals: [`left`, `right`, `other`],
    })
    // Three interrupted rebuilds plus one compatible warm resume. Each
    // interrupted branch checks its abandoned callback was actually invoked.
    expect(streams).toHaveLength(11)
  },
)

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

const ownerHistory = fc.record({
  startSync: fc.boolean(),
  retire: fc.integer({ min: 0, max: 1 }),
  edits: fc.array(
    fc.record({
      owner: fc.integer({ min: 0, max: 1 }),
      name: fc.string({ maxLength: 8 }),
    }),
    { maxLength: 8 },
  ),
})

async function runOwnerHistory(history: {
  startSync: boolean
  retire: number
  edits: Array<{ owner: number; name: string }>
}) {
  for (const form of [`original`, `once-spread`, `materialized`] as const) {
    const start = streams.length
    const options = descriptor(
      form === `materialized` ? `once-spread` : form,
      history.startSync,
    )
    const first = createCollection({ ...options, id: `owner-first` })
    first.startSyncImmediate()
    streams[start]!.send([insert(1, `first`), upToDate])
    const second =
      form === `materialized`
        ? createCollection({ ...first.config, id: `owner-second` })
        : createCollection({ ...options, id: `owner-second` })
    const collections = [first, second]
    const expected = [`first`, `second`]
    const edit = (owner: number, name: string) => {
      expected[owner] = name
      streams[start + owner]!.send([
        {
          key: `1`,
          value: { id: 1, name, stable: `stable-1` },
          headers: { operation: `update` },
        },
        upToDate,
      ])
    }
    const check = () => {
      for (const [owner, collection] of collections.entries()) {
        expect(collection.status, `${form}: owner ${owner}`).toBe(`ready`)
        expect(collection.get(1)?.name, `${form}: owner ${owner}`).toBe(
          expected[owner],
        )
      }
    }
    try {
      second.startSyncImmediate()
      streams[start + 1]!.send([insert(1, `second`), upToDate])
      check()
      // Both owners must still receive data after binding the peer, even when
      // the generated edit history shrinks to empty.
      edit(0, `first-updated`)
      edit(1, `second-updated`)
      check()
      for (const { owner, name } of history.edits) {
        edit(owner, name)
        check()
      }
      await collections[history.retire]!.cleanup()
      const survivor = 1 - history.retire
      edit(survivor, `after-peer-cleanup`)
      expect(collections[survivor]!.get(1)?.name).toBe(`after-peer-cleanup`)
      expect(
        streams[start + history.retire]!.unsubscribe,
      ).toHaveBeenCalledOnce()
      expect(streams[start + survivor]!.unsubscribe).not.toHaveBeenCalled()
    } finally {
      await first.cleanup()
      await second.cleanup()
    }
  }
}

fcTest.prop([ownerHistory], { seed: 42711, numRuns: oracleRuns(12) })(
  `config derivation preserves independent owner histories (fixed)`,
  runOwnerHistory,
)
fcTest.prop(
  [ownerHistory],
  oraclePropertyOptions(20, `electric.bound-descriptor-history`),
)(
  `config derivation preserves independent owner histories (random)`,
  runOwnerHistory,
)

it(`keeps insert acknowledgements on the owner of a reused persisted descriptor`, async () => {
  const adapter: PersistenceAdapter = {
    loadSubset: () => Promise.resolve([]),
    loadCollectionMetadata: () => Promise.resolve([]),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
  const options = persistedCollectionOptions<
    TestRow,
    string | number,
    never,
    ElectricCollectionUtils<TestRow>
  >({
    ...electricCollectionOptions<TestRow>({
      id: `shared-persisted-options`,
      shapeOptions: { url: `http://test-url`, params: { table: `test_table` } },
      getKey: (row) => row.id,
      startSync: false,
      onInsert: () => Promise.resolve({ txid: 200, timeout: 100 }),
    }),
    persistence: { adapter },
  })
  const first = createCollection(options)
  const second = createCollection(options)
  try {
    first.startSyncImmediate()
    await vi.waitFor(() => expect(streams).toHaveLength(1))
    streams[0]!.send([upToDate])
    await vi.waitFor(() => expect(first.status).toBe(`ready`))
    second.startSyncImmediate()
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    streams[1]!.send([upToDate])
    await vi.waitFor(() => expect(second.status).toBe(`ready`))

    const transaction = first.insert({ id: 1, name: `own`, stable: `stable-1` })
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
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      expect(collection.has(1)).toBe(false)
      await vi.waitFor(() => expect(rows.has(1)).toBe(false))
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

    it(`discards tag state when the same collection starts a fresh session`, async () => {
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
