/**
 * One held whole-row intent crossed with independently accepted peer work.
 *
 * Authority: optimistic-history-oracle.ts. An active intent overlays whole
 * authored rows. Ordinary source batches queue until settlement; replacement
 * drains the source queue but preserves that overlay. Failure removes intent;
 * success persists and confirms it before settlement. A queued confirmation
 * can receive local origin at settlement even after an earlier replacement
 * touched that key. Native storage follows authored order.
 *
 * The reference is two row arrays (durable and exposed base), a source queue,
 * one authored Change and row origins. It deliberately combines the rows of one
 * atomic Collection mutation into one intent. It does not model simultaneous
 * same-key writers, multiple local intents or cleanup's pending-caller policy.
 * The driver uses independent descriptors, deferred application handlers, public
 * base/metadata, raw IDB observations and a simple downstream live query.
 * Checkpoints: handler entry, every peer read/publication, settlement, ordinary
 * suffix and restore. Fixed CRUD × remote action × decision cases reconstruct
 * every boundary. Fixed/fresh histories use the same generator and checker.
 */
import { fc } from '@fast-check/vitest'
import { beforeEach, expect } from 'vitest'
import { createLiveQueryCollection } from '../../src'
import { oracleProperty, oracleReplayRequested } from '../oracle-config'
import { nativeCampaignReceipt } from '../native-campaign-receipt'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter'
import {
  Channel,
  deferred,
  readStore,
  seed as seedStore,
  withHarness,
} from './harness'
import {
  apply,
  assertPublicationHistory,
  assertSnapshot,
  assertStatuses,
  equal,
  snapshot,
} from './cross-tab-oracle'
import { recordCollection } from './recorder'
import { campaignFailure, createCampaignRecorder } from './campaign'
import type { Change, OracleRow } from './cross-tab-oracle'
import type { Operation } from './harness'

// Campaigns. The fixed campaign and the fresh campaign run the same generator
// and checker. A path replay of `indexeddb.pending-history` runs its recorded
// history once, and every other test in this file stands aside. A seed alone
// reseeds the fresh campaign.
const FIXED_SEED = 11792027
const PENDING_HISTORY = `indexeddb.pending-history`

type PeerStep = {
  kind: 'write' | 'delete' | 'clear' | 'import'
  overlap: boolean
  value: number
}
type History = {
  local: Operation
  accept: boolean
  count: number
  peer: Array<PeerStep>
}
const peerStep = fc.record({
  kind: fc.constantFrom(
    'write' as const,
    'write' as const,
    'delete' as const,
    'clear' as const,
    'import' as const,
  ),
  overlap: fc.boolean(),
  value: fc.integer({ min: -2, max: 2 }),
})
const histories = fc.record({
  local: fc.constantFrom(
    'insert' as const,
    'update' as const,
    'delete' as const,
  ),
  accept: fc.boolean(),
  count: fc.integer({ min: 1, max: 3 }),
  peer: fc.array(peerStep, { maxLength: 4 }),
})

