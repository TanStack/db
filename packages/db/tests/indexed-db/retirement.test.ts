// Ordinary tests for connection retirement. retirement-oracle.test.ts owns the
// native-outcome fold (apply) and the mixed-prefix laws. These scenarios compare
// with literal rows, literal statuses, or the premises that they establish, so
// they are supplemental coverage. Their shared helpers are in
// retirement-support.ts.
import { forceCloseDatabase } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import {
  Channel,
  assertRows,
  deferred,
  readStore,
  seed,
  sorted,
  withHarness,
} from './harness'
import { holdStore, observeTransactions } from './idb-driver'
import {
  close,
  closed,
  initial,
  kinds,
  observe,
  reasons,
  recordStatus,
  start,
} from './retirement-support'
import type { Row } from './harness'

for (const reason of reasons) {
  for (const decision of ['resolve', 'reject'] as const) {
    it(`does not admit a ${decision}d handler after ${reason} closure`, async () => {
      await withHarness(async (h) => {
        await seed(h.db, 'items', initial)
        const decisionGate = deferred()
        h.disposers.push(() => decisionGate.resolve())
        const c = await h.open('items', {
          onUpdate: () => decisionGate.promise,
        })
        const statuses = recordStatus(c)
        const native = observeTransactions(h.db.db)
        h.disposers.push(() => native.restore())
        const caller = observe(start(c, 'update', 1))
        const inspector = await close(h, reason)
        expect(caller.result.state).toBe('pending')
        const failure = new Error('application rejected')
        if (decision === 'resolve') decisionGate.resolve()
        else decisionGate.reject(failure)
        await caller.done
        expect(caller.result.state).toBe('rejected')
        if (decision === 'reject') expect(caller.result.reason).toBe(failure)
        expect(native.entries).toHaveLength(0)
        assertRows(c.values(), initial, 'unadmitted write rolls back')
        assertRows(
          (await readStore<Row>(inspector, 'items')).rows,
          initial,
          'unadmitted disk',
        )
        closed(c, statuses)
        // Utilities bypass Collection mutation admission but cannot bypass the
        // native connection boundary. Late startup also has no read authority.
        for (const kind of ['clear', 'import'] as const)
          await expect(start(c, kind, 1)).rejects.toThrow()
        const late = h.make()
        const lateStatuses = recordStatus(late)
        await expect(late.preload()).rejects.toThrow()
        closed(late, lateStatuses)
        expect(native.entries).toHaveLength(0)
      })
    })
  }
  for (const read of ['initial', 'replacement', 'targeted'] as const) {
    it(`rejects late ${read} publication after ${reason}`, async () => {
      await withHarness(async (h) => {
        await seed(h.db, 'items', initial)
        const c = read === 'initial' ? h.make() : await h.open()
        const statuses = recordStatus(c)
        if (read !== 'initial') {
          const sender = await h.open()
          if (read === 'replacement')
            await sender.utils.importData([{ id: 3, name: 'new snapshot' }])
          else
            await sender
              .update(1, (row) => {
                row.name = 'peer update'
              })
              .when('settled')
        }
        const gate = holdStore(h.db.db)
        h.disposers.push(() => gate.release())
        await gate.started
        const native = observeTransactions(h.db.db)
        h.disposers.push(() => native.restore())
        const loading = read === 'initial' ? observe(c.preload()) : undefined
        while (Channel.pending.length) Channel.dispatch()
        await native.until(() =>
          native.entries.some((entry) => entry.mode === 'readonly'),
        )
        await close(h, reason)
        closed(c, statuses)
        await gate.release()
        await Channel.drain()
        await native.until(() =>
          native.entries.every((entry) => entry.status === 'complete'),
        )
        await loading?.done
        if (loading) expect(loading.result.state).toBe('rejected')
        assertRows(
          c.base.values(),
          read === 'initial' ? [] : initial,
          'obsolete read has no publication authority',
        )
        assertRows(
          c.values(),
          read === 'initial' ? [] : initial,
          'obsolete public snapshot',
        )
        closed(c, statuses)
        const count = native.entries.length
        const injector = new Channel(`tanstack-db:${h.db.name}`)
        injector.postMessage({
          type: 'data-changed',
          database: h.db.name,
          name: 'items',
          tabId: 'later',
          changedKeys: [1],
        })
        injector.close()
        await Channel.drain()
        expect(native.entries).toHaveLength(count)
      })
    })
  }
}

