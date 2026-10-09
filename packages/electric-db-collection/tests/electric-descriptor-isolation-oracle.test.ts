import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import { StreamAbortedError } from '../src/errors'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import { atCheckpoint } from './electric-oracle-lifecycle'
import { tagPersistence } from './electric-persistence-fixture'
import type { TestRow } from './electric-persistence-fixture'
import type { Message } from '@electric-sql/client'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

/**
 * # Can reused Electric descriptors keep independent owners and tag state?
 *
 * One descriptor may create several Collections, but each Collection must own
 * its sync run, acknowledgement waiters, tag membership, and cleanup.
 * A compatible warm resume retains selected tags; a fresh snapshot rebuilds them.
 * A `move-out` removes a row only after its modeled tag membership is empty.
 *
 * Plain Maps and tag sets form the independent model. Generated histories vary
 * descriptor form, sync mode, warm and cold restart, interrupted recovery,
 * edits, and tag removals. The driver uses the real Collection, Electric
 * adapter, persisted wrapper, and a controlled ShapeStream SDK boundary.
 * Checkpoints compare coherent public snapshots, durable rows, recovery traces,
 * acknowledgement ownership, and unsubscribe calls. Restart demand must use
 * the current stream's capability and wait for its source rows to apply.
 * This fixture has no managed cache claim. Its on-demand recovery uses a full
 * source snapshot: cached rows remain visible until the first source batch,
 * while a new demand waits for the replacement commit. Managed scoped recovery
 * has separate real-adapter and installed-SDK owners.
 * The installed-SDK delivery oracle receives the mock's full-mode restriction.
 *
 * Fixed and random campaigns retain replay inputs through the shared oracle
 * configuration. The controlled stream does not establish live Electric HTTP
 * framing or service behavior; those have separate owners.
 */

const { replayPath, replayProperty } = readOracleRunConfig()
const fixedCase = replayPath === undefined ? it : it.skip
const fixedDescribe = replayPath === undefined ? describe : describe.skip

// The durable fixture is a driver, not the independent tag model. It must
// preserve the SQLite adapter's mutation algebra: an insert replaces the old
// value, while metadataChanged clears metadata even when the new value is
// undefined. Otherwise the tag oracle could falsely accept stale columns or
// stale membership after a fresh source snapshot.
fixedCase(`replaces stale durable columns and metadata on insert`, async () => {
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

  await adapter.applyCommittedTx(`fixture-insert-law`, {
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
  })

  expect(rows.get(1)).toEqual({
    value: { id: 1, name: `fresh`, stable: `fresh-stable` },
    metadata: undefined,
  })
})

type TagExposure = { cut: string; rows: Array<TestRow> }

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
  holdSnapshots: boolean
  ignoreUnsubscribe: boolean
  pendingSnapshotCount: () => number
  snapshotRequested: () => Promise<void>
  completeSnapshot: (messages?: Array<Message<TestRow>>) => void
}

