/**
 * Distinguishing receiving histories for the cross-tab contract. Each history
 * has independent authored before/after values and a real provider boundary.
 * The omission history uses delete/reinsert via public APIs, so a partial-row
 * mutant cannot hide behind draft undefined values or import truncation.
 * The status history observes caught receiver failure independently of promise
 * fulfillment. After the first ready, that failure is the Collection's
 * `error` with its rows kept, which the recorder adds to the status history. Cleanup histories keep old native reads alive after retirement.
 * Native scheduling itself is received separately by the browser suite.
 */
import { expect } from 'vitest'
import { createCollection, indexedDBCollectionOptions } from '../../src'
import { oracleProperty } from '../oracle-config'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter'
import { Channel, seed, withHarness } from './harness'
import { holdStore, observeTransactions } from './idb-driver'
import {
  OracleMismatch,
  assertPublicationHistory,
  assertSnapshot,
  assertStatuses,
} from './cross-tab-oracle'
import { recordCollection } from './recorder'
import type { Row } from './harness'

const boundaryLaw = {
  authority: `The IndexedDB cross-tab contract and the independent cross-tab model in cross-tab-oracle.ts`,
}

async function omission(fault: 'none' | 'partial' | 'error') {
  await withHarness(async (h) => {
    const before = { id: 0, name: 'before', optional: 7 }
    const after = { id: 0, name: 'reinserted' }
    await seed(h.db, 'items', [before])
    const writer = await h.open()
    const options = indexedDBCollectionOptions<Row>({
      db: await h.connect(),
      name: 'items',
      getKey: (row) => row.id,
      id: 'reader',
    })
    let commits = 0,
      truncates = 0
    const writes: Array<string> = []
    const sync = options.sync.sync
    const receiver = createCollection({
      ...options,
      sync: {
        ...options.sync,
        rowUpdateMode: fault === 'partial' ? 'partial' : 'full',
        sync: (params) =>
          sync({
            ...params,
            write: (change) => {
              writes.push(change.type)
              return params.write(change)
            },
            truncate: () => {
              truncates++
              return params.truncate()
            },
            commit: (...args) => {
              const result = params.commit(...args)
              if (++commits > 1 && fault === 'error')
                params.fail(new Error('spurious receiver error control'))
              return result
            },
          }),
      },
    })
    h.collections.push(receiver)
    await receiver.preload()
    const record = recordCollection(receiver, 'reader')
    h.disposers.push(record.stop)
    await writer.delete(0).when(`settled`)
    await writer.insert({ ...after }).when(`settled`)
    const receipts = []
    while (Channel.pending.length) {
      const receipt = Channel.dispatch()
      if (receipt) receipts.push(receipt)
    }
    await Promise.all(receipts.map((receipt) => receipt.completion))
    expect(receipts.length, 'real queued notifications').toBeGreaterThan(0)
    expect(
      receipts.every((receipt) => receipt.status === 'fulfilled'),
      'caught error does not reject the receiver promise',
    ).toBe(true)
    expect(writes, 'ordinary remote update reached').toContain('update')
    expect(truncates, 'no replacement can mask omission').toBe(0)
    assertSnapshot(receiver.values(), [after], 'whole-row omission')
    assertStatuses(record.statuses, ['ready'], 'receiver completion')
    assertPublicationHistory(
      [before],
      record.publications,
      [{ rows: [after], deletes: [], replace: false }],
      'whole-row omission',
    )
  })
}

// A receiver fault is a production mutant of the omission history. Each
// calibration accepts exactly the rejection that the shared checks raise for it.
const omissionFaults = [
  {
    name: `rejects partial-row application at the omission checkpoint`,
    fault: `partial`,
    law: `public rows`,
    checkpoint: `whole-row omission`,
  },
  {
    name: `rejects spurious Collection error despite correct rows and fulfilled receivers`,
    fault: `error`,
    law: `Collection status`,
    checkpoint: `receiver completion`,
  },
] as const

