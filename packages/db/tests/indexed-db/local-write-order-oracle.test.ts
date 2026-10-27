/**
 * Automatic writes from one Collection persist in mutation order, independently
 * of handler completion order. This is the maintainer-approved local ordering
 * law. Rejected handlers contribute no durable effect and do not stop later
 * accepted writes. Each successful batch still owns one native transaction.
 *
 * The reference folds authored whole-row effects, omitting rejected positions.
 * It does not read handler payloads, adapter versions or persistence callbacks.
 * The bounded grammar crosses three edits of one key, disjoint keys, and
 * update/delete/reinsert with all six handler completion orders and all eight
 * accept/reject masks, after no peer work or an ordered peer update, deletion,
 * or replacement. After every handler decision, only the contiguous decided
 * prefix can have durable effects. The peer and a fresh restore must expose that
 * prefix; accepted callers beyond it cannot report persistence. Local optimistic
 * state is compared only after all handlers settle; its intermediate publication
 * law belongs to optimistic-history-oracle.ts and pending-history-oracle.test.ts.
 * Cross-Collection and manual acceptance ordering are not
 * specified here. harness.ts controls handlers and observes raw durable rows.
 */
import { expect, it } from 'vitest'
import { declareOracle } from '../oracle-config'
import { initial } from './local-write-support'
import {
  Channel,
  assertRows,
  deferred,
  readStore,
  seed,
  withHarness,
} from './harness'
import type { Row } from './harness'

type Effect = { key: number; row: Row | undefined }
const grammars: Record<string, Array<Effect>> = {
  sameKey: [
    { key: 1, row: { id: 1, name: 'A' } },
    { key: 1, row: { id: 1, name: 'B' } },
    { key: 1, row: { id: 1, name: 'C' } },
  ],
  disjoint: [
    { key: 1, row: { id: 1, name: 'A' } },
    { key: 2, row: { id: 2, name: 'B' } },
    { key: 3, row: { id: 3, name: 'C' } },
  ],
  reinsert: [
    { key: 1, row: { id: 1, name: 'A' } },
    { key: 1, row: undefined },
    { key: 1, row: { id: 1, name: 'C' } },
  ],
}
const orders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]
function expectedRows(effects: Array<Effect>, mask: number, before = initial) {
  const rows = new Map(before.map((row) => [row.id, row]))
  // Author order determines the durable fold. Completion order is absent.
  effects.forEach((effect, index) => {
    if (!(mask & (1 << index))) return
    if (effect.row) rows.set(effect.key, effect.row)
    else rows.delete(effect.key)
  })
  return [...rows.values()]
}
// expectedRows is the model: the durable fold of the authored effects that the
// mask accepts, in author order, from the rows that the peer action leaves.
declareOracle({ model: [expectedRows] })

for (const [kind, effects] of Object.entries(grammars)) {
  for (const peerAction of ['none', 'update', 'delete', 'replace'] as const)
    for (const order of orders)
      for (let mask = 0; mask < 8; mask++) {
        it(`${kind} persists accepted effects after peer ${peerAction} in mutation order (${order.join(',')}; mask ${mask})`, async () => {
          await withHarness(async (h) => {
            await seed(h.db, 'items', initial)
            const gates = effects.map(() => deferred()),
              entered = effects.map(() => deferred())
            let slot = 0
            const handler = () => {
              const index = slot++
              entered[index]!.resolve()
              return gates[index]!.promise
            }
            const c = await h.open('items', {
              onInsert: handler,
              onUpdate: handler,
              onDelete: handler,
            })
            const peer = await h.open('items', { db: await h.connect() })
            const outcomes = []
            const succeeded = new Set<number>()
            for (const [index, effect] of effects.entries()) {
              const tx = effect.row
                ? c.has(effect.key)
                  ? c.update(effect.key, (row) => {
                      row.name = effect.row!.name
                    })
                  : c.insert({ ...effect.row })
                : c.delete(effect.key)
              outcomes.push(
                tx.isPersisted.promise.then(
                  () => {
                    succeeded.add(index)
                    return true
                  },
                  () => false,
                ),
              )
              await entered[index]!.promise
            }
            // Peer persistence completes while all local handlers are held. Its
            // authored effect is therefore the durable base for ordered local
            // acceptance. This composes source work with several pending intents
            // without assigning a winner to unordered cross-Collection writes.
            const peerRow = { id: 1, name: 'peer' }
            const beforeLocal =
              peerAction === 'replace'
                ? [peerRow]
                : peerAction === 'delete'
                  ? initial.slice(1)
                  : peerAction === 'update'
                    ? [peerRow, initial[1]!]
                    : initial
            if (peerAction === 'update')
              await peer.update(1, (row) => {
                row.name = 'peer'
              }).isPersisted.promise
            if (peerAction === 'delete')
              await peer.delete(1).isPersisted.promise
            if (peerAction === 'replace') await peer.utils.importData([peerRow])
            await Channel.deliver()
            assertRows(
              (await readStore<Row>(h.db, 'items')).rows,
              beforeLocal,
              'peer persistence before local decisions',
            )
            const decided = new Set<number>()
            try {
              for (const index of order) {
                if (mask & (1 << index)) gates[index]!.resolve()
                else gates[index]!.reject(new Error(`reject ${index}`))
                decided.add(index)
                // This is an author-prefix computation, not a second queue. The
                // first undecided position bounds which effects may be durable.
                let prefix = 0
                while (decided.has(prefix)) prefix++
                await Promise.all(outcomes.slice(0, prefix))
                const durable = await readStore<Row>(h.db, 'items')
                const expected = expectedRows(
                  effects.slice(0, prefix),
                  mask,
                  beforeLocal,
                )
                const cut = `decision ${index}, decided prefix ${prefix}`
                assertRows(durable.rows, expected, cut + ': durable')
                expect(
                  [...succeeded].every((position) => position < prefix),
                  cut + ': no later success',
                ).toBe(true)
                await Channel.deliver()
                assertRows(peer.values(), expected, cut + ': peer')
                const restored = await h.open()
                assertRows(restored.values(), expected, cut + ': fresh restore')
                await restored.cleanup()
              }
            } finally {
              // A hostile implementation may fail at an intermediate cut. Release
              // the remaining handlers without losing that primary assertion.
              gates.forEach((gate) => gate.resolve())
              await Promise.all(outcomes)
            }
            expect(await Promise.all(outcomes)).toEqual(
              effects.map((_, index) => !!(mask & (1 << index))),
            )
            await Channel.deliver()
            const expected = expectedRows(effects, mask, beforeLocal)
            assertRows(
              (await readStore<Row>(h.db, 'items')).rows,
              expected,
              'all handlers settled: durable',
            )
            for (const subject of [c, peer, await h.open()])
              assertRows(
                subject.values(),
                expected,
                'all handlers settled: public and restore',
              )
          })
        })
      }
}
