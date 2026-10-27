// Controlled HTTP provider, deferred promises, shared response headers, and the
// controlled coordinator for the installed-SDK delivery tests. The oracle in
// electric-sdk-delivery-oracle.property.test.ts and the hand-written cases in
// electric-sdk-delivery.test.ts both use them.
import { vi } from 'vitest'
import { SingleProcessCoordinator } from '../../db-sqlite-persistence-core/src'
import type {
  ProtocolEnvelope,
  TxCommitted,
} from '../../db-sqlite-persistence-core/src'

export type Item = { id: number; name: string }

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export type Request = { url: URL; respond: (response: Response) => void }

// The finite provider only holds responses and observes each fetch's signal.
export function controlledHttp() {
  const queued: Array<Request> = []
  const waiting: Array<{
    snapshot: boolean | undefined
    resolve: (request: Request) => void
    reject: (error: unknown) => void
  }> = []
  const active = new Set<() => void>()
  let closed = false
  const closedError = new Error(`Electric oracle HTTP provider closed`)
  const isSnapshot = (request: Request) =>
    request.url.searchParams.has(`subset__where`)
  const fetchClient: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      if (closed) {
        reject(closedError)
        return
      }
      const signal = init?.signal
      const url = new URL(String(input))
      const request: Request = {
        url,
        respond: (response) => {
          remove()
          resolve(response)
        },
      }
      const remove = () => {
        signal?.removeEventListener(`abort`, abort)
        active.delete(abort)
        const index = queued.indexOf(request)
        if (index >= 0) queued.splice(index, 1)
      }
      const abort = () => {
        remove()
        reject(
          signal?.reason ??
            new DOMException(`Provider request aborted`, `AbortError`),
        )
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      active.add(abort)
      const index = waiting.findIndex(
        (waiter) =>
          waiter.snapshot === undefined ||
          waiter.snapshot === isSnapshot(request),
      )
      if (index >= 0) waiting.splice(index, 1)[0]!.resolve(request)
      else queued.push(request)
    })
  return {
    fetchClient,
    take: (snapshot = false): Promise<Request> => {
      if (closed) return Promise.reject(closedError)
      const index = queued.findIndex(
        (request) => isSnapshot(request) === snapshot,
      )
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]!)
      return new Promise((resolve, reject) =>
        waiting.push({ snapshot, resolve, reject }),
      )
    },
    takeAny: (): Promise<Request> => {
      if (closed) return Promise.reject(closedError)
      if (queued.length > 0) return Promise.resolve(queued.shift()!)
      return new Promise((resolve, reject) =>
        waiting.push({ snapshot: undefined, resolve, reject }),
      )
    },
    close: () => {
      closed = true
      for (const abort of [...active]) abort()
      for (const waiter of waiting.splice(0)) waiter.reject(closedError)
    },
    activeCount: () => active.size,
  }
}

export const headers = (offset: number) => ({
  'electric-handle': `shape`,
  'electric-offset': `${offset}_0`,
  'electric-cursor': String(offset),
  'electric-up-to-date': `true`,
  'electric-schema': JSON.stringify({
    id: { type: `int4` },
    name: { type: `text` },
  }),
})

// Deliver a coordinator notification through the same persistence wrapper
// used by the installed-SDK receiver. The test still controls the provider
// response independently of this durable-cache notification.
export function controlledCoordinator(collectionId: string) {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  return Object.assign(new SingleProcessCoordinator(), {
    subscribe: (
      _collectionId: string,
      onMessage: (message: ProtocolEnvelope<unknown>) => void,
    ) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    emit: (payload: TxCommitted) => {
      subscriber?.({
        v: 1,
        dbName: `sdk-receiver`,
        collectionId,
        senderId: `other-tab`,
        ts: Date.now(),
        payload,
      })
    },
  })
}

// EventTarget registration identity is callback plus capture. Replay native
// add/remove calls in order: a removal cannot erase a later registration, and
// repeated additions of one identity retain one listener. The installed SDK
// uses no once or signal options, which would need automatic-removal tracking.
export function recordVisibilityListeners() {
  const add = vi.spyOn(document, `addEventListener`)
  const remove = vi.spyOn(document, `removeEventListener`)
  const visibility = (calls: Array<Array<unknown>>) =>
    calls
      .filter(([type]) => type === `visibilitychange`)
      .map(([, listener]) => listener)
  return {
    registered: () => visibility(add.mock.calls).length,
    live: () => {
      const calls = [
        ...add.mock.calls.map((call, index) => ({
          call,
          adding: true,
          order: add.mock.invocationCallOrder[index]!,
        })),
        ...remove.mock.calls.map((call, index) => ({
          call,
          adding: false,
          order: remove.mock.invocationCallOrder[index]!,
        })),
      ].sort((left, right) => left.order - right.order)
      const listeners = new Map<
        EventListenerOrEventListenerObject,
        Set<boolean>
      >()
      for (const {
        call: [type, listener, options],
        adding,
      } of calls) {
        if (type !== `visibilitychange`) continue
        const capture =
          typeof options === `boolean` ? options : Boolean(options?.capture)
        if (adding) {
          const captures = listeners.get(listener) ?? new Set<boolean>()
          captures.add(capture)
          listeners.set(listener, captures)
        } else listeners.get(listener)?.delete(capture)
      }
      return [...listeners.values()].reduce(
        (count, captures) => count + captures.size,
        0,
      )
    },
    restore: () => {
      // The comparison has already run. Release even a failed subject's
      // registrations so RED runs and shrinking do not retain dead streams.
      try {
        for (const [type, listener, options] of add.mock.calls)
          if (type === `visibilitychange`)
            document.removeEventListener(type, listener, options)
      } finally {
        add.mockRestore()
        remove.mockRestore()
      }
    },
  }
}
