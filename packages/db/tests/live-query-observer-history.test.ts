/**
 * Ordinary LiveQueryObserver tests: a stale ready notification after disposal
 * is rejected on the granular and wholesale status paths, and failed
 * subscription setup releases its acquired resources. The eligibility ledger
 * and delivery law are owned by live-query-observer-history-oracle.property.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { DbClient } from '../src/client.js'
import { createDeferred } from '../src/deferred.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { finishHistory } from './observer-history-cleanup.js'
import { withOracleCleanup } from './utils.js'
import type { ChangeMessage } from '../src/types.js'

type Row = { id: string; version: number }
type Mode = `granular` | `wholesale`

let collectionId = 0

async function runStaleReadyHistory(
  mode: Mode,
  injectStaleReady: boolean,
): Promise<void> {
  let markReady!: () => void
  const source = createCollection<Row, string>({
    id: `observer-stale-ready-${collectionId++}`,
    getKey: ({ id }) => id,
    startSync: false,
    sync: {
      sync: (operations) => {
        markReady = operations.markReady
      },
    },
  })
  source.startSyncImmediate()
  const observer = createLiveQueryObserver(source, { mode })
  let readyNotifications = 0
  const readyListener = (
    changes: Array<ChangeMessage<Row, string>> | undefined,
  ): void => {
    if (changes === undefined) readyNotifications++
  }

  let failure: { error: unknown } | undefined
  try {
    observer.subscribe(readyListener)
    observer.dispose()
    markReady()
    if (injectStaleReady) readyListener(undefined)
    expect(readyNotifications).toBe(0)
  } catch (error) {
    failure = { error }
  }
  await finishHistory(
    [() => observer.dispose(), () => source.cleanup()],
    failure,
  )
}

describe(`LiveQueryObserver generated histories`, () => {
  it.each([`granular`, `wholesale`] as const)(
    `rejects a stale ready notification after disposal through the %s status path`,
    async (mode) => {
      await runStaleReadyHistory(mode, false)
      await expect(runStaleReadyHistory(mode, true)).rejects.toMatchObject({
        name: `AssertionError`,
      })
    },
  )
})

/**
 * Failed subscription setup transfers no listener ownership to the observer:
 * the caller received no release handle. These fixed cases pin each failure
 * point, cleanup rejection and a real sync startup throw, in both modes, with
 * one or two failed attempts before an explicit retry. They compare with
 * written lease counts. The generated ownership law that these cases illustrate
 * is owned by live-query-observer-history-oracle.property.test.ts.
 * A late listener seed that fails leaves a healthy peer subscribed; that peer
 * alone receives later publications. These are controlled core boundaries;
 * framework commit errors are not modeled.
 */
