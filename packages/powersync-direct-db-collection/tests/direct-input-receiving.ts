/**
 * Observe actual receiving work without supplying a product judgment. SDK
 * waits, source receipts and storage operations retain their original values,
 * promises, arguments and receivers. A released or aborted SDK wait supplies no
 * further provider-input obligation. Storage promises remain obligations until
 * their actual settlement, including adapters resolved for a Collection/mode.
 * The HTTP pump answers only actual successor requests with the authored input.
 */
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import type { StreamLease } from '@powersync/standalone-client'
import type { SyncAppliedReceipt } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'

type InputKind = `SDK wait` | `source receipt` | `storage`
type InputCut = `admission` | `provider` | `applied`
type InputDelivery = {
  requestRevision: () => number
  requestOpen: () => boolean
  /** The actual request revision captured by this delivered checkpoint. */
  deliver: () => Promise<number>
  additionalRevision?: () => number
}
type InputWork = {
  kind: InputKind
  name: string
  state: `pending` | `fulfilled` | `rejected`
  error?: string
  ignored?: () => boolean
}

export function createDirectInputLedger({
  storageResponseDelay = () => 0,
}: {
  /** A controlled host-latency probe; normal forwarding supplies zero. */
  storageResponseDelay?: () => number
} = {}) {
  const work: Array<InputWork> = []
  let revision = 0
  const observe = <T>(
    kind: InputKind,
    name: string,
    operation: () => T,
    ignored?: () => boolean,
  ): T => {
    const entry: InputWork = { kind, name, state: `pending`, ignored }
    work.push(entry)
    revision++
    const fulfilled = () => {
      entry.state = `fulfilled`
      revision++
    }
    const rejected = (error: unknown) => {
      entry.state = `rejected`
      entry.error = describeOracleCleanupError(error)
      revision++
    }
    try {
      const result = operation()
      if (result instanceof Promise) void result.then(fulfilled, rejected)
      else fulfilled()
      return result
    } catch (error) {
      rejected(error)
      throw error
    }
  }
  const persistenceCopies = new WeakMap<
    PersistedCollectionPersistence,
    PersistedCollectionPersistence
  >()
  const persistence = (
    actual: PersistedCollectionPersistence,
  ): PersistedCollectionPersistence => {
    const previous = persistenceCopies.get(actual)
    if (previous) return previous
    const forwarded: PersistedCollectionPersistence = {
      ...actual,
      adapter: new Proxy(actual.adapter, {
        get(target, key) {
          const method: unknown = Reflect.get(target, key, target)
          if (typeof method !== `function`) return method
          // Keep function properties such as a scheduler's afterQueuedWork.
          // Only invocation changes: the real adapter remains the receiver.
          return new Proxy(method, {
            apply(_method, _receiver, args: Array<unknown>) {
              return observe(`storage`, String(key), () => {
                const result: unknown = Reflect.apply(method, target, args)
                const delay = storageResponseDelay()
                if (!(result instanceof Promise) || delay === 0) return result
                // This explicit fault-control delays only delivery of the real
                // adapter result. It never authors rows or a load verdict.
                const wait = () =>
                  new Promise<void>((resolve) => setTimeout(resolve, delay))
                return result.then(
                  async (value: unknown) => {
                    await wait()
                    return value
                  },
                  async (error: unknown) => {
                    await wait()
                    throw error
                  },
                )
              })
            },
          })
        },
      }),
      ...(actual.resolvePersistenceForCollection
        ? {
            resolvePersistenceForCollection: (input) =>
              persistence(actual.resolvePersistenceForCollection!(input)),
          }
        : {}),
      ...(actual.resolvePersistenceForMode
        ? {
            resolvePersistenceForMode: (mode) =>
              persistence(actual.resolvePersistenceForMode!(mode)),
          }
        : {}),
    }
    persistenceCopies.set(actual, forwarded)
    return forwarded
  }
  const snapshot = () => {
    const pending = work.filter(
      (entry) => entry.state === `pending` && !entry.ignored?.(),
    )
    return {
      revision,
      pendingSDK: pending.filter((entry) => entry.kind === `SDK wait`).length,
      pendingStorage: pending
        .filter((entry) => entry.kind === `storage`)
        .map((entry) => entry.name),
      pendingReceipts: pending.filter(
        (entry) => entry.kind === `source receipt`,
      ).length,
      work: work.map(({ ignored, ...entry }) => ({
        ...entry,
        ignored: ignored?.() === true,
      })),
    }
  }
  const drain = async (
    cut: InputCut,
    delivery?: InputDelivery & { delivered: number },
  ) => {
    const deadline = Date.now() + 5000
    let quiet = 0
    let previous = ``
    while (quiet < 4) {
      if (
        delivery?.requestOpen() &&
        delivery.requestRevision() !== delivery.delivered
      )
        delivery.delivered = await delivery.deliver()
      const current = snapshot()
      const marker = `${current.revision}:${delivery?.requestRevision() ?? 0}:${delivery?.additionalRevision?.() ?? 0}`
      quiet =
        (cut === `admission` || !current.pendingSDK) &&
        (cut === `provider` || !current.pendingStorage.length) &&
        (cut !== `applied` || !current.pendingReceipts) &&
        marker === previous
          ? quiet + 1
          : 0
      previous = marker
      if (Date.now() > deadline)
        throw new Error(
          `Direct receiving ${cut} input did not settle: ${JSON.stringify(current)}`,
        )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return {
      ...snapshot(),
      cut,
      quietTurns: quiet,
      deliveredRequest: delivery?.delivered,
    }
  }
  return {
    persistence,
    snapshot,
    receipt: (actual: SyncAppliedReceipt) =>
      observe(`source receipt`, `commit`, () => actual),
    receiveStreamLease: (actual: StreamLease): StreamLease => {
      let released = false
      revision++
      return {
        waitForSync: (signal) =>
          observe(
            `SDK wait`,
            `waitForSync`,
            () => actual.waitForSync(signal),
            () => released || signal?.aborted === true,
          ),
        release: () => {
          released = true
          revision++
          actual.release()
        },
      }
    },
    drain: (cut: InputCut = `applied`) => drain(cut),
    receive: async ({
      cut = `applied`,
      ...delivery
    }: InputDelivery & { cut?: InputCut }) => {
      // deliver waits for/captures its target itself. Its returned revision,
      // rather than a revision sampled before that wait, identifies the input
      // already delivered. A replacement can open another request meanwhile.
      const delivered = await delivery.deliver()
      return drain(cut, { ...delivery, delivered })
    },
    // A deliberately held application can open a successor only after the
    // provider cut returned. Resume the same input obligation without sending
    // another checkpoint to the request that already consumed it.
    continue: ({
      cut = `applied`,
      deliveredRequest,
      ...delivery
    }: InputDelivery & { cut?: InputCut; deliveredRequest: number }) =>
      drain(cut, { ...delivery, delivered: deliveredRequest }),
  }
}

export type DirectInputLedger = ReturnType<typeof createDirectInputLedger>