// Retirement is an atomic admission boundary from an application listener's
// perspective. Reentry may start a utility or another Collection while siblings
// have yet to receive their status event; neither can admit native work.
for (const reason of reasons)
  it(`closes native admission before exposing ${reason} retirement`, async () => {
    await withHarness(async (h) => {
      const c = await h.open(),
        sibling = await h.open('other')
      const native = observeTransactions(h.db.db)
      h.disposers.push(() => native.restore())
      const attempts: Array<ReturnType<typeof observe>> = []
      c.on('status:change', ({ status }) => {
        if (status !== 'crashed') return
        attempts.push(
          observe(sibling.utils.importData([{ id: 1, name: 'forbidden' }])),
        )
        const late = h.make()
        const statuses = recordStatus(late)
        const loading = observe(late.preload())
        attempts.push(loading)
        void loading.done.then(() => closed(late, statuses))
      })
      const inspector = await close(h, reason)
      await Promise.all(attempts.map((attempt) => attempt.done))
      expect(attempts).toHaveLength(2)
      expect(attempts.map((attempt) => attempt.result.state)).toEqual([
        'rejected',
        'rejected',
      ])
      expect(native.entries).toHaveLength(0)
      expect([c.status, sibling.status]).toEqual(['crashed', 'crashed'])
      assertRows(
        (await readStore<Row>(inspector, 'other')).rows,
        [],
        'reentrant utility cannot write',
      )
    })
  })

// A late initial read and a locally admitted write can share the same sync run.
// Startup loses read authority on closure; that does not discard the separate
// committed-write obligation. Expected base contains only the authored insert,
// while native storage also retains the pre-existing row that was never restored.
for (const reason of reasons)
  it(`separates initial-read authority from admitted write confirmation after ${reason}`, async () => {
    await withHarness(async (h) => {
      await seed(h.db, 'items', initial)
      const gate = holdStore(h.db.db)
      h.disposers.push(() => gate.release())
      await gate.started
      const c = h.make()
      const statuses = recordStatus(c)
      const loading = observe(c.preload())
      const native = observeTransactions(h.db.db)
      h.disposers.push(() => native.restore())
      const row = { id: 3, name: 'admitted during startup' }
      const caller = observe(c.insert(row).when('settled'), () =>
        sorted(c.base.values()),
      )
      await native.until(() =>
        native.entries.some((entry) => entry.mode === 'readwrite'),
      )
      const inspector = await close(h, reason)
      await gate.release()
      await loading.done
      await caller.done
      expect(loading.result.state).toBe('rejected')
      expect(caller.result.state).toBe('fulfilled')
      assertRows(
        caller.snapshot()!,
        [row],
        'startup write confirms before caller',
      )
      assertRows(
        c.base.values(),
        [row],
        'obsolete initial read never publishes',
      )
      assertRows(
        (await readStore<Row>(inspector, 'items')).rows,
        [...initial, row],
        'native startup write preserves unseen rows',
      )
      closed(c, statuses)
    })
  })

