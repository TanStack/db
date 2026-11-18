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

export { controlledHttp, deferred, headers } from './sdk-http'
export type { Item, Request } from './sdk-http'

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
