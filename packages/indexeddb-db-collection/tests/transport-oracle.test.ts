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
 * Collection is idle or cleaned-up. Deleting a database clears every active
 * Collection over its stores; reopening requires a fresh database descriptor.
 * These are bounded controlled histories, not browser scheduling evidence.
 */
import { createCollection, createTransaction } from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { createIndexedDB, indexedDBCollectionOptions } from '../src'
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
    // A raw provider write creates a distinguishing observation: incorrectly
    // consuming an excluded notification would add this unseen row. Equal
    // durable/public snapshots could let a missing exclusion pass unnoticed.
    await seed(h.db, 'items', [{ id: 2, name: 'excluded source row' }])
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
            type: 'data-changed',
            changedKeys: [2],
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

// The reference applies completed storage operations in their authored order:
// replacement removes prior rows, then the later disjoint insertion adds one.
// Notification order may change how the receiver learns that result, not which
// durable rows exist after every message has been delivered. Each replacement
// kind crosses FIFO, reverse and duplicate delivery; the latter two are stronger
// controlled transport challenges, not claims about native BroadcastChannel.
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
          const expected =
            replacement === 'clear' ? [inserted] : [imported, inserted]
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

// A utility does not require a subscriber or active sync run. The independent
// before/after arrays define its durable replacement, and an already active
// peer must learn the same result. Creating a Collection or completing cleanup
// controls the missing-channel premise without mutating adapter internals.
for (const status of ['idle', 'cleaned-up'] as const) {
  for (const replacement of ['clear', 'import'] as const) {
    it(
      'publishes ' + replacement + ' from a ' + status + ' Collection',
      async () => {
        await withHarness(async (h) => {
          await seed(h.db, 'items', [{ id: 'old', name: 'before' }])
          const receiver = await h.open()
          const writer = h.make()
          if (status === 'cleaned-up') {
            await writer.preload()
            await writer.cleanup()
          }
          expect(writer.status, 'utility entry lifecycle').toBe(status)
          const expected =
            replacement === 'clear' ? [] : [{ id: 'new', name: 'replacement' }]
          if (replacement === 'clear') await writer.utils.clearObjectStore()
          else await writer.utils.importData(expected)
          const delivered = await Channel.deliver()
          assertRows(
            (await readStore<Row>(h.db, 'items')).rows,
            expected,
            'utility durable snapshot',
          )
          assertRows(
            (await h.open()).values(),
            expected,
            'utility fresh restore',
          )
          assertRows(receiver.values(), expected, 'active peer after utility')
          expect(
            delivered,
            'utility notification reached the peer',
          ).toBeGreaterThan(0)
        })
      },
    )
  }
}

// Authorship starts a Collection sync run, so a real manual transaction cannot
// be authored by its owning Collection while keeping that Collection initially
// idle. Instead author while ready, clean up, then accept through the manual
// transaction's ordinary mutationFn. Cleanup retires the sync run, not the
// independently owned transaction or its later durable acceptance.
it('publishes manual acceptance after the writer sync run is cleaned up', async () => {
  await withHarness(async (h) => {
    const receiver = await h.open()
    const writer = await h.open()
    const row = { id: 'accepted', name: 'after cleanup' }
    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: ({ transaction: pending }) =>
        writer.utils.acceptMutations(pending),
    })
    transaction.mutate(() => writer.insert(row))
    await writer.cleanup()
    expect(writer.status, 'manual acceptance entry lifecycle').toBe(
      'cleaned-up',
    )
    await transaction.commit()
    await transaction.isPersisted.promise
    const delivered = await Channel.deliver()
    assertRows(
      (await readStore<Row>(h.db, 'items')).rows,
      [row],
      'manual acceptance durable snapshot',
    )
    assertRows((await h.open()).values(), [row], 'manual acceptance restore')
    assertRows(receiver.values(), [row], 'active peer after manual acceptance')
    expect(
      delivered,
      'acceptance notification reached the peer',
    ).toBeGreaterThan(0)
  })
})