it('ignores the retired database-deleted message protocol before storage work', async () => {
  await withHarness(async (h) => {
    const c = await h.open()
    await seed(h.db, 'items', [{ id: 1, name: 'unseen' }])
    const native = observeTransactions(h.db.db)
    h.disposers.push(() => native.restore())
    const sender = new Channel(`tanstack-db:${h.db.name}`)
    sender.postMessage({
      type: 'database-deleted',
      database: h.db.name,
      name: 'items',
      tabId: 'obsolete',
      changedKeys: [1],
    })
    sender.close()
    await Channel.drain()
    expect(native.entries).toHaveLength(0)
    expect(c.status).toBe('ready')
    assertRows(c.values(), [], 'obsolete message has no authority')
  })
})

// Core reports user status-listener errors on a microtask. Connection closure
// preserves that reporting contract while synchronously notifying every owner.
it('notifies sibling Collections while preserving listener error reporting', async () => {
  await withHarness(async (h) => {
    const first = await h.open(),
      sibling = await h.open('other')
    const failure = new Error('application status listener')
    first.on('status:change', ({ status }) => {
      if (status === 'crashed') throw failure
    })
    const errors: Array<VoidFunction> = []
    const scheduled = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback) => {
        errors.push(callback)
      })
    try {
      expect(() => h.db.close()).not.toThrow()
      expect([first.status, sibling.status]).toEqual(['crashed', 'crashed'])
      expect(errors).toHaveLength(1)
      expect(errors[0]).toThrow(failure)
      await expect(sibling.utils.clearObjectStore()).rejects.toThrow()
      expect(() => h.db.close()).not.toThrow()
    } finally {
      scheduled.mockRestore()
    }
  })
})

// Abnormal native closure differs from ordinary close: the provider aborts
// admitted work. fake-IDB's forceCloseDatabase closes admission but omits the
// spec's forced-abort step. Supply that premise with native transaction.abort(),
// then use its real close path; dispatching an Event alone would be invalid.
// A separate inspector holds storage so both loading and write prefixes reach
// the pending native cut. The model retains committed rows, rejects unfinished
// work, and keeps every attached Collection in error after the close event.
for (const phase of ['idle', 'ready', 'loading', ...kinds] as const) {
  it(`retains committed rows after abnormal native close during ${phase}`, async () => {
    await withHarness(async (h) => {
      await seed(h.db, 'items', initial)
      const inspector = await h.connect()
      const c =
        phase === 'idle' || phase === 'loading' ? h.make() : await h.open()
      const statuses = recordStatus(c)
      const native = observeTransactions(h.db.db)
      h.disposers.push(() => native.restore())
      const gate = holdStore(inspector.db)
      h.disposers.push(() => gate.release())
      await gate.started
      const pending =
        phase === 'loading'
          ? observe(c.preload())
          : phase === 'idle' || phase === 'ready'
            ? undefined
            : observe(start(c, phase, 1))
      if (pending) await native.until(() => native.entries.length > 0)
      const terminated = new Promise<void>((resolve) =>
        h.db.db.addEventListener('close', () => resolve(), { once: true }),
      )
      for (const entry of native.entries) entry.transaction.abort()
      // fake-IDB 6.2.5 incorrectly declares a constructor parameter; its
      // documented runtime API takes the native database instance.
      ;(forceCloseDatabase as unknown as (db: IDBDatabase) => void)(h.db.db)
      await gate.release()
      await terminated
      expect(() => h.db.db.transaction('items')).toThrow()
      if (pending) {
        await pending.done
        expect(pending.result.state).toBe('rejected')
        expect(native.entries.map((entry) => entry.status)).toEqual(['abort'])
      }
      if (phase === 'idle') await expect(c.preload()).rejects.toThrow()
      closed(c, statuses)
      assertRows(
        c.values(),
        phase === 'idle' || phase === 'loading' ? [] : initial,
        'retained public snapshot',
      )
      assertRows(
        (await readStore<Row>(inspector, 'items')).rows,
        initial,
        'aborted work cannot change disk',
      )
      const fresh = await h.open('items', { db: inspector })
      assertRows(
        fresh.values(),
        initial,
        'new descriptor restores committed rows',
      )
    })
  })
}