oracleProperty({
  id: `indexeddb.boundary-omission`,
  law: {
    ...boundaryLaw,
    statement: `An ordered delete and reinsert through a real provider removes the omitted whole-row field from the receiver's rows, statuses and publications.`,
    limits: `One authored delete/reinsert history with a controlled notification schedule; native scheduling is received by the browser suite.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [
    `removes an omitted whole-row field after ordered delete and reinsert`,
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`indexeddb.boundary-omission`, plan, observe, () =>
      omission('none'),
    ),
  check: forwardAssertionJudgment,
  calibrations: omissionFaults.map(({ name, fault, law, checkpoint }) => ({
    name,
    law: `indexeddb.boundary-omission`,
    driver: (
      plan: { name: string },
      observe: (checkpoint: string, value: unknown) => void,
    ) =>
      recordAssertionJudgment(
        `indexeddb.boundary-omission`,
        plan,
        observe,
        async () => {
          try {
            await omission(fault)
          } catch (error) {
            // Exactly the old matcher: the rejection names this law and cut.
            if (
              error instanceof Error &&
              (error as { law?: unknown }).law === law &&
              (error as { checkpoint?: unknown }).checkpoint === checkpoint
            )
              rejectAt(`calibration ${fault}`, error)
            throw new Error(
              `${name}: the check rejected with an error the old matcher did not accept: ${String(error)}`,
            )
          }
        },
      ),
  })),
})

async function receiverOverlap(serial: boolean) {
  await withHarness(async (h) => {
    const writer = await h.open()
    const descriptor = await h.connect()
    const receiver = await h.open('items', { db: descriptor })
    const rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]
    await writer.utils.importData(rows)
    await writer.utils.importData(rows)
    const gate = holdStore(h.db.db)
    h.disposers.push(gate.release)
    await gate.started
    const observed = observeTransactions(descriptor.db)
    h.disposers.push(observed.restore)
    const work = serial
      ? Channel.deliver()
      : (async () => {
          const completions = []
          while (Channel.pending.length)
            completions.push(Channel.dispatch()?.completion)
          await Promise.all(completions)
        })()
    void work.catch(() => undefined)
    try {
      const pending = observed.entries.filter(
        (entry) => entry.mode === 'readonly' && entry.status === 'pending',
      ).length
      const check = () => {
        if (pending < 2)
          throw new OracleMismatch(
            'receiver overlap',
            'held native transaction',
            2,
            pending,
          )
      }
      if (serial)
        expect(check).toThrow('receiver overlap at held native transaction')
      else check()
    } finally {
      await gate.release()
      await work
    }
    assertSnapshot(receiver.values(), rows, 'overlap completion')
  })
}

oracleProperty({
  id: `indexeddb.boundary-receiver-overlap`,
  law: {
    ...boundaryLaw,
    statement: `Dispatch admits two real receiver reads while the first is pending, and the serial fixture fails that reach control; both end with the source rows.`,
    limits: `Two imports held behind one native store gate; the serial fixture is the reach control of the concurrent dispatch.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [false, true],
  label: (serial) =>
    serial
      ? 'the serial fixture fails the receiver-overlap reach control'
      : 'dispatch admits two real receiver reads while the first is pending',
  resolve: (serial) => ({ serial }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.boundary-receiver-overlap`,
      plan,
      observe,
      () => receiverOverlap(plan.serial),
    ),
  check: forwardAssertionJudgment,
})

async function obsoleteReceiver(abort: boolean) {
  await withHarness(async (h) => {
    const writer = await h.open()
    const descriptor = await h.connect()
    const receiver = await h.open('items', { db: descriptor })
    const record = recordCollection(receiver, 'receiver')
    h.disposers.push(record.stop)
    const row = { id: 1, name: 'durable before cleanup' }
    await writer.insert(row).when(`settled`)
    const gate = holdStore(h.db.db)
    h.disposers.push(gate.release)
    await gate.started
    const observed = observeTransactions(descriptor.db)
    h.disposers.push(observed.restore)
    const receipt = Channel.dispatch()!
    expect(observed.entries).toHaveLength(1)
    await receiver.cleanup()
    const startup = receiver.preload()
    void startup.catch(() => undefined)
    if (abort) observed.entries[0]!.transaction.abort()
    await gate.release()
    await receipt.completion
    await startup
    assertStatuses(
      record.statuses,
      ['ready', 'cleaned-up', 'loading'],
      'obsolete receiver completion',
    )
    assertSnapshot(receiver.values(), [row], 'new sync run restore')
    await writer
      .update(1, (draft) => {
        draft.name = 'later version'
      })
      .when(`settled`)
    await Channel.drain()
    assertSnapshot(
      receiver.values(),
      [{ ...row, name: 'later version' }],
      'subsequent version update',
    )
  })
}

oracleProperty({
  id: `indexeddb.boundary-obsolete-receiver`,
  law: {
    ...boundaryLaw,
    statement: `An obsolete receiver success or failure cannot affect a restarted sync run: statuses, the restored rows and a later version update follow the new run.`,
    limits: `One held receiver read across cleanup and restart, completing successfully or by abort.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [false, true],
  label: (abort) =>
    `an obsolete receiver ${abort ? 'failure' : 'success'} cannot affect a restarted sync run`,
  resolve: (abort) => ({ abort }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.boundary-obsolete-receiver`,
      plan,
      observe,
      () => obsoleteReceiver(plan.abort),
    ),
  check: forwardAssertionJudgment,
})

async function activeReceiverAbort() {
  await withHarness(async (h) => {
    const writer = await h.open()
    const descriptor = await h.connect()
    const receiver = await h.open('items', { db: descriptor })
    const record = recordCollection(receiver, 'receiver')
    h.disposers.push(record.stop)
    await writer.insert({ id: 1, name: 'durable' }).when(`settled`)
    const gate = holdStore(h.db.db)
    h.disposers.push(gate.release)
    await gate.started
    const observed = observeTransactions(descriptor.db)
    h.disposers.push(observed.restore)
    const receipt = Channel.dispatch()!
    expect(observed.entries).toHaveLength(1)
    observed.entries[0]!.transaction.abort()
    await gate.release()
    await receipt.completion
    expect(receipt.status).toBe('fulfilled')
    // After the first ready a receiver failure stops sync but keeps status.
    expect(record.statuses).toContain('sync-error')
    expect(receiver.status).toBe('ready')
    expect(receiver.health.error).toBeTruthy()
    expect(receiver.health.failureReason).toBeNull()
    assertSnapshot(
      receiver.values(),
      [],
      'failed read does not invent source rows',
    )
    assertSnapshot(
      writer.values(),
      [{ id: 1, name: 'durable' }],
      'healthy sibling survives',
    )
  })
}

oracleProperty({
  id: `indexeddb.boundary-active-abort`,
  law: {
    ...boundaryLaw,
    statement: `An active receiver abort after the first ready is the Collection's error with its status and rows kept, while the receiver callback fulfills and a healthy sibling survives.`,
    limits: `One held receiver read aborted natively after one durable insert.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [
    'reports an active receiver abort as the Collection error while its callback fulfills',
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.boundary-active-abort`,
      plan,
      observe,
      () => activeReceiverAbort(),
    ),
  check: forwardAssertionJudgment,
})

async function importedReplacement() {
  await withHarness(async (h) => {
    const before = [{ id: 'old', name: 'old' }]
    const after = [
      { id: 'a', name: 'new a' },
      { id: 'b', name: 'new b' },
    ]
    await seed(h.db, 'items', before)
    const writer = await h.open()
    const receiver = await h.open('items', { db: await h.connect() })
    const record = recordCollection(receiver, 'receiver')
    h.disposers.push(record.stop)
    await writer.utils.importData(after)
    // Native readonly transactions may complete in either order. A targeted
    // notification cannot publish new rows before replacement removes old rows.
    // This controlled schedule represents that observed native completion cut.
    const index = Channel.pending.findIndex(
      ({ data }) => (data as { type: string }).type === 'data-changed',
    )
    if (index !== -1) await Channel.dispatch(index)!.completion
    await Channel.drain()
    assertPublicationHistory(
      before,
      record.publications,
      [{ rows: after, deletes: [], replace: true }],
      'imported replacement',
    )
  })
}

oracleProperty({
  id: `indexeddb.boundary-imported-replacement`,
  law: {
    ...boundaryLaw,
    statement: `An imported replacement never publishes a union with the prior snapshot: the receiver publishes one replacement of the old rows by the new rows.`,
    limits: `One import over one seeded row with the targeted data-changed notification delivered first.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [
    'an imported replacement never publishes a union with the prior snapshot',
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.boundary-imported-replacement`,
      plan,
      observe,
      () => importedReplacement(),
    ),
  check: forwardAssertionJudgment,
})

async function stalePeer(deliver: boolean) {
  await withHarness(async (h) => {
    const before = { id: 0, name: 'old' }
    await seed(h.db, 'items', [before])
    const a = await h.open(),
      b = await h.open('items', { db: await h.connect() })
    await a.delete(0).when(`settled`)
    if (deliver) {
      await Channel.drain()
      assertSnapshot(b.values(), [], 'delivered admission')
      expect(() =>
        b.update(0, (row) => {
          row.name = 'updated'
        }),
      ).toThrow()
    } else {
      assertSnapshot(b.values(), [before], 'stale admission')
      await b
        .update(0, (row) => {
          row.name = 'updated'
        })
        .when(`settled`)
      await Channel.drain()
      assertSnapshot(
        a.values(),
        [{ id: 0, name: 'updated' }],
        'stale update peer',
      )
    }
    assertSnapshot(
      (await h.open()).values(),
      deliver ? [] : [{ id: 0, name: 'updated' }],
      'admission restore',
    )
  })
}

oracleProperty({
  id: `indexeddb.boundary-stale-peer`,
  law: {
    ...boundaryLaw,
    statement: `A stale peer can author an update before a deletion publication reaches it and rejects the update after it, and a fresh restore agrees.`,
    limits: `One seeded row deleted by a peer, with the deletion notification delivered or held.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexed-db.ts#createIndexedDB',
    'src/indexed-db.ts#indexedDBCollectionOptions',
  ],
  histories: [false, true],
  label: (deliver) =>
    `a stale peer ${deliver ? 'rejects an update after deletion publication' : 'can author an update before deletion publication'}`,
  resolve: (deliver) => ({ deliver }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `indexeddb.boundary-stale-peer`,
      plan,
      observe,
      () => stalePeer(plan.deliver),
    ),
  check: forwardAssertionJudgment,
})
