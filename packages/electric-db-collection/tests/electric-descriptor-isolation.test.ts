import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message } from '@electric-sql/client'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

type TestRow = { id: number; name: string; stable: string }
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

function descriptor(form: `original` | `once-spread`, startSync = true) {
  const options = electricCollectionOptions<TestRow>({
    shapeOptions: { url: `http://test-url`, params: { table: `test_table` } },
    getKey: (row) => row.id,
    startSync,
  })
  // Spreading once consumes the options creator's utils getter. Reusing this
  // plain descriptor must be as safe as reading that getter for each instance.
  return form === `once-spread` ? { ...options } : options
}

beforeEach(() => {
  streams.length = 0
  vi.clearAllMocks()
})

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
    const rows = new Map<string | number, TestRow>()
    const metadata = new Map<string, unknown>()
    const adapter: PersistenceAdapter = {
      loadSubset: () =>
        Promise.resolve(Array.from(rows, ([key, value]) => ({ key, value }))),
      loadCollectionMetadata: () =>
        Promise.resolve(
          Array.from(metadata, ([key, value]) => ({ key, value })),
        ),
      applyCommittedTx: (_collectionId, transaction) => {
        if (transaction.truncate) rows.clear()
        for (const mutation of transaction.mutations) {
          if (mutation.type === `delete`) rows.delete(mutation.key)
          else
            rows.set(mutation.key, {
              ...rows.get(mutation.key),
              ...mutation.value,
            } as TestRow)
        }
        for (const mutation of transaction.collectionMetadataMutations ?? []) {
          if (mutation.type === `delete`) metadata.delete(mutation.key)
          else metadata.set(mutation.key, mutation.value)
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
