/**
 * Controlled transport contract, complementing persistence-oracle.test.ts.
 * Disjoint accepted writes commute: after delivering every notification, both
 * Collections and a fresh restore equal their union. Duplicate notifications
 * cannot duplicate rows; self/foreign notifications cannot alter the receiver.
 *
 * The reference is an authored array, not the adapter's version cache. The
 * bounded grammar below varies sender, key representation, batching and delayed
 * delivery. No same-key conflict policy or real browser scheduling is claimed.
 * Channel (harness.ts) preserves payload cloning/routing and explicitly drives
 * delivery; assertions occur after sender persistence and receiver work.
 */
import { expect, it } from 'vitest'
import { Channel, assertRows, readStore, seed, withHarness } from './harness'
import type { Row } from './harness'

for (const reverse of [false, true]) {
  it(
    'converges independent writers with ' +
      (reverse ? 'reversed' : 'FIFO') +
      ' notification delivery',
    async () => {
      await withHarness(async (h) => {
        const left = await h.open(),
          right = await h.open()
        const rows: Array<Row> = [
          { id: 'a:[0]/☃', name: 'left', optional: 1 },
          { id: 0, name: 'right' },
          { id: '0', name: 'typed key' },
        ]
        await Promise.all([
          left.insert([rows[0]!, rows[2]!]).isPersisted.promise,
          right.insert(rows[1]!).isPersisted.promise,
        ])
        expect(Channel.pending.length).toBe(2)
        // Redelivery retains the original messages, making duplicate output
        // representable rather than deduplicating it in the recorder.
        Channel.pending.push(...Channel.pending)
        if (reverse) Channel.pending.reverse()
        expect(await Channel.deliver()).toBe(4)
        for (const subject of [left, right, await h.open()])
          assertRows(subject.values(), rows, 'disjoint writer convergence')
        await left.update(rows[0]!.id, (row) => {
          delete row.optional
        }).isPersisted.promise
        await left.delete(rows[2]!.id).isPersisted.promise
        await left.insert({ id: 'temporary', name: 'removed' }).isPersisted
          .promise
        await left.delete('temporary').isPersisted.promise
        await Channel.deliver()
        const expected = [{ id: rows[0]!.id, name: 'left' }, rows[1]!]
        for (const subject of [left, right, await h.open()])
          assertRows(
            subject.values(),
            expected,
            'delayed mixed changes and removed fields',
          )
      })
    },
  )
}

it('ignores self, foreign database and foreign store notifications', async () => {
  await withHarness(async (h) => {
    const collection = await h.open()
    await collection.insert({ id: 1, name: 'kept' }).isPersisted.promise
    const original = Channel.sent[0] as {
      tabId: string
      database: string
      name: string
    }
    const channel = [...Channel.peers][0]!
    // A clear message would visibly remove the row if any exclusion fails.
    for (const patch of [
      { tabId: original.tabId },
      { tabId: 'remote', database: 'foreign' },
      { tabId: 'remote', name: 'other' },
    ]) {
      await channel.onmessage?.(
        new MessageEvent('message', {
          data: {
            ...original,
            ...patch,
            type: 'database-cleared',
            changedKeys: [],
          },
        }),
      )
      assertRows(
        collection.values(),
        [{ id: 1, name: 'kept' }],
        'excluded notification',
      )
    }
    expect(Channel.sent.length).toBe(1)
  })
})

it('rejects illegal missing-key updates without changing durable data', async () => {
  await withHarness(async (h) => {
    const collection = await h.open()
    expect(() =>
      collection.update('absent', (row) => {
        row.name = 'invalid'
      }),
    ).toThrow()
    expect((await readStore(h.db, 'items')).rows).toEqual([])
  })
})

it('does not let a late startup publish into a cleaned-up sync run', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', [{ id: 1, name: 'stored' }])
    const collection = h.make()
    const preload = collection.preload().catch(() => undefined)
    await collection.cleanup()
    await preload
    // Another IDB read supplies a concrete completion boundary for the earlier
    // startup transaction; no elapsed-time sleep decides correctness.
    await readStore(h.db, 'items')
    expect(collection.status).toBe('cleaned-up')
    expect(Channel.peers.size).toBe(0)
    await collection.preload()
    assertRows(
      collection.values(),
      [{ id: 1, name: 'stored' }],
      'fresh sync run',
    )
    expect(Channel.peers.size).toBe(1)
  })
})
