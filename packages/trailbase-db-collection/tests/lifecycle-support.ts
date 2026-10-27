import { vi } from 'vitest'
import type { Event, ListResponse } from 'trailbase'

/**
 * Shared controls for the TrailBase lifecycle tests. The gated source, the
 * settle helpers, and the row type serve both lifecycle-oracle.property.test.ts,
 * which owns the lifecycle laws, and lifecycle.test.ts, which holds the
 * hand-written startup control.
 */

export type Row = { id: number; value: number }

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  // Every adapter promise is observed even when its sync run is abandoned.
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

export function observe(promise: Promise<unknown>) {
  let result: `pending` | `fulfilled` | `rejected` = `pending`
  let error: unknown
  void promise.then(
    () => {
      result = `fulfilled`
    },
    (failure: unknown) => {
      result = `rejected`
      error = failure
    },
  )
  return {
    get result() {
      return result
    },
    get error() {
      return error
    },
  }
}

// All adapter I/O is gated. One host turn drains native stream microtasks and
// exposes detached rejections; it does not stand in for a network completion.
export const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
export const failure = new Error(`oracle stream failure`)
export const invalidValue = -10_000

export function source() {
  let controller!: ReadableStreamDefaultController<Event>
  const cancel = vi.fn((): void | Promise<void> => {})
  const stream = new ReadableStream<Event>({
    start(value) {
      controller = value
    },
    cancel,
  })
  return {
    stream,
    cancel,
    controller,
    subscription: deferred<ReadableStream<Event>>(),
    list: deferred<ListResponse<Row>>(),
    listCalls: 0,
  }
}