// Database deletion has wider authority than store replacement. The model is
// empty rows in every declared store. Independent native reads and fresh
// Collections use a newly opened descriptor because the deleted connection is
// closed. Existing Collections are checked at delivered deletion, without
// attempting further persistence through their obsolete descriptor.
it('publishes database deletion to active Collections in every store', async () => {
  await withHarness(async (h) => {
    await seed(h.db, 'items', [{ id: 'item', name: 'removed item' }])
    await seed(h.db, 'other', [{ id: 'other', name: 'removed sibling' }])
    const source = await h.open()
    const sameStore = await h.open()
    const sibling = await h.open('other')
    await source.utils.deleteDatabase()
    expect(
      await Channel.deliver(),
      'deletion reached active peers',
    ).toBeGreaterThan(0)
    const fresh = await createIndexedDB({
      name: h.db.name,
      version: 1,
      stores: ['items', 'other'],
    })
    try {
      for (const name of ['items', 'other']) {
        assertRows(
          (await readStore<Row>(fresh, name)).rows,
          [],
          'deleted durable store ' + name,
        )
        const restored = createCollection(
          indexedDBCollectionOptions<Row>({
            db: fresh,
            name,
            getKey: (row) => row.id,
          }),
        )
        try {
          await restored.preload()
          assertRows(restored.values(), [], 'deleted fresh restore ' + name)
        } finally {
          await restored.cleanup()
        }
      }
      assertRows(source.values(), [], 'deletion originating Collection')
      assertRows(sameStore.values(), [], 'deletion same-store peer')
      assertRows(sibling.values(), [], 'deletion sibling-store peer')
    } finally {
      fresh.close()
    }
  })
})

// Ported settlement law: a native blocked event is nonterminal. The authored
// before/after snapshots distinguish provider completion, caller settlement and
// publication. A real fake-IDB connection holds deletion; no timer decides the
// checkpoint. Native browser lock scheduling and cancellation are outside this
// owner. The existing unblocked deletion case is the successful control.
it('retains every public snapshot and sends no deletion before native deletion succeeds', async () => {
  await withHarness(async (h) => {
    const item = { id: 'item', name: 'retained until deletion' }
    const other = { id: 'other', name: 'sibling retained until deletion' }
    await seed(h.db, 'items', [item])
    await seed(h.db, 'other', [other])
    const source = await h.open()
    const peer = await h.open()
    const sibling = await h.open('other')
    const blocker = await request(indexedDB.open(h.db.name, 1))
    const blocked = deferred()
    const terminal = deferred()
    const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB)
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((...args) => {
      const nativeRequest = nativeDelete(...args)
      nativeRequest.addEventListener('blocked', () => blocked.resolve())
      nativeRequest.addEventListener('success', () => terminal.resolve())
      nativeRequest.addEventListener('error', () =>
        terminal.reject(nativeRequest.error ?? new Error('delete failed')),
      )
      return nativeRequest
    })
    let status = 'pending'
    const outcome = source.utils.deleteDatabase().then(
      () => {
        status = 'fulfilled'
      },
      () => {
        status = 'rejected'
      },
    )
    try {
      await blocked.promise
      // The independent read also drains promise reactions after blocked.
      const durable = await readStore<Row>({ ...h.db, db: blocker }, 'items')
      const before = {
        status,
        sent: Channel.sent.length,
        rows: [source, peer, sibling].map((collection) =>
          sorted(collection.values()),
        ),
      }
      blocker.close()
      await terminal.promise
      await outcome
      await Channel.deliver()
      expect(before, 'blocked deletion settlement and publication').toEqual({
        status: 'pending',
        sent: 0,
        rows: [[item], [item], [other]],
      })
      assertRows(durable.rows, [item], 'blocked deletion durable snapshot')
      expect(status, 'native deletion acknowledged to caller').toBe('fulfilled')
      for (const collection of [source, peer, sibling])
        assertRows(collection.values(), [], 'native deletion published')
      const fresh = await createIndexedDB({
        name: h.db.name,
        version: 1,
        stores: ['items', 'other'],
      })
      try {
        for (const name of ['items', 'other'])
          assertRows(
            (await readStore<Row>(fresh, name)).rows,
            [],
            'fresh durable state after deletion',
          )
      } finally {
        fresh.close()
      }
    } finally {
      blocker.close()
      await terminal.promise
      await outcome
    }
  })
})

