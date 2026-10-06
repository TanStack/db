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
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
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
import { completed, deferred, readStore, request, withHarness } from './harness'
import type { Row } from './harness'

// These comparisons keep operation context while allowing the native provider
// to own its error text. Abort follows invocation immediately, so the request
// must already exist; deferring request creation would miss the error event.
it('preserves native request-error text with operation context', async () => {
  await withHarness(async (h) => {
    const tx = h.db.db.transaction('items', 'readonly')
    const done = completed(tx).catch(() => undefined)
    const nativeErrors: Array<DOMException> = []
    tx.addEventListener('error', (event) => {
      nativeErrors.push((event.target as IDBRequest).error!)
    })
    const result = getAll(tx.objectStore('items')).catch(
      (error: unknown) => error,
    )
    tx.abort()
    const error = await result
    await done
    expect(nativeErrors).toHaveLength(1)
    expect((error as Error).cause, 'request failure identity').toBe(
      nativeErrors[0],
    )
    expect(error).toEqual(
      new Error(
        `Failed to get all items from object store "items": ${nativeErrors[0]!.message}`,
      ),
    )
  })
})

it('preserves synchronous DOMException text as a rejected Promise', async () => {
  await withHarness(async (h) => {
    const tx = h.db.db.transaction('items', 'readonly')
    const done = completed(tx).catch(() => undefined)
    const store = tx.objectStore('items')
    tx.abort()
    await done
    let nativeError: unknown
    try {
      store.getAll()
    } catch (error) {
      nativeError = error
    }
    expect(nativeError).toBeInstanceOf(DOMException)
    // This provider DOMException is outside the test environment's Error realm.
    expect(nativeError).not.toBeInstanceOf(Error)
    const result = getAll(store)
    await expect(result).rejects.toHaveProperty(
      'cause',
      expect.objectContaining({ name: 'TransactionInactiveError' }),
    )
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toEqual(
      new Error(
        `Failed to get all items from object store "items": ${String(nativeError)}`,
      ),
    )
  })
})

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

// Native completion makes these rows durable even while the callback remains
// pending. A later callback rejection retains its identity, but cannot roll back
// a transaction that has already completed. This law stops at the fake-IDB seam.
it('retains committed rows when a held readwrite callback later rejects', async () => {
  await withHarness(async (h) => {
    const row = { id: 1, name: 'committed' }
    const gate = deferred()
    const nativeDone = deferred()
    const failure = new Error('callback rejected after commit')
    let settled = false
    const outcome = executeTransaction(
      h.db.db,
      'items',
      'readwrite',
      (tx, stores) => {
        stores.items!.put(row, row.id)
        tx.addEventListener('complete', () => nativeDone.resolve())
        return gate.promise
      },
    ).then(
      () => {
        settled = true
        return undefined
      },
      (error: unknown) => {
        settled = true
        return error
      },
    )
    await nativeDone.promise
    await Promise.resolve()
    const early = settled
    const committed = await readStore<Row>(h.db, 'items')
    gate.reject(failure)
    const result = await outcome
    expect(early, 'native completion does not settle the held callback').toBe(
      false,
    )
    expect(committed.rows, 'native completion made the write durable').toEqual([
      row,
    ])
    expect(result).toBe(failure)
    expect((await readStore<Row>(h.db, 'items')).rows).toEqual([row])
  })
})

