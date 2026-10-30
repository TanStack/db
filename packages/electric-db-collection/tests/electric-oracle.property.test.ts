import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IR,
  createCollection,
  createTransaction,
  withAcceptedReceipt,
} from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { QueryClient } from '@tanstack/query-core'
import {
  PersistedCollectionDurabilityError,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../../query-db-collection/src/query'
import { electricCollectionOptions } from '../src/electric'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  checkMutationConfirmation,
  mutationConfirmationHistories,
  mutationConfirmationInputs,
} from '../../db/tests/mutation-confirmation-oracle'
import { atCheckpoint, withElectricCleanup } from './electric-oracle-lifecycle'
import { createMockStream } from './electric-stream-mock'
import {
  applyRetryModel,
  createRetryModel,
  expectedRetryObservation,
  retryStepIsLegal,
} from './electric-retry-decision-model'
import {
  change,
  createDeferred,
  createMetadata,
  createOracleCollection,
  createPersistedAdapter,
  everyContiguousPartition,
  expectGaveUpAfterReadiness,
  expectPreloadOutcome,
  expectWholePublications,
  mockStream,
  mockSubscribe,
  mustRefetch,
  observableResume,
  observePreload,
  observePublications,
  resetElectricOracleMocks,
  resumeState,
  rowsFromCollection,
  rowsFromMap,
  runTrace,
  shapeId,
  subsetEnd,
  upToDate,
} from './electric-adapter-support'
import type { MutationConfirmationObservation } from '../../db/tests/mutation-confirmation-oracle'
import type {
  ObservedPreload,
  OracleRow,
  TraceResult,
} from './electric-adapter-support'
import type { Collection } from '@tanstack/db'
import type { ChangeMessage, Message } from '@electric-sql/client'
import type { ElectricCollectionUtils, ElectricSyncMode } from '../src/electric'
import type {
  RetryDecision,
  RetryHistory,
  RetryObservation,
  RetrySettlement,
  RetryStep,
  RetryWait,
} from './electric-retry-decision-model'

// Replays one generated law directly with the shared oracle variables:
// TANSTACK_DB_ORACLE_PROPERTY=<property>
// TANSTACK_DB_ORACLE_SEED=<reported seed>
// TANSTACK_DB_ORACLE_PATH=<reported path>
// pnpm exec vitest run tests/electric-oracle.property.test.ts -t '<law name> \(replay\)'
const registeredHistoryProperties = new Set<string>()

function electricHistoryProperty<T>(
  property: string,
  name: string,
  arbitrary: fc.Arbitrary<T>,
  baseRuns: number,
  fixedSeed: number,
  check: (value: T) => void | Promise<void>,
  timeout?: number,
  examples?: Array<[T]>,
): void {
  if (registeredHistoryProperties.has(property)) {
    throw new Error(`duplicate Electric history property: ${property}`)
  }
  registeredHistoryProperties.add(property)
  // A path replay of this property runs only the random campaign, from its
  // path. The fixed campaign stands aside during every path replay.
  oracleReplayTest(fcTest).prop([arbitrary], {
    numRuns: oracleRuns(baseRuns),
    seed: fixedSeed,
    examples,
  })(`${name} (fixed)`, check, timeout)
  oracleReplayTest(fcTest, property).prop([arbitrary], {
    ...oraclePropertyOptions(baseRuns, property),
    examples,
  })(`${name} (random)`, check, timeout)
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    // Full SDK release clears this stream's callback, including when another
    // Collection has a separate stream using these shared request mocks.
    ShapeStream: vi.fn(function () {
      return createMockStream(mockStream)
    }),
  }
})

/**
 * The same outcome/confirmation model receives a real Electric adapter through
 * controlled ShapeStream delivery. The fixture keeps backend work separate from
 * txid acknowledgement. A legacy txid return supplies no acknowledgement. A
 * rejection after explicit acceptance preserves source data and error identity.
 * This is a controlled SDK boundary, not a live Electric-service claim.
 */
describe(`mutation outcome and confirmation`, () => {
  const mutationHistories = mutationConfirmationHistories(`electric`)
  const mutationReach = createOracleReach(
    `electric.mutation-confirmation`,
    mutationHistories.map(
      (h) =>
        `${h.operation}/${h.outcome}/${h.confirmation}/${h.returned}/peer:${h.peer}`,
    ),
  )
  afterAll(() => {
    mutationReach.assertReached()
    console.info(
      `electric.mutation-confirmation reach`,
      Object.fromEntries(mutationReach.counts()),
    )
  })
  it.each(mutationHistories)(
    `settles a handler independently of discarded values: %j`,
    async (history) => {
      mutationReach.beginHistory()
      const { operation, confirmation, outcome, returned } = history
      const localReach = createOracleReach(`electric.mutation-cuts`, [
        `entered`,
        `settled`,
        `settlement-waiter`,
        ...(outcome === `reject-before-write` ? [] : [`server-written`]),
        ...(confirmation === `none`
          ? []
          : [`confirmation-requested`, `confirmation-accepted`]),
        ...(confirmation === `none` && outcome !== `reject-before-write`
          ? [`late-confirmed`]
          : []),
      ])
      localReach.beginHistory()
      resetElectricOracleMocks()
      let subscriber!: (messages: Array<Message<OracleRow>>) => void
      mockSubscribe.mockImplementationOnce((callback) => {
        subscriber = callback
        return () => {}
      })
      const enterRelease = createDeferred<void>()
      const confirmationRelease = createDeferred<void>()
      const settleRelease = createDeferred<void>()
      const entered = createDeferred<void>()
      const serverWritten = createDeferred<void>()
      const confirmationAccepted = createDeferred<void>()
      const confirmationRequested = createDeferred<void>()
      const failure = new Error(`handler ${outcome}`)
      let handlerWrites = 0
      let confirmationCalls = 0
      let confirmationStatus: MutationConfirmationObservation[`confirmationStatus`] = `not-requested`
      let settlement: MutationConfirmationObservation[`settlement`] = `pending`
      let error: unknown
      let verdict: Promise<MutationConfirmationObservation> | undefined
      let releaseCollection: (() => Promise<void>) | undefined
      await withElectricCleanup(async () => {
        const message = change(operation, 1, `confirmed`)
        if (operation !== `delete`)
          message.value = { ...mutationConfirmationInputs.confirmed }
        message.headers.txids = [55]
        const handler = async () => {
          entered.resolve()
          await enterRelease.promise
          if (outcome === `reject-before-write`) throw failure
          handlerWrites++
          serverWritten.resolve()
          await confirmationRelease.promise
          if (confirmation === `txid`) {
            confirmationCalls++
            confirmationStatus = `pending`
            const ack = collection.utils.awaitTxId(55).then(() => {
              confirmationStatus = `accepted`
            })
            confirmationRequested.resolve()
            await ack
          }
          confirmationAccepted.resolve()
          await settleRelease.promise
          if (outcome === `reject-after-write`) throw failure
          return returned === `legacy-txid` ? { txid: 55 } : undefined
        }
        const runtimeHandler = handler as unknown as () => Promise<void>
        const collection = createCollection(
          electricCollectionOptions<OracleRow>({
            id: `discarded-value-${JSON.stringify(history)}`,
            shapeOptions: {
              url: `http://test-url`,
              params: { table: `test_table` },
            },
            startSync: true,
            getKey: (row) => row.id,
            onInsert: runtimeHandler,
            onUpdate: runtimeHandler,
            onDelete: runtimeHandler,
          }),
        )
        releaseCollection = () => collection.cleanup()
        subscriber([
          ...(history.peer ? [change(`insert`, 2, `peer`)] : []),
          ...(operation === `insert` ? [] : [change(`insert`, 1, `before`)]),
          upToDate,
        ])
        await atCheckpoint(collection.preload(), `initial Electric preload`)
        const transaction =
          operation === `insert`
            ? collection.insert({ ...mutationConfirmationInputs.optimistic })
            : operation === `delete`
              ? collection.delete(1)
              : collection.update(1, (draft) => {
                  draft.name = `optimistic`
                })
        const observe = (): MutationConfirmationObservation => ({
          rows: collection.toArray
            .map(({ id, name, stable }) => ({ id, name, stable }))
            .sort((a, b) => a.id - b.id),
          handlerWrites,
          confirmationCalls,
          fetches: 0,
          confirmationStatus,
          providerRequests:
            mockStream.requestSnapshot.mock.calls.length +
            mockStream.fetchSnapshot.mock.calls.length +
            mockStream.forceDisconnectAndRefresh.mock.calls.length,
          state: transaction.state,
          settlement,
          error,
        })
        verdict = transaction.when(`settled`).then(
          () => {
            settlement = `fulfilled`
            return observe()
          },
          (reason: unknown) => {
            settlement = `rejected`
            error = reason
            return observe()
          },
        )
        await atCheckpoint(entered.promise, `Electric handler entry`)
        checkMutationConfirmation(history, `entered`, observe(), failure)
        localReach.reach(`entered`)
        enterRelease.resolve()
        if (outcome !== `reject-before-write`) {
          await atCheckpoint(serverWritten.promise, `Electric server write`)
          checkMutationConfirmation(
            history,
            `server-written`,
            observe(),
            failure,
          )
          localReach.reach(`server-written`)
          confirmationRelease.resolve()
          if (confirmation === `txid`) {
            await atCheckpoint(
              confirmationRequested.promise,
              `Electric acknowledgement registration`,
            )
            await Promise.resolve()
            checkMutationConfirmation(
              history,
              `confirmation-requested`,
              observe(),
              failure,
            )
            localReach.reach(`confirmation-requested`)
            subscriber([message, upToDate])
          }
          await atCheckpoint(
            confirmationAccepted.promise,
            `Electric confirmation acceptance`,
          )
          if (confirmation !== `none`) {
            checkMutationConfirmation(
              history,
              `confirmation-accepted`,
              observe(),
              failure,
            )
            localReach.reach(`confirmation-accepted`)
          }
          settleRelease.resolve()
        }
        const atWaiter = await atCheckpoint(
          verdict,
          `Electric handler settlement`,
        )
        checkMutationConfirmation(history, `settled`, atWaiter, failure)
        localReach.reach(`settlement-waiter`)
        checkMutationConfirmation(history, `settled`, observe(), failure)
        localReach.reach(`settled`)
        if (confirmation === `none` && outcome !== `reject-before-write`) {
          const ack = collection.utils.awaitTxId(55)
          subscriber([message, upToDate])
          await atCheckpoint(ack, `later Electric stream confirmation`)
          checkMutationConfirmation(
            history,
            `late-confirmed`,
            observe(),
            failure,
          )
          localReach.reach(`late-confirmed`)
          checkMutationConfirmation(history, `settled`, atWaiter, failure)
        }
        localReach.assertReached()
        mutationReach.reach(
          `${operation}/${outcome}/${confirmation}/${returned}/peer:${history.peer}`,
        )
      }, [
        () => {
          enterRelease.resolve()
          confirmationRelease.resolve()
          settleRelease.resolve()
          if (confirmationStatus === `pending`) {
            const message = change(operation, 1, `confirmed`)
            if (operation !== `delete`)
              message.value = { ...mutationConfirmationInputs.confirmed }
            message.headers.txids = [55]
            subscriber([message, upToDate])
          }
        },
        () => verdict && atCheckpoint(verdict, `Electric cleanup settlement`),
        () => releaseCollection?.(),
      ])
    },
  )
})

function isSdkResetFramedPartition(
  batches: Array<Array<Message<OracleRow>>>,
): boolean {
  // Model the installed SDK's HTTP 409 reset path: it publishes a synthetic
  // singleton reset, not the response body. See electric-sdk-framing.test.ts.
  // Arbitrary data/reset coalescing is outside this verified protocol domain;
  // this is not a claim that the SDK validates every other server response.
  return batches.every(
    (batch) =>
      batch.length <= 1 ||
      batch.every(
        (message) =>
          (message.headers as Record<string, unknown>).control !==
          `must-refetch`,
      ),
  )
}

type SourceLedgerEvent = {
  type: `source-commit`
  offset: string
  mutations: Array<
    { type: `set`; row: OracleRow } | { type: `delete`; key: string | number }
  >
}

// A persisted resume offset is a claim about an append-only source prefix, not
// about whichever adapter calls happened to succeed. This fold shares neither
// Electric's callback state nor the persistence runtime's queue. The fixture
// runs the real Electric collection adapter with the installed SDK boundary
// mocked at ShapeStream; it does not earn a live Electric service receipt.
function foldSourceLedgerThrough(
  events: ReadonlyArray<SourceLedgerEvent>,
  resumeOffset: string,
): Map<string | number, OracleRow> {
  const rows = new Map<string | number, OracleRow>()
  for (const event of events) {
    for (const mutation of event.mutations) {
      if (mutation.type === `delete`) rows.delete(mutation.key)
      else rows.set(mutation.row.id, structuredClone(mutation.row))
    }
    if (event.offset === resumeOffset) return rows
  }
  throw new Error(`resume offset ${resumeOffset} is absent from source ledger`)
}

const durablePrefixProperty = `electric.durable-prefix`
const publicationBeforePersistenceProperty = `electric.publication-before-persistence`
const adapterFailurePolicyProperty = `electric.adapter-failure-policy`

function durablePrefixPropertyOptions(mode: `fixed` | `random`): {
  numRuns: number
  seed?: number
  path?: string
} {
  if (mode === `fixed`) return { numRuns: oracleRuns(10), seed: 20260921 }
  return oraclePropertyOptions(10, durablePrefixProperty)
}

function persistencePolicyPropertyOptions(
  mode: `fixed` | `random`,
  property: string,
): {
  numRuns: number
  seed?: number
  path?: string
} {
  if (mode === `fixed`) return { numRuns: oracleRuns(8), seed: 20260923 }
  return oraclePropertyOptions(8, property)
}

async function runRejectedDurablePrefixWitness(
  id: string,
  names: readonly [string, string],
  acceptedPrefix = false,
): Promise<void> {
  let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const rejectedAttempt = createDeferred<void>()
  const persistedMetadata = new Map<string, unknown>()
  const persistedRows = new Map<string | number, OracleRow>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  const persistenceError = new Error(`first persistence attempt rejected`)
  const durableAttempts: Array<{
    txId: string
    keys: Array<string | number>
    sourceTxids: Array<unknown>
  }> = []
  let attempt = 0
  adapter.applyCommittedTx = async (...args) => {
    const tx = args[1]
    durableAttempts.push({
      txId: tx.txId,
      keys: tx.mutations.map((mutation) => mutation.key),
      sourceTxids: (tx.rowMetadataMutations ?? []).flatMap((mutation) => {
        if (mutation.type === `delete`) return []
        const metadata = mutation.value as { txids?: Array<unknown> }
        return metadata.txids ?? []
      }),
    })
    attempt++
    if (attempt === (acceptedPrefix ? 2 : 1)) {
      rejectedAttempt.resolve()
      throw persistenceError
    }
    await applyCommittedTx(...args)
  }

  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )
  await withElectricCleanup(async () => {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })

    const firstRow: OracleRow = {
      id: 1,
      name: names[0],
      stable: `stable-1`,
    }
    const sourcePrefix: Array<SourceLedgerEvent> = [
      {
        type: `source-commit`,
        offset: `21_0`,
        mutations: [{ type: `set`, row: firstRow }],
      },
    ]
    const acceptedRows = acceptedPrefix
      ? foldSourceLedgerThrough(sourcePrefix, `21_0`)
      : new Map<string | number, OracleRow>()
    mockStream.lastOffset = `21_0`
    const firstMessage = change(`insert`, firstRow.id, firstRow.name)
    firstMessage.headers.txids = [701]
    subscriber!([firstMessage, upToDate])
    if (acceptedPrefix) {
      await vi.waitFor(() => {
        expect(rowsFromMap(persistedRows)).toEqual(rowsFromMap(acceptedRows))
        expect(
          observableResume(persistedMetadata.get(`electric:resume`)),
        ).toEqual(expect.objectContaining({ kind: `resume`, offset: `21_0` }))
      })
    } else {
      await atCheckpoint(rejectedAttempt.promise, `first durability rejection`)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const secondRow: OracleRow = {
      id: 2,
      name: names[1],
      stable: `stable-2`,
    }
    mockStream.lastOffset = `22_0`
    const secondMessage = change(`insert`, secondRow.id, secondRow.name)
    secondMessage.headers.txids = [702]
    subscriber!([secondMessage, upToDate])
    if (acceptedPrefix) {
      await atCheckpoint(rejectedAttempt.promise, `second durability rejection`)
      await vi.waitFor(() => expect(collection.status).toBe(`crashed`))
      // A later source callback may arrive after the failed durability turn.
      // It cannot become part of the accepted prefix or start another write.
      subscriber!([change(`insert`, 3, `retired`), upToDate])
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const statusAtTerminalCut = collection.status
    await atCheckpoint(collection.cleanup(), `durable-prefix terminal cleanup`)

    const durableResume = observableResume(
      persistedMetadata.get(`electric:resume`),
    )
    const durableOffset =
      durableResume &&
      typeof durableResume === `object` &&
      `offset` in durableResume
        ? durableResume.offset
        : undefined
    expect(durableAttempts).toHaveLength(acceptedPrefix ? 2 : 1)
    expect(durableAttempts[0]?.keys).toContain(1)
    expect(durableAttempts[0]?.sourceTxids).toEqual([701])
    if (acceptedPrefix) {
      expect(durableAttempts[1]?.keys).toContain(2)
      expect(durableAttempts[1]?.sourceTxids).toEqual([702])
    }
    // A rejected durability boundary is terminal: it cannot retry, admit the
    // later source commit, or publish a resume claim for an undurable prefix.
    // Clearing the accepted prefix on a later rejection is also a wrong rule.
    expect(statusAtTerminalCut).toBe(`crashed`)
    expect(durableOffset).toBe(acceptedPrefix ? `21_0` : undefined)
    expect(rowsFromMap(persistedRows)).toEqual(rowsFromMap(acceptedRows))
  }, [() => collection.cleanup()])
}

