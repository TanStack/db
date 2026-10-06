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
const initial: Array<Row> = [
  { id: 1, name: 'initial' },
  { id: 2, name: 'anchor' },
]
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

// Releasing every handler before observing would miss premature later commits.
// A native read supplies the cut while the first handler is explicitly held.
it('holds a later accepted update until the earlier handler settles', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', initial)
    const first = deferred(),
      entered = deferred(),
      later = deferred()
    let calls = 0
    const c = await h.open('items', {
      onUpdate: async () => {
        if (calls++ === 0) {
          entered.resolve()
          return first.promise
        }
        later.resolve()
        return undefined
      },
    })
    const a = c.update(1, (row) => {
        row.name = 'A'
      }),
      aOutcome = a.isPersisted.promise
    await entered.promise
    const b = c.update(1, (row) => {
      row.name = 'B'
    })
    let settled = false
    const bOutcome = b.isPersisted.promise.then(() => {
      settled = true
    })
    await later.promise
    const held = await readStore<Row>(h.db, 'items'),
      early = settled
    first.resolve()
    await Promise.all([aOutcome, bOutcome])
    expect(early, 'later caller still pending').toBe(false)
    assertRows(held.rows, initial, 'earlier handler held: durable')
    assertRows(
      (await readStore<Row>(h.db, 'items')).rows,
      [{ id: 1, name: 'B' }, initial[1]!],
      'ordered final durable',
    )
  })
})

// Reentry is another legal invocation order: application code for the first
// update authors a second update before returning its held decision. Reserving
// order after calling that code lets the second write overtake the first.
it('reserves mutation order before a handler authors another update', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', initial)
    const gate = deferred()
    let reentered = false,
      later: Promise<unknown> | undefined
    const c = await h.open('items', {
      onUpdate: async () => {
        if (!reentered) {
          reentered = true
          later = c.update(1, (row) => {
            row.name = 'B'
          }).isPersisted.promise
          return gate.promise
        }
        return undefined
      },
    })
    const first = c.update(1, (row) => {
      row.name = 'A'
    })
    const held = await readStore<Row>(h.db, 'items')
    gate.resolve()
    await Promise.all([first.isPersisted.promise, later])
    expect(reentered).toBe(true)
    assertRows(held.rows, initial, 'reentered handler held')
    assertRows(
      (await readStore<Row>(h.db, 'items')).rows,
      [{ id: 1, name: 'B' }, initial[1]!],
      'reentrant mutation order',
    )
  })
})

// Failure of an earlier native batch has the same durable identity effect as a
// rejected application decision. A later write was already authored when the
// failure occurs; it must still persist. Same-key repair removes the uncloneable
// field explicitly, so it is a legal new whole-row value, not a leaked bad input.
for (const sameKey of [false, true]) {
  it(`continues queued writes after native failure with same key ${sameKey}`, async () => {
    await withHarness(async (h) => {
      const c = await h.open()
      const peer = await h.open('items', { db: await h.connect() })
      const first = c.insert({ id: 1, name: 'invalid', unsupported: () => {} })
      const rejected = first.isPersisted.promise.then(
        () => false,
        () => true,
      )
      const next = sameKey
        ? c.update(1, (row) => {
            row.name = 'valid'
            delete row.unsupported
          })
        : c.insert({ id: 2, name: 'valid' })
      await next.isPersisted.promise
      expect(await rejected, 'native failure reaches the earlier caller').toBe(
        true,
      )
      await Channel.deliver()
      const expected = [{ id: sameKey ? 1 : 2, name: 'valid' }]
      assertRows(
        (await readStore<Row>(h.db, 'items')).rows,
        expected,
        'native failure ordered suffix',
      )
      for (const subject of [c, peer, await h.open()])
        assertRows(
          subject.values(),
          expected,
          'native failure public and restore',
        )
    })
  })
}
