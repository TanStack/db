/** Production receiving driver only. Native open/transaction/notification events
 * supply the premises; expected rows and value descriptions stay in the runner.
 * Type/byte observations execute here, before Playwright serializes the result.
 */
import { createCollection } from '@tanstack/db'
import { createIndexedDB, indexedDBCollectionOptions } from '../src'
import { holdStore, observeTransactions } from '../tests/idb-driver'
import { createValue, observeValueRows } from '../tests/structured-clone-oracle'
import type { ValueKind, ValueRow } from '../tests/structured-clone-oracle'
import type { IndexedDBInstance } from '../src'

const descriptors: Array<IndexedDBInstance> = []
const disposers: Array<() => unknown> = []
async function descriptor(name: string, stores = ['items'], version = 1) {
  const db = await createIndexedDB({ name, stores, version })
  descriptors.push(db)
  return db
}
function collection(
  db: IndexedDBInstance,
  name = 'items',
  onUpdate?: () => Promise<void>,
) {
  const value = createCollection(
    indexedDBCollectionOptions<ValueRow>({
      db,
      name,
      getKey: (row) => row.id,
      onUpdate,
    }),
  )
  disposers.push(() => value.cleanup())
  return value
}
async function rawRows(
  db: IndexedDBInstance,
  name: string,
): Promise<Array<ValueRow>> {
  return new Promise((resolve, reject) => {
    const tx = db.db.transaction(name)
    const request = tx.objectStore(name).getAll()
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
}
async function valuePeer(name: string) {
  const db = await descriptor(name)
  let handler = Promise.resolve()
  const c = collection(db, 'items', () => handler)
  await c.preload()
  return {
    capture: async (kind: ValueKind, entry: 'update' | 'import') => {
      await c.utils.importData([
        { id: 1, name: 'before', nested: { value: null } },
      ])
      let release!: () => void
      handler = new Promise<void>((resolve) => {
        release = resolve
      })
      const gate = holdStore(db.db)
      await gate.started
      const row = {
        id: 1,
        name: 'captured',
        nested: { value: createValue(kind) },
      }
      let settled = false
      try {
        const pending =
          entry === 'import'
            ? c.utils.importData([row])
            : c.update(1, (draft) => {
                draft.name = row.name
                draft.nested = row.nested
              }).isPersisted.promise
        // Attach rejection immediately so failure cannot become an unhandled event
        // while the oracle records the deliberately held native boundary.
        const done = pending.then(
          () => {
            settled = true
          },
          (error: unknown) => {
            settled = true
            throw error
          },
        )
        void done.catch(() => undefined)
        row.name = 'caller changed'
        function mutate(value: unknown): void {
          if (value instanceof Date) value.setTime(0)
          else if (value instanceof ArrayBuffer) new Uint8Array(value).fill(99)
          else if (ArrayBuffer.isView(value))
            new Uint8Array(value.buffer).fill(99)
          else if (Array.isArray(value)) value.forEach(mutate)
        }
        mutate(row.nested.value)
        const immediate =
          entry === 'update' ? await observeValueRows(c.values()) : undefined
        const beforeRelease = settled
        release()
        await gate.release()
        await done
        return { beforeRelease, immediate }
      } finally {
        release()
        await gate.release()
      }
    },
    captureRealm: async (viewFirst: boolean, kind: 'u8' | 'view') => {
      await c.utils.importData([
        { id: 1, name: 'before', nested: { value: null } },
      ])
      const frame = document.createElement('iframe')
      document.body.append(frame)
      try {
        const realm = frame.contentWindow as Window & typeof globalThis
        const buffer = new realm.ArrayBuffer(8)
        const bytes = new Uint8Array(buffer)
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7])
        const view =
          kind === 'u8'
            ? new realm.Uint8Array(buffer, 2, 3)
            : new realm.DataView(buffer, 2, 3)
        const value = viewFirst ? { view, buffer } : { buffer, view }
        const tx = c.update(1, (draft) => {
          draft.nested = { value }
        })
        const immediate = c.get(1)!
        bytes.fill(99)
        await tx.isPersisted.promise
        function observe(row: ValueRow) {
          const copy = row.nested.value as typeof value
          return {
            bytes: [...new Uint8Array(copy.buffer)],
            offset: copy.view.byteOffset,
            length: copy.view.byteLength,
            alias: copy.view.buffer === copy.buffer,
            detached: copy.buffer !== buffer,
          }
        }
        return [
          immediate,
          c.get(1)!,
          (await rawRows(db, 'items'))[0]!,
          (await c.utils.exportData())[0]!,
        ].map(observe)
      } finally {
        frame.remove()
      }
    },
    observe: async () => ({
      status: c.status,
      rows: await observeValueRows(c.values()),
      durable: await observeValueRows(await rawRows(db, 'items')),
      exported: await observeValueRows(await c.utils.exportData()),
    }),
    insert: async (kind: ValueKind) => {
      await c.insert({
        id: 1,
        name: 'initial',
        nested: { value: createValue(kind) },
      }).isPersisted.promise
    },
    update: async () => {
      await c.update(1, (draft) => {
        draft.name = 'updated'
      }).isPersisted.promise
    },
    replace: async () => {
      const rows = await c.utils.exportData()
      await c.utils.clearObjectStore()
      await c.utils.importData(rows)
    },
    reject: async (
      kind: ValueKind,
      entry: 'insert' | 'import',
      badIndex: number,
    ) => {
      const rows = [2, 3, 4].map((id, index) => ({
        id,
        name: 'rejected',
        nested: {
          value: index === badIndex ? () => undefined : createValue(kind),
        },
      }))
      try {
        if (entry === 'insert') await c.insert(rows).isPersisted.promise
        else await c.utils.importData(rows)
        return 'fulfilled'
      } catch {
        return 'rejected'
      }
    },
  }
}