// Native blocked events are nonterminal: the caller promise remains pending until
// native success or failure. This transfers the settlement distinction from
// offline-transactions/tests/indexeddb-write-settlement.test.ts. Successful open
// transfers the connection to the caller; closing it permits a later upgrade and
// deletion. This transfers the resource-ownership law from the OPFS lifecycle
// oracle, but not its worker cancellation or deadline policy: native IndexedDB
// open/delete requests have no equivalent cancellation API here.
//
// The finite grammar crosses open/delete with blocked/unblocked. The independent
// rule is pending at blocked, fulfilled at native success, and no blocker after
// caller close. Fake IndexedDB supplies native events; the wrapper supplies the
// observed promise and connection. Captured handles are cleanup-only until after
// the caller-owned close and native suffix have established resource release.
// These histories make no browser scheduling, lock-timeout, or fallback claim.
for (const operation of ['open', 'delete'] as const) {
  for (const blocked of [false, true]) {
    it(
      operation +
        ' settles at native success with temporary blockers ' +
        blocked,
      async () => {
        const factory = new FakeIDBFactory()
        const name = crypto.randomUUID()
        const blocker = await openDatabase(name, 1, undefined, factory)
        if (!blocked) blocker.close()
        const entered = deferred()
        const terminal = deferred()
        let opened: IDBDatabase | undefined
        let blockedEvents = 0
        function observe(opening: IDBOpenDBRequest): IDBOpenDBRequest {
          opening.addEventListener('blocked', () => {
            blockedEvents++
            entered.resolve()
          })
          opening.addEventListener('success', () => {
            if (operation === 'open') opened = opening.result
            terminal.resolve()
          })
          opening.addEventListener('error', () => {
            terminal.reject(opening.error ?? new Error('native opening failed'))
          })
          return opening
        }
        const nativeOpen = factory.open.bind(factory)
        const openSpy = vi
          .spyOn(factory, 'open')
          .mockImplementation((...args) => observe(nativeOpen(...args)))
        const nativeDelete = factory.deleteDatabase.bind(factory)
        const deleteSpy = vi
          .spyOn(factory, 'deleteDatabase')
          .mockImplementation((...args) => observe(nativeDelete(...args)))
        let status = 'pending'
        let statusAtBlocked: string | undefined
        let result: unknown
        try {
          const promise =
            operation === 'open'
              ? openDatabase(name, 2, undefined, factory)
              : deleteDatabase(name, factory)
          const outcome = promise.then(
            (value) => {
              status = 'fulfilled'
              return value
            },
            (error: unknown) => {
              status = 'rejected'
              return error
            },
          )
          if (blocked) {
            await entered.promise
            await Promise.resolve()
            statusAtBlocked = status
            blocker.close()
          }
          await terminal.promise
          result = await outcome
          expect(blockedEvents, 'native blocker premise reached').toBe(
            blocked ? 1 : 0,
          )
          if (blocked)
            expect(statusAtBlocked, 'blocked caller settlement').toBe('pending')
          expect(status, 'terminal caller settlement').toBe('fulfilled')
          expect(result, 'caller owns the native result').toBe(
            operation === 'open' ? opened : undefined,
          )

          if (operation === 'open') {
            // Use only the returned connection to release ownership. Closing the
            // captured native handle before this cut would conceal an orphan.
            ;(result as IDBDatabase).close()
            let suffixBlocked = 0
            const upgrade = nativeOpen(name, 3)
            upgrade.addEventListener('blocked', () => {
              suffixBlocked++
              opened?.close()
            })
            const upgraded = await request(upgrade)
            upgraded.close()
            await request(nativeDelete(name))
            expect(
              suffixBlocked,
              'caller close releases the native connection',
            ).toBe(0)
          }
        } finally {
          blocker.close()
          opened?.close()
          openSpy.mockRestore()
          deleteSpy.mockRestore()
        }
      },
    )
  }
}

// Failure is a different terminal outcome from blocking. A lower-version open
// cannot upgrade; an explicitly aborted upgrade must preserve the old schema and
// rows. The finite grammar includes abort with and without a temporary blocker;
// lower-version rejection precedes blocking by IndexedDB's version rules.
// Expected durable rows are authored constants, read through raw native requests.
// Compare caller diagnostics after native failure, then retained version/schema/
// rows after a fresh open and one successful write. This rejects a driver that
// returns the expected error while leaving a partial upgrade or orphan connection.
for (const failure of ['lower-version', 'abort-upgrade'] as const) {
  for (const blocked of failure === 'lower-version' ? [false] : [false, true]) {
    it(
      failure + ' preserves durable state with temporary blockers ' + blocked,
      async () => {
        const factory = new FakeIDBFactory()
        const name = crypto.randomUUID()
        const retained = { id: 'retained', name: 'durable before failure' }
        const suffix = { id: 'suffix', name: 'durable after failure' }
        const version = failure === 'lower-version' ? 2 : 1
        const initial = factory.open(name, version)
        initial.onupgradeneeded = () =>
          initial.result.createObjectStore('items')
        const blocker = await request(initial)
        const seed = blocker.transaction('items', 'readwrite')
        const seeded = completed(seed)
        seed.objectStore('items').put({ ...retained }, retained.id)
        await seeded
        if (!blocked) blocker.close()

        const entered = deferred()
        const terminal = deferred()
        const nativeOpen = factory.open.bind(factory)
        const native = { error: null as DOMException | null }
        let blockedEvents = 0
        let upgradeCalls = 0
        let abortedConnection: IDBDatabase | undefined
        const openSpy = vi
          .spyOn(factory, 'open')
          .mockImplementation((...args) => {
            const opening = nativeOpen(...args)
            opening.addEventListener('blocked', () => {
              blockedEvents++
              entered.resolve()
            })
            opening.addEventListener('error', () => {
              native.error = opening.error
              terminal.resolve()
            })
            opening.addEventListener('success', () => {
              opening.result.close()
              terminal.reject(
                new Error('failing native open unexpectedly succeeded'),
              )
            })
            return opening
          })
        let status = 'pending'
        let statusAtBlocked: string | undefined
        let restored: IDBDatabase | undefined
        try {
          const outcome = openDatabase(
            name,
            failure === 'lower-version' ? 1 : 2,
            (database, _old, _next, transaction) => {
              upgradeCalls++
              abortedConnection = database
              database.createObjectStore('uncommitted')
              transaction
                .objectStore('items')
                .put(
                  { id: retained.id, name: 'uncommitted replacement' },
                  retained.id,
                )
              transaction.abort()
            },
            factory,
          ).then(
            (value) => {
              status = 'fulfilled'
              return value
            },
            (error: unknown) => {
              status = 'rejected'
              return error
            },
          )
          if (blocked) {
            await entered.promise
            await Promise.resolve()
            statusAtBlocked = status
            blocker.close()
          }
          await terminal.promise
          const result = await outcome
          expect(blockedEvents, 'native blocker premise reached').toBe(
            blocked ? 1 : 0,
          )
          if (blocked)
            expect(statusAtBlocked, 'blocked caller settlement').toBe('pending')
          expect(upgradeCalls, 'native upgrade failure premise reached').toBe(
            failure === 'abort-upgrade' ? 1 : 0,
          )
          expect(native.error).toMatchObject({
            name: failure === 'lower-version' ? 'VersionError' : 'AbortError',
          })
          expect(status, 'native failure rejects the caller').toBe('rejected')
          expect(result, 'native diagnostic survives wrapper context').toEqual(
            new Error(
              `Failed to open IndexedDB database "${name}": ${native.error?.message}`,
            ),
          )

          restored = await request(nativeOpen(name, version))
          expect(
            restored.version,
            'failed upgrade retains the durable version',
          ).toBe(version)
          expect(Array.from(restored.objectStoreNames)).toEqual(['items'])
          const read = restored.transaction('items', 'readonly')
          const readDone = completed(read)
          const rows = await request(read.objectStore('items').getAll())
          await readDone
          expect(rows, 'native failure retains the durable rows').toEqual([
            retained,
          ])
          const write = restored.transaction('items', 'readwrite')
          const writeDone = completed(write)
          write.objectStore('items').put({ ...suffix }, suffix.id)
          await writeDone
          const finalRead = restored.transaction('items', 'readonly')
          const finalDone = completed(finalRead)
          const finalRows = await request(
            finalRead.objectStore('items').getAll(),
          )
          await finalDone
          expect(
            finalRows,
            'successful suffix preserves the retained row',
          ).toEqual([retained, suffix])
          restored.close()
          await request(factory.deleteDatabase(name))
        } finally {
          blocker.close()
          abortedConnection?.close()
          restored?.close()
          openSpy.mockRestore()
        }
      },
    )
  }
}