async function run(
  history: History,
  reach = new Set<string>(),
  corruptSettlement?: 'origin' | 'rows',
) {
  await withHarness(async (h) => {
    const localRows = Array.from({ length: history.count }, (_, id) => ({
      id,
      name: 'local authored',
      optional: 7,
    }))
    const initial = [
      ...(history.local === 'insert'
        ? []
        : localRows.map((row) => ({ ...row, name: 'initial' }))),
      { id: 'anchor', name: 'anchor', optional: 9 },
    ]
    const intent: Change = {
      rows: history.local === 'delete' ? [] : localRows,
      deletes: history.local === 'delete' ? localRows.map((row) => row.id) : [],
      replace: false,
    }
    const keys = new Set(localRows.map((row) => row.id as string | number))
    let durable: Array<OracleRow> = snapshot(initial)
    let base = snapshot(initial)
    let queue: Array<Change> = []
    const origins = new Map<string | number, 'local' | 'remote'>(
      initial.map((row) => [row.id, 'remote']),
    )
    function drain(active: boolean, accepted = false) {
      // Core's settlement-drop contract attributes the queued confirmation at
      // this boundary. Earlier replacements do not spend a lifetime allowance.
      const localOrigins = new Set(active || accepted ? keys : [])
      for (const change of queue) {
        base = apply(base, change)
        if (change.replace) origins.clear()
        for (const row of change.rows) {
          origins.set(row.id, localOrigins.has(row.id) ? 'local' : 'remote')
          localOrigins.delete(row.id)
        }
        for (const key of change.deletes) {
          origins.delete(key)
          localOrigins.delete(key)
        }
      }
      queue = []
    }
    await seedStore(h.db, 'items', initial)
    const gate = deferred(),
      entered = deferred()
    h.disposers.push(() => gate.resolve())
    let calls = 0
    let payload: Array<OracleRow> = []
    const handler = async ({
      transaction,
    }: {
      transaction: { mutations: Array<{ modified: OracleRow }> }
    }) => {
      if (calls++ > 0) return
      payload = snapshot(
        transaction.mutations.map((mutation) => mutation.modified),
      )
      entered.resolve()
      await gate.promise
    }
    const subject = await h.open('items', {
      id: 'local',
      db: await h.connect(),
      onInsert: handler,
      onUpdate: handler,
      onDelete: handler,
    })
    const peer = await h.open('items', { id: 'peer', db: await h.connect() })
    const record = recordCollection(subject, 'local')
    h.disposers.push(record.stop)
    const query = createLiveQueryCollection({
      query: (q) =>
        q.from({ row: subject }).select(({ row }) => ({
          id: row.id,
          name: row.name,
          optional: row.optional,
        })),
    })
    h.disposers.push(() => query.cleanup())
    await query.preload()
    const queryRecord = recordCollection(query, 'downstream')
    h.disposers.push(queryRecord.stop)
    let visible = snapshot(initial)
    let offset = 0,
      queryOffset = 0
    function observe() {
      const rows = [...subject.values()]
      return {
        rows: snapshot(rows),
        base: snapshot(subject.base.values()),
        metadata: new Map(
          rows.map((row) => [
            row.id,
            {
              pending: row.$hasPendingWrites,
              origin: row.$origin,
            },
          ]),
        ),
      }
    }
    function check(
      next: Array<OracleRow>,
      label: string,
      active: boolean,
      observation = observe(),
    ) {
      // Each declared cut admits one whole snapshot change. Metadata-only
      // publications may repeat it; no partial batch is an admissible state.
      const effect = { rows: next, deletes: [], replace: true }
      assertPublicationHistory(
        visible,
        record.publications.slice(offset),
        [effect],
        label,
      )
      assertPublicationHistory(
        visible,
        queryRecord.publications.slice(queryOffset),
        [effect],
        `${label} downstream`,
      )
      assertSnapshot(observation.rows, next, label)
      assertSnapshot(query.values(), next, `${label} downstream`)
      assertSnapshot(observation.base, base, `${label} exposed base`)
      assertStatuses(record.statuses, ['ready'], label)
      for (const row of next) {
        const pending = active && keys.has(row.id)
        const metadata = observation.metadata.get(row.id)!
        expect(metadata, `${label} metadata ${row.id}`).toEqual({
          pending,
          origin: pending ? 'local' : origins.get(row.id),
        })
      }
      visible = snapshot(next)
      offset = record.publications.length
      queryOffset = queryRecord.publications.length
    }
    const tx =
      history.local === 'insert'
        ? subject.insert(structuredClone(localRows))
        : history.local === 'update'
          ? subject.update(
              localRows.map((row) => row.id),
              (drafts) => {
                for (const row of drafts) row.name = 'local authored'
              },
            )
          : subject.delete(localRows.map((row) => row.id))
    let settled = false
    let settlementObservation: ReturnType<typeof observe> | undefined
    function captureSettlement() {
      settled = true
      settlementObservation = observe()
      if (corruptSettlement === 'rows') settlementObservation.rows = []
      if (corruptSettlement === 'origin')
        for (const key of keys) {
          const metadata = settlementObservation.metadata.get(key)
          if (metadata) metadata.origin = 'remote'
        }
    }
    const outcome = tx.when(`settled`).then(
      () => {
        captureSettlement()
        return undefined
      },
      (error: unknown) => {
        captureSettlement()
        return error
      },
    )
    await entered.promise
    reach.add('held handler')
    expect(payload).toEqual(
      snapshot(
        history.local === 'delete'
          ? initial.filter((row) => keys.has(row.id))
          : localRows,
      ),
    )
    check(apply(base, intent), 'handler entry', true)
    expect(Channel.sent).toHaveLength(0)
    const versions = await readStore(h.db, '_versions')
    assertSnapshot(
      (await readStore<OracleRow>(h.db, 'items')).rows,
      durable,
      'held durable',
    )
    expect(await readStore(h.db, '_versions')).toEqual(versions)
    for (const [index, step] of history.peer.entries()) {
      const id = step.overlap ? 0 : `peer-${index}`
      let change: Change
      if (step.kind === 'clear')
        change = { rows: [], deletes: [], replace: true }
      else if (step.kind === 'import')
        change = {
          rows: [{ id, name: `peer-${step.value}` }],
          deletes: [],
          replace: true,
        }
      else if (step.kind === 'delete')
        change = {
          rows: [],
          deletes: [
            durable.find((row) => row.id === id)?.id ??
              durable[0]?.id ??
              'missing',
          ],
          replace: false,
        }
      else
        change = {
          rows: [{ id, name: `peer-${step.value}` }],
          deletes: [],
          replace: false,
        }
      if (step.kind === 'clear') await peer.utils.clearObjectStore()
      else if (step.kind === 'import')
        await peer.utils.importData(structuredClone(change.rows))
      else if (step.kind === 'delete') {
        if (!durable.some((row) => row.id === change.deletes[0])) continue
        await peer.delete(change.deletes[0]!).when(`settled`)
      } else if (durable.some((row) => row.id === id))
        await peer
          .update(id, (row) => {
            row.name = `peer-${step.value}`
            delete row.optional
          })
          .when(`settled`)
      else await peer.insert(structuredClone(change.rows[0]!)).when(`settled`)
      // Collection updates that leave every authored value unchanged author no
      // mutation, so they provide no source acknowledgement or notification.
      if (
        !change.replace &&
        !change.deletes.length &&
        equal(
          durable.find((row) => row.id === id),
          change.rows[0],
        )
      ) {
        check(apply(base, intent), `peer ${index} no-op`, true)
        continue
      }
      reach.add(
        step.kind === 'write'
          ? durable.some((row) => row.id === id)
            ? 'peer update'
            : 'peer insert'
          : `peer ${step.kind}`,
      )
      durable = apply(durable, change)
      queue.push(change)
      if (change.replace) drain(true)
      await Channel.drain()
      reach.add('peer progress')
      expect(settled, 'peer progresses while local handler remains held').toBe(
        false,
      )
      assertSnapshot(peer.values(), durable, 'peer accepted while handler held')
      assertSnapshot(
        (await readStore<OracleRow>(h.db, 'items')).rows,
        durable,
        'peer durable while handler held',
      )
      check(apply(base, intent), `peer ${index}`, true)
    }
    const failure = new Error('authored rejection')
    if (history.accept) gate.resolve()
    else gate.reject(failure)
    expect(await outcome).toBe(history.accept ? undefined : failure)
    if (history.accept) {
      durable = apply(durable, intent)
      queue.push(intent)
    }
    drain(false, history.accept)
    // Observe inside the caller's continuation. Later peer work cannot repair
    // a wrong snapshot before the settlement comparison.
    expect(settlementObservation).toBeDefined()
    check(base, 'settlement', false, settlementObservation)
    await Channel.drain()
    assertSnapshot(peer.values(), durable, 'settled peer')
    assertSnapshot(
      (await readStore<OracleRow>(h.db, 'items')).rows,
      durable,
      'settled durable',
    )
    const suffix = { id: 'suffix', name: 'ordinary suffix' }
    await subject.insert(suffix).when(`settled`)
    await Channel.drain()
    durable = apply(durable, { rows: [suffix], deletes: [], replace: false })
    assertSnapshot(peer.values(), durable, 'suffix peer')
    assertSnapshot(
      (await h.open('items', { db: await h.connect() })).values(),
      durable,
      'suffix restore',
    )
  })
}

