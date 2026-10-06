/**
 * Administrative delete-by-name follows the native connection queue. Its
 * receipt has no Collection publication authority, even across recreation and
 * a second blocked deletion. This refines deletion_queue_oracle.tla: lifetimes
 * A/B below are test identities only, never stored database metadata.
 *
 * The grammar crosses old transaction/blocker release order with old receipt
 * delivery before recreation, after recreation, during B's blocked deletion,
 * and after B's deletion. Wrapper success callbacks can be withheld after real
 * native success; this models delivery delay, not a claim about browser tasks.
 * Every checkpoint checks native/caller outcome separately, retained public
 * rows, and sticky error status. Native blockers and writes are real IDB work.
 */
import { expect, it, vi } from 'vitest'
import { deleteDatabase } from '../src'
import {
  Channel,
  assertRows,
  deferred,
  readStore,
  request,
  seed,
  withHarness,
} from './harness'
import { holdStore } from './idb-driver'
import type { Row } from './harness'

// fake-indexeddb 6.2.5 treats close-pending as closed in FDBFactory's
// waitForOthersClosedDelete. It cannot enforce the transaction-only hold after
// releasing the unmanaged connection. The browser receiving owner runs BOTH
// release orders; this owner retains the unmanaged blocker until native work ends.
const cells = [
  'before-recreate',
  'after-recreate',
  'second-blocked',
  'second-native',
  'after-second',
].map((receiptCut) => ({ receiptCut }))
it.each(cells)(
  'administrative deletion has no row authority: %j',
  async ({ receiptCut }) => {
    await withHarness(async (h) => {
      const a = [{ id: 1, name: 'A' }],
        b = [{ id: 2, name: 'B' }]
      await seed(h.db, 'items', a)
      const old = await h.open()
      const oldStatuses: Array<string> = []
      const oldRows: Array<Array<Row>> = []
      old.on('status:change', ({ status }) => {
        oldStatuses.push(status)
      })
      const oldSubscription = old.subscribeChanges(() => {
        oldRows.push([...old.values()])
      })
      h.disposers.push(() => oldSubscription.unsubscribe())
      const blockerA = await request(indexedDB.open(h.db.name, 1))
      const gate = holdStore(h.db.db)
      await gate.started
      const receipts = [deferred(), deferred()]
      const nativeDone = [deferred(), deferred()]
      const blocked = [deferred(), deferred()]
      const settled = [false, false]
      const nativeSucceeded = [false, false]
      let gateComplete = false
      void gate.finished.then(() => {
        gateComplete = true
      })
      const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB)
      let count = 0
      vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name) => {
        const slot = count++
        const req = nativeDelete(name)
        let callback: ((this: IDBRequest, event: Event) => unknown) | null =
          null
        Object.defineProperty(req, 'onsuccess', {
          get: () => callback,
          set: (value) => {
            callback = value
          },
          configurable: true,
        })
        req.addEventListener('blocked', () => blocked[slot]!.resolve())
        req.addEventListener('success', (event) => {
          nativeSucceeded[slot] = true
          nativeDone[slot]!.resolve()
          void receipts[slot]!.promise.then(() => callback?.call(req, event))
        })
        return req
      })
      const first = deleteDatabase(h.db.name).then(() => {
        settled[0] = true
      })
      // eslint-disable-next-line prefer-const -- cleanup is registered before these resources exist
      let second: Promise<void> | undefined, blockerB: IDBDatabase | undefined
      h.disposers.push(async () => {
        await gate.release()
        blockerA.close()
        blockerB?.close()
        receipts.forEach((receipt) => receipt.resolve())
        await first
        await second
      })
      await blocked[0]!.promise
      expect.soft(old.status).toBe('error')
      assertRows(old.values(), a, 'announced deletion retains A')
      expect(settled).toEqual([false, false])
      expect(nativeSucceeded).toEqual([false, false])
      await gate.release()
      expect(gateComplete).toBe(true)
      expect(settled[0], 'blocker alone prevents caller success').toBe(false)
      expect(nativeSucceeded[0], 'blocker prevents native success').toBe(false)
      assertRows(
        (await readStore<Row>({ ...h.db, db: blockerA }, 'items')).rows,
        a,
        'A still exists while blocked',
      )
      blockerA.close()
      await nativeDone[0]!.promise
      expect(
        settled[0],
        'native success and caller delivery are distinct',
      ).toBe(false)
      if (receiptCut === 'before-recreate') {
        receipts[0]!.resolve()
        await first
      }
      const freshDb = await h.connect()
      await seed(freshDb, 'items', b)
      const fresh = await h.open('items', { db: freshDb })
      const freshStatuses: Array<string> = []
      const freshRows: Array<Array<Row>> = []
      fresh.on('status:change', ({ status }) => {
        freshStatuses.push(status)
      })
      const freshSubscription = fresh.subscribeChanges(() => {
        freshRows.push([...fresh.values()])
      })
      h.disposers.push(() => freshSubscription.unsubscribe())
      blockerB = await request(indexedDB.open(h.db.name, 1))
      if (receiptCut === 'after-recreate') {
        receipts[0]!.resolve()
        await first
      }
      await Channel.drain()
      assertRows(fresh.values(), b, 'old receipt after recreation')
      second = deleteDatabase(h.db.name).then(() => {
        settled[1] = true
      })
      await blocked[1]!.promise
      if (receiptCut === 'second-blocked') {
        receipts[0]!.resolve()
        await first
      }
      await Channel.drain()
      expect(settled[1], 'newer deletion still blocked').toBe(false)
      expect(nativeSucceeded[1], 'B blocker prevents native success').toBe(
        false,
      )
      expect.soft(fresh.status).toBe('error')
      assertRows(fresh.values(), b, 'B retained while newer deletion blocked')
      assertRows(
        (await readStore<Row>({ ...freshDb, db: blockerB }, 'items')).rows,
        b,
        'B native rows survive old receipt',
      )
      blockerB.close()
      await nativeDone[1]!.promise
      expect(settled[1]).toBe(false)
      if (receiptCut === 'second-native') {
        receipts[0]!.resolve()
        await first
      }
      assertRows(
        fresh.values(),
        b,
        'B retained after native completion before caller',
      )
      expect.soft(fresh.status).toBe('error')
      receipts[1]!.resolve()
      await second
      receipts[0]!.resolve()
      await first
      await Channel.drain()
      expect(settled).toEqual([true, true])
      assertRows(old.values(), a, 'A receipt never empties A')
      assertRows(fresh.values(), b, 'B receipt never empties B')
      expect.soft([old.status, fresh.status]).toEqual(['error', 'error'])
      expect.soft(oldStatuses).toEqual(['error'])
      expect.soft(freshStatuses).toEqual(['error'])
      for (const rows of oldRows) assertRows(rows, a, 'every A publication')
      for (const rows of freshRows) assertRows(rows, b, 'every B publication')
      // A fresh open proves native deletion did occur. Retained Collection rows
      // are an errored snapshot, not a claim that deleted rows remain durable.
      const restored = await h.connect()
      assertRows(
        (await readStore<Row>(restored, 'items')).rows,
        [],
        'second deletion reached recreated name',
      )
      expect(Channel.sent).toEqual([])
    })
  },
)