// Failure to issue deletion changes neither storage nor the published source.
// This injected factory failure has no native request, so it makes no rollback
// claim for an operation that already reached the provider. The utility closes
// its descriptor first; durable observations therefore use a new descriptor.
it('preserves durable and public snapshots when deletion cannot be issued', async () => {
  await withHarness(async (h) => {
    const item = { id: 'item', name: 'retained item' }
    const other = { id: 'other', name: 'retained sibling' }
    await seed(h.db, 'items', [item])
    await seed(h.db, 'other', [other])
    const source = await h.open()
    const peer = await h.open()
    const sibling = await h.open('other')
    const issue = vi
      .spyOn(indexedDB, 'deleteDatabase')
      .mockImplementation(() => {
        throw new DOMException('storage deletion denied', 'SecurityError')
      })
    await expect(source.utils.deleteDatabase()).rejects.toThrow(
      'storage deletion denied',
    )
    issue.mockRestore()
    expect(
      Channel.sent,
      'failed deletion sends no success notification',
    ).toEqual([])
    assertRows(source.values(), [item], 'failed deletion originating snapshot')
    assertRows(peer.values(), [item], 'failed deletion same-store snapshot')
    assertRows(sibling.values(), [other], 'failed deletion sibling snapshot')
    const fresh = await createIndexedDB({
      name: h.db.name,
      version: 1,
      stores: ['items', 'other'],
    })
    try {
      for (const [name, rows] of [
        ['items', [item]],
        ['other', [other]],
      ] as const)
        assertRows(
          (await readStore<Row>(fresh, name)).rows,
          rows,
          'failed deletion durable snapshot',
        )
    } finally {
      fresh.close()
    }
  })
})

