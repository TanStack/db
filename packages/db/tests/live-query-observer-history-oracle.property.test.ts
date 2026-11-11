import { fc } from '@fast-check/vitest'
import { describe, expect, vi } from 'vitest'
import { DbClient } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { finishHistory } from './observer-history-cleanup.js'
import { withOracleCleanup } from './utils.js'
import { differs, oracleProperty, pass } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import type { Verdict } from './oracle-property.js'
import type { ChangeMessage } from '../src/types.js'

type Row = { id: string; version: number }

// Keep the mature assertion's matcher, cause, and stack when it supplies a
// comparison. Driver and cleanup exceptions never pass through this adapter.
function comparisonVerdict(
  checkpoint: string,
  law: string,
  compare: () => void,
): Verdict | undefined {
  try {
    compare()
    return undefined
  } catch (error) {
    if (!(error instanceof Error) || error.name !== `AssertionError`)
      throw error
    return {
      kind: `violation`,
      checkpoint,
      law,
      difference: error.message,
      cause: error,
    }
  }
}

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
const errorTimingHistory = fc.record({
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

oracleProperty({
  id: `live-query-observer.hydration-error-timing`,
  law: {
    statement: `The first server read retains its hydration status; a provider error after subscription publishes synchronously, and the settled browser snapshot shows the provider error.`,
    authority: `The established SSR first-view and ordinary runtime-error contracts described above.`,
    limits: `Controlled empty source, portable hydration statuses, both observer modes, and defined or undefined provider causes; framework scheduling has its own receiving witness.`,
  },
  // What this oracle owns: the gap report judges every function in
  // src/live-query-observer.ts by this file's generated and fixed histories of
  // subscribe, publish, markError, and dispose.
  owns: [`src/live-query-observer.ts`],
  histories: {
    arbitrary: errorTimingHistory,
    runs: 64,
    fixedSeeds: [2229],
    states: [
      `granular`,
      `wholesale`,
      `before-attach`,
      `after-subscribe`,
      `ready`,
      `loading`,
      `error`,
      `defined-cause`,
      `undefined-cause`,
    ],
    constructed: [
      {
        name: `error before granular attachment`,
        enters: [`granular`, `before-attach`, `ready`, `defined-cause`],
        build: (generated) => ({
          ...generated,
          mode: `granular` as const,
          errorAt: `before-attach` as const,
          seedStatus: `ready` as const,
          definedCause: true,
        }),
      },
      {
        name: `error after wholesale subscription`,
        enters: [`wholesale`, `after-subscribe`, `loading`, `undefined-cause`],
        build: (generated) => ({
          ...generated,
          mode: `wholesale` as const,
          errorAt: `after-subscribe` as const,
          seedStatus: `loading` as const,
          definedCause: false,
        }),
      },
      {
        name: `error hydration status`,
        enters: [`error`],
        build: (generated) => ({ ...generated, seedStatus: `error` as const }),
      },
    ],
  },
  // The hydration status belongs to authored transport data. The provider's
  // terminal error belongs to the runtime after the subscription boundary.
  model: (history) => history.seedStatus,
  driver: async (history, observe) => {
    let fail: (cause: unknown) => void = () => {
      throw new Error(`provider has not started`)
    }
    const source = createCollection<Row>({
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: ({ fail: markError }) => {
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
      observe(`first hydration read`, observer.getServerSnapshot().status)
      stop = observer.subscribe(listener)
      if (history.errorAt === `after-subscribe`) {
        const prefix = listener.mock.calls.length
        fail(cause)
        observe(`provider receipt`, {
          announced: listener.mock.calls.length > prefix,
          status: observer.getSnapshot().status,
        })
      }
      await Promise.resolve()
      observe(`settled subscription`, observer.getSnapshot().status)
      for (const state of [
        history.mode,
        history.errorAt,
        history.seedStatus,
        history.definedCause ? `defined-cause` : `undefined-cause`,
      ])
        observe(`reach`, state)
    }, [
      () => stop?.(),
      () => observer.dispose(),
      () => source.cleanup(),
      () => client.cleanup(),
    ])
  },
  // These are the original three observation cuts. Inspect earlier cuts first
  // so an absent later observation cannot replace their comparison failure.
  check: (history, trace, expected) => {
    const first = differs(
      `first hydration read`,
      `first hydration view belongs to the server`,
      trace.find((entry) => entry.checkpoint === `first hydration read`)?.value,
      expected,
    )
    if (first) return first
    if (history.errorAt === `after-subscribe`) {
      const receipt = differs(
        `provider receipt`,
        `a subscribed provider error publishes synchronously`,
        trace.find((entry) => entry.checkpoint === `provider receipt`)?.value,
        { announced: true, status: `error` },
      )
      if (receipt) return receipt
    }
    return (
      differs(
        `settled subscription`,
        `browser runtime owns the settled subscription`,
        trace.find((entry) => entry.checkpoint === `settled subscription`)
          ?.value,
        `error`,
      ) ?? pass
    )
  },
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
type ReleaseHistory = {
  mode: `granular` | `wholesale`
  undefinedCause: boolean
  repeats: number
}
type ReleasePlan = ReleaseHistory & { failure: Error | undefined }
function releaseModel(history: ReleasePlan) {
  return {
    acquired: 1,
    released: 0,
    failure: { threw: true, error: history.failure },
    retry: { channels: 1, version: 1, announced: true },
  }
}
const releaseHistory: fc.Arbitrary<ReleaseHistory> = fc.record({
  mode: fc.constantFrom(`granular` as const, `wholesale` as const),
  undefinedCause: fc.boolean(),
  repeats: fc.integer({ min: 1, max: 3 }),
})

oracleProperty<ReleaseHistory, ReturnType<typeof releaseModel>, ReleasePlan>({
  id: `live-query-observer.release-failure`,
  law: {
    statement: `Release retires its physical channel even when notification throws; a later explicit subscription acquires one channel and receives the next publication.`,
    authority: `The established observer handle ownership contract described above.`,
    limits: `A controlled collaborator throws after retiring a real Collection handle; both modes, undefined causes, and one to three releases are retained.`,
  },
  owns: [`src/live-query-observer.ts`],
  histories: {
    arbitrary: releaseHistory,
    runs: 40,
    fixedSeeds: [2229],
    states: [
      `granular`,
      `wholesale`,
      `release-error`,
      `retry`,
      `undefined-cause`,
    ],
    constructed: [
      {
        name: `granular undefined release`,
        enters: [`granular`, `release-error`, `retry`, `undefined-cause`],
        build: (generated) => ({
          ...generated,
          mode: `granular`,
          undefinedCause: true,
        }),
      },
      {
        name: `wholesale release`,
        enters: [`wholesale`],
        build: (generated) => ({ ...generated, mode: `wholesale` }),
      },
    ],
  },
  resolve: (history) => ({
    ...history,
    failure: history.undefinedCause
      ? undefined
      : new Error(`release notification`),
  }),
  // A returned handle owns one channel; releasing it owes zero, regardless of
  // the collaborator's result. A fresh returned handle owns one again.
  model: releaseModel,
  driver: async (history, observe) => {
    const failure = history.failure
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
    const observer = createLiveQueryObserver(source, { mode: history.mode })
    let stop: (() => void) | undefined
    await withOracleCleanup(() => {
      observe(`reach`, history.mode)
      for (let i = 0; i < history.repeats; i++) {
        stop = observer.subscribe(() => {})
        observe(`acquire ${i}`, source.subscriberCount)
        failRelease = true
        let outcome = { threw: false, error: undefined as unknown }
        try {
          stop()
        } catch (error) {
          outcome = { threw: true, error }
        }
        stop = undefined
        observe(`release ${i}`, { outcome, channels: source.subscriberCount })
        observe(`reach`, `release-error`)
        if (history.undefinedCause) observe(`reach`, `undefined-cause`)
      }
      const listener = vi.fn()
      stop = observer.subscribe(listener)
      const channels = source.subscriberCount
      observe(`reach`, `retry`)
      publish()
      observe(`retry`, {
        channels,
        version: observer.getSnapshot().state?.get(`a`)?.version,
        announced: listener.mock.calls.length > 0,
      })
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
  check: (history, trace, expected) => {
    for (let i = 0; i < history.repeats; i++) {
      const acquired = differs(
        `acquire ${i}`,
        `new ownership has a physical channel`,
        trace.find((entry) => entry.checkpoint === `acquire ${i}`)?.value,
        expected.acquired,
      )
      if (acquired) return acquired
      const release = trace.find((entry) => entry.checkpoint === `release ${i}`)
        ?.value as { outcome: unknown; channels: number } | undefined
      const failure = comparisonVerdict(
        `release ${i}`,
        `release reports the collaborator failure`,
        () => expect(release?.outcome).toEqual(expected.failure),
      )
      if (failure) return failure
      const retired = differs(
        `release ${i}`,
        `throwing release still retires its channel`,
        release?.channels,
        expected.released,
      )
      if (retired) return retired
    }
    return (
      differs(
        `retry`,
        `explicit retry acquires a new channel and publishes`,
        trace.find((entry) => entry.checkpoint === `retry`)?.value,
        expected.retry,
      ) ?? pass
    )
  },
})

/**
 * The setup law also covers failure before subscribeChanges, and a peer that
 * subscribes reentrantly during setup. A failed attempt transfers no physical
 * channel ownership. An already-returned peer record remains a logical owner;
 * the next explicit subscribe reattaches it. This follows subscribe/dispose's
 * handle ownership contract. A throwing `health:change` registration, which
 * the observer makes before subscribeChanges, supplies controlled early
 * failure; no failing registration transfers an unreturned handle.
 */
type PartialAttachHistory = {
  mode: `granular` | `wholesale`
  failureAt: `health` | `sync`
  reenter: boolean
  failures: number
}
type PartialAttachPlan = PartialAttachHistory & { failure: Error }
function partialAttachModel(history: PartialAttachPlan) {
  return {
    failure: history.failure,
    peer: history.reenter,
    retired: { statusLeases: 0, layoutLeases: 0, healthLeases: 0, source: 0 },
    retryChannels: 1,
    version: 1,
  }
}
const partialAttachHistory: fc.Arbitrary<PartialAttachHistory> = fc.record({
  mode: fc.constantFrom(`granular` as const, `wholesale` as const),
  failureAt: fc.constantFrom(`health` as const, `sync` as const),
  reenter: fc.boolean(),
  failures: fc.integer({ min: 1, max: 2 }),
})

oracleProperty<
  PartialAttachHistory,
  ReturnType<typeof partialAttachModel>,
  PartialAttachPlan
>({
  id: `live-query-observer.partial-attach`,
  law: {
    statement: `A failed attachment returns no physical ownership, preserves a returned logical peer, and allows the next explicit subscription to attach that peer.`,
    authority: `The observer subscribe/dispose handle ownership contract described above.`,
    limits: `Controlled health-registration or sync failure, both observer modes, optional reentrant peer, and one or two failures.`,
  },
  owns: [`src/live-query-observer.ts`],
  histories: {
    arbitrary: partialAttachHistory,
    runs: 60,
    fixedSeeds: [2229],
    states: [`early-failure`, `sync-failure`, `surviving-peer`, `no-peer`],
    constructed: [
      {
        name: `early failure retains a peer`,
        enters: [`early-failure`, `surviving-peer`],
        build: (generated) => ({
          ...generated,
          failureAt: `health`,
          reenter: true,
        }),
      },
      {
        name: `sync failure without a peer`,
        enters: [`sync-failure`, `no-peer`],
        build: (generated) => ({
          ...generated,
          failureAt: `sync`,
          reenter: false,
        }),
      },
    ],
  },
  resolve: (history) => ({ ...history, failure: new Error(`setup failure`) }),
  // A failed acquisition owns no physical channels. The logical peer is the
  // caller that returned during setup, and the successful retry owns one.
  model: partialAttachModel,
  driver: async (history, observe) => {
    const failure = history.failure
    let failing = true
    let reentered = false
    let peerStop: (() => void) | undefined
    let publish = () => {}
    const peer = vi.fn()
    let healthLeases = 0
    const source = createCollection<Row>({
      getKey: (row) => row.id,
      gcTime: 0,
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
      if (event === `health:change`) {
        if (history.reenter && !reentered) {
          reentered = true
          peerStop = observer.subscribe(peer)
        }
        if (failing && history.failureAt === `health`) throw failure
        const stopHealth = on(event, listener)
        healthLeases++
        let active = true
        return () => {
          if (active) {
            active = false
            healthLeases--
            stopHealth()
          }
        }
      }
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
    const leases = () => ({
      statusLeases,
      layoutLeases,
      healthLeases,
      source: source.subscriberCount,
    })
    await withOracleCleanup(async () => {
      for (let i = 0; i < history.failures; i++) {
        let outcome = { threw: false, error: undefined as unknown }
        try {
          observer.subscribe(() => {})
        } catch (error) {
          outcome = { threw: true, error }
        }
        observe(`failed attachment ${i}`, {
          outcome,
          peer: Boolean(peerStop),
          leases: leases(),
        })
        observe(
          `reach`,
          history.failureAt === `health` ? `early-failure` : `sync-failure`,
        )
        observe(`reach`, peerStop ? `surviving-peer` : `no-peer`)
        await source.cleanup()
      }
      failing = false
      stop = observer.subscribe(() => {})
      const channels = source.subscriberCount
      publish()
      observe(`retry`, {
        channels,
        version: observer.getSnapshot().state?.get(`a`)?.version,
        peerAnnounced: peer.mock.calls.length > 0,
      })
      stop()
      peerStop?.()
      observe(`released retry`, leases())
    }, [
      () => stop?.(),
      () => peerStop?.(),
      () => observer.dispose(),
      () => source.cleanup(),
    ])
  },
  check: (history, trace, expected) => {
    for (let i = 0; i < history.failures; i++) {
      const failed = trace.find(
        (entry) => entry.checkpoint === `failed attachment ${i}`,
      )?.value as
        | {
            outcome: { threw: boolean; error: unknown }
            peer: boolean
            leases: unknown
          }
        | undefined
      const thrown = comparisonVerdict(
        `failed attachment ${i}`,
        `attachment reports the setup failure`,
        () =>
          expect(() => {
            if (failed?.outcome.threw) throw failed.outcome.error
          }).toThrow(expected.failure),
      )
      if (thrown) return thrown
      const ownership = differs(
        `failed attachment ${i}`,
        `failure returns no physical ownership and keeps its logical peer`,
        { peer: failed?.peer, leases: failed?.leases },
        { peer: expected.peer, leases: expected.retired },
      )
      if (ownership) return ownership
    }
    const retry = trace.find((entry) => entry.checkpoint === `retry`)?.value as
      { channels: number; version: number; peerAnnounced: boolean } | undefined
    const attached = differs(
      `retry`,
      `explicit retry attaches and publishes`,
      { channels: retry?.channels, version: retry?.version },
      { channels: expected.retryChannels, version: expected.version },
    )
    if (attached) return attached
    if (expected.peer) {
      const peer = differs(
        `retry`,
        `retry announces to the surviving peer`,
        retry?.peerAnnounced,
        true,
      )
      if (peer) return peer
    }
    return (
      differs(
        `released retry`,
        `all acquired channels are released`,
        trace.find((entry) => entry.checkpoint === `released retry`)?.value,
        expected.retired,
      ) ?? pass
    )
  },
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
| hydration under terminal statuses | seed crossed with `error`, `crashed`, `cleaned-up`, restart, and attach order | DbClient hydrate -> getSnapshot/notify/attach | status, flags, rows, and announced changes after each step | generated `live-query-observer-hydration-oracle.property.test.ts` |
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
  fc.record({ type: fc.constant(`dispose` as const) }),
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
  oracleAssertion(`assertHistory:988`, () =>
    expect(actual, JSON.stringify({ history, checkpoint })).toEqual(expected),
  )
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
        oracleAssertion(`runHistory:1184`, () =>
          expect(caught).toBe(expectedOutcome.failure),
        )
        armed = undefined
      }

      assertHistory(
        history,
        checkpoint,
        applyDeliveryMutant(actual, options.mutant),
        model.deliveries,
      )
      oracleAssertion(`runHistory:1194`, () =>
        expect(visibleRows(source.state)).toEqual(
          model.sourceVersion === undefined
            ? []
            : [{ key: `row`, version: model.sourceVersion }],
        ),
      )
      for (const [id, listenerModel] of model.listeners) {
        oracleAssertion(`runHistory:1200`, () =>
          expect(reconstructed.get(id)?.get(`row`)?.version).toBe(
            listenerModel.version,
          ),
        )
      }
      if (!model.disposed) {
        oracleAssertion(`runHistory:1205`, () =>
          expect(
            visibleRows(observer.getSnapshot().state ?? new Map()),
          ).toEqual(
            model.sourceVersion === undefined
              ? []
              : [{ key: `row`, version: model.sourceVersion }],
          ),
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

// Registration delegates to runHistory's existing independent eligibility
// model and comparisons. The adapter preserves its assertion object and never
// converts setup, production, or cleanup failures into comparison verdicts.
const listenerReachStates = [
  `command:subscribe`,
  `command:unsubscribe`,
  `command:publish`,
  `command:dispose`,
  ...reactions.map((reaction) => `reaction:${reaction}`),
]
// A calibration runs a production mutant of runHistory and accepts exactly the
// old rejection: an AssertionError from the eligibility ledger's comparison.
// It returns that rejection, so the caller can check its premises first.
async function mutantRejection(
  name: string,
  mutantRun: () => Promise<void>,
): Promise<Error | undefined> {
  try {
    await mutantRun()
  } catch (error) {
    if (error instanceof Error && error.name === `AssertionError`) return error
    throw new Error(
      `${name}: the check rejected with an error the old matcher did not accept: ${String(error)}`,
    )
  }
  return undefined
}

const joiningHistory: Array<Command> = [
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

const duplicateBootstrapHistory: Array<Command> = [
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

const versionMarginHistory: Array<Command> = [
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
]

type CalibrationPlan = Array<Command>
type CalibrationObserve = (checkpoint: string, value: unknown) => void

// Each old calibration test runs whole as a mutant driver: its clean premise
// run, its exact reach premise, and the mutant that the ledger must reject.
function historyCalibrations(mode: `granular` | `wholesale`) {
  const calibration = (
    name: string,
    body: () => Promise<void>,
  ): {
    name: string
    law: string
    driver: (
      plan: CalibrationPlan,
      observe: CalibrationObserve,
    ) => Promise<void>
  } => ({
    name,
    law: `listener eligibility ledger`,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `listener eligibility ledger`,
        plan,
        observe,
        body,
      ),
  })
  return [
    calibration(
      `${mode} listeners joining during dispatch start with the next eligible publication`,
      async () => {
        const history = joiningHistory
        const reach = emptyReach()
        await runHistory(mode, history, { reach })
        expect(reach.reactions.addPeer).toBe(1)
        const rejection = await mutantRejection(`early peer delivery`, () =>
          runHistory(mode, history, { mutant: `earlyPeerDelivery` }),
        )
        if (rejection) rejectAt(`calibration: early peer delivery`, rejection)
      },
    ),
    calibration(
      `rejects dropped peer delivery after a throwing listener through the ${mode} production path`,
      async () => {
        const history = reactionHistory(`throw`)
        await runHistory(mode, history)
        const reach = emptyReach()
        const rejection = await mutantRejection(
          `dropped peer after throw`,
          () =>
            runHistory(mode, history, { mutant: `dropPeerAfterThrow`, reach }),
        )
        expect(reach.reactions.throw).toBe(1)
        if (rejection)
          rejectAt(`calibration: dropped peer after throw`, rejection)
      },
    ),
    ...(mode === `granular`
      ? [
          calibration(
            `rejects a duplicate granular bootstrap through the production seed path`,
            async () => {
              const history = duplicateBootstrapHistory
              await runHistory(`granular`, history)
              const rejection = await mutantRejection(
                `duplicate bootstrap`,
                () =>
                  runHistory(`granular`, history, {
                    mutant: `duplicateBootstrap`,
                  }),
              )
              if (rejection)
                rejectAt(`calibration: duplicate bootstrap`, rejection)
            },
          ),
        ]
      : []),
    calibration(
      `rejects a reentrant publication delivered out of FIFO order through the ${mode} production path`,
      async () => {
        const history = reactionHistory(`nested`)
        await runHistory(mode, history)
        const reach = emptyReach()
        const rejection = await mutantRejection(`reentrant out of order`, () =>
          runHistory(mode, history, { mutant: `reentrantOutOfOrder`, reach }),
        )
        expect(reach.reactions.nested).toBe(1)
        if (rejection)
          rejectAt(`calibration: reentrant out of order`, rejection)
      },
    ),
  ]
}

for (const [mode, id] of [
  [`granular`, `live-query-observer.granular-history`],
  [`wholesale`, `live-query-observer.wholesale-history`],
] as const) {
  oracleProperty<Array<Command>, Verdict>({
    id,
    law: {
      statement: `Listeners receive each one-row publication in eligibility order, with the established bootstrap, reentry, disposal, and first-error rules.`,
      authority: `The existing independent eligibility ledger and contract table in this file.`,
      limits: `One row, keys and versions in the existing command grammar, at most one nested publication per command; the focused owners retain hydration, multi-row layout, and framework boundaries.`,
    },
    owns: [`src/live-query-observer.ts`],
    histories: {
      arbitrary: fc.array(command, { minLength: 1, maxLength: 30 }),
      runs: 75,
      fixedSeeds: [1813, -1359260562],
      states: listenerReachStates,
      fixed: [
        {
          name: `${mode} one-row version margins retain the no-change boundary`,
          history: versionMarginHistory,
        },
      ],
      constructed: [
        {
          name: `subscription ownership commands`,
          enters: [
            `command:subscribe`,
            `command:unsubscribe`,
            `command:dispose`,
          ],
          build: (generated) => [
            { type: `subscribe` as const, listener: 0 },
            { type: `unsubscribe` as const, listener: 0 },
            { type: `dispose` as const },
            ...generated.slice(0, 27),
          ],
        },
        ...reactions.map((reaction) => ({
          name: `${reaction} publication`,
          enters: [`command:publish`, `reaction:${reaction}`],
          build: (generated: Array<Command>) => [
            ...reactionHistory(reaction),
            ...generated.slice(0, 27),
          ],
        })),
      ],
    },
    model: recordedAssertionJudgment,
    driver: async (history, observe) => {
      const reach = emptyReach()
      await recordAssertionJudgment(
        `listener eligibility ledger`,
        history,
        observe,
        async () => {
          await runHistory(mode, history, { reach })
        },
      )
      for (const [commandName, count] of Object.entries(reach.commands))
        if (count > 0) observe(`reach`, `command:${commandName}`)
      for (const [reaction, count] of Object.entries(reach.reactions))
        if (count > 0) observe(`reach`, `reaction:${reaction}`)
    },
    check: forwardAssertionJudgment,
    calibrations: historyCalibrations(mode),
  })
}

async function executeEveryKind() {
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
  expect(Object.values(reach.reactions).every((count) => count > 0)).toBe(true)
}

describe(`LiveQueryObserver generated histories`, () => {
  oracleProperty({
    id: `live-query-observer.history-every-kind`,
    law: {
      statement: `Listeners receive each one-row publication in eligibility order, with the established bootstrap, reentry, disposal, and first-error rules.`,
      authority: `The existing independent eligibility ledger and contract table in this file.`,
      limits: `Fixed production histories in both modes that execute every command and reaction kind; each must be reached.`,
    },
    owns: [`src/live-query-observer.ts`],
    histories: [
      `executes every command and reaction kind in fixed production histories`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `listener eligibility ledger`,
        plan,
        observe,
        () => executeEveryKind(),
      ),
    check: forwardAssertionJudgment,
  })
})
