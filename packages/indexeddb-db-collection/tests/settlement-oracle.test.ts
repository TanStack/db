/**
 * Persistence boundary oracle.
 *
 * Authority: Collection handlers determine optimistic success/failure;
 * acceptMutations accepts only its Collection's mutations; IndexedDB transactions
 * commit all writes or abort all writes. A rejected write must not appear after
 * a successful suffix or reopen. Clear/import replace the source snapshot.
 *
 * The model retains only an authored "before" and "after" snapshot and an
 * application decision. Before a held handler resolves, only public optimistic
 * state changes. Rejection selects before; success selects after. This differs
 * structurally from the implementation's caches, transaction loops and sync.
 *
 * These bounded matrices cover all CRUD operations, both decisions, automatic
 * and manual persistence, and bad rows before/after a valid write. The driver
 * in harness.ts uses real Collection APIs, fake-indexeddb transactions, and
 * explicit deferred handlers. Checkpoints are handler entry, settlement,
 * delivered notification, ordinary-insert and replacement suffixes, and reopen.
 *
 * The remote-delete model retains a source deletion independently of a local
 * optimistic delete. Rolling back or completing local intent cannot undo the
 * accepted source deletion. A held native transaction proves request success
 * alone cannot establish durability in wrapper.test.ts.
 *
 * Limits: controlled transport/fault boundaries, no native browser handoff,
 * arbitrary overlapping writers or process crash. This owner makes bounded
 * matrix claims; generated sequential histories live in persistence-oracle.
 */
import { createTransaction } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import {
  Channel,
  assertRows,
  deferred,
  readStore,
  seed,
  withHarness,
} from './harness'
import type { Operation, Row } from './harness'

const original: Array<Row> = [
  { id: 1, name: 'before' },
  { id: 2, name: 'anchor' },
]
describe('application decision precedes durability', () => {
  for (const operation of ['insert', 'update', 'delete'] as const) {
    for (const accept of [false, true]) {
      it(
        operation +
          (accept ? ' commits' : ' rejects') +
          ' only after the handler settles',
        async () => {
          await withHarness(async (h) => {
            const before = operation === 'insert' ? original.slice(1) : original
            const after =
              operation === 'delete'
                ? original.slice(1)
                : [{ id: 1, name: 'after' }, original[1]!]
            await seed(h.db, 'items', before)
            const entered = deferred(),
              gate = deferred()
            const failure = new Error('application rejected')
            const handler = vi
              .fn(() => Promise.resolve())
              .mockImplementationOnce(() => {
                entered.resolve()
                return gate.promise
              })
            const collection = await h.open('items', {
              onInsert: operation === 'insert' ? handler : undefined,
              onUpdate: operation === 'update' ? handler : undefined,
              onDelete: operation === 'delete' ? handler : undefined,
            })
            const peer = await h.open()
            const tx =
              operation === 'insert'
                ? collection.insert(after[0]!)
                : operation === 'update'
                  ? collection.update(1, (row) => {
                      row.name = 'after'
                    })
                  : collection.delete(1)
            let settled = false
            const outcome = tx.isPersisted.promise.then(
              () => {
                settled = true
                return undefined
              },
              (error) => {
                settled = true
                return error as unknown
              },
            )
            await entered.promise
            // Capture before releasing even on a bad implementation, so failure
            // cleanup cannot leave a permanently held handler behind.
            const during = await readStore<Row>(h.db, 'items')
            const sent = Channel.sent.length
            const early = settled
            const visible = [...collection.values()]
            if (accept) gate.resolve()
            else gate.reject(failure)
            const result = await outcome
            expect(handler).toHaveBeenCalledTimes(1)
            expect(early).toBe(false)
            assertRows(
              visible,
              after,
              'handler entry: optimistic public snapshot',
            )
            assertRows(during.rows, before, 'handler entry: durable snapshot')
            expect(sent, 'no premature notification').toBe(0)
            expect(result).toBe(accept ? undefined : failure)
            const expected = accept ? after : before
            await Channel.deliver()
            assertRows(collection.values(), expected, 'settled public')
            assertRows(peer.values(), expected, 'settled peer')
            assertRows(
              (await readStore<Row>(h.db, 'items')).rows,
              expected,
              'settled durable',
            )
            // An ordinary write cannot flush rejected intent. Replacement has a
            // separate cut because clearing the store could otherwise hide it.
            const suffix = { id: 3, name: 'suffix' }
            const afterSuffix = [...expected, suffix]
            await collection.insert({ ...suffix }).isPersisted.promise
            await Channel.deliver()
            assertRows(
              collection.values(),
              afterSuffix,
              'ordinary suffix public',
            )
            assertRows(peer.values(), afterSuffix, 'ordinary suffix peer')
            assertRows(
              (await readStore<Row>(h.db, 'items')).rows,
              afterSuffix,
              'ordinary suffix durable',
            )
            assertRows(
              (await h.open()).values(),
              afterSuffix,
              'ordinary suffix restore',
            )
            const replacement = [...afterSuffix, { id: 4, name: 'replacement' }]
            await collection.utils.importData(
              replacement.map((row) => ({ ...row })),
            )
            await Channel.deliver()
            assertRows(
              (await h.open()).values(),
              replacement,
              'replacement suffix restore',
            )
          })
        },
      )
    }
  }
})