// Managed connection ownership, approved by the maintainer: createIndexedDB
// closes its native connection when another request delivers versionchange.
// Closing permits upgrade/deletion; it does not restart a Collection, invent a
// Collection status, or convert later persistence into an in-memory success.
// Upgrade preserves existing durable rows. Deletion publishes empty snapshots
// after native success. The caller recreates descriptors and Collections for
// subsequent persistence through the changed database.
//
// The reference is authored rows plus the operation's native version: upgrade
// retains rows at version 2; deletion recreates empty stores at version 1. The
// finite grammar crosses two/three independent descriptors with upgrade/delete.
// Source, same-store peer and sibling-store peer stay active through the native
// operation. With two descriptors, both peers share the second connection; with
// three, each Collection has its own. These roles expose connection ownership
// that the shared-descriptor histories above cannot exercise.
//
// Native fake-IDB versionchange/blocked events are the reach witnesses. At a
// blocked event the driver records the violation, then closes fixture-owned
// descriptors so native completion and the remaining observations can run.
// The final zero-blocked assertion therefore rejects missing automatic close
// directly instead of timing out. Raw unmanaged blockers retain the separate
// pending settlement contract in wrapper.test.ts. Real pages, transactions
// already in flight, application notification and elapsed-time bounds are outside
// this finite grammar; controlled Channel delivery is not browser scheduling.
for (const count of [2, 3]) {
  for (const operation of ['upgrade', 'delete'] as const) {
    it(
      operation + ' releases ' + count + ' independent managed connections',
      async () => {
        await withHarness(async (h) => {
          const item = { id: 'item', name: 'retained by upgrade' }
          const other = { id: 'other', name: 'sibling retained by upgrade' }
          await seed(h.db, 'items', [item])
          await seed(h.db, 'other', [other])
          const descriptors = [h.db]
          try {
            for (let index = 1; index < count; index++)
              descriptors.push(
                await createIndexedDB({
                  name: h.db.name,
                  version: 1,
                  stores: ['items', 'other'],
                }),
              )
            expect(
              new Set(descriptors.map((descriptor) => descriptor.db)).size,
              'independent native connection premise',
            ).toBe(count)
            const source = await h.open()
            const peer = await h.open('items', { db: descriptors[1]! })
            const sibling = await h.open('other', {
              db: descriptors[count - 1]!,
            })
            const collections = [source, peer, sibling]
            const versionchanges = descriptors.map(
              () =>
                [] as Array<{ oldVersion: number; newVersion: number | null }>,
            )
            descriptors.forEach((descriptor, index) => {
              descriptor.db.addEventListener('versionchange', (event) => {
                versionchanges[index]!.push({
                  oldVersion: event.oldVersion,
                  newVersion: event.newVersion,
                })
              })
            })
            let blockedEvents = 0
            function observe(nativeRequest: IDBOpenDBRequest) {
              nativeRequest.addEventListener('blocked', () => {
                blockedEvents++
                for (const descriptor of descriptors) descriptor.close()
              })
              return nativeRequest
            }
            const nativeOpen = indexedDB.open.bind(indexedDB)
            const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB)
            const openSpy = vi
              .spyOn(indexedDB, 'open')
              .mockImplementation((...args) => observe(nativeOpen(...args)))
            const deleteSpy = vi
              .spyOn(indexedDB, 'deleteDatabase')
              .mockImplementation((...args) => observe(nativeDelete(...args)))
            const fresh =
              operation === 'upgrade'
                ? await createIndexedDB({
                    name: h.db.name,
                    version: 2,
                    stores: ['items', 'other', 'added'],
                  })
                : await (async () => {
                    await source.utils.deleteDatabase()
                    expect(
                      await Channel.deliver(),
                      'native deletion notification reaches independent peers',
                    ).toBe(2)
                    for (const collection of collections)
                      assertRows(
                        collection.values(),
                        [],
                        'native deletion published across managed descriptors',
                      )
                    return createIndexedDB({
                      name: h.db.name,
                      version: 1,
                      stores: ['items', 'other'],
                    })
                  })()
            descriptors.push(fresh)
            openSpy.mockRestore()
            deleteSpy.mockRestore()

            expect(
              versionchanges,
              'every open managed connection receives versionchange',
            ).toEqual(
              Array.from({ length: count }, (_, index) =>
                operation === 'delete' && index === 0
                  ? []
                  : [
                      {
                        oldVersion: 1,
                        newVersion: operation === 'upgrade' ? 2 : null,
                      },
                    ],
              ),
            )
            expect(
              fresh.version,
              'native operation reached its terminal version',
            ).toBe(operation === 'upgrade' ? 2 : 1)
            for (const [name, before] of [
              ['items', [item]],
              ['other', [other]],
            ] as const) {
              const expected = operation === 'upgrade' ? before : []
              assertRows(
                (await readStore<Row>(fresh, name)).rows,
                expected,
                'durable rows after native ' + operation,
              )
            }
            if (operation === 'upgrade') {
              for (const [index, collection] of collections.entries()) {
                await expect(
                  collection.insert({
                    id: 'closed-' + index,
                    name: 'must not become durable',
                  }).isPersisted.promise,
                ).rejects.toThrow('Failed to create transaction')
                assertRows(
                  collection.values(),
                  index === 2 ? [other] : [item],
                  'closed-descriptor rejection rolls back its optimistic row',
                )
              }
            }
            // Recreate consumers explicitly. Delivering a later write into an
            // obsolete connection would test a different receiving-work contract.
            for (const collection of collections) await collection.cleanup()
            const restored = await h.open('items', { db: fresh })
            const restoredSibling = await h.open('other', { db: fresh })
            assertRows(
              restored.values(),
              operation === 'upgrade' ? [item] : [],
              'fresh items restore after native ' + operation,
            )
            assertRows(
              restoredSibling.values(),
              operation === 'upgrade' ? [other] : [],
              'fresh sibling restore after native ' + operation,
            )
            if (operation === 'upgrade') {
              const added = await h.open('added', { db: fresh })
              assertRows(added.values(), [], 'new store starts empty')
              const suffix = {
                id: 'suffix',
                name: 'written through new descriptor',
              }
              const addedRow = { id: 'added', name: 'written in new store' }
              await restored.insert({ ...suffix }).isPersisted.promise
              await added.insert({ ...addedRow }).isPersisted.promise
              await Channel.deliver()
              assertRows(
                restored.values(),
                [item, suffix],
                'new descriptor write',
              )
              assertRows(
                (await readStore<Row>(fresh, 'items')).rows,
                [item, suffix],
                'new descriptor durable write',
              )
              assertRows(
                (await readStore<Row>(fresh, 'added')).rows,
                [addedRow],
                'new store durable write',
              )
              assertRows(
                restoredSibling.values(),
                [other],
                'sibling remains intact',
              )
            }
            expect(
              blockedEvents,
              'managed versionchange closes every connection',
            ).toBe(0)
          } finally {
            for (const descriptor of descriptors) descriptor.close()
          }
        })
      },
    )
  }
}
