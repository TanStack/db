/** Actual SDK and Collection boundaries for the on-demand owner's judgment. */
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  parseLoadSubsetOptions,
} from '@tanstack/db'
import {
  PowerSyncClient,
  StreamError,
  powerSyncCollectionOptions,
} from '../src'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { FakeService } from './fake-service'
import { eagerProtocolTurn, untilEagerProtocol } from './eager-protocol-service'
import { resolveStreams } from './protocol-request'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  OnDemandBoundaryHistory,
  OnDemandBoundaryObservation,
} from '../../db-adapter-conformance/tests/on-demand-streams-oracle'

export async function observeDirectRequestBoundary(
  h: OnDemandBoundaryHistory,
  id: string,
  persistence?: PersistedCollectionPersistence,
): Promise<OnDemandBoundaryObservation> {
  if (h.schedule.startsWith(`lease-release`))
    return observeDirectReleaseBoundary(h, id)
  const service = new FakeService()
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
    retryDelayMs: 1,
  })
  const stream = (group: number) => `boundary-${h.coordinate}-${group}`
  const laterBatch = h.schedule === `receipt-abort-later-batch`
  const priorityHistory = h.schedule.startsWith(`priority-`)
  const priorityOwnRows =
    h.schedule === `priority-request-abort` ||
    h.schedule === `priority-query-abort` ||
    h.schedule === `priority-cleanup-abort`
  const priorityPeerReceipt = h.schedule === `priority-peer-receipt-abort`
  const abortHistory =
    h.schedule === `checkpoint-abort` ||
    h.schedule === `receipt-abort` ||
    laterBatch ||
    priorityHistory
  const receiptHistory = h.schedule.startsWith(`receipt-`) || abortHistory
  const caller = new AbortController()
  let armCheckpointAbort = false
  let checkpointAbortDelivered = false
  const applicationStatus = client.subscribeStatus(() => {
    if (!armCheckpointAbort || client.status.state !== `ready`) return
    armCheckpointAbort = false
    checkpointAbortDelivered = true
    caller.abort()
  })
  const durableFailure = new Error(`durable-${h.coordinate}`)
  let holdDurable = false
  let durableHeld = false
  let releaseDurable = () => {}
  const durableGate = new Promise<void>((resolve) => {
    releaseDurable = resolve
  })
  let durableSequence = 0
  let releaseLaterDurable = () => {}
  const laterDurableGate = new Promise<void>((resolve) => {
    releaseLaterDurable = resolve
  })
  // This fault belongs to the storage collaborator. The persisted wrapper
  // still returns and rejects its actual source receipt and crashes through
  // its production failure boundary; no commit receipt is replaced.
  const faultCopies = new WeakMap<
    PersistedCollectionPersistence,
    PersistedCollectionPersistence
  >()
  const faultAdapters = new Set<PersistedCollectionPersistence[`adapter`]>()
  const restoreFaults: Array<() => void> = []
  const wrapDurableFault = (
    storage: PersistedCollectionPersistence,
  ): PersistedCollectionPersistence => {
    const previous = faultCopies.get(storage)
    if (previous) return previous
    // Browser coordination retains this exact adapter. Intercept its durable
    // collaborator boundary in place so direct and coordinated calls receive
    // the same injected failure, then restore it after fixture cleanup.
    if (!faultAdapters.has(storage.adapter)) {
      const adapter = storage.adapter
      const actual = adapter.applyCommittedTx
      adapter.applyCommittedTx = async (...args) => {
        if (holdDurable) {
          durableSequence++
          durableHeld = true
          await (durableSequence === 1 ? durableGate : laterDurableGate)
          if (!laterBatch) throw durableFailure
        }
        return actual.apply(adapter, args)
      }
      faultAdapters.add(adapter)
      restoreFaults.push(() => {
        adapter.applyCommittedTx = actual
      })
    }
    const wrapped: PersistedCollectionPersistence = {
      ...storage,
      ...(storage.resolvePersistenceForCollection
        ? {
            resolvePersistenceForCollection: (input) =>
              wrapDurableFault(storage.resolvePersistenceForCollection!(input)),
          }
        : {}),
      ...(storage.resolvePersistenceForMode
        ? {
            resolvePersistenceForMode: (mode) =>
              wrapDurableFault(storage.resolvePersistenceForMode!(mode)),
          }
        : {}),
    }
    faultCopies.set(storage, wrapped)
    return wrapped
  }
  const faultPersistence = persistence && wrapDurableFault(persistence)
  let insideAcquire = false
  let callbacksDuringAcquire = 0
  let callbackCount = 0
  let providerFailure: unknown
  const sdkWaits: Array<{
    target: boolean
    outcome: `pending` | `fulfilled` | `rejected`
    error?: unknown
  }> = []
  const acquire = client.acquireStreams.bind(client)
  client.acquireStreams = (streams, options) => {
    insideAcquire = true
    try {
      const actual = acquire(streams, {
        ...options,
        onError: (error) => {
          callbackCount++
          if (insideAcquire) callbacksDuringAcquire++
          if (error.stream.name === stream(1)) providerFailure = error
          options?.onError?.(error)
        },
      })
      return {
        release: actual.release,
        waitForSync: (signal) => {
          const record: (typeof sdkWaits)[number] = {
            target: streams.some((value) => value.name === stream(1)),
            outcome: `pending`,
          }
          sdkWaits.push(record)
          const result = actual.waitForSync(signal)
          void result.then(
            () => {
              record.outcome = `fulfilled`
            },
            (error: unknown) => {
              record.outcome = `rejected`
              record.error = error
            },
          )
          return result
        },
      }
    } finally {
      insideAcquire = false
    }
  }
  type Row = { id: string; group: number; value: number }
  type Load = {
    group: number
    options: LoadSubsetOptions
    outcome: `pending` | `fulfilled` | `rejected`
    error?: unknown
    abortedAtSettlement?: boolean
  }
  const loads: Array<Load> = []
  const coreSignals = new Map<number, AbortSignal | undefined>()
  const receipts: Array<{
    outcome: `pending` | `fulfilled` | `rejected`
    error?: unknown
  }> = []
  const groupOf = (options: LoadSubsetOptions) => {
    const group = parseLoadSubsetOptions(options).filters.find(
      (filter) => filter.field[0] === `group`,
    )?.value
    if (typeof group !== `number`) throw new Error(`Missing group demand`)
    return group
  }
  const options = powerSyncCollectionOptions<Row>({
    id,
    client,
    table: `rows`,
    parse: (row) => row as Row,
    getSubscriptions: (request) => [
      {
        name: stream(groupOf(request)),
        ...(priorityHistory
          ? { priority: groupOf(request) === 1 ? 0 : 3 }
          : {}),
      },
    ],
  })
  const sync = options.sync.sync
  options.sync.sync = (params) => {
    const handlers = sync({
      ...params,
      commit: (signal) => {
        const actual = params.commit(signal)
        const record: (typeof receipts)[number] = {
          outcome: actual === true ? `fulfilled` : `pending`,
        }
        receipts.push(record)
        if (actual !== true)
          void actual.then(
            () => {
              record.outcome = `fulfilled`
            },
            (error: unknown) => {
              record.outcome = `rejected`
              record.error = error
            },
          )
        return actual
      },
    })
    if (!handlers || typeof handlers !== `object` || !handlers.loadSubset)
      throw new Error(`Missing source subset handlers`)
    const loadSubset = handlers.loadSubset
    return {
      ...handlers,
      loadSubset: (request) => {
        const record: Load = {
          group: groupOf(request),
          options: request,
          outcome: `pending`,
        }
        loads.push(record)
        if (priorityHistory) coreSignals.set(record.group, request.signal)
        const actual = loadSubset(request)
        void Promise.resolve(actual).then(
          () => {
            record.outcome = `fulfilled`
            record.abortedAtSettlement =
              coreSignals.get(record.group)?.aborted === true
          },
          (error: unknown) => {
            record.outcome = `rejected`
            record.error = error
            record.abortedAtSettlement =
              coreSignals.get(record.group)?.aborted === true
          },
        )
        return actual
      },
    }
  }
  const collection = createCollection(
    faultPersistence
      ? persistedCollectionOptions({
          ...options,
          persistence: faultPersistence,
        })
      : options,
  )
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const requests: Array<{
    outcome: `pending` | `fulfilled` | `rejected`
    error?: unknown
  }> = []
  const request = (group: number, signal?: AbortSignal) => {
    const record: (typeof requests)[number] = { outcome: `pending` }
    requests.push(record)
    subscription.requestSnapshot({
      signal,
      where: new IR.Func(`eq`, [
        new IR.PropRef([`group`]),
        new IR.Value(group),
      ]),
      onLoadSubsetResult: (actual, requestData) => {
        coreSignals.set(group, requestData.signal)
        void Promise.resolve(actual).then(
          () => {
            record.outcome = `fulfilled`
          },
          (error: unknown) => {
            record.outcome = `rejected`
            record.error = error
          },
        )
      },
    })
    return record
  }
  const live = (group: number) => {
    const record: (typeof requests)[number] = { outcome: `pending` }
    requests.push(record)
    const query = createLiveQueryCollection((q) =>
      q.from({ row: collection }).where(({ row }) => eq(row.group, group)),
    )
    void query.preload().then(
      () => {
        record.outcome = `fulfilled`
      },
      (error: unknown) => {
        record.outcome = `rejected`
        record.error = error
      },
    )
    return { query, record }
  }
  let peerQuery: ReturnType<typeof live>[`query`] | undefined
  let targetQuery: ReturnType<typeof live>[`query`] | undefined
  const propagate = async () => {
    await service.drained()
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
  }
  let revision = 0
  const deliver = async (failed: boolean, rows = false, partial = false) => {
    await untilEagerProtocol(
      () =>
        service.live &&
        service.requests.length > revision &&
        service.lastRequest.streams.subscriptions.some(
          (value: { stream: string }) =>
            value.stream ===
            stream(failed || partial ? 1 : receiptHistory ? 0 : 1),
        ),
      `new SDK request for boundary input`,
    )
    revision = service.requests.length
    service.checkpoint(
      (partial ? [`good`, `late`] : [`good`]).filter(() => receiptHistory),
      {
        ...(partial ? { priorities: { good: 0, late: 3 } } : {}),
        streams: resolveStreams(service.lastRequest.streams, (value) =>
          failed && value.stream === stream(1)
            ? `rejected-${h.coordinate}`
            : undefined,
        ),
      },
    )
    if (rows)
      for (let index = 0; index < h.rowCount; index++)
        service.put(`good`, `rows`, `row-${index}`, {
          group: abortHistory ? 1 : 0,
          value: h.coordinate + index,
        })
    if (partial) service.partialComplete(0)
    else service.complete()
    await propagate()
  }
  let releaseMutation = () => {}
  let mutation: ReturnType<typeof createTransaction> | undefined
  let donor: ReturnType<PowerSyncClient[`acquireStreams`]> | undefined
  return withOracleCleanup(async () => {
    await untilEagerProtocol(
      () => collection.status === `ready`,
      `source Collection started`,
    )
    if (h.schedule === `receipt-durable-failure` || laterBatch)
      donor = client.acquireStreams([{ name: stream(0) }])
    if (h.schedule === `cached-rejection`)
      donor = client.acquireStreams([{ name: stream(1) }])
    if (receiptHistory) {
      const baseLive = priorityHistory ? live(0) : undefined
      peerQuery = baseLive?.query
      const baseline = baseLive?.record ?? request(0)
      const deadline = Date.now() + 2000
      while (baseline.outcome === `pending`) {
        if (Date.now() > deadline)
          throw new Error(`Baseline demand did not settle`)
        if (service.live && service.requests.length > revision)
          await deliver(false)
        else await eagerProtocolTurn()
      }
      if (h.schedule === `receipt-durable-failure` || laterBatch) {
        if (!faultPersistence)
          throw new Error(`Durable schedule requires actual persistence`)
        holdDurable = true
      } else if (!priorityHistory || priorityOwnRows || priorityPeerReceipt) {
        const gate = new Promise<void>((resolve) => {
          releaseMutation = resolve
        })
        mutation = createTransaction({ mutationFn: () => gate })
        mutation.mutate(() =>
          collection.insert({
            id: `optimistic`,
            group: priorityHistory ? -1 : 0,
            value: 0,
          }),
        )
      }
      // An ordinary same-request table update creates an actual accepted
      // receipt held behind this public optimistic transaction.
      if (!holdDurable && (!abortHistory || priorityPeerReceipt)) {
        service.checkpoint([`good`])
        for (let index = 0; index < h.rowCount; index++)
          service.put(`good`, `rows`, `row-${index}`, {
            group: 0,
            value: h.coordinate + index,
          })
        service.complete()
        await propagate()
        await untilEagerProtocol(
          () => receipts.some((receipt) => receipt.outcome === `pending`),
          `real accepted source receipt pending`,
        )
      }
    }
    armCheckpointAbort = h.schedule === `checkpoint-abort`
    const targetLive =
      h.schedule === `priority-query-abort` ? live(1) : undefined
    targetQuery = targetLive?.query
    let current =
      targetLive?.record ?? request(1, abortHistory ? caller.signal : undefined)
    let load = loads.at(-1)!
    await deliver(
      !abortHistory,
      priorityHistory ? priorityOwnRows : holdDurable || abortHistory,
      priorityHistory,
    )
    if (holdDurable)
      await untilEagerProtocol(
        () =>
          durableHeld &&
          receipts.some((receipt) => receipt.outcome === `pending`),
        `actual persistence receipt held at stream rejection`,
      )
    load = loads.filter((entry) => entry.group === 1).at(-1)!
    if (!abortHistory)
      await untilEagerProtocol(
        () => callbackCount > 0,
        `actual SDK service rejection callback`,
      )
    const providerWaitPendingBeforeAbort =
      priorityHistory &&
      sdkWaits.some((wait) => wait.target && wait.outcome === `pending`)
    const partialReceivedBeforeAbort =
      priorityHistory &&
      service.partialCompletions > 0 &&
      client.status.state === `syncing` &&
      (!priorityOwnRows ||
        Array.from(
          { length: h.rowCount },
          (_value, index) => `row-${index}`,
        ).every((key) => client.tableSnapshot(`rows`).has(key)))
    let targetQueryStatusBeforeAbort: string | undefined
    if (priorityHistory) {
      targetQueryStatusBeforeAbort = targetQuery?.status
      if (targetQuery) await targetQuery.cleanup()
      else caller.abort()
      for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
    }
    const subscriptionStatusAtAbort = subscription.status
    const peerQueryStatusAtAbort = peerQuery?.status
    const ownReceipt = receipts
      .filter((receipt) => receipt.outcome === `pending`)
      .at(-1)
    let laterReceipt: (typeof receipts)[number] | undefined
    if (laterBatch) {
      service.checkpoint([`good`])
      service.put(`good`, `rows`, `later-${h.coordinate}`, {
        group: 0,
        value: h.coordinate,
      })
      service.complete()
      await propagate()
      await untilEagerProtocol(
        () =>
          receipts.filter((receipt) => receipt.outcome === `pending`).length >=
          2,
        `later real source receipt queued beside own receipt`,
      )
      laterReceipt = receipts.at(-1)
      caller.abort()
    }
    if (h.schedule === `receipt-abort` || laterBatch) {
      caller.abort()
      for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
    }
    const receiptPendingAtFailure = receipts.some(
      (receipt) => receipt.outcome === `pending`,
    )
    const rawPendingAtFailure = load.outcome === `pending`
    const coreAbortedAtFailure = coreSignals.get(1)?.aborted === true
    const rawPendingWhileReceiptHeld = load.outcome === `pending`
    const requestAbortedWhileReceiptHeld =
      coreSignals.get(1)?.aborted === true && receiptPendingAtFailure
    let cachedFailureReused = false
    if (h.schedule === `cached-rejection`) {
      await untilEagerProtocol(
        () => current.outcome === `rejected`,
        `first request rejection`,
      )
      const previousFailure = load.error
      current = request(1)
      load = loads.at(-1)!
      await untilEagerProtocol(
        () => load.outcome === `rejected`,
        `cached request rejection without another checkpoint`,
      )
      cachedFailureReused =
        load.error === previousFailure && load.error === providerFailure
    }
    if (h.schedule === `receipt-cleanup`) await collection.cleanup()
    if (h.schedule === `priority-cleanup-abort`)
      await collection.cleanup({ dependents: true })
    let ownReceiptFulfilledAtLaterCut = false
    let laterReceiptPendingAtLaterCut = false
    let rawOutcomeAtLaterCut: typeof load.outcome | undefined
    releaseDurable()
    if (laterBatch) {
      await untilEagerProtocol(
        () => durableSequence >= 2,
        `later durable operation held after own receipt`,
      )
      for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
      ownReceiptFulfilledAtLaterCut = ownReceipt?.outcome === `fulfilled`
      laterReceiptPendingAtLaterCut = laterReceipt?.outcome === `pending`
      rawOutcomeAtLaterCut = load.outcome
    }
    releaseLaterDurable()
    if (laterBatch)
      await untilEagerProtocol(
        () => receipts.every((receipt) => receipt.outcome !== `pending`),
        `later accepted receipt settled after its explicit release`,
      )
    releaseMutation()
    if (mutation) await mutation.when(`settled`)
    await untilEagerProtocol(
      () => load.outcome !== `pending`,
      `raw source load settles`,
    )
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
    const rejected = receipts.find((receipt) => receipt.outcome === `rejected`)
    return {
      callbackCount,
      providerStreamError: providerFailure instanceof StreamError,
      providerMessages:
        providerFailure instanceof StreamError
          ? [...providerFailure.messages]
          : [],
      callbacksDuringAcquire,
      cachedFailureReused,
      receiptPendingAtFailure,
      rawPendingAtFailure,
      coreAbortedAtFailure,
      rawPendingWhileReceiptHeld,
      requestAbortedWhileReceiptHeld,
      checkpointAbortDelivered,
      ownReceiptFulfilledAtLaterCut,
      laterReceiptPendingAtLaterCut,
      rawOutcomeAtLaterCut,
      partialReceivedBeforeAbort,
      providerWaitPendingBeforeAbort,
      peerQueryStatus: peerQuery?.status,
      peerQueryRows:
        peerQuery?.status === `ready`
          ? peerQuery.toArray.map((row) => row.id).sort()
          : undefined,
      targetQueryStatusBeforeAbort,
      targetQueryStatusAfterAbort: targetQuery?.status,
      subscriptionStatusAtAbort,
      peerQueryStatusAtAbort,
      rawPreservedQueuedAbort:
        priorityHistory &&
        load.error === sdkWaits.filter((wait) => wait.target).at(-1)?.error,
      receiptOutcome: receiptHistory
        ? rejected
          ? `rejected`
          : receipts.at(-1)!.outcome
        : `absent`,
      rawOutcome: load.outcome,
      rawCause:
        load.error === providerFailure
          ? `provider`
          : rejected && load.error === rejected.error
            ? `receipt`
            : `other`,
      rawErrorName: load.error instanceof Error ? load.error.name : undefined,
      receiptErrorName:
        rejected?.error instanceof Error ? rejected.error.name : undefined,
      coreCause:
        current.error === undefined
          ? `absent`
          : current.error === providerFailure
            ? `provider`
            : current.error === rejected?.error
              ? `receipt`
              : `other`,
      coreAbortedAtRawSettlement: load.abortedAtSettlement === true,
      coreOutcome: current.outcome,
      sourceStatus: collection.status,
      sourceFailures: collection.health.error?.errors.length ?? 0,
      sourceRows: [...collection.keys()].sort(),
      terminalCause: !collection.health.error
        ? `absent`
        : collection.health.error.cause === durableFailure ||
            (collection.health.error.cause instanceof Error &&
              collection.health.error.cause.cause === durableFailure)
          ? `durable`
          : collection.health.error.cause === providerFailure
            ? `provider`
            : `other`,
      reached:
        (priorityHistory
          ? partialReceivedBeforeAbort &&
            providerWaitPendingBeforeAbort &&
            coreSignals.get(1)?.aborted === true
          : abortHistory
            ? receiptPendingAtFailure && requestAbortedWhileReceiptHeld
            : callbackCount > 0) &&
        load.outcome === `rejected` &&
        (abortHistory ||
          h.schedule === `fresh-rejection` ||
          (h.schedule === `cached-rejection` && cachedFailureReused) ||
          (receiptPendingAtFailure &&
            receipts.some(
              (receipt) =>
                receipt.outcome ===
                (h.schedule === `receipt-cleanup` ||
                h.schedule === `receipt-durable-failure`
                  ? `rejected`
                  : `fulfilled`),
            )))
          ? [h.schedule]
          : [],
    }
  }, [
    () => {
      releaseDurable()
      releaseLaterDurable()
      releaseMutation()
      subscription.unsubscribe()
    },
    () => targetQuery?.cleanup(),
    () => peerQuery?.cleanup(),
    () => collection.cleanup(),
    () => donor?.release(),
    applicationStatus,
    () => {
      for (const restore of restoreFaults) restore()
    },
  ])
}

