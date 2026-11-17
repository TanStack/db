// @vitest-environment node
import { createCollection } from '@tanstack/db'
import { afterAll, inject, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred'
import {
  checkGcObservation,
  createGcModel,
  gcDeadline,
  stepGcModel,
} from '../../db/tests/collection-gc-retention-oracle'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { electricCollectionOptions } from '../src/electric'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type {
  GcAction,
  GcModel,
  GcObservation,
} from '../../db/tests/collection-gc-retention-oracle'

/**
 * The shared GC model owns retention and retirement. This receiving driver
 * supplies a real PostgreSQL transaction and the installed Electric SDK. An
 * assigned but uncommitted txid cannot be acknowledged by the Electric stream.
 * The mutation handler awaits that txid while elapsed time crosses the deadline
 * that would retire an unheld Collection. Committing PostgreSQL releases real
 * confirmation; caller settlement must preserve the source row and renew GC.
 *
 * Only host idle delivery is controlled. Real elapsed timers and provider I/O
 * run normally. Chromium's separate driver owns native idle provenance. These
 * twelve histories cross small/ordinary gcTime and absent/last subscribers with
 * one writer or two independently committed writers in both orders. A completed
 * writer must not end its sibling's retention hold. Settlement order names the
 * local optimistic transactions, independently of PostgreSQL txid assignment.
 * The source keys follow SQL
 * COMMIT actions, never Collection reads. Arbitrary provider recovery, native
 * browser/provider composition and persisted wrappers remain outside this path.
 */
const idleHost = vi.hoisted(() => {
  const callbacks = new Map<number, IdleRequestCallback>()
  let nextId = 0
  vi.stubGlobal(`window`, {
    requestIdleCallback: (callback: IdleRequestCallback) => {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancelIdleCallback: (id: number) => {
      callbacks.delete(id)
    },
  })
  return { callbacks }
})
afterAll(() => vi.unstubAllGlobals())

/**
 * The histories: every gcTime, subscriber and settlement-order combination,
 * enumerated, so each runs in every campaign.
 */
type GcReceivingHistory = {
  gcTime: 10 | 100
  lastUnsubscribe: boolean
  settlementOrder: Array<0 | 1>
}
const histories: Array<GcReceivingHistory> = ([10, 100] as const).flatMap(
  (gcTime) =>
    [false, true].flatMap((lastUnsubscribe) =>
      ([[0], [0, 1], [1, 0]] as Array<Array<0 | 1>>).map((settlementOrder) => ({
        gcTime,
        lastUnsubscribe,
        settlementOrder,
      })),
    ),
)
const orderName = ({ settlementOrder }: GcReceivingHistory) =>
  settlementOrder.length === 1
    ? `single`
    : settlementOrder[0] === 0
      ? `oldest-first`
      : `newest-first`

/**
 * Declared reach, per history: the states its own receiving path must enter.
 * An enumerated source runs every history, so the check requires each
 * history's states (law `declared reach`), as the earlier per-test reach
 * ledger did. Two writers add the sibling hold across the first release.
 */
function owedReach(history: GcReceivingHistory): Array<string> {
  return [
    `provider-confirmations-held`,
    ...(history.settlementOrder.length === 2
      ? [
          `provider-${orderName(history)}`,
          `surviving-provider-hold-crosses-deadline`,
        ]
      : []),
    `all-provider-writes-confirmed`,
    `renewed-zero-budget`,
    `renewed-usable-idle`,
  ]
}

/**
 * The GC model's owed state at one cut, without its clock fields. The shared
 * model reads elapsed wall-clock time, which only the driver can measure; a
 * trace that held clock readings would differ between two runs and fail the
 * determinism test. So the driver steps the shared model, from the history's
 * actions and the measured elapsed time alone, never from a production
 * observation, and records this projection beside the observation. Every
 * wait in this grammar ends comfortably before or after the deadline that
 * decides `retired` (see the waits below), so the projection is a function of
 * the history's actions and the same in every run.
 */
// The cleanup field is read by destructuring and typed by name, never as a
// property access or a quoted key: scripts/mangle-private-members.mjs reserves
// that name for a private member of @tanstack/db, and such a spelling outside
// packages/db would block the mangle. The shape is the model's own fields.
type OwedGcState = {
  retired: GcModel[`retired`]
  cleaningUp: boolean
  transactions: GcModel[`transactions`]
}
type GcCut = {
  cut: string
  owed: OwedGcState
  observed: GcObservation
  sourceKeys: Array<number>
}

// A margin past the model's deadline, so timer rounding (a Node timer can
// fire about a millisecond early) cannot leave the model before it.
const deadlineMarginMs = 20

async function recordGcReceiving(
  history: GcReceivingHistory,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const { gcTime, lastUnsubscribe, settlementOrder } = history
  const table = `gc_confirmation_${crypto.randomUUID().replaceAll('-', '')}`
  const schema = inject(`testSchema`)
  const admin = makePgClient()
  const writers = settlementOrder.map(() => makePgClient())
  const assignedTxids = writers.map(() => createDeferred<number>())
  const sqlOpen = writers.map(() => false)
  const acknowledged = writers.map(() => false)
  const callerOutcomes = writers.map(() => `pending`)
  const sourceKeys = new Set<number>()
  let tableCreated = false
  const collection = createCollection(
    electricCollectionOptions<{ id: number; value: string }>({
      id: table,
      getKey: (row) => row.id,
      startSync: false,
      gcTime,
      shapeOptions: {
        url: `${inject(`baseUrl`)}/v1/shape`,
        params: { table: `"${schema}"."${table}"` },
        onError: (error) => {
          throw error
        },
      },
      onInsert: async ({ collection: owner, transaction }) => {
        const id = transaction.mutations[0].modified.id
        const slot = id - 1
        const writer = writers[slot]!
        try {
          await writer.query(`BEGIN`)
          sqlOpen[slot] = true
          const result = await writer.query<{ txid: string }>(
            `INSERT INTO "${schema}"."${table}" (id, value) VALUES ($1, 'confirmed') RETURNING pg_current_xact_id()::text AS txid`,
            [id],
          )
          const txid = Number(result.rows[0]!.txid)
          assignedTxids[slot]!.resolve(txid)
          await owner.utils.awaitTxId(txid, 15_000)
          acknowledged[slot] = true
        } catch (error) {
          assignedTxids[slot]!.reject(error)
          throw error
        }
      },
    }),
  )
  let primaryFailure: unknown
  let checkFailed = false
  const observeCallers: Array<Promise<void>> = []
  const sourceRows = async () =>
    (
      await admin.query<{ id: number }>(
        `SELECT id FROM "${schema}"."${table}" ORDER BY id`,
      )
    ).rows.map((row) => row.id)
  try {
    await admin.connect()
    await Promise.all(writers.map((writer) => writer.connect()))
    await admin.query(
      `CREATE TABLE "${schema}"."${table}" (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`,
    )
    tableCreated = true
    await collection.preload()
    const startedAt = performance.now()
    // The shared model, stepped from environment inputs only: the history's
    // actions and the elapsed time this driver measures. No production
    // observation reaches it.
    const model = createGcModel(gcTime)
    const advance = () =>
      stepGcModel(model, {
        kind: `advance`,
        elapsedMs: performance.now() - startedAt - model.now,
      })
    const apply = (action: GcAction) => {
      advance()
      stepGcModel(model, action)
    }
    const subscription = lastUnsubscribe
      ? collection.subscribeChanges(() => {})
      : undefined
    if (subscription) apply({ kind: `subscribe` })
    const transactions = writers.map((_, slot) => {
      const transaction = collection.insert({
        id: slot + 1,
        value: `confirmed`,
      })
      apply({ kind: `insert`, commit: true })
      observeCallers.push(
        transaction.when(`settled`).then(
          () => {
            callerOutcomes[slot] = `fulfilled`
          },
          () => {
            callerOutcomes[slot] = `rejected`
          },
        ),
      )
      return transaction
    })
    if (subscription) {
      subscription.unsubscribe()
      apply({ kind: `unsubscribe` })
    }
    const observation = (): GcObservation => ({
      retired: collection.status === `cleaned-up`,
      visibleKeys: [...collection.keys()].map((key) => {
        if (typeof key !== `number`)
          throw new Error(`Expected integer PostgreSQL key, received ${key}`)
        return key
      }),
      transactionStates: transactions.map((transaction) => transaction.state),
    })
    const cut = (name: string) => {
      advance()
      const { retired, cleaningUp, transactions: owedTransactions } = model
      const value: GcCut = {
        cut: name,
        owed: {
          retired,
          cleaningUp,
          transactions: [...owedTransactions],
        },
        observed: observation(),
        sourceKeys: [...sourceKeys],
      }
      observe(`gc`, value)
    }
    const idle = (hasTime: boolean) => {
      for (const [id, callback] of [...idleHost.callbacks]) {
        idleHost.callbacks.delete(id)
        callback({
          didTimeout: false,
          timeRemaining: () => (hasTime ? 50 : 0),
        })
      }
      apply({ kind: `idle`, hasTime, didTimeout: false })
    }
    const provider = (slot: number) => ({
      sqlOpen: sqlOpen[slot],
      acknowledged: acknowledged[slot],
      caller: callerOutcomes[slot],
      phase: transactions[slot]!.state,
    })

    const txids = await Promise.all(
      assignedTxids.map((assigned) => assigned.promise),
    )
    // The separate connection cannot see either uncommitted source row. This
    // proves genuine provider work, not merely a held utility Promise.
    observe(`provider work`, {
      txidsSafe: txids.every(Number.isSafeInteger),
      distinctTxids: new Set(txids).size,
      sqlOpen: [...sqlOpen],
      visibleSourceRows: await sourceRows(),
    })
    // Every writer holds the Collection, so the model's deadline is
    // unbounded here: this wait only has to cross the unheld deadline.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(gcTime, 50) + deadlineMarginMs),
    )
    idle(true)
    cut(`real Electric confirmations held across unheld GC deadline`)
    observe(`held across deadline`, {
      crossedUnheldDeadline: model.now >= Math.max(gcTime, 50),
      providers: writers.map((_, slot) => provider(slot)),
    })
    observe(`reach`, `provider-confirmations-held`)

    for (const [index, slot] of settlementOrder.entries()) {
      await writers[slot]!.query(`COMMIT`)
      sqlOpen[slot] = false
      sourceKeys.add(slot + 1)
      await observeCallers[slot]
      observe(`settled provider`, { slot, ...provider(slot) })
      apply({ kind: `settle`, slot, outcome: `complete` })
      cut(`real Electric caller settlement ${index}`)
      if (index + 1 < settlementOrder.length) {
        const survivor = settlementOrder[index + 1]!
        observe(`surviving provider`, {
          slot: survivor,
          ...provider(survivor),
          visibleSourceRows: await sourceRows(),
        })
        observe(`reach`, `provider-${orderName(history)}`)
        // A fresh delay after the first confirmation is insufficient: the
        // remaining handler still owns the Collection past that deadline. The
        // survivor holds the Collection, so the model's deadline is unbounded.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(gcTime, 50) + deadlineMarginMs),
        )
        idle(true)
        cut(
          `surviving real Electric confirmation holds after first release deadline`,
        )
        observe(`surviving provider after deadline`, {
          slot: survivor,
          ...provider(survivor),
        })
        observe(`reach`, `surviving-provider-hold-crosses-deadline`)
      }
    }
    observe(`reach`, `all-provider-writes-confirmed`)
    observe(`confirmed rows`, {
      rows: [...sourceKeys].map((id) => {
        const row = collection.get(id)
        return row === undefined
          ? null
          : {
              key: id,
              id: row.id,
              value: row.value,
              hasPendingWrites: row.$hasPendingWrites,
            }
      }),
      idleRequests: idleHost.callbacks.size,
    })

    // Timer delivery proves core reached renewed eligibility. A zero-budget
    // host opportunity must preserve rows; a usable one then retires them.
    await vi.waitFor(() => {
      if (idleHost.callbacks.size === 0)
        throw new Error(`core has not requested renewed idle work`)
    })
    advance()
    // Real timers may round a sub-millisecond deadline. Wait past the
    // independent model's deadline, by the margin, before delivering the idle
    // opportunity, so the model is past it in every run.
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, gcDeadline(model) - model.now) + deadlineMarginMs,
      ),
    )
    idle(false)
    cut(`real Electric renewed deadline without idle budget`)
    observe(`zero-budget idle`, { idleRequests: idleHost.callbacks.size })
    observe(`reach`, `renewed-zero-budget`)
    idle(true)
    await Promise.resolve()
    cut(`real Electric renewed deadline with idle budget`)
    // The usable idle opportunity comes past the model's deadline, so the
    // model retires; the state is entered only then, and the check requires
    // production to have retired at the same cut.
    observe(`usable idle`, {
      modelRetired: model.retired,
      retired: collection.status === `cleaned-up`,
    })
    if (model.retired) observe(`reach`, `renewed-usable-idle`)
  } catch (error) {
    checkFailed = true
    primaryFailure = error
  }
  const cleanupFailures: Array<unknown> = []
  for (const cleanup of [
    ...writers.map((writer, slot) => async () => {
      if (sqlOpen[slot]) await writer.query(`ROLLBACK`)
    }),
    () => collection.cleanup(),
    () => Promise.all(observeCallers),
    ...writers.map((writer) => () => writer.end()),
    async () => {
      if (tableCreated)
        await admin.query(`DROP TABLE IF EXISTS "${schema}"."${table}"`)
    },
    () => admin.end(),
  ]) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  idleHost.callbacks.clear()
  if (checkFailed || cleanupFailures.length)
    throw new AggregateError(
      [...(checkFailed ? [primaryFailure] : []), ...cleanupFailures],
      `Electric GC receiving driver or cleanup failed`,
      { cause: primaryFailure },
    )
}

