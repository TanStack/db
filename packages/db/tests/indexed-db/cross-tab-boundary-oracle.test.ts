/**
 * Distinguishing receiving histories for the cross-tab contract. Each history
 * has independent authored before/after values and a real provider boundary.
 * The omission history uses delete/reinsert via public APIs, so a partial-row
 * mutant cannot hide behind draft undefined values or import truncation.
 * The status history observes caught receiver failure independently of promise
 * fulfillment. Cleanup histories keep old native reads alive after retirement.
 * Native scheduling itself is received separately by the browser suite.
 */
import { expect, it } from 'vitest'
import { createCollection, indexedDBCollectionOptions  } from '../../src'
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
                params.markError(new Error('spurious receiver error control'))
              return result
            },
          }),
      },
    })
    h.collections.push(receiver)
    await receiver.preload()
    const record = recordCollection(receiver, 'reader')
    h.disposers.push(record.stop)
    await writer.delete(0).isPersisted.promise
    await writer.insert({ ...after }).isPersisted.promise
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

it('removes an omitted whole-row field after ordered delete and reinsert', () =>
  omission('none'))
it('rejects partial-row application at the omission checkpoint', async () => {
  await expect(omission('partial')).rejects.toMatchObject({
    law: 'public rows',
    checkpoint: 'whole-row omission',
  })
})
it('rejects spurious Collection error despite correct rows and fulfilled receivers', async () => {
  await expect(omission('error')).rejects.toMatchObject({
    law: 'Collection status',
    checkpoint: 'receiver completion',
  })
})

for (const serial of [false, true]) {
  it(
    serial
      ? 'the serial fixture fails the receiver-overlap reach control'
      : 'dispatch admits two real receiver reads while the first is pending',
    async () => {
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
    },
  )
}

for (const abort of [false, true]) {
  it(`an obsolete receiver ${abort ? 'failure' : 'success'} cannot affect a restarted sync run`, async () => {
    await withHarness(async (h) => {
      const writer = await h.open()
      const descriptor = await h.connect()
      const receiver = await h.open('items', { db: descriptor })
      const record = recordCollection(receiver, 'receiver')
      h.disposers.push(record.stop)
      const row = { id: 1, name: 'durable before cleanup' }
      await writer.insert(row).isPersisted.promise
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
      await writer.update(1, (draft) => {
        draft.name = 'later version'
      }).isPersisted.promise
      await Channel.drain()
      assertSnapshot(
        receiver.values(),
        [{ ...row, name: 'later version' }],
        'subsequent version update',
      )
    })
  })
}

it('reports an active receiver abort through Collection status while its callback fulfills', async () => {
  await withHarness(async (h) => {
    const writer = await h.open()
    const descriptor = await h.connect()
    const receiver = await h.open('items', { db: descriptor })
    const record = recordCollection(receiver, 'receiver')
    h.disposers.push(record.stop)
    await writer.insert({ id: 1, name: 'durable' }).isPersisted.promise
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
    expect(record.statuses).toContain('error')
    expect(receiver.status).toBe('error')
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
})

it('an imported replacement never publishes a union with the prior snapshot', async () => {
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
})

for (const deliver of [false, true])
  it(`a stale peer ${deliver ? 'rejects an update after deletion publication' : 'can author an update before deletion publication'}`, async () => {
    await withHarness(async (h) => {
      const before = { id: 0, name: 'old' }
      await seed(h.db, 'items', [before])
      const a = await h.open(),
        b = await h.open('items', { db: await h.connect() })
      await a.delete(0).isPersisted.promise
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
        await b.update(0, (row) => {
          row.name = 'updated'
        }).isPersisted.promise
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
  })