/** Actual subset retirement beside a retained healthy demand, before/after the next checkpoint. */
async function observeDirectReleaseBoundary(
  h: OnDemandBoundaryHistory,
  id: string,
): Promise<OnDemandBoundaryObservation> {
  const service = new FakeService()
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
  })
  const stream = (group: number) => `release-${h.coordinate}-${group}`
  const acquire = client.acquireStreams.bind(client)
  let armed = false
  let readyReentries = 0
  const applicationStatus = client.subscribeStatus(() => {
    if (!armed || client.status.state !== `ready`) return
    armed = false
    readyReentries++
    acquire([{ name: `transient-${readyReentries}` }]).release()
  })
  type Wait = {
    outcome: `pending` | `fulfilled` | `rejected`
    signal?: AbortSignal
  }
  const leases: Array<{
    group: number
    released: boolean
    waits: Array<Wait>
  }> = []
  let callbackCount = 0
  let providerFailure: StreamError | undefined
  let callbacksDuringAcquire = 0
  let insideAcquire = false
  client.acquireStreams = (streams, options) => {
    insideAcquire = true
    try {
      const actual = acquire(streams, {
        ...options,
        onError: (error) => {
          callbackCount++
          providerFailure = error
          if (insideAcquire) callbacksDuringAcquire++
          options?.onError?.(error)
        },
      })
      const record = {
        group: streams.some((value) => value.name === stream(1)) ? 1 : 0,
        released: false,
        waits: [] as Array<Wait>,
      }
      leases.push(record)
      return {
        release: () => {
          record.released = true
          actual.release()
        },
        waitForSync: (signal) => {
          const wait: Wait = { outcome: `pending`, signal }
          record.waits.push(wait)
          const result = actual.waitForSync(signal)
          void result.then(
            () => {
              wait.outcome = `fulfilled`
            },
            () => {
              wait.outcome = `rejected`
            },
          )
          return result
        },
      }
    } finally {
      insideAcquire = false
    }
  }
  const collection = createCollection(
    powerSyncCollectionOptions({
      id,
      client,
      table: `rows`,
      parse: (row) => row as { id: string; group: number },
      getSubscriptions: (options) => [
        {
          name: stream(
            Number(parseLoadSubsetOptions(options).filters[0]!.value),
          ),
        },
      ],
    }),
  )
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const request = (group: number) => {
    const record = {
      outcome: `pending` as `pending` | `fulfilled` | `rejected`,
      release: () => {},
    }
    subscription.requestSnapshot({
      where: new IR.Func(`eq`, [
        new IR.PropRef([`group`]),
        new IR.Value(group),
      ]),
      onLoadSubsetResult: (result, _options, release) => {
        record.release = release
        void Promise.resolve(result).then(
          () => {
            record.outcome = `fulfilled`
          },
          () => {
            record.outcome = `rejected`
          },
        )
      },
    })
    return record
  }
  let revision = 0
  const deliver = async (failed: boolean, peerRows = false) => {
    await untilEagerProtocol(
      () => service.live && service.requests.length > revision,
      `new request for release boundary`,
    )
    revision = service.requests.length
    service.checkpoint([`good`], {
      streams: resolveStreams(service.lastRequest.streams, (value) =>
        failed && value.stream === stream(1)
          ? `rejected-${h.coordinate}`
          : undefined,
      ),
    })
    if (peerRows)
      service.put(`good`, `rows`, `peer-${h.coordinate}`, { group: 0 })
    service.complete()
    await service.drained()
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
  }
  let targetRelease = () => {}
  return withOracleCleanup(async () => {
    await untilEagerProtocol(
      () => collection.status === `ready`,
      `source Collection started`,
    )
    for (const group of [0, 1]) {
      const demand = request(group)
      const deadline = Date.now() + 2000
      while (demand.outcome === `pending`) {
        if (Date.now() > deadline)
          throw new Error(`Release-boundary baseline did not settle`)
        if (service.live && service.requests.length > revision)
          await deliver(false)
        else await eagerProtocolTurn()
      }
      if (group === 1) targetRelease = demand.release
    }
    const target = leases
      .filter((lease) => lease.group === 1 && !lease.released)
      .at(-1)!
    let maximumPendingForOneLease = 0
    // Every complete checkpoint settles the old generation before notifying
    // ready. Reentry may create one new wait; it cannot accumulate old waits.
    for (let index = 0; index < h.statusChanges; index++) {
      if (index === 0) acquire([{ name: `trigger` }]).release()
      armed = true
      await deliver(true)
      const pending = target.waits.filter(
        (wait) => wait.outcome === `pending`,
      ).length
      maximumPendingForOneLease = Math.max(maximumPendingForOneLease, pending)
      if (!pending)
        throw new Error(
          `Application reentry did not hold the actual target SDK wait`,
        )
    }
    if (h.schedule === `lease-release-after-checkpoint`) await deliver(false)
    targetRelease()
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
    const pendingWaitsAfterRelease = target.waits.filter(
      (wait) => wait.outcome === `pending`,
    ).length
    const rowsAtRelease = [...collection.keys()].sort()
    const abortedWaitsAfterRelease = target.waits.filter(
      (wait) => wait.signal?.aborted,
    ).length
    // Record release before supplying this later checkpoint: it must not hide
    // the outstanding-wait observation. The surviving demand still receives it.
    await deliver(false, true)
    return {
      callbackCount,
      providerStreamError: providerFailure instanceof StreamError,
      providerMessages: providerFailure ? [...providerFailure.messages] : [],
      callbacksDuringAcquire,
      cachedFailureReused: false,
      receiptPendingAtFailure: false,
      rawPendingAtFailure: false,
      coreAbortedAtFailure: false,
      receiptOutcome: `absent`,
      rawOutcome: `fulfilled`,
      rawCause: `absent`,
      coreCause: `absent`,
      coreAbortedAtRawSettlement: false,
      coreOutcome: `fulfilled`,
      sourceStatus: collection.status,
      sourceRows: [...collection.keys()].sort(),
      rowsAtRelease,
      sourceFailures: collection.health.error?.errors.length ?? 0,
      terminalCause: `absent`,
      pendingWaitsAfterRelease,
      maximumPendingForOneLease,
      readyReentries,
      abortedWaitsAfterRelease,
      peerActive: leases.some((lease) => lease.group === 0 && !lease.released),
      reached:
        readyReentries === h.statusChanges &&
        target.released &&
        maximumPendingForOneLease > 0
          ? [h.schedule]
          : [],
    }
  }, [
    () => subscription.unsubscribe(),
    () => collection.cleanup(),
    applicationStatus,
  ])
}