const valuesAt = <T>(trace: ReadonlyArray<Observation>, checkpoint: string) =>
  trace
    .filter((entry) => entry.checkpoint === checkpoint)
    .map((entry) => entry.value as T)

type ProviderObservation = {
  slot?: number
  sqlOpen: boolean
  acknowledged: boolean
  caller: string
  phase: string
  visibleSourceRows?: Array<number>
}

/**
 * The check. Each `gc` cut runs the shared, unchanged checkGcObservation on
 * the model's owed state and the public observation (law `gc retention`).
 * The provider cuts check what the earlier driver asserted inline: genuine
 * held provider work across the unheld deadline, a caller that settles only
 * with its acknowledgement, a sibling whose SQL transaction and hold survive
 * the first release, the confirmed rows, and the renewed idle requests.
 * Reach is checked last, so a wrong observation is reported as itself.
 */
function checkGcReceiving(
  history: GcReceivingHistory,
  trace: ReadonlyArray<Observation>,
  expected: { reach: Array<string> },
): Verdict {
  const writers = history.settlementOrder.length
  for (const value of valuesAt<GcCut>(trace, `gc`)) {
    try {
      checkGcObservation(
        // The owed state, with the clock field the trace leaves out; the
        // checker reads `now` only for its message.
        { ...createGcModel(history.gcTime), ...value.owed, now: Number.NaN },
        value.observed,
        value.cut,
        value.sourceKeys,
      )
    } catch (error) {
      return violation(
        `gc`,
        error instanceof Error ? error.message : String(error),
        `gc retention`,
        { actual: value.observed, expected: value.owed },
      )
    }
  }
  for (const work of valuesAt<{
    txidsSafe: boolean
    distinctTxids: number
    sqlOpen: Array<boolean>
    visibleSourceRows: Array<number>
  }>(trace, `provider work`)) {
    if (
      !work.txidsSafe ||
      work.distinctTxids !== writers ||
      work.sqlOpen.some((open) => !open) ||
      work.visibleSourceRows.length > 0
    )
      return violation(
        `provider work`,
        `the provider did not hold ${writers} distinct, open, uncommitted SQL transactions`,
        `genuine provider work`,
        {
          actual: work,
          expected: {
            txidsSafe: true,
            distinctTxids: writers,
            sqlOpen: Array.from({ length: writers }, () => true),
            visibleSourceRows: [],
          },
        },
      )
  }
  const held = (provider: ProviderObservation) =>
    provider.sqlOpen &&
    !provider.acknowledged &&
    provider.caller === `pending` &&
    provider.phase === `persisting`
  for (const value of valuesAt<{
    crossedUnheldDeadline: boolean
    providers: Array<ProviderObservation>
  }>(trace, `held across deadline`)) {
    if (!value.crossedUnheldDeadline || !value.providers.every(held))
      return violation(
        `held across deadline`,
        `a provider confirmation did not stay held, pending and persisting across the unheld GC deadline`,
        `held provider confirmation`,
      )
  }
  for (const value of valuesAt<ProviderObservation>(
    trace,
    `settled provider`,
  )) {
    if (value.caller !== `fulfilled` || !value.acknowledged)
      return violation(
        `settled provider`,
        `writer ${value.slot} settled without its genuine acknowledgement`,
        `provider confirmation settles the caller`,
      )
  }
  for (const value of valuesAt<ProviderObservation>(
    trace,
    `surviving provider`,
  )) {
    const committed = history.settlementOrder[0]! + 1
    if (
      !held(value) ||
      JSON.stringify(value.visibleSourceRows) !== JSON.stringify([committed])
    )
      return violation(
        `surviving provider`,
        `the sibling's hold or SQL transaction did not survive the first release`,
        `a completed writer keeps its sibling's hold`,
      )
  }
  for (const value of valuesAt<ProviderObservation>(
    trace,
    `surviving provider after deadline`,
  )) {
    if (value.phase !== `persisting` || value.caller !== `pending`)
      return violation(
        `surviving provider after deadline`,
        `the sibling's hold ended at the first release deadline`,
        `a completed writer keeps its sibling's hold`,
      )
    if (value.acknowledged)
      return violation(
        `surviving provider after deadline`,
        `the sibling was acknowledged before its SQL transaction committed`,
        `a completed writer keeps its sibling's hold`,
      )
  }
  for (const value of valuesAt<{
    rows: Array<{
      key: number
      id: number
      value: string
      hasPendingWrites: boolean
    } | null>
    idleRequests: number
  }>(trace, `confirmed rows`)) {
    if (
      value.rows.some(
        (row) =>
          row === null ||
          row.id !== row.key ||
          row.value !== `confirmed` ||
          row.hasPendingWrites,
      ) ||
      value.idleRequests !== 0
    )
      return violation(
        `confirmed rows`,
        `a confirmed row is missing, differs or still has pending writes, or idle work was requested early`,
        `confirmed rows`,
      )
  }
  for (const value of valuesAt<{ idleRequests: number }>(
    trace,
    `zero-budget idle`,
  )) {
    if (value.idleRequests === 0)
      return violation(
        `zero-budget idle`,
        `a zero-budget idle opportunity consumed the renewed idle request`,
        `zero-budget idle keeps the request`,
      )
  }
  for (const value of valuesAt<{ modelRetired: boolean; retired: boolean }>(
    trace,
    `usable idle`,
  )) {
    if (!value.modelRetired || !value.retired)
      return violation(
        `usable idle`,
        value.modelRetired
          ? `the Collection did not retire at the first usable idle opportunity past its renewed deadline`
          : `the model had not retired at the usable idle cut, so the wait did not cross the renewed deadline`,
        `usable idle retires`,
        { actual: value, expected: { modelRetired: true, retired: true } },
      )
  }
  const reached = valuesAt<string>(trace, `reach`)
  const missing = expected.reach.filter((state) => !reached.includes(state))
  if (missing.length > 0)
    return violation(
      `reach`,
      `the history did not enter ${missing.join(`, `)}`,
      `declared reach`,
    )
  // The usable idle cut retired both the model and the Collection (law
  // `usable idle retires` above), and the last gc cut compared the rest.
  return pass
}

