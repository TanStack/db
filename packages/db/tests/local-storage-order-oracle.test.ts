/**
 * LocalStorage automatic writes preserve mutation order within one Collection.
 * The public LocalStorage guide promises direct mutations that persist, while
 * Collection settlement promises that a fulfilled `isPersisted` reflects the
 * accepted mutation. A later authored update must not be replaced by an older
 * handler that happens to finish later. This law says nothing about concurrent
 * writers in different Collections or browser tabs.
 *
 * The independent model folds accepted whole-row updates in author order. It
 * does not model handlers, optimistic overlays, storage caches, or sync queues.
 * The legal histories below start with two stored rows and submit two updates
 * without waiting. They vary same/disjoint keys, handler completion order,
 * and both application decisions for each update.
 * At the final settlement checkpoint, public rows, durable rows, and a fresh
 * Collection must equal that fold. The held-handler checkpoint verifies that
 * no later mutation reports persistence ahead of its undecided predecessor.
 * A handler may admit a nested automatic mutation without awaiting it. Awaiting
 * that mutation's persistence from the earlier handler would form a cycle under
 * the order law, so the public guide excludes that usage.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { createDeferred } from '../src/deferred'
import { localStorageCollectionOptions } from '../src/local-storage'
import { withHistoryCleanup } from './optimistic-history-oracle'

type Row = { id: string; value: number }
const initial: Array<Row> = [
  { id: 'a', value: 0 },
  { id: 'b', value: 0 },
]

type Edit = { id: string; value: number }

// Whole-row replacement is the documented Collection update effect in this
// scalar domain. A rejected application decision contributes no effect.
function expectedRows(
  edits: ReadonlyArray<Edit>,
  accepted: ReadonlyArray<boolean>,
) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]))
  edits.forEach((edit, index) => {
    if (accepted[index]) rows.set(edit.id, { ...edit })
  })
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// The outer handler admits a nested write while it is held. The independent
// authored fold expects the outer row before the inner row. The storage trace
// checks that order, while the held checkpoint rules out early inner persistence.
it('persists a nested fire-and-forget mutation after its handler returns', async () => {
  const storage = makeSeededStorage()
  const snapshots: Array<Array<Row>> = []
  const setItem = storage.setItem
  storage.setItem = (key, value) => {
    setItem(key, value)
    snapshots.push(storedRows(value))
  }
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  let nestedReceipt: Promise<unknown> | undefined
  const collection = createCollection(
    localStorageCollectionOptions<Row>({
      storageKey: 'rows',
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      onInsert: async ({ transaction }) => {
        if (transaction.mutations[0].modified.id === 'outer') {
          nestedReceipt = collection.insert({ id: 'inner', value: 2 })
            .isPersisted.promise
          entered.resolve()
          await release.promise
        }
      },
    }),
  )
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const outer = collection.insert({ id: 'outer', value: 1 })
      await entered.promise
      expect(nestedReceipt, 'nested mutation was admitted').toBeDefined()
      expect(snapshots, 'no write before the outer handler returns').toEqual([])
      release.resolve()
      await Promise.all([outer.isPersisted.promise, nestedReceipt])
      expect(snapshots).toEqual([
        expectedRows([{ id: 'outer', value: 1 }], [true]),
        expectedRows(
          [
            { id: 'outer', value: 1 },
            { id: 'inner', value: 2 },
          ],
          [true, true],
        ),
      ])
      expect(sortedRows(collection.values())).toEqual(snapshots[1])
    },
    () => [() => release.resolve(), () => collection.cleanup()],
  )
})

function sortedRows(values: Iterable<Row>) {
  return [...values]
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function storedRows(raw: string | null): Array<Row> {
  expect(raw).not.toBeNull()
  const records = JSON.parse(raw!) as Record<string, { data: Row }>
  return sortedRows(Object.values(records).map(({ data }) => data))
}

function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

function makeSeededStorage() {
  const storage = makeStorage()
  storage.setItem(
    'rows',
    JSON.stringify(
      Object.fromEntries(
        initial.map((row) => [
          `s:${row.id}`,
          { versionKey: `initial-${row.id}`, data: row },
        ]),
      ),
    ),
  )
  return storage
}

// This finite grammar covers same-key and disjoint-key updates and both handler
// completion orders and all decision pairs. It excludes peer writes and
// manual transactions; those require different event and ownership boundaries.
for (const secondId of ['a', 'b']) {
  for (const completion of ['first', 'second']) {
    for (const accepted of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]) {
      describe(`two ${secondId === 'a' ? 'same-key' : 'disjoint-key'} writes, ${completion} handler first, decisions ${accepted.join('/')}`, () => {
        it('persists and publishes the authored result', async () => {
          const storage = makeSeededStorage()
          const gate = [createDeferred<void>(), createDeferred<void>()]
          const entered = [createDeferred<void>(), createDeferred<void>()]
          const edits: Array<Edit> = [
            { id: 'a', value: 1 },
            { id: secondId, value: 2 },
          ]
          const makeCollection = (withHandler: boolean) =>
            createCollection(
              localStorageCollectionOptions<Row>({
                storageKey: 'rows',
                storage,
                storageEventApi: {
                  addEventListener() {},
                  removeEventListener() {},
                },
                getKey: (row) => row.id,
                ...(withHandler
                  ? {
                      onUpdate: async ({
                        transaction,
                      }: {
                        transaction: { mutations: Array<{ modified: Row }> }
                      }) => {
                        const index =
                          transaction.mutations[0]!.modified.value - 1
                        entered[index]!.resolve()
                        await gate[index]!.promise
                      },
                    }
                  : {}),
              }),
            )
          const collection = makeCollection(true)
          let reopened: ReturnType<typeof makeCollection> | undefined
          await withHistoryCleanup(
            async () => {
              await collection.preload()
              const transactions = edits.map((edit) =>
                collection.update(edit.id, (draft) => {
                  draft.value = edit.value
                }),
              )
              const settled = [false, false]
              const outcomes = transactions.map((tx, index) =>
                tx.isPersisted.promise.then(
                  () => {
                    settled[index] = true
                    return true
                  },
                  () => {
                    settled[index] = true
                    return false
                  },
                ),
              )
              await Promise.all(entered.map((item) => item.promise))
              const first = completion === 'first' ? 0 : 1
              if (accepted[first]) gate[first]!.resolve()
              else gate[first]!.reject(new Error(`handler ${first} rejected`))
              await Promise.resolve()
              await Promise.resolve()
              if (first === 1) {
                expect(
                  settled[1],
                  'later persistence waits for the earlier decision',
                ).toBe(false)
                expect(storedRows(storage.getItem('rows'))).toEqual(initial)
              }
              if (accepted[1 - first]) gate[1 - first]!.resolve()
              else
                gate[1 - first]!.reject(
                  new Error(`handler ${1 - first} rejected`),
                )
              expect(await Promise.all(outcomes)).toEqual(accepted)
              const expected = expectedRows(edits, accepted)
              expect(storedRows(storage.getItem('rows'))).toEqual(expected)
              expect(sortedRows(collection.values())).toEqual(expected)
              reopened = makeCollection(false)
              await reopened.preload()
              expect(sortedRows(reopened.values())).toEqual(expected)
            },
            () => [
              () => gate.forEach((item) => item.resolve()),
              () => reopened?.cleanup(),
              () => collection.cleanup(),
            ],
          )
        })
      })
    }
  }
}

// An update followed by a delete distinguishes ordering from a simple
// last-value replacement. The same authored fold removes the row if the
// delete is accepted, even when its handler completes before the update.
for (const accepted of [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
]) {
  it(`keeps an update followed by delete in author order with decisions ${accepted.join('/')}`, async () => {
    const storage = makeSeededStorage()
    const gate = [createDeferred<void>(), createDeferred<void>()]
    const entered = [createDeferred<void>(), createDeferred<void>()]
    const collection = createCollection(
      localStorageCollectionOptions<Row>({
        storageKey: 'rows',
        storage,
        storageEventApi: { addEventListener() {}, removeEventListener() {} },
        getKey: (row) => row.id,
        onUpdate: async () => {
          entered[0]!.resolve()
          await gate[0]!.promise
        },
        onDelete: async () => {
          entered[1]!.resolve()
          await gate[1]!.promise
        },
      }),
    )
    await withHistoryCleanup(
      async () => {
        await collection.preload()
        const update = collection.update('a', (draft) => {
          draft.value = 1
        })
        const deletion = collection.delete('a')
        const outcomes = [update, deletion].map((tx) =>
          tx.isPersisted.promise.then(
            () => true,
            () => false,
          ),
        )
        await Promise.all(entered.map((item) => item.promise))
        if (accepted[1]) gate[1]!.resolve()
        else gate[1]!.reject(new Error('delete rejected'))
        await Promise.resolve()
        await Promise.resolve()
        expect(storedRows(storage.getItem('rows'))).toEqual(initial)
        if (accepted[0]) gate[0]!.resolve()
        else gate[0]!.reject(new Error('update rejected'))
        expect(await Promise.all(outcomes)).toEqual(accepted)
        const expected = accepted[1]
          ? [{ id: 'b', value: 0 }]
          : expectedRows([{ id: 'a', value: 1 }], [accepted[0]!])
        expect(storedRows(storage.getItem('rows'))).toEqual(expected)
        expect(sortedRows(collection.values())).toEqual(expected)
      },
      () => [
        () => gate.forEach((item) => item.resolve()),
        () => collection.cleanup(),
      ],
    )
  })
}