type PersistedTraceResult = TraceResult & {
  durableRows: Array<[string | number, string, string]>
  durableResume: unknown
  persistenceCommits: number
}

type ReferenceState = {
  committed: Map<number, OracleRow>
  pending: Map<number, OracleRow>
}

/**
 * A persisted Electric sync transaction publishes at its applied receipt; an
 * earlier adapter durability turn must not hide later source callbacks. This
 * is the established Collection publication-before-durability contract used by
 * the persisted wrapper, limited here to Electric insert, update, delete, and
 * truncate/reset callbacks for one queued key.
 *
 * The independent model folds those four source histories into the expected
 * public rows. The grammar permutes every history and varies distinguishable
 * queued/later payload names. The production driver uses the Electric sync
 * adapter through a persisted Collection, holds the real persistence adapter,
 * and records public rows at that held observation cut before checking durable
 * convergence. ShapeStream is mocked at the installed SDK boundary, so this
 * owner does not establish live-service framing or native-host scheduling.
 */
type QueuedPresenceHistory =
  `insert-update` | `update-update` | `delete-update` | `truncate-update`

type QueuedPresenceCampaign = {
  histories: Array<QueuedPresenceHistory>
  names: [string, string]
}

const queuedPresenceProperty = `electric.queued-presence-order`
const queuedPresenceFixedSeed = 20_260_924
const queuedPresenceRuns = 8
const queuedPresenceHistories: ReadonlyArray<QueuedPresenceHistory> = [
  `insert-update`,
  `update-update`,
  `delete-update`,
  `truncate-update`,
]
const queuedPresenceArbitraries: [
  fc.Arbitrary<Array<QueuedPresenceHistory>>,
  fc.Arbitrary<[string, string]>,
] = [
  fc.uniqueArray(fc.constantFrom(...queuedPresenceHistories), {
    minLength: queuedPresenceHistories.length,
    maxLength: queuedPresenceHistories.length,
  }),
  fc.tuple(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 })),
]
const persistenceInterleavingProperty = `electric.persistence-interleaving`

function queuedPresencePropertyOptions(mode: `fixed` | `random`): {
  numRuns: number
  seed?: number
  path?: string
} {
  if (mode === `fixed`) {
    return {
      numRuns: oracleRuns(queuedPresenceRuns),
      seed: queuedPresenceFixedSeed,
    }
  }
  return oraclePropertyOptions(queuedPresenceRuns, queuedPresenceProperty)
}

function reconstructQueuedPresenceCampaign(
  value: unknown,
): QueuedPresenceCampaign {
  if (typeof value !== `object` || value === null) {
    throw new Error(`queued-presence campaign must be an object`)
  }
  const campaign = value as { histories?: unknown; names?: unknown }
  if (
    !Array.isArray(campaign.histories) ||
    campaign.histories.length !== queuedPresenceHistories.length ||
    new Set(campaign.histories).size !== queuedPresenceHistories.length ||
    !campaign.histories.every((history) =>
      queuedPresenceHistories.includes(history),
    )
  ) {
    throw new Error(
      `queued-presence histories must contain every supported transition exactly once`,
    )
  }
  if (
    !Array.isArray(campaign.names) ||
    campaign.names.length !== 2 ||
    !campaign.names.every(
      (name) => typeof name === `string` && name.length <= 12,
    )
  ) {
    throw new Error(`queued-presence names are outside the grammar`)
  }
  return campaign as unknown as QueuedPresenceCampaign
}

function expectedQueuedPresenceRows(
  history: QueuedPresenceHistory,
  gate: OracleRow,
  laterName: string,
): Map<string | number, OracleRow> {
  const expectedRows = new Map<string | number, OracleRow>()
  if (history !== `truncate-update`) expectedRows.set(1, gate)
  if (history === `insert-update` || history === `update-update`) {
    expectedRows.set(2, {
      id: 2,
      name: laterName,
      stable: `stable-2`,
    })
  }
  return expectedRows
}

function expectQueuedPresenceAtDurabilityHold(
  actual: Array<[string | number, string, string]>,
  history: QueuedPresenceHistory,
  gate: OracleRow,
): void {
  const expectedRows = new Map<string | number, OracleRow>([[1, gate]])
  if (history !== `insert-update`) {
    expectedRows.set(2, {
      id: 2,
      name: `baseline`,
      stable: `stable-2`,
    })
  }
  expect(actual).toEqual(rowsFromMap(expectedRows))
}

async function runQueuedPresenceCampaign(
  histories: Array<QueuedPresenceHistory>,
  names: [string, string],
): Promise<void> {
  for (const history of histories) {
    await runQueuedPresenceHistory(history, names[0], names[1])
  }
}

let queuedPresenceHistoryId = 0

async function runQueuedPresenceHistory(
  history: QueuedPresenceHistory,
  queuedName: string,
  laterName: string,
): Promise<void> {
  const historyId = ++queuedPresenceHistoryId
  let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const firstPersistenceEntered = createDeferred<void>()
  const releaseFirstPersistence = createDeferred<void>()
  const persistedMetadata = new Map<string, unknown>()
  const persistedRows = new Map<string | number, OracleRow>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  let heldGate = false
  adapter.applyCommittedTx = async (...args) => {
    if (!heldGate && args[1].mutations.some((mutation) => mutation.key === 1)) {
      heldGate = true
      firstPersistenceEntered.resolve()
      await releaseFirstPersistence.promise
    }
    await applyCommittedTx(...args)
  }
  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id: `generated-queued-presence-${historyId}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )

  await withElectricCleanup(async () => {
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })
    mockStream.lastOffset = `100_0`
    subscriber!([upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
      interval: 1,
      timeout: 250,
    })

    if (history !== `insert-update`) {
      const baseline = change(`insert`, 2, `baseline`)
      baseline.value = { id: 2, name: `baseline`, stable: `stable-2` }
      mockStream.lastOffset = `101_0`
      subscriber!([baseline, upToDate])
      await vi.waitFor(
        () => expect(persistedRows.get(2)).toEqual(baseline.value),
        { interval: 1, timeout: 250 },
      )
    }

    const gate = change(`insert`, 1, `holds persistence`)
    gate.value = { id: 1, name: `holds persistence`, stable: `stable-1` }
    mockStream.lastOffset = `102_0`
    subscriber!([gate, upToDate])
    await atCheckpoint(
      firstPersistenceEntered.promise,
      `generated Electric persistence hold`,
    )

    mockStream.lastOffset = `103_0`
    if (history === `truncate-update`) {
      subscriber!([mustRefetch, upToDate])
    } else {
      const operation = history.split(`-`)[0] as `insert` | `update` | `delete`
      const queued = change(operation, 2, queuedName)
      if (operation === `insert`) {
        queued.value = { id: 2, name: queuedName, stable: `stable-2` }
      }
      subscriber!([queued, upToDate])
    }

    const laterUpdate = change(`update`, 2, laterName)
    mockStream.lastOffset = `104_0`
    subscriber!([laterUpdate, upToDate])

    const expectedRows = expectedQueuedPresenceRows(
      history,
      gate.value,
      laterName,
    )

    // Persisted replay is one FIFO. Later source callbacks remain buffered
    // until the transaction ahead of them has finished its durability turn.
    expectQueuedPresenceAtDurabilityHold(
      rowsFromCollection(collection),
      history,
      gate.value,
    )

    releaseFirstPersistence.resolve()
    await vi.waitFor(
      () =>
        expect(rowsFromMap(persistedRows)).toEqual(rowsFromMap(expectedRows)),
      { interval: 1, timeout: 250 },
    )
    await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
      interval: 1,
      timeout: 250,
    })
    expect(rowsFromCollection(collection)).toEqual(rowsFromMap(expectedRows))
  }, [() => releaseFirstPersistence.resolve(), () => collection.cleanup()])
}

/**
 * Persisted Electric histories may overlap a source commit with a subset
 * hydration, or let a later subset supersede an earlier absence. Source rows
 * must converge in public and durable state at the final checkpoint. In the
 * hydration history the caller explicitly aborts its demand after hydration
 * starts. The uncancelable local read keeps that load pending while its gate is
 * held. After the gate releases, the cached row applies before the load rejects
 * with AbortError. The independent expected rows below combine that authored
 * cache row with the source changes in order; caller abort does not undo them.
 * These histories exercise the persisted Collection wrapper and mocked
 * Electric callback boundary, not native-host scheduling.
 */
type PersistenceInterleavingKind =
  `open-transaction-hydration` | `subset-supersedes-absence`

type PersistenceInterleavingCampaign = {
  histories: Array<PersistenceInterleavingKind>
  names: [string, string]
}

type PersistenceInterleavingObservation =
  | {
      kind: `open-transaction-hydration`
      hydrationStartedBeforeCommit: boolean
      hydrationOutcomeBeforeRelease: string
      cachedRowBeforeRelease: boolean
      hydrationOutcome: string
      publicRowsAtHydrationSettlement: Array<[string | number, string, string]>
      deliveryErrors: Array<string>
      publicRows: Array<[string | number, string, string]>
      durableRows: Array<[string | number, string, string]>
      status: string
      publicError: string | undefined
    }
  | {
      kind: `subset-supersedes-absence`
      publicRows: Array<[string | number, string, string]>
      durableRows: Array<[string | number, string, string]>
      status: string
      publicError: string | undefined
    }

const persistenceInterleavingKinds: ReadonlyArray<PersistenceInterleavingKind> =
  [`open-transaction-hydration`, `subset-supersedes-absence`]

const persistenceInterleavingCampaignArbitrary: fc.Arbitrary<PersistenceInterleavingCampaign> =
  fc.record({
    histories: fc.uniqueArray(
      fc.constantFrom(...persistenceInterleavingKinds),
      {
        minLength: persistenceInterleavingKinds.length,
        maxLength: persistenceInterleavingKinds.length,
      },
    ),
    names: fc.tuple(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.string({ minLength: 1, maxLength: 12 }),
    ),
  })

function reconstructPersistenceInterleavingCampaign(
  value: unknown,
): PersistenceInterleavingCampaign {
  if (typeof value !== `object` || value === null) {
    throw new Error(`persistence-interleaving campaign must be an object`)
  }
  const campaign = value as { histories?: unknown; names?: unknown }
  if (
    !Array.isArray(campaign.histories) ||
    campaign.histories.length !== persistenceInterleavingKinds.length ||
    new Set(campaign.histories).size !== persistenceInterleavingKinds.length ||
    !campaign.histories.every((history) =>
      persistenceInterleavingKinds.includes(history),
    )
  ) {
    throw new Error(
      `persistence-interleaving histories must contain every supported schedule exactly once`,
    )
  }
  if (
    !Array.isArray(campaign.names) ||
    campaign.names.length !== 2 ||
    !campaign.names.every(
      (name) =>
        typeof name === `string` && name.length >= 1 && name.length <= 12,
    )
  ) {
    throw new Error(`persistence-interleaving names are outside the grammar`)
  }
  return campaign as PersistenceInterleavingCampaign
}

function errorName(error: unknown): string {
  return typeof error === `object` &&
    error !== null &&
    `name` in error &&
    typeof error.name === `string`
    ? error.name
    : typeof error
}

function publicErrorName(
  collection: Collection<OracleRow, string | number>,
): string | undefined {
  const error = collection._lifecycle.getSyncError()
  return error instanceof Error ? error.name : undefined
}

let persistenceInterleavingRunId = 0

async function observeOpenTransactionHydration(
  names: [string, string],
): Promise<PersistenceInterleavingObservation> {
  const runId = ++persistenceInterleavingRunId
  let subscriber!: (messages: Array<Message<OracleRow>>) => void
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const persistedRows = new Map<string | number, OracleRow>()
  const persistedMetadata = new Map<string, unknown>()
  const cachedRow: OracleRow = { id: 2, name: `cached`, stable: `stable-2` }
  persistedRows.set(cachedRow.id, cachedRow)
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const hydrationEntered = createDeferred<void>()
  const releaseHydration = createDeferred<void>()
  let hydrationStarted = false
  adapter.loadSubset = async () => {
    hydrationStarted = true
    hydrationEntered.resolve()
    await releaseHydration.promise
    return [{ key: cachedRow.id, value: cachedRow }]
  }
  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id: `generated-open-transaction-hydration-${runId}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )
  const abortHydration = new AbortController()
  let hydrationOutcome: Promise<string> | undefined
  let hydrationSettlement = `pending`
  let publicRowsAtHydrationSettlement: Array<
    [string | number, string, string]
  > = []
  const deliveryErrors: Array<string> = []

  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })
    subscriber([upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
      interval: 1,
      timeout: 250,
    })

    subscriber([change(`insert`, 1, names[0])])
    const hydration = Promise.resolve(
      collection._sync.loadSubset({
        limit: 1,
        signal: abortHydration.signal,
      }),
    )
    // Observe settlement immediately so an expected abort never becomes an
    // unhandled rejection. Record the public snapshot at that exact cut.
    hydrationOutcome = hydration.then(
      () => {
        hydrationSettlement = `fulfilled`
        publicRowsAtHydrationSettlement = rowsFromCollection(collection)
        return hydrationSettlement
      },
      (error: unknown) => {
        hydrationSettlement = errorName(error)
        publicRowsAtHydrationSettlement = rowsFromCollection(collection)
        return hydrationSettlement
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    const hydrationStartedBeforeCommit = hydrationStarted

    try {
      subscriber([change(`update`, 1, names[1])])
    } catch (error) {
      deliveryErrors.push(errorName(error))
    }

    try {
      subscriber([upToDate])
    } catch (error) {
      deliveryErrors.push(errorName(error))
    }
    await atCheckpoint(
      hydrationEntered.promise,
      `open-transaction hydration entered after commit`,
    )
    abortHydration.abort()
    // Cancellation is cooperative. A held local hydration read cannot finish
    // or install its baseline yet, so its acquisition promise stays pending.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const hydrationOutcomeBeforeRelease = hydrationSettlement
    const cachedRowBeforeRelease = collection.has(cachedRow.id)
    releaseHydration.resolve()
    const settledHydration = await hydrationOutcome

    if (deliveryErrors.length === 0) {
      await vi.waitFor(
        () =>
          expect(rowsFromMap(persistedRows)).toEqual([
            [1, names[1], `stable-1`],
            [2, `cached`, `stable-2`],
          ]),
        { interval: 1, timeout: 250 },
      )
    }

    return {
      kind: `open-transaction-hydration`,
      hydrationStartedBeforeCommit,
      hydrationOutcomeBeforeRelease,
      cachedRowBeforeRelease,
      hydrationOutcome: settledHydration,
      publicRowsAtHydrationSettlement,
      deliveryErrors,
      publicRows: rowsFromCollection(collection),
      durableRows: rowsFromMap(persistedRows),
      status: collection.status,
      publicError: publicErrorName(collection),
    }
  } finally {
    abortHydration.abort()
    releaseHydration.resolve()
    await Promise.allSettled([hydrationOutcome, collection.cleanup()])
  }
}

