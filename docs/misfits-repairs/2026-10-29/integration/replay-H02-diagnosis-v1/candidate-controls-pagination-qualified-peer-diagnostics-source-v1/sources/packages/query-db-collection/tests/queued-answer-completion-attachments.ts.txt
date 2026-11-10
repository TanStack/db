import { isDeepStrictEqual } from 'node:util'
import { createTransaction } from '@tanstack/db'
import { D2 } from '@tanstack/db-ivm'
import { LIVE_QUERY_INTERNAL } from '../../db/src/query/live/internal.js'
import { BucketFacadeAdapter } from '../../db/src/query/live/bucket-facade-adapter.js'
import { SubsetDemandController } from '../../db/src/query/live/subset-demand-controller.js'
import { observeCandidatePromise } from '../../../scripts/h02-progress/candidate-controls.js'
import type { Collection, LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type { LiveQueryCollectionUtils } from '../../db/src/query/live/collection-config-builder.js'
import type { FullSyncState } from '../../db/src/query/live/types.js'
import type {
  CompletionOperationObservation,
  CompletionOutcome,
  CompletionPublicView,
  CompletionRow,
  CompletionTarget,
  CompletionWindow,
} from './queued-answer-completion-oracle.js'

/**
 * Real receiving attachments, with no reference computation. Every wrapper
 * delegates to the exact original object and keeps its original result. These
 * attachments do not assert reach merely because a wrapper was installed.
 * The driver must submit measured cuts to the completion oracle separately.
 */
export type CompletionChild = { id: number; parent: number }
export type CompletionRoot = {
  id: number
  rank: number
  children: Array<number> | Collection<CompletionChild, string | number>
}
type RootCollection = Collection<
  CompletionRoot,
  string | number,
  LiveQueryCollectionUtils
>
type SyncMethods<Row extends object> = Parameters<SyncConfig<Row>[`sync`]>[0]
type Cleanup = () => void

/** Observe completed real operators; graph-return alone cannot establish it. */
export function attachCompletionOperators(
  recorder: ReturnType<typeof createCompletionRecorder>,
) {
  const original = D2.prototype.addOperator
  const undo: Array<Cleanup> = []
  D2.prototype.addOperator = function (operator) {
    const graph = this
    const originalRun = operator.run
    operator.run = function (...args: Parameters<typeof originalRun>) {
      const detail = {
        graph: recorder.object(graph),
        operator: recorder.object(operator),
      }
      recorder.event(`operator-enter`, detail)
      try {
        const result = originalRun.apply(this, args)
        recorder.event(`operator-return`, detail)
        return result
      } catch (error) {
        recorder.event(`operator-throw`, {
          ...detail,
          error: recorder.error(error),
        })
        throw error
      }
    }
    undo.push(() => {
      operator.run = originalRun
    })
    return original.call(this, operator)
  }
  return () => {
    for (const restore of undo.reverse()) restore()
    D2.prototype.addOperator = original
  }
}

export type CompletionBoundaryEvent = {
  sequence: number
  boundary: string
  detail: unknown
}
export function createCompletionRecorder(
  sink?: (event: CompletionBoundaryEvent) => void,
) {
  let sequence = 0
  const errors = new Map<unknown, string>()
  const objects = new WeakMap<object, number>()
  let objectSequence = 0
  const events: Array<CompletionBoundaryEvent> = []
  return {
    event(boundary: string, detail: unknown = {}) {
      const next = ++sequence
      const event = { sequence: next, boundary, detail }
      events.push(event)
      sink?.(event)
      return next
    },
    error(error: unknown) {
      let token = errors.get(error)
      if (token === undefined) {
        token = `error:${errors.size + 1}`
        // Identity tokens are never inferred from a message or error name.
        errors.set(error, token)
      }
      return token
    },
    cleanupAbandonment(error: unknown) {
      if (!(error instanceof Error) || error.name !== `AbortError`)
        throw new Error(
          `cleanup abandonment did not return its specified AbortError`,
        )
      // The caller must first establish actual accepted-target cleanup order.
      // This labels that explicit lifecycle outcome, not arbitrary old errors.
      errors.set(error, `AbortError`)
      return `AbortError` as const
    },
    registerError(error: unknown, token: string) {
      if (
        !token ||
        [...errors].some(([known, label]) => label === token && known !== error)
      )
        throw new Error(
          `receiving error label must name one exact authored error`,
        )
      const previous = errors.get(error)
      if (previous !== undefined && previous !== token)
        throw new Error(
          `receiving error identity was already observed under another label`,
        )
      errors.set(error, token)
    },
    object(value: object) {
      let token = objects.get(value)
      if (token === undefined) {
        token = ++objectSequence
        objects.set(value, token)
      }
      return token
    },
    events: () => [...events],
  }
}
type Recorder = ReturnType<typeof createCompletionRecorder>

/** One actual source acquisition, distinct from its queryFn answer. */
export type CompletionSourceLoad = {
  id: number
  source: string
  generation: number
  options: LoadSubsetOptions
  queryKey?: ReadonlyArray<unknown>
  enteredAt: number
  returnedAt?: number
  settledAt?: number
  receipt?: true | Promise<void>
  read: () => CompletionOutcome | undefined
}

/**
 * Law 7's applied-load boundary is the original source loadSubset return.
 * Capture the exact options, signal and sync generation before delegating;
 * a provider answer can bind its synchronously initiating load by object
 * identity. Missing/asynchronous or ambiguous provenance stays unavailable.
 * QueryClient answer resolution and public-operation settlement are earlier
 * or different observations and never substitute for this receipt.
 */
export function attachCompletionSourceLoads(
  sync: {
    loadSubset: (options: LoadSubsetOptions) => true | Promise<void>
    getSyncRunGeneration: () => number
  },
  source: string,
  recorder: Recorder,
) {
  const original = sync.loadSubset
  const loads: Array<CompletionSourceLoad> = []
  const active: Array<CompletionSourceLoad> = []
  sync.loadSubset = (options) => {
    let outcome: CompletionOutcome | undefined
    const load: CompletionSourceLoad = {
      id: loads.length + 1,
      source,
      generation: sync.getSyncRunGeneration(),
      options,
      enteredAt: recorder.event(`source-load-enter`, {
        source,
        load: loads.length + 1,
        options: recorder.object(options),
        subscription:
          options.subscription && recorder.object(options.subscription),
        signal: options.signal && recorder.object(options.signal),
        generation: sync.getSyncRunGeneration(),
        requestOptions: {
          where: options.where,
          orderBy: options.orderBy,
          limit: options.limit,
          offset: options.offset,
          cursor: options.cursor,
        },
      }),
      read: () => outcome,
    }
    loads.push(load)
    active.push(load)
    try {
      const receipt = original.call(sync, options)
      load.receipt = receipt
      load.returnedAt = recorder.event(`source-load-return`, {
        source,
        load: load.id,
        literalTrue: receipt === true,
        promise: receipt === true ? undefined : recorder.object(receipt),
      })
      const settle = (result: CompletionOutcome) => {
        outcome = result
        load.settledAt = recorder.event(`source-load-applied-settled`, {
          source,
          load: load.id,
          outcome: result,
        })
      }
      if (receipt === true) settle({ state: `fulfilled` })
      else
        void receipt.then(
          () => settle({ state: `fulfilled` }),
          (error: unknown) =>
            settle({ state: `rejected`, error: recorder.error(error) }),
        )
      return receipt
    } catch (error) {
      outcome = { state: `rejected`, error: recorder.error(error) }
      recorder.event(`source-load-throw`, { source, load: load.id, outcome })
      throw error
    } finally {
      active.pop()
    }
  }
  return {
    current: () => active.at(-1),
    loads: () => [...loads],
    restore() {
      sync.loadSubset = original
    },
  }
}

export function createCompletionOperations(recorder: Recorder) {
  const operations: Array<{
    operation: string
    returned: `true` | `promise`
    read: () => CompletionOutcome
  }> = []
  return {
    call(operation: string, invoke: () => true | Promise<void>) {
      if (operations.some((entry) => entry.operation === operation))
        throw new Error(`duplicate receiving operation ${operation}`)
      recorder.event(`public-operation-enter`, { operation })
      const result = invoke()
      recorder.event(`public-operation-return`, {
        operation,
        literalTrue: result === true,
      })
      // Attach immediately to the original return. No replacement promise,
      // delayed settlement or authored deferred can manufacture this state.
      const observe =
        result === true ? undefined : observeCandidatePromise(result)
      operations.push({
        operation,
        returned: result === true ? `true` : `promise`,
        read: () => {
          const state = observe?.() ?? { state: `fulfilled` as const }
          return state.state === `rejected`
            ? { state: `rejected`, error: recorder.error(state.error) }
            : state
        },
      })
      return result
    },
    observations: (): Array<CompletionOperationObservation> =>
      operations.map(({ operation, returned, read }) => ({
        operation,
        returned,
        outcome: read(),
      })),
  }
}

/**
 * Public handles are assigned on the first actual object appearance in a run.
 * Retiring and reactivating a bucket must expose a new object and interval.
 * Rows are projected field by field; raw rows remain in the event recorder.
 */
export function createCompletionPublicReader(
  live: RootCollection,
  downstream: Collection<CompletionRoot, string | number>,
  run: () => string,
  requestErrors: () => Array<unknown>,
  recorder: Recorder,
) {
  const handles = new WeakMap<object, string>()
  const intervals = new Map<string, number>()
  const children = (row: CompletionRoot) =>
    Array.isArray(row.children)
      ? [...row.children]
      : row.children.toArray.map(({ id }) => id)
  const rows = (source: Iterable<CompletionRoot>): Array<CompletionRow> =>
    Array.from(source, (row) => ({
      id: row.id,
      rank: row.rank,
      children: children(row),
    }))
  return (): CompletionPublicView => {
    const roots = live.toArray
    const rawRows = (source: Iterable<CompletionRoot>) =>
      Array.from(source, (row) => ({
        ...row,
        children: Array.isArray(row.children)
          ? [...row.children]
          : {
              handle: recorder.object(row.children),
              rows: row.children.toArray.map((child) => ({ ...child })),
            },
      }))
    const actualWindow = live.utils.getWindow()
    const window = actualWindow && { ...actualWindow }
    recorder.event(`public-read`, {
      roots: rawRows(roots),
      downstream: rawRows(downstream.toArray),
      window,
    })
    const status = live.status
    if (
      status !== `ready` &&
      status !== `loading` &&
      status !== `crashed` &&
      status !== `cleaned-up`
    )
      throw new Error(`unexpected receiving status ${status}`)
    return {
      roots: rows(roots),
      facades: roots.flatMap((row) => {
        if (Array.isArray(row.children)) return []
        let handle = handles.get(row.children)
        if (!handle) {
          const bucket = `${run()}:${row.id}`
          const interval = (intervals.get(bucket) ?? 0) + 1
          intervals.set(bucket, interval)
          handle = `${bucket}:${interval}`
          handles.set(row.children, handle)
        }
        return [{ bucket: row.id, handle, rows: children(row) }]
      }),
      downstream: rows(downstream.toArray),
      window,
      status,
      requestErrors: requestErrors().map((error) => recorder.error(error)),
    }
  }
}

/**
 * Bind a single established query run. The actual state object is retained:
 * cleanup/restart requires a new attachment, and an old one cannot silently
 * observe the replacement. A no-delta turn can enter flush without D2.run.
 */
export function attachCompletionBuilder(
  live: RootCollection,
  recorder: Recorder,
  dispatching: () => number | undefined,
) {
  const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
  const state = builder.currentSyncState
  const config = builder.currentSyncConfig
  if (!state || !config || !state.flushPendingChanges)
    throw new Error(`receiving builder has no established exact sync run`)
  const generation = builder.getSyncRunGeneration()
  const restorers: Array<Cleanup> = []
  const current = () =>
    builder.currentSyncState === state &&
    builder.currentSyncConfig === config &&
    builder.getSyncRunGeneration() === generation
  const originalRun = state.graph.run
  let graphFault: { error: unknown } | undefined
  state.graph.run = function (...args: Parameters<typeof originalRun>) {
    recorder.event(`graph-enter`, {
      generation,
      current: current(),
      task: dispatching(),
      pending: state.graph.pendingWork(),
    })
    try {
      if (graphFault) {
        const error = graphFault.error
        graphFault = undefined
        recorder.event(`graph-injected-throw`, {
          generation,
          task: dispatching(),
          error: recorder.error(error),
        })
        throw error
      }
      const result = originalRun.apply(this, args)
      recorder.event(`graph-return`, {
        generation,
        current: current(),
        task: dispatching(),
        pending: state.graph.pendingWork(),
      })
      return result
    } catch (error) {
      recorder.event(`graph-throw`, {
        generation,
        task: dispatching(),
        error: recorder.error(error),
      })
      throw error
    }
  }
  restorers.push(() => {
    state.graph.run = originalRun
  })
  const originalFlush = state.flushPendingChanges
  state.flushPendingChanges = () => {
    recorder.event(`flush-enter`, {
      generation,
      current: current(),
      task: dispatching(),
      quiescent: !state.graph.pendingWork(),
      input: builder.getGraphInputRevision(),
    })
    try {
      const result = originalFlush()
      recorder.event(`flush-return`, {
        generation,
        current: current(),
        task: dispatching(),
        input: builder.getGraphInputRevision(),
      })
      return result
    } catch (error) {
      recorder.event(`flush-throw`, {
        generation,
        current: current(),
        error: recorder.error(error),
      })
      throw error
    }
  }
  restorers.push(() => {
    state.flushPendingChanges = originalFlush
  })
  const demandPrototype = SubsetDemandController.prototype
  const originalDemand = demandPrototype.setDemand
  demandPrototype.setDemand = function (subscription, plan, keys) {
    if (!Object.values(builder.subscriptions).includes(subscription))
      return originalDemand.call(this, subscription, plan, keys)
    const holdBeforeDemand = subscription.hasPendingTruncateReplacement
    const inputBefore = builder.getGraphInputRevision()
    const result = originalDemand.call(this, subscription, plan, keys)
    const event = recorder.event(`demand-return`, {
      generation,
      current: current(),
      plan: plan.id,
      holdBeforeDemand,
      changed: result.changed,
      readyWasPromise: result.ready instanceof Promise,
      inputBefore,
      inputAfter: builder.getGraphInputRevision(),
      pendingD2: state.graph.pendingWork(),
    })
    if (result.ready instanceof Promise)
      void result.ready.then(
        () =>
          recorder.event(`demand-settled`, {
            event,
            generation,
            outcome: `fulfilled`,
          }),
        (error: unknown) =>
          recorder.event(`demand-settled`, {
            event,
            generation,
            outcome: `rejected`,
            error: recorder.error(error),
          }),
      )
    return result
  }
  restorers.push(() => {
    if (demandPrototype.setDemand !== originalDemand)
      demandPrototype.setDemand = originalDemand
  })
  return {
    builder,
    state,
    config,
    generation,
    current,
    failNextGraph(error: unknown) {
      if (graphFault)
        throw new Error(`exact receiving graph fault already armed`)
      graphFault = { error }
    },
    restore() {
      for (const restore of restorers.reverse()) restore()
    },
  }
}

/**
 * A persisting optimistic transaction on a real existing row parks the actual
 * target's accepted sync commits. The authored changed value is an observable
 * overlay and must be stepped into the independent model before the hold.
 * An unchanged update can have no mutation and is explicitly refused.
 */
export function holdCompletionTarget<Row extends object>(
  collection: Collection<Row, string | number>,
  key: string | number,
  value: Row,
  readPublic: () => unknown,
  recorder: Recorder,
) {
  const before = collection.get(key)
  if (!before) throw new Error(`cannot hold an absent receiving output row`)
  if (isDeepStrictEqual(before, value))
    throw new Error(`receiving hold needs an authored observable mutation`)
  const publicBefore = readPublic()
  let release: (() => void) | undefined
  const transaction = createTransaction({
    autoCommit: false,
    mutationFn: () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  })
  transaction.mutate(() =>
    collection.update(key, (draft) => {
      Object.assign(draft, value)
    }),
  )
  const committed = transaction.commit()
  void committed.catch(() => undefined)
  recorder.event(`optimistic-hold`, {
    target: recorder.object(collection),
    key,
    before: publicBefore,
    after: readPublic(),
    transaction: recorder.object(transaction),
    state: transaction.state,
  })
  return {
    transaction,
    async release() {
      if (!release)
        throw new Error(`optimistic receiving hold never began persistence`)
      release()
      await committed
      recorder.event(`optimistic-hold-released`, {
        target: recorder.object(collection),
        key,
        state: transaction.state,
      })
    },
    rollback() {
      transaction.rollback()
    },
  }
}

/**
 * An adapter-controlled pre-exposure hold inserts an authored optimistic child.
 * Its public row is explicit model overlay data. It is not an external-holder
 * history until a root has actually exposed this exact facade reference.
 */
export function holdCompletionInsertion<Row extends object>(
  collection: Collection<Row, string | number>,
  value: Row,
  readPublic: () => unknown,
  recorder: Recorder,
) {
  const key = collection.getKeyFromItem(value)
  if (collection.has(key))
    throw new Error(`receiving optimistic insertion must use an absent key`)
  const before = readPublic()
  let release: (() => void) | undefined
  const transaction = createTransaction({
    autoCommit: false,
    mutationFn: () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  })
  transaction.mutate(() => collection.insert(value))
  const committed = transaction.commit()
  void committed.catch(() => undefined)
  recorder.event(`optimistic-insertion-hold`, {
    target: recorder.object(collection),
    key,
    before,
    after: readPublic(),
    transaction: recorder.object(transaction),
    state: transaction.state,
  })
  return {
    transaction,
    async release() {
      if (!release)
        throw new Error(
          `optimistic receiving insertion never began persistence`,
        )
      release()
      await committed
      recorder.event(`optimistic-insertion-hold-released`, {
        target: recorder.object(collection),
        key,
        state: transaction.state,
      })
    },
    rollback() {
      transaction.rollback()
    },
  }
}

/** Actual sync.commit return harvesting must happen before a later fault. */
export function attachCompletionReceipts<Row extends object>(
  methods: SyncMethods<Row>,
  target: CompletionTarget | (() => CompletionTarget),
  attempt: () => object,
  recorder: Recorder,
  role: () => `forward` | `restore` = () => `forward`,
) {
  const original = methods.commit
  const receipts: Array<{
    acceptedAt: number
    target: CompletionTarget
    attempt: object
    receipt: true | Promise<void>
    role: `forward` | `restore`
    read: () => CompletionOutcome
  }> = []
  methods.commit = (...args) => {
    const actualTarget = typeof target === `function` ? target() : target
    const receipt = original(...args)
    const actualRole = role()
    const actualAttempt = attempt()
    const acceptedAt = recorder.event(`output-commit-return`, {
      target: actualTarget,
      attempt: recorder.object(actualAttempt),
      role: actualRole,
      literalTrue: receipt === true,
    })
    const observe =
      receipt === true ? undefined : observeCandidatePromise(receipt)
    receipts.push({
      acceptedAt,
      target: actualTarget,
      attempt: actualAttempt,
      receipt,
      role: actualRole,
      read: () => {
        const value = observe?.() ?? { state: `fulfilled` as const }
        return value.state === `rejected`
          ? { state: `rejected`, error: recorder.error(value.error) }
          : value
      },
    })
    return receipt
  }
  return {
    receipts: () =>
      receipts.map(({ read, ...receipt }) => ({ ...receipt, outcome: read() })),
    restore() {
      methods.commit = original
    },
  }
}

export type CompletionBuilderAttachment = ReturnType<
  typeof attachCompletionBuilder
>
export type CompletionSyncState = FullSyncState
export type CompletionRequestedWindow = CompletionWindow

type FacadeMethods = SyncMethods<CompletionChild>
type FacadeEntry = {
  collection: Collection<CompletionChild, string | number>
  sync: FacadeMethods | undefined
  dispose: () => Promise<void>
}
type AdapterBoundary = {
  parentId: string
  getEntry: (edgeId: string, bucketKey: string) => FacadeEntry
  restore: (snapshot: unknown) => void
  flush: () => {
    prepare: () => void
    publish: () => void
    rollback: () => void
  }
}

/**
 * Attach before constructing the receiving query. Only its actual adapter is
 * selected by the configured parent ID. A/B identity comes from authored child
 * `parent` data at the real write, or an actual public facade reference.
 * Rollback disposal is recorded before the original call, with the actual
 * failed-attempt identity. A cleanup disposal receives no rollback label.
 */
export function attachCompletionFacades(parentId: string, recorder: Recorder) {
  const prototype = BucketFacadeAdapter.prototype as unknown as AdapterBoundary
  const originalGetEntry = prototype.getEntry
  const originalRestore = prototype.restore
  const originalFlush = prototype.flush
  const entries = new Map<
    FacadeEntry,
    {
      createdBy: object | undefined
      bucket: number | undefined
      restoring: boolean
      exposed: boolean
      publicSubscription?: { unsubscribe: () => void }
      receipts: ReturnType<typeof attachCompletionReceipts<CompletionChild>>
    }
  >()
  const undo: Array<Cleanup> = []
  let activeAttempt: object | undefined
  let failure:
    { bucket: number; boundary: `write` | `commit`; error: unknown } | undefined
  let beforeNewWrite:
    | { bucket: number; apply: (collection: FacadeEntry[`collection`]) => void }
    | undefined
  const currentAttempt = () => {
    if (!activeAttempt)
      throw new Error(`facade commit occurred outside a real adapter attempt`)
    return activeAttempt
  }
  const select = (adapter: AdapterBoundary) => adapter.parentId === parentId
  prototype.getEntry = function (edgeId, bucketKey) {
    const entry = originalGetEntry.call(this, edgeId, bucketKey)
    if (!select(this) || entries.has(entry)) return entry
    const methods = entry.sync
    if (!methods)
      throw new Error(`created receiving facade has no real sync methods`)
    const record = {
      createdBy: activeAttempt,
      bucket: undefined as number | undefined,
      restoring: false,
      exposed: false,
      publicSubscription: undefined as { unsubscribe: () => void } | undefined,
      receipts: attachCompletionReceipts(
        methods,
        () => {
          const bucket = entries.get(entry)?.bucket
          if (bucket === undefined)
            throw new Error(
              `facade receipt has no authored public bucket binding`,
            )
          return { bucket }
        },
        currentAttempt,
        recorder,
        () => (entries.get(entry)?.restoring ? `restore` : `forward`),
      ),
    }
    entries.set(entry, record)
    recorder.event(`facade-entry`, {
      edgeId,
      bucketKey,
      target: recorder.object(entry.collection),
      createdBy: activeAttempt && recorder.object(activeAttempt),
    })
    const subscription = entry.collection.subscribeChanges((changes) => {
      recorder.event(`facade-adapter-callback`, {
        target: recorder.object(entry.collection),
        bucket: record.bucket,
        changes: changes.map((message) => ({ ...message })),
        read: entry.collection.toArray.map((row) => ({ ...row })),
      })
    })
    const originalWrite = methods.write
    methods.write = (message) => {
      if (`value` in message && typeof message.value.parent === `number`)
        record.bucket = message.value.parent
      if (
        beforeNewWrite &&
        record.createdBy === activeAttempt &&
        record.bucket === beforeNewWrite.bucket
      ) {
        const apply = beforeNewWrite.apply
        beforeNewWrite = undefined
        recorder.event(`pre-exposure-facade-hold-enter`, {
          target: recorder.object(entry.collection),
          bucket: record.bucket,
        })
        apply(entry.collection)
      }
      recorder.event(`facade-write`, {
        target: recorder.object(entry.collection),
        bucket: record.bucket,
        role: record.restoring ? `restore` : `forward`,
        attempt: activeAttempt && recorder.object(activeAttempt),
        message,
      })
      if (
        !record.restoring &&
        failure &&
        failure.bucket === record.bucket &&
        failure.boundary === `write`
      ) {
        const error = failure.error
        failure = undefined
        recorder.event(`facade-injected-throw`, {
          bucket: record.bucket,
          boundary: `write`,
          error: recorder.error(error),
        })
        throw error
      }
      return originalWrite(message)
    }
    const receiptCommit = methods.commit
    methods.commit = (...args) => {
      if (
        !record.restoring &&
        failure &&
        failure.bucket === record.bucket &&
        failure.boundary === `commit`
      ) {
        const error = failure.error
        failure = undefined
        recorder.event(`facade-injected-throw`, {
          bucket: record.bucket,
          boundary: `commit`,
          error: recorder.error(error),
        })
        throw error
      }
      recorder.event(`facade-commit-enter`, {
        target: recorder.object(entry.collection),
        bucket: record.bucket,
        role: record.restoring ? `restore` : `forward`,
        attempt: activeAttempt && recorder.object(activeAttempt),
      })
      return receiptCommit(...args)
    }
    const originalDispose = entry.dispose
    entry.dispose = () => {
      recorder.event(`facade-dispose`, {
        target: recorder.object(entry.collection),
        bucket: record.bucket,
        attempt: activeAttempt && recorder.object(activeAttempt),
        rollback: record.restoring && record.createdBy === activeAttempt,
      })
      return originalDispose()
    }
    undo.push(() => {
      methods.write = originalWrite
      methods.commit = receiptCommit
      record.receipts.restore()
      entry.dispose = originalDispose
      subscription.unsubscribe()
      record.publicSubscription?.unsubscribe()
    })
    return entry
  }
  prototype.restore = function (snapshot) {
    if (!select(this)) return originalRestore.call(this, snapshot)
    for (const record of entries.values()) record.restoring = true
    recorder.event(`facade-restore-enter`, {
      attempt: activeAttempt && recorder.object(activeAttempt),
    })
    try {
      const result = originalRestore.call(this, snapshot)
      recorder.event(`facade-restore-return`, {
        attempt: activeAttempt && recorder.object(activeAttempt),
      })
      return result
    } catch (error) {
      recorder.event(`facade-restore-throw`, {
        attempt: activeAttempt && recorder.object(activeAttempt),
        error: recorder.error(error),
      })
      throw error
    } finally {
      for (const record of entries.values()) record.restoring = false
    }
  }
  prototype.flush = function () {
    if (!select(this)) return originalFlush.call(this)
    if (activeAttempt) throw new Error(`nested receiving facade attempt`)
    const attempt = {}
    activeAttempt = attempt
    recorder.event(`facade-flush-enter`, { attempt: recorder.object(attempt) })
    try {
      const publication = originalFlush.call(this)
      // Root failure invokes rollback after flush returned. Preserve the same
      // attempt while delegating each later publication method.
      const inAttempt = (callback: () => void) => () => {
        if (activeAttempt)
          throw new Error(`nested receiving facade publication`)
        activeAttempt = attempt
        try {
          callback()
        } finally {
          activeAttempt = undefined
        }
      }
      recorder.event(`facade-flush-return`, {
        attempt: recorder.object(attempt),
      })
      return {
        prepare: inAttempt(publication.prepare),
        publish: inAttempt(publication.publish),
        rollback: inAttempt(publication.rollback),
      }
    } catch (error) {
      recorder.event(`facade-flush-throw`, {
        attempt: recorder.object(attempt),
        error: recorder.error(error),
      })
      throw error
    } finally {
      activeAttempt = undefined
    }
  }
  return {
    failNext(bucket: number, boundary: `write` | `commit`, error: unknown) {
      if (failure) throw new Error(`receiving facade fault already armed`)
      failure = { bucket, boundary, error }
    },
    beforeCreatedWrite(
      bucket: number,
      apply: (collection: FacadeEntry[`collection`]) => void,
    ) {
      if (beforeNewWrite)
        throw new Error(`receiving pre-exposure hold already armed`)
      beforeNewWrite = { bucket, apply }
    },
    bindPublicBucket(bucket: number, collection: object) {
      const found = [...entries].find(
        ([entry]) => entry.collection === collection,
      )
      if (!found)
        throw new Error(`public facade is outside the exact receiving adapter`)
      found[1].bucket = bucket
      const [entry, record] = found
      if (!record.exposed) {
        record.exposed = true
        recorder.event(`facade-public-exposure`, {
          bucket,
          target: recorder.object(entry.collection),
        })
        record.publicSubscription = entry.collection.subscribeChanges(
          (changes) => {
            recorder.event(`facade-callback`, {
              target: recorder.object(entry.collection),
              bucket,
              changes: changes.map((message) => ({ ...message })),
              read: entry.collection.toArray.map((row) => ({ ...row })),
            })
          },
          { includeInitialState: true },
        )
        recorder.event(`facade-public-subscription-return`, {
          bucket,
          target: recorder.object(entry.collection),
          subscription: recorder.object(record.publicSubscription),
        })
      }
    },
    observations: () =>
      [...entries].map(([entry, record]) => ({
        target: entry.collection,
        bucket: record.bucket,
        createdBy: record.createdBy,
        receipts: record.receipts.receipts(),
      })),
    restore() {
      for (const restore of undo.reverse()) restore()
      prototype.getEntry = originalGetEntry
      prototype.restore = originalRestore
      prototype.flush = originalFlush
    },
  }
}
