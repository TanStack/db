// Ordinary tests for local write ordering. local-write-order-oracle.test.ts owns
// the mutation-order law and its model. These fixed scenarios hold one handler
// or reenter it, and compare with literal rows and the native failure outcome.
import { expect, it } from 'vitest'
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
      aOutcome = a.when('settled')
    await entered.promise
    const b = c.update(1, (row) => {
      row.name = 'B'
    })
    let settled = false
    const bOutcome = b.when('settled').then(() => {
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
          later = c
            .update(1, (row) => {
              row.name = 'B'
            })
            .when('settled')
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
    await Promise.all([first.when('settled'), later])
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
      const rejected = first.when('settled').then(
        () => false,
        () => true,
      )
      const next = sameKey
        ? c.update(1, (row) => {
            row.name = 'valid'
            delete row.unsupported
          })
        : c.insert({ id: 2, name: 'valid' })
      await next.when('settled')
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