async function observeSubsetSupersedesAbsence(
  names: [string, string],
): Promise<PersistenceInterleavingObservation> {
  const runId = ++persistenceInterleavingRunId
  let subscriber!: (messages: Array<Message<OracleRow>>) => void
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const persistedRows = new Map<string | number, OracleRow>()
  const persistedMetadata = new Map<string, unknown>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const snapshotRow = change(`insert`, 1, names[0])
  snapshotRow.value = { id: 1, name: names[0], stable: `stable-1` }
  mockStream.fetchSnapshot.mockReset().mockResolvedValue({
    metadata: {},
    data: [snapshotRow],
  })
  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id: `generated-subset-supersedes-absence-${runId}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )

  try {
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })

    subscriber([change(`delete`, 1, `older absence`)])
    await collection._sync.loadSubset({ limit: 1 })
    subscriber([change(`update`, 1, names[1]), upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
      interval: 1,
      timeout: 250,
    })

    return {
      kind: `subset-supersedes-absence`,
      publicRows: rowsFromCollection(collection),
      durableRows: rowsFromMap(persistedRows),
      status: collection.status,
      publicError: publicErrorName(collection),
    }
  } finally {
    await collection.cleanup()
    mockStream.fetchSnapshot.mockReset().mockResolvedValue({
      metadata: {},
      data: [],
    })
  }
}

function expectPersistenceInterleavingObservation(
  observation: PersistenceInterleavingObservation,
  names: [string, string],
): void {
  const rows: Array<[string | number, string, string]> = [
    [1, names[1], `stable-1`],
  ]
  if (observation.kind === `open-transaction-hydration`) {
    const rowsWithCache = [...rows, [2, `cached`, `stable-2`] as const]
    expect(observation, JSON.stringify(observation)).toEqual({
      kind: `open-transaction-hydration`,
      hydrationStartedBeforeCommit: false,
      hydrationOutcomeBeforeRelease: `pending`,
      cachedRowBeforeRelease: false,
      hydrationOutcome: `AbortError`,
      publicRowsAtHydrationSettlement: rowsWithCache,
      deliveryErrors: [],
      publicRows: rowsWithCache,
      durableRows: rowsWithCache,
      status: `ready`,
      publicError: undefined,
    })
    return
  }
  expect(observation, JSON.stringify(observation)).toEqual({
    kind: `subset-supersedes-absence`,
    publicRows: rows,
    durableRows: rows,
    status: `ready`,
    publicError: undefined,
  })
}

async function runPersistenceInterleavingCampaign(
  campaign: PersistenceInterleavingCampaign,
): Promise<void> {
  const reconstructed = reconstructPersistenceInterleavingCampaign(campaign)
  for (const history of reconstructed.histories) {
    const observation =
      history === `open-transaction-hydration`
        ? await observeOpenTransactionHydration(reconstructed.names)
        : await observeSubsetSupersedesAbsence(reconstructed.names)
    expectPersistenceInterleavingObservation(observation, reconstructed.names)
  }
}

function applyReferenceBatch(
  state: ReferenceState,
  batch: ReadonlyArray<Message<OracleRow>>,
): boolean {
  let commits = false
  for (const message of batch) {
    const headers = message.headers as Record<string, unknown>
    const control = headers.control
    if (typeof control === `string`) {
      if (control === `must-refetch`) {
        state.pending.clear()
      }
      if (control === `up-to-date` || control === `subset-end`) commits = true
      continue
    }
    if (!(`value` in message)) continue
    const value = message.value
    const id = value.id
    if (headers.operation === `delete`) {
      state.pending.delete(id)
    } else if (headers.operation === `insert`) {
      state.pending.set(id, value)
    } else {
      const current = state.pending.get(id)
      if (current) {
        state.pending.set(id, { ...current, ...value } as OracleRow)
      }
    }
  }
  if (commits) state.committed = new Map(state.pending)
  return commits
}

function expectedSnapshots(
  prefix: Array<Array<Message<OracleRow>>>,
  batches: Array<Array<Message<OracleRow>>>,
): Array<Array<[string | number, string, string]>> {
  const state: ReferenceState = {
    committed: new Map(),
    pending: new Map(),
  }
  const observed: Array<Array<[string | number, string, string]>> = []
  for (const batch of prefix) applyReferenceBatch(state, batch)
  for (const batch of batches) {
    applyReferenceBatch(state, batch)
    observed.push(rowsFromMap(state.committed))
  }
  return observed
}

function recomputeCommittedRows(
  batches: ReadonlyArray<ReadonlyArray<Message<OracleRow>>>,
  unknownUpdate: `ignore` | `promote-complete` = `ignore`,
): Array<[string | number, string, string]> {
  let commitBatchIndex = -1
  for (let index = 0; index < batches.length; index++) {
    const commits = batches[index]!.some((message) => {
      const control = (message.headers as Record<string, unknown>).control
      return control === `up-to-date` || control === `subset-end`
    })
    if (commits) commitBatchIndex = index
  }
  if (commitBatchIndex < 0) return []

  // A control message commits its entire callback, including messages that
  // happen to follow the control inside that atomic delivery.
  const committedPrefix = batches.slice(0, commitBatchIndex + 1).flat()
  let resetIndex = -1
  for (let index = 0; index < committedPrefix.length; index++) {
    if (
      (committedPrefix[index]!.headers as Record<string, unknown>).control ===
      `must-refetch`
    ) {
      resetIndex = index
    }
  }

  const rows = new Map<number, OracleRow>()
  for (const message of committedPrefix.slice(resetIndex + 1)) {
    if (!(`value` in message)) continue
    const headers = message.headers as Record<string, unknown>
    const value = message.value
    if (headers.operation === `delete`) {
      rows.delete(value.id)
    } else if (headers.operation === `insert`) {
      rows.set(value.id, value)
    } else {
      const current = rows.get(value.id)
      if (current) {
        rows.set(value.id, { ...current, ...value } as OracleRow)
      } else if (
        unknownUpdate === `promote-complete` &&
        typeof value.name === `string` &&
        typeof value.stable === `string`
      ) {
        rows.set(value.id, value)
      }
    }
  }
  return rowsFromMap(rows)
}

function recomputedSnapshots(
  prefix: Array<Array<Message<OracleRow>>>,
  batches: Array<Array<Message<OracleRow>>>,
): Array<Array<[string | number, string, string]>> {
  const history = [...prefix]
  return batches.map((batch) => {
    history.push(batch)
    return recomputeCommittedRows(history)
  })
}

async function runPersistedTrace(
  id: string,
  syncMode: ElectricSyncMode,
  batches: Array<Array<Message<OracleRow>>>,
  authoredSnapshots?: TraceResult[`snapshots`],
): Promise<PersistedTraceResult> {
  let subscriber!: (messages: Array<Message<OracleRow>>) => void
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const persistedRows = new Map<string | number, OracleRow>()
  const persistedMetadata = new Map<string, unknown>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  let persistenceCommits = 0
  adapter.applyCommittedTx = (...args) => {
    persistenceCommits++
    return applyCommittedTx(...args)
  }
  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: {
        adapter,
      },
    }),
  )
  collection.startSyncImmediate()
  const publications = observePublications(collection)
  try {
    publications.record(`before empty-cache startup`)
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })
    publications.record(`stream subscribed`)
    expectWholePublications(publications.entries, [[]])

    const snapshots: Array<Array<[string | number, string, string]>> = []
    const history: Array<Array<Message<OracleRow>>> = []
    for (const batch of batches) {
      const cut = publications.entries.length
      const before = rowsFromCollection(collection)
      publications.record(`before delivery ${history.length}`)
      history.push(structuredClone(batch))
      const expected =
        authoredSnapshots?.[history.length - 1] ??
        recomputeCommittedRows(history)
      subscriber(structuredClone(batch))
      publications.record(`after delivery ${history.length - 1}`)
      await vi.waitFor(
        () =>
          expect(
            rowsFromCollection(collection),
            `${syncMode}: ${JSON.stringify(history)}`,
          ).toEqual(expected),
        { interval: 1, timeout: 250 },
      )
      publications.record(`settled ${history.length - 1}`)
      expectWholePublications(publications.entries.slice(cut), [
        before,
        expected,
      ])
      snapshots.push(rowsFromCollection(collection))
    }
    const durabilityCut = publications.entries.length
    await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
      interval: 1,
      timeout: 250,
    })
    const expectedRows =
      authoredSnapshots?.at(-1) ?? recomputeCommittedRows(history)
    const result = await vi.waitFor(
      () => {
        const rows = rowsFromCollection(collection)
        const durableRows = rowsFromMap(persistedRows)
        expect(persistenceCommits).toBeGreaterThan(0)
        // Two lagging outputs can agree. Require the authored final state and
        // capture the checked cut here, before awaiting permits another write.
        expect(rows).toEqual(expectedRows)
        expect(durableRows).toEqual(expectedRows)
        const exported = collection.config.sync.exportSyncMeta?.() as
          { resume?: unknown } | undefined
        const resume = observableResume(exported?.resume)
        const durableResume = observableResume(
          persistedMetadata.get(`electric:resume`),
        )
        expect(durableResume).toEqual(resume)
        return {
          rows,
          snapshots,
          status: collection.status,
          resume,
          durableRows,
          durableResume,
          persistenceCommits,
        }
      },
      { interval: 1, timeout: 250 },
    )
    publications.record(`durability settled`)
    expectWholePublications(publications.entries.slice(durabilityCut), [
      snapshots.at(-1) ?? [],
    ])
    return result
  } finally {
    publications.stop()
    await collection.cleanup()
  }
}

async function runQueryTrace(
  id: string,
  batches: Array<Array<Message<OracleRow>>>,
  authoredSnapshots?: TraceResult[`snapshots`],
): Promise<TraceResult> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
  const queryKey = [id] as const
  let queryRows: Array<OracleRow> = []
  const collection = createCollection(
    queryCollectionOptions<OracleRow>({
      id,
      queryClient,
      queryKey,
      queryFn: () => Promise.resolve(queryRows),
      getKey: (row) => row.id,
      startSync: true,
    }),
  )
  const publications = observePublications(collection)
  try {
    publications.record(`before empty Query preload`)
    await collection.preload()
    publications.record(`empty Query ready`)
    expectWholePublications(publications.entries, [[]])

    const snapshots: TraceResult[`snapshots`] = []
    const history: Array<Array<Message<OracleRow>>> = []
    for (const batch of batches) {
      const cut = publications.entries.length
      const before = rowsFromCollection(collection)
      publications.record(`before query snapshot ${history.length}`)
      history.push(batch)
      const commits = batch.some((message) => {
        const control = (message.headers as Record<string, unknown>).control
        return control === `up-to-date` || control === `subset-end`
      })
      if (commits) {
        // Without explicit authored snapshots this is a model-fed Query
        // projection control, not an independent Electric protocol authority.
        queryRows = (
          authoredSnapshots?.[history.length - 1] ??
          recomputeCommittedRows(history)
        ).map(([rowId, name, stable]) => ({
          id: Number(rowId),
          name,
          stable,
        }))
        queryClient.setQueryData(queryKey, queryRows)
        publications.record(`after query delivery ${history.length - 1}`)
        await vi.waitFor(
          () => {
            expect(rowsFromCollection(collection)).toEqual(
              queryRows.map((row): [number, string, string] => [
                row.id,
                row.name,
                row.stable,
              ]),
            )
          },
          { interval: 1, timeout: 250 },
        )
      }
      publications.record(`settled query snapshot ${history.length - 1}`)
      expectWholePublications(publications.entries.slice(cut), [
        before,
        queryRows.map((row) => [row.id, row.name, row.stable]),
      ])
      snapshots.push(rowsFromCollection(collection))
    }

    const result: TraceResult = {
      rows: rowsFromCollection(collection),
      snapshots,
      status: collection.status,
      resume: undefined,
    }
    return result
  } finally {
    publications.stop()
    await collection.cleanup()
    queryClient.clear()
  }
}

async function checkInitialMoveOut(
  syncMode: ElectricSyncMode,
  removals: number,
  id: number,
  updated: string,
) {
  const inserted = change(`insert`, id, `snapshot`)
  const initial: Array<Message<OracleRow>> = [
    { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
    ...Array.from(
      { length: removals },
      () =>
        ({
          headers: {
            event: `move-out`,
            patterns: [{ pos: 0, value: `left` }],
          },
        }) as Message<OracleRow>,
    ),
    upToDate,
  ]
  const expected = expectedInitialMoveOutSnapshots(removals, id, updated)
  for (const partition of everyContiguousPartition(initial)) {
    const result = await runTrace(
      `initial-move-out-${syncMode}`,
      syncMode,
      partition,
      [
        [change(`insert`, id + 1, `live`), upToDate],
        [change(`update`, id + 1, updated), upToDate],
      ],
    )
    expect(result.snapshots).toEqual(expected)
    expect(result.status).toBe(`ready`)
  }
}

// The contract is a tagged relation: removing its only tag removes the row.
// Completing that snapshot must not affect later, unrelated live updates. The
// model predicts the public rows after the initial snapshot and after each
// live update, for any number of move-outs of that snapshot.
function expectedInitialMoveOutSnapshots(
  removals: number,
  id: number,
  updated: string,
): Array<TraceResult[`snapshots`][number]> {
  const initialRows: TraceResult[`rows`] =
    removals === 0 ? [[id, `snapshot`, `stable-${id}`]] : []
  const liveRows: TraceResult[`rows`] = [
    ...initialRows,
    [id + 1, `live`, `stable-${id + 1}`],
  ]
  const updatedRows: TraceResult[`rows`] = [
    ...initialRows,
    [id + 1, updated, `stable-${id + 1}`],
  ]
  return [
    liveRows.sort(([left], [right]) =>
      String(left).localeCompare(String(right)),
    ),
    updatedRows.sort(([left], [right]) =>
      String(left).localeCompare(String(right)),
    ),
  ]
}

type PartitionScenario = {
  name: string
  prefix: Array<Array<Message<OracleRow>>>
  messages: Array<Message<OracleRow>>
  expectedRows: Array<[number, string, string]>
  resume: boolean
}

type HistoryToken = {
  operation: `insert` | `update` | `delete`
  id: number
  name: string
}

// Provider controls can initiate a sync commit; delivering them does not by
// itself establish applied settlement, publication, or persistence durability.
type DesignToken =
  | HistoryToken
  | { operation: `reset` | `deliver-up-to-date` | `subset` | `neutral` }

type ProcessSlot = `a` | `b`

type ProcessCommand =
  | { kind: `create`; slot: ProcessSlot }
  | { kind: `import`; slot: ProcessSlot; txid: number; resume: boolean }
  | { kind: `preload`; slot: ProcessSlot }
  | {
      kind: `batch`
      slot: ProcessSlot
      operation: HistoryToken[`operation`]
      id: number
      name: string
      txid: number
    }
  | { kind: `reset`; slot: ProcessSlot }
  | { kind: `snapshot`; slot: ProcessSlot; id: number; name: string }
  | { kind: `retired-callback`; slot: ProcessSlot; id: number; name: string }
  | { kind: `cleanup`; slot: ProcessSlot }
  | { kind: `restart`; slot: ProcessSlot }

type ProcessRuntime = {
  collection: Collection<OracleRow, string | number>
  subscriber?: (messages: Array<Message<OracleRow>>) => void
  retiredSubscriber?: (messages: Array<Message<OracleRow>>) => void
  reference: ReferenceState
  seenTxids: Set<number>
  resumeAvailable: boolean
  requiresCompleteResume: boolean
  resettingSnapshot: boolean
  // Electric reaches Collection readiness at its first up-to-date. Only a
  // delivered snapshot or batch carries one, so the model records it there.
  reachedReadiness: boolean
  terminalError: boolean
  // A give-up after readiness is the Collection's `error`, not status `error`.
  terminalAfterReadiness: boolean
  active: boolean
  retired: boolean
  preloads: Array<ObservedPreload>
}

async function runPublicationBeforePersistenceWitness(
  id: string,
  row: OracleRow,
  txid: number,
): Promise<void> {
  let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const persistenceEntered = createDeferred<void>()
  const persistenceCompleted = createDeferred<void>()
  const releasePersistence = createDeferred<void>()
  const persistedMetadata = new Map<string, unknown>()
  const persistedRows = new Map<string | number, OracleRow>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  adapter.applyCommittedTx = async (...args) => {
    persistenceEntered.resolve()
    await releasePersistence.promise
    await applyCommittedTx(...args)
    persistenceCompleted.resolve()
  }

  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (value) => value.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )
  const publications = observePublications(collection)

  await withElectricCleanup(async () => {
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })
    const txidEvidence = collection.utils.awaitTxId(txid, 250)
    mockStream.lastOffset = `${txid}_0`
    const message = change(`insert`, row.id, row.name)
    message.value = structuredClone(row)
    message.headers.txids = [txid]
    subscriber!([message, upToDate])

    await atCheckpoint(persistenceEntered.promise, `${id} persistence entered`)
    publications.record(`persistence-pending`)

    expect(rowsFromCollection(collection)).toEqual(
      rowsFromMap(new Map([[row.id, row]])),
    )
    expect(publications.entries).toContainEqual({
      cut: `event`,
      rows: rowsFromMap(new Map([[row.id, row]])),
    })
    expect(publications.entries).toContainEqual({
      cut: `persistence-pending`,
      rows: rowsFromMap(new Map([[row.id, row]])),
    })
    expect(rowsFromMap(persistedRows)).toEqual([])
    await expect(txidEvidence).resolves.toBe(true)

    releasePersistence.resolve()
    await atCheckpoint(
      persistenceCompleted.promise,
      `${id} persistence completed`,
    )
    expect(rowsFromMap(persistedRows)).toEqual(
      rowsFromMap(new Map([[row.id, row]])),
    )
  }, [
    () => {
      releasePersistence.resolve()
      publications.stop()
    },
    () => collection.cleanup(),
  ])
}

async function runPersistenceFailureCrashOnlyWitness(
  id: string,
  firstRow: OracleRow,
  secondRow: OracleRow,
): Promise<void> {
  let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const persistenceEntered = createDeferred<void>()
  let rejectPersistence!: (reason: unknown) => void
  const persistence = new Promise<void>((_resolve, reject) => {
    rejectPersistence = reject
  })
  const persistenceRejected = createDeferred<void>()
  const rawPersistenceError = Object.assign(
    new Error(`adapter durability rejected exactly`),
    {
      code: `SQLITE_IOERR`,
      path: `electric.adapter.applyCommittedTx`,
    },
  )
  const persistedMetadata = new Map<string, unknown>()
  const persistedRows = new Map<string | number, OracleRow>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  let persistenceAttempts = 0
  adapter.applyCommittedTx = () => {
    persistenceAttempts++
    persistenceEntered.resolve()
    return persistence.finally(() => persistenceRejected.resolve())
  }

  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (value) => value.id,
        startSync: true,
      }),
      persistence: { adapter },
    }),
  )
  const publications = observePublications(collection)

  await withElectricCleanup(async () => {
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })
    mockStream.lastOffset = `31_0`
    const firstMessage = change(`insert`, firstRow.id, firstRow.name)
    firstMessage.value = structuredClone(firstRow)
    firstMessage.headers.txids = [731]
    subscriber!([firstMessage, upToDate])
    await atCheckpoint(
      persistenceEntered.promise,
      `${id} adapter persistence entered`,
    )

    // Visibility is the earlier boundary. This exact pending cut kills an
    // implementation that rejects before publishing merely because it knows
    // persistence will fail later.
    expect({
      status: collection.status,
      publicError: collection._lifecycle.getSyncError(),
      visibleRows: rowsFromCollection(collection),
      durableRows: rowsFromMap(persistedRows),
      published: publications.entries.some(({ rows }) =>
        isDeepStrictEqual(
          rows,
          rowsFromMap(new Map([[firstRow.id, firstRow]])),
        ),
      ),
    }).toEqual({
      status: `ready`,
      publicError: undefined,
      visibleRows: rowsFromMap(new Map([[firstRow.id, firstRow]])),
      durableRows: [],
      published: true,
    })

    rejectPersistence(rawPersistenceError)
    await atCheckpoint(
      persistenceRejected.promise,
      `${id} adapter persistence rejection`,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    const statusAtAdmissionCut = collection.status
    const publicErrorAtAdmissionCut = collection._lifecycle.getSyncError()
    const publicationsBeforeRetiredWork = structuredClone(publications.entries)
    mockStream.lastOffset = `32_0`
    const secondMessage = change(`insert`, secondRow.id, secondRow.name)
    secondMessage.value = structuredClone(secondRow)
    secondMessage.headers.txids = [732]
    subscriber!([secondMessage, upToDate])
    await new Promise((resolve) => setTimeout(resolve, 0))

    const publicPersistenceError = collection._lifecycle.getSyncError()
    const durabilityError =
      publicPersistenceError instanceof Error
        ? (publicPersistenceError as Error & {
            code?: unknown
            path?: unknown
          })
        : undefined
    expect({
      statusAtAdmissionCut,
      publicErrorNameAtAdmissionCut:
        publicErrorAtAdmissionCut instanceof Error
          ? publicErrorAtAdmissionCut.name
          : undefined,
      status: collection.status,
      publicErrorName:
        publicPersistenceError instanceof Error
          ? publicPersistenceError.name
          : undefined,
      hasNamedPersistenceSemantics:
        publicPersistenceError instanceof PersistedCollectionDurabilityError,
      preservesCause: durabilityError?.cause === rawPersistenceError,
      persistenceErrorCode: durabilityError?.code,
      persistenceErrorPath: durabilityError?.path,
      persistenceAttempts,
      visibleRows: rowsFromCollection(collection),
      durableRows: rowsFromMap(persistedRows),
      publicationsUnchanged: isDeepStrictEqual(
        publications.entries,
        publicationsBeforeRetiredWork,
      ),
    }).toEqual({
      statusAtAdmissionCut: `crashed`,
      publicErrorNameAtAdmissionCut: `PersistedCollectionDurabilityError`,
      status: `crashed`,
      publicErrorName: `PersistedCollectionDurabilityError`,
      hasNamedPersistenceSemantics: true,
      preservesCause: true,
      persistenceErrorCode: `SQLITE_IOERR`,
      persistenceErrorPath: `electric.adapter.applyCommittedTx`,
      persistenceAttempts: 1,
      visibleRows: rowsFromMap(new Map([[firstRow.id, firstRow]])),
      durableRows: [],
      publicationsUnchanged: true,
    })
  }, [
    () => {
      rejectPersistence(rawPersistenceError)
      publications.stop()
    },
    () => collection.cleanup(),
  ])
}

const processCommandArb: fc.Arbitrary<ProcessCommand> = fc.oneof(
  fc.record({
    kind: fc.constant(`create` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`import` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    txid: fc.integer({ min: 1, max: 50 }),
    resume: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant(`preload` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`batch` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    operation: fc.constantFrom<HistoryToken[`operation`]>(
      `insert`,
      `update`,
      `delete`,
    ),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
    txid: fc.integer({ min: 51, max: 100 }),
  }),
  fc.record({
    kind: fc.constant(`reset` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`snapshot` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant(`retired-callback` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant(`cleanup` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`restart` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
)

const designTokenArb: fc.Arbitrary<DesignToken> = fc.oneof(
  fc.record({
    operation: fc.constantFrom<HistoryToken[`operation`]>(
      `insert`,
      `update`,
      `delete`,
    ),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    operation: fc.constantFrom<
      `reset` | `deliver-up-to-date` | `subset` | `neutral`
    >(`reset`, `deliver-up-to-date`, `subset`, `neutral`),
  }),
)

// Releasing persistence application opens the adapter's held applyCommittedTx
// call. It is separate from provider delivery and the sync applied receipt.
type SchedulerEvent =
  | `startup-promise`
  | `hydration`
  | `snapshot-available`
  | `release-persistence-apply`
  | `cleanup`

function permutations<T>(values: ReadonlyArray<T>): Array<Array<T>> {
  if (values.length <= 1) return [[...values]]
  const result: Array<Array<T>> = []
  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)]
    for (const suffix of permutations(rest)) result.push([value, ...suffix])
  })
  return result
}

async function drainScheduler(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve()
}

function buildValidHistory(tokens: Array<HistoryToken>): {
  messages: Array<Message<OracleRow>>
  expectedRows: Array<[number, string, string]>
} {
  const state = new Map<number, { name: string; stable: string }>()
  const messages: Array<Message<OracleRow>> = []

  for (const token of tokens) {
    if (token.operation === `delete`) {
      if (!state.has(token.id)) continue
      messages.push(change(`delete`, token.id, token.name))
      state.delete(token.id)
      continue
    }

    const operation =
      token.operation === `update` && !state.has(token.id)
        ? `insert`
        : token.operation
    messages.push(change(operation, token.id, token.name))
    state.set(token.id, {
      name: token.name,
      stable: `stable-${token.id}`,
    })
  }

  return {
    messages: [...messages, upToDate],
    expectedRows: Array.from(state, ([id, row]): [number, string, string] => [
      id,
      row.name,
      row.stable,
    ]).sort(([left], [right]) => left - right),
  }
}

function designMessage(token: DesignToken): Message<OracleRow> {
  if (token.operation === `reset`) return mustRefetch
  if (token.operation === `deliver-up-to-date`) return upToDate
  if (token.operation === `subset`) return subsetEnd
  if (token.operation === `neutral`) {
    return {
      headers: {
        control: `snapshot-end`,
        xmin: `100`,
        xmax: `150`,
        xip_list: [],
      },
    }
  }
  if (!(`id` in token)) throw new Error(`Unknown design token`)
  return change(token.operation, token.id, token.name)
}

function buildDifferentialHistory(
  tokens: Array<DesignToken>,
): Array<Message<OracleRow>> {
  const known = new Set<number>([99])
  const messages: Array<Message<OracleRow>> = [
    change(`insert`, 99, `baseline`),
    upToDate,
  ]

  for (const token of tokens) {
    if (token.operation === `reset`) {
      known.clear()
      messages.push(mustRefetch)
      continue
    }
    if (
      token.operation === `deliver-up-to-date` ||
      token.operation === `subset` ||
      token.operation === `neutral`
    ) {
      messages.push(designMessage(token))
      continue
    }
    if (!(`id` in token)) throw new Error(`Unknown differential token`)
    if (token.operation === `delete`) {
      if (!known.delete(token.id)) continue
      messages.push(change(`delete`, token.id, token.name))
      continue
    }
    const operation =
      token.operation === `update` && !known.has(token.id)
        ? `insert`
        : token.operation
    known.add(token.id)
    messages.push(change(operation, token.id, token.name))
  }

  messages.push(subsetEnd)
  return messages
}

async function runProcessGrammar(
  idPrefix: string,
  generated: Array<ProcessCommand>,
) {
  const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
  const runtimes = new Map<ProcessSlot, ProcessRuntime>()
  const allPreloads: Array<ObservedPreload> = []
  const reached: Array<{ command: ProcessCommand; result: string }> = []
  const callbackVisits = new Map<
    NonNullable<ProcessRuntime[`subscriber`]>,
    number
  >()
  const expectPendingRejection = (
    runtime: ProcessRuntime,
    reason: NonNullable<ObservedPreload[`expectedRejection`]>,
  ) => {
    for (const preload of runtime.preloads) {
      if (!preload.settled) preload.expectedRejection = reason
    }
  }
  let runtimeInstanceSequence = 0
  mockSubscribe.mockReset()
  mockSubscribe.mockImplementation((callback) => {
    const observed: NonNullable<ProcessRuntime[`subscriber`]> = (messages) => {
      callbackVisits.set(observed, callbackVisits.get(observed)! + 1)
      callback(messages)
    }
    callbackVisits.set(observed, 0)
    subscribers.push(observed)
    return vi.fn()
  })

  const createRuntime = async (slot: ProcessSlot) => {
    const previous = runtimes.get(slot)
    if (previous) {
      expectPendingRejection(previous, `cleanup`)
      await previous.collection.cleanup()
    }
    runtimeInstanceSequence++
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `${idPrefix}-${slot}-${runtimeInstanceSequence}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: false,
      }),
    )
    runtimes.set(slot, {
      collection,
      reference: { committed: new Map(), pending: new Map() },
      seenTxids: new Set(),
      resumeAvailable: false,
      requiresCompleteResume: false,
      resettingSnapshot: false,
      reachedReadiness: false,
      terminalError: false,
      terminalAfterReadiness: false,
      active: false,
      retired: false,
      preloads: [],
    })
  }

  const startRuntime = (runtime: ProcessRuntime, preload: boolean) => {
    if (runtime.active) return
    const subscriberIndex = subscribers.length
    if (preload) {
      const observed = observePreload(runtime.collection.preload())
      runtime.preloads.push(observed)
      allPreloads.push(observed)
    } else {
      runtime.collection.startSyncImmediate()
    }
    const subscriber = subscribers[subscriberIndex]
    if (!subscriber) throw new Error(`Electric stream did not subscribe`)
    runtime.subscriber = subscriber
    runtime.requiresCompleteResume = runtime.resumeAvailable
    runtime.resettingSnapshot = false
    runtime.reachedReadiness = false
    runtime.terminalError = false
    runtime.terminalAfterReadiness = false
    runtime.active = true
    runtime.retired = false
  }

  const assertAllSlots = () => {
    runtimes.forEach((runtime) => {
      const expected = runtime.active
        ? rowsFromMap(runtime.reference.committed)
        : []
      expect(rowsFromCollection(runtime.collection)).toEqual(expected)
      if (runtime.terminalError) {
        if (runtime.terminalAfterReadiness) {
          expectGaveUpAfterReadiness(runtime.collection)
        } else {
          expect(runtime.collection.status).toBe(`error`)
        }
      }
      if (!runtime.active && runtime.retired) {
        expect(runtime.collection.status).toBe(`cleaned-up`)
      }
    })
  }

  const execute = async (command: ProcessCommand) => {
    if (command.kind === `create`) {
      await createRuntime(command.slot)
      return `created`
    }
    const runtime = runtimes.get(command.slot)
    if (!runtime) return `skipped: no collection`

    if (command.kind === `import`) {
      if (runtime.active) return `skipped: already active`
      runtime.collection.config.sync.importSyncMeta?.({
        version: 1,
        seenTxids: [command.txid],
        ...(command.resume
          ? {
              resume: {
                kind: `resume`,
                requiresTagState: false,
                offset: `10_0`,
                handle: `shape-1`,
                shapeId,
                updatedAt: command.txid,
              },
            }
          : {}),
      })
      await expect(
        runtime.collection.utils.awaitTxId(command.txid, 20),
      ).resolves.toBe(true)
      runtime.resumeAvailable ||= command.resume
      runtime.seenTxids.add(command.txid)
      for (const [otherSlot, other] of runtimes) {
        if (otherSlot === command.slot || other.seenTxids.has(command.txid)) {
          continue
        }
        await expect(
          other.collection.utils.awaitTxId(command.txid, 2),
        ).rejects.toThrow()
      }
      return `imported`
    }

    if (command.kind === `preload`) {
      if (runtime.active) return `skipped: already active`
      startRuntime(runtime, true)
      return `preloaded`
    }
    if (command.kind === `restart`) {
      if (runtime.active) return `skipped: already active`
      startRuntime(runtime, false)
      return `restarted`
    }
    if (command.kind === `cleanup`) {
      expectPendingRejection(runtime, `cleanup`)
      runtime.retiredSubscriber =
        runtime.subscriber ?? runtime.retiredSubscriber
      await runtime.collection.cleanup()
      runtime.active = false
      runtime.retired = true
      runtime.subscriber = undefined
      runtime.reference = {
        committed: new Map(),
        pending: new Map(),
      }
      runtime.resumeAvailable = false
      runtime.requiresCompleteResume = false
      runtime.resettingSnapshot = false
      runtime.reachedReadiness = false
      runtime.terminalError = false
      runtime.terminalAfterReadiness = false
      return `cleaned up`
    }
    if (command.kind === `retired-callback`) {
      if (!runtime.retiredSubscriber) return `skipped: no retired callback`
      const observeOwners = () =>
        Array.from(runtimes, ([slot, owner]) => ({
          slot,
          rows: rowsFromCollection(owner.collection),
          status: owner.collection.status,
          metadata: structuredClone(
            owner.collection.config.sync.exportSyncMeta?.(),
          ),
        }))
      const before = observeOwners()
      const beforeVisits = callbackVisits.get(runtime.retiredSubscriber)!
      runtime.retiredSubscriber([
        change(`insert`, command.id, command.name),
        { headers: { control: `up-to-date`, txids: [1001] } },
      ])
      expect(callbackVisits.get(runtime.retiredSubscriber)).toBe(
        beforeVisits + 1,
      )
      expect(observeOwners()).toEqual(before)
      return `delivered: retired callback`
    }
    if (!runtime.active || !runtime.subscriber) return `skipped: inactive`
    if (runtime.terminalError) return `skipped: terminal error`

    if (command.kind === `reset`) {
      runtime.subscriber([mustRefetch])
      applyReferenceBatch(runtime.reference, [mustRefetch])
      runtime.resettingSnapshot = true
      return `delivered: reset`
    }

    if (command.kind === `snapshot`) {
      const messages = [change(`insert`, command.id, command.name), upToDate]
      runtime.subscriber(messages)
      applyReferenceBatch(runtime.reference, messages)
      runtime.resettingSnapshot = false
      runtime.resumeAvailable = true
      runtime.reachedReadiness = true
      return `delivered: snapshot`
    }

    const evidenceChange = change(command.operation, command.id, command.name)
    const messages: Array<Message<OracleRow>> = [
      {
        ...evidenceChange,
        headers: {
          operation: command.operation,
          txids: [command.txid],
        },
      },
      upToDate,
    ]
    const observesTxid =
      command.operation !== `update` ||
      runtime.reference.pending.has(command.id)
    const invalidResume =
      runtime.requiresCompleteResume &&
      !runtime.resettingSnapshot &&
      command.operation === `update` &&
      !runtime.reference.pending.has(command.id)
    const txidOutcome = observesTxid
      ? runtime.collection.utils.awaitTxId(command.txid, 100)
      : undefined
    if (invalidResume) expectPendingRejection(runtime, `invalid-resume`)
    runtime.subscriber(messages)
    if (invalidResume) {
      runtime.terminalError = true
      runtime.terminalAfterReadiness = runtime.reachedReadiness
      runtime.resumeAvailable = false
      runtime.retiredSubscriber = runtime.subscriber
      return `delivered: invalid resume`
    }
    applyReferenceBatch(runtime.reference, messages)
    runtime.resettingSnapshot = false
    runtime.resumeAvailable = true
    runtime.reachedReadiness = true
    if (txidOutcome) {
      await expect(txidOutcome).resolves.toBe(true)
      runtime.seenTxids.add(command.txid)
    }
    return `delivered: batch`
  }

  const requiredPrefix: Array<ProcessCommand> = [
    { kind: `create`, slot: `a` },
    { kind: `create`, slot: `b` },
    { kind: `import`, slot: `a`, txid: 1, resume: true },
    { kind: `import`, slot: `b`, txid: 2, resume: false },
    { kind: `preload`, slot: `a` },
    { kind: `preload`, slot: `b` },
    {
      kind: `batch`,
      slot: `a`,
      operation: `insert`,
      id: 1,
      name: `a-initial`,
      txid: 51,
    },
    {
      kind: `batch`,
      slot: `b`,
      operation: `insert`,
      id: 1,
      name: `b-initial`,
      txid: 52,
    },
    { kind: `reset`, slot: `a` },
    { kind: `snapshot`, slot: `a`, id: 2, name: `a-snapshot` },
  ]
  const requiredSuffix: Array<ProcessCommand> = [
    { kind: `cleanup`, slot: `a` },
    { kind: `restart`, slot: `a` },
    { kind: `retired-callback`, slot: `a`, id: 3, name: `retired-a` },
    {
      kind: `batch`,
      slot: `a`,
      operation: `insert`,
      id: 3,
      name: `a-restarted`,
      txid: 53,
    },
    { kind: `cleanup`, slot: `b` },
    { kind: `restart`, slot: `b` },
    { kind: `retired-callback`, slot: `b`, id: 3, name: `retired-b` },
    {
      kind: `batch`,
      slot: `b`,
      operation: `insert`,
      id: 3,
      name: `b-restarted`,
      txid: 54,
    },
  ]

  try {
    for (const command of [
      ...requiredPrefix,
      ...generated,
      ...requiredSuffix,
    ]) {
      const entry = { command, result: `entered` }
      reached.push(entry)
      entry.result = await execute(command)
      assertAllSlots()
    }
  } catch (error) {
    throw new Error(`Process grammar ${idPrefix}: ${JSON.stringify(reached)}`, {
      cause: error,
    })
  } finally {
    for (const runtime of runtimes.values())
      expectPendingRejection(runtime, `cleanup`)
    await Promise.all(
      Array.from(runtimes.values(), ({ collection }) => collection.cleanup()),
    )
    await Promise.all(allPreloads.map(({ outcome }) => outcome))
    mockSubscribe.mockReset()
  }
  const preloads = await Promise.all(
    allPreloads.map(async (observed) => {
      const outcome = await observed.outcome
      expectPreloadOutcome(observed, outcome)
      return outcome
    }),
  )
  return { reached, preloads }
}

