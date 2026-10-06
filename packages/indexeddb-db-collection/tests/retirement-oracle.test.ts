/**
 * Connection closure ends read/admission authority, not native transactions or
 * accepted sync obligations. This is the production refinement owner for the
 * finish policy in review-evidence/deletion-tla/retirement_oracle.tla.
 *
 * The independent model folds authored row operations only when the native
 * outcome commits. Each operation owns a different Collection on one shared
 * descriptor. Its local confirmation describes its own write; it need not
 * observe another Collection after closure. Disk follows native FIFO admission.
 * A closed Collection stays errored at every status event and caller checkpoint.
 *
 * Grammar: all pairs of insert/update/delete/clear/import, both native admission
 * orders, both native outcomes per operation, and explicit/upgrade/delete close.
 * Additional histories put closure before admission, between native commit and
 * confirmation, after sync acceptance, and during initial/replacement/key reads.
 * Native gates issue real requests; no IndexedDB transaction awaits a test gate.
 * These finite schedules cover the semantic cuts, not every TLC interleaving.
 */
import { createTransaction } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { deleteDatabase } from '../src'
import {
  Channel,
  assertRows,
  deferred,
  readStore,
  request,
  seed,
  sorted,
  withHarness,
} from './harness'
import { holdStore, observeTransactions } from './idb-driver'
import type { Row } from './harness'

type Harness = Parameters<Parameters<typeof withHarness>[0]>[0]
type Subject = ReturnType<Harness['make']>
type Kind = 'insert' | 'update' | 'delete' | 'clear' | 'import'
type Reason = 'explicit' | 'upgrade' | 'delete'
const kinds: Array<Kind> = ['insert', 'update', 'delete', 'clear', 'import']
const reasons: Array<Reason> = ['explicit', 'upgrade', 'delete']
const initial: Array<Row> = [
  { id: 1, name: 'one' },
  { id: 2, name: 'two' },
  { id: 'anchor', name: 'anchor' },
]

// Row truth comes from the authored operation and outcome, not adapter caches,
// confirmation messages, or Collection output. Native abort is the identity.
function apply(rows: Array<Row>, kind: Kind, owner: number): Array<Row> {
  const row = {
    id: kind === 'insert' ? `new-${owner}` : owner,
    name: `after-${owner}`,
  }
  if (kind === 'clear') return []
  if (kind === 'import') return [row]
  if (kind === 'delete') return rows.filter((value) => value.id !== owner)
  return [...rows.filter((value) => value.id !== row.id), row]
}
function observe(
  promise: Promise<unknown>,
  capture: () => Array<Row> = () => [],
) {
  let atSettlement: Array<Row> | undefined
  const result: {
    state: 'pending' | 'fulfilled' | 'rejected'
    reason?: unknown
  } = { state: 'pending' }
  const done = promise.then(
    () => {
      atSettlement = capture()
      result.state = 'fulfilled'
    },
    (reason: unknown) => {
      atSettlement = capture()
      result.state = 'rejected'
      result.reason = reason
    },
  )
  return { result, done, snapshot: () => atSettlement }
}
function start(c: Subject, kind: Kind, owner: number): Promise<unknown> {
  if (kind === 'clear') return c.utils.clearObjectStore()
  if (kind === 'import') return c.utils.importData(apply([], kind, owner))
  if (kind === 'insert')
    return c.insert(apply([], kind, owner)[0]!).isPersisted.promise
  if (kind === 'delete') return c.delete(owner).isPersisted.promise
  return c.update(owner, (row) => {
    row.name = `after-${owner}`
  }).isPersisted.promise
}
function recordStatus(c: Subject) {
  const statuses: Array<string> = []
  c.on('status:change', ({ status }) => {
    statuses.push(status)
  })
  return statuses
}
function closed(c: Subject, statuses: Array<string>) {
  expect.soft(c.status, 'closed connection status').toBe('error')
  const firstError = statuses.indexOf('error')
  expect.soft(firstError, 'retirement is observable').toBeGreaterThanOrEqual(0)
  expect
    .soft(
      statuses.slice(firstError).every((status) => status === 'error'),
      'retired status stays error',
    )
    .toBe(true)
}

