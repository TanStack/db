/**
 * Native provider mechanics, with no expected product values. A test-owned
 * readwrite transaction repeatedly issues real requests while held. Conflicting
 * transactions queue behind it under IndexedDB's ordinary scope ordering.
 * No transaction continuation awaits a foreign promise. This controls provider
 * admission, not the adapter's work, and works in fake-IDB and real browsers.
 */
export function holdStore(db: IDBDatabase, stores = ['items', '_versions']) {
  let release = false
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const transaction = db.transaction(stores, 'readwrite')
  const finished = new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('gate transaction aborted')),
    )
  })
  void finished.catch(() => undefined)
  function next() {
    const request = transaction.objectStore(stores[0]!).get('__oracle_gate__')
    request.addEventListener('success', () => {
      entered()
      if (!release) next()
    })
  }
  next()
  return {
    started,
    finished,
    release: () => {
      release = true
      return finished
    },
    abort: () => transaction.abort(),
  }
}

export function observeTransactions(db: IDBDatabase) {
  const entries: Array<{
    mode: IDBTransactionMode
    status: 'pending' | 'complete' | 'abort'
    transaction: IDBTransaction
  }> = []
  const original = db.transaction
  db.transaction = function (...args) {
    const transaction = original.apply(this, args)
    const entry: (typeof entries)[number] = {
      mode: transaction.mode,
      status: 'pending',
      transaction,
    }
    entries.push(entry)
    transaction.addEventListener('complete', () => {
      entry.status = 'complete'
    })
    transaction.addEventListener('abort', () => {
      entry.status = 'abort'
    })
    return transaction
  }
  return {
    entries,
    restore: () => {
      db.transaction = original
    },
  }
}
