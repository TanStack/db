import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  BasicIndex,
  DbClient,
  IR,
  NoPendingSyncTransactionCommitError,
  NoPendingSyncTransactionWriteError,
  SyncTransactionAbortedError,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
  eq,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  PersistedCollectionDurabilityError,
  persistedCollectionOptions,
} from '../src'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  assertGenerationNoticeHistory,
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  configureHydrationScope,
  createCoordinatorHarness,
  createDeferred,
  createEventGate,
  createFollowerTab,
  createRecordingAdapter,
  describeUnlessAnyOracleReplay,
  describeUnlessOracleReplay,
  expectExactSnapshot,
  expectHydrationReceiptsPending,
  flushAsyncWork,
  generationNoticeHistory,
  hydrationScopeModes,
  installHydrationRoutingProbe,
  itUnlessAnyOracleReplay,
  observeSettlement,
  overrideBaselineRows,
  recordedStorageId,
  stripVirtualProps,
  within,
} from './persisted-support'
import type {
  PersistedCollectionCoordinator,
  PersistedStorageTarget,
  PersistedTx,
  PersistenceAdapter,
  ProtocolEnvelope,
  TxCommitted,
} from '../src'
import type { Collection, LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type {
  FollowerRemoteDemandHistory,
  FollowerRow,
  Todo,
  TodoSyncParams,
} from './persisted-support'

/**
 * # Does persisted wrapping preserve one Collection history?
 *
 * RFC #1659 invariant 7 requires each accepted sync transaction to become
 * durable, remain replayable, or fail through an observable channel.
 * Persistence adds a durable replica beneath an optional upstream sync source.
 * Startup hydrates rows and metadata, buffers concurrent source work, then
 * publishes one coherent public snapshot. Complete committed transactions
 * route through the configured collection owner. Publication precedes
 * durability, but a rejected durability boundary must reject its wrapped sync
 * receipt and fail-stop that sync run without admitting a suffix.
 * An indeterminate coordinator response can be reconciled only by a replacement
 * leader that certifies the exact source transaction under its writer lock.
 * The source receipt remains pending through that check, then fulfills if the
 * transaction was already durable or was proved absent and durably applied.
 * The Collection and its dependent live queries keep the same sync run. An
 * uncertified outcome and other durability failures remain terminal.
 * Accepted sync transactions from the sync adapter take precedence over older
 * persisted rows. Reading those rows for a subset demand or a coordinator
 * notification may delay publication, but cannot revoke acceptance. Truncate
 * replay replaces earlier source rows; later sync transactions apply to that
 * replacement. The queued and completed persistence reads in this file are
 * compared with the same independent snapshot algebra.
 * Buffered hydration transactions retain the row metadata ownership captured
 * from their original persistence read.
 * A source abort before core application rejects that transaction's receipt.
 * It does not invalidate the durable baseline or an independent queued source
 * transaction when the failed transaction made no public or durable change.
 * Recovery reacquires active subsets, current index declarations, and a renewal
 * timer after the source restarts.
 * A retired source sync cannot publish new remote subset ownership.
 *
 * `foldDurabilityLedger` is the independent model for append-only source
 * obligations. The recording adapter in persisted-support.ts is a plain
 * durable-state model: Maps for rows and metadata plus ordered transaction,
 * index, load, and reload calls. Histories cross hydration, held adapters,
 * source FIFO ordering, independent/dependent aborts, open-transaction failure
 * boundaries, ambient owner operations, remote subset demand, follower rotation
 * and scoped recovery, queued startup reloads, and on-demand evidence. Tests
 * drive the real persisted wrapper, Collection, coordinator, adapter,
 * transactions, indexes, and local mutation path.
 *
 * Refinement checkpoints compare public rows, durable state, metadata, request
 * data, sequence evidence, exact errors, and late-work fencing. Fixed hostile
 * values challenge wire admission. Controlled failures challenge publication
 * and durability classification. Fixed witnesses and bounded schedule tables
 * preserve known failure paths, while omission and reordering controls
 * challenge the model's judgment. Focused Browser and Electron suites own the
 * multiprocess transport and host-specific replay partitions.
 *
 * Known omissions: driver SQL behavior, native host ownership, and the shared
 * conformance portfolio have separate owners. This file proves the role
 * partition for non-single-process remote demand: an ownerless elected node
 * does not route, while a follower may route to the elected owner's registered
 * source. During scoped recovery a follower takes a current-generation commit
 * notice from the elected owner as source evidence and publishes its demanded
 * durable rows; a notice from any other sender still requests a refetch. Native
 * SQLite hosts, live Electric service behavior, adapter cancellation, and the
 * open B2-failure/E4 schedule remain separate evidence.
 *
 * Fixed scenarios that once lived in this file are ordinary tests in
 * persisted.test.ts, persisted-startup.test.ts, persisted-subset.test.ts,
 * persisted-source-receipts.test.ts, persisted-hydration-queue.test.ts,
 * persisted-reload-metadata.test.ts, persisted-demand.test.ts,
 * persisted-follower-indexes.test.ts, persisted-cache-claims.test.ts,
 * persisted-reset-startup.test.ts, persisted-hydration-scope.test.ts,
 * persisted-reconciliation.test.ts, and persisted-cleanup.test.ts. They keep
 * their titles and literal expectations and are not oracle evidence.
 */

// A complete durable row is a value, including its exact set of fields. The
// model deliberately uses only Maps and authored input rows; it does not
// classify production sync writes or copy their update/replace algorithm.
// Active complete demand admits every durable key. Without demand, a notice
// may validate previously public keys, but cannot publish an unseen key.
// DbClient hydration seeds remain source-owned until confirmed by the source.
// Other rows in this model came from an earlier durable read; accepted source
// rows belong to the separate source-precedence model below. Copy authored
// values so a subject mutation cannot alter the expected result by aliasing.
function expectedScopedSnapshot(
  previouslyPublic: ReadonlyMap<string, Todo>,
  durable: ReadonlyMap<string, Todo>,
  protectedSeeds: ReadonlyMap<string, Todo>,
  completeDemand: boolean,
): Map<string, Todo> {
  const expected = completeDemand
    ? new Map(
        Array.from(
          durable,
          ([key, row]) => [key, structuredClone(row)] as const,
        ),
      )
    : new Map(
        Array.from(previouslyPublic.keys())
          .filter((key) => durable.has(key))
          .map((key) => [key, structuredClone(durable.get(key)!)] as const),
      )
  for (const [key, row] of protectedSeeds)
    expected.set(key, structuredClone(row))
  return expected
}

// Targeted notices are changes to the durable relation, not complete rows in
// the message. An active predicate admits the durable rows it matches; after
// demand retirement, only keys that were public remain eligible for checking.
// This simple title predicate is the model's authored scope, independent of
// the production predicate compiler and targeted-invalidation classifier.
function expectedTargetedSnapshot(
  previouslyPublic: ReadonlyMap<string, Todo>,
  durable: ReadonlyMap<string, Todo>,
  activeTitle: string | undefined,
): Map<string, Todo> {
  return new Map(
    Array.from(durable)
      .filter(([key, row]) =>
        activeTitle === undefined
          ? previouslyPublic.has(key)
          : row.title === activeTitle,
      )
      .map(([key, row]) => [key, structuredClone(row)] as const),
  )
}

const persistedKeySetEvidenceStatuses = [
  `consistent`,
  `unknown`,
  `incompatible`,
] as const

type OnDemandEvidenceObservation = {
  status: (typeof persistedKeySetEvidenceStatuses)[number]
  route: `loadSubset` | `forceReloadSubset`
  baselineVisible: boolean | `not-observed`
  onDemandVisible: boolean
}

function expectOnDemandEvidenceLaw(
  observation: OnDemandEvidenceObservation,
): void {
  try {
    expect(observation).toEqual({
      status: observation.status,
      route: observation.route,
      baselineVisible:
        observation.route === `loadSubset`
          ? observation.status !== `incompatible`
          : `not-observed`,
      onDemandVisible: true,
    })
  } catch (cause) {
    throw new Error(
      `on-demand rows must not inherit baseline evidence rejection`,
      { cause },
    )
  }
}

type DurabilityLedgerEvent =
  | { type: `begin`; transactionId: string }
  | { type: `write`; transactionId: string; row: Todo }
  | { type: `commit`; transactionId: string }
  | { type: `abort`; transactionId: string }

// RFC #1659 durability law: a source commit remains one append-only obligation
// across a persistence hydration boundary. The independent fold deliberately
// has no hydration phase, queue, generation, or production transaction helper.
// These fixtures exercise the core adapter contract with in-memory storage;
// they do not claim native SQLite host or device execution.
function foldDurabilityLedger(events: ReadonlyArray<DurabilityLedgerEvent>): {
  committedRows: Map<string, Todo>
  commitOrder: Array<string>
} {
  const open = new Map<string, Array<Todo>>()
  const committedRows = new Map<string, Todo>()
  const commitOrder: Array<string> = []

  for (const event of events) {
    if (event.type === `begin`) {
      open.set(event.transactionId, [])
    } else if (event.type === `write`) {
      open.get(event.transactionId)?.push(structuredClone(event.row))
    } else if (event.type === `abort`) {
      open.delete(event.transactionId)
    } else {
      const rows = open.get(event.transactionId)
      if (!rows) continue
      for (const row of rows) committedRows.set(row.id, row)
      commitOrder.push(event.transactionId)
      open.delete(event.transactionId)
    }
  }

  return { committedRows, commitOrder }
}

let generatedOwnershipHistoryId = 0

function sortedTodoRows(rows: Iterable<Todo>): Array<Todo> {
  return Array.from(rows).sort((left, right) => left.id.localeCompare(right.id))
}

type SourceFifoOrderingObservation = {
  publicRows: Array<Todo>
  durableRows: Array<Todo>
  status: string
  pendingMarkers: number
}

function expectSourceFifoOrderingObservation(
  actual: SourceFifoOrderingObservation,
  expectedRows: ReadonlyArray<Todo>,
): void {
  expect(actual).toEqual({
    publicRows: expectedRows,
    durableRows: expectedRows,
    status: `ready`,
    pendingMarkers: 0,
  })
}

type AbortGraphObservation = {
  predecessorStatus: `fulfilled` | `rejected`
  predecessorName: string | undefined
  successorStatus: `fulfilled` | `rejected`
  sameFailure: boolean
  status: string
  publicSuccessor: Todo | undefined
  durableSuccessor: Todo | undefined
  pendingMarkers: number
}

function expectAbortGraphObservation(
  actual: AbortGraphObservation,
  relationship: `independent` | `same-key`,
  successorKey: string,
  successorTitle: string,
): void {
  expect(actual).toEqual(
    relationship === `same-key`
      ? {
          predecessorStatus: `rejected`,
          predecessorName: `AbortError`,
          successorStatus: `rejected`,
          sameFailure: true,
          status: `crashed`,
          publicSuccessor: undefined,
          durableSuccessor: undefined,
          pendingMarkers: 0,
        }
      : {
          predecessorStatus: `rejected`,
          predecessorName: `AbortError`,
          successorStatus: `fulfilled`,
          sameFailure: false,
          status: `ready`,
          publicSuccessor: { id: successorKey, title: successorTitle },
          durableSuccessor: { id: successorKey, title: successorTitle },
          pendingMarkers: 0,
        },
  )
}

type OwnerIsolationAdmissionObservation = {
  exactError: boolean
  strayVisible: boolean
}

function expectOwnerIsolationAdmission(
  actual: OwnerIsolationAdmissionObservation,
): void {
  expect(actual).toEqual({ exactError: true, strayVisible: false })
}

type OpenTransactionBoundaryObservation = {
  status: string
  pendingMarkers: number
}

type RequestLocalFailureObservation = {
  receiptStatus: `pending` | `fulfilled` | `rejected`
  publicRows: Array<Todo>
  durableRows: Array<Todo>
  status: string
  publicError: unknown
}

function expectOpenTransactionBoundaryObservation(
  actual: OpenTransactionBoundaryObservation,
  boundary: `abort` | `cleanup` | `terminal-failure`,
): void {
  expect(actual).toEqual({
    status:
      boundary === `cleanup`
        ? `cleaned-up`
        : boundary === `abort`
          ? `ready`
          : `crashed`,
    pendingMarkers: 0,
  })
}

function expectRequestLocalFailureObservation(
  actual: RequestLocalFailureObservation,
  expectedRows: ReadonlyArray<Todo>,
): void {
  expect(actual).toEqual({
    receiptStatus: `fulfilled`,
    publicRows: expectedRows,
    durableRows: expectedRows,
    status: `ready`,
    publicError: undefined,
  })
}

async function runSourceFifoOrderingLaw(
  relation: `same-key` | `disjoint`,
  olderTitle: string,
  newerTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const adapter = createRecordingAdapter()
  const firstPersistenceEntered = createEventGate()
  const releaseFirstPersistence = createEventGate()
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  let applyCalls = 0
  adapter.applyCommittedTx = async (...args) => {
    applyCalls++
    if (applyCalls === 1) {
      firstPersistenceEntered.resolve()
      await releaseFirstPersistence.promise
    }
    await applyCommittedTx(...args)
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-source-fifo-order-${historyId}`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          sourceParams = params
          params.markReady()
        },
      },
      persistence: { adapter },
    }),
  )
  const receipts: Array<Promise<void>> = []
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated source FIFO ordering ready`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `gate`, title: `holds adapter` },
    })
    receipts.push(Promise.resolve(sourceParams.commit()).then(() => undefined))
    receipts.forEach((receipt) => void receipt.catch(() => undefined))
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `generated source FIFO ordering adapter hold`,
    )

    const olderKey = relation === `same-key` ? `shared` : `older`
    const newerKey = relation === `same-key` ? `shared` : `newer`

    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: olderKey, title: olderTitle },
    })
    const olderReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(olderReceipt)
    void olderReceipt.catch(() => undefined)

    sourceParams.begin()
    sourceParams.write({
      type: relation === `same-key` ? `update` : `insert`,
      value: { id: newerKey, title: newerTitle },
    })
    const newerReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(newerReceipt)
    void newerReceipt.catch(() => undefined)

    expect(
      sortedTodoRows(Array.from(collection.values()).map(stripVirtualProps)),
    ).toEqual(sortedTodoRows([{ id: `gate`, title: `holds adapter` }]))

    releaseFirstPersistence.resolve()
    for (const [index, receipt] of receipts.entries()) {
      await atPersistedOracleCheckpoint(
        receipt,
        `generated source FIFO receipt ${index}`,
      )
    }
    expectSourceFifoOrderingObservation(
      {
        publicRows: sortedTodoRows(
          Array.from(collection.values()).map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(adapter.rows.values()),
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      },
      sortedTodoRows(
        expectedSourceFifoOrderingRows(
          relation,
          olderTitle,
          newerTitle,
        ).values(),
      ),
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

// Source FIFO ordering law: the gate write holds the adapter, then the older
// and newer source writes commit in submission order. The final rows are the
// gate plus both writes, and a newer write to the same key replaces the older.
// The model takes only the relation and titles, not the production write path.
function expectedSourceFifoOrderingRows(
  relation: `same-key` | `disjoint`,
  olderTitle: string,
  newerTitle: string,
): Map<string, Todo> {
  const olderKey = relation === `same-key` ? `shared` : `older`
  const newerKey = relation === `same-key` ? `shared` : `newer`
  const expected = new Map<string, Todo>([
    [`gate`, { id: `gate`, title: `holds adapter` }],
  ])
  expected.set(olderKey, { id: olderKey, title: olderTitle })
  expected.set(newerKey, { id: newerKey, title: newerTitle })
  return expected
}

async function runAbortRelationshipLaw(
  relationship: `independent` | `same-key`,
  predecessorTitle: string,
  successorTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const adapter = createRecordingAdapter()
  const firstPersistenceEntered = createEventGate()
  const releaseFirstPersistence = createEventGate()
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  let applyCalls = 0
  adapter.applyCommittedTx = async (...args) => {
    applyCalls++
    if (applyCalls === 1) {
      firstPersistenceEntered.resolve()
      await releaseFirstPersistence.promise
    }
    await applyCommittedTx(...args)
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-abort-graph-${historyId}`,
      getKey: (row) => row.id,
      sync: {
        rowUpdateMode: `partial`,
        sync: (params) => {
          sourceParams = params
          params.markReady()
        },
      },
      persistence: { adapter },
    }),
  )
  const abortController = new AbortController()
  const receipts: Array<Promise<void>> = []
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated abort graph ready`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `gate`, title: `holds adapter` },
    })
    const gateReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(gateReceipt)
    void gateReceipt.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `generated abort graph adapter hold`,
    )

    const predecessorKey = relationship === `same-key` ? `shared` : `aborted`
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: {
        id: predecessorKey,
        title: predecessorTitle,
        detail: `predecessor-only`,
      },
    })
    const predecessorReceipt = Promise.resolve(
      sourceParams.commit(abortController.signal),
    ).then(() => undefined)
    receipts.push(predecessorReceipt)
    void predecessorReceipt.catch(() => undefined)

    const successorKey = relationship === `same-key` ? `shared` : `survivor`
    sourceParams.begin()
    sourceParams.write({
      type: relationship === `same-key` ? `update` : `insert`,
      value: { id: successorKey, title: successorTitle },
    })
    const successorReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(successorReceipt)
    void successorReceipt.catch(() => undefined)

    abortController.abort()
    releaseFirstPersistence.resolve()
    await atPersistedOracleCheckpoint(gateReceipt, `generated abort gate`)
    const predecessor = await atPersistedOracleCheckpoint(
      predecessorReceipt.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `generated predecessor abort`,
    )
    const successor = await atPersistedOracleCheckpoint(
      successorReceipt.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      ),
      `generated successor settlement`,
    )
    const abortError =
      predecessor.status === `rejected` ? predecessor.reason : undefined

    expectAbortGraphObservation(
      {
        predecessorStatus: predecessor.status,
        predecessorName:
          abortError instanceof Error ? abortError.name : undefined,
        successorStatus: successor.status,
        sameFailure:
          successor.status === `rejected` && successor.reason === abortError,
        status: collection.status,
        publicSuccessor: stripVirtualProps(collection.get(successorKey)),
        durableSuccessor: adapter.rows.get(successorKey),
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      },
      relationship,
      successorKey,
      successorTitle,
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

async function runBareOwnerOperationLaw(
  operation: `write` | `commit` | `truncate`,
  queuedTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const adapter = createRecordingAdapter()
  const firstPersistenceEntered = createEventGate()
  const releaseFirstPersistence = createEventGate()
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  let applyCalls = 0
  adapter.applyCommittedTx = async (...args) => {
    applyCalls++
    if (applyCalls === 1) {
      firstPersistenceEntered.resolve()
      await releaseFirstPersistence.promise
    }
    await applyCommittedTx(...args)
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-owner-isolation-${historyId}`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          sourceParams = params
          params.markReady()
        },
      },
      persistence: { adapter },
    }),
  )
  const receipts: Array<Promise<void>> = []
  let unexpectedReceipt: Promise<void> | undefined
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated owner isolation ready`,
    )
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `first`, title: `must survive` },
    })
    const firstReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(firstReceipt)
    void firstReceipt.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      firstPersistenceEntered.promise,
      `generated owner isolation adapter hold`,
    )

    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `queued`, title: queuedTitle },
    })
    const queuedReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(queuedReceipt)
    void queuedReceipt.catch(() => undefined)

    let observedError: unknown
    try {
      if (operation === `write`) {
        sourceParams.write({
          type: `insert`,
          value: { id: `stray`, title: `must not publish` },
        })
      } else if (operation === `truncate`) {
        sourceParams.truncate()
      } else {
        const result = sourceParams.commit()
        if (result !== true) {
          unexpectedReceipt = Promise.resolve(result).then(() => undefined)
          void unexpectedReceipt.catch(() => undefined)
        }
      }
    } catch (error) {
      observedError = error
    }
    expectOwnerIsolationAdmission({
      exactError:
        operation === `commit`
          ? observedError instanceof NoPendingSyncTransactionCommitError
          : observedError instanceof NoPendingSyncTransactionWriteError,
      strayVisible: collection.has(`stray`),
    })

    releaseFirstPersistence.resolve()
    await atPersistedOracleCheckpoint(firstReceipt, `generated first owner`)
    await atPersistedOracleCheckpoint(queuedReceipt, `generated queued owner`)
    expect({
      publicRows: sortedTodoRows(
        Array.from(collection.values()).map(stripVirtualProps),
      ),
      durableRows: sortedTodoRows(adapter.rows.values()),
      pendingMarkers: collection._state.pendingSyncedTransactions.length,
    }).toEqual({
      publicRows: sortedTodoRows([
        { id: `first`, title: `must survive` },
        { id: `queued`, title: queuedTitle },
      ]),
      durableRows: sortedTodoRows([
        { id: `first`, title: `must survive` },
        { id: `queued`, title: queuedTitle },
      ]),
      pendingMarkers: 0,
    })
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstPersistence.resolve()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => unexpectedReceipt?.catch(() => undefined),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

