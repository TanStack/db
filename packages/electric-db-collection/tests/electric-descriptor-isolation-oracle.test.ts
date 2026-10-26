import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { atCheckpoint } from './electric-oracle-lifecycle'
import {
  expectWholeTagRecovery,
  insert,
  moveOut,
  resetElectricDescriptorHarness,
  streams,
  upToDate,
} from './electric-descriptor-harness'
import { descriptor } from './electric-descriptor-fixture'
import { tagPersistence } from './electric-persistence-fixture'
import type { TagExposure } from './electric-descriptor-harness'
import type { TestRow } from './electric-persistence-fixture'
import type { Message } from '@electric-sql/client'
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

// Ordinary tests stand aside during any path replay, which runs one property.
vi.mock(`@electric-sql/client`, async () =>
  (await import(`./electric-descriptor-harness`)).createMockedElectricClient(),
)

const fixedCase = oracleReplayTest(it)

// The durable fixture is a driver, not the independent tag model. It must
// preserve the SQLite adapter's mutation algebra: an insert replaces the old
// value, while metadataChanged clears metadata even when the new value is
// undefined. Otherwise the tag oracle could falsely accept stale columns or
// stale membership after a fresh source snapshot.

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

// The two campaigns use the same grammar, checker, and budget. A path replay
// of the property runs only the random campaign. Reproduce a saved failure with:
// TANSTACK_DB_ORACLE_PROPERTY=electric.persisted-tag-history
// TANSTACK_DB_ORACLE_SEED=<seed> TANSTACK_DB_ORACLE_PATH=<path>
// pnpm exec vitest run tests/electric-descriptor-isolation-oracle.test.ts
oracleReplayTest(fcTest).prop([tagHistory], {
  seed: 42712,
  numRuns: oracleRuns(10),
})(
  `persisted tag histories preserve membership across warm and cold restart (fixed)`,
  (history) => runTagHistory(history),
)
oracleReplayTest(fcTest, `electric.persisted-tag-history`).prop(
  [tagHistory],
  oraclePropertyOptions(10, `electric.persisted-tag-history`),
)(
  `persisted tag histories preserve membership across warm and cold restart (random)`,
  (history) => runTagHistory(history),
)

beforeEach(() => {
  resetElectricDescriptorHarness()
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

// An acquisition's abort is independent of provider-session replacement. The
// model retires an old stream, holds cache rotation, and releases one demand
// while a second demand still needs the fresh source snapshot. At the held
// rotation checkpoint the released demand owes AbortError, while its sibling
// remains pending; after rotation, that sibling owes an applied fresh row.

// Cleanup can arrive after the old provider session has retired but before
// SQLite finishes rotating its cache. The Collection owns that cleanup, so
// rotation's lifecycle cancellation must not turn successful resource teardown
// into a cleanup error. No replacement stream may start after cleanup begins.

// A failed cache rotation cannot leave a retired Electric provider session
// accepting demands. The hook contract permits cacheRotated to reject. The
// independent outcome rule is that the next demand rejects that failure and
// cleanup remains possible; a microtask-scheduled cleanup bounds the test even
// when a wrong implementation repeatedly revisits the retired session.

// A cache rotation retires the provider session and starts a replacement on
// the same core sync run. If the retired session's first up-to-date was
// committed but its persistence step has not accepted it, that acceptance
// belongs to a cache generation the rotation discarded. The independent rule:
// a retired session's acceptance settles nothing, whether it resolves or
// rejects, and the replacement session's first up-to-date decides readiness.
// The driver observes the Collection's readiness boundary (markReady and
// markError) after the retired acceptance settles and after the replacement
// delivers its snapshot.

// Two valid cache rotations may overlap in the persisted wrapper. The second
// hook call owns a distinct cacheRotated gate: its replacement provider session
// cannot start and its hook cannot settle merely because the first gate did.
// Holding each gate separately distinguishes that rule from returning the
// first restart promise for both calls.

// A second rotation can begin just after the first replacement subscribed but
// before its restart promise cleared. The newly subscribed stream is now the
// old provider session: retirement must unsubscribe it synchronously. A mock
// callback deliberately arrives after unsubscribe while the second cache gate
// is held; no row may enter the Collection write boundary from that session.

// Imported acknowledgement evidence belongs to the old persisted cache.
// Initial scoped recovery clears that cache before any new source message,
// so a txid wait must remain pending until the new provider session supplies
// its own evidence. The independent checkpoint observes settlement timing.

// A provider session can end with a source transaction open between batches.
// That transaction has no source commit point, so it supplies no public row or
// acquisition readiness. Retiring the session must abandon its commit turn;
// otherwise a demand in the replacement session waits on impossible work.

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

oracleReplayTest(fcTest).prop([ownerHistory], {
  seed: 42711,
  numRuns: oracleRuns(12),
})(
  `config derivation preserves independent owner histories (fixed)`,
  runOwnerHistory,
)
oracleReplayTest(fcTest, `electric.bound-descriptor-history`).prop(
  [ownerHistory],
  oraclePropertyOptions(20, `electric.bound-descriptor-history`),
)(
  `config derivation preserves independent owner histories (random)`,
  runOwnerHistory,
)

// The Electric descriptor may be reused across independent persisted wrappers.
// The wrappers may address the same or different durable Collection IDs; that
// storage identity does not transfer an insert acknowledgement to a peer.
// Reusing one wrapper itself is rejected before a second owner starts. The
// public checkpoints are admission, the first receipt, and each Collection's
// rows after only the first provider session acknowledges its transaction.

declareOracle({ check: [runTagHistory, runOwnerHistory] })