async function reconstructEveryBoundary() {
  const reach = new Set<string>()
  for (const local of ['insert', 'update', 'delete'] as const)
    for (const kind of ['write', 'delete', 'clear', 'import'] as const)
      for (const accept of [false, true])
        await run(
          {
            local,
            accept,
            count: 3,
            peer: [{ kind, overlap: true, value: 1 }],
          },
          reach,
        )
  for (const operation of ['insert', 'update', 'delete', 'clear', 'import'])
    expect(reach.has(`peer ${operation}`), operation).toBe(true)
}

oracleProperty({
  id: `indexeddb.pending-history-reconstruction`,
  law: {
    statement: `One held whole-row intent crossed with independently accepted peer work refines the pending-history reference at handler entry, every peer read and publication, settlement, the ordinary suffix and restore.`,
    authority: `optimistic-history-oracle.ts and the pending-history reference stated above`,
    limits: `Fixed held multi-row CRUD crossed with every peer action and both decisions; every peer operation must be reached.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: [
    'reconstructs held multi-row CRUD crossed with every peer action and decision',
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.pending-history-reconstruction`,
      plan,
      observe,
      () => reconstructEveryBoundary(),
    ),
  check: forwardAssertionJudgment,
  timeout: 60_000,
})

// A replacement before the queued confirmation must not take its origin.
const replacedConfirmation: History = {
  local: 'insert',
  accept: true,
  count: 1,
  peer: [{ kind: 'import', overlap: true, value: 0 }],
}
const pendingFixedHistories: Array<{ name: string; history: History }> = [
  {
    name: 'attributes the queued confirmation after an earlier replacement',
    history: replacedConfirmation,
  },
  {
    name: 'a peer no-op cannot spend another source acknowledgement',
    history: {
      local: 'insert',
      accept: false,
      count: 1,
      peer: [
        { kind: 'import', overlap: true, value: 1 },
        { kind: 'write', overlap: true, value: 1 },
      ],
    },
  },
]
// Same production path, deliberately wrong observation at settlement. The old
// lifetime-acknowledgement model accepted the remote origin; the rows fault
// keeps final production rows correct while the captured promise cut is wrong,
// so sampling after peer delivery must not erase it.
const settlementFaults = [
  { fault: 'origin', message: 'settlement metadata 0' },
  { fault: 'rows', message: 'public rows at settlement' },
] as const

