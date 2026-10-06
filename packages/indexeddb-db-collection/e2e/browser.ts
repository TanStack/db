import { createCollection, createTransaction } from '@tanstack/db'
import { createIndexedDB, indexedDBCollectionOptions } from '../src'
import { holdStore } from '../tests/idb-driver'
import { snapshot } from '../tests/cross-tab-oracle'
import { recordCollection } from '../tests/recorder'
import type { OracleRow } from '../tests/cross-tab-oracle'
import type { RecordedEvent } from '../tests/recorder'

export type BrowserEvidence = RecordedEvent & { document: string; tab: string }
type Probe = Awaited<ReturnType<typeof setup>>
declare global {
  interface Window {
    crossTab?: Probe
    crossTabFailure?: string
    retainOracleEvent: (event: BrowserEvidence) => Promise<void>
  }
}

/** Actual IndexedDB/BroadcastChannel receiving driver. Instrumentation counts
 * native callback entry/completion; it neither queues nor serializes delivery.
 * The only held provider is an ordinary test-owned native transaction.
 */
async function setup() {
  const query = new URLSearchParams(location.search)
  const database = query.get('database')!
  const tab = query.get('tab')!
  const document = crypto.randomUUID()
  const fault = query.get('fault') === 'split'
  const callbacks = { started: 0, completed: 0, posts: 0 }
  const syncWrites: Array<string> = []
  let truncates = 0,
    versionChanges = 0,
    requestProgress = 0
  let abortRead = query.get('abort') === 'startup'
  let abortWrite = false
  let unmanaged: IDBDatabase | undefined
  let deletionReceipt: (() => void) | undefined
  let deletion: Promise<void> | undefined
  const schema = { status: 'idle', blocked: 0 }
  const transactions: Array<IDBTransaction> = []
  const failures: Array<string> = []
  const NativeChannel = globalThis.BroadcastChannel
  const onmessage = Object.getOwnPropertyDescriptor(
    NativeChannel.prototype,
    'onmessage',
  )!
  globalThis.BroadcastChannel = class extends NativeChannel {
    constructor(name: string) {
      super(name)
      Object.defineProperty(this, 'onmessage', {
        configurable: true,
        get: () => onmessage.get!.call(this),
        set: (handler: BroadcastChannel['onmessage']) =>
          onmessage.set!.call(
            this,
            handler === null
              ? null
              : (event: MessageEvent) => {
                  callbacks.started++
                  let result: unknown
                  try {
                    result = handler.call(this, event)
                  } catch (error) {
                    failures.push(String(error))
                    callbacks.completed++
                    return
                  }
                  void Promise.resolve(result).then(
                    () => {
                      callbacks.completed++
                    },
                    (error: unknown) => {
                      failures.push(String(error))
                      callbacks.completed++
                    },
                  )
                },
          ),
      })
    }
    override postMessage(message: unknown) {
      callbacks.posts++
      super.postMessage(message)
    }
  }
  const descriptor = await createIndexedDB({
    name: database,
    version: Number(query.get('version') ?? 1),
    stores: ['items', 'other'],
  })
  descriptor.db.addEventListener('versionchange', () => {
    versionChanges++
  })
  const originalTransaction = descriptor.db.transaction.bind(descriptor.db)
  let arm = false
  let gate: ReturnType<typeof holdStore> | undefined
  const reads: Array<'pending' | 'complete' | 'abort'> = []
  const nativeWrites: Array<'pending' | 'complete' | 'abort'> = []
  descriptor.db.transaction = (...args) => {
    const transaction = originalTransaction(...args)
    transactions.push(transaction)
    if (transaction.mode === 'readwrite') {
      const index = nativeWrites.push('pending') - 1
      transaction.addEventListener('complete', () => {
        nativeWrites[index] = 'complete'
      })
      transaction.addEventListener('abort', () => {
        nativeWrites[index] = 'abort'
      })
    }
    if (transaction.mode === 'readonly') {
      const index = reads.push('pending') - 1
      if (abortRead) {
        abortRead = false
        const progress = transaction
          .objectStore('items')
          .get('__oracle_abort__')
        progress.addEventListener('success', () => {
          requestProgress++
          transaction.abort()
        })
      }
      transaction.addEventListener('complete', () => {
        reads[index] = 'complete'
      })
      transaction.addEventListener('abort', () => {
        reads[index] = 'abort'
      })
    } else if (abortWrite) {
      abortWrite = false
      const progress = transaction.objectStore('items').get('__oracle_abort__')
      progress.addEventListener('success', () => {
        requestProgress++
        transaction.abort()
      })
    } else if (arm) {
      arm = false
      // Install before the adapter attaches its terminal listener. The blocker
      // is admitted after this write commits, before its notifications can
      // cause receiver reads. All requests remain ordinary native operations.
      transaction.addEventListener('complete', () => {
        gate = holdStore(descriptor.db)
      })
    }
    return transaction
  }
  if (query.get('hold') === 'startup') {
    gate = holdStore(descriptor.db)
    await gate.started
  }
  let held: { resolve: () => void; reject: (error: Error) => void } | undefined
  let holdNext = false
  let handlerStatus: 'idle' | 'pending' | 'fulfilled' | 'rejected' = 'idle'
  const options = indexedDBCollectionOptions<OracleRow>({
    db: descriptor,
    name: 'items',
    id: tab,
    getKey: (row) => row.id,
    onInsert: () => {
      if (!holdNext) return Promise.resolve()
      holdNext = false
      return new Promise<void>((resolve, reject) => {
        held = { resolve, reject }
      })
    },
  })
  const sync = options.sync.sync
  let injected = 0
  const collection = createCollection({
    ...options,
    sync: {
      ...options.sync,
      sync: (params) => {
        let replace = false
        let writes: Array<Parameters<typeof params.write>[0]> = []
        return sync({
          ...params,
          begin: () => {
            replace = false
            writes = []
            return params.begin()
          },
          truncate: () => {
            truncates++
            replace = true
            return params.truncate()
          },
          write: (change) => {
            syncWrites.push(change.type)
            writes.push(change)
            return params.write(change)
          },
          commit: (...args) => {
            // Calibration mutant: only a reached overlapping replacement splits
            // its atomic publication, then repairs it. It is not a source defect.
            if (
              fault &&
              !injected &&
              replace &&
              writes.length > 1 &&
              callbacks.started - callbacks.completed >= 2
            ) {
              injected++
              const saved = writes.slice()
              params.truncate()
              params.write(saved[0]!)
              params.commit(...args)
              params.begin()
              params.truncate()
              for (const change of saved) params.write(change)
            }
            return params.commit(...args)
          },
        })
      },
    },
  })
  const extraRecords: Array<ReturnType<typeof recordCollection>> = []
  const transfers = new Set<Promise<void>>()
  const record = recordCollection(collection, tab, (event) => {
    const transfer = window.retainOracleEvent({ ...event, document, tab })
    transfers.add(transfer)
    void transfer.then(
      () => transfers.delete(transfer),
      (error: unknown) => {
        failures.push(`evidence transfer: ${String(error)}`)
        transfers.delete(transfer)
      },
    )
  })
  let startup = collection.preload()
  void startup.catch(() => undefined)
  return {
    ready: () => startup,
    subscribe: (initial: boolean) => {
      extraRecords.push(
        recordCollection(
          collection,
          `extra-${extraRecords.length}`,
          () => {},
          initial,
        ),
      )
    },
    subscriptions: () => extraRecords.map((extra) => extra.publications),
    observe: () => ({
      document,
      tab,
      rows: snapshot(collection.values()),
      status: collection.status,
      callbacks: { ...callbacks },
      reads: [...reads],
      writes: [...nativeWrites],
      failures: [...failures],
      publications: record.publications,
      statuses: record.statuses,
      sequence: record.events.length,
      injected,
      handlerStatus,
      syncWrites: [...syncWrites],
      truncates,
      versionChanges,
      schema: { ...schema },
      requestProgress,
    }),
    import: (rows: Array<OracleRow>) =>
      collection.utils.importData(structuredClone(rows)),
    repeatImport: (rows: Array<OracleRow>) =>
      Promise.all([
        collection.utils.importData(structuredClone(rows)),
        collection.utils.importData(structuredClone(rows)),
      ]),
    clear: () => collection.utils.clearObjectStore(),
    write: async (row: OracleRow) => {
      const transaction = collection.has(row.id)
        ? collection.update(row.id, (draft) => {
            draft.name = row.name
            if (row.optional === undefined) delete draft.optional
            else draft.optional = row.optional
          })
        : collection.insert(structuredClone(row))
      await transaction.isPersisted.promise
    },
    remove: async (key: string | number) => {
      await collection.delete(key).isPersisted.promise
    },
    omit: (row: OracleRow) => {
      // Manual acceptance admits both native transactions before the first
      // completes. Automatic writes now intentionally await their predecessor.
      const removed = createTransaction({
        autoCommit: false,
        mutationFn: ({ transaction }) =>
          collection.utils.acceptMutations(transaction),
      })
      removed.mutate(() => collection.delete(row.id))
      const inserted = createTransaction({
        autoCommit: false,
        mutationFn: ({ transaction }) =>
          collection.utils.acceptMutations(transaction),
      })
      inserted.mutate(() => collection.insert(structuredClone(row)))
      return Promise.all([removed.commit(), inserted.commit()])
    },
    holdStorage: async () => {
      gate = holdStore(descriptor.db)
      await gate.started
    },
    abortNextRead: () => {
      abortRead = true
    },
    abortNextWrite: () => {
      abortWrite = true
    },
    openBlocker: () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(database)
        request.onsuccess = () => {
          unmanaged = request.result
          resolve()
        }
        request.onerror = () => reject(request.error)
      }),
    closeBlocker: () => {
      unmanaged?.close()
      unmanaged = undefined
    },
    // Native deletion completes before this test-owned callback hold. A second
    // page may now recreate the database before the first page broadcasts.
    holdDeletionReceipt: () =>
      new Promise<void>((resolve, reject) => {
        const factory = indexedDB
        const nativeDelete = factory.deleteDatabase.bind(factory)
        factory.deleteDatabase = (name) => {
          const request = nativeDelete(name)
          Object.defineProperty(request, 'onsuccess', {
            get: () => null,
            set: (callback: (event: Event) => void) => {
              request.addEventListener('success', (event) => {
                deletionReceipt = () => callback.call(request, event)
                resolve()
              })
            },
          })
          request.addEventListener('error', () => reject(request.error))
          return request
        }
        try {
          deletion = collection.utils.deleteDatabase()
          void deletion.catch(reject)
        } finally {
          factory.deleteDatabase = nativeDelete
        }
      }),
    releaseDeletionReceipt: async () => {
      if (!deletionReceipt || !deletion)
        throw new Error('deletion receipt not held')
      deletionReceipt()
      await deletion
    },
    durable: () => collection.utils.exportData(),
    versions: () =>
      new Promise<Array<unknown>>((resolve, reject) => {
        const transaction = descriptor.db.transaction('_versions', 'readonly')
        const request = transaction.objectStore('_versions').getAll()
        transaction.oncomplete = () => resolve(request.result)
        transaction.onabort = () => reject(transaction.error)
      }),
    restart: async (abortOld: boolean) => {
      await collection.cleanup()
      if (abortOld)
        for (const tx of transactions) {
          if (tx.mode === 'readonly') {
            try {
              tx.abort()
            } catch {}
          }
        }
      startup = collection.preload()
      void startup.catch(() => undefined)
    },
    startSchema: (operation: 'upgrade' | 'delete') => {
      schema.status = 'pending'
      const request =
        operation === 'upgrade'
          ? indexedDB.open(database, 2)
          : indexedDB.deleteDatabase(database)
      request.addEventListener('blocked', () => {
        schema.blocked++
      })
      request.addEventListener('error', () => {
        schema.status = 'error'
        failures.push(String(request.error))
      })
      request.addEventListener('success', () => {
        if (operation === 'upgrade') request.result.close()
        schema.status = 'complete'
      })
    },
    armWriteBarrier: () => {
      arm = true
    },
    releaseBarrier: async () => {
      if (!gate) throw new Error('Write barrier was not reached')
      await gate.release()
      gate = undefined
    },
    holdInsert: () => {
      holdNext = true
      handlerStatus = 'pending'
      const transaction = collection.insert({
        id: 'held',
        name: 'unaccepted local intent',
      })
      void transaction.isPersisted.promise.then(
        () => {
          handlerStatus = 'fulfilled'
        },
        () => {
          handlerStatus = 'rejected'
        },
      )
    },
    settleInsert: (accept: boolean) => {
      if (!held) throw new Error('held handler not reached')
      if (accept) held.resolve()
      else held.reject(new Error('authored rejection'))
    },
    flushEvidence: async () => {
      // This acknowledges already captured events. It never waits for native
      // reads or application handlers, so their pending premise is observable.
      await Promise.all([...transfers])
      if (failures.length) throw new Error(failures.join('\n'))
      return { document, sequence: record.events.length, handlerStatus }
    },
    cleanup: async () => {
      unmanaged?.close()
      held?.reject(new Error('fixture cleanup'))
      await gate?.release()
      await collection.cleanup()
      record.stop()
      for (const extra of extraRecords) extra.stop()
      descriptor.close()
      if (query.get('cleanupFailure') === '1')
        throw new Error('injected cleanup failure')
    },
  }
}

void setup().then(
  (probe) => {
    window.crossTab = probe
  },
  (error: unknown) => {
    window.crossTabFailure = String(error)
  },
)