// The wrapper supplies operation context, while the native error supplies the
// machine-readable failure kind. Compare against the actual request error,
// including cross-realm DOMExceptions, rather than matching error messages.
it('retains the native open failure as its cause', async () => {
  const factory = new FakeIDBFactory()
  const name = crypto.randomUUID()
  const db = await openDatabase(name, 2, undefined, factory)
  db.close()
  const original = factory.open.bind(factory)
  let native: DOMException | null = null
  vi.spyOn(factory, 'open').mockImplementation((...args) => {
    const req = original(...args)
    req.addEventListener('error', () => {
      native = req.error
    })
    return req
  })
  try {
    const failure = await openDatabase(name, 1, undefined, factory).catch(
      (error: unknown) => error,
    )
    expect(native).toMatchObject({ name: 'VersionError' })
    expect((failure as Error).cause, 'open failure identity').toBe(native)
  } finally {
    vi.restoreAllMocks()
  }
})

// The cause law crosses separate wrapper error branches, not only the shared
// getAll request helper: issue open/delete, create a store, and create a
// transaction. These pre-request failures allocate no native work. The native
// object is the independent expected cause even when its name chooses a
// specialized context message; no new error taxonomy is promised.
for (const kind of ['InvalidStateError', 'ConstraintError', 'SecurityError']) {
  it(`retains ${kind} identity across native operation admission`, async () => {
    await withHarness(async (h) => {
      const failure = new DOMException('native admission failure', kind)
      const factory = new FakeIDBFactory()
      vi.spyOn(factory, 'open').mockImplementation(() => {
        throw failure
      })
      vi.spyOn(factory, 'deleteDatabase').mockImplementation(() => {
        throw failure
      })
      const openFailure = await openDatabase(
        'failed',
        1,
        undefined,
        factory,
      ).catch((error: unknown) => error)
      expect((openFailure as Error).cause).toBe(failure)
      const deleteFailure = await deleteDatabase('failed', factory).catch(
        (error: unknown) => error,
      )
      expect((deleteFailure as Error).cause).toBe(failure)
      vi.spyOn(h.db.db, 'createObjectStore').mockImplementation(() => {
        throw failure
      })
      let caught: unknown
      try {
        createObjectStore(h.db.db, 'failed')
      } catch (error) {
        caught = error
      }
      expect((caught as Error).cause).toBe(failure)
      vi.spyOn(h.db.db, 'transaction').mockImplementation(() => {
        throw failure
      })
      const transactionFailure = await executeTransaction(
        h.db.db,
        'items',
        'readwrite',
        () => undefined,
      ).catch((error: unknown) => error)
      expect((transactionFailure as Error).cause).toBe(failure)
    })
  })
}