// The TLA Recreate action combines native opens and initial restore. This
// separate projection tests the queue-target claim without requiring that
// restore finish before the next native versionchange task. Both deletes are
// invoked during A; the intervening queued open creates B, which receives the
// second delete's versionchange. No original descriptor binds a native name.
it('a delete queued during A can delete the intervening recreated B', async () => {
  await withHarness(async (h) => {
    const old = await h.open()
    const blocker = await request(indexedDB.open(h.db.name, 1))
    const gate = holdStore(h.db.db)
    await gate.started
    const first = deleteDatabase(h.db.name)
    const opening = indexedDB.open(h.db.name, 1)
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore('items').put({ id: 2, name: 'B' }, 2)
    }
    const target = deferred()
    opening.addEventListener('success', () => {
      opening.result.addEventListener('versionchange', (event) => {
        expect(event.newVersion).toBe(null)
        target.resolve()
      })
    })
    const recreated = request(opening)
    const second = deleteDatabase(h.db.name)
    let b: IDBDatabase | undefined
    h.disposers.push(async () => {
      await gate.release()
      blocker.close()
      b?.close()
      await first
      b ??= await recreated
      b.close()
      await second
    })
    expect.soft(old.status).toBe('ready') // native announcement is still a task
    await gate.release()
    blocker.close()
    await first
    b = await recreated
    await target.promise
    assertRows(
      (await readStore<Row>({ ...h.db, db: b }, 'items')).rows,
      [{ id: 2, name: 'B' }],
      'second delete targets B',
    )
    b.close()
    await second
    const fresh = await h.connect()
    assertRows(
      (await readStore<Row>(fresh, 'items')).rows,
      [],
      'B was natively deleted',
    )
    expect.soft(old.status).toBe('error')
  })
})

// Release-before-announcement is a legal prefix too. With no unmanaged blocker
// or admitted transaction left, native deletion still retires the managed
// Collection and has no authority to publish an empty replacement.
it('retains errored snapshots when all obligations finish before announcement', async () => {
  await withHarness(async (h) => {
    const rows = [{ id: 1, name: 'retained snapshot' }]
    await seed(h.db, 'items', rows)
    const c = await h.open()
    const blocker = await request(indexedDB.open(h.db.name, 1))
    const gate = holdStore(h.db.db)
    await gate.started
    await gate.release()
    blocker.close()
    await deleteDatabase(h.db.name)
    expect(c.status).toBe('error')
    assertRows(c.values(), rows, 'unblocked deletion retains snapshot')
    const fresh = await h.connect()
    assertRows(
      (await readStore<Row>(fresh, 'items')).rows,
      [],
      'unblocked deletion is durable',
    )
  })
})
