import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { DbClient } from '../src/client.js'
import { createDeferred } from '../src/deferred.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import {
  PERSISTED_READINESS,
  waitForPersistedInitialRender,
} from '../src/persisted-readiness.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { withOracleCleanup } from './utils.js'
import { createOracleReach } from './oracle-reach.js'
import type { ChangeMessage } from '../src/types.js'

type Row = { id: string; version: number }

/**
 * A hydration seed owns the observer's view before subscription. A provider
 * error before attachment therefore cannot change the first hydration read.
 * Once subscribe has returned, a new provider error is a public publication:
 * its listener and error snapshot must be visible before markError returns.
 * These are the SSR first-view and ordinary runtime-error laws at the core
 * observer boundary; the React runtime receiver checks the framework cut.
 *
 * This independent timing judgment crosses both observer modes, all portable
 * seed statuses, and defined/undefined provider causes. Empty held sources
 * isolate status from error row-retention policy. The pre-attachment path reads
 * the seed before acquiring a subscription, then checks the terminal browser
 * view after its scheduled handoff. The post-subscription path compares at the
 * synchronous provider receipt, so an always-deferred repair cannot pass.
 */
describe(`observer hydration error timing`, () => {
  const historyArbitrary = fc.record({
    mode: fc.constantFrom(`granular` as const, `wholesale` as const),
    errorAt: fc.constantFrom(
      `before-attach` as const,
      `after-subscribe` as const,
    ),
    seedStatus: fc.constantFrom(
      `ready` as const,
      `loading` as const,
      `error` as const,
    ),
    definedCause: fc.boolean(),
  })
  for (const campaign of [`fixed`, `random`] as const) {
    it(`publishes errors at their ownership checkpoint (${campaign})`, async () => {
      const reach = createOracleReach(`observer-hydration-error`, [
        `granular`,
        `wholesale`,
        `before-attach`,
        `after-subscribe`,
        `ready`,
        `loading`,
        `error`,
        `defined-cause`,
        `undefined-cause`,
      ])
      await fc.assert(
        fc.asyncProperty(historyArbitrary, async (history) => {
          reach.beginHistory()
          let fail: (cause: unknown) => void = () => {
            throw new Error(`provider has not started`)
          }
          const source = createCollection<Row>({
            getKey: (row) => row.id,
            gcTime: 0,
            sync: {
              sync: ({ markError }) => {
                fail = markError
              },
            },
          })
          const client = new DbClient()
          client.hydrate({
            collections: [],
            liveQueries: [
              {
                queryHash: `hydration-error-timing`,
                dehydratedAt: 1,
                snapshot: {
                  rows: [],
                  ...(history.seedStatus === `ready`
                    ? {}
                    : { status: history.seedStatus }),
                },
              },
            ],
          })
          const observer = createLiveQueryObserver(source, {
            client,
            mode: history.mode,
            queryHash: `hydration-error-timing`,
          })
          const listener = vi.fn()
          const cause = history.definedCause
            ? new Error(`provider offline`)
            : undefined
          let stop: (() => void) | undefined
          await withOracleCleanup(async () => {
            source.startSyncImmediate()
            if (history.errorAt === `before-attach`) fail(cause)
            expect(
              observer.getServerSnapshot().status,
              `first hydration view belongs to the server`,
            ).toBe(history.seedStatus)
            stop = observer.subscribe(listener)
            if (history.errorAt === `after-subscribe`) {
              const prefix = listener.mock.calls.length
              fail(cause)
              expect(
                listener.mock.calls.length,
                `a subscribed provider error publishes synchronously`,
              ).toBeGreaterThan(prefix)
              expect(
                observer.getSnapshot().status,
                `provider receipt exposes the error`,
              ).toBe(`error`)
            }
            await Promise.resolve()
            expect(
              observer.getSnapshot().status,
              `browser runtime owns the settled subscription`,
            ).toBe(`error`)
            reach.reach(history.mode)
            reach.reach(history.errorAt)
            reach.reach(history.seedStatus)
            reach.reach(
              history.definedCause ? `defined-cause` : `undefined-cause`,
            )
          }, [
            () => stop?.(),
            () => observer.dispose(),
            () => source.cleanup(),
            () => client.cleanup(),
          ])
        }),
        campaign === `fixed`
          ? { numRuns: oracleRuns(64), seed: 2229 }
          : oraclePropertyOptions(
              64,
              `live-query-observer.hydration-error-timing`,
            ),
      )
      reach.assertReached()
      console.info(
        `observer-hydration-error ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
})

/**
 * Failed subscription setup transfers no listener ownership to the observer:
 * the caller received no release handle. This is the resource counterpart of
 * the eligibility ledger below, and follows the observer's subscribe/dispose
 * contract. A later explicit subscription must work on the same observer.
 *
 * The bounded grammar crosses both modes, cleanup rejection and a real sync
 * startup throw, and one or two failed attempts before an explicit retry.
 * The independent ownership judgment counts only calls that returned handles.
 * We observe client/status/layout leases immediately after each failure, then source
 * ownership and listener delivery after retry, publication and final release.
 * A neighboring granular history rejects one or two late listener seeds while
 * a healthy peer remains subscribed. Only the peer owns later publications.
 * These are controlled core boundaries; framework commit errors are not modeled.
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

/**
 * A release retires its logical owner even when application notification throws.
 * Reporting that failure cannot leave the observer attached to zero channels.
 * This is the existing ownership law at teardown rather than construction.
 * The independent judgment is zero channels after release and one after a new
 * returned subscription. A controlled channel release supplies the synchronous
 * collaborator failure after retiring its real Collection handle. First-party
 * event listeners report errors asynchronously and cannot supply this premise.
 * The grammar varies both modes, thrown undefined, and repeated release/retry.
 */
describe(`observer release failure ownership`, () => {
  for (const campaign of [`fixed`, `random`] as const) {
    it(`reattaches after reporting a release failure (${campaign})`, async () => {
      const reach = createOracleReach(`observer-release`, [
        `granular`,
        `wholesale`,
        `release-error`,
        `retry`,
        `undefined-cause`,
      ])
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            mode: fc.constantFrom(`granular` as const, `wholesale` as const),
            undefinedCause: fc.boolean(),
            repeats: fc.integer({ min: 1, max: 3 }),
          }),
          async (history) => {
            reach.beginHistory()
            reach.reach(history.mode)
            const failure = history.undefinedCause
              ? undefined
              : new Error(`release notification`)
            let failRelease = false,
              publish = () => {}
            const source = createCollection<Row>({
              getKey: (row) => row.id,
              gcTime: 0,
              sync: {
                sync: ({ begin, write, commit, markReady }) => {
                  markReady()
                  let version = 0
                  publish = () => {
                    begin()
                    write({
                      type: version ? `update` : `insert`,
                      value: { id: `a`, version: ++version },
                    })
                    commit()
                  }
                },
              },
            })
            // A controlled channel release retires its real Collection handle,
            // then reports a synchronous collaborator failure. Event listeners
            // use reportUncaught instead and cannot supply this premise.
            const subscribe = source.subscribeChanges.bind(source)
            const stopFailure = vi
              .spyOn(source, `subscribeChanges`)
              .mockImplementation((...args) => {
                const subscription = subscribe(...args)
                const unsubscribe = subscription.unsubscribe.bind(subscription)
                vi.spyOn(subscription, `unsubscribe`).mockImplementation(() => {
                  unsubscribe()
                  if (failRelease) {
                    failRelease = false
                    throw failure
                  }
                })
                return subscription
              })
            const observer = createLiveQueryObserver(source, {
              mode: history.mode,
            })
            let stop: (() => void) | undefined
            await withOracleCleanup(() => {
              for (let i = 0; i < history.repeats; i++) {
                stop = observer.subscribe(() => {})
                expect(
                  source.subscriberCount,
                  `new ownership has a physical channel`,
                ).toBe(1)
                failRelease = true
                let outcome = { threw: false, error: undefined as unknown }
                try {
                  stop()
                } catch (error) {
                  outcome = { threw: true, error }
                }
                stop = undefined
                expect(outcome).toEqual({ threw: true, error: failure })
                reach.reach(`release-error`)
                if (history.undefinedCause) reach.reach(`undefined-cause`)
                expect(
                  source.subscriberCount,
                  `throwing release still retires its channel`,
                ).toBe(0)
              }
              const listener = vi.fn()
              stop = observer.subscribe(listener)
              reach.reach(`retry`)
              expect(
                source.subscriberCount,
                `explicit retry acquires a new channel`,
              ).toBe(1)
              publish()
              expect(observer.getSnapshot().state?.get(`a`)?.version).toBe(1)
              expect(listener).toHaveBeenCalled()
            }, [
              () => {
                failRelease = false
                stop?.()
              },
              () => stopFailure.mockRestore(),
              () => observer.dispose(),
              () => source.cleanup(),
            ])
          },
        ),
        campaign === `fixed`
          ? { numRuns: oracleRuns(40), seed: 2229 }
          : oraclePropertyOptions(40, `live-query-observer.release-failure`),
      )
      reach.assertReached()
      console.info(
        `observer-release ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
})

/**
 * The setup law also covers failure before subscribeChanges, and a peer that
 * subscribes reentrantly during setup. A failed attempt transfers no physical
 * channel ownership. An already-returned peer record remains a logical owner;
 * the next explicit subscribe reattaches it. This follows subscribe/dispose's
 * handle ownership contract, not persistence's implementation. The capability
 * supplies controlled registration failure; no failing registration transfers
 * an unreturned handle. First-party persisted readiness currently never throws.
 */
describe(`observer partial attachment`, () => {
  for (const campaign of [`fixed`, `random`] as const) {
    it(`releases every acquired channel before retry (${campaign})`, async () => {
      const reach = createOracleReach(`observer-partial-attach`, [
        `early-failure`,
        `sync-failure`,
        `surviving-peer`,
        `no-peer`,
      ])
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            mode: fc.constantFrom(`granular` as const, `wholesale` as const),
            failureAt: fc.constantFrom(`persisted` as const, `sync` as const),
            reenter: fc.boolean(),
            failures: fc.integer({ min: 1, max: 2 }),
          }),
          async (history) => {
            reach.beginHistory()
            const failure = new Error(`setup failure`)
            let failing = true
            let reentered = false
            let peerStop: (() => void) | undefined
            let publish = () => {}
            const peer = vi.fn()
            let persistedLeases = 0
            const source = createCollection<Row>({
              getKey: (row) => row.id,
              gcTime: 0,
              ...{
                [PERSISTED_READINESS]: {
                  networkTimeoutMs: 0,
                  getOrStartNetworkDeadline: () => 0,
                  getSnapshot: () => ({ status: `ready` as const }),
                  waitForInitialRender: waitForPersistedInitialRender,
                  subscribe: () => {
                    if (history.reenter && !reentered) {
                      reentered = true
                      peerStop = observer.subscribe(peer)
                    }
                    if (failing && history.failureAt === `persisted`)
                      throw failure
                    persistedLeases++
                    return () => {
                      persistedLeases--
                    }
                  },
                },
              },
              sync: {
                sync: ({ begin, write, commit, markReady }) => {
                  if (failing && history.failureAt === `sync`) throw failure
                  markReady()
                  publish = () => {
                    begin()
                    write({ type: `insert`, value: { id: `a`, version: 1 } })
                    commit()
                  }
                },
              },
            })
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
            let layoutLeases = 0
            const subscribeLayout = source._subscribeLayoutChanges.bind(source)
            vi.spyOn(source, `_subscribeLayoutChanges`).mockImplementation(
              (listener) => {
                const stop = subscribeLayout(listener)
                layoutLeases++
                return () => {
                  layoutLeases--
                  stop()
                }
              },
            )
            const observer: ReturnType<
              typeof createLiveQueryObserver<Row, string | number>
            > = createLiveQueryObserver(source, { mode: history.mode })
            let stop: (() => void) | undefined
            await withOracleCleanup(async () => {
              for (let i = 0; i < history.failures; i++) {
                expect(() => observer.subscribe(() => {})).toThrow(failure)
                reach.reach(
                  history.failureAt === `persisted`
                    ? `early-failure`
                    : `sync-failure`,
                )
                expect(Boolean(peerStop)).toBe(history.reenter)
                reach.reach(peerStop ? `surviving-peer` : `no-peer`)
                expect(
                  {
                    statusLeases,
                    layoutLeases,
                    persistedLeases,
                    source: source.subscriberCount,
                  },
                  `failure returns no physical ownership`,
                ).toEqual({
                  statusLeases: 0,
                  layoutLeases: 0,
                  persistedLeases: 0,
                  source: 0,
                })
                await source.cleanup()
              }
              failing = false
              stop = observer.subscribe(() => {})
              expect(source.subscriberCount).toBe(1)
              publish()
              expect(observer.getSnapshot().state?.get(`a`)?.version).toBe(1)
              if (history.reenter) expect(peer).toHaveBeenCalled()
              stop()
              peerStop?.()
              expect({
                statusLeases,
                layoutLeases,
                persistedLeases,
                source: source.subscriberCount,
              }).toEqual({
                statusLeases: 0,
                layoutLeases: 0,
                persistedLeases: 0,
                source: 0,
              })
            }, [
              () => stop?.(),
              () => peerStop?.(),
              () => observer.dispose(),
              () => source.cleanup(),
            ])
          },
        ),
        campaign === `fixed`
          ? { numRuns: oracleRuns(60), seed: 2229 }
          : oraclePropertyOptions(60, `live-query-observer.partial-attach`),
      )
      reach.assertReached()
      console.info(
        `observer-partial-attach ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
})

type Mode = `granular` | `wholesale`
type Reaction =
  | `none`
  | `nested`
  | `throw`
  | `nestedThrow`
  | `removePeer`
  | `addPeer`
  | `dispose`
type Command =
  | { type: `subscribe`; listener: number }
  | { type: `unsubscribe`; listener: number }
  | {
      type: `publish`
      version: number
      nestedVersion: number
      reactor: number
      peer: number
      reaction: Reaction
    }
  | { type: `dispose` }

type RecordedChange =
  | { type: `insert` | `delete`; key: string; version: number }
  | {
      type: `update`
      key: string
      version: number
      previousVersion: number
    }
type VisibleRow = { key: string; version: number }
type Delivery = {
  listener: number
  changes: Array<RecordedChange> | undefined
  rows: Array<VisibleRow>
  bootstrap: boolean
}
type ListenerModel = { active: boolean; version?: number }
type Model = {
  disposed: boolean
  sourceVersion?: number
  listeners: Map<number, ListenerModel>
  order: Array<number>
  deliveries: Array<Delivery>
}
type CommandType = Command[`type`]
type Reach = {
  commands: Record<CommandType, number>
  reactions: Record<Reaction, number>
}
type DeliveryMutant =
  | `dropPeerAfterThrow`
  | `duplicateBootstrap`
  | `reentrantOutOfOrder`
  | `earlyPeerDelivery`
type RunOptions = {
  mutant?: DeliveryMutant
  reach?: Reach
}

/**
 * # Which listeners may receive each live-query publication?
 *
 * The model is an eligibility ledger, not a second dispatch queue. Each
 * listener is active or inactive and may hold one reconstructed row version.
 * A publication snapshots eligible listeners in subscription order. Reentrant
 * publications join the FIFO behind it. Removing, adding, throwing, or
 * disposing during delivery affects later work according to the table below.
 *
 * Generated subscribe, unsubscribe, publish, and dispose histories drive both
 * granular and wholesale observers. The driver compares exact listener order,
 * multiplicity, raw batches, reconstructed rows, bootstrap flags, and the first
 * surfaced error after every command. Fixed histories prove every command and
 * reaction is reachable; observation mutants calibrate the comparisons.
 *
 * Hydration, status scheduling, resource ownership, and multi-row layout have
 * separate focused owners. This model stays one-row on purpose: listener
 * eligibility is independent of query layout.
 *
 * ## Contract and ownership table

| Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
| --- | --- | --- | --- | --- |
| bootstrap mode | subscribe before/after one visible row, granular/wholesale | createLiveQueryObserver -> subscribe/attach/seed | exact raw batch and reconstructed rows after subscribe | this generated oracle; one fixed key, no layout/order claim |
| publication eligibility | subscribe, unsubscribe, add/remove peer during dispatch | notify -> emit -> flushPublications | exact target order, multiplicity, raw batch, reconstructed/direct rows after each command | this generated oracle |
| FIFO reentry | a listener publishes one nested update | emit -> publicationQueue -> flushPublications | outer delivery precedes nested delivery for every eligible listener | this generated oracle; one nested level per command |
| disposal | top-level or listener-triggered disposal | dispose -> detach/queue clear | in-flight cutoff and absence of later delivery | this generated oracle |
| listener failures | ordinary/reentrant/dispose, two failures, thrown undefined | flushPublications failure capture | peer rows and first rethrown error | focused `live-query-observer.test.ts` test `delivers peer publications before reporting a listener failure`; not duplicated here beyond one throwing reactor |
| logical subscription identity | same callback subscribed twice | SubscriptionRecord lifecycle | independent teardown/call count | focused `live-query-observer.test.ts` test `treats two subscriptions with the same callback as independent` |
| readiness/stale ready | unsubscribe/resubscribe and dispose before markReady | status listener -> notify(undefined) | exact ready-notify count | focused `live-query-observer.test.ts` tests `fires the ready notify once...`, `emits exactly one post-bootstrap...`; stale-ready calibration below |
| hydration handoff | server seed followed by live readiness | DbClient hydrate -> syncHydrationState/handoffHydrationSeed | atomic visible rows/batch at handoff | focused `live-query-observer.test.ts` tests `shows a hydrated result...` and `delivers an atomic hydrated-to-live diff...` |
| stale server data | server snapshot arrives after live readiness | client event -> syncHydrationState/markLiveResultAuthoritative | live rows remain visible and stale snapshot is consumed | focused `live-query-observer.test.ts` test `ignores a server snapshot that arrives after browser sync is ready` |
| errors | live/status or streamed error before/after hydration authority | status/client event -> getError/getSnapshot | error identity, status, and retained rows | focused `live-query-observer.test.ts` tests `publishes a live error...`, `exposes a streamed query error...`, and `ignores a server failure...` |
| source authority | abandoned read, consumed seed, or later observer | syncHydrationState -> markLiveResultAuthoritative/_consumeLiveQueryResult | which server/live result remains authoritative | focused `live-query-observer.test.ts` tests `does not consume...abandoned render`, `does not replay...later observer`, and the stale-server tests |
| client resource lifecycle | preload/dehydrate/cleanup and streamed results | DbClient live-query registry | result/error/cleanup ownership | focused `db-client.test.ts`; framework/native wiring remains outside this oracle |

 * The generated owner compares one-row insert/update histories. It preserves the
raw callback batch, but does not claim multi-row layout/order, hydration,
status scheduling, preload, framework wiring, or native boundaries.
 * The controlled source synchronously commits one change per publication. This
 * tests the observer's response to that source event shape; it does not show
 * that a remote provider produces it.
 *
 * Grammar controls: fixed reaction histories reconstruct every declared
 * command and callback action, while the two-publication add-peer history
 * distinguishes current-dispatch eligibility from the next publication.
 * Removing listener identity loses peer removal/addition; removing the second
 * version loses FIFO reentry; removing mode loses the bootstrap distinction.
 * Versions span -20..20, listener IDs 0..3, and histories 1..30 commands;
 * equal nested and outer versions are the no-change margin. A repeated
 * subscribe for one active model ID is excluded from the accepted action
 * history (the driver skips it); independent subscriptions of one callback
 * belong to the focused identity test above.
 */

const reactions: ReadonlyArray<Reaction> = [
  `none`,
  `nested`,
  `throw`,
  `nestedThrow`,
  `removePeer`,
  `addPeer`,
  `dispose`,
]
const historyProperties = {
  granular: `live-query-observer.granular-history`,
  wholesale: `live-query-observer.wholesale-history`,
} as const

const listener = fc.integer({ min: 0, max: 3 })
const command = fc.oneof(
  fc.record({ type: fc.constant(`subscribe` as const), listener }),
  fc.record({ type: fc.constant(`unsubscribe` as const), listener }),
  fc.record({
    type: fc.constant(`publish` as const),
    version: fc.integer({ min: -20, max: 20 }),
    nestedVersion: fc.integer({ min: -20, max: 20 }),
    reactor: listener,
    peer: listener,
    reaction: fc.constantFrom<Reaction>(...reactions),
  }),
  fc.constant({ type: `dispose` } as const),
)

let collectionId = 0

function emptyReach(): Reach {
  return {
    commands: { subscribe: 0, unsubscribe: 0, publish: 0, dispose: 0 },
    reactions: {
      none: 0,
      nested: 0,
      throw: 0,
      nestedThrow: 0,
      removePeer: 0,
      addPeer: 0,
      dispose: 0,
    },
  }
}

function recordedChanges(
  changes: Array<ChangeMessage<Row, string>> | undefined,
): Array<RecordedChange> | undefined {
  return changes?.map((change) =>
    change.type === `update`
      ? {
          type: change.type,
          key: change.key,
          version: change.value.version,
          previousVersion: change.previousValue!.version,
        }
      : {
          type: change.type,
          key: change.key,
          version: change.value.version,
        },
  )
}

function visibleRows(rows: ReadonlyMap<string, Row>): Array<VisibleRow> {
  return Array.from(rows, ([key, row]) => ({ key, version: row.version }))
}

function publicationChanges(
  version: number,
  previousVersion: number | undefined,
): Array<RecordedChange> {
  return previousVersion === undefined
    ? [{ type: `insert`, key: `row`, version }]
    : [
        {
          type: `update`,
          key: `row`,
          version,
          previousVersion,
        },
      ]
}

function activeListeners(model: Model): Array<number> {
  return model.order.filter((id) => model.listeners.get(id)?.active)
}

function deliver(
  model: Model,
  targets: ReadonlyArray<number>,
  version: number,
  bootstrap: boolean,
  changes: Array<RecordedChange>,
): void {
  for (const id of targets) {
    if (model.disposed) return
    model.deliveries.push({
      listener: id,
      changes,
      rows: [{ key: `row`, version }],
      bootstrap,
    })
    model.listeners.get(id)!.version = version
  }
}

function subscribeModel(model: Model, mode: Mode, id: number): boolean {
  if (model.disposed || model.listeners.get(id)?.active) return false
  model.listeners.set(id, { active: true })
  model.order = [...model.order.filter((candidate) => candidate !== id), id]
  if (mode === `granular` && model.sourceVersion !== undefined) {
    deliver(model, [id], model.sourceVersion, true, [
      { type: `insert`, key: `row`, version: model.sourceVersion },
    ])
  }
  return true
}

function unsubscribeModel(model: Model, id: number): boolean {
  const record = model.listeners.get(id)
  if (!record?.active || model.disposed) return false
  record.active = false
  return true
}

function publishModel(
  model: Model,
  mode: Mode,
  commandValue: Extract<Command, { type: `publish` }>,
): { reactor?: number; peer?: number; addedPeer?: boolean; failure?: Error } {
  const previousVersion = model.sourceVersion
  const changed = previousVersion !== commandValue.version
  model.sourceVersion = commandValue.version
  if (model.disposed || !changed) return {}
  const targets = activeListeners(model)
  if (targets.length === 0) return {}
  const reactor = targets[commandValue.reactor % targets.length]!
  const peer =
    commandValue.reaction === `addPeer`
      ? commandValue.peer
      : targets[commandValue.peer % targets.length]!
  const failure =
    commandValue.reaction === `throw` || commandValue.reaction === `nestedThrow`
      ? new Error(`listener ${reactor} failed`)
      : undefined
  let nestedTargets: Array<number> | undefined
  let lateBootstrap: number | undefined
  let addedPeer = false
  let disposedDuringDelivery = false

  for (const id of targets) {
    if (disposedDuringDelivery) break
    deliver(
      model,
      [id],
      commandValue.version,
      false,
      publicationChanges(commandValue.version, previousVersion),
    )
    if (id !== reactor) continue
    if (
      commandValue.reaction === `nested` ||
      commandValue.reaction === `nestedThrow`
    ) {
      model.sourceVersion = commandValue.nestedVersion
      if (commandValue.nestedVersion !== commandValue.version) {
        nestedTargets = activeListeners(model)
      }
    } else if (commandValue.reaction === `removePeer`) {
      model.listeners.get(peer)!.active = false
    } else if (commandValue.reaction === `addPeer`) {
      if (!model.listeners.get(peer)?.active) {
        model.listeners.set(peer, { active: true })
        model.order = [
          ...model.order.filter((candidate) => candidate !== peer),
          peer,
        ]
        addedPeer = true
        if (mode === `granular`) lateBootstrap = peer
      }
    } else if (commandValue.reaction === `dispose`) {
      disposeModel(model)
      disposedDuringDelivery = true
    }
  }
  if (nestedTargets && !disposedDuringDelivery) {
    deliver(
      model,
      nestedTargets,
      commandValue.nestedVersion,
      false,
      publicationChanges(commandValue.nestedVersion, commandValue.version),
    )
  }
  if (lateBootstrap !== undefined && !disposedDuringDelivery) {
    deliver(model, [lateBootstrap], commandValue.version, true, [
      { type: `insert`, key: `row`, version: commandValue.version },
    ])
  }
  return { reactor, peer, addedPeer, failure }
}

function disposeModel(model: Model): void {
  model.disposed = true
  for (const listenerModel of model.listeners.values()) {
    listenerModel.active = false
  }
}

function assertHistory(
  history: ReadonlyArray<Command>,
  checkpoint: number,
  actual: ReadonlyArray<Delivery>,
  expected: ReadonlyArray<Delivery>,
): void {
  expect(actual, JSON.stringify({ history, checkpoint })).toEqual(expected)
}

function deliveryVersion(delivery: Delivery): number | undefined {
  return delivery.rows.find(({ key }) => key === `row`)?.version
}

function applyDeliveryMutant(
  actual: ReadonlyArray<Delivery>,
  mutant: DeliveryMutant | undefined,
): Array<Delivery> {
  const corrupted = [...actual]
  if (mutant === `dropPeerAfterThrow`) {
    const index = corrupted.findIndex(
      (delivery) =>
        delivery.listener === 1 &&
        !delivery.bootstrap &&
        deliveryVersion(delivery) === 1,
    )
    if (index >= 0) corrupted.splice(index, 1)
  } else if (mutant === `duplicateBootstrap`) {
    const index = corrupted.findIndex((delivery) => delivery.bootstrap)
    if (index >= 0) corrupted.splice(index, 0, corrupted[index]!)
  } else if (mutant === `reentrantOutOfOrder`) {
    const outer = corrupted.findIndex(
      (delivery) => delivery.listener === 1 && deliveryVersion(delivery) === 1,
    )
    const nested = corrupted.findIndex(
      (delivery) => delivery.listener === 1 && deliveryVersion(delivery) === 2,
    )
    if (outer >= 0 && nested >= 0) {
      const outerDelivery = corrupted[outer]!
      corrupted[outer] = corrupted[nested]!
      corrupted[nested] = outerDelivery
    }
  } else if (mutant === `earlyPeerDelivery`) {
    const outer = corrupted.findIndex(
      (delivery) => delivery.listener === 0 && deliveryVersion(delivery) === 1,
    )
    if (outer >= 0) {
      corrupted.splice(outer + 1, 0, {
        ...corrupted[outer]!,
        listener: 1,
        bootstrap: false,
      })
    }
  }
  return corrupted
}

async function finishHistory(
  cleanup: ReadonlyArray<() => void | Promise<void>>,
  failure: { error: unknown } | undefined,
): Promise<void> {
  const cleanupFailures: Array<unknown> = []
  for (const release of cleanup) {
    try {
      await release()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      failure ? [failure.error, ...cleanupFailures] : cleanupFailures,
      `Observer history cleanup failed`,
      failure ? { cause: failure.error } : undefined,
    )
  }
  if (failure) throw failure.error
}

async function runHistory(
  mode: Mode,
  history: Array<Command>,
  options: RunOptions = {},
): Promise<Reach> {
  let current: Row | undefined
  let publish!: (version: number) => void
  const source = createCollection<Row, string>({
    id: `observer-history-${collectionId++}`,
    getKey: ({ id }) => id,
    startSync: false,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        publish = (version) => {
          const next = { id: `row`, version }
          const previous = current
          current = next
          begin()
          write({ type: previous ? `update` : `insert`, value: next })
          commit()
        }
        markReady()
      },
    },
  })
  source.startSyncImmediate()
  const observer = createLiveQueryObserver(source, { mode })
  const model: Model = {
    disposed: false,
    listeners: new Map(),
    order: [],
    deliveries: [],
  }
  const actual: Array<Delivery> = []
  const reconstructed = new Map<number, Map<string, Row>>()
  const unsubscribers = new Map<number, () => void>()
  const queuedBootstraps = new Set<number>()
  const reach = options.reach ?? emptyReach()
  let subscribingListener: number | undefined
  let armed:
    | {
        reactor: number
        peer: number
        reaction: Reaction
        nestedVersion: number
        addedPeer?: boolean
        failure?: Error
      }
    | undefined

  const subscribe = (id: number, bootstrapQueued = false): void => {
    reconstructed.set(id, new Map())
    if (bootstrapQueued) queuedBootstraps.add(id)
    subscribingListener = id
    const unsubscribe = observer.subscribe((changes) => {
      const rows = reconstructed.get(id)!
      if (mode === `granular`) {
        for (const change of changes ?? []) {
          if (change.type === `delete`) rows.delete(change.key)
          else rows.set(change.key, change.value)
        }
      } else {
        rows.clear()
        for (const [key, row] of observer.getSnapshot().state ?? []) {
          rows.set(key, row)
        }
      }
      actual.push({
        listener: id,
        changes: recordedChanges(changes),
        rows: visibleRows(rows),
        bootstrap: subscribingListener === id || queuedBootstraps.delete(id),
      })

      if (!armed || armed.reactor !== id) return
      const reaction = armed
      armed = undefined
      if (
        reaction.reaction === `nested` ||
        reaction.reaction === `nestedThrow`
      ) {
        publish(reaction.nestedVersion)
        reach.reactions[reaction.reaction]++
      } else if (reaction.reaction === `removePeer`) {
        unsubscribers.get(reaction.peer)?.()
        unsubscribers.delete(reaction.peer)
        reach.reactions.removePeer++
      } else if (reaction.reaction === `addPeer` && reaction.addedPeer) {
        subscribe(reaction.peer, mode === `granular`)
        reach.reactions.addPeer++
      } else if (reaction.reaction === `dispose`) {
        observer.dispose()
        reach.reactions.dispose++
      } else if (reaction.reaction === `none`) {
        reach.reactions.none++
      } else if (reaction.reaction === `throw`) {
        reach.reactions.throw++
      }
      if (reaction.failure) throw reaction.failure
    })
    subscribingListener = undefined
    unsubscribers.set(id, unsubscribe)
  }

  let failure: { error: unknown } | undefined
  try {
    for (const [checkpoint, nextCommand] of history.entries()) {
      if (nextCommand.type === `subscribe`) {
        const accepted = subscribeModel(model, mode, nextCommand.listener)
        if (accepted) {
          subscribe(nextCommand.listener)
          reach.commands.subscribe++
        }
      } else if (nextCommand.type === `unsubscribe`) {
        if (unsubscribeModel(model, nextCommand.listener)) {
          unsubscribers.get(nextCommand.listener)?.()
          unsubscribers.delete(nextCommand.listener)
          reach.commands.unsubscribe++
        }
      } else if (nextCommand.type === `dispose`) {
        if (!model.disposed) {
          disposeModel(model)
          observer.dispose()
          unsubscribers.clear()
          reach.commands.dispose++
        }
      } else {
        const expectedOutcome = publishModel(model, mode, nextCommand)
        reach.commands.publish++
        armed =
          expectedOutcome.reactor === undefined
            ? undefined
            : {
                reactor: expectedOutcome.reactor,
                peer: expectedOutcome.peer!,
                reaction: nextCommand.reaction,
                nestedVersion: nextCommand.nestedVersion,
                addedPeer: expectedOutcome.addedPeer,
                failure: expectedOutcome.failure,
              }
        let caught: unknown
        try {
          publish(nextCommand.version)
        } catch (error) {
          caught = error
        }
        expect(caught).toBe(expectedOutcome.failure)
        armed = undefined
      }

      assertHistory(
        history,
        checkpoint,
        applyDeliveryMutant(actual, options.mutant),
        model.deliveries,
      )
      expect(visibleRows(source.state)).toEqual(
        model.sourceVersion === undefined
          ? []
          : [{ key: `row`, version: model.sourceVersion }],
      )
      for (const [id, listenerModel] of model.listeners) {
        expect(reconstructed.get(id)?.get(`row`)?.version).toBe(
          listenerModel.version,
        )
      }
      if (!model.disposed) {
        expect(visibleRows(observer.getSnapshot().state ?? new Map())).toEqual(
          model.sourceVersion === undefined
            ? []
            : [{ key: `row`, version: model.sourceVersion }],
        )
      }
    }
  } catch (error) {
    failure = { error }
  }
  await finishHistory(
    [() => observer.dispose(), () => source.cleanup()],
    failure,
  )
  return reach
}

function reactionHistory(reaction: Reaction): Array<Command> {
  return [
    { type: `subscribe`, listener: 0 },
    { type: `subscribe`, listener: 1 },
    {
      type: `publish`,
      version: 1,
      nestedVersion: 2,
      reactor: 0,
      peer: reaction === `addPeer` ? 2 : 1,
      reaction,
    },
  ]
}

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
  for (const mode of [`granular`, `wholesale`] as const) {
    it.each([1813, -1359260562])(
      `${mode} listeners follow the eligibility ledger with fixed seed=%s`,
      async (seed) => {
        await fc.assert(
          fc.asyncProperty(
            fc.array(command, { minLength: 1, maxLength: 30 }),
            async (history) => {
              await runHistory(mode, history)
            },
          ),
          { numRuns: oracleRuns(75), seed },
        )
      },
    )
    it(`${mode} listeners follow the eligibility ledger with a random or replayed seed`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(command, { minLength: 1, maxLength: 30 }),
          async (history) => {
            await runHistory(mode, history)
          },
        ),
        oraclePropertyOptions(75, historyProperties[mode]),
      )
    })
  }

  it.each([`granular`, `wholesale`] as const)(
    `%s listeners joining during dispatch start with the next eligible publication`,
    async (mode) => {
      const history: Array<Command> = [
        { type: `subscribe`, listener: 0 },
        {
          type: `publish`,
          version: 1,
          nestedVersion: 0,
          reactor: 0,
          peer: 1,
          reaction: `addPeer`,
        },
        {
          type: `publish`,
          version: 2,
          nestedVersion: 0,
          reactor: 0,
          peer: 0,
          reaction: `none`,
        },
      ]
      const reach = emptyReach()
      await runHistory(mode, history, { reach })
      expect(reach.reactions.addPeer).toBe(1)
      await expect(
        runHistory(mode, history, { mutant: `earlyPeerDelivery` }),
      ).rejects.toMatchObject({ name: `AssertionError` })
    },
  )

  it(`executes every command and reaction kind in fixed production histories`, async () => {
    const reach = emptyReach()
    for (const mode of [`granular`, `wholesale`] as const) {
      await runHistory(
        mode,
        [
          { type: `subscribe`, listener: 0 },
          { type: `unsubscribe`, listener: 0 },
          { type: `dispose` },
        ],
        { reach },
      )
      for (const reaction of reactions) {
        await runHistory(mode, reactionHistory(reaction), { reach })
      }
    }

    expect(Object.values(reach.commands).every((count) => count > 0)).toBe(true)
    expect(Object.values(reach.reactions).every((count) => count > 0)).toBe(
      true,
    )
  })

  it.each([`granular`, `wholesale`] as const)(
    `%s one-row version margins retain the no-change boundary`,
    async (mode) => {
      await runHistory(mode, [
        {
          type: `publish`,
          version: -20,
          nestedVersion: -20,
          reactor: 0,
          peer: 0,
          reaction: `none`,
        },
        { type: `subscribe`, listener: 0 },
        {
          type: `publish`,
          version: 20,
          nestedVersion: 20,
          reactor: 0,
          peer: 0,
          reaction: `nested`,
        },
        {
          type: `publish`,
          version: 20,
          nestedVersion: 20,
          reactor: 0,
          peer: 0,
          reaction: `none`,
        },
      ])
    },
  )

  it.each([`granular`, `wholesale`] as const)(
    `rejects dropped peer delivery after a throwing listener through the %s production path`,
    async (mode) => {
      const history = reactionHistory(`throw`)
      await runHistory(mode, history)
      const reach = emptyReach()
      await expect(
        runHistory(mode, history, { mutant: `dropPeerAfterThrow`, reach }),
      ).rejects.toMatchObject({ name: `AssertionError` })
      expect(reach.reactions.throw).toBe(1)
    },
  )

  it(`rejects a duplicate granular bootstrap through the production seed path`, async () => {
    const history: Array<Command> = [
      {
        type: `publish`,
        version: 1,
        nestedVersion: 0,
        reactor: 0,
        peer: 0,
        reaction: `none`,
      },
      { type: `subscribe`, listener: 0 },
    ]
    await runHistory(`granular`, history)
    await expect(
      runHistory(`granular`, history, { mutant: `duplicateBootstrap` }),
    ).rejects.toMatchObject({ name: `AssertionError` })
  })

  it.each([`granular`, `wholesale`] as const)(
    `rejects a reentrant publication delivered out of FIFO order through the %s production path`,
    async (mode) => {
      const history = reactionHistory(`nested`)
      await runHistory(mode, history)
      const reach = emptyReach()
      await expect(
        runHistory(mode, history, { mutant: `reentrantOutOfOrder`, reach }),
      ).rejects.toMatchObject({ name: `AssertionError` })
      expect(reach.reactions.nested).toBe(1)
    },
  )

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