oracleProperty({
  id: `indexeddb.pending-history-fixed`,
  law: {
    statement: `One held whole-row intent crossed with independently accepted peer work refines the pending-history reference at handler entry, every peer read and publication, settlement, the ordinary suffix and restore.`,
    authority: `optimistic-history-oracle.ts and the pending-history reference stated above`,
    limits: `Named fixed histories replayed through the same driver and checks; the settlement calibrations corrupt the observation at the settlement cut.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: pendingFixedHistories,
  label: ({ name }) => name,
  resolve: ({ history }) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.pending-history-fixed`,
      plan,
      observe,
      () => run(plan.history),
    ),
  check: forwardAssertionJudgment,
  calibrations: settlementFaults.map(({ fault, message }) => ({
    name: `attributes the queued confirmation after an earlier replacement: rejects a wrong ${fault} observation at settlement`,
    law: `indexeddb.pending-history-fixed`,
    driver: (
      plan: { history: History },
      observe: (checkpoint: string, value: unknown) => void,
    ) =>
      recordAssertionJudgment(
        `indexeddb.pending-history-fixed`,
        plan,
        observe,
        async () => {
          try {
            await run(replacedConfirmation, new Set(), fault)
          } catch (error) {
            // Exactly the old matcher: an error whose message names this cut.
            if (error instanceof Error && error.message.includes(message))
              rejectAt(`calibration ${fault}`, error)
            throw new Error(
              `settlement ${fault} calibration: the check rejected with an error the old matcher did not accept: ${String(error)}`,
            )
          }
        },
      ),
  })),
})

const runs =
  process.env.TANSTACK_INDEXEDDB_ORACLE_PROFILE === 'stress' ? 300 : 30
// A recorder belongs to one native test. Its unchanged shrink predicate keeps
// the original law, checkpoint and every premise the first failure reached;
// its completion receipt writes the campaign report and checks the budget.
let recorder: ReturnType<typeof createCampaignRecorder<History>>
let replayCalls = 0
beforeEach(() => {
  replayCalls = 0
  recorder = createCampaignRecorder('pending', histories, (history, receipt) =>
    run(history, receipt.reach),
  )
})
nativeCampaignReceipt<History>((result) =>
  recorder.complete(result, {
    runs: result.runConfiguration.numRuns ?? runs,
    ...(oracleReplayRequested() ? { path: result.runConfiguration.path } : {}),
  }),
)
oracleProperty({
  id: PENDING_HISTORY,
  timeout: 120_000,
  law: {
    statement: `One held whole-row intent crossed with independently accepted peer work refines the pending-history reference at handler entry, every peer read and publication, settlement, the ordinary suffix and restore.`,
    authority: `optimistic-history-oracle.ts and the pending-history reference stated above`,
    limits: `The bounded peer-history grammar of one held local intent over fake IndexedDB and a controlled Channel; no simultaneous same-key writers, multiple local intents or cleanup's pending-caller policy.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: { arbitrary: histories, runs, fixedSeeds: [FIXED_SEED] },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(PENDING_HISTORY, plan, observe, async () => {
      if (oracleReplayRequested() && replayCalls++ > 0) return
      try {
        await recorder.run(plan.history)
      } catch (error) {
        // The recorder rethrows only the same failed law/checkpoint with the
        // first history's full premise set; preserve every other attempt in its report.
        rejectAt(
          campaignFailure(error).checkpoint,
          error instanceof Error
            ? error
            : new Error(String(error), { cause: error }),
        )
      }
    }),
  check: forwardAssertionJudgment,
})