async function initialize(name: string, shared: boolean, store: string) {
  const stores = [store, store + '-neighbor']
  let admitted = 0,
    settled = 0,
    blocked = 0
  const oldVersions: Array<number> = []
  const open = indexedDB.open.bind(indexedDB)
  indexedDB.open = (...args) => {
    admitted++
    const request = open(...args)
    request.addEventListener('upgradeneeded', (event) =>
      oldVersions.push(event.oldVersion),
    )
    request.addEventListener('blocked', () => {
      blocked++
    })
    return request
  }
  const pending = [0, 1, 2].map((index) =>
    descriptor(shared ? name : name + index, stores).then((db) => {
      settled++
      return db
    }),
  )
  const admission = { admitted, settled }
  const dbs = await Promise.all(pending)
  const schema = dbs.map((db) => [...db.db.objectStoreNames])
  const initialVersions = [...oldVersions]
  const unique = shared ? dbs.slice(0, 1) : dbs
  const gates = unique.map((db) => holdStore(db.db, [store, '_versions']))
  for (const gate of gates) disposers.push(() => gate.release())
  await Promise.all(gates.map((gate) => gate.started))
  const transactions = dbs.map((db) => observeTransactions(db.db))
  const collections = dbs.map((db) => collection(db, store))
  const ready = collections.map((c) => c.preload())
  // preload admits its read synchronously; a microtask allows the adapter's
  // initialization continuation without releasing the native storage blockers.
  await Promise.resolve()
  const held = collections.map((c, index) => ({
    status: c.status,
    reads: transactions[index]!.entries.filter(
      (tx) => tx.mode === 'readonly',
    ).map((tx) => tx.status),
  }))
  await Promise.all(gates.map((gate) => gate.release()))
  await Promise.all(ready)
  const restored = transactions.map((record) =>
    record.entries
      .filter((tx) => tx.mode === 'readonly')
      .map((tx) => tx.status),
  )
  for (const record of transactions) record.restore()
  const rows = [0, 1, 2].map((id) => ({
    id,
    name: `writer-${id}`,
    nested: { value: id },
  }))
  await Promise.all(
    collections.map((c, index) => c.insert(rows[index]!).isPersisted.promise),
  )
  return {
    evidence: { admission, schema, initialVersions, held, restored },
    rows: () =>
      collections.map((c) =>
        [...c.values()]
          .map(({ id, name: rowName }) => ({ id, name: rowName }))
          .sort((a, b) => a.id - b.id),
      ),
    fresh: async () =>
      Promise.all(
        dbs.map(async (db) => {
          const fresh = collection(await descriptor(db.name, stores), store)
          await fresh.preload()
          return [...fresh.values()]
            .map(({ id, name: rowName }) => ({ id, name: rowName }))
            .sort((a, b) => a.id - b.id)
        }),
      ),
    upgrade: async () => {
      try {
        await Promise.all(
          unique.map((db) => descriptor(db.name, [...stores, 'added'], 2)),
        )
        return { blocked, statuses: collections.map((c) => c.status) }
      } finally {
        indexedDB.open = open
      }
    },
  }
}

// Independent provider capability witness. A native failure cannot establish
// value preservation, but must still produce truthful adapter rejection.
async function nativeValueProbe(name: string, kind: ValueKind) {
  const request = indexedDB.open(name + '-native', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('rows')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<
      | { outcome: 'complete' }
      | { outcome: 'rejected'; name: string; message: string }
    >((resolve) => {
      const tx = db.transaction('rows', 'readwrite')
      tx.objectStore('rows').put(
        { id: 1, name: 'initial', nested: { value: createValue(kind) } },
        1,
      )
      tx.oncomplete = () => resolve({ outcome: 'complete' })
      tx.onabort = () =>
        resolve({
          outcome: 'rejected',
          name: tx.error?.name ?? '',
          message: tx.error?.message ?? '',
        })
    })
  } finally {
    db.close()
  }
}
const coverage = {
  nativeValueProbe,
  valuePeer,
  initialize,
  cleanup: async () => {
    const results = await Promise.allSettled(
      disposers.map((dispose) => dispose()),
    )
    for (const db of descriptors) db.close()
    const errors = results.filter((result) => result.status === 'rejected')
    if (errors.length)
      throw new AggregateError(errors, 'native fixture cleanup')
  },
}
window.coverage = coverage
declare global {
  interface Window {
    coverage: typeof coverage
    valuePeer: Awaited<ReturnType<typeof valuePeer>>
    initialization: Awaited<ReturnType<typeof initialize>>
  }
}