// An unmanaged connection permits independent durable reads while a native
// upgrade/delete is blocked. Administrative success owns no Collection writes.
async function close(h: Harness, reason: Reason) {
  const inspector = await request(indexedDB.open(h.db.name, 1))
  let administrative: Promise<unknown> = Promise.resolve()
  h.disposers.push(async () => {
    inspector.close()
    await administrative
  })
  if (reason === 'explicit') h.db.close()
  else {
    const announced = deferred()
    h.db.db.addEventListener('versionchange', () => announced.resolve(), {
      once: true,
    })
    administrative =
      reason === 'delete'
        ? deleteDatabase(h.db.name)
        : request(indexedDB.open(h.db.name, 2)).then((db) => db.close())
    await announced.promise
  }
  return { ...h.db, db: inspector }
}

const pairCells = kinds.flatMap((first) =>
  kinds.flatMap((second) =>
    reasons.flatMap((reason) =>
      [false, true].map((reverse) => ({ first, second, reason, reverse })),
    ),
  ),
)
describe('admitted native writes retain their actual outcome after closure', () => {
  it.each(pairCells)('%j', async ({ first, second, reason, reverse }) => {
    // Both queued aborts and FIFO commits are reachable, including abort of the
    // later transaction before the earlier transaction finishes.
    for (const outcomes of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]) {
      await withHarness(async (h) => {
        await seed(h.db, 'items', initial)
        const subjects = [await h.open(), await h.open()]
        const statuses = subjects.map(recordStatus)
        const gate = holdStore(h.db.db)
        h.disposers.push(() => gate.release())
        await gate.started
        const native = observeTransactions(h.db.db)
        h.disposers.push(() => native.restore())
        const order = reverse ? [1, 0] : [0, 1]
        const operations = [first, second]
        const publications: Array<{
          slot: number
          rows: Array<Row>
          native: string
        }> = []
        subjects.forEach((c, slot) => {
          const subscription = c.subscribeChanges(() => {
            publications.push({
              slot,
              rows: sorted(c.base.values()),
              native:
                native.entries[order.indexOf(slot)]?.status ?? 'notAdmitted',
            })
          })
          h.disposers.push(() => subscription.unsubscribe())
        })
        const callers: Array<ReturnType<typeof observe>> = []
        const nativeAtCaller: Array<string> = []
        for (const slot of order) {
          callers[slot] = observe(
            start(subjects[slot]!, operations[slot]!, slot + 1),
            () => {
              nativeAtCaller[slot] = native.entries[order.indexOf(slot)]!.status
              return sorted(subjects[slot]!.base.values())
            },
          )
          await vi.waitFor(() =>
            expect(native.entries.length).toBe(callers.filter(Boolean).length),
          )
        }
        expect(
          native.entries.every((entry) => entry.status === 'pending'),
        ).toBe(true)
        expect(callers.map((c) => c.result.state)).toEqual([
          'pending',
          'pending',
        ])
        const inspector = await close(h, reason)
        subjects.forEach((c, i) => closed(c, statuses[i]!))
        for (const slot of [...order].reverse()) {
          if (!outcomes[slot])
            native.entries[order.indexOf(slot)]!.transaction.abort()
        }
        await gate.release()
        await Promise.all(callers.map((c) => c.done))
        let durable = initial
        for (const slot of order)
          if (outcomes[slot])
            durable = apply(durable, operations[slot]!, slot + 1)
        for (const slot of [0, 1]) {
          const expected = outcomes[slot]
            ? apply(initial, operations[slot]!, slot + 1)
            : initial
          expect(
            callers[slot]!.result.state,
            'caller follows native commit/abort',
          ).toBe(outcomes[slot] ? 'fulfilled' : 'rejected')
          // abort() makes rollback irreversible before the asynchronous abort
          // event. A callback rejection may therefore precede that event.
          if (outcomes[slot])
            expect(
              nativeAtCaller[slot],
              'native commit at caller success',
            ).toBe('complete')
          else
            expect(
              nativeAtCaller[slot],
              'rejected caller cannot report a commit',
            ).not.toBe('complete')
          expect(native.entries[order.indexOf(slot)]!.status).toBe(
            outcomes[slot] ? 'complete' : 'abort',
          )
          assertRows(
            callers[slot]!.snapshot()!,
            expected,
            'source at caller settlement',
          )
          assertRows(
            subjects[slot]!.base.values(),
            expected,
            'confirmation before caller success',
          )
          assertRows(
            subjects[slot]!.values(),
            expected,
            'optimistic state settled',
          )
          closed(subjects[slot]!, statuses[slot]!)
        }
        assertRows(
          (await readStore<Row>(inspector, 'items')).rows,
          durable,
          'native FIFO fold',
        )
        for (const publication of publications) {
          assertRows(
            publication.rows,
            publication.native === 'complete'
              ? apply(
                  initial,
                  operations[publication.slot]!,
                  publication.slot + 1,
                )
              : initial,
            'only committed writes publish authoritative base',
          )
        }
        expect(native.entries).toHaveLength(2)
      })
    }
  })
})

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
  for (const kind of ['insert', 'update', 'delete'] as const) {
    it(`publishes accepted ${kind} before caller settlement after ${reason}`, async () => {
      await withHarness(async (h) => {
        await seed(h.db, 'items', initial)
        const c = await h.open()
        const statuses = recordStatus(c)
        const accepted = deferred(),
          finish = deferred()
        h.disposers.push(() => finish.resolve())
        const tx = createTransaction({
          mutationFn: async ({ transaction }) => {
            await c.utils.acceptMutations(transaction)
            accepted.resolve()
            await finish.promise
          },
        })
        tx.mutate(() => {
          void start(c, kind, 1)
        })
        const caller = observe(tx.isPersisted.promise, () =>
          sorted(c.base.values()),
        )
        await accepted.promise
        assertRows(c.base.values(), initial, 'accepted source remains queued')
        expect(caller.result.state).toBe('pending')
        const inspector = await close(h, reason)
        assertRows(
          (await readStore<Row>(inspector, 'items')).rows,
          apply(initial, kind, 1),
          'native already committed',
        )
        closed(c, statuses)
        finish.resolve()
        await caller.done
        expect(caller.result.state).toBe('fulfilled')
        assertRows(
          caller.snapshot()!,
          apply(initial, kind, 1),
          'accepted work precedes caller',
        )
        assertRows(
          c.base.values(),
          apply(initial, kind, 1),
          'accepted work survives closure',
        )
        assertRows(
          c.values(),
          apply(initial, kind, 1),
          'confirmation and optimistic drop',
        )
        closed(c, statuses)
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
            await sender.update(1, (row) => {
              row.name = 'peer update'
            }).isPersisted.promise
        }
        const gate = holdStore(h.db.db)
        h.disposers.push(() => gate.release())
        await gate.started
        const native = observeTransactions(h.db.db)
        h.disposers.push(() => native.restore())
        const loading = read === 'initial' ? observe(c.preload()) : undefined
        while (Channel.pending.length) Channel.dispatch()
        await vi.waitFor(() =>
          expect(
            native.entries.some((entry) => entry.mode === 'readonly'),
          ).toBe(true),
        )
        await close(h, reason)
        closed(c, statuses)
        await gate.release()
        await Channel.drain()
        await vi.waitFor(() =>
          expect(
            native.entries.every((entry) => entry.status === 'complete'),
          ).toBe(true),
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

for (const kind of kinds) {
  it(`confirms native-committed ${kind} if explicit close precedes its continuation`, async () => {
    await withHarness(async (h) => {
      await seed(h.db, 'items', initial)
      const c = await h.open()
      const statuses = recordStatus(c)
      const raw = h.db.db.transaction.bind(h.db.db)
      // A real native complete listener, installed before the wrapper listener,
      // can call the public close method. No arbitrary task/microtask gap is
      // invented between an automatic handler and its continuation.
      vi.spyOn(h.db.db, 'transaction').mockImplementation((...args) => {
        const tx = raw(...args)
        if (tx.mode === 'readwrite')
          tx.addEventListener('complete', () => h.db.close(), { once: true })
        return tx
      })
      await start(c, kind, 1)
      assertRows(
        c.base.values(),
        apply(initial, kind, 1),
        'finish committed confirmation',
      )
      closed(c, statuses)
      const freshDb = await h.connect()
      assertRows(
        (await readStore<Row>(freshDb, 'items')).rows,
        apply(initial, kind, 1),
        'committed disk',
      )
      const fresh = await h.open('items', { db: freshDb })
      assertRows(fresh.values(), apply(initial, kind, 1), 'fresh restore')
    })
  })
}

// Asymmetric prefixes retain the model's per-operation independence. One
// Collection may already have accepted/settled while another is deciding or
// natively pending. Utilities have no asynchronous application handler and no
// accepted-but-unpublished interval; those abstract TLA steps collapse into
// their call/native-completion continuation. Ordinary manual handlers expose
// the accepted interval through a real public API.
const prefixes = kinds.flatMap((kind) =>
  (kind === 'clear' || kind === 'import'
    ? (['active', 'settled'] as const)
    : (['deciding', 'rejected', 'active', 'accepted', 'settled'] as const)
  ).map((prefix) => ({ kind, prefix })),
)
const mixedCells = prefixes.flatMap((a) =>
  prefixes
    .filter((b) => b.prefix !== 'active' || a.prefix !== 'active')
    .flatMap((b) =>
      reasons.flatMap((reason) =>
        (a.prefix === 'active' || b.prefix === 'active'
          ? [false, true]
          : [false]
        ).map((abort) => ({ a, b, reason, abort })),
      ),
    ),
)
it.each(mixedCells)(
  'retains independent operation prefixes at closure: %j',
  async ({ a, b, reason, abort }) => {
    await withHarness(async (h) => {
      await seed(h.db, 'items', initial)
      const operations = [a, b]
      const decisions = [deferred(), deferred()]
      const finishes = [deferred(), deferred()]
      h.disposers.push(() => {
        decisions.forEach((g) => g.resolve())
        finishes.forEach((g) => g.resolve())
      })
      const subjects = await Promise.all(
        operations.map((op, slot) => {
          const handler = async () => {
            if (op.prefix === 'deciding') await decisions[slot]!.promise
            if (op.prefix === 'rejected') throw new Error('authored rejection')
          }
          return h.open('items', {
            onInsert: handler,
            onUpdate: handler,
            onDelete: handler,
          })
        }),
      )
      const statuses = subjects.map(recordStatus)
      const native = observeTransactions(h.db.db)
      h.disposers.push(() => native.restore())
      const callers: Array<ReturnType<typeof observe>> = []
      let durable = initial
      const capture = (slot: number) => () =>
        sorted(subjects[slot]!.base.values())
      // Complete native work first; the later gate must not block a requested
      // pre-closure native commit. Reverse owner order in half the cells to avoid
      // equating Collection identity with storage ordering.
      const order = a.kind < b.kind ? [0, 1] : [1, 0]
      for (const slot of order) {
        const op = operations[slot]!,
          c = subjects[slot]!
        if (op.prefix === 'settled' || op.prefix === 'rejected') {
          callers[slot] = observe(start(c, op.kind, slot + 1), capture(slot))
          await callers[slot].done
          expect(callers[slot].result.state).toBe(
            op.prefix === 'settled' ? 'fulfilled' : 'rejected',
          )
          if (op.prefix === 'settled')
            durable = apply(durable, op.kind, slot + 1)
        } else if (op.prefix === 'accepted') {
          const accepted = deferred()
          const tx = createTransaction({
            mutationFn: async ({ transaction }) => {
              await c.utils.acceptMutations(transaction)
              accepted.resolve()
              await finishes[slot]!.promise
            },
          })
          tx.mutate(() => {
            void start(c, op.kind, slot + 1)
          })
          callers[slot] = observe(tx.isPersisted.promise, capture(slot))
          await accepted.promise
          durable = apply(durable, op.kind, slot + 1)
          assertRows(
            c.base.values(),
            initial,
            'accepted work remains queued before closure',
          )
        }
      }
      const gate = holdStore(h.db.db)
      h.disposers.push(() => gate.release())
      await gate.started
      const beforeAdmission = native.entries.length
      for (const slot of order) {
        const op = operations[slot]!
        if (op.prefix === 'active' || op.prefix === 'deciding')
          callers[slot] = observe(
            start(subjects[slot]!, op.kind, slot + 1),
            capture(slot),
          )
      }
      const activeCount = operations.filter(
        (op) => op.prefix === 'active',
      ).length
      await vi.waitFor(() =>
        expect(native.entries.length).toBe(beforeAdmission + activeCount),
      )
      for (const slot of [0, 1])
        expect(callers[slot]!.result.state).toBe(
          operations[slot]!.prefix === 'settled'
            ? 'fulfilled'
            : operations[slot]!.prefix === 'rejected'
              ? 'rejected'
              : 'pending',
        )
      const inspector = await close(h, reason)
      if (abort)
        for (const entry of native.entries.slice(beforeAdmission))
          entry.transaction.abort()
      subjects.forEach((c, slot) => closed(c, statuses[slot]!))
      // Release a later caller first as well as an earlier one. The sibling's
      // application handler does not own this Collection's accepted source work.
      finishes[1]!.resolve()
      finishes[0]!.resolve()
      if (b.prefix === 'deciding')
        decisions[1]!.reject(new Error('application rejection'))
      else decisions[1]!.resolve()
      decisions[0]!.resolve()
      await gate.release()
      await Promise.all(callers.map((caller) => caller.done))
      for (const slot of order)
        if (operations[slot]!.prefix === 'active' && !abort)
          durable = apply(durable, operations[slot]!.kind, slot + 1)
      for (const slot of [0, 1]) {
        const op = operations[slot]!
        const success =
          op.prefix !== 'deciding' &&
          op.prefix !== 'rejected' &&
          !(op.prefix === 'active' && abort)
        expect(callers[slot]!.result.state).toBe(
          success ? 'fulfilled' : 'rejected',
        )
        const rows = success ? apply(initial, op.kind, slot + 1) : initial
        assertRows(
          callers[slot]!.snapshot()!,
          rows,
          'independent confirmation at caller settlement',
        )
        assertRows(
          subjects[slot]!.values(),
          rows,
          'independent final public snapshot',
        )
        closed(subjects[slot]!, statuses[slot]!)
      }
      assertRows(
        (await readStore<Row>(inspector, 'items')).rows,
        durable,
        'mixed native FIFO fold',
      )
      expect(native.entries).toHaveLength(beforeAdmission + activeCount)
    })
  },
)

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
        if (status !== 'error') return
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
      expect([c.status, sibling.status]).toEqual(['error', 'error'])
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
      const caller = observe(c.insert(row).isPersisted.promise, () =>
        sorted(c.base.values()),
      )
      await vi.waitFor(() =>
        expect(native.entries.some((entry) => entry.mode === 'readwrite')).toBe(
          true,
        ),
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
      if (status === 'error') throw failure
    })
    const errors: Array<VoidFunction> = []
    const scheduled = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback) => {
        errors.push(callback)
      })
    try {
      expect(() => h.db.close()).not.toThrow()
      expect([first.status, sibling.status]).toEqual(['error', 'error'])
      expect(errors).toHaveLength(1)
      expect(errors[0]).toThrow(failure)
      await expect(sibling.utils.clearObjectStore()).rejects.toThrow()
      expect(() => h.db.close()).not.toThrow()
    } finally {
      scheduled.mockRestore()
    }
  })
})