async function runInternalOpenTransactionBoundaryLaw(
  boundary: `abort` | `cleanup` | `terminal-failure`,
  hydratedTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const hydrated = { id: `hydrated`, title: hydratedTitle }
  const adapter = createRecordingAdapter([hydrated])
  const hydrationEntered = createEventGate()
  const releaseHydration = createEventGate()
  overrideBaselineRows(adapter, async () => {
    hydrationEntered.resolve()
    await releaseHydration.promise
    return [{ key: hydrated.id, value: hydrated }]
  })
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-internal-transaction-${historyId}`,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          sourceParams = params
          params.markReady()
        },
      },
      persistence: { adapter },
    }),
  )
  let internalReservationStarted = false
  const subscription = collection.subscribeChanges((changes) => {
    if (
      !internalReservationStarted &&
      changes.some((change) => change.key === hydrated.id)
    ) {
      internalReservationStarted = true
      sourceParams.begin()
    }
  })
  const receipts: Array<Promise<void>> = []
  let cleanedUp = false
  let hasPrimaryFailure = false

  try {
    const ready = collection.stateWhenReady()
    await atPersistedOracleCheckpoint(
      hydrationEntered.promise,
      `generated internal hydration entered`,
    )
    releaseHydration.resolve()
    await atPersistedOracleCheckpoint(ready, `generated internal ready`)
    expect({
      internalReservationStarted,
      pendingMarkers: collection._state.pendingSyncedTransactions.length,
    }).toEqual({ internalReservationStarted: true, pendingMarkers: 0 })

    if (boundary === `cleanup`) {
      await atPersistedOracleCheckpoint(
        collection.cleanup(),
        `generated internal cleanup`,
      )
      cleanedUp = true
      expectOpenTransactionBoundaryObservation(
        {
          status: collection.status,
          pendingMarkers: collection._state.pendingSyncedTransactions.length,
        },
        boundary,
      )
      return
    }

    if (boundary === `abort`) {
      const abortController = new AbortController()
      abortController.abort()
      const receipt = Promise.resolve(
        sourceParams.commit(abortController.signal),
      ).then(() => undefined)
      receipts.push(receipt)
      void receipt.catch(() => undefined)
      await expect(
        atPersistedOracleCheckpoint(receipt, `generated internal abort`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expectOpenTransactionBoundaryObservation(
        {
          status: collection.status,
          pendingMarkers: collection._state.pendingSyncedTransactions.length,
        },
        boundary,
      )
      return
    }

    const terminalError = new Error(`generated terminal transaction failure`)
    adapter.applyCommittedTx = () => Promise.reject(terminalError)
    sourceParams.begin()
    sourceParams.write({
      type: `insert`,
      value: { id: `terminal`, title: `published before failure` },
    })
    const externalReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(externalReceipt)
    void externalReceipt.catch(() => undefined)
    await expect(
      atPersistedOracleCheckpoint(
        externalReceipt,
        `generated external terminal failure`,
      ),
    ).rejects.toMatchObject({
      name: `PersistedCollectionDurabilityError`,
      cause: terminalError,
    })

    const internalReceipt = Promise.resolve(sourceParams.commit()).then(
      () => undefined,
    )
    receipts.push(internalReceipt)
    void internalReceipt.catch(() => undefined)
    await expect(
      atPersistedOracleCheckpoint(
        internalReceipt,
        `generated terminal internal settlement`,
      ),
    ).rejects.toMatchObject({ name: `PersistedCollectionDurabilityError` })
    expectOpenTransactionBoundaryObservation(
      {
        status: collection.status,
        pendingMarkers: collection._state.pendingSyncedTransactions.length,
      },
      boundary,
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseHydration.resolve()
    subscription.unsubscribe()
    await cleanupPersistedOracle(
      [
        ...receipts.map((receipt) => () => receipt.catch(() => undefined)),
        () => (cleanedUp ? undefined : collection.cleanup()),
      ],
      hasPrimaryFailure,
    )
  }
}

type RequestLocalFailureOperation = `partial-update` | `delete` | `insert`

async function runRequestLocalFailureOperationLaw(
  operation: RequestLocalFailureOperation,
  baselineTitle: string,
  sourceTitle: string,
): Promise<void> {
  const historyId = ++generatedOwnershipHistoryId
  const baseline: Todo = {
    id: `shared`,
    title: baselineTitle,
    detail: `required baseline detail`,
  }
  const inserted: Todo = {
    id: baseline.id,
    title: sourceTitle,
    detail: `complete insert detail`,
  }
  const adapter = createRecordingAdapter(
    operation === `insert` ? [] : [baseline],
  )
  const loadPersistedRows = adapter.loadSubset.bind(adapter)
  const loadEntered = createEventGate()
  const rejectLoad = createEventGate()
  const loadFailure = new Error(
    `generated request-local ${operation} load failure`,
  )
  let loadCalls = 0
  adapter.loadSubset = async (...args) => {
    loadCalls++
    if (loadCalls === 1) {
      loadEntered.resolve()
      await rejectLoad.promise
      throw loadFailure
    }
    return loadPersistedRows(...args)
  }
  let sourceParams!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `generated-request-local-failure-${historyId}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        rowUpdateMode: `partial`,
        sync: (params) => {
          sourceParams = params
          params.markReady()
          return { loadSubset: () => true }
        },
      },
      persistence: { adapter },
    }),
  )
  const expectedRows =
    operation === `delete`
      ? []
      : operation === `insert`
        ? [inserted]
        : [{ ...baseline, title: sourceTitle }]
  let load: Promise<void> | undefined
  let receipt: Promise<void> | undefined
  let hasPrimaryFailure = false

  try {
    await atPersistedOracleCheckpoint(
      collection.stateWhenReady(),
      `generated request-local collection ready`,
    )
    load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
      () => undefined,
    )
    void load.catch(() => undefined)
    await atPersistedOracleCheckpoint(
      loadEntered.promise,
      `generated request-local load entered`,
    )

    sourceParams.begin()
    sourceParams.write(
      operation === `delete`
        ? { type: `delete`, key: baseline.id }
        : operation === `insert`
          ? { type: `insert`, value: inserted }
          : {
              type: `update`,
              value: { id: baseline.id, title: sourceTitle } as Todo,
            },
    )
    receipt = Promise.resolve(sourceParams.commit()).then(() => undefined)
    const receiptState = observeSettlement(receipt)
    expect(receiptState.read()).toEqual({ status: `pending` })

    rejectLoad.resolve()
    await expect(
      atPersistedOracleCheckpoint(load, `generated request-local rejection`),
    ).rejects.toBe(loadFailure)
    await atPersistedOracleCheckpoint(
      receipt,
      `generated request-local receipt settlement`,
    )
    expectRequestLocalFailureObservation(
      {
        receiptStatus: receiptState.read().status,
        publicRows: sortedTodoRows(
          [...collection.values()].map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(adapter.rows.values()),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      },
      expectedRows,
    )

    await atPersistedOracleCheckpoint(
      Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
      `generated request-local retry`,
    )
    expectRequestLocalFailureObservation(
      {
        receiptStatus: receiptState.read().status,
        publicRows: sortedTodoRows(
          [...collection.values()].map(stripVirtualProps),
        ),
        durableRows: sortedTodoRows(adapter.rows.values()),
        status: collection.status,
        publicError: collection._lifecycle.getSyncError(),
      },
      expectedRows,
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    rejectLoad.resolve()
    await cleanupPersistedOracle(
      [
        () => load?.catch(() => undefined),
        () => receipt?.catch(() => undefined),
        () => collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

type GeneratedPersistenceHistory = {
  axes: Array<string>
  titles: Array<string>
}

type GeneratedPersistenceGrammar = {
  property: string
  axes: ReadonlyArray<string>
  axisContribution: Readonly<Record<string, string>>
  titleCount: number
  witness: GeneratedPersistenceHistory
}

const sourceFifoOrderingAxes = [`same-key`, `disjoint`] as const
const abortGraphAxes = [`independent`, `same-key`] as const
const ownerIsolationAxes = [`write`, `commit`, `truncate`] as const
const openTransactionBoundaryAxes = [
  `abort`,
  `cleanup`,
  `terminal-failure`,
] as const
const requestLocalFailureAxes = [`partial-update`, `delete`, `insert`] as const
const generatedTitleMaxLength = 12
const generatedPersistenceFixedSeeds = {
  sourceFifoOrdering: 18_530_101,
  abortGraph: 18_530_102,
  ownerIsolation: 18_530_103,
  openTransactionBoundary: 18_530_104,
  requestLocalFailure: 18_530_105,
} as const

const generatedPersistenceGrammars: ReadonlyArray<GeneratedPersistenceGrammar> =
  [
    {
      property: `sqlite-persistence.source-fifo-order`,
      axes: sourceFifoOrderingAxes,
      axisContribution: {
        [`same-key`]: `the later source value wins in source order`,
        disjoint: `both unrelated values and receipts survive`,
      },
      titleCount: 2,
      witness: {
        axes: [`same-key`, `disjoint`],
        titles: [`older`, `newer`],
      },
    },
    {
      property: `sqlite-persistence.abort-graph`,
      axes: abortGraphAxes,
      axisContribution: {
        independent: `an unrelated sibling survives the abort`,
        [`same-key`]: `a dependent suffix shares the predecessor failure`,
      },
      titleCount: 2,
      witness: {
        axes: [`independent`, `same-key`],
        titles: [`predecessor`, `successor`],
      },
    },
    {
      property: `sqlite-persistence.owner-isolation`,
      axes: ownerIsolationAxes,
      axisContribution: {
        write: `bare write rejects without publishing a stray row`,
        commit: `bare commit rejects without settling another owner`,
        truncate: `bare truncate rejects without clearing another owner`,
      },
      titleCount: 1,
      witness: {
        axes: [`write`, `commit`, `truncate`],
        titles: [`queued`],
      },
    },
    {
      property: `sqlite-persistence.open-transaction-boundary`,
      axes: openTransactionBoundaryAxes,
      axisContribution: {
        abort: `explicit abort leaves no core transaction`,
        cleanup: `cleanup leaves no core transaction`,
        [`terminal-failure`]: `fail-stop leaves no core transaction`,
      },
      titleCount: 1,
      witness: {
        axes: [`abort`, `cleanup`, `terminal-failure`],
        titles: [`hydrated`],
      },
    },
    {
      property: `sqlite-persistence.request-local-failure-buffered-source`,
      axes: requestLocalFailureAxes,
      axisContribution: {
        [`partial-update`]: `an unseen persisted baseline is reconstructed`,
        delete: `a buffered delete settles without resurrection`,
        insert: `a complete buffered insert settles without duplication`,
      },
      titleCount: 2,
      witness: {
        axes: [`partial-update`, `delete`, `insert`],
        titles: [`baseline`, `source`],
      },
    },
  ]

function reconstructGeneratedPersistenceHistory(
  grammar: GeneratedPersistenceGrammar,
  history: GeneratedPersistenceHistory,
): GeneratedPersistenceHistory {
  const requiredAxes = new Set(grammar.axes)
  const axesAreExact =
    history.axes.length === grammar.axes.length &&
    new Set(history.axes).size === grammar.axes.length &&
    history.axes.every((axis) => requiredAxes.has(axis))
  const titlesAreInRange =
    history.titles.length === grammar.titleCount &&
    history.titles.every(
      (title) => [...title].length <= generatedTitleMaxLength,
    )
  if (!axesAreExact || !titlesAreInRange) {
    throw new Error(
      `invalid generated persistence history: ${grammar.property}`,
    )
  }
  return {
    axes: [...history.axes],
    titles: [...history.titles],
  }
}

function fullAxisOrder<Axis extends string>(
  axes: ReadonlyArray<Axis>,
): fc.Arbitrary<Array<Axis>> {
  return fc.shuffledSubarray([...axes], {
    minLength: axes.length,
    maxLength: axes.length,
  })
}

const generatedTitle = fc.string({ maxLength: generatedTitleMaxLength })

type SourceFifoOrderingHistory = {
  relations: Array<`same-key` | `disjoint`>
  titles: [string, string]
}

type AbortGraphHistory = {
  relationships: Array<`independent` | `same-key`>
  titles: [string, string]
}

type OwnerIsolationHistory = {
  operations: Array<`write` | `commit` | `truncate`>
  queuedTitle: string
}

type OpenTransactionBoundaryHistory = {
  boundaries: Array<`abort` | `cleanup` | `terminal-failure`>
  hydratedTitle: string
}

type RequestLocalFailureHistory = {
  operations: Array<RequestLocalFailureOperation>
  titles: [string, string]
}

const sourceFifoOrderingHistory: fc.Arbitrary<SourceFifoOrderingHistory> =
  fc.record({
    relations: fullAxisOrder(sourceFifoOrderingAxes),
    titles: fc.tuple(generatedTitle, generatedTitle),
  })

const abortGraphHistory: fc.Arbitrary<AbortGraphHistory> = fc.record({
  relationships: fullAxisOrder(abortGraphAxes),
  titles: fc.tuple(generatedTitle, generatedTitle),
})

const ownerIsolationHistory: fc.Arbitrary<OwnerIsolationHistory> = fc.record({
  operations: fullAxisOrder(ownerIsolationAxes),
  queuedTitle: generatedTitle,
})

const openTransactionBoundaryHistory: fc.Arbitrary<OpenTransactionBoundaryHistory> =
  fc.record({
    boundaries: fullAxisOrder(openTransactionBoundaryAxes),
    hydratedTitle: generatedTitle,
  })

const requestLocalFailureHistory: fc.Arbitrary<RequestLocalFailureHistory> =
  fc.record({
    operations: fullAxisOrder(requestLocalFailureAxes),
    titles: fc.tuple(generatedTitle, generatedTitle),
  })

function generatedPersistenceGrammarSamples(): ReadonlyArray<{
  grammar: GeneratedPersistenceGrammar
  histories: Array<GeneratedPersistenceHistory>
}> {
  const grammar = (property: string): GeneratedPersistenceGrammar => {
    const match = generatedPersistenceGrammars.find(
      (candidate) => candidate.property === property,
    )
    if (match === undefined) throw new Error(`missing grammar: ${property}`)
    return match
  }
  const sampleOptions = (seed: number) => ({ seed, numRuns: oracleRuns(4) })
  return [
    {
      grammar: grammar(`sqlite-persistence.source-fifo-order`),
      histories: fc
        .sample(
          sourceFifoOrderingHistory,
          sampleOptions(generatedPersistenceFixedSeeds.sourceFifoOrdering),
        )
        .map((history) => ({
          axes: history.relations,
          titles: [...history.titles],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.abort-graph`),
      histories: fc
        .sample(
          abortGraphHistory,
          sampleOptions(generatedPersistenceFixedSeeds.abortGraph),
        )
        .map((history) => ({
          axes: history.relationships,
          titles: [...history.titles],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.owner-isolation`),
      histories: fc
        .sample(
          ownerIsolationHistory,
          sampleOptions(generatedPersistenceFixedSeeds.ownerIsolation),
        )
        .map((history) => ({
          axes: history.operations,
          titles: [history.queuedTitle],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.open-transaction-boundary`),
      histories: fc
        .sample(
          openTransactionBoundaryHistory,
          sampleOptions(generatedPersistenceFixedSeeds.openTransactionBoundary),
        )
        .map((history) => ({
          axes: history.boundaries,
          titles: [history.hydratedTitle],
        })),
    },
    {
      grammar: grammar(
        `sqlite-persistence.request-local-failure-buffered-source`,
      ),
      histories: fc
        .sample(
          requestLocalFailureHistory,
          sampleOptions(generatedPersistenceFixedSeeds.requestLocalFailure),
        )
        .map((history) => ({
          axes: history.operations,
          titles: [...history.titles],
        })),
    },
  ]
}

async function runGeneratedSourceFifoOrderingHistory(
  history: SourceFifoOrderingHistory,
): Promise<void> {
  for (const relation of history.relations) {
    await runSourceFifoOrderingLaw(
      relation,
      history.titles[0],
      history.titles[1],
    )
  }
}

async function runGeneratedAbortGraphHistory(
  history: AbortGraphHistory,
): Promise<void> {
  for (const relationship of history.relationships) {
    await runAbortRelationshipLaw(
      relationship,
      history.titles[0],
      history.titles[1],
    )
  }
}

async function runGeneratedOwnerIsolationHistory(
  history: OwnerIsolationHistory,
): Promise<void> {
  for (const operation of history.operations) {
    await runBareOwnerOperationLaw(operation, history.queuedTitle)
  }
}

async function runGeneratedOpenTransactionBoundaryHistory(
  history: OpenTransactionBoundaryHistory,
): Promise<void> {
  for (const boundary of history.boundaries) {
    await runInternalOpenTransactionBoundaryLaw(boundary, history.hydratedTitle)
  }
}

async function runGeneratedRequestLocalFailureHistory(
  history: RequestLocalFailureHistory,
): Promise<void> {
  for (const operation of history.operations) {
    await runRequestLocalFailureOperationLaw(
      operation,
      history.titles[0],
      history.titles[1],
    )
  }
}

function registerGeneratedPersistenceProperty<Value>(options: {
  property: string
  title: string
  arbitrary: fc.Arbitrary<Value>
  fixedSeed: number
  run: (value: Value) => Promise<void>
}): void {
  const { property, title, arbitrary, fixedSeed, run } = options
  oracleReplayTest(fcTest).prop([arbitrary], {
    seed: fixedSeed,
    numRuns: oracleRuns(4),
  })(`${title} (fixed)`, run)
  oracleReplayTest(fcTest, property).prop(
    [arbitrary],
    oraclePropertyOptions(4, property),
  )(`${title} (random)`, run)
}

// The durability drivers run generated histories through the laws in this
// file. The models predict public rows, durable rows, and metadata from the
// authored inputs; the check drivers compare production observations with
// them, and the grammar reaches the generated histories.
declareOracle({
  check: [
    runGeneratedSourceFifoOrderingHistory,
    runGeneratedAbortGraphHistory,
    runGeneratedOwnerIsolationHistory,
    runGeneratedOpenTransactionBoundaryHistory,
    runGeneratedRequestLocalFailureHistory,
    expectOnDemandEvidenceLaw,
  ],
  model: [
    expectedScopedSnapshot,
    expectedTargetedSnapshot,
    foldDurabilityLedger,
    expectedSourceFifoOrderingRows,
  ],
  grammar: [
    generatedPersistenceGrammars,
    sourceFifoOrderingHistory,
    abortGraphHistory,
    ownerIsolationHistory,
    openTransactionBoundaryHistory,
    requestLocalFailureHistory,
  ],
})

// Each check compares an observation with the law that its own inputs fix:
// the abort relationship, the owner-isolation admission, or the open-transaction
// boundary outcome. The models recompute the hydrated source snapshot from the
// authored edit log and the transactions that reach durable admission.
declareOracle({
  check: [
    expectAbortGraphObservation,
    expectOwnerIsolationAdmission,
    expectOpenTransactionBoundaryObservation,
  ],
  model: [hydrationSourceSnapshot, expectedDurableHydrationTransactions],
})

const describeDurabilityOracles = oracleReplayTest(
  describe,
  `sqlite-persistence.source-fifo-order`,
  `sqlite-persistence.abort-graph`,
  `sqlite-persistence.owner-isolation`,
  `sqlite-persistence.open-transaction-boundary`,
  `sqlite-persistence.request-local-failure-buffered-source`,
)

describeDurabilityOracles(`generated persistence durability oracles`, () => {
  if (!oracleReplayRequested()) {
    it(`reconstructs the full grammar and rejects ablated, out-of-range, and foreign histories`, () => {
      for (const {
        grammar,
        histories,
      } of generatedPersistenceGrammarSamples()) {
        for (const history of histories) {
          expect(
            reconstructGeneratedPersistenceHistory(grammar, history),
          ).toEqual(history)
        }
      }

      for (const grammar of generatedPersistenceGrammars) {
        expect(Object.keys(grammar.axisContribution).sort()).toEqual(
          [...grammar.axes].sort(),
        )
        for (const contribution of Object.values(grammar.axisContribution)) {
          expect(contribution).not.toBe(``)
        }
        expect(
          reconstructGeneratedPersistenceHistory(grammar, grammar.witness),
        ).toEqual(grammar.witness)

        for (const omittedAxis of grammar.axes) {
          expect(() =>
            reconstructGeneratedPersistenceHistory(grammar, {
              ...grammar.witness,
              axes: grammar.witness.axes.filter((axis) => axis !== omittedAxis),
            }),
          ).toThrow(`invalid generated persistence history`)
        }

        expect(
          reconstructGeneratedPersistenceHistory(grammar, {
            axes: [...grammar.axes],
            titles: Array.from({ length: grammar.titleCount }, () =>
              `x`.repeat(generatedTitleMaxLength),
            ),
          }).titles,
        ).toEqual(
          Array.from({ length: grammar.titleCount }, () =>
            `x`.repeat(generatedTitleMaxLength),
          ),
        )
        expect(
          reconstructGeneratedPersistenceHistory(grammar, {
            axes: [...grammar.axes],
            titles: Array.from({ length: grammar.titleCount }, () => ``),
          }).titles,
        ).toEqual(Array.from({ length: grammar.titleCount }, () => ``))
        expect(() =>
          reconstructGeneratedPersistenceHistory(grammar, {
            axes: [...grammar.axes],
            titles: [
              `x`.repeat(generatedTitleMaxLength + 1),
              ...Array.from(
                { length: Math.max(0, grammar.titleCount - 1) },
                () => ``,
              ),
            ],
          }),
        ).toThrow(`invalid generated persistence history`)
        expect(() =>
          reconstructGeneratedPersistenceHistory(grammar, {
            ...grammar.witness,
            axes: grammar.axes.map((axis, index) =>
              index === grammar.axes.length - 1 ? grammar.axes[0]! : axis,
            ),
          }),
        ).toThrow(`invalid generated persistence history`)
        expect(() =>
          reconstructGeneratedPersistenceHistory(grammar, {
            ...grammar.witness,
            axes: [...grammar.axes.slice(0, -1), `foreign-axis`],
          }),
        ).toThrow(`invalid generated persistence history`)
      }
    })

    it.each([
      {
        name: `source-fifo-order older same-key value wins`,
        reject: () =>
          expectSourceFifoOrderingObservation(
            {
              publicRows: [{ id: `shared`, title: `older` }],
              durableRows: [{ id: `shared`, title: `older` }],
              status: `ready`,
              pendingMarkers: 0,
            },
            [{ id: `shared`, title: `newer` }],
          ),
      },
      {
        name: `abort-graph independent sibling inherits the abort`,
        reject: () =>
          expectAbortGraphObservation(
            {
              predecessorStatus: `rejected`,
              predecessorName: `AbortError`,
              successorStatus: `rejected`,
              sameFailure: true,
              status: `crashed`,
              publicSuccessor: undefined,
              durableSuccessor: undefined,
              pendingMarkers: 0,
            },
            `independent`,
            `survivor`,
            `must survive`,
          ),
      },
      {
        name: `owner-isolation bare write steals and publishes a queued marker`,
        reject: () =>
          expectOwnerIsolationAdmission({
            exactError: false,
            strayVisible: true,
          }),
      },
      {
        name: `open-transaction boundary leaks one core marker`,
        reject: () =>
          expectOpenTransactionBoundaryObservation(
            { status: `crashed`, pendingMarkers: 1 },
            `terminal-failure`,
          ),
      },
      {
        name: `request-local partial update drops the unseen baseline field`,
        reject: () =>
          expectRequestLocalFailureObservation(
            {
              receiptStatus: `fulfilled`,
              publicRows: [{ id: `shared`, title: `source` }],
              durableRows: [
                {
                  id: `shared`,
                  title: `source`,
                  detail: `required baseline detail`,
                },
              ],
              status: `ready`,
              publicError: undefined,
            },
            [
              {
                id: `shared`,
                title: `source`,
                detail: `required baseline detail`,
              },
            ],
          ),
      },
    ])(`rejects named wrong answer: $name`, ({ reject }) => {
      expect(reject).toThrow()
    })
  }

  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.source-fifo-order`,
    title: `serialized histories preserve source order and settle every receipt`,
    arbitrary: sourceFifoOrderingHistory,
    fixedSeed: generatedPersistenceFixedSeeds.sourceFifoOrdering,
    run: runGeneratedSourceFifoOrderingHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.abort-graph`,
    title: `abort graphs preserve independent siblings and reject dependent suffixes`,
    arbitrary: abortGraphHistory,
    fixedSeed: generatedPersistenceFixedSeeds.abortGraph,
    run: runGeneratedAbortGraphHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.owner-isolation`,
    title: `bare operations cannot capture another owner's transaction`,
    arbitrary: ownerIsolationHistory,
    fixedSeed: generatedPersistenceFixedSeeds.ownerIsolation,
    run: runGeneratedOwnerIsolationHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.open-transaction-boundary`,
    title: `open transaction boundaries leave no core marker`,
    arbitrary: openTransactionBoundaryHistory,
    fixedSeed: generatedPersistenceFixedSeeds.openTransactionBoundary,
    run: runGeneratedOpenTransactionBoundaryHistory,
  })
  registerGeneratedPersistenceProperty({
    property: `sqlite-persistence.request-local-failure-buffered-source`,
    title: `request-local load failure preserves buffered source semantics`,
    arbitrary: requestLocalFailureHistory,
    fixedSeed: generatedPersistenceFixedSeeds.requestLocalFailure,
    run: runGeneratedRequestLocalFailureHistory,
  })
})

describeUnlessOracleReplay(`persistedCollectionOptions`, () => {
  it.todo(
    `loads active subsets and collection metadata from one atomic full-reload generation`,
  )

  it.each([`during`, `straddles`, `after`] as const)(
    `durably settles a source transaction that commits %s persisted hydration`,
    async (position) => {
      const hydrationEntered = createEventGate()
      const hydration = createEventGate()
      const adapter = createRecordingAdapter()
      const restoreBaselineRows = overrideBaselineRows(adapter, async () => {
        hydrationEntered.resolve()
        await hydration.promise
        return []
      })

      const persistedTransactionOrder: Array<string> = []
      const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
      adapter.applyCommittedTx = async (...args) => {
        const title = args[1].mutations.find(
          (mutation) => mutation.type !== `delete`,
        )?.value as Todo | undefined
        if (title) persistedTransactionOrder.push(title.title)
        await applyCommittedTx(...args)
      }

      let remoteBegin: (() => void) | undefined
      let remoteWrite:
        ((message: { type: `insert`; value: Todo }) => void) | undefined
      let remoteCommit: (() => true | Promise<void>) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `hydration-boundary-${position}`,
          getKey: (item) => item.id,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              remoteBegin = begin
              remoteWrite = write as (message: {
                type: `insert`
                value: Todo
              }) => void
              remoteCommit = commit
              markReady()
            },
          },
          persistence: { adapter },
        }),
      )
      const ledger: Array<DurabilityLedgerEvent> = []
      const transactionId = position
      const row = { id: `shared`, title: position }
      let receipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      const beginAndWrite = () => {
        ledger.push({ type: `begin`, transactionId })
        remoteBegin?.()
        ledger.push({ type: `write`, transactionId, row })
        remoteWrite?.({ type: `insert`, value: row })
      }
      const commit = () => {
        ledger.push({ type: `commit`, transactionId })
        const applied = remoteCommit?.()
        expect(applied).toBeInstanceOf(Promise)
        receipt = Promise.resolve(applied).then(() => undefined)
      }

      try {
        const ready = collection.stateWhenReady()
        await atPersistedOracleCheckpoint(
          hydrationEntered.promise,
          `${position} hydration entered`,
        )
        expect(remoteBegin).toBeTypeOf(`function`)
        expect(remoteCommit).toBeTypeOf(`function`)

        if (position === `during`) {
          beginAndWrite()
          commit()
          hydration.resolve()
          await atPersistedOracleCheckpoint(
            ready,
            `${position} hydration completed`,
          )
        } else {
          if (position === `straddles`) beginAndWrite()
          hydration.resolve()
          await atPersistedOracleCheckpoint(
            ready,
            `${position} hydration completed`,
          )
          if (position === `after`) beginAndWrite()
          commit()
        }

        const settlement = observeSettlement(receipt!)
        const checkpointId = `checkpoint-${position}`
        const checkpointRow = { id: checkpointId, title: checkpointId }
        ledger.push({ type: `begin`, transactionId: checkpointId })
        remoteBegin?.()
        ledger.push({
          type: `write`,
          transactionId: checkpointId,
          row: checkpointRow,
        })
        remoteWrite?.({ type: `insert`, value: checkpointRow })
        ledger.push({ type: `commit`, transactionId: checkpointId })
        const checkpointReceipt = remoteCommit?.()
        expect(checkpointReceipt).toBeInstanceOf(Promise)
        await atPersistedOracleCheckpoint(
          Promise.resolve(checkpointReceipt),
          `${position} later durable receipt`,
        )

        // A settled later durable receipt is the exact cut: FIFO forbids it
        // from overtaking an earlier commit opened in the old phase.
        expect(settlement.read()).toEqual({ status: `fulfilled` })
        const expected = foldDurabilityLedger(ledger)
        expect(persistedTransactionOrder).toEqual(expected.commitOrder)
        expect(stripVirtualProps(collection.get(`shared`))).toEqual(row)
        expect(adapter.rows.get(`shared`)).toEqual(row)
        expect(adapter.rows.get(checkpointId)).toEqual(checkpointRow)

        await collection.cleanup()
        restoreBaselineRows()
        const reopened = createCollection(
          persistedCollectionOptions<Todo, string>({
            id: `hydration-boundary-${position}`,
            getKey: (item) => item.id,
            sync: { sync: ({ markReady }) => markReady() },
            persistence: { adapter },
          }),
        )
        let hasReopenFailure = false
        try {
          await atPersistedOracleCheckpoint(
            reopened.stateWhenReady(),
            `${position} reopened hydration completed`,
          )
          expect(stripVirtualProps(reopened.get(`shared`))).toEqual(
            expected.committedRows.get(`shared`),
          )
        } catch (error) {
          hasReopenFailure = true
          throw error
        } finally {
          await cleanupPersistedOracle(
            [() => reopened.cleanup()],
            hasReopenFailure,
          )
        }
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        hydration.resolve()
        await cleanupPersistedOracle(
          [() => collection.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`does not let a later same-key transaction overtake a hydration-straddling commit`, async () => {
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const adapter = createRecordingAdapter()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
    const persistedTransactionOrder: Array<string> = []
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = async (...args) => {
      const row = args[1].mutations.find(
        (mutation) => mutation.type !== `delete`,
      )?.value as Todo | undefined
      if (row) persistedTransactionOrder.push(row.title)
      await applyCommittedTx(...args)
    }

    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit: (() => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydration-straddle-sibling-fifo`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const ledger: Array<DurabilityLedgerEvent> = []
    let firstReceipt: Promise<void> | undefined
    let secondReceipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    const sourceTransaction = (transactionId: string, title: string) => {
      const row = { id: `shared`, title }
      ledger.push({ type: `begin`, transactionId })
      remoteBegin?.()
      ledger.push({ type: `write`, transactionId, row })
      remoteWrite?.({ type: `insert`, value: row })
      ledger.push({ type: `commit`, transactionId })
      return Promise.resolve(remoteCommit?.()).then(() => undefined)
    }

    try {
      const ready = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `FIFO hydration entered`,
      )

      const firstRow = { id: `shared`, title: `first` }
      ledger.push({ type: `begin`, transactionId: `first` })
      remoteBegin?.()
      ledger.push({ type: `write`, transactionId: `first`, row: firstRow })
      remoteWrite?.({ type: `insert`, value: firstRow })
      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `FIFO hydration completed`)
      ledger.push({ type: `commit`, transactionId: `first` })
      firstReceipt = Promise.resolve(remoteCommit?.()).then(() => undefined)
      const firstSettlement = observeSettlement(firstReceipt)

      secondReceipt = sourceTransaction(`second`, `second`)
      const secondSettlement = observeSettlement(secondReceipt)
      await atPersistedOracleCheckpoint(
        secondReceipt,
        `later same-key receipt settled`,
      )

      const expected = foldDurabilityLedger(ledger)
      expect(persistedTransactionOrder).toEqual(expected.commitOrder)
      expect(firstSettlement.read()).toEqual({ status: `fulfilled` })
      expect(secondSettlement.read()).toEqual({ status: `fulfilled` })
      expect(adapter.rows.get(`shared`)).toEqual(
        expected.committedRows.get(`shared`),
      )
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`settles an aborted hydration-straddling commit without applying it`, async () => {
    const hydrationEntered = createEventGate()
    const hydration = createEventGate()
    const adapter = createRecordingAdapter()
    overrideBaselineRows(adapter, async () => {
      hydrationEntered.resolve()
      await hydration.promise
      return []
    })
    let remoteBegin: (() => void) | undefined
    let remoteWrite:
      ((message: { type: `insert`; value: Todo }) => void) | undefined
    let remoteCommit:
      ((signal?: AbortSignal) => true | Promise<void>) | undefined
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `aborted-hydration-straddle`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            remoteBegin = begin
            remoteWrite = write as (message: {
              type: `insert`
              value: Todo
            }) => void
            remoteCommit = commit
            markReady()
          },
        },
        persistence: { adapter },
      }),
    )
    const ledger: Array<DurabilityLedgerEvent> = []
    const controller = new AbortController()
    let receipt: Promise<void> | undefined
    let hasPrimaryFailure = false

    try {
      const ready = collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        hydrationEntered.promise,
        `abort hydration entered`,
      )
      ledger.push({ type: `begin`, transactionId: `aborted` })
      remoteBegin?.()
      const row = { id: `aborted`, title: `must not apply` }
      ledger.push({ type: `write`, transactionId: `aborted`, row })
      remoteWrite?.({ type: `insert`, value: row })
      controller.abort()
      ledger.push({ type: `abort`, transactionId: `aborted` })
      hydration.resolve()
      await atPersistedOracleCheckpoint(ready, `abort hydration completed`)
      receipt = Promise.resolve(remoteCommit?.(controller.signal)).then(
        () => undefined,
      )
      await expect(
        atPersistedOracleCheckpoint(receipt, `aborted receipt settled`),
      ).rejects.toMatchObject({ name: `AbortError` })
      expect(foldDurabilityLedger(ledger).committedRows.size).toBe(0)
      expect(collection.get(`aborted`)).toBeUndefined()
      expect(adapter.rows.get(`aborted`)).toBeUndefined()
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      hydration.resolve()
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`append-only transaction judgment rejects omission and reordering`, () => {
    const events: Array<DurabilityLedgerEvent> = [
      { type: `begin`, transactionId: `first` },
      {
        type: `write`,
        transactionId: `first`,
        row: { id: `shared`, title: `first` },
      },
      { type: `commit`, transactionId: `first` },
      { type: `begin`, transactionId: `second` },
      {
        type: `write`,
        transactionId: `second`,
        row: { id: `shared`, title: `second` },
      },
      { type: `commit`, transactionId: `second` },
    ]
    const expected = foldDurabilityLedger(events)

    expect(expected.commitOrder).toEqual([`first`, `second`])
    expect(expected.commitOrder).not.toEqual([`second`])
    expect(expected.commitOrder).not.toEqual([`second`, `first`])
    expect(expected.committedRows.get(`shared`)).toEqual({
      id: `shared`,
      title: `second`,
    })
  })

  it.each([`startup`, `resume`, `reset`] as const)(
    `keeps the %s hydration ready after a buffered pre-application abort`,
    async (entry) => {
      const adapter = createRecordingAdapter()
      const hydrationEntered = createEventGate()
      const releaseHydration = createEventGate()
      const coordinator =
        entry === `reset` ? createCoordinatorHarness() : undefined
      if (coordinator) {
        coordinator.requestApplyCommittedTx = async (collectionId, tx) => {
          await adapter.applyCommittedTx(
            { kind: `eager`, collectionId: collectionId },
            tx,
          )
          return {
            type: `rpc:applyCommittedTx:res`,
            rpcId: tx.txId,
            ok: true,
            term: tx.term,
            seq: tx.seq,
            latestRowVersion: tx.rowVersion,
          }
        }
      } else {
        overrideBaselineRows(adapter, async () => {
          hydrationEntered.resolve()
          await releaseHydration.promise
          return []
        })
      }
      let sourceParams!: TodoSyncParams
      let hydrateResumeBaseline: (() => Promise<void>) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: coordinator ? `sync-present` : `buffered-abort-${entry}`,
          getKey: (row) => row.id,
          syncMode: entry === `resume` ? `on-demand` : `eager`,
          sync: {
            sync: (params) => {
              sourceParams = params
              hydrateResumeBaseline =
                params.metadata?.persistence?.hydrateBaseline
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const aborted = new AbortController()
      let keyReads = 0
      let hydration: Promise<unknown> | undefined
      let abortedReceipt: Promise<void> | undefined
      let independentReceipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      try {
        if (entry === `resume`) {
          collection.startSyncImmediate()
          await atPersistedOracleCheckpoint(
            collection.stateWhenReady(),
            `resume collection ready before baseline`,
          )
          expect(hydrateResumeBaseline).toBeTypeOf(`function`)
          hydration = hydrateResumeBaseline!()
        } else if (coordinator) {
          await atPersistedOracleCheckpoint(
            collection.stateWhenReady(),
            `reset collection ready before reload`,
          )
          const loadSubset = adapter.loadSubset.bind(adapter)
          adapter.loadSubset = async (...args) => {
            hydrationEntered.resolve()
            await releaseHydration.promise
            return loadSubset(...args)
          }
          coordinator.emit({
            type: `collection:reset`,
            schemaVersion: 1,
            resetEpoch: 1,
          })
          hydration = Promise.resolve()
        } else {
          hydration = collection.stateWhenReady()
        }
        void hydration.catch(() => undefined)
        await atPersistedOracleCheckpoint(
          hydrationEntered.promise,
          `${entry} hydration entered`,
        )

        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `prefix`, title: `staged before abort` },
        })
        sourceParams.write({
          type: `insert`,
          value: {
            get id() {
              keyReads++
              if (keyReads === 2) aborted.abort()
              return `aborting`
            },
            title: `cancel before core application`,
          },
        })
        abortedReceipt = Promise.resolve(
          sourceParams.commit(aborted.signal),
        ).then(() => undefined)
        void abortedReceipt.catch(() => undefined)

        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `independent`, title: `survives abort` },
        })
        independentReceipt = Promise.resolve(sourceParams.commit()).then(
          () => undefined,
        )
        void independentReceipt.catch(() => undefined)

        releaseHydration.resolve()
        const outcomes = await atPersistedOracleCheckpoint(
          Promise.allSettled([hydration, abortedReceipt, independentReceipt]),
          `${entry} buffered abort settled`,
        )
        const expected = foldDurabilityLedger([
          { type: `begin`, transactionId: `aborted` },
          {
            type: `write`,
            transactionId: `aborted`,
            row: { id: `prefix`, title: `staged before abort` },
          },
          { type: `abort`, transactionId: `aborted` },
          { type: `begin`, transactionId: `independent` },
          {
            type: `write`,
            transactionId: `independent`,
            row: { id: `independent`, title: `survives abort` },
          },
          { type: `commit`, transactionId: `independent` },
        ])

        expect(keyReads).toBeGreaterThanOrEqual(2)
        expect(outcomes.map((outcome) => outcome.status)).toEqual([
          `fulfilled`,
          `rejected`,
          `fulfilled`,
        ])
        if (outcomes[1].status === `rejected`) {
          expect(outcomes[1].reason).toBeInstanceOf(SyncTransactionAbortedError)
        }
        expect(collection.status).toBe(`ready`)
        expect(collection._lifecycle.getSyncError()).toBeUndefined()
        expect(collection.get(`prefix`)).toBeUndefined()
        expect(collection.get(`aborting`)).toBeUndefined()
        expect(stripVirtualProps(collection.get(`independent`))).toEqual(
          expected.committedRows.get(`independent`),
        )
        expect(adapter.rows).toEqual(expected.committedRows)
        expect(
          adapter.applyCommittedTxCalls.map(({ tx }) =>
            tx.mutations.map(({ key }) => key),
          ),
        ).toEqual([[`independent`]])
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releaseHydration.resolve()
        aborted.abort()
        await cleanupPersistedOracle(
          [
            () => hydration?.catch(() => undefined),
            () => abortedReceipt?.catch(() => undefined),
            () => independentReceipt?.catch(() => undefined),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Commit acceptance creates a source obligation. Successful subset hydration
  // queued ahead of publication cannot revoke it. This finite grammar crosses
  // one/two/three queued hydrations, unreserved/reserved commit turns,
  // insert/update, and absent/present dependent successors. The two-read
  // unreserved case
  // reconstructs the report; one and three distinguish a misplaced threshold.
  // Open transactions crossing hydration are excluded here and rejected below.
  // This driver supplies adapter scheduling, not live Electric or OPFS delivery.
  it.each(
    ([`insert`, `update`] as const).flatMap((type) =>
      [1, 2, 3].flatMap((hydrationCount) =>
        [false, true].flatMap((reserveCommitTurn) =>
          [false, true].map((hasSuccessor) => ({
            type,
            hydrationCount,
            reserveCommitTurn,
            hasSuccessor,
          })),
        ),
      ),
    ),
  )(
    `publishes committed source $type after $hydrationCount queued hydrations (reserveCommitTurn=$reserveCommitTurn, successor=$hasSuccessor)`,
    async ({ type, hydrationCount, reserveCommitTurn, hasSuccessor }) => {
      // https://github.com/TanStack/db/issues/2036
      const adapter = createRecordingAdapter([
        { id: `shared`, title: `persisted`, detail: `retained baseline` },
      ])
      adapter.rowMetadata.set(`shared`, { owner: `persisted` })
      const persistenceEntered = createEventGate()
      const releasePersistence = createEventGate()
      const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
      let applyCalls = 0
      adapter.applyCommittedTx = async (...args) => {
        if (++applyCalls === 1) {
          persistenceEntered.resolve()
          await releasePersistence.promise
        }
        await applyCommittedTx(...args)
        for (const mutation of args[1].mutations) {
          if (mutation.type !== `delete` && mutation.key === `shared`) {
            durableSourceTitles.push((mutation.value as Todo).title)
          }
        }
      }
      const durableSourceTitles: Array<string> = []
      const hydrationTitles: Array<string | undefined> = []
      const loadSubset = adapter.loadSubset.bind(adapter)
      adapter.loadSubset = async (...args) => {
        hydrationTitles.push(collection.get(`shared`)?.title)
        return loadSubset(...args)
      }
      let sourceParams!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `committed-source-${type}-queued-behind-hydration`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      const options = Array.from({ length: hydrationCount }, (_, index) => ({
        limit: index + 1,
      }))
      // Model complete source obligations independently of production queues.
      // Hydration establishes the baseline first; source patches retain detail.
      // Fresh inserts reset metadata, while updates keep baseline ownership.
      // Row values retain the pre-existing quiescent wrapper semantics: source
      // inserts are upserts, and partial mode retains omitted baseline fields.
      // Metadata reset does not imply replacement of the complete row value.
      const sourceTitles = hasSuccessor
        ? [`first source value`, `second source value`]
        : [`first source value`]
      const expected = foldDurabilityLedger(
        sourceTitles.flatMap((title): Array<DurabilityLedgerEvent> => [
          { type: `begin`, transactionId: title },
          {
            type: `write`,
            transactionId: title,
            row: { id: `shared`, title, detail: `retained baseline` },
          },
          { type: `commit`, transactionId: title },
        ]),
      )
      const receipts: Array<Promise<true | void>> = []
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        sourceParams.begin()
        sourceParams.write({
          type: `insert`,
          value: { id: `gate`, title: `holds apply mutex` },
        })
        const gateReceipt = Promise.resolve(sourceParams.commit())
        void gateReceipt.catch(() => undefined)
        receipts.push(gateReceipt)
        await atPersistedOracleCheckpoint(
          persistenceEntered.promise,
          `predecessor persistence entered`,
        )

        // Reserve hydrations while the predecessor holds the mutex.
        // None has started when the source transaction begins and commits.
        for (const option of options) {
          const hydration = Promise.resolve(collection._sync.loadSubset(option))
          void hydration.catch(() => undefined)
          receipts.push(hydration)
        }
        await flushAsyncWork()
        expect(adapter.loadSubsetCalls).toHaveLength(0)
        sourceParams.begin()
        if (reserveCommitTurn) {
          sourceParams.metadata!.persistence!.reserveCommitTurn()
        }
        sourceParams.write({
          type,
          value: { id: `shared`, title: `first source value` },
        })
        sourceParams.metadata!.collection.set(`cursor`, `first`)
        const firstReceipt = Promise.resolve(sourceParams.commit())
        void firstReceipt.catch(() => undefined)
        receipts.push(firstReceipt)

        if (hasSuccessor) {
          sourceParams.begin()
          if (reserveCommitTurn) {
            sourceParams.metadata!.persistence!.reserveCommitTurn()
          }
          expect(sourceParams.metadata!.collection.get(`cursor`)).toBe(`first`)
          sourceParams.write({
            type: `update`,
            value: { id: `shared`, title: `second source value` },
          })
          sourceParams.metadata!.collection.set(`cursor`, `second`)
          const secondReceipt = Promise.resolve(sourceParams.commit())
          void secondReceipt.catch(() => undefined)
          receipts.push(secondReceipt)
        }
        expect(collection.get(`shared`)).toBeUndefined()

        releasePersistence.resolve()
        // Observe every receipt before cleanup. allSettled preserves rejection
        // identity alongside the wrong public/durable snapshot on main.
        const outcomes = await atPersistedOracleCheckpoint(
          Promise.allSettled(receipts),
          `committed source receipts after queued hydrations`,
        )
        expect({
          outcomes,
          hydrationTitles,
          durableSourceTitles,
          status: collection.status,
          publicRow: stripVirtualProps(collection.get(`shared`)),
          durableRow: adapter.rows.get(`shared`),
          rowMetadata: adapter.rowMetadata.get(`shared`),
          cursor: adapter.collectionMetadata.get(`cursor`),
          durableKeys: adapter.applyCommittedTxCalls.map(({ tx }) =>
            tx.mutations.map(({ key }) => key),
          ),
        }).toEqual({
          outcomes: receipts.map(() => ({
            status: `fulfilled`,
            value: undefined,
          })),
          hydrationTitles: options.map((_, index) =>
            index === 0 ? undefined : `persisted`,
          ),
          durableSourceTitles: expected.commitOrder,
          status: `ready`,
          publicRow: expected.committedRows.get(`shared`),
          durableRow: expected.committedRows.get(`shared`),
          rowMetadata: type === `insert` ? undefined : { owner: `persisted` },
          cursor: hasSuccessor ? `second` : `first`,
          durableKeys: [[`gate`], ...sourceTitles.map(() => [`shared`])],
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releasePersistence.resolve()
        await cleanupPersistedOracle(
          [
            ...options.map(
              (option) => () => collection._sync.unloadSubset(option),
            ),
            () => Promise.allSettled(receipts),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Law: a complete persisted value replaces the old value in every field,
  // including field absence. This follows the durable snapshot contract and
  // the chosen demand-scoped notice/reset contract above. The model at the top
  // of this file selects keys using demand and seed authority, then takes the
  // authored durable value whole. The legal grammar crosses complete demand,
  // retired-demand peer notice, and retired-demand reset with field removal,
  // addition, present-undefined transitions in a custom adapter, and scalar
  // replacement. Field-only changes keep title unchanged to reject a
  // comparator that watches title alone. The Collection and coordinator are
  // the driver; whole public rows at the settled publication checkpoint are
  // the observation. The old title-only checks could not see a retained field.
  // The removal arm reconstructs that counterexample. Removing it would lose
  // the stale-field witness; removing a route would lose its distinct admission
  // path. Addition and scalar change are neighboring controls, not a claim
  // about arbitrary nested values. Keys agree with row IDs and the fixture has
  // no accepted source transaction; a mismatched key or source-owned ordinary
  // row is outside this grammar and has a separate owner below.
  // Built-in SQLite drops undefined object fields during encoding, so those
  // two arms exercise the generic adapter boundary only; removal of a defined
  // field is the receiving SQLite-representable case.
  it.each(
    (
      [`complete demand`, `retired peer notice`, `retired reset`] as const
    ).flatMap((route) =>
      (
        [
          `remove`,
          `remove with metadata`,
          `add`,
          `remove undefined`,
          `add undefined`,
          `scalar`,
        ] as const
      ).map((shape) => ({
        route,
        shape,
      })),
    ),
  )(
    `publishes exact durable row shape within $route ($shape)`,
    async ({ route, shape }) => {
      const ordinary: Todo =
        shape === `add undefined`
          ? { id: `ordinary`, title: `Old` }
          : shape === `remove undefined`
            ? { id: `ordinary`, title: `Old`, detail: undefined }
            : { id: `ordinary`, title: `Old`, detail: `obsolete` }
      const removed = { id: `removed`, title: `Old` }
      const seed = { id: `seed`, title: `Hydrated`, detail: `source-owned` }
      const unseen = { id: `unseen`, title: `Only in storage` }
      const fresh: Todo =
        shape === `remove` ||
        shape === `remove with metadata` ||
        shape === `remove undefined`
          ? { id: ordinary.id, title: ordinary.title }
          : shape === `add`
            ? { ...ordinary, payload: { rank: 1 } }
            : shape === `add undefined`
              ? { ...ordinary, detail: undefined }
              : { ...ordinary, title: `Fresh` }
      const expectedFresh = structuredClone(fresh)
      const before = new Map<string, Todo>([
        [ordinary.id, structuredClone(ordinary)],
        [removed.id, structuredClone(removed)],
        [seed.id, structuredClone(seed)],
      ])
      const after = new Map<string, Todo>([
        [fresh.id, fresh],
        [unseen.id, unseen],
        [seed.id, { id: seed.id, title: `Older durable seed` }],
      ])
      const adapter = createRecordingAdapter([ordinary, removed])
      if (shape === `remove with metadata`)
        adapter.rowMetadata.set(ordinary.id, { source: `durable` })
      const coordinator = createCoordinatorHarness()
      const collectionId = `exact-shape-${route}-${shape}`
      let source!: TodoSyncParams
      const descriptor = collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const client = new DbClient()
      client.hydrate({
        collections: [{ collectionId, rows: [{ key: seed.id, value: seed }] }],
      })
      const collection = client.collection(descriptor)
      const firstDemand = { limit: 10 }
      const publishedOrdinaryValues: Array<Todo> = []
      const publishedChanges: Array<string> = []
      const publishedSnapshots: Array<Map<string, Todo>> = []
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        collection.startSyncImmediate()
        await collection.stateWhenReady()
        await collection._sync.loadSubset(firstDemand)
        expectExactSnapshot(publicRows(), before)
        if (route !== `complete demand`)
          collection._sync.unloadSubset(firstDemand)
        // An initial-state subscription would itself acquire subset demand.
        // Observe subsequent changes without changing this route's demand.
        subscription = collection.subscribeChanges(
          (batch) => {
            publishedSnapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            publishedChanges.push(
              ...batch.map((change) => `${change.type}:${change.key}`),
            )
            for (const change of batch) {
              if (change.key === ordinary.id && change.type !== `delete`) {
                publishedOrdinaryValues.push(
                  structuredClone(stripVirtualProps(change.value)),
                )
              }
            }
          },
          { includeInitialState: false },
        )
        const subsetReadsBeforeRevision = adapter.loadSubsetCalls.length

        adapter.rows.clear()
        for (const [key, row] of after) adapter.rows.set(key, row)
        // The peer/reset signal and its subsequent durable read describe one
        // coherent generation. Direct fixture row edits do not advance the
        // recording adapter's transaction ledger, so supply that position here.
        const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
        adapter.loadResumeSnapshot = async (...args) => ({
          ...(await loadResumeSnapshot(...args)),
          latestTerm: route === `retired peer notice` ? 1 : 0,
          latestSeq: route === `retired peer notice` ? 1 : 0,
          latestRowVersion: route === `retired peer notice` ? 1 : 0,
          resetEpoch: route === `retired reset` ? 1 : 0,
        })
        const expected = expectedScopedSnapshot(
          before,
          after,
          new Map([[seed.id, before.get(seed.id)!]]),
          route === `complete demand`,
        )
        const published = createEventGate()
        const runInHydrationScope = adapter.runInHydrationScope?.bind(adapter)
        adapter.runInHydrationScope = async (task) => {
          const result = await (runInHydrationScope?.(task) ?? task(adapter))
          published.resolve()
          return result
        }
        if (route === `complete demand`) {
          const completeDemand = {}
          await collection._sync.loadSubset(completeDemand)
          collection._sync.unloadSubset(completeDemand)
        } else if (route === `retired peer notice`) {
          coordinator.emit(
            {
              type: `tx:committed`,
              term: 1,
              seq: 1,
              txId: `exact-shape`,
              latestRowVersion: 1,
              requiresFullReload: true,
            },
            undefined,
            collectionId,
          )
          await atPersistedOracleCheckpoint(
            published.promise,
            `exact-shape peer notice published`,
          )
        } else {
          coordinator.emit(
            { type: `collection:reset`, schemaVersion: 1, resetEpoch: 1 },
            undefined,
            collectionId,
          )
          await atPersistedOracleCheckpoint(
            published.promise,
            `exact-shape reset published`,
          )
        }
        expectExactSnapshot(publicRows(), expected)
        expect(publishedSnapshots).toHaveLength(1)
        for (const snapshot of publishedSnapshots)
          expectExactSnapshot(snapshot, expected)
        if (shape === `remove with metadata`)
          expect(source.metadata?.row.get(ordinary.id)).toStrictEqual({
            source: `durable`,
          })
        expect(adapter.loadSubsetCalls).toHaveLength(
          subsetReadsBeforeRevision + (route === `complete demand` ? 1 : 0),
        )
        expect(publishedOrdinaryValues.length).toBeGreaterThan(0)
        for (const row of publishedOrdinaryValues)
          expect(row).toStrictEqual(expectedFresh)
        expect(publishedChanges).toContain(`delete:removed`)
        expect(
          publishedChanges.some((change) => change.endsWith(`:seed`)),
        ).toBe(false)
        if (route === `complete demand`)
          expect(publishedChanges).toContain(`insert:unseen`)
        else
          expect(
            publishedChanges.some((change) => change.endsWith(`:unseen`)),
          ).toBe(false)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        if (route === `complete demand`)
          collection._sync.unloadSubset(firstDemand)
        await cleanupPersistedOracle(
          [() => client.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Law: a small peer delta must lead to the same demand-scoped public rows as
  // the committed durable relation. The wire value is a partial source patch,
  // so its omitted predicate and payload fields are not evidence of absence.
  // A retired demand validates previously public keys but admits no new key.
  // The model above chooses from authored full durable rows; the recording
  // adapter applies the patch before the notice and is checked against that
  // authored state. The driver then delivers the real targeted-notice entry
  // point. A change callback establishes the publication checkpoint, and the
  // comparison checks exact public keys and row fields. `stay` omits the
  // predicate field, `enter` omits an existing payload field, and `leave`
  // changes the predicate; each has a neighboring route with no active demand.
  // These controlled notices do not prove native SQLite sender or host delivery.
  it.each(
    ([`active filter`, `retired demand`] as const).flatMap((route) =>
      ([`stay`, `enter`, `leave`] as const).map((transition) => ({
        route,
        transition,
      })),
    ),
  )(
    `publishes the durable result of a targeted partial $transition with $route`,
    async ({ route, transition }) => {
      const old: Todo = {
        id: `ordinary`,
        title: transition === `enter` ? `Other` : `Keep`,
        detail: `retained field`,
      }
      const patch: Partial<Todo> & Pick<Todo, `id`> =
        transition === `stay`
          ? { id: old.id, detail: `new detail` }
          : { id: old.id, title: transition === `enter` ? `Keep` : `Other` }
      const durable: Todo = {
        ...old,
        ...patch,
      }
      const unseen: Todo = { id: `unseen`, title: `Keep` }
      const adapter = createRecordingAdapter([old])
      const originalLoad = adapter.loadSubset.bind(adapter)
      adapter.loadSubset = async (id, options, context) =>
        (await originalLoad(id, options, context)).filter(
          (row) => !options.where || row.value.title === `Keep`,
        )
      const coordinator = createCoordinatorHarness()
      const collectionId = `targeted-partial-${route}-${transition}`
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const demand =
        route === `active filter`
          ? {
              where: new IR.Func(`eq`, [
                new IR.PropRef([`title`]),
                new IR.Value(`Keep`),
              ]),
            }
          : {}
      const published = createEventGate()
      const publishedSnapshots: Array<Map<string, Todo>> = []
      const publishedOrdinaryValues: Array<Todo> = []
      const publishedChanges: Array<string> = []
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        await collection._sync.loadSubset(demand)
        const before = new Map(
          Array.from(publicRows(), ([key, row]) => [key, structuredClone(row)]),
        )
        expectExactSnapshot(
          before,
          new Map(
            route === `active filter` && transition === `enter`
              ? []
              : [[old.id, old]],
          ),
        )
        if (route === `retired demand`) collection._sync.unloadSubset(demand)
        subscription = collection.subscribeChanges(
          (batch) => {
            publishedSnapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            publishedChanges.push(
              ...batch.map((change) => `${change.type}:${change.key}`),
            )
            for (const change of batch) {
              if (change.key === old.id && change.type !== `delete`)
                publishedOrdinaryValues.push(
                  structuredClone(stripVirtualProps(change.value)),
                )
            }
            published.resolve()
          },
          { includeInitialState: false },
        )
        const mutations: PersistedTx[`mutations`] = [
          { type: `update`, key: old.id, value: patch },
          ...(route === `retired demand`
            ? [{ type: `insert` as const, key: unseen.id, value: unseen }]
            : []),
        ]
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId },
          {
            txId: `targeted-partial`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations,
          },
        )
        const authoredDurable = new Map<string, Todo>([
          [old.id, durable],
          ...(route === `retired demand`
            ? ([[unseen.id, unseen]] as Array<[string, Todo]>)
            : []),
        ])
        expectExactSnapshot(adapter.rows, authoredDurable)
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `targeted-partial`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [
              { key: old.id, value: patch },
              ...(route === `retired demand`
                ? [{ key: unseen.id, value: unseen }]
                : []),
            ],
            deletedKeys: [],
          },
          undefined,
          collectionId,
        )
        await atPersistedOracleCheckpoint(
          published.promise,
          `targeted partial notice published`,
        )
        await flushAsyncWork()
        const expected = expectedTargetedSnapshot(
          before,
          authoredDurable,
          route === `active filter` ? `Keep` : undefined,
        )
        expectExactSnapshot(publicRows(), expected)
        expect(publishedSnapshots).toHaveLength(1)
        for (const snapshot of publishedSnapshots)
          expectExactSnapshot(snapshot, expected)
        if (expected.has(old.id)) {
          expect(publishedOrdinaryValues).toHaveLength(1)
          expect(publishedOrdinaryValues[0]).toStrictEqual(durable)
        } else {
          expect(publishedChanges).toContain(`delete:${old.id}`)
        }
        if (route === `retired demand`)
          expect(
            publishedChanges.some((change) => change.endsWith(`:unseen`)),
          ).toBe(false)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        if (route === `active filter`) collection._sync.unloadSubset(demand)
        await cleanupPersistedOracle(
          [() => collection.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // The same targeted path must respect DbClient hydration authority. A seed
  // key may also exist in older durable storage. Active complete and filtered
  // demand, and retired demand, cannot let a peer delta replace that
  // source-owned value. The filtered case makes the durable row leave the
  // predicate while the hydrated seed still matches it. The ordinary row
  // beside it proves the notice was processed, so a
  // subject that simply drops all targeted messages cannot pass. The model is
  // the authored durable snapshot with the protected seed overlaid; public
  // rows and change keys are checked after the targeted commit publishes.
  it.each(
    ([`active demand`, `active filter`, `retired demand`] as const).flatMap(
      (route) =>
        ([`replacement`, `partial update`, `deletion`] as const).flatMap(
          (mutation) =>
            ([`set`, `delete`] as const).map((metadataAction) => ({
              route,
              mutation,
              metadataAction,
            })),
        ),
    ),
  )(
    `preserves a hydrated seed and metadata during a targeted $mutation with $route ($metadataAction)`,
    async ({ route, mutation, metadataAction }) => {
      const ordinary =
        route === `active filter`
          ? { id: `ordinary`, title: `Keep`, detail: `old` }
          : { id: `ordinary`, title: `Old durable` }
      const ordinaryPatch =
        route === `active filter`
          ? { id: ordinary.id, detail: `fresh` }
          : { id: ordinary.id, title: `Fresh durable` }
      const durableOrdinary = { ...ordinary, ...ordinaryPatch }
      const seed = {
        id: `seed`,
        title: route === `active filter` ? `Keep` : `Hydrated seed`,
        detail: `source-owned`,
      }
      const storedSeed = {
        id: `seed`,
        title: route === `active filter` ? `Keep` : `Older durable seed`,
        detail: `older`,
      }
      const seedMutation: PersistedTx[`mutations`][number] =
        mutation === `deletion`
          ? { type: `delete`, key: seed.id, value: storedSeed }
          : mutation === `partial update`
            ? {
                type: `update`,
                key: seed.id,
                value:
                  route === `active filter`
                    ? { id: seed.id, title: `Other` }
                    : { id: seed.id, detail: `still older` },
              }
            : {
                type: `update`,
                key: seed.id,
                value: {
                  id: seed.id,
                  title:
                    route === `active filter` ? `Other` : `Still older durable`,
                  detail: `older`,
                },
              }
      const durableSeed: Todo | undefined =
        mutation === `deletion`
          ? undefined
          : mutation === `partial update`
            ? route === `active filter`
              ? { ...storedSeed, title: `Other` }
              : { ...storedSeed, detail: `still older` }
            : {
                ...storedSeed,
                title:
                  route === `active filter` ? `Other` : `Still older durable`,
              }
      const adapter = createRecordingAdapter([ordinary, storedSeed])
      adapter.rowMetadata.set(seed.id, { owner: `older durable` })
      if (route === `active filter`) {
        const originalLoad = adapter.loadSubset.bind(adapter)
        adapter.loadSubset = async (id, options, context) =>
          (await originalLoad(id, options, context)).filter(
            (row) => !options.where || row.value.title === `Keep`,
          )
      }
      const coordinator = createCoordinatorHarness()
      const collectionId = `targeted-seed-${route}`
      let sourceParams!: TodoSyncParams
      const descriptor = collectionOptions(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const client = new DbClient()
      const seedMetadata = { owner: `hydrated source` }
      client.hydrate({
        collections: [
          {
            collectionId,
            rows: [{ key: seed.id, value: seed, metadata: seedMetadata }],
          },
        ],
      })
      const collection = client.collection(descriptor)
      const demand =
        route === `active filter`
          ? {
              where: new IR.Func(`eq`, [
                new IR.PropRef([`title`]),
                new IR.Value(`Keep`),
              ]),
            }
          : {}
      const published = createEventGate()
      const publishedKeys: Array<string> = []
      const publishedOrdinaryValues: Array<Todo> = []
      const publishedSnapshots: Array<Map<string, Todo>> = []
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        collection.startSyncImmediate()
        await collection.stateWhenReady()
        await collection._sync.loadSubset(demand)
        const before = new Map<string, Todo>([
          [ordinary.id, ordinary],
          [seed.id, seed],
        ])
        expectExactSnapshot(publicRows(), before)
        expect(sourceParams.metadata?.row.get(seed.id)).toEqual(seedMetadata)
        if (route === `retired demand`) collection._sync.unloadSubset(demand)
        subscription = collection.subscribeChanges(
          (batch) => {
            publishedSnapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            publishedKeys.push(...batch.map((change) => String(change.key)))
            for (const change of batch) {
              if (change.key === ordinary.id && change.type !== `delete`)
                publishedOrdinaryValues.push(
                  structuredClone(stripVirtualProps(change.value)),
                )
            }
            published.resolve()
          },
          { includeInitialState: false },
        )
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId },
          {
            txId: `targeted-seed`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [
              {
                type: `update`,
                key: ordinary.id,
                value: ordinaryPatch,
              },
              seedMutation,
            ],
            rowMetadataMutations: [
              metadataAction === `set`
                ? {
                    type: `set`,
                    key: seed.id,
                    value: { owner: `peer durable` },
                  }
                : { type: `delete`, key: seed.id },
            ],
          },
        )
        const authoredDurable = new Map<string, Todo>([
          [ordinary.id, durableOrdinary],
          ...(durableSeed
            ? ([[seed.id, durableSeed]] as Array<[string, Todo]>)
            : []),
        ])
        expectExactSnapshot(adapter.rows, authoredDurable)
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `targeted-seed`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows: [
              { key: ordinary.id, value: ordinaryPatch },
              ...(seedMutation.type === `delete`
                ? []
                : [{ key: seed.id, value: seedMutation.value }]),
            ],
            deletedKeys: seedMutation.type === `delete` ? [seed.id] : [],
            rowMetadataMutations: [
              metadataAction === `set`
                ? {
                    type: `set`,
                    key: seed.id,
                    value: { owner: `peer durable` },
                  }
                : { type: `delete`, key: seed.id },
            ],
          },
          undefined,
          collectionId,
        )
        await atPersistedOracleCheckpoint(
          published.promise,
          `targeted seed notice published`,
        )
        await flushAsyncWork()
        const expected =
          route === `active filter`
            ? new Map([
                ...expectedTargetedSnapshot(before, authoredDurable, `Keep`),
                [seed.id, seed] as const,
              ])
            : expectedScopedSnapshot(
                before,
                authoredDurable,
                new Map([[seed.id, seed]]),
                route === `active demand`,
              )
        expectExactSnapshot(publicRows(), expected)
        expect(sourceParams.metadata?.row.get(seed.id)).toEqual(seedMetadata)
        expect(publishedSnapshots).toHaveLength(1)
        for (const snapshot of publishedSnapshots)
          expectExactSnapshot(snapshot, expected)
        expect(publishedOrdinaryValues).toEqual([durableOrdinary])
        expect(publishedKeys).toContain(ordinary.id)
        expect(publishedKeys).not.toContain(seed.id)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        if (route !== `retired demand`) collection._sync.unloadSubset(demand)
        await cleanupPersistedOracle(
          [() => client.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  // A source transaction can write the same key more than once. The durable
  // store folds operations in order, but the targeted notice separates all
  // changed rows from deleted keys. Delete -> update and update -> delete have
  // identical wire arrays and opposite durable outcomes, so a receiver cannot
  // reconstruct either result from that envelope alone. The independent case
  // table authors the final durable relation; the recording adapter checks
  // that each operation sequence reaches it before the notice is delivered.
  // A same-key insert also shares the targeted changedRows shape with an
  // update, yet replaces rather than merges the durable row. Both active
  // complete and retired demand compare the public row at each callback and
  // after the next task turn. Two updates are a neighboring control that
  // retains the old field omitted by each patch.
  it.each(
    ([`active demand`, `retired demand`] as const).flatMap((route) =>
      (
        [
          `delete then update`,
          `update then delete`,
          `two updates`,
          `insert replacement`,
        ] as const
      ).map((sequence) => ({ route, sequence })),
    ),
  )(
    `follows durable same-key order for targeted $sequence with $route`,
    async ({ route, sequence }) => {
      const old = { id: `row`, title: `Old`, detail: `old detail` }
      const fresh = { id: old.id, title: `Fresh` }
      const detailPatch = { id: old.id, detail: `new detail` }
      const titlePatch = { id: old.id, title: `Fresh` }
      const mutations: PersistedTx[`mutations`] =
        sequence === `delete then update`
          ? [
              { type: `delete`, key: old.id, value: old },
              { type: `update`, key: old.id, value: fresh },
            ]
          : sequence === `update then delete`
            ? [
                { type: `update`, key: old.id, value: fresh },
                { type: `delete`, key: old.id, value: old },
              ]
            : sequence === `insert replacement`
              ? [{ type: `insert`, key: old.id, value: fresh }]
              : [
                  { type: `update`, key: old.id, value: detailPatch },
                  { type: `update`, key: old.id, value: titlePatch },
                ]
      const authoredDurable = new Map<string, Todo>(
        sequence === `update then delete`
          ? []
          : sequence === `delete then update` ||
              sequence === `insert replacement`
            ? [[old.id, fresh]]
            : [[old.id, { ...old, ...detailPatch, ...titlePatch }]],
      )
      const adapter = createRecordingAdapter([old])
      const coordinator = createCoordinatorHarness()
      const collectionId = `targeted-order-${route}-${sequence}`
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const demand = {}
      const published = createEventGate()
      const publishedSnapshots: Array<Map<string, Todo>> = []
      const publicRows = () =>
        new Map(
          Array.from(collection.values(), (row) => [
            row.id,
            stripVirtualProps(row),
          ]),
        )
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        await collection._sync.loadSubset(demand)
        expectExactSnapshot(publicRows(), new Map([[old.id, old]]))
        if (route === `retired demand`) collection._sync.unloadSubset(demand)
        subscription = collection.subscribeChanges(
          () => {
            publishedSnapshots.push(
              new Map(
                Array.from(publicRows(), ([key, row]) => [
                  key,
                  structuredClone(row),
                ]),
              ),
            )
            published.resolve()
          },
          { includeInitialState: false },
        )
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId },
          {
            txId: `targeted-order`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations,
          },
        )
        expectExactSnapshot(adapter.rows, authoredDurable)
        const changedRows =
          sequence === `two updates`
            ? [
                { key: old.id, value: detailPatch },
                { key: old.id, value: titlePatch },
              ]
            : [{ key: old.id, value: fresh }]
        coordinator.emit(
          {
            type: `tx:committed`,
            term: 1,
            seq: 1,
            txId: `targeted-order`,
            latestRowVersion: 1,
            requiresFullReload: false,
            changedRows,
            deletedKeys:
              sequence === `two updates` || sequence === `insert replacement`
                ? []
                : [old.id],
          },
          undefined,
          collectionId,
        )
        await atPersistedOracleCheckpoint(
          published.promise,
          `targeted same-key notice published`,
        )
        await flushAsyncWork()
        const expected = expectedScopedSnapshot(
          new Map([[old.id, old]]),
          authoredDurable,
          new Map(),
          route === `active demand`,
        )
        expectExactSnapshot(publicRows(), expected)
        expect(publishedSnapshots).toHaveLength(1)
        for (const snapshot of publishedSnapshots)
          expectExactSnapshot(snapshot, expected)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        subscription?.unsubscribe()
        if (route === `active demand`) collection._sync.unloadSubset(demand)
        await cleanupPersistedOracle(
          [() => collection.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )

  type RetainedDemandOperation =
    | { type: `acquire` | `release`; demand: `one` | `two` }
    | { type: `truncate` }
  // The generated prefix varies demand ownership and reset history. Its
  // terminal suffix reaches a retained hydrated demand, fails a source write,
  // then checks the exact error and absence of a new upstream acquisition.
  // The pre-fix fast path returned true and incremented upstreamLoads here.
  // This recording adapter does not establish browser/OPFS behavior.
  const retainedDemandHistory = fc
    .array(
      fc.record({
        type: fc.constantFrom(`acquire` as const, `release` as const),
        demand: fc.constantFrom(`one` as const, `two` as const),
      }),
      { minLength: 1, maxLength: 20 },
    )
    .chain((operations) =>
      fc
        .array(fc.integer({ min: 0, max: operations.length }), {
          maxLength: 4,
        })
        .map((truncatePositions): Array<RetainedDemandOperation> => {
          const positions = new Set(truncatePositions)
          return operations.flatMap((operation, index) =>
            positions.has(index)
              ? [{ type: `truncate` as const }, operation]
              : [operation],
          )
        }),
    )
  const runRetainedDemandHistory = async (
    history: ReadonlyArray<RetainedDemandOperation>,
  ): Promise<void> => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `one` },
      { id: `2`, title: `two` },
    ])
    const loadRows = adapter.loadSubset
    adapter.loadSubset = async (...args) => {
      const rows = await loadRows(...args)
      return rows.slice(0, args[1].limit)
    }
    let truncateSource: (() => void) | undefined
    let failSource: (() => true | Promise<void>) | undefined
    let upstreamLoads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `hydrated-demand-history`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, truncate, commit, markReady }) => {
            truncateSource = () => {
              begin()
              truncate()
              commit()
            }
            failSource = () => {
              begin()
              write({
                type: `insert`,
                value: { id: `terminal-write`, title: `must not persist` },
              })
              return commit()
            }
            markReady()
            return {
              loadSubset: () => {
                upstreamLoads++
                return true
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()
    for (let attempt = 0; attempt < 20 && !truncateSource; attempt++) {
      await flushAsyncWork()
    }
    expect(truncateSource).toBeTypeOf(`function`)

    const active: Record<`one` | `two`, Array<LoadSubsetOptions>> = {
      one: [],
      two: [],
    }
    const hydrated = new Set<`one` | `two`>()
    const optionsFor = (demand: `one` | `two`): LoadSubsetOptions => ({
      limit: demand === `one` ? 1 : 2,
    })

    try {
      for (const operation of history) {
        if (operation.type === `truncate`) {
          truncateSource?.()
          hydrated.clear()
          continue
        }

        const demand = operation.demand
        if (operation.type === `release`) {
          const options = active[demand].pop()
          if (!options) continue
          collection._sync.unloadSubset(options)
          if (active[demand].length === 0) hydrated.delete(demand)
          continue
        }

        const options = optionsFor(demand)
        const result = collection._sync.loadSubset(options)
        expect(result === true).toBe(hydrated.has(demand))
        if (result !== true) await result
        active[demand].push(options)
        hydrated.add(demand)
      }

      // A terminal durability failure is absorbing even when a retained
      // demand still has hydrated rows. No later acquisition owns a new
      // upstream lease or receives synchronous readiness.
      const retained = optionsFor(`one`)
      const retainedResult = collection._sync.loadSubset(retained)
      if (retainedResult !== true) await retainedResult
      const adapterFailure = new Error(`retained demand durability failed`)
      adapter.applyCommittedTx = () => Promise.reject(adapterFailure)
      const failedReceipt = failSource?.()
      if (!(failedReceipt instanceof Promise)) {
        throw new Error(`expected a failing source receipt`)
      }
      const receiptOutcome = await failedReceipt.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const terminalError = collection._lifecycle.getSyncError()
      expect(receiptOutcome).toEqual({
        status: `rejected`,
        reason: terminalError,
      })
      expect(terminalError).toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        cause: adapterFailure,
      })

      const loadsBeforeRetry = upstreamLoads
      let retryFailure: unknown
      try {
        await collection._sync.loadSubset(optionsFor(`one`))
      } catch (error) {
        retryFailure = error
      }
      expect({ retryFailure, upstreamLoads }).toEqual({
        retryFailure: terminalError,
        upstreamLoads: loadsBeforeRetry,
      })
    } finally {
      await collection.cleanup()
    }
  }

  fcTest.prop([retainedDemandHistory], {
    numRuns: oracleRuns(50),
    seed: 186001,
  })(
    `matches the retained exact-demand model with a fixed seed`,
    runRetainedDemandHistory,
  )
  fcTest.prop(
    [retainedDemandHistory],
    oraclePropertyOptions(50, `persistence.retained-demand`),
  )(
    `matches the retained exact-demand model with a random or replayed seed`,
    runRetainedDemandHistory,
  )

  /**
   * A follower has no local source. It routes demand to the elected owner,
   * and the owner's commits reach it only as durable rows plus a commit
   * notice. After a cache rotation the follower is in scoped recovery, where
   * durable rows cannot replace source rows. Rotation gives the follower a
   * fresh cache generation, and the follower asks the owner to reacquire
   * every active demand into it. Once those reacquisitions settle, the new
   * generation holds exactly the owner's rows for that demand, so durable
   * rows are authoritative again. The law is therefore: while the
   * reacquisitions are in flight, the follower holds the generation's commit
   * notices; when they settle, scoped recovery ends for that generation and
   * the held notices, and every later one, apply through the normal path.
   * No sender is special: a peer's notice after recovery is an ordinary
   * invalidation that rereads durable rows.
   *
   * The independent model is `expectedScopedSnapshot` with complete demand
   * over the authored durable rows of the current generation. It knows
   * nothing about notices or scoped recovery; the driver applies it only at
   * checkpoints where the owner's evidence has arrived. The ensure log is a
   * separate observation: one acquisition and one reacquisition after
   * rotation, and no other ensure. A bounded leader that re-commits on every
   * ensure makes the alternative design (answer every notice during scoped
   * recovery with a refetch) loop, and the bound turns that loop into an
   * assertion failure.
   *
   * The grammar crosses when the owner first commits the row (before or
   * after the rotation) with a later broadcast for the same key: none, an
   * owner update, or a peer notice that claims a different value. An owner
   * update's durable read either succeeds or fails. Recovery has ended, so a
   * failed read of it is a real failure: the follower becomes terminal and
   * keeps the rows it showed, instead of silently ignoring the failure as if
   * a new recovery had started during the read.
   * The
   * observations are the follower's rows when its first load settles, after
   * the rotation's reacquisition, and after the later broadcast, plus the
   * ensure log at quiescence. The coordinator is a controlled double of an
   * elected owner; it does not prove the browser transport.
   *
   * Known gap (#2139): production does not end a rotated follower's scoped
   * recovery, so this lane's cells are pinned as failing until it does.
   */
  type FollowerGenerationNoticeHistory = {
    ownerCommit: `before-rotation` | `after-rotation`
    later: `none` | `owner` | `peer`
    // Applies only to a later owner update.
    ownerRead: `ok` | `fails`
    // Control: an owner notice's read is in flight when rotation starts, and
    // then fails. Recovery owns that read, so its failure is ignored.
    readFailsAsRotationStarts?: boolean
    // How the owner's notices in the rotated generation reach the follower:
    // in order, after a gap in the stream position (the follower's position
    // restarts at zero when it rotates), or as an exact-ID reconciliation
    // reload. Each must publish the same rows once recovery ends.
    noticeShape?: `plain` | `gap` | `reconciliation`
  }
  const assertFollowerGenerationNoticeHistory = async ({
    ownerCommit,
    later,
    ownerRead,
    readFailsAsRotationStarts = false,
    noticeShape = `plain`,
  }: FollowerGenerationNoticeHistory): Promise<void> => {
    const readFailure = new Error(`owner update read failed`)
    let failNextRead = false
    let holdNextRead:
      { promise: Promise<void>; reject: (e: unknown) => void } | undefined
    const oldStorageId = `follower-notice-old`
    const newStorageId = `follower-notice-new`
    const ownerId = `elected-owner`
    const v1: Todo = { id: `remote`, title: `Owner row` }
    const v2: Todo = { id: `remote`, title: `Owner update` }
    const durable = new Map<string, Map<string, Todo>>([
      [oldStorageId, new Map()],
      [newStorageId, new Map()],
    ])
    let storageId = oldStorageId
    // The owner's upstream row: present from the start, or only once the
    // owner fetched it after the rotation began.
    let upstream: Todo | undefined =
      ownerCommit === `before-rotation` ? v1 : undefined
    const ensures: Array<{ id: string; refetch: boolean }> = []
    const subscribers = new Map<
      string,
      (message: ProtocolEnvelope<unknown>) => void
    >()
    const versions = new Map<string, number>()
    // Enough commits for every legal history; a refetch loop exceeds it.
    const commitBudget = 8
    let commits = 0
    const notify = (id: string, row: Todo, senderId: string) => {
      // A gap skips one stream position in the rotated generation.
      const skip =
        noticeShape === `gap` && id === newStorageId && !versions.has(id)
          ? 1
          : 0
      const version = (versions.get(id) ?? 0) + 1 + skip
      versions.set(id, version)
      const reconciliation =
        noticeShape === `reconciliation` && id === newStorageId
      subscribers.get(id)?.({
        v: 1,
        dbName: `test-db`,
        collectionId: id,
        senderId,
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: version,
          txId: `${senderId}-${id}-${version}`,
          latestRowVersion: version,
          requiresFullReload: reconciliation,
          ...(reconciliation ? { reconciliationReload: true } : {}),
          changedRows: [{ key: row.id, value: { ...row } }],
          deletedKeys: [],
        } satisfies TxCommitted,
      })
    }
    const ownerCommits = (id: string, row: Todo) => {
      if (commits++ >= commitBudget) return
      durable.get(id)!.set(row.id, structuredClone(row))
      notify(id, row, ownerId)
    }
    const adapter: PersistenceAdapter = {
      loadSubset: async (target) => {
        const hold = holdNextRead
        if (hold) {
          holdNextRead = undefined
          await hold.promise
        }
        if (failNextRead) {
          failNextRead = false
          throw readFailure
        }
        return Array.from(
          durable.get(recordedStorageId(target))!.values(),
          (value) => ({
            key: value.id,
            value: structuredClone(value),
          }),
        )
      },
      claimCacheGeneration: async () => ({
        storageCollectionId: oldStorageId,
        claimId: `follower-notice-claim`,
        expiresAtMs: Date.now() + 60_000,
      }),
      renewCacheGenerationClaim: async () => Date.now() + 60_000,
      rotateCacheGeneration: async () => {
        storageId = newStorageId
        if (ownerCommit === `after-rotation`) upstream = v1
        return {
          storageCollectionId: newStorageId,
          claimId: `follower-notice-claim`,
          expiresAtMs: Date.now() + 60_000,
        }
      },
      releaseCacheGenerationClaim: async () => {},
      loadResumeSnapshot: async () => ({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
      applyCommittedTx: async () => {},
      ensureIndex: async () => {},
    }
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: (id, onMessage) => {
        subscribers.set(id, onMessage)
        return () => {
          if (subscribers.get(id) === onMessage) subscribers.delete(id)
        }
      },
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      // The elected owner loads its upstream and commits it into the
      // requested generation before it replies, on every ensure.
      requestEnsureRemoteSubset: async (id, options) => {
        ensures.push({ id, refetch: options.refetch === true })
        if (upstream) ownerCommits(id, upstream)
      },
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyCommittedTx: (_id, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      pullSince: () =>
        Promise.resolve({
          type: `rpc:pullSince:res`,
          rpcId: `follower-notice-pull`,
          ok: true,
          latestTerm: 1,
          latestSeq: 0,
          latestRowVersion: 0,
          requiresFullReload: false,
          changedKeys: [],
          deletedKeys: [],
        }),
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `follower-generation-notice`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return {
              loadSubset: async () => {},
              restartAfterScopedRecovery: async (cacheRotated) => {
                await cacheRotated
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const demand: LoadSubsetOptions = { limit: 10 }
    const publicRows = () =>
      new Map(
        Array.from(collection.state, ([key, row]) => [
          String(key),
          stripVirtualProps(row) as Todo,
        ]),
      )
    // A checkpoint after the follower has processed every delivered notice:
    // the scan crosses the same apply mutex the notices use.
    const settled = async (label: string) => {
      await flushAsyncWork()
      await atPersistedOracleCheckpoint(
        source.metadata!.persistence!.scanPersistedRows(),
        label,
      )
      await flushAsyncWork()
    }
    const expectOwnerEvidence = (previous: ReadonlyMap<string, Todo>) => {
      const expected = expectedScopedSnapshot(
        previous,
        durable.get(storageId)!,
        new Map(),
        true,
      )
      expectExactSnapshot(publicRows(), expected)
      return expected
    }
    let hasPrimaryFailure = false
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      await atPersistedOracleCheckpoint(
        Promise.resolve(collection._sync.loadSubset(demand)),
        `follower demand settled`,
      )
      await settled(`first-ready notices processed`)
      let visible = expectOwnerEvidence(new Map())

      const persistence = source.metadata?.persistence
      if (!persistence?.startScopedRecovery) {
        throw new Error(`Expected scoped recovery capability`)
      }
      let rotation: Promise<void>
      if (readFailsAsRotationStarts) {
        let reject!: (error: unknown) => void
        const promise = new Promise<void>((_resolve, rejectRead) => {
          reject = rejectRead
        })
        void promise.catch(() => undefined)
        holdNextRead = { promise, reject }
        ownerCommits(oldStorageId, {
          id: `remote`,
          title: `Pre-rotation update`,
        })
        await flushAsyncWork()
        rotation = persistence.startScopedRecovery()
        reject(readFailure)
      } else {
        rotation = persistence.startScopedRecovery()
      }
      await atPersistedOracleCheckpoint(
        rotation,
        `follower cache rotation settled`,
      )
      await atPersistedOracleCheckpoint(
        vi.waitFor(() =>
          expect(ensures.map(({ id }) => id)).toContain(newStorageId),
        ),
        `reacquisition reached the owner`,
      )
      await settled(`reacquisition notices processed`)
      // Answering the owner's notice with another refetch would make the
      // owner commit again, and the follower would refetch forever.
      expect.soft(ensures).toHaveLength(2)
      visible = expectOwnerEvidence(visible)

      if (later === `owner`) {
        upstream = v2
        failNextRead = ownerRead === `fails`
        ownerCommits(newStorageId, v2)
        if (ownerRead === `fails`) {
          // Not settled(): a terminal runtime rejects the checkpoint scan.
          await flushAsyncWork()
          await vi.waitFor(() => expect(collection.status).toBe(`crashed`))
          expectExactSnapshot(publicRows(), visible)
        } else {
          await settled(`owner update processed`)
          expectOwnerEvidence(visible)
        }
      } else if (later === `peer`) {
        // A peer's notice after recovery is an ordinary invalidation: the
        // follower rereads durable rows, which the peer did not change, so
        // its rows stay as they were and it sends no other ensure.
        notify(newStorageId, { id: `remote`, title: `Peer claim` }, `peer-node`)
        await settled(`peer notice processed`)
        expectOwnerEvidence(visible)
      }

      expect(ensures).toEqual([
        { id: oldStorageId, refetch: false },
        { id: newStorageId, refetch: true },
      ])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  }

  // Known gap: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each([
    { ownerCommit: `before-rotation`, later: `none` },
    { ownerCommit: `after-rotation`, later: `none` },
    { ownerCommit: `after-rotation`, later: `owner` },
    { ownerCommit: `before-rotation`, later: `peer` },
  ] as const)(
    `publishes an elected owner's rows to a follower after rotation: commit $ownerCommit, later $later`,
    (history) =>
      assertFollowerGenerationNoticeHistory({ ...history, ownerRead: `ok` }),
  )

  // Known gap: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each(
    ([`gap`, `reconciliation`] as const).flatMap((noticeShape) =>
      ([`before-rotation`, `after-rotation`] as const).flatMap((ownerCommit) =>
        ([`none`, `owner`] as const).map((later) => ({
          ownerCommit,
          later,
          noticeShape,
        })),
      ),
    ),
  )(
    `publishes an elected owner's rows after rotation when its notice is a $noticeShape: commit $ownerCommit, later $later`,
    (history) =>
      assertFollowerGenerationNoticeHistory({ ...history, ownerRead: `ok` }),
  )

  // Known gap: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each([
    { ownerCommit: `before-rotation`, later: `owner` },
    { ownerCommit: `after-rotation`, later: `owner` },
  ] as const)(
    `fails a follower when its elected owner's update cannot be read after rotation: commit $ownerCommit`,
    (history) =>
      assertFollowerGenerationNoticeHistory({ ...history, ownerRead: `fails` }),
  )

  // Known gap: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails(
    `ignores a follower read failure when rotation starts while the read is in flight`,
    () =>
      assertFollowerGenerationNoticeHistory({
        ownerCommit: `before-rotation`,
        later: `none`,
        ownerRead: `ok`,
        readFailsAsRotationStarts: true,
      }),
  )

  const followerGenerationNoticeHistory = fc.record({
    ownerCommit: fc.constantFrom<
      FollowerGenerationNoticeHistory[`ownerCommit`]
    >(`before-rotation`, `after-rotation`),
    later: fc.constantFrom<FollowerGenerationNoticeHistory[`later`]>(
      `none`,
      `owner`,
      `peer`,
    ),
    ownerRead: fc.constantFrom<FollowerGenerationNoticeHistory[`ownerRead`]>(
      `ok`,
      `fails`,
    ),
  })
  // Known gap: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible. Some
  // generated histories pass today, so a random draw cannot be pinned as
  // failing; this fixed seed pins the gap. The fix for #2139 adds the random
  // and replayed campaign back.
  it.fails(
    `checks generated follower generation-notice histories (fixed)`,
    () =>
      fc.assert(
        fc.asyncProperty(
          followerGenerationNoticeHistory,
          assertFollowerGenerationNoticeHistory,
        ),
        { seed: 2128, numRuns: oracleRuns(12) },
      ),
  )

  const expectedFollowerRemoteDemand = (
    history: FollowerRemoteDemandHistory,
  ) => {
    const applied = history.apply === `ok`
    return {
      // While the owner's commit has not applied here, nothing has settled.
      whileApplyHeld: { settled: false, rows: undefined },
      settled:
        history.consumer === `live-query`
          ? applied
            ? { outcome: `fulfilled`, rows: [`remote`], status: `ready` }
            : { outcome: `rejected`, rows: undefined, status: `crashed` }
          : applied
            ? {
                outcome: `fulfilled`,
                rows: [`remote`],
                status: undefined,
                releases: 0,
              }
            : {
                outcome: `rejected`,
                rows: undefined,
                status: `crashed`,
                releases: 1,
              },
    }
  }

  const assertFollowerRemoteDemandHistory = async (
    history: FollowerRemoteDemandHistory,
  ) => {
    const expected = expectedFollowerRemoteDemand(history)
    const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
    const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const tab = createFollowerTab(history)
    const groupQuery = (group: string) =>
      createLiveQueryCollection((q) =>
        q.from({ row: tab.source }).where(({ row }) => eq(row.group, group)),
      )
    const query = groupQuery(`a`)
    const other = groupQuery(`b`)
    try {
      // The consumer's observation: its outcome, and the demanded rows it
      // sees when it settles.
      const seen: {
        outcome: `pending` | `fulfilled` | `rejected`
        rows?: Array<string>
      } = { outcome: `pending` }
      const demandedRows = () =>
        Array.from(tab.source.values())
          .filter((row) => row.group === `a`)
          .map((row) => row.id)
          .sort()
      let settled: Promise<unknown>
      if (history.consumer === `live-query`) {
        query.onFirstReady(() => {
          seen.rows = query.toArray.map((row) => (row as FollowerRow).id).sort()
        })
        settled = query.preload().then(
          () => (seen.outcome = `fulfilled`),
          () => (seen.outcome = `rejected`),
        )
      } else {
        settled = Promise.resolve(
          tab.source._sync.loadSubset({
            where: new IR.Func(`eq`, [
              new IR.PropRef([`group`]),
              new IR.Value(`a`),
            ]),
          }),
        ).then(
          () => {
            seen.outcome = `fulfilled`
            seen.rows = demandedRows()
          },
          () => (seen.outcome = `rejected`),
        )
      }
      if (history.placement === `queued`) void other.preload().catch(() => {})

      if (history.placement === `queued`) {
        // The owner's broadcast arrives while this hydration holds the apply
        // mutex, so it waits in the queue until the hydration ends.
        await within(tab.otherHydrationStarted)
        await new Promise((resolve) => setTimeout(resolve, 0))
        tab.releaseOtherHydration()
      }
      const applyStarted = await within(tab.applyReadStarted)
      await new Promise((resolve) => setTimeout(resolve, 0))
      // Checkpoint: the owner has replied, but its row has not applied here.
      expect({
        applyStarted,
        settled: seen.outcome !== `pending`,
        rows: seen.rows,
      }).toEqual({ applyStarted: true, ...expected.whileApplyHeld })

      tab.releaseApply()
      await within(settled)
      await new Promise((resolve) => setTimeout(resolve, 0))
      // Checkpoint: the apply settled.
      const releasesAtSettle = tab.releases()
      expect({
        outcome: seen.outcome,
        rows: seen.rows,
        ...(`releases` in expected.settled
          ? { releases: releasesAtSettle }
          : {}),
        status:
          expected.settled.status === undefined
            ? undefined
            : history.consumer === `live-query` &&
                expected.settled.status === `ready`
              ? query.status
              : expected.settled.status === `crashed`
                ? history.consumer === `live-query`
                  ? `${query.status}/${tab.source.status}`
                  : tab.source.status
                : tab.source.status,
      }).toEqual({
        outcome: expected.settled.outcome,
        rows: expected.settled.rows,
        ...(`releases` in expected.settled
          ? { releases: expected.settled.releases }
          : {}),
        status:
          expected.settled.status === `crashed` &&
          history.consumer === `live-query`
            ? `crashed/crashed`
            : expected.settled.status,
      })
    } finally {
      await query.cleanup()
      await other.cleanup()
      await tab.source.cleanup()
      errors.mockRestore()
      warnings.mockRestore()
    }
  }

  const followerRemoteDemandHistories: Array<FollowerRemoteDemandHistory> = (
    [`direct`, `queued`, `rotated`, `expired`] as const
  ).flatMap((placement) =>
    ([`ok`, `fails`] as const).flatMap((apply) =>
      ([`live-query`, `load`] as const).map((consumer) => ({
        placement,
        apply,
        consumer,
      })),
    ),
  )
  it.each(
    followerRemoteDemandHistories.filter(
      ({ placement }) => placement !== `rotated`,
    ),
  )(
    `settles a follower's remote demand with the owner's applied rows: $placement broadcast, apply $apply, $consumer`,
    assertFollowerRemoteDemandHistory,
  )
  // Known gap: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each(
    followerRemoteDemandHistories.filter(
      ({ placement }) => placement === `rotated`,
    ),
  )(
    `settles a follower's remote demand with the owner's applied rows: $placement broadcast, apply $apply, $consumer`,
    assertFollowerRemoteDemandHistory,
  )

  // Scoped recovery means durable rows cannot replace source rows. Owner
  // evidence is an exception only in a rotated generation, which holds
  // nothing but the owner's writes. Without a managed generation the old
  // durable cache stays in place, so the model predicts that an owner notice
  // during that recovery republishes none of the untrusted durable rows.
  /**
   * After a cache rotation, a follower reacquires every active demand into
   * the new generation through the owner. The owner commits each demand's
   * rows into that generation and broadcasts them before it replies, so the
   * follower holds those notices. Scoped recovery may end only once every
   * reacquisition has succeeded: before that, the new generation is still
   * incomplete and its durable rows have no authority. Starting scoped
   * recovery withdraws the old generation's rows.
   *
   * The independent model knows each demand's row version per generation:
   * the owner wrote version 1 into the old generation and writes version 2
   * into the new one when it reacquires the demand. Until every
   * reacquisition has settled, neither demand shows a row. If all succeed,
   * both show the new generation's rows, including an owner update that
   * arrived while the reacquisitions were settling. If any fails, the
   * follower stays in scoped recovery, shows no row from the incomplete
   * generation, and the source reports the failure as soon as that
   * reacquisition settles. A reacquisition is a remote request, so the
   * failure is the ready source's failure reason (`reportError()`: the source
   * keeps syncing), never a crash; a crash is only for local storage or an
   * internal invariant (glossary "crash"; maintainer decision for PR #2168).
   *
   * A demand that the caller releases or aborts while it reacquires no longer
   * needs the new generation's rows: its aborted ensure is neither a failure
   * nor a reported error, and the other demands decide the outcome. Releasing
   * it twice changes nothing. A load that fails on its own still counts as a
   * failure even though the failed load gives up its demand.
   *
   * A new demand loaded while the reacquisitions are in flight settles only
   * once they all have: with the rows of the new generation if recovery
   * ended, or rejected if it did not. Its own ensure answering early does not
   * make its held rows visible.
   *
   * Only a recovery that rotated can end this way. A recovery that keeps the
   * old generation, or one in which this node is the leader, leaves scoped
   * recovery in place, and a newer rotation supersedes an older one's
   * reacquisition.
   *
   * Known gap (#2139): production does not yet end scoped recovery after a
   * rotation, so the histories in which recovery should end, or in which a
   * new demand waits for it, are pinned as failing.
   *
   * Limits. A failed reacquisition is not retried; the follower stays in
   * scoped recovery until a later recovery rotates again.
   *
   * The grammar crosses the order in which two demands' reacquisitions
   * settle, whether the owner updates demand a's row (version 3) between
   * the first and last settlement, which reacquisitions fail or are released,
   * and whether a new demand loads during reacquisition. Separate cells start
   * rotation from two reads that find the claim lost, supersede reacquisition
   * by a rotation as leader, and recover without rotating. The driver
   * observes the rows, the new load's outcome, and the source status after
   * every settlement, plus the ensure count, which a refetch loop would
   * exceed.
   */
  type RotatedReacquisitionHistory = {
    order: [`a`, `b`] | [`b`, `a`]
    noticeBetween: boolean
    // Which reacquisitions fail. `released` means demand b is released
    // while it reacquires, so its ensure aborts; that is not a failure.
    fails: `none` | `a` | `b` | `both` | `released`
    // A new demand, c, loads while the reacquisitions are in flight.
    newDemand?: boolean
    // While reacquisition is in flight, the node is elected leader and a
    // second rotation supersedes the first; it then follows again, and a new
    // demand c loads. With nothing reacquiring, the node stays in scoped
    // recovery: held notices must still be handled, not queued forever.
    supersededAsLeader?: boolean
    // How rotation starts: the source asks for scoped recovery after both
    // demands loaded, or both demands' first reads are in flight when the
    // cache claim is found lost.
    trigger?: `source` | `claim-lost-during-reads`
  }
  type VersionedRow = { id: string; group: string; v: number }
  type ReacquisitionObservation = {
    rows: Record<`a` | `b` | `c`, number | undefined>
    // The new demand's load, when the history has one.
    newLoad?: `pending` | `fulfilled` | `rejected`
    // `retrying`: ready, with a failure reason.
    status: `crashed` | `retrying` | `healthy`
  }
  const expectedReacquisition = (
    history: RotatedReacquisitionHistory,
    settled: number,
  ): ReacquisitionObservation => {
    const fails = (group: `a` | `b`) =>
      history.fails === group || history.fails === `both`
    const allSettled = settled === 2
    const ended = allSettled && !fails(`a`) && !fails(`b`)
    // A failed reacquisition is reported when it settles, and the next
    // remote request that succeeds clears it (maintainer decision: a coarse
    // clear). A released demand's aborted ensure is neither.
    let failed = false
    for (const group of history.order.slice(0, settled))
      if (fails(group)) failed = true
      else if (!(group === `b` && history.fails === `released`)) failed = false
    return {
      rows: ended
        ? {
            a: history.noticeBetween ? 3 : 2,
            // A released demand's held notice still applies once recovery
            // ends; the new generation's rows are trusted then.
            b: 2,
            c: history.newDemand ? 2 : undefined,
          }
        : { a: undefined, b: undefined, c: undefined },
      ...(history.newDemand
        ? {
            newLoad: !allSettled
              ? (`pending` as const)
              : ended
                ? (`fulfilled` as const)
                : (`rejected` as const),
          }
        : {}),
      status: failed ? `retrying` : `healthy`,
    }
  }

  // Each model predicts the observation from the authored history alone: the
  // follower's settled outcome and rows, and the rotated generation's rows,
  // load status, and error state after the given number of settlements.
  declareOracle({
    model: [expectedFollowerRemoteDemand, expectedReacquisition],
  })

  const assertRotatedReacquisition = async (
    history: RotatedReacquisitionHistory,
  ) => {
    const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
    const warnings = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const oldStorageId = `reacquire-old`
    const newStorageId = `reacquire-new`
    const durable = new Map<string, Map<string, VersionedRow>>([
      [oldStorageId, new Map()],
      [newStorageId, new Map()],
    ])
    let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
    const seqs = new Map<string, number>()
    const ownerCommits = (storageId: string, row: VersionedRow) => {
      const seq = (seqs.get(storageId) ?? 0) + 1
      seqs.set(storageId, seq)
      durable.get(storageId)!.set(row.id, row)
      const payload: TxCommitted = {
        type: `tx:committed`,
        term: 1,
        seq,
        txId: `owner-${storageId}-${seq}`,
        latestRowVersion: seq,
        requiresFullReload: false,
        changedRows: [{ key: row.id, value: row }],
        deletedKeys: [],
      }
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId: storageId,
        senderId: `owner`,
        ts: Date.now(),
        payload,
      })
    }
    type Reply = {
      resolve: () => void
      reject: (error: unknown) => void
    }
    const replies = new Map<string, Reply>()
    let ensures = 0
    let cEnsures = 0
    const groupOf = (options: LoadSubsetOptions) => {
      const where = options.where as IR.Func | undefined
      const value = where?.args[1] as IR.Value | undefined
      return value?.value as `a` | `b` | `c` | undefined
    }
    const duringReads = history.trigger === `claim-lost-during-reads`
    const firstReads = createDeferred()
    let reads = 0
    let claimLost = false
    const adapter = {
      loadSubset: async (
        target: PersistedStorageTarget,
      ): Promise<Array<{ key: string; value: VersionedRow }>> => {
        if (duringReads && ++reads <= 2) {
          await firstReads.promise
          claimLost = true
        }
        return Array.from(
          durable.get(recordedStorageId(target))!.values(),
          (value) => ({ key: value.id, value: { ...value } }),
        )
      },
      claimCacheGeneration: async () => ({
        storageCollectionId: oldStorageId,
        claimId: `reacquire-claim`,
        expiresAtMs: Date.now() + 60_000,
      }),
      renewCacheGenerationClaim: async () =>
        claimLost ? undefined : Date.now() + 60_000,
      rotateCacheGeneration: async () => {
        claimLost = false
        return {
          storageCollectionId: newStorageId,
          claimId: `reacquire-claim-2`,
          expiresAtMs: Date.now() + 60_000,
        }
      },
      releaseCacheGenerationClaim: async () => {},
      loadResumeSnapshot: () =>
        Promise.resolve({
          rows: [],
          keySet: { status: `consistent` },
          collectionMetadata: [],
          latestTerm: 0,
          latestSeq: 0,
          latestRowVersion: 0,
          resetEpoch: 0,
        }),
      applyCommittedTx: async () => {},
      ensureIndex: async () => {},
    } as unknown as PersistenceAdapter
    let leader = false
    const coordinator = {
      getNodeId: () => `follower`,
      subscribe: (
        _collectionId: string,
        onMessage: (message: ProtocolEnvelope<unknown>) => void,
      ) => {
        subscriber = onMessage
        return () => {
          subscriber = undefined
        }
      },
      publish: () => {},
      isLeader: () => leader,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      // The owner commits the demand's row into the requesting generation
      // and broadcasts it before it replies. In the new generation the
      // driver releases the reply; a later refetch finds nothing new.
      requestEnsureRemoteSubset: (
        storageId: string,
        options: LoadSubsetOptions,
      ) => {
        ensures++
        const group = groupOf(options)
        if (!group) return Promise.resolve()
        if (storageId === oldStorageId) {
          ownerCommits(oldStorageId, { id: `${group}-row`, group, v: 1 })
          return Promise.resolve()
        }
        if (group === `c`) cEnsures++
        if (replies.has(group) || (group === `c` && cEnsures > 1))
          return Promise.resolve()
        ownerCommits(newStorageId, { id: `${group}-row`, group, v: 2 })
        // The new demand's ensure answers at once; the follower must still
        // hold its rows until reacquisition ends.
        if (group === `c`) return Promise.resolve()
        return new Promise<void>((resolve, reject) => {
          replies.set(group, { resolve, reject })
        })
      },
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyCommittedTx: (_collectionId: string, tx: TxCommitted) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.seq,
        }),
      pullSince: (storageId: string) =>
        Promise.resolve({
          type: `rpc:pullSince:res`,
          rpcId: `reacquire-pull`,
          ok: true,
          latestTerm: 1,
          latestSeq: seqs.get(storageId) ?? 0,
          latestRowVersion: seqs.get(storageId) ?? 0,
          requiresFullReload: true,
          changedKeys: [],
          deletedKeys: [],
        }),
    } as unknown as PersistedCollectionCoordinator
    let sourceParams: SyncConfig<VersionedRow, string>[`sync`] extends (
      params: infer P,
    ) => unknown
      ? P
      : never
    const source = createCollection(
      persistedCollectionOptions<VersionedRow, string>({
        id: `follower-reacquire-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        persistence: { adapter, coordinator },
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            sourceParams = params
            // A ready source: only a ready Collection can carry the failed
            // reacquisition as its failure reason.
            params.markReady()
            return {
              loadSubset: () => Promise.resolve(),
              restartAfterScopedRecovery: () => {},
            }
          },
        },
      }),
    )
    source.startSyncImmediate()
    let newLoad: `pending` | `fulfilled` | `rejected` = `pending`
    const observe = (): ReacquisitionObservation => ({
      rows: {
        a: source.get(`a-row`)?.v,
        b: source.get(`b-row`)?.v,
        c: source.get(`c-row`)?.v,
      },
      ...(history.newDemand ? { newLoad } : {}),
      status:
        source.status === `crashed`
          ? `crashed`
          : source.health.failureReason
            ? `retrying`
            : `healthy`,
    })
    const turn = () => new Promise((resolve) => setTimeout(resolve, 0))
    const settle = async () => {
      for (let i = 0; i < 8; i++) await turn()
    }
    const demand = (group: `a` | `b` | `c`): LoadSubsetOptions => ({
      where: new IR.Func(`eq`, [
        new IR.PropRef([`group`]),
        new IR.Value(group),
      ]),
    })
    const demands = { a: demand(`a`), b: demand(`b`), c: demand(`c`) }
    const load = (group: `a` | `b` | `c`) =>
      source._sync.loadSubset(demands[group])
    try {
      if (duringReads) {
        // Both first reads are in flight when the claim is found lost.
        void Promise.resolve(load(`a`)).catch(() => undefined)
        void Promise.resolve(load(`b`)).catch(() => undefined)
        await settle()
        firstReads.resolve()
      } else {
        for (const group of [`a`, `b`] as const) await load(group)
        await settle()
        expect(observe().rows).toEqual({ a: 1, b: 1 })
        void sourceParams!.metadata!.persistence!.startScopedRecovery!()
      }
      await vi.waitFor(() => expect(replies.size).toBe(2), { timeout: 2_000 })
      await settle()
      if (history.newDemand) {
        void Promise.resolve(load(`c`)).then(
          () => (newLoad = `fulfilled`),
          () => (newLoad = `rejected`),
        )
      }
      if (history.fails === `released`) {
        // Releasing the same demand twice must be idempotent.
        source._sync.unloadSubset(demands.b)
        source._sync.unloadSubset(demands.b)
      }
      await settle()
      // Checkpoint: both reacquisitions are in flight.
      expect(observe()).toEqual(expectedReacquisition(history, 0))
      if (history.supersededAsLeader) {
        leader = true
        await sourceParams!.metadata!.persistence!.startScopedRecovery!()
        await settle()
        leader = false
        let outcome: `pending` | `fulfilled` | `rejected` = `pending`
        void Promise.resolve(load(`c`)).then(
          () => (outcome = `fulfilled`),
          () => (outcome = `rejected`),
        )
        await settle()
        // Checkpoint: the superseded reacquisition no longer holds notices.
        // The node stays in scoped recovery with nothing reacquiring, so the
        // owner's notice for c is handled by one refetch instead of waiting
        // in the queue forever; the untrusted generation shows no row.
        expect({ outcome, cEnsures, c: source.get(`c-row`)?.v }).toEqual({
          outcome: `fulfilled`,
          cEnsures: 2,
          c: undefined,
        })
        for (const reply of replies.values()) reply.resolve()
        return
      }
      for (const [index, group] of history.order.entries()) {
        if (index === 1 && history.noticeBetween) {
          ownerCommits(newStorageId, { id: `a-row`, group: `a`, v: 3 })
          await settle()
        }
        if (history.fails === `released` && group === `b`) {
          const aborted = new Error(`released`)
          aborted.name = `AbortError`
          replies.get(group)!.reject(aborted)
        } else if (history.fails === group || history.fails === `both`)
          replies.get(group)!.reject(new Error(`reacquire ${group} failed`))
        else replies.get(group)!.resolve()
        await settle()
        // Checkpoint: after each settlement.
        expect(observe()).toEqual(expectedReacquisition(history, index + 1))
      }
      // Two acquisitions and two reacquisitions, a new demand's ensure, plus
      // one refresh per held notice when recovery stays; a refetch loop
      // exceeds the bound.
      expect(ensures).toBeLessThanOrEqual(16)
    } finally {
      await source.cleanup()
      errors.mockRestore()
      warnings.mockRestore()
    }
  }

  const rotatedReacquisitionHistories: Array<RotatedReacquisitionHistory> = (
    [
      [`a`, `b`],
      [`b`, `a`],
    ] as const
  ).flatMap((order) =>
    [false, true].flatMap((noticeBetween) =>
      ([`none`, `a`, `b`, `both`, `released`] as const).flatMap((fails) =>
        [false, true].map((newDemand) => ({
          order: [...order],
          noticeBetween,
          fails,
          newDemand,
        })),
      ),
    ),
  )
  // Known gap: see #2139. Recovery never ends today, so the histories in
  // which it should end, or in which a new demand must wait for it, fail.
  const reacquisitionGap = ({
    fails,
    newDemand,
  }: RotatedReacquisitionHistory) =>
    newDemand === true || fails === `none` || fails === `released`
  it.each(
    rotatedReacquisitionHistories.filter(
      (history) => !reacquisitionGap(history),
    ),
  )(
    `ends a follower's scoped recovery only after every reacquisition succeeds: order $order, notice between $noticeBetween, fails $fails, new demand $newDemand`,
    assertRotatedReacquisition,
    10_000,
  )
  it.fails.each(rotatedReacquisitionHistories.filter(reacquisitionGap))(
    `ends a follower's scoped recovery only after every reacquisition succeeds: order $order, notice between $noticeBetween, fails $fails, new demand $newDemand`,
    assertRotatedReacquisition,
    10_000,
  )
  it(
    `releases held notices when a second rotation supersedes reacquisition as leader`,
    () =>
      assertRotatedReacquisition({
        order: [`a`, `b`],
        noticeBetween: false,
        fails: `none`,
        supersededAsLeader: true,
      }),
    10_000,
  )
  // Two hydrations that both find the claim lost queue work while the
  // follower reacquires. Their flushes must leave the held notices alone;
  // otherwise each notice refreshes the scoped demand and the follower spins.
  it(
    `holds a rotated follower's notices when two reads find the claim lost: fails 'a'`,
    () =>
      assertRotatedReacquisition({
        order: [`a`, `b`],
        noticeBetween: false,
        fails: `a`,
        trigger: `claim-lost-during-reads`,
      }),
    10_000,
  )
  // Known gap: see #2139. Recovery never ends, so the rows stay hidden.
  it.fails(
    `holds a rotated follower's notices when two reads find the claim lost: fails 'none'`,
    () =>
      assertRotatedReacquisition({
        order: [`a`, `b`],
        noticeBetween: false,
        fails: `none`,
        trigger: `claim-lost-during-reads`,
      }),
    10_000,
  )

  const followerRemoteDemandHistory = fc.record({
    // Known gap: see #2139. The rotated placement is pinned above.
    placement: fc.constantFrom<FollowerRemoteDemandHistory[`placement`]>(
      `direct`,
      `queued`,
      `expired`,
    ),
    apply: fc.constantFrom<FollowerRemoteDemandHistory[`apply`]>(`ok`, `fails`),
    consumer: fc.constantFrom<FollowerRemoteDemandHistory[`consumer`]>(
      `live-query`,
      `load`,
    ),
  })
  fcTest.prop(
    [followerRemoteDemandHistory],
    oraclePropertyOptions(12, `persistence.follower-remote-demand`),
  )(
    `checks generated follower remote-demand histories (random or replayed)`,
    assertFollowerRemoteDemandHistory,
  )

  it.each(persistedKeySetEvidenceStatuses.map((status) => ({ status })))(
    `keeps on-demand rows independent from $status baseline evidence`,
    async ({ status }) => {
      const adapter = createRecordingAdapter([
        { id: `on-demand`, title: `On-demand row` },
      ])
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (...args) => ({
        ...(await loadResumeSnapshot(...args)),
        rows: [
          {
            key: `baseline`,
            value: { id: `baseline`, title: `Baseline row` },
          },
        ],
        keySet: { status },
      })
      let hydrateBaseline: (() => Promise<void>) | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `${status}-baseline-and-on-demand`,
          syncMode: `on-demand`,
          getKey: (item) => item.id,
          sync: {
            sync: ({ markReady, metadata }) => {
              const capability = metadata?.persistence
              if (!capability) {
                throw new Error(`Expected persisted sync capability`)
              }
              hydrateBaseline = capability.hydrateBaseline
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )

      try {
        collection.startSyncImmediate()
        await vi.waitFor(() => expect(hydrateBaseline).toBeTypeOf(`function`))
        await hydrateBaseline!()
        await flushAsyncWork()
        await flushAsyncWork()

        const baselineVisible = collection.has(`baseline`)
        expect(collection.has(`on-demand`)).toBe(false)
        await collection._sync.loadSubset({})

        expectOnDemandEvidenceLaw({
          status,
          route: `loadSubset`,
          baselineVisible,
          onDemandVisible: collection.has(`on-demand`),
        })
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(persistedKeySetEvidenceStatuses.map((status) => ({ status })))(
    `keeps force reload rows independent from $status startup evidence`,
    async ({ status }) => {
      const adapter = createRecordingAdapter([
        { id: `on-demand`, title: `On-demand row` },
      ])
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (...args) => ({
        ...(await loadResumeSnapshot(...args)),
        keySet: { status },
      })
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `${status}-local-only-force-reload`,
          syncMode: `on-demand`,
          getKey: (item) => item.id,
          persistence: { adapter },
        }),
      )

      try {
        collection.startSyncImmediate()
        await vi.waitFor(() =>
          expect(adapter.loadResumeSnapshotCalls.length).toBeGreaterThan(0),
        )
        await collection.utils.forceReloadSubset!({})

        expect(adapter.loadResumeSnapshotCalls[0]?.includeRows).toBe(false)
        expectOnDemandEvidenceLaw({
          status,
          route: `forceReloadSubset`,
          // This local-only route reads startup evidence but does not expose
          // baseline hydration. Do not claim a baseline observation here.
          baselineVisible: `not-observed`,
          onDemandVisible: collection.has(`on-demand`),
        })
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`rejects an evidence-coupled on-demand hydration mutant`, () => {
    expect(() =>
      expectOnDemandEvidenceLaw({
        status: `incompatible`,
        route: `loadSubset`,
        baselineVisible: false,
        onDemandVisible: false,
      }),
    ).toThrow(`on-demand rows must not inherit baseline evidence rejection`)

    expectOnDemandEvidenceLaw({
      status: `incompatible`,
      route: `loadSubset`,
      baselineVisible: false,
      onDemandVisible: true,
    })
  })

  it(`keeps generated crossed-leadership index RPC histories outside local hydration scopes`, async () => {
    let run = 0
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          tabCount: fc.integer({ min: 2, max: 4 }),
          indexCount: fc.integer({ min: 1, max: 2 }),
          direction: fc.constantFrom(-1, 1),
        }),
        async ({ tabCount, indexCount, direction }) => {
          run++
          const allTabsAtLocalIndex = createDeferred()
          let tabsAtLocalIndex = 0
          const tabs = Array.from({ length: tabCount }, () => {
            const adapter = createRecordingAdapter()
            let hydrationScopeActive = false
            let localIndexCalls = 0
            const remoteScopeObservations: Array<boolean> = []
            const publicEnsureIndex = adapter.ensureIndex.bind(adapter)
            const scopedAdapter: PersistenceAdapter = {
              ...adapter,
              ensureIndex: async (...args) => {
                localIndexCalls++
                if (localIndexCalls === 1) {
                  tabsAtLocalIndex++
                  if (tabsAtLocalIndex === tabCount) {
                    allTabsAtLocalIndex.resolve()
                  }
                  await allTabsAtLocalIndex.promise
                }
                await publicEnsureIndex(...args)
              },
            }
            adapter.runInHydrationScope = async (task) => {
              hydrationScopeActive = true
              try {
                return await task(scopedAdapter)
              } finally {
                hydrationScopeActive = false
              }
            }
            adapter.ensureIndex = async (...args) => {
              remoteScopeObservations.push(hydrationScopeActive)
              await publicEnsureIndex(...args)
            }
            return { adapter, remoteScopeObservations }
          })

          const collections = tabs.map((tab, index) => {
            const remoteIndex = (index + direction + tabCount) % tabCount
            const coordinator = createCoordinatorHarness()
            coordinator.isLeader = () => false
            coordinator.requestEnsurePersistedIndex = (
              collectionId,
              signature,
              spec,
            ) =>
              tabs[remoteIndex]!.adapter.ensureIndex(
                { kind: `eager`, collectionId: collectionId },
                signature,
                spec,
              )
            const collection = createCollection(
              persistedCollectionOptions<Todo, string>({
                id: `generated-crossed-${run}-${index}`,
                getKey: (item) => item.id,
                defaultIndexType: BasicIndex,
                sync: {
                  sync: ({ markReady }) => {
                    markReady()
                  },
                },
                persistence: { adapter: tab.adapter, coordinator },
              }),
            )
            for (
              let indexOrdinal = 0;
              indexOrdinal < indexCount;
              indexOrdinal++
            ) {
              collection.createIndex(
                indexOrdinal % 2 === 0 ? (row) => row.title : (row) => row.id,
                { name: `idx-${indexOrdinal}` },
              )
            }
            return collection
          })

          try {
            await Promise.all(
              collections.map((collection) => collection.preload()),
            )
            for (const tab of tabs) {
              expect(tab.remoteScopeObservations).toEqual(
                Array.from({ length: indexCount }, () => false),
              )
            }
          } finally {
            await Promise.all(
              collections.map((collection) => collection.cleanup()),
            )
          }
        },
      ),
      { seed: 1868, numRuns: 8, endOnFailure: true },
    )
  })

  // Focused R7 causal-replay witness: after hydration releases its buffer, the
  // source receipt must replay without awaiting the persisting operation whose
  // callback is itself awaiting that receipt. Persistence reach, both public
  // settlements, and the final source row expose the otherwise hidden cycle.
  itUnlessAnyOracleReplay.each(hydrationScopeModes)(
    `replays a buffered source receipt without blocking its persisting predecessor (%s scope)`,
    async (scopeMode) => {
      const adapter = createRecordingAdapter()
      const hydrateLoadEntered = createDeferred()
      const allowHydrateLoad = createDeferred()
      let gateHydrationLoad = true
      const replayState = { persisted: false }

      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (...args) => {
        if (args[1]?.includeRows === true && gateHydrationLoad) {
          gateHydrationLoad = false
          hydrateLoadEntered.resolve()
          await allowHydrateLoad.promise
        }
        return loadResumeSnapshot(...args)
      }
      const applyCommittedTx = adapter.applyCommittedTx
      adapter.applyCommittedTx = async (...args) => {
        replayState.persisted = true
        await applyCommittedTx(...args)
      }
      const routing = configureHydrationScope(adapter, scopeMode)
      const accepted = createDeferred()
      const releaseMutation = createDeferred()

      let remoteBegin: (() => void) | undefined
      let remoteWrite:
        ((message: { type: `update`; value: Todo }) => void) | undefined
      let remoteCommit: (() => true | Promise<void>) | undefined
      const sourceReady = createDeferred()
      const bufferedCommitReturned = createDeferred<{
        receipt: Promise<void>
      }>()

      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-present-buffered-causal-replay`,
          getKey: (item) => item.id,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              remoteBegin = begin
              remoteWrite = write as (message: {
                type: `update`
                value: Todo
              }) => void
              remoteCommit = commit
              sourceReady.resolve()
              markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
          onInsert: async () => {
            if (!remoteBegin || !remoteWrite || !remoteCommit) {
              throw new Error(`source sync is not ready`)
            }
            remoteBegin()
            remoteWrite({
              type: `update`,
              value: { id: `source-row`, title: `Buffered during hydrate` },
            })
            const applied = remoteCommit()
            if (applied === true) {
              throw new Error(`source commit was not buffered during hydration`)
            }
            bufferedCommitReturned.resolve({ receipt: applied })
            // The handler waits for acceptance; the row becomes visible when
            // this mutation settles.
            await whenSyncAccepted(applied)
            accepted.resolve()
            await releaseMutation.promise
          },
        }),
      )

      const preload = Promise.resolve(collection.preload())
      void preload.catch(() => undefined)
      let mutationPersisted: Promise<unknown> | undefined
      let bufferedReceipt: Promise<void> | undefined
      let hasPrimaryFailure = false

      try {
        await atPersistedOracleCheckpoint(
          hydrateLoadEntered.promise,
          `buffered causal replay hydration entered`,
        )
        await atPersistedOracleCheckpoint(
          sourceReady.promise,
          `buffered causal replay source ready`,
        )

        const mutation = collection.insert({ id: `local`, title: `Pending` })
        mutationPersisted = mutation.isPersisted.promise
        void mutationPersisted.catch(() => undefined)
        const bufferedCommit = await atPersistedOracleCheckpoint(
          bufferedCommitReturned.promise,
          `buffered causal replay commit returned`,
        )
        bufferedReceipt = bufferedCommit.receipt
        void bufferedReceipt.catch(() => undefined)

        allowHydrateLoad.resolve()

        await atPersistedOracleCheckpoint(
          accepted.promise,
          `source accepted before optimistic publication`,
        )
        expect(routing?.violations() ?? []).toEqual([])
        const appliedState = observeSettlement(bufferedReceipt)
        await flushAsyncWork()
        expect(appliedState.read()).toEqual({ status: `pending` })
        expect(adapter.rows.get(`source-row`)).toEqual({
          id: `source-row`,
          title: `Buffered during hydrate`,
        })
        expect(collection.get(`source-row`)).toBeUndefined()
        releaseMutation.resolve()
        // The replay is accepted and stored while the mutation persists; its
        // receipt resolves when the mutation settles and the row publishes.
        await expect(
          atPersistedOracleCheckpoint(
            mutationPersisted,
            `buffered causal replay mutation persisted`,
          ),
        ).resolves.toBeDefined()
        expect(replayState.persisted).toBe(true)
        await expect(
          atPersistedOracleCheckpoint(
            bufferedReceipt,
            `buffered causal replay source receipt`,
          ),
        ).resolves.toBeUndefined()
        await expect(
          atPersistedOracleCheckpoint(
            preload,
            `buffered causal replay preload settled`,
          ),
        ).resolves.toBeUndefined()
        expect(stripVirtualProps(collection.get(`source-row`))).toEqual({
          id: `source-row`,
          title: `Buffered during hydrate`,
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        allowHydrateLoad.resolve()
        releaseMutation.resolve()
        await cleanupPersistedOracle(
          [() => collection.cleanup()],
          hasPrimaryFailure,
        )
      }
    },
  )
})

/**
 * Source durability refines RFC #1659's durable-or-observably-failed law and
 * PersistenceAdapter.runInHydrationScope's ownership/lifetime contract. Each
 * source receipt waits for its own durability and visibility. Nested storage
 * uses the current supplied adapter; ordinary storage uses the registered
 * adapter after that callback exits. Empty transactions have no durable work;
 * metadata and truncate do, even with no row mutations.
 *
 * The finite grammar below composes those laws with startup, subscription,
 * and after-ready source commits, zero/one baseline row, distinct/same keys,
 * metadata, truncate, independent aborts, and first/second durability failure.
 * It does not model arbitrary schedules, dependent aborts, optimistic state,
 * SQL, or fairness. Existing owners below/above retain those laws; the OPFS
 * receiver supplies the actual shared scheduler premise. No random campaign
 * or universal liveness claim follows from this bounded enumeration.
 */
type HydrationSourceEdit =
  | { type: `put`; row: Todo }
  | { type: `remove`; key: string }
  | { type: `truncate` }
  | {
      type: `row-metadata` | `collection-metadata`
      key: string
      value?: unknown
    }

type HydrationSourceTransaction = {
  edits: Array<HydrationSourceEdit>
  abort?: boolean
}

// An immutable edit log supplies the model. The last row edit after the last
// truncate wins; metadata follows its own last edit, and deleting a row drops
// its metadata. Collection metadata survives truncate. This recomputation has
// no hydration state, queue, adapter classifier, or production helper. Aborted
// independent transactions contribute no edits. Inputs are cloned before the
// driver sees them so a mutated input cannot alter the expected answer.
function hydrationSourceSnapshot(
  baseline: Array<Todo>,
  transactions: Array<HydrationSourceTransaction>,
): {
  rows: Array<Todo>
  rowMetadata: Array<[string, unknown]>
  collectionMetadata: Array<[string, unknown]>
} {
  const edits: Array<HydrationSourceEdit> = [
    ...baseline.map((row) => ({ type: `put` as const, row })),
    ...transactions.filter((tx) => !tx.abort).flatMap((tx) => tx.edits),
  ]
  const keys = new Set(
    edits.flatMap((edit) => (edit.type === `put` ? [edit.row.id] : [])),
  )
  const rows = [...keys]
    .flatMap((key) => {
      const latest = [...edits]
        .reverse()
        .find(
          (edit) =>
            edit.type === `truncate` ||
            (edit.type === `put` && edit.row.id === key) ||
            (edit.type === `remove` && edit.key === key),
        )
      return latest?.type === `put` ? [structuredClone(latest.row)] : []
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const metadata = (kind: `row-metadata` | `collection-metadata`) => {
    const metadataKeys = new Set(
      edits.flatMap((edit) => (edit.type === kind ? [edit.key] : [])),
    )
    return [...metadataKeys].sort().flatMap((key): Array<[string, unknown]> => {
      const latest = [...edits]
        .reverse()
        .find(
          (edit) =>
            (edit.type === kind && edit.key === key) ||
            (kind === `row-metadata` &&
              (edit.type === `truncate` ||
                (edit.type === `remove` && edit.key === key))),
        )
      return latest?.type === kind && latest.value !== undefined
        ? [[key, structuredClone(latest.value)]]
        : []
    })
  }
  return {
    rows,
    rowMetadata: metadata(`row-metadata`),
    collectionMetadata: metadata(`collection-metadata`),
  }
}

// Durable admission law: only transactions that are not aborted and carry at
// least one edit reach the durable write path, in submission order. Aborted and
// empty transactions never admit, so they are not counted or awaited as durable.
function expectedDurableHydrationTransactions(
  transactions: Array<HydrationSourceTransaction>,
): Array<HydrationSourceTransaction> {
  return transactions.filter((tx) => !tx.abort && tx.edits.length > 0)
}

// A routing reproduction must not contaminate a requested generated-property
// replay from this shared file. These bounded cases exclude every explicit replay.
// Terminal local persistence failures crash the Collection after readiness,
// following the IndexedDB closure precedent. Upstream (wrapped sync adapter)
// failures after readiness stay health metadata; this lane holds both.
describeUnlessAnyOracleReplay(`hydration source durability routing`, () => {
  const first = { id: `shared`, title: `first source value` }
  const second = { id: `shared`, title: `last source value` }
  const other = { id: `other`, title: `independent source value` }
  const histories: Array<{
    name: string
    transactions: Array<HydrationSourceTransaction>
    failAt?: number
  }> = [
    {
      name: `one upsert`,
      transactions: [{ edits: [{ type: `put`, row: first }] }],
    },
    {
      name: `two distinct upserts`,
      transactions: [
        { edits: [{ type: `put`, row: first }] },
        { edits: [{ type: `put`, row: other }] },
      ],
    },
    {
      name: `same-key replacement and delete`,
      transactions: [
        { edits: [{ type: `put`, row: first }] },
        { edits: [{ type: `put`, row: second }] },
        { edits: [{ type: `remove`, key: first.id }] },
      ],
    },
    {
      name: `truncate and replacement`,
      transactions: [
        { edits: [{ type: `put`, row: first }] },
        {
          edits: [
            { type: `collection-metadata`, key: `cursor`, value: 2 },
            { type: `truncate` },
          ],
        },
        { edits: [{ type: `put`, row: other }] },
      ],
    },
    {
      name: `metadata-only and delete`,
      transactions: [
        { edits: [{ type: `put`, row: first }] },
        {
          edits: [
            { type: `row-metadata`, key: first.id, value: { owner: `source` } },
            { type: `collection-metadata`, key: `cursor`, value: 1 },
          ],
        },
        {
          edits: [
            { type: `row-metadata`, key: first.id },
            { type: `collection-metadata`, key: `cursor` },
          ],
        },
      ],
    },
    {
      name: `collection metadata only`,
      transactions: [
        { edits: [{ type: `collection-metadata`, key: `cursor`, value: 3 }] },
      ],
    },
    {
      name: `truncate only`,
      transactions: [{ edits: [{ type: `truncate` }] }],
    },
    { name: `empty transaction`, transactions: [{ edits: [] }] },
    {
      name: `atomic row batch`,
      transactions: [
        {
          edits: [
            { type: `put`, row: first },
            { type: `put`, row: other },
            { type: `collection-metadata`, key: `cursor`, value: 4 },
          ],
        },
      ],
    },
    {
      name: `independent aborted predecessor`,
      transactions: [
        { edits: [{ type: `put`, row: first }], abort: true },
        { edits: [{ type: `put`, row: other }] },
      ],
    },
    {
      name: `first durability failure`,
      transactions: [
        { edits: [{ type: `put`, row: first }] },
        { edits: [{ type: `put`, row: other }] },
      ],
      failAt: 0,
    },
    {
      name: `second durability failure`,
      transactions: [
        { edits: [{ type: `put`, row: first }] },
        { edits: [{ type: `put`, row: second }] },
        { edits: [{ type: `put`, row: other }] },
      ],
      failAt: 1,
    },
  ]
  const cases = ([`startup`, `subscription`, `after-ready`] as const).flatMap(
    (phase) =>
      [false, true].flatMap((scoped) =>
        [0, 1].flatMap((baselineCount) =>
          histories.map((history) => ({
            phase,
            scoped,
            baselineCount,
            ...history,
          })),
        ),
      ),
  )

  it.each(cases)(
    `$phase scoped=$scoped baseline=$baselineCount $name`,
    async ({ phase, scoped, baselineCount, transactions, failAt }) => {
      // The shared key makes source precedence over persisted data observable.
      const baseline = baselineCount
        ? [{ id: `shared`, title: `old persisted value` }]
        : []
      const modelTransactions = structuredClone(transactions)
      const adapter = createRecordingAdapter(structuredClone(baseline))
      let readEntered = createDeferred()
      let releaseRead = createDeferred()
      let holdRead = phase === `startup`
      const load = adapter.loadSubset.bind(adapter)
      const resume = adapter.loadResumeSnapshot.bind(adapter)
      const held = async <T>(snapshot: T): Promise<T> => {
        if (holdRead) {
          holdRead = false
          readEntered.resolve()
          await releaseRead.promise
        }
        return snapshot
      }
      adapter.loadResumeSnapshot = async (...args) => {
        const result = await resume(...args)
        return args[1]?.includeRows === false ? result : held(result)
      }
      adapter.loadSubset = async (...args) => held(await load(...args))
      const durableTransactions =
        expectedDurableHydrationTransactions(modelTransactions)
      const admissions = durableTransactions.map(() => createDeferred())
      const releases = durableTransactions.map(() => createDeferred())
      const store = adapter.applyCommittedTx.bind(adapter)
      const storageError = Object.assign(
        new Error(`held durable write failed`),
        { code: `SQLITE_IOERR_FSYNC`, path: [`database`, `wal`] },
      )
      const admitted: Array<PersistedTx> = []
      let admissionCount = 0
      let holdDurability = true
      adapter.applyCommittedTx = async (...args) => {
        const index = admissionCount++
        admitted.push(structuredClone(args[1]))
        if (holdDurability) {
          admissions[index]?.resolve()
          await releases[index]?.promise
          if (index === failAt) throw storageError
        }
        await store(...args)
      }
      const probe = scoped ? installHydrationRoutingProbe(adapter) : undefined
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `hydration-source-routing`,
          getKey: (row) => row.id,
          syncMode: phase === `subscription` ? `on-demand` : `eager`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      const preload = (
        phase === `subscription`
          ? collection.stateWhenReady()
          : collection.preload()
      ).then(() => undefined)
      const preloadState = observeSettlement(preload)
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      const receipts: Array<Promise<void>> = []
      const settlements: Array<ReturnType<typeof observeSettlement>> = []
      const acceptances: Array<ReturnType<typeof observeSettlement>> = []
      let reopened: Collection<Todo, string> | undefined
      let hasPrimaryFailure = false
      const rows = () =>
        [...collection.values()]
          .map(stripVirtualProps)
          .sort((a, b) => a.id.localeCompare(b.id))
      const durable = () => ({
        rows: [...adapter.rows.values()].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
        rowMetadata: [...adapter.rowMetadata].sort(),
        collectionMetadata: [...adapter.collectionMetadata].sort(),
      })
      const commit = (transaction: HydrationSourceTransaction) => {
        source.begin()
        for (const edit of structuredClone(transaction.edits)) {
          if (edit.type === `put`)
            source.write({ type: `update`, value: edit.row })
          else if (edit.type === `remove`)
            source.write({ type: `delete`, key: edit.key })
          else if (edit.type === `truncate`) source.truncate()
          else {
            const metadata =
              edit.type === `row-metadata`
                ? source.metadata!.row
                : source.metadata!.collection
            if (edit.value === undefined) metadata.delete(edit.key)
            else metadata.set(edit.key, edit.value)
          }
        }
        const controller = new AbortController()
        if (transaction.abort) controller.abort()
        const receipt = source.commit(controller.signal)
        const promise = Promise.resolve(receipt).then(() => undefined)
        receipts.push(promise)
        settlements.push(observeSettlement(promise))
        acceptances.push(
          observeSettlement(
            Promise.resolve(whenSyncAccepted(receipt)).then(() => undefined),
          ),
        )
      }
      try {
        if (phase !== `startup`)
          await atPersistedOracleCheckpoint(preload, `initial readiness`)
        if (phase === `subscription`) {
          holdRead = true
          subscription = collection.subscribeChanges(() => {}, {
            includeInitialState: true,
          })
        }
        if (phase !== `after-ready`)
          await atPersistedOracleCheckpoint(
            readEntered.promise,
            `held persistence read`,
          )
        for (const transaction of modelTransactions) commit(transaction)
        await flushAsyncWork()
        if (phase !== `after-ready`) {
          expectHydrationReceiptsPending(
            settlements.filter((_, index) => !modelTransactions[index]!.abort),
          )
          expectHydrationReceiptsPending(
            acceptances.filter((_, index) => !modelTransactions[index]!.abort),
          )
          expect(rows()).toEqual([])
          expect(admissionCount).toBe(0)
        }
        releaseRead.resolve()
        for (let index = 0; index < durableTransactions.length; index++) {
          await atPersistedOracleCheckpoint(
            admissions[index]!.promise,
            `durability admission ${index}`,
          )
          expect(
            probe?.violations() ?? [],
            `nested source durability must use its current scoped adapter`,
          ).toEqual([])
          // Capture the full transaction at admission, before awaiting any
          // receipt. A FIFO reversal must fail here, not time out waiting for
          // the transaction that should have occupied this durable turn.
          const edits = durableTransactions[index]!.edits
          expect(
            admitted[index]!.mutations.map((mutation) =>
              mutation.type === `delete`
                ? { type: `remove`, key: mutation.key }
                : { type: `put`, row: mutation.value },
            ),
          ).toEqual(
            edits.filter(
              (edit) => edit.type === `put` || edit.type === `remove`,
            ),
          )
          expect([admitted[index]!.seq, admitted[index]!.rowVersion]).toEqual([
            index + 1,
            index + 1,
          ])
          expect(admitted[index]!.truncate === true).toBe(
            edits.some((edit) => edit.type === `truncate`),
          )
          await flushAsyncWork()
          const modelIndex = modelTransactions.indexOf(
            durableTransactions[index]!,
          )
          expectHydrationReceiptsPending(
            settlements
              .slice(modelIndex)
              .filter(
                (_, offset) => !modelTransactions[modelIndex + offset]!.abort,
              ),
          )
          expectHydrationReceiptsPending(
            acceptances
              .slice(modelIndex)
              .filter(
                (_, offset) => !modelTransactions[modelIndex + offset]!.abort,
              ),
          )
          expect(durable()).toEqual(
            hydrationSourceSnapshot(
              baseline,
              modelTransactions.slice(0, modelIndex),
            ),
          )
          expect(
            admissionCount,
            `the suffix cannot overtake held durability`,
          ).toBe(index + 1)
          // Core truncate may establish Collection readiness at publication.
          // Source acceptance/receipt must still wait for durability above.
          if (
            phase === `startup` &&
            !modelTransactions
              .slice(0, modelIndex + 1)
              .some((tx) => tx.edits.some((edit) => edit.type === `truncate`))
          )
            expect(preloadState.read()).toEqual({ status: `pending` })
          releases[index]!.resolve()
          if (index === failAt) break
          await atPersistedOracleCheckpoint(
            receipts[modelIndex]!,
            `individual source receipt ${modelIndex}`,
          )
          expect(settlements[modelIndex]!.read()).toEqual({
            status: `fulfilled`,
          })
        }
        const allSettled = Promise.allSettled(receipts)
        if (failAt !== undefined && admissions[failAt + 1]) {
          await atPersistedOracleCheckpoint(
            Promise.race([allSettled, admissions[failAt + 1]!.promise]),
            `terminal failure fences the suffix`,
          )
          expect(
            admissionCount,
            `failed durability must not admit a suffix`,
          ).toBe(failAt + 1)
        }
        await atPersistedOracleCheckpoint(
          allSettled,
          `all source receipts settled`,
        )
        await flushAsyncWork()
        if (failAt !== undefined) {
          const failingIndex = modelTransactions.indexOf(
            durableTransactions[failAt]!,
          )
          const rejected = settlements[failingIndex]!.read()
          expect(rejected.status).toBe(`rejected`)
          if (rejected.status !== `rejected`)
            throw new Error(`missing durable failure`)
          expect(rejected.reason).toBeInstanceOf(
            PersistedCollectionDurabilityError,
          )
          expect(rejected.reason).toMatchObject({
            code: `SQLITE_IOERR_FSYNC`,
            path: [`database`, `wal`],
          })
          for (const state of settlements.slice(failingIndex))
            expect(state.read()).toEqual({
              status: `rejected`,
              reason: rejected.reason,
            })
          expect(collection.status).toBe(`crashed`)
          expect(collection._lifecycle.getSyncError()).toBe(rejected.reason)
          expect((rejected.reason as Error).cause).toBe(storageError)
          await expect(
            Promise.resolve().then(async () => {
              source.begin()
              source.write({
                type: `insert`,
                value: { id: `late`, title: `rejected same-run admission` },
              })
              await source.commit()
            }),
          ).rejects.toBe(rejected.reason)
          expect(admissionCount).toBe(failAt + 1)
          expect(durable()).toEqual(
            hydrationSourceSnapshot(
              baseline,
              modelTransactions.slice(0, failingIndex),
            ),
          )
        } else {
          await atPersistedOracleCheckpoint(preload, `Collection readiness`)
          const expected = hydrationSourceSnapshot(baseline, modelTransactions)
          expect(rows()).toEqual(expected.rows)
          expect(durable()).toEqual(expected)
          expect(
            source
              .metadata!.collection.list()
              .map(({ key, value }) => [key, value])
              .sort(),
          ).toEqual(expected.collectionMetadata)
          for (const row of expected.rows)
            expect(source.metadata!.row.get(row.id)).toEqual(
              new Map(expected.rowMetadata).get(row.id),
            )
          modelTransactions.forEach((tx, index) =>
            expect(settlements[index]!.read()).toEqual(
              tx.abort
                ? {
                    status: `rejected`,
                    reason: expect.objectContaining({ name: `AbortError` }),
                  }
                : { status: `fulfilled` },
            ),
          )
          expect(admissionCount).toBe(durableTransactions.length)
          expect(collection.status).toBe(`ready`)
          // Same-run next use distinguishes a valid scope loan from a cached
          // unscheduled adapter. This ordinary commit must take the public route.
          holdDurability = false
          await flushAsyncWork()
          const tail: HydrationSourceTransaction = {
            edits: [
              { type: `put`, row: { id: `tail`, title: `after scope exit` } },
            ],
          }
          commit(tail)
          await atPersistedOracleCheckpoint(
            receipts.at(-1)!,
            `ordinary source after scope exit`,
          )
          expect(probe?.violations() ?? []).toEqual([])
          if (probe)
            expect(probe.calls.at(-1)).toMatchObject({
              route: `public`,
              scope: undefined,
              live: true,
            })
          const withTail = hydrationSourceSnapshot(baseline, [
            ...modelTransactions,
            tail,
          ])
          expect(rows()).toEqual(withTail.rows)
          expect(durable()).toEqual(withTail)
          expect(adapter.applyCommittedTxCalls.map(({ tx }) => tx.seq)).toEqual(
            Array.from(
              { length: durableTransactions.length + 1 },
              (_, index) => index + 1,
            ),
          )
          subscription?.unsubscribe()
          subscription = undefined
          let afterSecondScope = withTail
          if (phase === `subscription`) {
            readEntered = createDeferred()
            releaseRead = createDeferred()
            holdRead = true
            const nextLoad = Promise.resolve(
              collection._sync.loadSubset({ limit: 7 }),
            )
            void nextLoad.catch(() => undefined)
            await atPersistedOracleCheckpoint(
              readEntered.promise,
              `second hydration entered`,
            )
            const priorScope = Math.max(
              0,
              ...(probe?.calls.map((call) => call.scope ?? 0) ?? []),
            )
            const next: HydrationSourceTransaction = {
              edits: [
                {
                  type: `put`,
                  row: { id: `next-scope`, title: `fresh adapter loan` },
                },
              ],
            }
            commit(next)
            releaseRead.resolve()
            await atPersistedOracleCheckpoint(
              Promise.all([nextLoad, receipts.at(-1)!]),
              `second hydration source settled`,
            )
            expect(probe?.violations() ?? []).toEqual([])
            if (probe) {
              expect(probe.calls.at(-1)).toMatchObject({
                route: `scoped`,
                live: true,
              })
              expect(probe.calls.at(-1)!.scope).toBeGreaterThan(priorScope)
            }
            afterSecondScope = hydrationSourceSnapshot(baseline, [
              ...modelTransactions,
              tail,
              next,
            ])
            expect(rows()).toEqual(afterSecondScope.rows)
            expect(durable()).toEqual(afterSecondScope)
          }
          await atPersistedOracleCheckpoint(
            collection.cleanup(),
            `source cleanup before reopen`,
          )
          reopened = createCollection(
            persistedCollectionOptions<Todo, string>({
              id: `hydration-source-routing`,
              getKey: (row) => row.id,
              persistence: { adapter },
            }),
          )
          await atPersistedOracleCheckpoint(
            reopened.preload(),
            `durable reopen`,
          )
          expect(
            [...reopened.values()]
              .map(stripVirtualProps)
              .sort((a, b) => a.id.localeCompare(b.id)),
          ).toEqual(afterSecondScope.rows)
        }
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        releaseRead.resolve()
        releases.forEach((release) => release.resolve())
        await cleanupPersistedOracle(
          [
            () => Promise.allSettled([preload, ...receipts]),
            () => subscription?.unsubscribe(),
            () => collection.cleanup(),
            () => reopened?.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )
})

// A follower's cache-generation notices: the check and its history grammar
// live in persisted-support.ts, beside the law they state. The fixed and
// random campaigns run the same property and budget.
declareOracle({
  check: [assertGenerationNoticeHistory],
  grammar: [generationNoticeHistory],
})

describe(`persistedCollectionOptions`, () => {
  fcTest.prop([generationNoticeHistory], {
    seed: 2069,
    numRuns: oracleRuns(24),
  })(
    `checks generated cache-generation notice histories (fixed)`,
    assertGenerationNoticeHistory,
  )

  fcTest.prop(
    [generationNoticeHistory],
    oraclePropertyOptions(24, `persistence.generation-notice`),
  )(
    `checks generated cache-generation notice histories (random or replayed)`,
    assertGenerationNoticeHistory,
  )
})