describe('atomic persistence and truthful settlement', () => {
  for (const entry of ['automatic', 'manual', 'import'] as const) {
    for (const badIndex of [0, 1, 2]) {
      it(entry + ' rolls back a clone failure at row ' + badIndex, async () => {
        await withHarness(async (h) => {
          // The approved import contract retains a populated store on failure.
          // Three rows distinguish a middle abort from first/terminal failure.
          const before = original
          await seed(h.db, 'items', before)
          const collection = await h.open()
          const peer = await h.open()
          const rows: Array<Row> = [
            { id: 3, name: 'valid' },
            { id: 4, name: 'valid' },
            { id: 5, name: 'valid' },
          ]
          rows[badIndex] = { ...rows[badIndex]!, unsupported: () => {} }
          const beforeVersions = await readStore(h.db, '_versions')
          let promise: Promise<unknown>
          if (entry === 'automatic')
            promise = collection.insert(rows).isPersisted.promise
          else if (entry === 'import')
            promise = collection.utils.importData(rows)
          else {
            const tx = createTransaction({
              mutationFn: ({ transaction }) =>
                collection.utils.acceptMutations(transaction),
            })
            tx.mutate(() => collection.insert(rows))
            promise = tx.isPersisted.promise
          }
          const outcome = await promise.then(
            () => 'fulfilled',
            () => 'rejected',
          )
          expect(outcome, 'failed write settlement').toBe('rejected')
          assertRows(
            (await readStore<Row>(h.db, 'items')).rows,
            before,
            'aborted durable snapshot',
          )
          expect(
            await readStore(h.db, '_versions'),
            'no orphan or advanced versions',
          ).toEqual(beforeVersions)
          assertRows(collection.values(), before, 'rollback public snapshot')
          await Channel.deliver()
          assertRows(
            peer.values(),
            before,
            'failure cannot publish a peer change',
          )
          await collection.insert({ id: 5, name: 'suffix' }).isPersisted.promise
          await Channel.deliver()
          assertRows(
            (await h.open()).values(),
            [...before, { id: 5, name: 'suffix' }],
            'successful suffix restore',
          )
        })
      })
    }
  }

  for (const operation of ['insert', 'update', 'delete'] as Array<Operation>) {
    it(
      operation +
        ' rejects an aborted data transaction without changing rows or versions',
      async () => {
        await withHarness(async (h) => {
          await seed(h.db, 'items', original)
          const collection = await h.open()
          const before = await readStore(h.db, '_versions')
          const start = h.db.db.transaction.bind(h.db.db)
          let aborted = 0
          const spy = vi
            .spyOn(h.db.db, 'transaction')
            .mockImplementation((stores, mode, options) => {
              const tx = start(stores, mode, options)
              if (mode === 'readwrite') {
                aborted++
                queueMicrotask(() => tx.abort())
              }
              return tx
            })
          const tx =
            operation === 'insert'
              ? collection.insert({ id: 3, name: 'new' })
              : operation === 'update'
                ? collection.update(1, (row) => {
                    row.name = 'new'
                  })
                : collection.delete(1)
          const outcome = await tx.isPersisted.promise.then(
            () => 'fulfilled',
            () => 'rejected',
          )
          spy.mockRestore()
          expect(aborted).toBe(1)
          expect(outcome).toBe('rejected')
          assertRows(collection.values(), original, 'abort rollback')
          assertRows(
            (await readStore<Row>(h.db, 'items')).rows,
            original,
            'abort durable',
          )
          expect(await readStore(h.db, '_versions')).toEqual(before)
        })
      },
    )
  }
})

