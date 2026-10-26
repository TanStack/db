/**
 * Chromium driver for the OPFS request-order oracle in
 * `tests/opfs-request-order-oracle.ts`. It runs every fixed example through
 * the public connection, the real worker, and real OPFS. It takes the access
 * handle with OPFSCoopSyncVFS's own handoff: notify the handle's
 * BroadcastChannel, then hold its Web Lock. Chromium's lock inventory shows
 * when the connection's request waits for that lock.
 */
import { openBrowserWASQLiteOPFSDatabase } from '../src/index'
import {
  findRequestOrderViolation,
  observeRequestOrder,
  requestOrderExamples,
} from '../tests/opfs-request-order-oracle'
import type {
  AccessHandleControl,
  RequestOrderHistory,
  RequestOrderObservation,
} from '../tests/opfs-request-order-oracle'

export type OPFSRequestOrderResult =
  | {
      status: `complete`
      results: Array<{
        history: RequestOrderHistory
        observation: RequestOrderObservation
        violation: string | undefined
      }>
    }
  | { status: `failed-before-checkpoint`; primaryFailure: string }

declare global {
  interface Window {
    __tanstackOPFSRequestOrderOracle?: OPFSRequestOrderResult
  }
}

function chromiumHandleControl(databaseName: string): AccessHandleControl {
  const lockName = `ahp:/${databaseName}`
  let release: (() => void) | undefined
  return {
    take: () =>
      new Promise<void>((acquired) => {
        new BroadcastChannel(lockName).postMessage(null)
        void navigator.locks.request(lockName, () => {
          acquired()
          return new Promise<void>((resolve) => {
            release = resolve
          })
        })
      }),
    untilWaiting: async () => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const { pending = [] } = await navigator.locks.query()
        if (pending.some((lock) => lock.name === lockName)) return true
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return false
    },
    // A Worker message crosses threads; this bounds the delivery wait.
    untilDelivered: () => new Promise((resolve) => setTimeout(resolve, 100)),
    give: () => {
      release?.()
      release = undefined
      return Promise.resolve()
    },
  }
}

async function run(): Promise<void> {
  const status = document.querySelector<HTMLOutputElement>(`#oracle-status`)
  try {
    const results = []
    for (const [index, history] of requestOrderExamples.entries()) {
      // OPFS database names near 63 characters fail to open; keep them short.
      const databaseName = `ro-${index}-${crypto.randomUUID().slice(0, 8)}.sqlite`
      const observation = await observeRequestOrder(
        (name) => openBrowserWASQLiteOPFSDatabase({ databaseName: name }),
        chromiumHandleControl(databaseName),
        history,
        databaseName,
      )
      results.push({
        history,
        observation,
        violation: findRequestOrderViolation(history, observation),
      })
    }
    window.__tanstackOPFSRequestOrderOracle = { status: `complete`, results }
    if (status) status.value = `complete`
  } catch (error) {
    window.__tanstackOPFSRequestOrderOracle = {
      status: `failed-before-checkpoint`,
      primaryFailure: error instanceof Error ? error.message : String(error),
    }
    if (status) status.value = `failed-before-checkpoint`
  }
}

void run()
