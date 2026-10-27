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
 *
 * Replacement notifications invalidate an earlier snapshot. A disjoint write
 * that commits afterward remains authoritative even if that notification arrives
 * later. Utility persistence has the same notification obligation while its
 * Collection is idle or cleaned-up. Administrative deletion retires managed
 * Collections without replacing their rows; reuse requires a fresh descriptor.
 * These are bounded controlled histories, not browser scheduling evidence.
 */
import { expect, it } from 'vitest'
import { executeTransaction } from '../../src'
import { declareOracle } from '../oracle-declaration'
import { Channel, assertRows, readStore, seed, withHarness } from './harness'
import type { Row } from './harness'

// The reference applies completed storage operations in their authored order:
// replacement removes prior rows, then the later disjoint insertion adds one.
// Notification order may change how the receiver learns that result, not which
// durable rows exist after every message has been delivered. Each replacement
// kind crosses FIFO, reverse and duplicate delivery; the latter two are stronger
// controlled transport challenges, not claims about native BroadcastChannel.
// The model applies the completed replacement, then the later insertion, in the
// authored order. A clear leaves only the insertion; an import keeps its rows.
function expectedAfterReplacement(
  replacement: 'clear' | 'import',
  imported: Row,
  inserted: Row,
): Array<Row> {
  return replacement === 'clear' ? [inserted] : [imported, inserted]
}

for (const replacement of ['clear', 'import'] as const) {
  for (const delivery of ['FIFO', 'reverse', 'duplicate'] as const) {
    it(
      'retains a later local insert after ' +
        replacement +
        ' with ' +
        delivery +
        ' notifications',
      async () => {
        await withHarness(async (h) => {
          await seed(h.db, 'items', [{ id: 'old', name: 'replaced' }])
          const source = await h.open()
          const receiver = await h.open()
          const imported = { id: 'imported', name: 'replacement' }
          if (replacement === 'clear') await source.utils.clearObjectStore()
          else await source.utils.importData([imported])
          const inserted = { id: 'later', name: 'accepted after replacement' }
          await receiver.insert(inserted).isPersisted.promise
          const expected = expectedAfterReplacement(
            replacement,
            imported,
            inserted,
          )
          const pending = Channel.pending.length
          expect(
            pending,
            'held replacement and insertion notifications',
          ).toBeGreaterThan(1)
          if (delivery === 'reverse') Channel.pending.reverse()
          if (delivery === 'duplicate') Channel.pending.push(...Channel.pending)
          expect(await Channel.deliver(), 'receiver work completed').toBe(
            delivery === 'duplicate' ? pending * 2 : pending,
          )
          assertRows(
            (await readStore<Row>(h.db, 'items')).rows,
            expected,
            'authored durable operation order',
          )
          assertRows((await h.open()).values(), expected, 'fresh restore')
          assertRows(source.values(), expected, 'first writer convergence')
          assertRows(
            receiver.values(),
            expected,
            'later writer survives delayed replacement',
          )
        })
      },
    )
  }
}

// Peer edit model. The reference applies one authored peer update or delete to the
// initial rows; metadata completeness does not change this membership.
function expectedAfterPeerEdit(
  initial: Array<Row>,
  key: number | string,
  action: 'update' | 'delete',
): Array<Row> {
  return action === 'update'
    ? [{ id: key, name: 'new' }, initial[1]!]
    : initial.slice(1)
}

declareOracle({
  model: [expectedAfterReplacement, expectedAfterPeerEdit],
})

// Restored source membership does not depend on adapter metadata. The model
// applies an authored peer edit to initial rows; metadata completeness is an
// independent grammar axis. Raw wrapper rows reach the production restore path.
for (const metadata of ['none', 'mixed', 'all'] as const) {
  for (const key of [1, '1'])
    for (const action of ['update', 'delete'] as const) {
      it(`reconciles ${action} of ${typeof key} keys with ${metadata} initial versions`, async () => {
        await withHarness(async (h) => {
          const initial = [
            { id: key, name: 'legacy' },
            { id: 'anchor', name: 'untouched' },
          ]
          await executeTransaction(
            h.db.db,
            'items',
            'readwrite',
            (_, stores) => {
              for (const row of initial) stores.items!.put(row, row.id)
            },
          )
          if (metadata !== 'none')
            await seed(
              h.db,
              'items',
              metadata === 'all' ? initial : initial.slice(1),
            )
          const receiver = await h.open()
          const sender = await h.open('items', { db: await h.connect() })
          if (action === 'update')
            await sender.update(key, (row) => {
              row.name = 'new'
            }).isPersisted.promise
          else await sender.delete(key).isPersisted.promise
          // Repeat delivery: missing versions cannot turn an update into a second
          // insert, and repeated deletes must leave the independent anchor intact.
          Channel.pending.push(...Channel.pending)
          await Channel.deliver()
          const expected = expectedAfterPeerEdit(initial, key, action)
          expect(receiver.status).toBe('ready')
          for (const subject of [receiver, sender, await h.open()])
            assertRows(subject.values(), expected, 'unversioned reconciliation')
          assertRows(
            (await readStore<Row>(h.db, 'items')).rows,
            expected,
            'unversioned durable',
          )
        })
      })
    }
}