async function runSchedulerPermutation(
  id: string,
  order: Array<SchedulerEvent>,
): Promise<{
  outcome: `resolved` | `aborted`
  acknowledgedBeforeDurable: boolean
}> {
  const startup = createDeferred<void>()
  const hydration = createDeferred<void>()
  const persistenceApplyGate = createDeferred<void>()
  const persistedMetadata = new Map(resumeState())
  const persistedRows = new Map<string | number, OracleRow>([
    [1, { id: 1, name: `persisted`, stable: `stable-1` }],
  ])
  const adapter = createPersistedAdapter(
    persistedMetadata,
    persistedRows,
    hydration.promise,
  )
  const loadMetadata = adapter.loadCollectionMetadata!.bind(adapter)
  adapter.loadCollectionMetadata = async (...args) => {
    await startup.promise
    return loadMetadata(...args)
  }
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  adapter.applyCommittedTx = async (...args) => {
    await persistenceApplyGate.promise
    return applyCommittedTx(...args)
  }

  let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
  let snapshotRequested = false
  let snapshotDelivered = false
  const deliveryPhases = new Set<`before-cleanup` | `after-cleanup`>()
  let cleanupCompleted = false
  let acknowledgedBeforeDurable = false
  const schedulerStream = {
    ...mockStream,
    subscribe: (callback: (messages: Array<Message<OracleRow>>) => void) => {
      subscriber = callback
      return vi.fn()
    },
  }
  vi.mocked(ShapeStream).mockReset()
  vi.mocked(ShapeStream).mockImplementation(function () {
    return schedulerStream as never
  })

  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (row) => row.id,
        startSync: false,
      }),
      persistence: { adapter },
    }),
  )
  let matchSettlement: `resolved` | `aborted` | `timed-out` | undefined
  let txidSettlement: `resolved` | `aborted` | `timed-out` | undefined
  const matchOutcome = collection.utils
    .awaitMatch((message) => `value` in message && message.value.id === 1, 250)
    .then(
      () => `resolved` as const,
      (error: unknown) =>
        /aborted/i.test(String(error))
          ? (`aborted` as const)
          : (`timed-out` as const),
    )
    .then((outcome) => (matchSettlement = outcome))
  const txidOutcome = collection.utils
    .awaitTxId(91, 250)
    .then(
      () => `resolved` as const,
      (error: unknown) =>
        /aborted/i.test(String(error))
          ? (`aborted` as const)
          : (`timed-out` as const),
    )
    .then((outcome) => (txidSettlement = outcome))
  collection.startSyncImmediate()

  const deliverSnapshotIfPossible = () => {
    if (!snapshotRequested || snapshotDelivered || !subscriber) return
    snapshotDelivered = true
    deliveryPhases.add(cleanupCompleted ? `after-cleanup` : `before-cleanup`)
    const update = change(`update`, 1, `scheduled`)
    subscriber([
      { ...update, headers: { operation: `update`, txids: [91] } },
      upToDate,
    ])
  }

  const assertSchedulerCheckpoint = () => {
    expect(matchSettlement === undefined).toBe(txidSettlement === undefined)
    if (matchSettlement === `resolved`) {
      expect(txidSettlement).toBe(`resolved`)
      expect(snapshotDelivered).toBe(true)
      acknowledgedBeforeDurable ||= persistedRows.get(1)?.name === `persisted`
    }
    if (matchSettlement === `aborted`) {
      expect(txidSettlement).toBe(`aborted`)
      expect(collection.status).toBe(`cleaned-up`)
    }
    expect(matchSettlement).not.toBe(`timed-out`)
    expect(txidSettlement).not.toBe(`timed-out`)
  }

  try {
    for (const event of order) {
      if (event === `startup-promise`) startup.resolve()
      if (event === `hydration`) hydration.resolve()
      if (event === `snapshot-available`) snapshotRequested = true
      if (event === `release-persistence-apply`) persistenceApplyGate.resolve()
      if (event === `cleanup`) {
        await collection.cleanup()
        cleanupCompleted = true
      }
      await drainScheduler()
      deliverSnapshotIfPossible()
      await drainScheduler()
      assertSchedulerCheckpoint()
    }

    startup.resolve()
    hydration.resolve()
    persistenceApplyGate.resolve()
    snapshotRequested = true
    await drainScheduler()
    deliverSnapshotIfPossible()
    await drainScheduler()
    assertSchedulerCheckpoint()

    const [match, txid] = await Promise.all([matchOutcome, txidOutcome])
    if (match === `timed-out` || txid === `timed-out`) {
      throw new Error(`scheduler waiter timed out`)
    }
    expect(match).toBe(txid)
    expect(collection.status).toBe(`cleaned-up`)
    expect(rowsFromCollection(collection)).toEqual([])
    if (deliveryPhases.has(`after-cleanup`)) {
      expect(persistedRows.get(1)?.name).toBe(`persisted`)
    }

    if (order[0] === `cleanup`) {
      expect(match).toBe(`aborted`)
      expect(subscriber).toBeUndefined()
      expect(persistedRows.get(1)?.name).toBe(`persisted`)
    }
    if (match === `resolved`) {
      expect(persistedRows.get(1)).toEqual({
        id: 1,
        name: `scheduled`,
        stable: `stable-1`,
      })
    }
    return { outcome: match, acknowledgedBeforeDurable }
  } finally {
    await collection.cleanup()
    vi.mocked(ShapeStream).mockReset()
    vi.mocked(ShapeStream).mockImplementation(function () {
      return createMockStream(mockStream) as never
    })
  }
}