oracleProperty({
  id: `collection-lifecycle.gc-retention-boundaries.electric-postgres`,
  law: {
    statement: `A held real Electric confirmation keeps a Collection past its unheld GC deadline; caller settlement follows genuine acknowledgement, a completed writer leaves its sibling's hold in place, and GC renews only after the last confirmation, retiring on the first usable idle opportunity.`,
    authority: `The shared GC retention model and checker (packages/db/tests/collection-gc-retention-oracle.ts) and its coverage-map entry; the maintainer's first-usable-idle retirement decision.`,
    limits: `Twelve histories: gcTime 10/100ms, absent or last-unsubscribed owner, one writer or two in both settlement orders. Real PostgreSQL and Electric, controlled host idle delivery, real elapsed timers. Provider failure and recovery, three or more writers, browser/provider composition and persistence wrappers are outside this path. The shared model is stepped in the driver from actions and measured elapsed time, never from production observations, so traces stay free of clock readings.`,
  },
  owns: [`src/electric.ts#electricCollectionOptions`],
  histories,
  label: (history) =>
    `retains real Electric confirmations across GC with gcTime ${history.gcTime}, last unsubscribe ${history.lastUnsubscribe}, and ${orderName(history)} settlement`,
  model: (history) => ({ reach: owedReach(history) }),
  driver: recordGcReceiving,
  check: checkGcReceiving,
  calibrations: [
    {
      // A wrong public result at the usable idle cut: no retirement.
      name: `no retirement at the usable idle opportunity`,
      law: `usable idle retires`,
      corrupt: (trace) =>
        trace.some((entry) => entry.checkpoint === `usable idle`)
          ? trace.map((entry) =>
              entry.checkpoint === `usable idle`
                ? {
                    checkpoint: entry.checkpoint,
                    value: { ...(entry.value as object), retired: false },
                  }
                : entry,
            )
          : undefined,
    },
    {
      // A plausible wrong public result at the held cut: an early retirement.
      name: `hostile early retirement`,
      law: `gc retention`,
      corrupt: (trace) => {
        const at = trace.findIndex((entry) => entry.checkpoint === `gc`)
        if (at < 0) return undefined
        const value = trace[at]!.value as GcCut
        return trace.map((entry, index) =>
          index === at
            ? {
                checkpoint: `gc`,
                value: {
                  ...value,
                  observed: { ...value.observed, retired: true },
                },
              }
            : entry,
        )
      },
    },
  ],
  timeout: 120_000,
})