const streams: Array<StreamHarness> = []
let holdNewSnapshots = false
let onStreamSubscribed: (() => void) | undefined

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn((options: { log?: string }) => {
      const pendingSnapshots: Array<{
        resolve: () => void
        reject: (error: Error) => void
      }> = []
      const requestObservers: Array<() => void> = []
      let snapshotRequests = 0
      const unsubscribe = vi.fn(() => {
        if (harness?.ignoreUnsubscribe) return
        for (const pending of pendingSnapshots.splice(0)) {
          pending.reject(new Error(`snapshot aborted`))
        }
      })
      let harness: StreamHarness | undefined
      return {
        subscribe: (send: StreamHarness[`send`]) => {
          harness = {
            send,
            unsubscribe,
            holdSnapshots: holdNewSnapshots,
            ignoreUnsubscribe: false,
            pendingSnapshotCount: () => pendingSnapshots.length,
            snapshotRequested: () =>
              snapshotRequests > 0
                ? Promise.resolve()
                : new Promise<void>((resolve) =>
                    requestObservers.push(resolve),
                  ),
            completeSnapshot: (messages) => {
              const pending = pendingSnapshots.shift()
              if (!pending) throw new Error(`no pending snapshot request`)
              if (messages) send(messages)
              pending.resolve()
            },
          }
          streams.push(harness)
          onStreamSubscribed?.()
          return unsubscribe
        },
        // ShapeStream.requestSnapshot is legal only in changes_only mode.
        // The installed-SDK delivery oracle is the receiving witness.
        requestSnapshot: vi.fn(() => {
          if (options.log !== `changes_only`) {
            return Promise.reject(
              new Error(`Snapshot requests are not supported in full mode`),
            )
          }
          snapshotRequests++
          for (const observe of requestObservers.splice(0)) observe()
          if (harness?.holdSnapshots) {
            return new Promise<void>((resolve, reject) => {
              pendingSnapshots.push({ resolve, reject })
            })
          }
          return Promise.resolve()
        }),
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

async function runTagHistory(
  history: {
    syncMode: `eager` | `on-demand` | `progressive`
    tagged: boolean
    legacyResume: boolean
    interruptRecovery: boolean
    edits: Array<{ id: number; renameOnly: boolean; tag: string }>
    removals: Array<string>
  },
  selectedRestart?: { cold: boolean; fresh: boolean },
) {
  for (const cold of [false, true]) {
    for (const fresh of [true, false]) {
      if (
        selectedRestart &&
        (cold !== selectedRestart.cold || fresh !== selectedRestart.fresh)
      )
        continue
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
      // The model's row map is the authoritative provider state. This
      // unmanaged fixture takes a complete replacement on recovery, so its
      // durable map must agree once that replacement commits.
      const check = async () => {
        await vi.waitFor(
          () =>
            expect(publicRows(), `cold=${cold}, fresh=${fresh}`).toEqual(
              expectedRows(),
            ),
          { interval: 1 },
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
        const rebuild =
          fresh || (cold && (history.tagged || history.legacyResume))
        const waitsForReplacement = history.syncMode === `on-demand` && rebuild
        const acquire = () => {
          let outcome: `pending` | `fulfilled` | `rejected` = `pending`
          const completion = Promise.resolve(current._sync.loadSubset({})).then(
            () => {
              outcome = `fulfilled`
              return { kind: `fulfilled` }
            },
            (error: unknown) => {
              outcome = `rejected`
              return { kind: `rejected`, error: String(error) }
            },
          )
          return { completion, outcome: () => outcome }
        }
        // An incompatible on-demand demand waits for the complete source
        // replacement, even though old cache rows remain visible meanwhile.
        let acquisition = history.syncMode === `eager` ? undefined : acquire()
        if (acquisition && !waitsForReplacement) {
          expect(
            await atCheckpoint(acquisition.completion, `resumed subset`),
          ).toEqual({ kind: `fulfilled` })
        }
        await vi.waitFor(() => expect(publicRows()).toEqual(expectedRows()), {
          interval: 1,
        })
        if (waitsForReplacement)
          expect(acquisition?.outcome(), `before recovery snapshot`).toBe(
            `pending`,
          )
        let resumedStream = streams[start + 1]!
        expect(vi.mocked(ShapeStream).mock.calls[start + 1]?.[0]).toMatchObject(
          {
            offset: rebuild ? undefined : `20_0`,
          },
        )
        if (rebuild) {
          const cachedRows = structuredClone(expectedRows())
          const visibleBefore = cachedRows
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
          expect(publicRows()).toEqual(visibleBefore)
          // A concurrent subset request finishing is not completion of the
          // full replacement snapshot used to recover cold membership.
          if (
            !waitsForReplacement &&
            !fresh &&
            cold &&
            (history.tagged || history.legacyResume)
          ) {
            resumedStream.send([{ headers: { control: `subset-end` } }])
            record(`after subset completion`)
            expect(publicRows()).toEqual(cachedRows)
          }
          expectWholeTagRecovery(exposures, [visibleBefore])
          if (waitsForReplacement)
            expect(acquisition?.outcome(), `partial replacement`).toBe(
              `pending`,
            )
          if (history.interruptRecovery) {
            const abandoned = resumedStream
            stopRecoveryObservation()
            await current.cleanup()
            if (acquisition)
              await atCheckpoint(
                acquisition.completion,
                `abandoned acquisition settles`,
              )
            current.startSyncImmediate()
            await vi.waitFor(() => expect(streams).toHaveLength(start + 3), {
              interval: 1,
            })
            acquisition = history.syncMode === `eager` ? undefined : acquire()
            if (acquisition && history.syncMode !== `on-demand`) {
              expect(
                await atCheckpoint(
                  acquisition.completion,
                  `progressive recovery subset`,
                ),
              ).toEqual({ kind: `fulfilled` })
            }
            await vi.waitFor(
              () => expect(publicRows()).toEqual(visibleBefore),
              { interval: 1 },
            )
            expect(
              vi.mocked(ShapeStream).mock.calls[start + 2]?.[0],
            ).toMatchObject({
              offset: undefined,
            })
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
            expectWholeTagRecovery(exposures, [visibleBefore])
            resumedStream = streams[start + 2]!
            resumedStream.send(snapshot())
            record(`after restarted partial replacement`)
            expectWholeTagRecovery(exposures, [visibleBefore])
          }
          resumedStream.send([upToDate])
          record(`after replacement commit`)
          await check()
          if (acquisition) {
            expect(
              await atCheckpoint(
                acquisition.completion,
                `recovery subset applied`,
              ),
            ).toEqual({ kind: `fulfilled` })
            // A later acquisition still uses the current stream capability.
            resumedStream.holdSnapshots = false
            await current._sync.loadSubset({ limit: 1 })
          }
          record(`replacement settled`)
          expectWholeTagRecovery(exposures, [
            visibleBefore,
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

// Bounded neighbors isolate membership loss from reset debt. The ordinary
// untagged resume is the distinguishing control for changes_only capability.
fixedCase.each([
  { tagged: true, legacyResume: false, cold: true, fresh: false },
  { tagged: false, legacyResume: false, cold: true, fresh: false },
  { tagged: false, legacyResume: true, cold: true, fresh: false },
  { tagged: false, legacyResume: false, cold: false, fresh: true },
])(
  `settles restart demand with tagged=$tagged legacy=$legacyResume cold=$cold reset=$fresh`,
  async ({ cold, fresh, ...history }) => {
    await runTagHistory(
      {
        ...history,
        syncMode: `on-demand`,
        interruptRecovery: false,
        edits: [],
        removals: [`left`, `right`, `other`],
      },
      { cold, fresh },
    )
  },
)

// The two campaigns use the same grammar, checker, and budget. An explicit
// replay registers only its selected property. Reproduce a saved failure with:
// TANSTACK_DB_ORACLE_PROPERTY=electric.persisted-tag-history
// TANSTACK_DB_ORACLE_SEED=<seed> TANSTACK_DB_ORACLE_PATH=<path>
// pnpm exec vitest run tests/electric-descriptor-isolation-oracle.test.ts
if (replayPath === undefined) {
  fcTest.prop([tagHistory], { seed: 42712, numRuns: oracleRuns(10) })(
    `persisted tag histories preserve membership across warm and cold restart (fixed)`,
    (history) => runTagHistory(history),
  )
  fcTest.prop(
    [tagHistory],
    oraclePropertyOptions(10, `electric.persisted-tag-history`),
  )(
    `persisted tag histories preserve membership across warm and cold restart (random)`,
    (history) => runTagHistory(history),
  )
} else if (replayProperty === `electric.persisted-tag-history`) {
  fcTest.prop(
    [tagHistory],
    oraclePropertyOptions(10, `electric.persisted-tag-history`),
  )(
    `persisted tag histories preserve membership across warm and cold restart (replay)`,
    (history) => runTagHistory(history),
  )
}

beforeEach(() => {
  streams.length = 0
  holdNewSnapshots = false
  onStreamSubscribed = undefined
  vi.clearAllMocks()
})

// A released acquisition does not cancel the installed SDK's physical
// request. The model rotates the durable cache while that request is held,
// then delivers its old row after a fresh subset has completed. Public and
// durable rows must contain only fresh source evidence. The same demand must
// finish through the replacement provider session without waiting for the old
// request. Pending match waits and both kinds of txid evidence belong to the
// retired provider session, not the replacement. A mutation handler waiting
// on old evidence must reject so an accepted cache clear can advance. This
// driver crosses Electric, the persisted wrapper, and the controlled SDK
// callback boundary.
fixedCase(
  `restarts a provider session before an old subset can publish into a new cache`,
  async () => {
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
          Array.from(durable.get(id) ?? [], ([key, value]) => ({ key, value })),
        ),
      loadResumeSnapshot: (id) =>
        Promise.resolve({
          rows: Array.from(durable.get(id) ?? [], ([key, value]) => ({
            key,
            value,
          })),
          keySet: {
            status: id === `cache-old` ? `consistent` : `incompatible`,
          },
          collectionMetadata: [],
          latestTerm: 0,
          latestSeq: 0,
          latestRowVersion: 0,
          resetEpoch: 0,
        }),
      applyCommittedTx: (id, tx) => {
        expect(id).toBe(claimedStorageId)
        const rows = durable.get(id)!
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

      holdNewSnapshots = true
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
      const replacementWait = collection.utils
        .awaitTxId(778, 1_000)
        .then(() => {
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
      await atCheckpoint(
        replacementSnapshotWait,
        `replacement snapshot evidence`,
      )
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
  },
)

// An acquisition's abort is independent of provider-session replacement. The
// model retires an old stream, holds cache rotation, and releases one demand
// while a second demand still needs the fresh source snapshot. At the held
// rotation checkpoint the released demand owes AbortError, while its sibling
// remains pending; after rotation, that sibling owes an applied fresh row.
fixedCase(`aborts one demand while its provider session restarts`, async () => {
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

    holdNewSnapshots = true
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

// Cleanup can arrive after the old provider session has retired but before
// SQLite finishes rotating its cache. The Collection owns that cleanup, so
// rotation's lifecycle cancellation must not turn successful resource teardown
// into a cleanup error. No replacement stream may start after cleanup begins.
fixedCase(`cleans up during a held provider-session restart`, async () => {
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

// A failed cache rotation cannot leave a retired Electric provider session
// accepting demands. The hook contract permits cacheRotated to reject. The
// independent outcome rule is that the next demand rejects that failure and
// cleanup remains possible; a microtask-scheduled cleanup bounds the test even
// when a wrong implementation repeatedly revisits the retired session.
fixedCase(`rejects a demand after provider-session restart fails`, async () => {
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

// Two valid cache rotations may overlap in the persisted wrapper. The second
// hook call owns a distinct cacheRotated gate: its replacement provider session
// cannot start and its hook cannot settle merely because the first gate did.
// Holding each gate separately distinguishes that rule from returning the
// first restart promise for both calls.
fixedCase(
  `waits for every overlapping cache rotation before restarting Electric`,
  async () => {
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
  },
)

// A second rotation can begin just after the first replacement subscribed but
// before its restart promise cleared. The newly subscribed stream is now the
// old provider session: retirement must unsubscribe it synchronously. A mock
// callback deliberately arrives after unsubscribe while the second cache gate
// is held; no row may enter the Collection write boundary from that session.
fixedCase(
  `retires a replacement Electric stream before a second cache rotation`,
  async () => {
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
    onStreamSubscribed = () => {
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
      onStreamSubscribed = undefined
      releaseFirst()
      releaseSecond()
      await Promise.allSettled([first, second])
      await run.cleanup?.()
    }
  },
)

// Imported acknowledgement evidence belongs to the old persisted cache.
// Initial scoped recovery clears that cache before any new source message,
// so a txid wait must remain pending until the new provider session supplies
// its own evidence. The independent checkpoint observes settlement timing.
fixedCase(
  `forgets imported txid evidence during initial scoped recovery`,
  async () => {
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
  },
)

// A provider session can end with a source transaction open between batches.
// That transaction has no source commit point, so it supplies no public row or
// acquisition readiness. Retiring the session must abandon its commit turn;
// otherwise a demand in the replacement session waits on impossible work.
fixedCase(
  `starts a new subset after retiring an incomplete old stream transaction`,
  async () => {
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
          Array.from(durable.get(id) ?? [], ([key, value]) => ({
            key,
            value,
          })),
        ),
      loadResumeSnapshot: (id) =>
        Promise.resolve({
          rows: Array.from(durable.get(id) ?? [], ([key, value]) => ({
            key,
            value,
          })),
          keySet: {
            status: id === `cache-old` ? `consistent` : `incompatible`,
          },
          collectionMetadata: [],
          latestTerm: 0,
          latestSeq: 0,
          latestRowVersion: 0,
          resetEpoch: 0,
        }),
      applyCommittedTx: (id, tx) => {
        const rows = durable.get(id)!
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
      holdNewSnapshots = true
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
      await atCheckpoint(
        demand,
        `fresh subset after incomplete old transaction`,
      )
      expect(collection.get(2)).toBeUndefined()
    } finally {
      await atCheckpoint(collection.cleanup(), `open transaction cleanup`)
      await demand?.catch(() => undefined)
    }
  },
)

fixedCase.each([`eager`, `on-demand`, `progressive`] as const)(
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

fixedCase(
  `rejects torn or reverted tag-recovery histories even when their last snapshot is correct`,
  () => {
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
  },
)

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

if (replayPath === undefined) {
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
} else if (replayProperty === `electric.bound-descriptor-history`) {
  fcTest.prop(
    [ownerHistory],
    oraclePropertyOptions(20, `electric.bound-descriptor-history`),
  )(
    `config derivation preserves independent owner histories (replay)`,
    runOwnerHistory,
  )
}

fixedCase(
  `keeps insert acknowledgements on the owner of a reused persisted descriptor`,
  async () => {
    const adapter: PersistenceAdapter = {
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
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
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

fixedCase(
  `rejects a descriptor move-out checkpoint that deletes rows by fail-stopping`,
  () => {
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
  },
)

fixedCase.each([`resume`, `fresh`] as const)(
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

fixedDescribe.each([`original`, `once-spread`] as const)(
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