const assertPublicationEpochHistory = async (
  tokens: Array<DesignToken>,
  partitionSeed: number,
) => {
  const messages = buildDifferentialHistory(tokens)
  const partitions = everyContiguousPartition(messages).filter(
    isSdkResetFramedPartition,
  )
  const partition = partitions[partitionSeed % partitions.length]!
  const referenceSnapshots = recomputedSnapshots([], partition)

  for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
    const direct = await runTrace(
      `direct-differential-${syncMode}`,
      syncMode,
      [],
      partition,
    )
    const persisted = await runPersistedTrace(
      `persisted-differential-${syncMode}`,
      syncMode,
      partition,
    )
    const query = await runQueryTrace(
      `query-differential-${syncMode}`,
      partition,
    )

    expect(direct.snapshots).toEqual(referenceSnapshots)
    expect(persisted.snapshots).toEqual(referenceSnapshots)
    expect(query.snapshots).toEqual(referenceSnapshots)
    expect(persisted.rows).toEqual(direct.rows)
    expect(query.rows).toEqual(direct.rows)
    expect(persisted.status).toBe(direct.status)
    expect(query.status).toBe(`ready`)
    expect(persisted.resume).toEqual(direct.resume)
    expect(persisted.durableRows).toEqual(direct.rows)
    expect(persisted.durableResume).toEqual(direct.resume)
    expect(persisted.persistenceCommits).toBeGreaterThan(0)
  }
}

// Each registration below says which path replays stand it aside. A path
// replay runs only the selected property, and the sibling suites register it.
/**
 * # Does the Electric adapter preserve one coherent replica lifecycle?
 *
 * Electric delivers change messages, reset controls, offsets, handles, and
 * snapshot availability through an SDK stream. The adapter must publish atomic
 * callback cuts, wait for acceptance before Collection readiness and for
 * application before subset success, persist valid resume evidence for a valid source prefix, reject unseen partial updates,
 * and keep stale callbacks and metadata scoped to the sync run that created
 * them.
 *
 * Independent Maps model rows, selected-tag membership, source commits, resume
 * evidence, and persisted state. A controlled ShapeStream boundary supplies
 * authored message partitions and settlement order. The production Collection,
 * Query-backed persistence wrapper, metadata APIs, and cleanup run unchanged.
 * Checks cover public and durable rows, exact batches, readiness, errors,
 * metadata, waiters, stream ownership, and restart at named checkpoints.
 *
 * The suite retains fixed protocol histories, exhaustive contiguous
 * partitions, fixed campaigns, random campaigns, and explicit seed/path replay
 * for durability policies. Sensitivity checks reject missing prefix evidence.
 * Installed-SDK HTTP delivery, PostgreSQL semantics, and live-service execution
 * remain separate evidence.
 */

