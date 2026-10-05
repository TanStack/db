/**
 * One held whole-row intent crossed with independently accepted peer work.
 *
 * Authority: optimistic-history-oracle.ts. An active intent overlays whole
 * authored rows. Ordinary source batches queue until settlement; replacement
 * drains the source queue but preserves that overlay. Failure removes intent;
 * success persists and acknowledges it. Native storage follows authored order.
 *
 * The reference is two row arrays (durable and exposed base), a source queue,
 * one authored Change and row origins. It deliberately combines the rows of one
 * atomic Collection mutation into one intent. It does not model simultaneous
 * same-key writers, multiple local intents or cleanup's pending-caller policy.
 * The driver uses independent descriptors, deferred application handlers, public
 * base/metadata, raw IDB observations and a simple downstream live query.
 * Checkpoints: handler entry, every peer read/publication, settlement, ordinary
 * suffix and restore. Pinned CRUD × remote action × decision cases reconstruct
 * every boundary. Fixed/fresh histories use the same generator and checker.
 */
import { createLiveQueryCollection } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
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
import { runCampaign } from './campaign'
import type { Change, OracleRow } from './cross-tab-oracle'
import type { Operation } from './harness'

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

async function run(history: History, reach = new Set<string>()) {
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
    const acknowledged = new Set<string | number>()
    function drain(active: boolean, accepted = false) {
      const localOrigins = new Set(
        [...keys].filter(
          (key) =>
            active ||
            (accepted &&
              !(history.local === 'insert' && acknowledged.has(key))),
        ),
      )
      for (const change of queue) {
        base = apply(base, change)
        if (change.replace) origins.clear()
        for (const row of change.rows) {
          origins.set(row.id, localOrigins.has(row.id) ? 'local' : 'remote')
          localOrigins.delete(row.id)
          if (active && history.local === 'insert' && keys.has(row.id))
            acknowledged.add(row.id)
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
    function check(next: Array<OracleRow>, label: string, active: boolean) {
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
      assertSnapshot(subject.values(), next, label)
      assertSnapshot(query.values(), next, `${label} downstream`)
      assertSnapshot(subject.base.values(), base, `${label} exposed base`)
      assertStatuses(record.statuses, ['ready'], label)
      for (const row of next) {
        const actual = subject.get(row.id)!
        const pending = active && keys.has(row.id)
        expect(
          {
            pending: actual.$hasPendingWrites,
            synced: actual.$synced,
            origin: actual.$origin,
          },
          `${label} metadata ${row.id}`,
        ).toEqual({
          pending,
          synced: !pending,
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
    const outcome = tx.isPersisted.promise.then(
      () => {
        settled = true
        return undefined
      },
      (error: unknown) => {
        settled = true
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
        await peer.delete(change.deletes[0]!).isPersisted.promise
      } else if (durable.some((row) => row.id === id))
        await peer.update(id, (row) => {
          row.name = `peer-${step.value}`
          delete row.optional
        }).isPersisted.promise
      else
        await peer.insert(structuredClone(change.rows[0]!)).isPersisted.promise
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
    await Channel.drain()
    check(base, 'settlement', false)
    assertSnapshot(peer.values(), durable, 'settled peer')
    assertSnapshot(
      (await readStore<OracleRow>(h.db, 'items')).rows,
      durable,
      'settled durable',
    )
    const suffix = { id: 'suffix', name: 'ordinary suffix' }
    await subject.insert(suffix).isPersisted.promise
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

it('reconstructs held multi-row CRUD crossed with every peer action and decision', async () => {
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
}, 60_000)
it('a peer no-op cannot spend another source acknowledgement', async () => {
  await run({
    local: 'insert',
    accept: false,
    count: 1,
    peer: [
      { kind: 'import', overlap: true, value: 1 },
      { kind: 'write', overlap: true, value: 1 },
    ],
  })
})

const replaySeed = process.env.TANSTACK_INDEXEDDB_PENDING_SEED
const replayPath = process.env.TANSTACK_INDEXEDDB_PENDING_PATH
for (const seed of replaySeed ? [Number(replaySeed)] : [11792027, undefined])
  it(`refines held mutations through ${seed === undefined ? 'fresh' : 'fixed'} peer histories`, async () => {
    await runCampaign(
      'pending',
      histories,
      (history, receipt) => run(history, receipt.reach),
      {
        runs:
          process.env.TANSTACK_INDEXEDDB_ORACLE_PROFILE === 'stress' ? 300 : 30,
        seed,
        path: replayPath,
      },
    )
  }, 120_000)
