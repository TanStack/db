/**
 * Wrapper contract: requests expose exact values; executeTransaction settles
 * only after BOTH its callback and the IDB transaction succeed. An abort rolls
 * back all stores. Callback failures keep their identity. These are bounded
 * laws from wrapper.ts's public API and IndexedDB transaction semantics.
 *
 * Expected rows are authored constants. Raw native reads in harness.ts observe
 * durability independently. Explicit request and completion events distinguish
 * early success from durable success. Fake IndexedDB owns event scheduling;
 * deferred callbacks own application scheduling. No browser/crash claim.
 */
import { expect, it } from 'vitest'
import {
  clear,
  createObjectStore,
  deleteByKey,
  deleteDatabase,
  executeTransaction,
  getAll,
  getAllKeys,
  getByKey,
  openDatabase,
  put,
} from '../src'
import { deferred, readStore, withHarness } from './harness'
import type { Row } from './harness'

it('preserves exact keys and values through request helpers and whole-store clear', async () => {
  await withHarness(async (h) => {
    const rows = [
      { id: 0, name: 'number' },
      { id: '0', name: 'string' },
    ]
    await executeTransaction(
      h.db.db,
      'items',
      'readwrite',
      async (_, stores) => {
        for (const row of rows)
          expect(await put(stores.items!, row, row.id)).toBe(row.id)
      },
    )
    await executeTransaction(
      h.db.db,
      'items',
      'readonly',
      async (_, stores) => {
        expect(await getAll<Row>(stores.items!)).toEqual(rows)
        expect(await getAllKeys(stores.items!)).toEqual([0, '0'])
        expect(await getByKey(stores.items!, 0)).toEqual(rows[0])
        expect(await getByKey(stores.items!, 'missing')).toBeUndefined()
      },
    )
    await executeTransaction(
      h.db.db,
      'items',
      'readwrite',
      async (_, stores) => {
        await put(stores.items!, { id: 0, name: 'changed' }, 0)
        await deleteByKey(stores.items!, '0')
        await deleteByKey(stores.items!, 'missing')
      },
    )
    expect((await readStore(h.db, 'items')).rows).toEqual([
      { id: 0, name: 'changed' },
    ])
    await executeTransaction(h.db.db, 'items', 'readwrite', (_, stores) =>
      clear(stores.items!),
    )
    await executeTransaction(h.db.db, 'items', 'readwrite', (_, stores) =>
      clear(stores.items!),
    )
    expect((await readStore(h.db, 'items')).rows).toEqual([])
  })
})

for (const outcome of ['resolve', 'reject'] as const) {
  it(
    'waits for an async callback to ' +
      outcome +
      ' after transaction completion',
    async () => {
      await withHarness(async (h) => {
        const gate = deferred<string>(),
          nativeDone = deferred()
        const failure = new Error('late callback rejection')
        let settled = false
        const promise = executeTransaction(
          h.db.db,
          'items',
          'readonly',
          (tx) => {
            tx.addEventListener('complete', () => nativeDone.resolve())
            return gate.promise
          },
        ).then(
          (value) => {
            settled = true
            return value
          },
          (error) => {
            settled = true
            return error as unknown
          },
        )
        await nativeDone.promise
        await Promise.resolve()
        const early = settled
        if (outcome === 'resolve') gate.resolve('callback result')
        else gate.reject(failure)
        const result = await promise
        expect(early, 'native completion is not callback completion').toBe(
          false,
        )
        expect(result).toBe(outcome === 'resolve' ? 'callback result' : failure)
      })
    },
  )
}

for (const failureMode of ['sync', 'async', 'abort'] as const) {
  it('rolls back all stores on ' + failureMode + ' failure', async () => {
    await withHarness(async (h) => {
      const failure = new Error('callback failed')
      const result = executeTransaction(
        h.db.db,
        ['items', 'other'],
        'readwrite',
        (tx, stores) => {
          stores.items!.put({ id: 1, name: 'a' }, 1)
          stores.other!.put({ id: 1, name: 'b' }, 1)
          if (failureMode === 'sync') throw failure
          if (failureMode === 'async') return Promise.reject(failure)
          tx.abort()
          return undefined
        },
      )
      if (failureMode === 'abort')
        await expect(result).rejects.toThrow(/abort/i)
      else await expect(result).rejects.toBe(failure)
      expect((await readStore(h.db, 'items')).rows).toEqual([])
      expect((await readStore(h.db, 'other')).rows).toEqual([])
    })
  })
}

it('does not report request success as committed when its transaction later aborts', async () => {
  await withHarness(async (h) => {
    let reached = false
    const result = executeTransaction(
      h.db.db,
      'items',
      'readwrite',
      async (tx, stores) => {
        await put(stores.items!, { id: 1, name: 'a' }, 1)
        reached = true
        tx.abort()
        return 'request succeeded'
      },
    )
    await expect(result).rejects.toThrow(/abort/i)
    expect(reached).toBe(true)
    expect((await readStore(h.db, 'items')).rows).toEqual([])
  })
})

it('creates, upgrades and deletes stores with inline and generated keys', async () => {
  const name = crypto.randomUUID()
  let db = await openDatabase(name, 1, (database, old, next) => {
    expect([old, next]).toEqual([0, 1])
    createObjectStore(database, 'inline', { keyPath: 'id' })
    createObjectStore(database, 'generated', { autoIncrement: true })
    createObjectStore(database, 'both', { keyPath: 'id', autoIncrement: true })
    expect(() => createObjectStore(database, 'inline')).toThrow(
      /already exists/,
    )
  })
  try {
    await executeTransaction(
      db,
      ['inline', 'generated', 'both'],
      'readwrite',
      async (_, stores) => {
        expect(await put(stores.inline!, { id: 'a' })).toBe('a')
        expect(await put(stores.generated!, {})).toBe(1)
        expect(await put(stores.both!, {})).toBe(1)
      },
    )
    expect(() => createObjectStore(db, 'late')).toThrow(/upgrade/)
    await expect(
      executeTransaction(db, 'absent', 'readonly', () => {}),
    ).rejects.toThrow()
    db.close()
    db = await openDatabase(name, 2, (database, old, next) => {
      expect([old, next]).toEqual([1, 2])
      createObjectStore(database, 'added')
    })
    expect(Array.from(db.objectStoreNames)).toEqual([
      'added',
      'both',
      'generated',
      'inline',
    ])
  } finally {
    db.close()
  }
  await deleteDatabase(name)
  await deleteDatabase(name)
})

it('rejects a failed upgrade', async () => {
  await expect(
    openDatabase(crypto.randomUUID(), 1, () => {
      throw new Error('upgrade rejected')
    }),
  ).rejects.toThrow('upgrade rejected')
})