describe(`Electric adapter laws`, () => {
  let processGrammarRun = 0
  let persistencePolicyRun = 0

  beforeEach(() => {
    resetElectricOracleMocks()
  })

  oracleReplayTest(it).each(
    ([`eager`, `on-demand`, `progressive`] as const).flatMap((syncMode) =>
      [0, 1, 2].map((removals) => ({ syncMode, removals })),
    ),
  )(
    `preserves live updates after $removals initial tagged move-outs in $syncMode mode`,
    ({ syncMode, removals }) =>
      checkInitialMoveOut(syncMode, removals, 1, `updated`),
  )

  electricHistoryProperty(
    `electric.initial-tagged-move-outs`,
    `generated initial tagged move-outs preserve later live updates`,
    fc.tuple(
      fc.integer({ min: 1, max: 20 }),
      fc.string({ maxLength: 8 }),
      fc.integer({ min: 0, max: 2 }),
    ),
    20,
    42_715,
    async ([id, updated, removals]) => {
      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        await checkInitialMoveOut(syncMode, removals, id, updated)
      }
    },
  )

  electricHistoryProperty(
    `electric.process-grammar`,
    `generated process grammar preserves lifecycle and concurrent-collection isolation`,
    fc.array(processCommandArb, { maxLength: 20 }),
    20,
    42_716,
    async (commands) => {
      processGrammarRun++
      await runProcessGrammar(`process-grammar-${processGrammarRun}`, commands)
    },
  )

  oracleReplayTest(it)(
    `delivers retired callbacks without advancing a failed lifecycle`,
    async () => {
      const result = await runProcessGrammar(`process-grammar-terminal-error`, [
        {
          kind: `batch`,
          slot: `a`,
          operation: `update`,
          id: 1,
          name: `unseen`,
          txid: 55,
        },
        { kind: `snapshot`, slot: `a`, id: 1, name: `stale callback` },
        {
          kind: `retired-callback`,
          slot: `a`,
          id: 1,
          name: `actually delivered`,
        },
      ])
      expect(
        result.reached
          .filter(({ command }) => command.kind === `retired-callback`)
          .map(({ result: reached }) => reached),
      ).toEqual([
        `delivered: retired callback`,
        `delivered: retired callback`,
        `delivered: retired callback`,
      ])
      expect(
        result.reached.find(
          ({ command }) =>
            command.kind === `snapshot` && command.name === `stale callback`,
        )?.result,
      ).toBe(`skipped: terminal error`)
    },
  )

  oracleReplayTest(it).each([`invalid-resume`, `cleanup`] as const)(
    `records an initial preload's %s rejection before continuing the grammar`,
    async (failure) => {
      const result = await runProcessGrammar(`preload-${failure}`, [
        { kind: `create`, slot: `a` },
        { kind: `import`, slot: `a`, txid: 4, resume: true },
        { kind: `preload`, slot: `a` },
        ...(failure === `cleanup`
          ? [{ kind: `cleanup` as const, slot: `a` as const }]
          : [
              {
                kind: `batch` as const,
                slot: `a` as const,
                operation: `update` as const,
                id: 3,
                name: `unseen`,
                txid: 56,
              },
            ]),
        { kind: `retired-callback`, slot: `a`, id: 3, name: `after rejection` },
      ])
      expect(result.preloads.map(({ status }) => status)).toEqual([
        `fulfilled`,
        `fulfilled`,
        `rejected`,
      ])
      const rejected = result.preloads[2]!
      if (rejected.status === `rejected`) {
        expect(rejected.reason).toMatchObject(
          failure === `cleanup`
            ? { name: `AbortError` }
            : {
                message: `Electric resume state referenced an unseen row; a full snapshot is required`,
              },
        )
      }
      expect(
        result.reached.find(
          ({ command }) =>
            command.kind === `retired-callback` &&
            command.name === `after rejection`,
        )?.result,
      ).toBe(`delivered: retired callback`)
    },
  )

  oracleReplayTest(it)(
    `publishes an Electric source commit before its adapter persistence settles`,
    async () => {
      await runPublicationBeforePersistenceWitness(
        `publication-before-persistence-fixed`,
        { id: 41, name: `visible first`, stable: `stable-41` },
        741,
      )
    },
  )

  oracleReplayTest(it)(
    `reconstructs the queued-presence grammar and rejects ablated, out-of-range, and foreign campaigns`,
    () => {
      const campaigns = fc.sample(fc.tuple(...queuedPresenceArbitraries), {
        seed: queuedPresenceFixedSeed,
        numRuns: 20,
      })
      for (const [histories, names] of campaigns) {
        expect(reconstructQueuedPresenceCampaign({ histories, names })).toEqual(
          {
            histories,
            names,
          },
        )
      }

      const witness = {
        histories: [...queuedPresenceHistories],
        names: [``, `x`.repeat(12)] as [string, string],
      }
      expect(reconstructQueuedPresenceCampaign(witness)).toEqual(witness)
      expect(() =>
        reconstructQueuedPresenceCampaign({ names: witness.names }),
      ).toThrow()
      expect(() =>
        reconstructQueuedPresenceCampaign({ histories: witness.histories }),
      ).toThrow()
      expect(() =>
        reconstructQueuedPresenceCampaign({
          ...witness,
          histories: witness.histories.slice(1),
        }),
      ).toThrow()
      expect(() =>
        reconstructQueuedPresenceCampaign({
          ...witness,
          histories: [
            `insert-update`,
            `insert-update`,
            `delete-update`,
            `truncate-update`,
          ],
        }),
      ).toThrow()
      expect(() =>
        reconstructQueuedPresenceCampaign({
          ...witness,
          histories: [
            `insert-update`,
            `update-update`,
            `delete-update`,
            `replace-update`,
          ],
        }),
      ).toThrow()
      expect(() =>
        reconstructQueuedPresenceCampaign({
          ...witness,
          names: [`x`.repeat(13), ``],
        }),
      ).toThrow()
    },
  )

  oracleReplayTest(it)(
    `rejects named wrong answer: later callback publishes before durability`,
    () => {
      expect(() =>
        expectQueuedPresenceAtDurabilityHold(
          [
            [1, `holds persistence`, `stable-1`],
            [2, `later`, `stable-2`],
          ],
          `insert-update`,
          { id: 1, name: `holds persistence`, stable: `stable-1` },
        ),
      ).toThrow()
    },
  )

  oracleReplayTest(fcTest).prop(
    queuedPresenceArbitraries,
    queuedPresencePropertyOptions(`fixed`),
  )(
    `generated queued Electric histories preserve staged presence and reset fences (fixed)`,
    runQueuedPresenceCampaign,
  )

  const publicationPolicyArbitraries: [
    fc.Arbitrary<number>,
    fc.Arbitrary<string>,
  ] = [fc.integer({ min: 1, max: 20 }), fc.string({ maxLength: 12 })]
  const checkPublicationPolicy = async (id: number, name: string) => {
    persistencePolicyRun++
    await runPublicationBeforePersistenceWitness(
      `publication-before-persistence-generated-${persistencePolicyRun}`,
      { id, name, stable: `stable-${id}` },
      800 + id,
    )
  }
  oracleReplayTest(fcTest).prop(
    publicationPolicyArbitraries,
    persistencePolicyPropertyOptions(
      `fixed`,
      publicationBeforePersistenceProperty,
    ),
  )(
    `generated Electric commits publish before adapter persistence settles (fixed)`,
    checkPublicationPolicy,
  )
  oracleReplayTest(fcTest, publicationBeforePersistenceProperty).prop(
    publicationPolicyArbitraries,
    persistencePolicyPropertyOptions(
      `random`,
      publicationBeforePersistenceProperty,
    ),
  )(
    `generated Electric commits publish before adapter persistence settles (random)`,
    checkPublicationPolicy,
  )

  oracleReplayTest(it)(
    `turns adapter rejection into a named terminal Electric persistence error`,
    async () => {
      await runPersistenceFailureCrashOnlyWitness(
        `terminal-persistence-error-fixed`,
        { id: 51, name: `published before failure`, stable: `stable-51` },
        { id: 52, name: `must not be admitted`, stable: `stable-52` },
      )
    },
  )

  const failurePolicyArbitraries: [
    fc.Arbitrary<number>,
    fc.Arbitrary<[string, string]>,
  ] = [
    fc.integer({ min: 1, max: 20 }),
    fc.tuple(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 })),
  ]
  const checkFailurePolicy = async (id: number, names: [string, string]) => {
    persistencePolicyRun++
    await runPersistenceFailureCrashOnlyWitness(
      `terminal-persistence-error-generated-${persistencePolicyRun}`,
      { id, name: names[0], stable: `stable-${id}` },
      { id: id + 100, name: names[1], stable: `stable-${id + 100}` },
    )
  }
  oracleReplayTest(fcTest).prop(
    failurePolicyArbitraries,
    persistencePolicyPropertyOptions(`fixed`, adapterFailurePolicyProperty),
  )(
    `generated adapter failures reject publicly and admit no later Electric work (fixed)`,
    checkFailurePolicy,
  )
  oracleReplayTest(fcTest, adapterFailurePolicyProperty).prop(
    failurePolicyArbitraries,
    persistencePolicyPropertyOptions(`random`, adapterFailurePolicyProperty),
  )(
    `generated adapter failures reject publicly and admit no later Electric work (random)`,
    checkFailurePolicy,
  )

  electricHistoryProperty(
    `electric.design-convergence`,
    `operational and denotational reference designs agree before checking production`,
    fc.tuple(
      fc.array(designTokenArb, { minLength: 1, maxLength: 7 }),
      fc.nat(),
    ),
    24,
    42_717,
    async ([tokens, partitionSeed]) => {
      const prefix = [[upToDate]]
      const messages = [...tokens.map(designMessage), upToDate]
      const partitions = everyContiguousPartition(messages)
      const selected = [
        [messages],
        messages.map((message) => [message]),
        partitions[partitionSeed % partitions.length]!,
      ].filter(isSdkResetFramedPartition)

      for (const [partitionId, partition] of selected.entries()) {
        const operational = expectedSnapshots(prefix, partition)
        const denotational = recomputedSnapshots(prefix, partition)
        expect(operational).toEqual(denotational)

        for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
          const actual = await runTrace(
            `design-grammar-${syncMode}-${partitionId}`,
            syncMode,
            prefix,
            partition,
          )
          expect(actual.snapshots).toEqual(denotational)
        }
      }
    },
  )

  oracleReplayTest(it)(
    `distinguishes plausible unseen-update and reset-visibility semantics`,
    async () => {
      const completeUnseenUpdate: ChangeMessage<OracleRow> = {
        key: `1`,
        value: { id: 1, name: `complete`, stable: `stable-1` },
        headers: { operation: `update` },
      }
      const updateHistory = [[completeUnseenUpdate, upToDate]]
      expect(recomputeCommittedRows(updateHistory, `ignore`)).toEqual([])
      expect(recomputeCommittedRows(updateHistory, `promote-complete`)).toEqual(
        [[1, `complete`, `stable-1`]],
      )
      const updateActual = await runTrace(
        `design-unseen-update`,
        `eager`,
        [],
        updateHistory,
      )
      expect(updateActual.rows).toEqual(
        recomputeCommittedRows(updateHistory, `ignore`),
      )

      const resetHistory = [
        [change(`insert`, 1, `committed`), upToDate],
        [mustRefetch],
      ]
      const atomicReset = recomputedSnapshots([], resetHistory)
      const immediateReset: typeof atomicReset = [atomicReset[0]!, []]
      expect(atomicReset).not.toEqual(immediateReset)
      const resetActual = await runTrace(
        `design-reset-visibility`,
        `eager`,
        [],
        resetHistory,
      )
      expect(resetActual.snapshots).toEqual(atomicReset)
    },
  )

  oracleReplayTest(it)(
    `keeps SDK reset callbacks separate from every neighboring message kind`,
    () => {
      const neighbors: Array<Message<OracleRow>> = [
        change(`insert`, 1, `row`),
        change(`update`, 1, `row`),
        change(`delete`, 1, `row`),
        {
          headers: { event: `move-out`, patterns: [{ pos: 0, value: `left` }] },
        },
        upToDate,
        subsetEnd,
        mustRefetch,
      ]
      expect(isSdkResetFramedPartition([[mustRefetch]])).toBe(true)
      for (const neighbor of neighbors) {
        for (const messages of [
          [neighbor, mustRefetch],
          [mustRefetch, neighbor],
        ]) {
          expect(
            isSdkResetFramedPartition([messages]),
            JSON.stringify(messages),
          ).toBe(false)
          expect(
            isSdkResetFramedPartition(messages.map((message) => [message])),
          ).toBe(true)
        }
      }
    },
  )

  oracleReplayTest(it)(
    `distinguishes callback-atomic and subset publication semantics`,
    async () => {
      const callbackHistory = [
        [
          change(`insert`, 1, `before-control`),
          upToDate,
          change(`update`, 1, `after-control`),
        ],
      ]
      const callbackAtomic = recomputeCommittedRows(callbackHistory)
      const freezeAtControl: typeof callbackAtomic = [
        [1, `before-control`, `stable-1`],
      ]
      expect(callbackAtomic).toEqual([[1, `after-control`, `stable-1`]])
      expect(callbackAtomic).not.toEqual(freezeAtControl)
      expect(isSdkResetFramedPartition([[upToDate, mustRefetch]])).toBe(false)
      expect(
        isSdkResetFramedPartition([[mustRefetch, subsetEnd, mustRefetch]]),
      ).toBe(false)

      const readyPrefix = [[upToDate]]
      const subsetHistory = [
        [change(`insert`, 1, `subset-publication`)],
        [subsetEnd],
      ]
      const subsetPublishes = recomputedSnapshots(readyPrefix, subsetHistory)
      const upToDateOnly: typeof subsetPublishes = [[], []]
      expect(subsetPublishes).not.toEqual(upToDateOnly)

      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        const callbackActual = await runTrace(
          `design-callback-atomic-${syncMode}`,
          syncMode,
          [],
          callbackHistory,
        )
        expect(callbackActual.rows).toEqual(callbackAtomic)

        const subsetActual = await runTrace(
          `design-subset-publication-${syncMode}`,
          syncMode,
          readyPrefix,
          subsetHistory,
        )
        expect(subsetActual.snapshots).toEqual(subsetPublishes)
      }
    },
  )

  oracleReplayTest(it)(
    `settles every startup, hydration, snapshot availability, persistence-apply release, and cleanup permutation`,
    async () => {
      const events: Array<SchedulerEvent> = [
        `startup-promise`,
        `hydration`,
        `snapshot-available`,
        `release-persistence-apply`,
        `cleanup`,
      ]
      let permutationIndex = 0
      const outcomes = new Set<`resolved` | `aborted`>()
      let sawAcknowledgementBeforeDurability = false
      for (const order of permutations(events)) {
        const currentIndex = permutationIndex++
        try {
          const result = await runSchedulerPermutation(
            `scheduler-permutation-${currentIndex}`,
            order,
          )
          outcomes.add(result.outcome)
          sawAcknowledgementBeforeDurability ||=
            result.acknowledgedBeforeDurable
        } catch (error) {
          throw new Error(
            `scheduler permutation ${currentIndex} failed: ${order.join(` → `)}`,
            { cause: error },
          )
        }
      }
      expect(outcomes).toEqual(new Set([`resolved`, `aborted`]))
      expect(sawAcknowledgementBeforeDurability).toBe(true)
    },
    30_000,
  )

  electricHistoryProperty(
    `electric.synthetic-batch-partition`,
    `synthetic batch partition is invariant across Electric modes and phases`,
    fc.tuple(
      fc.string({ maxLength: 8 }),
      fc.string({ maxLength: 8 }),
      fc.string({ maxLength: 8 }),
      fc.string({ maxLength: 8 }),
    ),
    10,
    42_718,
    async (names) => {
      const [first, second, updated, reinserted] = names
      const readyPrefix = [
        [change(`insert`, 1, first), change(`insert`, 2, second), upToDate],
      ]
      const scenarios: Array<PartitionScenario> = [
        {
          name: `bootstrap`,
          prefix: [],
          messages: [
            change(`insert`, 1, first),
            change(`insert`, 2, second),
            change(`update`, 1, updated),
            change(`delete`, 2, second),
            change(`insert`, 2, reinserted),
            upToDate,
          ],
          expectedRows: [
            [1, updated, `stable-1`],
            [2, reinserted, `stable-2`],
          ],
          resume: false,
        },
        {
          name: `steady`,
          prefix: readyPrefix,
          messages: [
            change(`update`, 1, updated),
            change(`delete`, 2, second),
            change(`insert`, 2, reinserted),
            upToDate,
          ],
          expectedRows: [
            [1, updated, `stable-1`],
            [2, reinserted, `stable-2`],
          ],
          resume: false,
        },
        {
          name: `split-delete-update`,
          prefix: [[change(`insert`, 1, first), upToDate]],
          messages: [
            change(`delete`, 1, first),
            change(`update`, 1, updated),
            upToDate,
          ],
          expectedRows: [],
          resume: false,
        },
        {
          name: `subset`,
          prefix: readyPrefix,
          messages: [
            change(`update`, 1, updated),
            change(`delete`, 2, second),
            subsetEnd,
          ],
          expectedRows: [[1, updated, `stable-1`]],
          resume: false,
        },
        {
          name: `must-refetch`,
          prefix: readyPrefix,
          messages: [
            mustRefetch,
            change(`insert`, 1, first),
            change(`update`, 1, updated),
            change(`insert`, 2, reinserted),
            upToDate,
          ],
          expectedRows: [
            [1, updated, `stable-1`],
            [2, reinserted, `stable-2`],
          ],
          resume: false,
        },
        {
          name: `must-refetch-unseen-update`,
          prefix: readyPrefix,
          messages: [mustRefetch, change(`update`, 1, updated), upToDate],
          expectedRows: [],
          resume: false,
        },
        {
          name: `must-refetch-subset`,
          prefix: readyPrefix,
          messages: [
            mustRefetch,
            change(`insert`, 1, first),
            subsetEnd,
            change(`update`, 1, updated),
            upToDate,
          ],
          expectedRows: [[1, updated, `stable-1`]],
          resume: false,
        },
        {
          name: `resume`,
          prefix: [],
          messages: [
            change(`insert`, 1, first),
            change(`update`, 1, updated),
            upToDate,
          ],
          expectedRows: [[1, updated, `stable-1`]],
          resume: true,
        },
      ]

      // Keep these stronger adapter robustness checks, including mixed-reset
      // callbacks, separate from the SDK-framed differential oracle above.
      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        for (const scenario of scenarios) {
          const seed = scenario.resume ? resumeState() : new Map()
          const atomic = await runTrace(
            `${syncMode}-${scenario.name}-atomic`,
            syncMode,
            scenario.prefix,
            [scenario.messages],
            seed,
          )
          expect(atomic.rows).toEqual(scenario.expectedRows)
          expect(atomic.status).toBe(`ready`)
          expect(atomic.resume).toEqual(
            expect.objectContaining({ kind: `resume`, offset: `20_0` }),
          )

          let partitionId = 0
          for (const partition of everyContiguousPartition(scenario.messages)) {
            const currentPartition = partitionId++
            const split = await runTrace(
              `${syncMode}-${scenario.name}-${currentPartition}`,
              syncMode,
              scenario.prefix,
              partition,
              seed,
            )
            expect(
              {
                rows: split.rows,
                status: split.status,
                resume: split.resume,
              },
              `${syncMode}/${scenario.name}/partition-${currentPartition}: ${JSON.stringify({ partition, atomic, split })}`,
            ).toEqual({
              rows: atomic.rows,
              status: atomic.status,
              resume: atomic.resume,
            })
            expect(split.snapshots).toEqual(
              expectedSnapshots(scenario.prefix, partition),
            )
          }
        }
      }
    },
    30_000,
  )

  electricHistoryProperty(
    `electric.valid-batch-partition`,
    `generated valid histories are invariant under every batch partition`,
    fc.array(
      fc.record({
        operation: fc.constantFrom<HistoryToken[`operation`]>(
          `insert`,
          `update`,
          `delete`,
        ),
        id: fc.integer({ min: 1, max: 3 }),
        name: fc.string({ maxLength: 8 }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    20,
    42_719,
    async (tokens) => {
      const history = buildValidHistory(tokens)
      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        let partitionId = 0
        for (const partition of everyContiguousPartition(history.messages)) {
          const result = await runTrace(
            `generated-${syncMode}-${partitionId++}`,
            syncMode,
            [],
            partition,
          )
          expect(result.rows).toEqual(history.expectedRows)
          expect(result.snapshots).toEqual(expectedSnapshots([], partition))
          expect(result.status).toBe(`ready`)
        }
      }
    },
  )

  const publicationEpochTokensArbitrary = fc.array(designTokenArb, {
    minLength: 1,
    maxLength: 7,
  })
  const publicationEpochPartitionArbitrary = fc.nat()
  const publicationEpochExamples: Array<[Array<DesignToken>, number]> = [
    [
      [
        { operation: `insert`, id: 1, name: `` },
        { operation: `update`, id: 1, name: ` ` },
        { operation: `insert`, id: 2, name: `` },
      ],
      14,
    ],
    [
      [
        { operation: `insert`, id: 2, name: `` },
        { operation: `deliver-up-to-date` },
        { operation: `delete`, id: 2, name: `` },
      ],
      2032071466,
    ],
    [
      [{ operation: `reset` }, { operation: `subset` }, { operation: `reset` }],
      30,
    ],
  ]

  oracleReplayTest(it).each(publicationEpochExamples)(
    `reconstructs the authored publication-epoch history`,
    assertPublicationEpochHistory,
    30_000,
  )

  oracleReplayTest(fcTest).prop(
    [publicationEpochTokensArbitrary, publicationEpochPartitionArbitrary],
    {
      seed: 42714,
      numRuns: oracleRuns(20),
    },
  )(
    `Electric drivers converge with the denotational reference and model-fed Query projection across publication epochs (fixed)`,
    assertPublicationEpochHistory,
    30_000,
  )

  oracleReplayTest(fcTest, `electric.publication-epoch-convergence`).prop(
    [publicationEpochTokensArbitrary, publicationEpochPartitionArbitrary],
    oraclePropertyOptions(20, `electric.publication-epoch-convergence`),
  )(
    `Electric drivers converge with the denotational reference and model-fed Query projection across publication epochs (random or replayed)`,
    assertPublicationEpochHistory,
    30_000,
  )

  oracleReplayTest(it)(
    `checks an authored HTTP transcript and separate complete Query snapshots`,
    async () => {
      const { ShapeStream: RealShapeStream } = await vi.importActual<{
        ShapeStream: typeof ShapeStream
      }>(`@electric-sql/client`)
      const ready: Message<OracleRow> = {
        headers: { control: `up-to-date`, global_last_seen_lsn: `2` },
      }
      const authored: Array<Array<Message<OracleRow>>> = [
        [
          change(`insert`, 1, `old`),
          { headers: { control: `up-to-date`, global_last_seen_lsn: `1` } },
        ],
        [mustRefetch],
        [
          change(`insert`, 2, `replacement`),
          subsetEnd,
          change(`insert`, 3, `after-control`),
          ready,
        ],
      ]
      // These complete snapshots are authored directly, not computed by either
      // reference reducer or from any adapter result. A post-control row belongs
      // to the same delivered callback's atomic publication.
      const complete: TraceResult[`snapshots`] = [
        [[1, `old`, `stable-1`]],
        [[1, `old`, `stable-1`]],
        [
          [2, `replacement`, `stable-2`],
          [3, `after-control`, `stable-3`],
        ],
      ]
      const controller = new AbortController()
      const headers = {
        'electric-handle': `authored-old`,
        'electric-offset': `1_0`,
        // Without this completion header the SDK can prefetch the next chunk;
        // a positional mock-response queue would not describe the live request.
        'electric-up-to-date': `true`,
        'electric-schema': JSON.stringify({
          id: { type: `int4` },
          name: { type: `text` },
          stable: { type: `text` },
        }),
      }
      const wire = (messages: Array<Message<OracleRow>>) =>
        JSON.stringify(
          messages.map((message) =>
            `value` in message
              ? {
                  ...message,
                  value: { ...message.value, id: String(message.value.id) },
                }
              : message,
          ),
        )
      const responses = [
        new Response(wire(authored[0]!), { headers }),
        new Response(wire(authored[1]!), {
          status: 409,
          headers: { 'electric-handle': `authored-new` },
        }),
        new Response(wire(authored[2]!), {
          headers: {
            ...headers,
            'electric-handle': `authored-new`,
            'electric-offset': `2_0`,
            'electric-cursor': `1`,
          },
        }),
      ]
      const received: Array<Array<Message<OracleRow>>> = []
      const stream = new RealShapeStream<OracleRow>({
        url: `http://test-url/v1/authored-publication-transcript`,
        params: { table: `rows` },
        signal: controller.signal,
        fetchClient: () => {
          const response = responses.shift()
          if (response) return Promise.resolve(response)
          return new Promise<Response>((_resolve, reject) => {
            if (controller.signal.aborted) reject(controller.signal.reason)
            else
              controller.signal.addEventListener(
                `abort`,
                () => reject(controller.signal.reason),
                { once: true },
              )
          })
        },
      })
      const unsubscribe = stream.subscribe((messages) => {
        received.push(structuredClone(messages))
      })
      try {
        await vi.waitFor(() =>
          expect(
            received,
            JSON.stringify({ received, remainingResponses: responses.length }),
          ).toHaveLength(3),
        )
        expect(received).toEqual(authored)
        expect(isSdkResetFramedPartition(received)).toBe(true)
        // This validates this installed SDK's controlled-HTTP antecedent only.
        // It is not proof that all servers or SSE streams emit this transcript.
        for (const mode of [`eager`, `on-demand`, `progressive`] as const) {
          const direct = await runTrace(
            `authored-direct-${mode}`,
            mode,
            [],
            structuredClone(received),
          )
          const persisted = await runPersistedTrace(
            `authored-persisted-${mode}`,
            mode,
            structuredClone(received),
            complete,
          )
          expect(direct.snapshots).toEqual(complete)
          expect(persisted.snapshots).toEqual(complete)
          expect(persisted.durableRows).toEqual(complete[2])
        }
        const query = await runQueryTrace(
          `authored-query`,
          structuredClone(received),
          complete,
        )
        expect(query.snapshots).toEqual(complete)
      } finally {
        unsubscribe()
        controller.abort()
      }
    },
  )

  electricHistoryProperty(
    `electric.invalid-resume-partition`,
    `generated invalid resume transitions fail under every batch partition`,
    fc.tuple(
      fc.integer({ min: 1, max: 20 }),
      fc.string({ maxLength: 8 }),
      fc.string({ maxLength: 8 }),
    ),
    20,
    42_720,
    async ([id, completeName, partialName]) => {
      const messages = [
        change(`delete`, id, completeName),
        change(`update`, id, partialName),
        upToDate,
      ]

      for (const syncMode of [`eager`, `progressive`] as const) {
        for (const removal of [`delete`, `move-out`] as const) {
          const removed =
            removal === `delete`
              ? messages[0]!
              : ({
                  headers: {
                    event: `move-out`,
                    patterns: [{ pos: 0, value: `left` }],
                  },
                } as Message<OracleRow>)
          for (const [partitionId, partition] of everyContiguousPartition([
            removed,
            ...messages.slice(1),
          ]).entries()) {
            const metadata = createMetadata(resumeState())
            const trace = createOracleCollection(
              `generated-invalid-${syncMode}-${id}-${partitionId}`,
              syncMode,
              metadata.api,
            )
            const inserted = change(`insert`, id, completeName)
            trace.subscriber([
              { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
              upToDate,
            ])
            for (const batch of partition) trace.subscriber(batch)

            expectGaveUpAfterReadiness(trace.collection)
            expect(trace.collection.get(id)).toEqual(
              expect.objectContaining({ stable: `stable-${id}` }),
            )
            expect(metadata.state.get(`electric:resume`)).toEqual(
              expect.objectContaining({ kind: `reset` }),
            )
            await trace.collection.cleanup()
          }
        }
      }
    },
  )

  const reentryHistory = fc.record({
    txid: fc.integer({ min: 1, max: 10000 }),
    names: fc.array(fc.string({ maxLength: 8 }), {
      minLength: 1,
      maxLength: 5,
    }),
    trigger: fc.nat({ max: 4 }),
  })

  async function runReentryHistory(history: {
    txid: number
    names: Array<string>
    trigger: number
  }) {
    // Same ownership law, with retirement either outside or inside a callback.
    // Previously the grammar only retired a sync run between complete callbacks.
    for (const insideCallback of [false, true]) {
      const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> =
        []
      mockSubscribe.mockImplementation((callback) => {
        subscribers.push(callback)
        return vi.fn()
      })
      const collection = createCollection(
        electricCollectionOptions<OracleRow>({
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          getKey: (row) => row.id,
          startSync: true,
        }),
      )
      const triggerId = (history.trigger % history.names.length) + 1
      let retired = false
      let cleanup: Promise<void> | undefined
      let replacementVisits = 0
      let replacementOutcome: Promise<unknown> | undefined
      const restart = () => {
        retired = true
        cleanup = collection.cleanup()
        collection.startSyncImmediate()
        replacementOutcome = collection.utils
          .awaitMatch(() => {
            replacementVisits++
            return false
          })
          .catch(() => undefined)
      }
      const waiting = collection.utils.awaitMatch((message) => {
        if (
          insideCallback &&
          !retired &&
          `value` in message &&
          message.value.id === triggerId
        )
          restart()
        return false
      }, 20)
      // Observe the old waiter before any callback can retire its sync run.
      const oldOutcome = waiting.then(
        () => `resolved`,
        () => `rejected`,
      )
      try {
        if (!insideCallback) restart()
        const messages = history.names.map((name, index) =>
          change(`insert`, index + 1, name),
        )
        const acknowledgement: Message<OracleRow> = {
          headers: { control: `up-to-date`, txids: [history.txid] },
        }
        subscribers[0]!([...messages, acknowledgement])
        await cleanup
        expect(subscribers).toHaveLength(2)
        expect(await oldOutcome).toBe(`rejected`)
        expect(replacementVisits).toBe(0)
        // The old callback's tail is not evidence from the replacement stream.
        // This is the utility's own deadline, not a sleep used to infer readiness.
        await expect(
          collection.utils.awaitTxId(history.txid, 10),
        ).rejects.toThrow(/Timeout/)
        expect(collection.size).toBe(0)
        subscribers[1]!([...messages, acknowledgement])
        await expect(
          collection.utils.awaitTxId(history.txid, 10),
        ).resolves.toBe(true)
        expect(
          [...collection.values()].map((row) => ({
            id: row.id,
            name: row.name,
          })),
        ).toEqual(history.names.map((name, index) => ({ id: index + 1, name })))
      } finally {
        await collection.cleanup()
        await oldOutcome
        await replacementOutcome
      }
    }
  }

  oracleReplayTest(fcTest).prop([reentryHistory], {
    seed: 42713,
    numRuns: oracleRuns(10),
  })(
    `replacement sync runs reject evidence from callback reentry histories (fixed)`,
    runReentryHistory,
  )
  oracleReplayTest(fcTest, `electric.match-reentry`).prop(
    [reentryHistory],
    oraclePropertyOptions(10, `electric.match-reentry`),
  )(
    `replacement sync runs reject evidence from callback reentry histories (random)`,
    runReentryHistory,
  )

  /**
   * ## Does a source that still tries ever look failed?
   *
   * Law: an Electric source that is still trying is `loading`. While the
   * user's `onError` decides, and after it asks for a retry, no initial wait
   * fails: the Collection stays `loading`, and a waiting full-log or
   * progressive demand settles, with its rows visible, when the retried
   * stream delivers its snapshot. A retry that succeeds is a success. The
   * source fails its initial sync only when it gives up: there is no
   * `onError`, `onError` returns no retry or throws, the Electric client gives
   * up by itself, or the stream's external signal aborts. Then the Collection
   * enters `error`, and every waiting demand and readiness wait rejects with
   * that same cause. A status listener that cleans the Collection up inside
   * that failure does not turn a rejected demand into a quiet one. Once the
   * first up-to-date is committed, its acceptance alone decides the initial
   * sync, even while a persistence wrapper still holds it: when it is
   * accepted, the Collection becomes `ready`, whatever errors, retries, or
   * give-ups arrived meanwhile, and the demands it covers settle with its
   * rows; when its acceptance fails, no usable snapshot exists, so the
   * initial sync fails with that cause. Core marks a Collection ready
   * when a commit carries a truncate, so a progressive history's first
   * up-to-date is ready at its commit. After
   * the first ready, a later failure does not change the status. A demand
   * whose snapshot arrived before an external abort still settles when its
   * rows apply. Cleanup ends a waiting demand quietly, except after an
   * external abort: an aborted provider cannot fulfill a demand whose rows
   * never became visible, so it rejects with `AbortError`.
   *
   * A persisting optimistic transaction can hold the retried snapshot: the
   * commit is accepted, so the Collection becomes `ready`, but its rows apply
   * only when the transaction settles. Applied settlement means a waiting or
   * new demand settles only when those rows are visible. Core applies a
   * truncate at once, with every commit before it, so it is never held. A
   * progressive history starts with a must-refetch, so its first up-to-date
   * commits a truncate and applies while a transaction persists.
   *
   * The independent model keeps six facts: whether the first up-to-date was
   * delivered, whether its rows are visible, whether a transaction holds
   * them, the final failure cause, the pending `onError` decision, and each
   * demand's settlement. It does not read production state.
   *
   * The history grammar crosses four sources: full-log and progressive
   * waits, and eager and changes-only sources, which have no
   * established-snapshot wait and so add no demands. Each runs with and
   * without `onError`, with the external signal already aborted at sync start
   * in one history in ten, and with or without a status listener that cleans
   * up on `error`. Its steps are errors whose decisions are a synchronous retry, a
   * synchronous give-up, a throw, an asynchronous retry, or an asynchronous
   * give-up; a later error after a retry; an Electric client give-up; an
   * external abort before or during a decision; a held acceptance of the
   * first up-to-date commit, crossed with later errors, retries, give-ups,
   * and aborts, which then succeeds or fails;
   * new demands; the first
   * up-to-date; a persisting transaction that starts before it and later
   * settles; and cleanup. It omits histories the client cannot produce:
   * a stream message or a second error while `onError` decides, because the
   * client awaits the decision; and stream steps after a final failure or an
   * abort, because the stream has stopped. It also omits a second
   * up-to-date while the first snapshot's acceptance is pending. The
   * installed-client lane cannot hold an acceptance, so this dimension runs
   * only here. A progressive history starts with
   * a must-refetch, so its demands wait on the established snapshot.
   *
   * The driver runs the real adapter and Collection behind the controlled
   * ShapeStream. After each step and a timer turn it compares the status,
   * every demand's settlement and cause, a readiness wait's settlement and
   * cause, and whether the snapshot's row is visible. The model lives in `electric-retry-decision-model.ts`. An
   * installed-client lane in `electric-sdk-delivery-oracle.property.test.ts`
   * drives the same model through the real Electric client and HTTP.
   */
  const retryDecisionArb = fc.constantFrom<RetryDecision>(
    `sync-retry`,
    `sync-give-up`,
    `throw`,
    `async-retry`,
    `async-give-up`,
  )
  const retryStepArb: fc.Arbitrary<RetryStep> = fc.oneof(
    fc.constant({ kind: `demand` as const }),
    retryDecisionArb.map((decision) => ({ kind: `error` as const, decision })),
    fc.constant({ kind: `decide` as const }),
    fc.constant({ kind: `up-to-date` as const }),
    fc.constant({ kind: `client-give-up` as const }),
    fc.constant({ kind: `abort` as const }),
    fc.constant({ kind: `hold` as const }),
    fc.constant({ kind: `release` as const }),
    fc.constant({ kind: `hold-acceptance` as const }),
    fc.constant({ kind: `accept` as const }),
    fc.constant({ kind: `accept-fails` as const }),
  )
  // Generated steps that the client cannot produce in the current model state
  // are dropped, so every history is legal.
  const retryHistoryArb: fc.Arbitrary<RetryHistory> = fc
    .record({
      wait: fc.constantFrom<RetryWait>(
        `full-log`,
        `progressive`,
        `eager`,
        `changes-only`,
      ),
      hasOnError: fc.boolean(),
      // One history in ten starts with the external signal already aborted.
      abortedAtStart: fc.integer({ min: 0, max: 9 }).map((roll) => roll === 0),
      cleanupOnError: fc.boolean(),
      steps: fc.array(retryStepArb, { minLength: 1, maxLength: 8 }),
    })
    .map(({ wait, hasOnError, abortedAtStart, cleanupOnError, steps }) => {
      const model = createRetryModel(wait, cleanupOnError)
      if (abortedAtStart)
        applyRetryModel(model, { kind: `abort` }, hasOnError, `start`)
      const legal: Array<RetryStep> = []
      const initial: RetryStep = { kind: `demand` }
      if (retryStepIsLegal(model, initial)) {
        legal.push(initial)
        applyRetryModel(model, initial, hasOnError, `e0`)
      }
      for (const step of steps) {
        if (!retryStepIsLegal(model, step)) continue
        legal.push(step)
        applyRetryModel(model, step, hasOnError, `e${legal.length - 1}`)
      }
      return { wait, hasOnError, abortedAtStart, cleanupOnError, steps: legal }
    })

  function retrySettlementTag(error: unknown, tags: Map<unknown, string>) {
    const tag = tags.get(error)
    if (tag !== undefined) return tag
    return error instanceof Error ? error.name : String(error)
  }

  async function runRetryHistory(
    history: RetryHistory,
    id: string,
  ): Promise<void> {
    // A reset resume marker selects the full log for an on-demand source;
    // without it the source reads the changes-only log.
    const metadata = createMetadata(
      history.wait === `changes-only`
        ? new Map()
        : new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
    )
    const controller = new AbortController()
    if (history.abortedAtStart) controller.abort()
    const tags = new Map<unknown, string>()
    let decide: ((retry: Record<string, never> | undefined) => void) | undefined
    let decision: RetryDecision = `sync-retry`
    let thrown: Error | undefined
    const onError = () => {
      if (decision === `throw`) throw thrown
      if (decision === `sync-retry`) return {}
      if (decision === `sync-give-up`) return undefined
      return new Promise<Record<string, never> | undefined>((resolve) => {
        decide = resolve
      })
    }
    // A persistence wrapper accepts a commit after its durable step. Once
    // armed, the driver holds the acceptance of every commit until `accept`;
    // the rows are visible at once, as core applies the transaction.
    let armAcceptance = false
    const heldAcceptance = createDeferred<void>()
    const holdAcceptance = <TParams>(params: TParams): TParams => {
      const syncParams = params as unknown as {
        commit: (signal?: AbortSignal) => true | Promise<void>
      }
      const commit = syncParams.commit
      return {
        ...params,
        // A wrapper passes the source's signal through, so an abandoned
        // transaction stays abandoned.
        commit: (signal?: AbortSignal) => {
          const receipt = commit(signal)
          if (!armAcceptance) return receipt
          return withAcceptedReceipt(
            receipt === true ? Promise.resolve() : receipt,
            heldAcceptance.promise,
          )
        },
      }
    }
    const trace = createOracleCollection(
      id,
      history.wait === `progressive`
        ? `progressive`
        : history.wait === `eager`
          ? `eager`
          : `on-demand`,
      metadata.api,
      {
        signal: controller.signal,
        ...(history.hasOnError
          ? {
              onError: onError as unknown as () => Promise<
                Record<string, never> | undefined
              >,
            }
          : {}),
      },
      holdAcceptance,
    )
    const streamOnError = (
      vi.mocked(ShapeStream).mock.calls.at(-1)?.[0] as unknown as {
        onError: (error: unknown) => Promise<unknown>
      }
    ).onError
    const settlements: Array<RetrySettlement> = []
    const model = createRetryModel(history.wait, history.cleanupOnError)
    if (history.abortedAtStart)
      applyRetryModel(model, { kind: `abort` }, history.hasOnError, `start`)
    if (history.cleanupOnError) {
      trace.collection.on(`status:change`, ({ status }) => {
        if (status === `error`) void trace.collection.cleanup()
      })
    }
    let preload: RetrySettlement = `pending`
    void trace.collection.preload().then(
      () => {
        preload = `fulfilled`
      },
      (reason: unknown) => {
        preload = `rejected:${retrySettlementTag(reason, tags)}`
      },
    )
    const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    const observe = (): RetryObservation => ({
      status: trace.collection.status,
      demands: [...settlements],
      rowVisible: trace.collection.has(1),
      preload: trace.collection.status === `cleaned-up` ? undefined : preload,
    })
    const decisions: Array<Promise<unknown>> = []
    const persistence = createDeferred<void>()
    let transaction: ReturnType<typeof createTransaction> | undefined

    await withElectricCleanup(async () => {
      if (history.wait === `progressive`) {
        trace.subscriber([{ headers: { control: `must-refetch` } }])
        await turn()
      }
      for (const [index, step] of history.steps.entries()) {
        const tag = `e${index}`
        switch (step.kind) {
          case `demand`: {
            const slot = settlements.push(`pending`) - 1
            void Promise.resolve(
              trace.collection._sync.loadSubset({ limit: slot + 1 }),
            ).then(
              () => {
                settlements[slot] = `fulfilled`
              },
              (reason: unknown) => {
                settlements[slot] =
                  `rejected:${retrySettlementTag(reason, tags)}`
              },
            )
            break
          }
          case `error`: {
            const error = new Error(`provider error ${tag}`)
            tags.set(error, tag)
            decision = step.decision
            thrown = new Error(`onError threw ${tag}`)
            tags.set(thrown, `thrown-${tag}`)
            decisions.push(
              Promise.resolve(streamOnError(error)).catch(() => undefined),
            )
            break
          }
          case `decide`:
            decide!(model.deciding!.decision === `async-retry` ? {} : undefined)
            break
          case `up-to-date`:
            trace.subscriber(
              history.wait === `changes-only`
                ? [upToDate]
                : [change(`insert`, 1, `recovered`), upToDate],
            )
            break
          case `client-give-up`: {
            const error = new Error(`client gave up ${tag}`)
            tags.set(error, tag)
            trace.sdkError(error)
            break
          }
          case `abort`:
            controller.abort()
            break
          case `hold`:
            transaction = createTransaction({
              mutationFn: () => persistence.promise,
            })
            transaction.mutate(() =>
              trace.collection.insert({
                id: 99,
                name: `optimistic`,
                stable: `stable-99`,
              }),
            )
            break
          case `release`:
            persistence.resolve()
            await transaction!.when(`settled`)
            break
          case `hold-acceptance`:
            armAcceptance = true
            break
          case `accept`:
            armAcceptance = false
            heldAcceptance.resolve()
            break
          case `accept-fails`: {
            armAcceptance = false
            const error = new Error(`persistence failed ${tag}`)
            tags.set(error, `accept-failed-${tag}`)
            heldAcceptance.reject(error)
            break
          }
        }
        applyRetryModel(model, step, history.hasOnError, tag)
        await turn()
        await turn()
        expect(
          observe(),
          `after ${JSON.stringify(history.steps.slice(0, index + 1))}`,
        ).toEqual(expectedRetryObservation(model, false))
      }
      await trace.collection.cleanup()
      persistence.resolve()
      heldAcceptance.resolve()
      void heldAcceptance.promise.catch(() => undefined)
      // A decision still pending at cleanup cannot change the stopped run.
      decide?.(undefined)
      await Promise.all(decisions)
      await turn()
      expect(observe(), `after cleanup`).toEqual(
        expectedRetryObservation(model, true),
      )
    }, [() => persistence.resolve(), () => trace.collection.cleanup()])
  }

  let retryHistoryRun = 0
  electricHistoryProperty(
    `electric.retry-decision`,
    `a source that still tries stays loading, and only a give-up fails its waits`,
    retryHistoryArb,
    30,
    42_731,
    async (history) => {
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      const consoleWarn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      try {
        resetElectricOracleMocks()
        await runRetryHistory(history, `retry-decision-${++retryHistoryRun}`)
      } finally {
        consoleError.mockRestore()
        consoleWarn.mockRestore()
      }
    },
    60_000,
    [
      // Named replays: a retried provider error while a transaction holds the
      // recovered snapshot, for each wait, with and without a hold (this
      // replaces the former fixed "renews full recovery demand" case); a
      // held snapshot whose stream aborts before the hold settles; an
      // asynchronous retry decision with a waiting and a new demand; an
      // asynchronous give-up; a retry, then a give-up; a throwing onError;
      // an Electric client give-up; and an abort during a decision.
      ...([`full-log`, `progressive`] as const).flatMap((wait) =>
        [false, true].map((held): [RetryHistory] => [
          {
            wait,
            hasOnError: true,
            steps: [
              ...(held ? [{ kind: `hold` as const }] : []),
              { kind: `demand` },
              { kind: `error`, decision: `sync-retry` },
              { kind: `up-to-date` },
              { kind: `demand` },
              ...(held ? [{ kind: `release` as const }] : []),
            ],
          },
        ]),
      ),
      [
        {
          wait: `full-log`,
          hasOnError: false,
          steps: [
            { kind: `demand` },
            { kind: `hold` },
            { kind: `up-to-date` },
            { kind: `abort` },
            { kind: `release` },
          ],
        },
      ],
      [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `async-retry` },
            { kind: `demand` },
            { kind: `decide` },
            { kind: `up-to-date` },
          ],
        },
      ],
      [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `async-give-up` },
            { kind: `demand` },
            { kind: `decide` },
          ],
        },
      ],
      [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `sync-retry` },
            { kind: `error`, decision: `sync-give-up` },
          ],
        },
      ],
      [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [{ kind: `demand` }, { kind: `error`, decision: `throw` }],
        },
      ],
      [
        {
          wait: `progressive`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `sync-retry` },
            { kind: `client-give-up` },
          ],
        },
      ],
      [
        {
          wait: `progressive`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `async-retry` },
            { kind: `abort` },
            { kind: `decide` },
          ],
        },
      ],
      // The external signal is already aborted when sync starts, for each
      // wait; a status listener that cleans up inside a give-up and inside an
      // external abort; and the eager and changes-only sources, which have no
      // established-snapshot wait.
      ...([`full-log`, `progressive`, `eager`, `changes-only`] as const).map(
        (wait): [RetryHistory] => [
          { wait, hasOnError: true, abortedAtStart: true, steps: [] },
        ],
      ),
      [
        {
          wait: `full-log`,
          hasOnError: false,
          cleanupOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `sync-retry` },
          ],
        },
      ],
      [
        {
          wait: `progressive`,
          hasOnError: true,
          cleanupOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `error`, decision: `async-retry` },
            { kind: `abort` },
          ],
        },
      ],
      ...([`eager`, `changes-only`] as const).map((wait): [RetryHistory] => [
        {
          wait,
          hasOnError: true,
          steps: [
            { kind: `hold` },
            { kind: `error`, decision: `async-retry` },
            { kind: `decide` },
            { kind: `up-to-date` },
            { kind: `release` },
          ],
        },
      ]),
      ...([`eager`, `changes-only`] as const).map((wait): [RetryHistory] => [
        {
          wait,
          hasOnError: true,
          steps: [
            { kind: `error`, decision: `async-give-up` },
            { kind: `decide` },
          ],
        },
      ]),
      // A final give-up after the first up-to-date is committed but before
      // its acceptance settles is a post-ready failure: the Collection
      // becomes ready when the snapshot is accepted, with its rows, and the
      // demands it covers settle. One replay per give-up.
      ...(
        [
          [false, { kind: `error`, decision: `sync-give-up` }],
          [true, { kind: `error`, decision: `sync-give-up` }],
          [true, { kind: `error`, decision: `throw` }],
          [true, { kind: `client-give-up` }],
          [true, { kind: `abort` }],
        ] as Array<[boolean, RetryStep]>
      ).map(([hasOnError, giveUp]): [RetryHistory] => [
        {
          wait: `full-log`,
          hasOnError,
          steps: [
            { kind: `demand` },
            { kind: `hold-acceptance` },
            { kind: `up-to-date` },
            giveUp,
            { kind: `accept` },
          ],
        },
      ]),
      [
        {
          wait: `progressive`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `hold-acceptance` },
            { kind: `up-to-date` },
            { kind: `error`, decision: `async-give-up` },
            { kind: `decide` },
            { kind: `demand` },
            { kind: `accept` },
          ],
        },
      ],
      // While the first snapshot's acceptance is pending: a retry, then the
      // acceptance, then a final give-up; a retry, then a give-up, then the
      // acceptance; and an acceptance that fails, with and without an earlier
      // external abort.
      [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `hold-acceptance` },
            { kind: `up-to-date` },
            { kind: `error`, decision: `sync-retry` },
            { kind: `accept` },
            { kind: `error`, decision: `sync-give-up` },
          ],
        },
      ],
      [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `hold-acceptance` },
            { kind: `up-to-date` },
            { kind: `error`, decision: `async-retry` },
            { kind: `decide` },
            { kind: `client-give-up` },
            { kind: `accept` },
          ],
        },
      ],
      ...[false, true].map((aborted): [RetryHistory] => [
        {
          wait: `full-log`,
          hasOnError: true,
          steps: [
            { kind: `demand` },
            { kind: `hold-acceptance` },
            { kind: `up-to-date` },
            ...(aborted ? [{ kind: `abort` as const }] : []),
            { kind: `accept-fails` },
          ],
        },
      ]),
    ] satisfies Array<[RetryHistory]> as Array<[RetryHistory]>,
  )

  oracleReplayTest(it)(
    `does not advance durable Electric resume metadata past a rejected row commit`,
    async () => {
      await runRejectedDurablePrefixWitness(`durable-prefix-fixed`, [
        `first`,
        `second`,
      ])
    },
  )

  oracleReplayTest(it)(
    `retains an accepted Electric source prefix when the next row commit rejects`,
    async () => {
      await runRejectedDurablePrefixWitness(
        `durable-prefix-after-success`,
        [`accepted`, `rejected`],
        true,
      )
    },
  )

  const durablePrefixArbitrary = fc.tuple(
    fc.string({ maxLength: 12 }),
    fc.string({ maxLength: 12 }),
  )
  const checkDurablePrefix = async (names: [string, string]) => {
    await runRejectedDurablePrefixWitness(
      `durable-prefix-generated-${JSON.stringify(names)}`,
      names,
    )
  }
  oracleReplayTest(fcTest).prop(
    [durablePrefixArbitrary],
    durablePrefixPropertyOptions(`fixed`),
  )(
    `a rejected initial Electric row commit creates no durable source prefix (fixed)`,
    checkDurablePrefix,
  )
  // A shared seed reseeds this random lane; a path replay selects it by property.
  oracleReplayTest(fcTest, durablePrefixProperty).prop(
    [durablePrefixArbitrary],
    durablePrefixPropertyOptions(`random`),
  )(
    `a rejected initial Electric row commit creates no durable source prefix (random)`,
    checkDurablePrefix,
  )

  oracleReplayTest(fcTest).prop(
    [
      fc.uniqueArray(fc.integer({ min: 1, max: 20 }), {
        minLength: 2,
        maxLength: 6,
      }),
    ],
    { numRuns: 20, seed: 20260922 },
  )(`append-only resume judgment rejects a missing committed row`, (ids) => {
    const events: Array<SourceLedgerEvent> = ids.map((id) => ({
      type: `source-commit`,
      offset: `${id}_0`,
      mutations: [
        {
          type: `set`,
          row: { id, name: `row-${id}`, stable: `stable-${id}` },
        },
      ],
    }))
    const expected = rowsFromMap(
      foldSourceLedgerThrough(events, events.at(-1)!.offset),
    )
    // An intermediate durable checkpoint contains exactly its source prefix.
    const prefix = rowsFromMap(
      foldSourceLedgerThrough(events, events[0]!.offset),
    )
    expect(prefix).toEqual(expected.filter(([key]) => key === ids[0]))
    // An offset outside the append-only ledger cannot justify resume state.
    expect(() => foldSourceLedgerThrough(events, `absent_0`)).toThrow(
      /absent from source ledger/,
    )
  })

  electricHistoryProperty(
    `electric.subset-request-row-validity`,
    `subset request invocation preserves row validity through generated stream histories without response delivery`,
    fc.array(
      fc.record({
        operation: fc.constantFrom<
          HistoryToken[`operation`] | `reset` | `acquire` | `deliver-subset-end`
        >(
          `insert`,
          `update`,
          `delete`,
          `reset`,
          `acquire`,
          `deliver-subset-end`,
        ),
        id: fc.integer({ min: 1, max: 3 }),
        name: fc.string({ maxLength: 8 }),
      }),
      { minLength: 1, maxLength: 40 },
    ),
    40,
    42_721,
    async (commands) => {
      const trace = createOracleCollection(
        `acquisition-history`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const reference: ReferenceState = {
        committed: new Map(),
        pending: new Map(),
      }
      let acquisition = 100
      try {
        for (const command of commands) {
          if (command.operation === `acquire`) {
            // This enters the acquisition API with a fresh disjoint predicate,
            // but the mock does not deliver response rows. Actual installed-SDK
            // delivery and overlap are in electric-sdk-delivery-oracle.property.test.ts.
            await trace.collection._sync.loadSubset({
              where: new IR.Func(`eq`, [
                new IR.PropRef([`id`]),
                new IR.Value(++acquisition),
              ]),
            })
          } else {
            const message =
              command.operation === `reset`
                ? mustRefetch
                : command.operation === `deliver-subset-end`
                  ? subsetEnd
                  : change(
                      command.operation === `insert` &&
                        reference.pending.has(command.id)
                        ? `update`
                        : command.operation,
                      command.id,
                      command.name,
                    )
            trace.subscriber([message])
            applyReferenceBatch(reference, [message])
          }
          expect(rowsFromCollection(trace.collection)).toEqual(
            rowsFromMap(reference.committed),
          )
        }
        trace.subscriber([upToDate])
        applyReferenceBatch(reference, [upToDate])
        expect(rowsFromCollection(trace.collection)).toEqual(
          rowsFromMap(reference.committed),
        )
      } finally {
        await trace.collection.cleanup()
      }
    },
    undefined,
    [
      [
        (
          [
            `insert`,
            `deliver-subset-end`,
            `reset`,
            `acquire`,
            `update`,
          ] as const
        ).map((operation) => ({ operation, id: 1, name: `` })),
      ],
    ],
  )

  electricHistoryProperty(
    `electric.resume-metadata-merge`,
    `resume metadata merge is commutative and reset-safe on timestamp ties`,
    fc.tuple(
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.boolean(),
    ),
    50,
    42_722,
    ([
      leftTimestamp,
      rightTimestamp,
      thirdTimestamp,
      leftHandle,
      rightHandle,
      thirdHandle,
      thirdIsReset,
    ]) => {
      const options = electricCollectionOptions<OracleRow>({
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
      })
      const merge = options.sync.mergeSyncMeta!
      const left = {
        version: 1,
        resume: {
          kind: `resume`,
          requiresTagState: false,
          offset: `10_0`,
          handle: leftHandle,
          shapeId,
          updatedAt: leftTimestamp,
        },
        seenTxids: [],
      }
      const right = {
        version: 1,
        resume:
          leftTimestamp === rightTimestamp && leftHandle !== rightHandle
            ? { kind: `reset`, updatedAt: rightTimestamp }
            : {
                kind: `resume`,
                requiresTagState: false,
                offset: `20_0`,
                handle: rightHandle,
                shapeId,
                updatedAt: rightTimestamp,
              },
        seenTxids: [],
      }
      const third = {
        version: 1,
        resume: thirdIsReset
          ? { kind: `reset`, updatedAt: thirdTimestamp }
          : {
              kind: `resume`,
              requiresTagState: false,
              offset: `30_0`,
              handle: thirdHandle,
              shapeId,
              updatedAt: thirdTimestamp,
            },
        seenTxids: [],
      }

      const leftThenRight = merge(left, right)
      const rightThenLeft = merge(right, left)
      expect(leftThenRight).toEqual(rightThenLeft)
      expect(merge(left, left)).toEqual(left)
      expect(merge(merge(left, right), third)).toEqual(
        merge(left, merge(right, third)),
      )
      if (leftTimestamp === rightTimestamp) {
        expect(leftThenRight).toEqual(
          expect.objectContaining({
            resume: expect.objectContaining({ kind: `reset` }),
          }),
        )
      }
    },
  )

  electricHistoryProperty(
    `electric.metadata-merge-complete-state`,
    `metadata merge preserves complete selected state and nonempty transaction evidence`,
    fc.tuple(
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 12 }),
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 12 }),
    ),
    30,
    42_723,
    ([leftTxids, rightTxids]: [Array<number>, Array<number>]) => {
      const merge = electricCollectionOptions<OracleRow>({
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
      }).sync.mergeSyncMeta!
      // Membership over an independent finite universe, not the merger's
      // concatenate/Set implementation. Duplicates cannot invent evidence.
      const union = Array.from({ length: 8 }, (_, index) => index + 1).filter(
        (txid) => leftTxids.includes(txid) || rightTxids.includes(txid),
      )
      for (const tagRequirement of [undefined, false, true]) {
        const resume = {
          kind: `resume`,
          offset: `10_0`,
          handle: `shape-1`,
          shapeId,
          updatedAt: 10,
          ...(tagRequirement === undefined
            ? {}
            : { requiresTagState: tagRequirement }),
        }
        const reset = { kind: `reset`, updatedAt: 10 }
        const newer = {
          ...resume,
          offset: `30_0`,
          handle: `shape-new`,
          shapeId: `other-shape`,
          updatedAt: 11,
        }
        const cases = [
          {
            name: `identical complete state`,
            left: resume,
            right: { ...resume },
            expected: resume,
          },
          {
            name: `newer complete state`,
            left: resume,
            right: newer,
            expected: newer,
          },
          {
            name: `newer reset`,
            left: resume,
            right: { kind: `reset`, updatedAt: 11 },
            expected: { kind: `reset`, updatedAt: 11 },
          },
          {
            name: `newer resume after reset`,
            left: reset,
            right: newer,
            expected: newer,
          },
          {
            name: `equal reset`,
            left: reset,
            right: { ...reset },
            expected: reset,
          },
          {
            name: `equal timestamp reset conflict`,
            left: resume,
            right: reset,
            expected: reset,
          },
          {
            name: `equal timestamp offset conflict`,
            left: resume,
            right: { ...resume, offset: `20_0` },
            expected: reset,
          },
          {
            name: `equal timestamp handle conflict`,
            left: resume,
            right: { ...resume, handle: `different` },
            expected: reset,
          },
          {
            name: `equal timestamp shape conflict`,
            left: resume,
            right: { ...resume, shapeId: `other-shape` },
            expected: reset,
          },
          {
            name: `only one resume`,
            left: undefined,
            right: resume,
            expected: resume,
          },
          {
            name: `no resume`,
            left: undefined,
            right: undefined,
            expected: undefined,
          },
        ]
        // Raw adapter-owned metadata policy: timestamp selection and conflict
        // reset, not a server causal-order claim. Equal-time differing tag
        // requirements are deliberately absent: their compatibility is open.
        for (const scenario of cases) {
          const left = {
            version: 1,
            seenTxids: leftTxids,
            ...(scenario.left ? { resume: scenario.left } : {}),
          }
          const right = {
            version: 1,
            seenTxids: rightTxids,
            ...(scenario.right ? { resume: scenario.right } : {}),
          }
          const expected = {
            version: 1,
            seenTxids: union,
            ...(scenario.expected ? { resume: scenario.expected } : {}),
          }
          const before = structuredClone([left, right])
          expect(merge(left, right), scenario.name).toEqual(expected)
          expect(merge(right, left), scenario.name).toEqual(expected)
          expect([left, right]).toEqual(before)
        }
      }
    },
    undefined,
    [
      [
        [
          [1, 2, 1],
          [2, 3, 2],
        ],
      ],
      [[[8], [1]]],
    ],
  )

  oracleReplayTest(it)(
    `reconstructs persistence-interleaving campaigns and rejects ablated, out-of-range, and foreign histories`,
    () => {
      const campaigns = fc.sample(persistenceInterleavingCampaignArbitrary, {
        seed: 18_530_601,
        numRuns: 20,
      })
      for (const campaign of campaigns) {
        expect(reconstructPersistenceInterleavingCampaign(campaign)).toEqual(
          campaign,
        )
        expect(() =>
          reconstructPersistenceInterleavingCampaign({
            names: campaign.names,
          }),
        ).toThrow()
        expect(() =>
          reconstructPersistenceInterleavingCampaign({
            histories: campaign.histories,
          }),
        ).toThrow()
        expect(() =>
          reconstructPersistenceInterleavingCampaign({
            ...campaign,
            histories: [`open-transaction-hydration`, `foreign`],
          }),
        ).toThrow()
        expect(() =>
          reconstructPersistenceInterleavingCampaign({
            ...campaign,
            names: [``, campaign.names[1]],
          }),
        ).toThrow()
      }
    },
  )

  oracleReplayTest(it)(
    `rejects named wrong answers for persistence interleavings`,
    () => {
      const names: [string, string] = [`before`, `after`]
      expect(() =>
        expectPersistenceInterleavingObservation(
          {
            kind: `open-transaction-hydration`,
            hydrationStartedBeforeCommit: true,
            hydrationOutcomeBeforeRelease: `AbortError`,
            cachedRowBeforeRelease: true,
            hydrationOutcome: `fulfilled`,
            publicRowsAtHydrationSettlement: [],
            deliveryErrors: [`InvalidPersistedCollectionConfigError`],
            publicRows: [],
            durableRows: [],
            status: `ready`,
            publicError: undefined,
          },
          names,
        ),
      ).toThrow()
      expect(() =>
        expectPersistenceInterleavingObservation(
          {
            kind: `subset-supersedes-absence`,
            publicRows: [],
            durableRows: [],
            status: `ready`,
            publicError: undefined,
          },
          names,
        ),
      ).toThrow()
    },
  )

  oracleReplayTest(fcTest).prop([persistenceInterleavingCampaignArbitrary], {
    seed: 18_530_601,
    numRuns: oracleRuns(4),
  })(
    `preserves persisted Electric interleavings (fixed)`,
    runPersistenceInterleavingCampaign,
  )
})

