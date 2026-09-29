import { afterEach, expect, it, vi } from 'vitest'
import { IndexedDBAdapter } from '../src/storage/IndexedDBAdapter'

type Write = `set` | `delete` | `clear`
const writes: Array<Write> = [`set`, `delete`, `clear`]

// A successful request may still belong to a transaction that later aborts.
// This small fixture controls only that boundary, not IndexedDB's data model.
function controlledWrite(issueError?: Error) {
  const request = {
    onsuccess: null,
    onerror: null,
    error: null,
  } as unknown as IDBRequest
  const transaction = {
    oncomplete: null,
    onabort: null,
    error: null,
  } as unknown as IDBTransaction
  let issued!: () => void
  const started = new Promise<void>((resolve) => {
    issued = resolve
  })
  const issue = vi.fn(() => {
    issued()
    if (issueError) throw issueError
    return request
  })
  const store = {
    transaction,
    put: issue,
    delete: issue,
    clear: issue,
  } as unknown as IDBObjectStore
  const adapter = new IndexedDBAdapter(`controlled-write`)
  vi.spyOn(
    adapter as unknown as { getStore: () => Promise<IDBObjectStore> },
    `getStore`,
  ).mockResolvedValue(store)
  const fire = (handler: ((event: Event) => unknown) | null, type: string) =>
    handler?.call(transaction, new Event(type))
  return {
    start: async (write: Write) => {
      const promise =
        write === `set`
          ? adapter.set(`key`, `value`)
          : write === `delete`
            ? adapter.delete(`key`)
            : adapter.clear()
      const outcome: {
        state: `pending` | `resolved` | `rejected`
        error?: unknown
      } = { state: `pending` }
      const observed = promise.then(
        () => {
          outcome.state = `resolved`
        },
        (error: unknown) => {
          outcome.state = `rejected`
          outcome.error = error
        },
      )
      await started
      return { observed, outcome }
    },
    requestSuccess: () => fire(request.onsuccess, `success`),
    requestFailure: (error: DOMException) => {
      Object.defineProperty(request, `error`, { value: error })
      fire(request.onerror, `error`)
    },
    commit: () => fire(transaction.oncomplete, `complete`),
    abort: (error: DOMException | null) => {
      Object.defineProperty(transaction, `error`, { value: error })
      fire(transaction.onabort, `abort`)
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(writes)(
  `keeps %s pending after request success until transaction commit`,
  async (write) => {
    vi.useFakeTimers()
    const storage = controlledWrite()
    const { observed, outcome } = await storage.start(write)
    storage.requestSuccess()
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome.state).toBe(`pending`)
    storage.commit()
    await observed
    expect(outcome.state).toBe(`resolved`)
  },
)

it.each(writes)(
  `rejects %s with the exact transaction error after request success`,
  async (write) => {
    const storage = controlledWrite()
    const { observed, outcome } = await storage.start(write)
    const error = new DOMException(`transaction lost`, `QuotaExceededError`)
    storage.requestSuccess()
    storage.abort(error)
    await observed
    expect(outcome.state).toBe(`rejected`)
    expect(outcome.error).toBe(error)
  },
)

it.each(writes)(
  `rejects %s when an explicit transaction abort has no error object`,
  async (write) => {
    const storage = controlledWrite()
    const { observed, outcome } = await storage.start(write)
    storage.requestSuccess()
    storage.abort(null)
    await observed
    expect(outcome.state).toBe(`rejected`)
    expect(outcome.error).toMatchObject({ name: `AbortError` })
  },
)

it.each(writes)(`preserves a synchronous %s issue error`, async (write) => {
  const error = new DOMException(`write could not start`, `InvalidStateError`)
  const storage = controlledWrite(error)
  const { observed, outcome } = await storage.start(write)
  await observed
  expect(outcome.state).toBe(`rejected`)
  expect(outcome.error).toBe(error)
})

it.each(writes)(
  `rejects %s after a failed request aborts its transaction`,
  async (write) => {
    const error = new DOMException(`request failed`, `QuotaExceededError`)
    const storage = controlledWrite()
    const { observed, outcome } = await storage.start(write)
    storage.requestFailure(error)
    storage.abort(error)
    await observed
    expect(outcome.state).toBe(`rejected`)
    expect(outcome.error).toBe(error)
  },
)