describe(`observer subscription setup ownership`, () => {
  it.each([1, 2])(
    `preserves a healthy peer across %s failed late listener seeds`,
    async (failures) => {
      let publish = () => {}
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            let version = 0
            publish = () => {
              begin()
              write({
                type: version === 0 ? `insert` : `update`,
                value: { id: `a`, version: ++version },
              })
              commit()
            }
            publish()
            markReady()
          },
        },
      })
      const observer = createLiveQueryObserver(source, { mode: `granular` })
      const healthy = vi.fn()
      const failure = new Error(`late listener seed failed`)
      const failed = vi.fn(() => {
        throw failure
      })
      let stop: (() => void) | undefined
      await withOracleCleanup(() => {
        stop = observer.subscribe(healthy)
        for (let attempt = 1; attempt <= failures; attempt++) {
          expect(() => observer.subscribe(failed)).toThrow(failure)
          expect(failed).toHaveBeenCalledTimes(attempt)
          expect(source.subscriberCount).toBe(1)
        }
        const prefix = healthy.mock.calls.length
        expect(publish).not.toThrow()
        expect(healthy).toHaveBeenCalledTimes(prefix + 1)
        expect(failed).toHaveBeenCalledTimes(failures)
        expect(observer.getSnapshot().state?.get(`a`)?.version).toBe(2)
        stop()
        expect(source.subscriberCount).toBe(0)
      }, [() => stop?.(), () => observer.dispose(), () => source.cleanup()])
    },
  )

  it.each(
    ([`granular`, `wholesale`] as const).flatMap((mode) =>
      ([`cleanup`, `sync-throw`] as const).flatMap((failureAt) =>
        ([1, 2] as const).map((failures) => ({ mode, failureAt, failures })),
      ),
    ),
  )(
    `releases failed $mode setup at $failureAt before $failures-attempt retry`,
    async ({ mode, failureAt, failures }) => {
      const gate = createDeferred<void>()
      const failure = new Error(`source startup failed`)
      let failStart = failureAt === `sync-throw`
      let publish = () => {}
      const source = createCollection<Row>({
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            if (failStart) throw failure
            publish = () => {
              begin()
              write({ type: `insert`, value: { id: `a`, version: 1 } })
              commit()
            }
            markReady()
            return { cleanup: () => gate.promise }
          },
        },
      })
      const client = new DbClient()
      let statusLeases = 0
      const on = source.on.bind(source)
      source.on = (event, listener) => {
        const stop = on(event, listener)
        if (event !== `status:change`) return stop
        statusLeases++
        let active = true
        return () => {
          if (active) {
            active = false
            statusLeases--
            stop()
          }
        }
      }
      let clientLeases = 0
      const subscribeClient = client.subscribe.bind(client)
      vi.spyOn(client, `subscribe`).mockImplementation((listener) => {
        clientLeases++
        const stop = subscribeClient(listener)
        let active = true
        return () => {
          if (active) {
            active = false
            clientLeases--
            stop()
          }
        }
      })
      let layoutLeases = 0
      const subscribeLayout = source._subscribeLayoutChanges.bind(source)
      vi.spyOn(source, `_subscribeLayoutChanges`).mockImplementation(
        (listener) => {
          layoutLeases++
          const stop = subscribeLayout(listener)
          let active = true
          return () => {
            if (active) {
              active = false
              layoutLeases--
              stop()
            }
          }
        },
      )
      const observer = createLiveQueryObserver(source, {
        mode,
        client,
        queryHash: `setup-${mode}-${failureAt}-${failures}`,
      })
      const failedListener = vi.fn()
      const listener = vi.fn()
      let pending: Promise<void> | undefined
      let release: (() => void) | undefined
      await withOracleCleanup(async () => {
        if (failureAt === `cleanup`) {
          source.startSyncImmediate()
          pending = source.cleanup()
        }
        for (let attempt = 0; attempt < failures; attempt++) {
          expect(() => observer.subscribe(failedListener)).toThrow(
            failureAt === `cleanup` ? /during cleanup/ : failure,
          )
          expect({
            clientLeases,
            layoutLeases,
            statusLeases,
            source: source.subscriberCount,
          }).toEqual({
            clientLeases: 0,
            layoutLeases: 0,
            statusLeases: 0,
            source: 0,
          })
          if (failureAt === `sync-throw`) await source.cleanup()
        }
        const failedPrefix = failedListener.mock.calls.length
        gate.resolve()
        await pending
        failStart = false
        release = observer.subscribe(listener)
        expect(source.subscriberCount).toBe(1)
        expect({ clientLeases, layoutLeases }).toEqual({
          clientLeases: 1,
          layoutLeases: 1,
        })
        publish()
        expect(
          Array.from(
            observer.getSnapshot().state!.values(),
            ({ id, version }) => ({ id, version }),
          ),
        ).toEqual([{ id: `a`, version: 1 }])
        expect(listener).toHaveBeenCalled()
        expect(failedListener).toHaveBeenCalledTimes(failedPrefix)
        release()
        expect({
          clientLeases,
          layoutLeases,
          statusLeases,
          source: source.subscriberCount,
        }).toEqual({
          clientLeases: 0,
          layoutLeases: 0,
          statusLeases: 0,
          source: 0,
        })
      }, [
        () => gate.resolve(),
        () => release?.(),
        () => observer.dispose(),
        () => source.cleanup(),
        () => client.cleanup(),
      ])
    },
  )
})