// Each campaign's random lane has its own suite. An ordinary run runs it
// beside the adapter laws. A path replay of its property runs only it.
oracleReplayTest(describe, persistenceInterleavingProperty)(
  `persisted Electric interleaving campaign`,
  () => {
    beforeEach(resetElectricOracleMocks)

    fcTest.prop(
      [persistenceInterleavingCampaignArbitrary],
      oraclePropertyOptions(4, persistenceInterleavingProperty),
    )(
      `preserves persisted Electric interleavings (random)`,
      runPersistenceInterleavingCampaign,
    )
  },
)

oracleReplayTest(describe, queuedPresenceProperty)(
  `Electric queued-presence campaign`,
  () => {
    beforeEach(resetElectricOracleMocks)

    fcTest.prop(
      queuedPresenceArbitraries,
      queuedPresencePropertyOptions(`random`),
    )(
      `generated queued Electric histories preserve staged presence and reset fences (random)`,
      runQueuedPresenceCampaign,
    )
  },
)

// The checks run a history through production and compare each observation
// with the model (or the authored snapshots they are given). The models are
// independent folds of the same histories. The grammar generates the queued
// presence and persistence interleaving campaigns.
declareOracle({
  check: [
    checkMutationConfirmation,
    runProcessGrammar,
    runQueuedPresenceCampaign,
    expectQueuedPresenceAtDurabilityHold,
    checkInitialMoveOut,
    runRejectedDurablePrefixWitness,
    runPublicationBeforePersistenceWitness,
    runPersistenceFailureCrashOnlyWitness,
    assertPublicationEpochHistory,
    runSchedulerPermutation,
    runPersistenceInterleavingCampaign,
    expectPersistenceInterleavingObservation,
  ],
  model: [
    expectedSnapshots,
    recomputeCommittedRows,
    recomputedSnapshots,
    expectedQueuedPresenceRows,
    foldSourceLedgerThrough,
    isSdkResetFramedPartition,
    applyReferenceBatch,
    createRetryModel,
    applyRetryModel,
    expectedRetryObservation,
    expectedInitialMoveOutSnapshots,
  ],
  grammar: [
    queuedPresenceArbitraries,
    persistenceInterleavingCampaignArbitrary,
  ],
})