for (const remote of ['delete', 'clear'] as const) {
  for (const settle of ['rollback', 'commit'] as const) {
    it('remote ' + remote + ' survives local delete ' + settle, async () => {
      await withHarness(async (h) => {
        await seed(h.db, 'items', original)
        const source = await h.open(),
          receiver = await h.open()
        const tx = createTransaction({
          autoCommit: false,
          mutationFn: async () => {},
        })
        const done = tx.isPersisted.promise.catch(() => undefined)
        tx.mutate(() => receiver.delete(1))
        expect(receiver.has(1), 'pending delete reached').toBe(false)
        if (remote === 'delete') await source.delete(1).isPersisted.promise
        else await source.utils.clearObjectStore()
        expect(
          await Channel.deliver(),
          'receiver path reached',
        ).toBeGreaterThan(0)
        if (settle === 'rollback') tx.rollback()
        else await tx.commit()
        await done
        const expected = remote === 'delete' ? original.slice(1) : []
        assertRows(
          receiver.values(),
          expected,
          'source deletion after local settlement',
        )
        assertRows(
          (await h.open()).values(),
          expected,
          'source deletion restore',
        )
      })
    })
  }
}

it('aborted populated startup rejects preload and reports error', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', original)
    const collection = h.make()
    const start = h.db.db.transaction.bind(h.db.db)
    let aborted = 0
    const spy = vi
      .spyOn(h.db.db, 'transaction')
      .mockImplementation((stores, mode, options) => {
        const tx = start(stores, mode, options)
        aborted++
        queueMicrotask(() => tx.abort())
        return tx
      })
    const outcome = await collection.preload().then(
      () => 'fulfilled',
      () => 'rejected',
    )
    spy.mockRestore()
    expect(aborted).toBe(1)
    expect(outcome, 'startup failure settlement').toBe('rejected')
    expect(collection.status).toBe('error')
    assertRows(
      (await readStore<Row>(h.db, 'items')).rows,
      original,
      'failed restore leaves storage intact',
    )
    assertRows((await h.open()).values(), original, 'healthy startup control')
  })
})

it('read transaction completion precedes successful startup readiness', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', original)
    const start = h.db.db.transaction.bind(h.db.db)
    let didComplete = false
    const spy = vi
      .spyOn(h.db.db, 'transaction')
      .mockImplementation((stores, mode, options) => {
        const tx = start(stores, mode, options)
        tx.addEventListener('complete', () => {
          didComplete = true
        })
        return tx
      })
    const collection = await h.open()
    spy.mockRestore()
    expect(didComplete).toBe(true)
    assertRows(collection.values(), original, 'successful startup')
  })
})

it('retains the previous snapshot when an imported replacement cannot be cloned', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', original)
    const collection = await h.open()
    const before = await readStore(h.db, '_versions')
    await expect(
      collection.utils.importData([
        { id: 3, name: 'valid prefix' },
        { id: 4, name: 'invalid', unsupported: () => {} },
      ]),
    ).rejects.toThrow()
    assertRows(collection.values(), original, 'failed replacement public')
    assertRows(
      (await readStore<Row>(h.db, 'items')).rows,
      original,
      'failed replacement durable',
    )
    expect(await readStore(h.db, '_versions')).toEqual(before)
    expect(Channel.sent).toEqual([])
  })
})
