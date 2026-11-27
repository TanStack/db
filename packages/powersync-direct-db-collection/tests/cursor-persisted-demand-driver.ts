/**
 * Genuine CollectionSubscription cursor requests cross the real Direct SDK,
 * HTTP checkpoint and persisted wrapper, with closed/reopened storage per run.
 * The primary model judges the actual sent cursor and request settlement.
 *
 * Current subscription status and scoped load errors supply loading/ready/error.
 * Each callback promise describes one physical acquisition; a snapshot may
 * abort it and replay the retained logical demand. Those original outcomes and
 * signals remain diagnostics, not a promise that later replay must fulfill.
 * Rows are a separate Collection projection, not a cursor live-query result.
 * Page-shaped source tables keep every authored A row inside the saved demand;
 * the primary FilterSpec therefore expresses that projection without an offset.
 * Durable reads reuse the main receiver's public generation-claim projection.
 * Actual adapter resets are separate diagnostics, never authored source facts.
 */
import { BTreeIndex, IR } from '@tanstack/db'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import { durableRows, source } from './persisted-demand-driver'
import type { LoadSubsetRequestResult } from '@tanstack/db'
import type {
  CoverageRecord,
  SourceEvent,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type { DirectDemandSession, Source } from './persisted-demand-driver'
import type { CursorDemandHistory } from './cursor-persisted-demand-history-oracle'

type CursorSettlement = `pending` | `fulfilled` | `rejected`
type PhysicalObservation = {
  settlement: CursorSettlement
  aborted: boolean
  error?: string
}
export type CursorDemandResult = {
  beforeStartupEvents: Array<SourceEvent>
  beforeStartup: Array<Record<string, unknown>>
  savedPhysical: Array<PhysicalObservation>
  savedAcquisitions: ReturnType<Source['physical']>
  cuts: Array<{
    name: string
    record: CoverageRecord
    durable: Array<Record<string, unknown>>
    acquisitions: ReturnType<Source['physical']>
    physical: Array<PhysicalObservation>
    subscriptionErrors: Array<{ error: string; aborted: boolean }>
  }>
  reached: Array<string>
  resets: Array<{ session: number; confirmed: boolean }>
  providerRequests: Array<number>
  cleanupErrors: Array<string>
  browserErrors?: ReadonlyArray<string>
}

const turn = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, premise: string) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Unreached Direct cursor premise: ${premise}`)
    await turn(5)
  }
}

function request(current: Source, rank: number, limit: number) {
  const physical: Array<{
    settlement: CursorSettlement
    signal?: AbortSignal
    error?: string
  }> = []
  const errors: Array<{ error: string; aborted: boolean }> = []
  const subscription = current.collection.subscribeChanges(() => {}, {
    includeInitialState: false,
    whereExpression: new IR.Func(`eq`, [
      new IR.PropRef([`group`]),
      new IR.Value(`a`),
    ]),
    onLoadSubsetError: (event) => {
      errors.push({
        error: describeOracleCleanupError(event.error),
        aborted: event.options.signal?.aborted === true,
      })
    },
  })
  subscription.setOrderByIndex(
    current.collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    }),
  )
  subscription.requestLimitedSnapshot({
    minValues: [rank],
    orderBy: [
      {
        expression: new IR.PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ],
    limit,
    // An explicit zero retains the finite provider limit. The actual request
    // still carries whereFrom/whereCurrent, which primary readLoad evaluates.
    offset: 0,
    onLoadSubsetResult: (value: LoadSubsetRequestResult, options) => {
      const attempt: (typeof physical)[number] = {
        settlement: `pending`,
        signal: options.signal,
      }
      physical.push(attempt)
      void Promise.resolve(value).then(
        () => {
          attempt.settlement = `fulfilled`
        },
        (error: unknown) => {
          attempt.settlement = `rejected`
          attempt.error = describeOracleCleanupError(error)
        },
      )
    },
  })
  return {
    subscription,
    settlement: (): CursorSettlement =>
      errors.some((error) => !error.aborted)
        ? `rejected`
        : subscription.status === `ready`
          ? `fulfilled`
          : `pending`,
    diagnostics: () => ({
      physical: physical.map(({ signal, ...attempt }) => ({
        ...attempt,
        aborted: signal?.aborted === true,
      })),
      subscriptionErrors: errors.map((error) => ({ ...error })),
    }),
  }
}

/** Each cleanup runs; a completed receiving observation keeps its identity. */
export async function recordCursorDemandCleanup(
  result: Pick<CursorDemandResult, `cleanupErrors`>,
  tasks: ReadonlyArray<() => unknown>,
) {
  for (const task of tasks)
    try {
      await task()
    } catch (error) {
      result.cleanupErrors.push(describeOracleCleanupError(error))
    }
}

/** Preserve completed observations and separate outer host cleanup failures. */
export async function retainCursorDemandCleanup(
  execute: () => Promise<CursorDemandResult>,
  tasks: ReadonlyArray<() => unknown>,
): Promise<CursorDemandResult> {
  let result: CursorDemandResult | undefined
  let primary: { error: unknown } | undefined
  const secondary: Array<unknown> = []
  try {
    result = await execute()
  } catch (error) {
    primary = { error }
  }
  if (result) await recordCursorDemandCleanup(result, tasks)
  else {
    for (const task of tasks) {
      try {
        await task()
      } catch (error) {
        secondary.push(error)
      }
    }
  }
  if (primary) {
    if (secondary.length)
      throw new AggregateError(
        [primary.error, ...secondary],
        `Direct cursor execution and cleanup failed`,
        { cause: primary.error },
      )
    throw primary.error
  }
  return result!
}

/** Source facts, exact requests and public/durable cuts feed the shared model. */
export async function observeCursorPersistedDemand(
  history: CursorDemandHistory,
  id: string,
  open: () => DirectDemandSession | Promise<DirectDemandSession>,
): Promise<CursorDemandResult> {
  const events: Array<SourceEvent> = []
  const result: CursorDemandResult = {
    beforeStartupEvents: [],
    beforeStartup: [],
    savedPhysical: [],
    savedAcquisitions: [],
    cuts: [],
    reached: [],
    resets: [],
    providerRequests: [],
    cleanupErrors: [],
  }
  const cleanup = (tasks: ReadonlyArray<() => unknown>) =>
    recordCursorDemandCleanup(result, tasks)
  const savedBoundary = history.coordinate
  const activeBoundary = savedBoundary + (history.boundary === `same` ? 0 : 1)
  const page = Array.from({ length: history.limit }, (_, index) => ({
    id: `saved-${index}`,
    group: `a`,
    rank: savedBoundary + index + 1,
    value: `saved:${history.coordinate}:${index}`,
  }))
  const first = await open()
  const online = source(first.persistence, id, 0, events, result.resets, 1)
  let saved: ReturnType<typeof request> | undefined
  try {
    // Start the sync run before its first demand. A direct subscription's
    // original request promise can otherwise be aborted by the SDK's initial
    // listener truncate. This receiver judges saved-demand reuse, not that
    // separate initial-replay ownership path.
    online.collection.startSyncImmediate()
    await online.receiveCommits()
    saved = request(online, savedBoundary, history.limit)
    await until(
      () => online.sent.length > 0 && online.service.active,
      `saved cursor reached SDK HTTP`,
    )
    events.push({
      type: `rows`,
      rows: page.map(({ id: key, ...value }) => [key, value]),
    })
    await online.checkpointAndApply(page)
    // The provider and issued receipts establish the cut. A bounded task drain
    // lets their finite promise continuations report status; it never waits
    // for expected rows or readiness. Missing applied-load reach is observable.
    await turn(25)
    if (
      events.some(
        (event) =>
          event.type === `settled` &&
          event.current &&
          !event.aborted &&
          event.load.cursor?.whereFrom,
      )
    )
      result.reached.push(`saved cursor applied`)
    result.savedPhysical = saved.diagnostics().physical
    result.savedAcquisitions = online.physical()
    result.providerRequests.push(online.service.requests)
  } finally {
    await cleanup([
      () => saved?.subscription.unsubscribe(),
      () => online.collection.cleanup(),
      () => first.close(),
    ])
  }
  result.beforeStartupEvents = [...events]
  const second = await open()
  result.beforeStartup = await durableRows(second.persistence, id)
  const offline = source(second.persistence, id, 0, events, result.resets, 2)
  let current: ReturnType<typeof request> | undefined
  const take = async (
    name: string,
    host: Source,
    demand: ReturnType<typeof request>,
    storage: DirectDemandSession,
    failed = false,
  ) => {
    const settlement = demand.settlement()
    const record: CoverageRecord = {
      events: [...events],
      queries: {
        demand: {
          spec: { group: `a` },
          // This bounded driver has one logical cursor owner and no tie
          // request. A serial replay replaces its physical acquisition. The
          // actual acquisition signal identifies which request is still owed;
          // aborted acquisitions stay in source events and diagnostics. This maps the
          // glossary's demand/acquisition/abort distinction and ARCHITECTURE's
          // Replay participants law, without predicting source scheduling.
          sent: host.currentRequests(),
          observed: {
            status:
              settlement === `fulfilled`
                ? `ready`
                : settlement === `rejected`
                  ? `error`
                  : `loading`,
            ...(settlement === `fulfilled`
              ? {
                  rows: host.collection.toArray
                    .filter((row) => row.group === `a`)
                    .map((row) => row.id),
                }
              : {}),
          },
        },
      },
      collection: {
        status: host.collection.status,
        sourceMarkedReady: host.markedReady(),
      },
      waitPassed: !failed,
      upstream: failed ? `fails at once` : `never answers`,
    }
    result.cuts.push({
      name,
      record,
      acquisitions: host.physical(),
      ...demand.diagnostics(),
      durable: await durableRows(storage.persistence, id),
    })
  }
  try {
    offline.collection.startSyncImmediate()
    await offline.receiveCommits()
    current = request(offline, activeBoundary, history.limit)
    await until(
      () => offline.sent.length > 0 && offline.service.active,
      `reopened cursor reached SDK HTTP`,
    )
    await turn(25)
    const savedLoad = result.beforeStartupEvents.find(
      (event) => event.type === `settled` && event.current && !event.aborted,
    )
    if (savedLoad?.type === `settled` && offline.sent[0]?.cursor?.whereFrom) {
      const same =
        JSON.stringify(savedLoad.load.cursor) ===
        JSON.stringify(offline.sent[0].cursor)
      result.reached.push(
        `${same ? `same` : `changed`} cursor reopened offline`,
      )
    }
    await take(
      `offline cursor before source checkpoint`,
      offline,
      current,
      second,
    )
    if (history.after !== `offline`) {
      const replacement = [
        {
          id: `fresh`,
          group: `a`,
          rank: activeBoundary + 1,
          value: `fresh:${history.coordinate}`,
        },
      ]
      // The permitted cache replacement is authored by the first confirmed
      // nonempty lease checkpoint, never by observing Direct's own truncate.
      events.push({
        type: `snapshot`,
        rows: replacement.map(({ id: key, ...value }) => [key, value]),
      })
      await offline.checkpointAndApply(replacement)
      await turn(25)
      if (offline.service.confirmed)
        result.reached.push(`confirmed cursor checkpoint after reopen`)
      await take(
        `after cursor checkpoint replacement`,
        offline,
        current,
        second,
      )
    }
    result.providerRequests.push(offline.service.requests)
  } finally {
    await cleanup([
      () => current?.subscription.unsubscribe(),
      () => offline.collection.cleanup(),
      () => second.close(),
    ])
  }
  if (history.after === `evict`) {
    const third = await open()
    const old = source(third.persistence, id, 60_000, events, result.resets, 3)
    let prior: ReturnType<typeof request> | undefined
    try {
      old.collection.startSyncImmediate()
      await old.receiveCommits()
      prior = request(old, savedBoundary, history.limit)
      await until(
        () => old.sent.length > 0 && old.service.active,
        `saved cursor after eviction reached SDK HTTP`,
      )
      await old.checkpointAndApply([], true)
      await turn(25)
      if (prior.settlement() === `rejected`)
        result.reached.push(`saved cursor rejected after eviction`)
      await take(`saved cursor after cache eviction`, old, prior, third, true)
      result.providerRequests.push(old.service.requests)
    } finally {
      await cleanup([
        () => prior?.subscription.unsubscribe(),
        () => old.collection.cleanup(),
        () => third.close(),
      ])
    }
  }
  return result
}
