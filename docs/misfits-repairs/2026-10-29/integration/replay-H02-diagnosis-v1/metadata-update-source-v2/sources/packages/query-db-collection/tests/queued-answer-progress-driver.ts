import { QueryClient, hashKey } from '@tanstack/query-core'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  isUndefined,
  toArray,
} from '@tanstack/db'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression-oracle.js'
import { emitProgressReceipt as emit } from '../../../scripts/h02-progress/receipt-transport.mjs'
import { findQueuedAnswerPremise } from '../../../scripts/h02-progress/witness-premise.js'
import { captureMetadataRows } from '../../db/tests/query/virtual-row-fields-support.js'
import { queryCollectionOptions } from '../src/query.js'
import { progressFacts } from './queued-answer-progress-oracle.js'
import type { LoadSubsetOptions, SyncAppliedReceipt } from '@tanstack/db'
import type { QueryKey } from '@tanstack/query-core'
import type {
  ProgressHistory,
  ProgressRow,
} from './queued-answer-progress-oracle.js'
import type {
  AnswerFact,
  PendingFact,
  QueryFact,
} from '../../../scripts/h02-progress/witness-premise.js'

type Marker = { id: number; rowId: number }
type PendingAnswer = PendingFact & {
  signal: AbortSignal | undefined
  release: () => void
}

const hostTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const copyRows = (rows: Iterable<ProgressRow>) =>
  Array.from(rows, (row) => ({ ...row, markers: [...row.markers] }))

/**
 * This receiving driver controls only finite provider answers. It uses real
 * QueryClient observers and public reload/preload APIs. Primitive boundary
 * receipts observe actual key callbacks, cache entries and acquisition leases.
 * They never serialize subscriptions or supply expected public row values.
 */
export async function driveQueuedAnswerHistory(history: ProgressHistory) {
  emit(`worker-start`, {
    history,
    cwd: process.cwd(),
    execPath: process.execPath,
  })
  const captureBindings = (cut: string) => {
    const capture: unknown = Reflect.get(globalThis, `__h02CaptureBindings`)
    if (typeof capture !== `function`)
      throw new Error(`effective-source binding instrument is missing`)
    capture(cut)
  }
  captureBindings(`driver-start`)
  const { roots, pivot, marked } = progressFacts(history)
  const originalWarn = console.warn
  console.warn = (...args: Array<unknown>) => {
    emit(`warning`, { args: args.map(String) })
    originalWarn(...args)
  }
  const sourceControls: {
    change?: () => void
    writeRank?: (value: { id: number; rank: number }) => SyncAppliedReceipt
  } = {}
  let firstSourceLoad = true
  let sourceLiteralTrueReceipt = false
  const hasLiteralTrueReceipt = () => sourceLiteralTrueReceipt
  const source = createCollection<{ id: number; rank: number }, number>({
    getKey: (row) => row.id,
    defaultIndexType: BTreeIndex,
    autoIndex: `eager`,
    syncMode: history.kind === `sync-initial` ? `on-demand` : `eager`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const establish = () => {
          if (firstSourceLoad) {
            firstSourceLoad = false
            begin()
            for (const row of roots)
              write({ type: `insert`, value: { ...row } })
            const receipt = commit()
            sourceLiteralTrueReceipt = receipt === true
            emit(`source-establishing-receipt`, {
              literalTrue: receipt === true,
            })
            markReady()
            return receipt
          }
          return true
        }
        sourceControls.writeRank = (value) => {
          const row = roots.find(({ id }) => id === value.id)
          if (!row) throw new Error(`authored source update has no source row`)
          // Update provider facts before the real source sync write. Rank is
          // an order term; any resulting repair still uses the normal path.
          row.rank = value.rank
          begin()
          write({ type: `update`, value: { ...row } })
          return commit()
        }
        sourceControls.change = () => {
          begin()
          write({
            type: `update`,
            value: { ...roots[0]!, rank: 6 * history.rankScale },
          })
          commit()
        }
        if (history.kind !== `sync-initial`) establish()
        return { loadSubset: establish }
      },
    },
  })
  if (history.kind !== `query`) {
    const live = createLiveQueryCollection((q) => {
      const ordered = q.from({ row: source }).orderBy(({ row }) => row.rank)
      // The initial ordered cut uses a complete five-row window. The ordinary
      // mutation control is unbounded, so no finite repair barrier is involved.
      const selected =
        history.kind === `sync-initial` ? ordered.limit(5) : ordered
      return selected.select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        markers: [] as Array<number>,
      }))
    })
    const subscription = live.subscribeChanges(() => {})
    try {
      if (history.kind === `sync-initial`) {
        if (!hasLiteralTrueReceipt())
          throw new Error(`literal-true initial premise not reached`)
        emit(`immediate-publication`, {
          cut: `subscriber-return-before-preload`,
          rows: copyRows(live.toArray),
          ready: live.status === `ready`,
        })
      }
      await live.preload()
      if (history.kind === `sync-mutation`) {
        sourceControls.change?.()
        emit(`immediate-publication`, {
          rows: copyRows(live.toArray),
          ready: live.status === `ready`,
        })
      }
      emit(`final-publication`, {
        rows: copyRows(live.toArray),
        ready: live.status === `ready`,
      })
    } finally {
      subscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
      console.warn = originalWarn
      emit(`worker-cleaned`)
    }
    return
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity },
    },
  })
  const subscriptionAtoms = new Map<
    NonNullable<LoadSubsetOptions[`subscription`]>,
    number
  >()
  const queryScopes = new Map<
    string,
    { key: QueryKey; keys: Array<number>; subscriptionAtom?: number }
  >()
  const answers = new Map<string, AnswerFact>()
  const cacheVersions = new Map<string, AnswerFact>()
  const attempts = new WeakMap<LoadSubsetOptions, Array<number>>()
  const pending: Array<PendingAnswer> = []
  const physicalQueries = new WeakMap<object, number>()
  let physicalQuerySequence = 0
  const physicalQueryToken = (query: object) => {
    let token = physicalQueries.get(query)
    if (token === undefined) {
      token = ++physicalQuerySequence
      physicalQueries.set(query, token)
    }
    return token
  }
  let actualBaseKey: QueryKey | undefined
  const activeAttempts: Array<number> = []
  let acquisitionSequence = 0
  let answerVersion = 0
  let backendVersion = 0
  let following = false
  const followupAttempts = new Map<
    number,
    `pending` | `fulfilled` | `rejected`
  >()
  let followupError: unknown
  let rootCallbacks = 0
  let downstreamCallbacks = 0
  let holding = false
  let answerQueued = false
  const hasQueuedAnswer = () => answerQueued
  let stackCaptured = false
  let feedbackStackCaptured = false
  const heldAcquisitionScopes = new Set<string>()
  let initialStackCaptured = false
  const requestedKeys = (options: LoadSubsetOptions) =>
    roots
      .filter(
        ({ id }) =>
          !options.where ||
          evaluateReferenceExpression(options.where, { id, rowId: id }) ===
            true,
      )
      .map(({ id }) => id)
  const subscriptionAtom = (options: LoadSubsetOptions) => {
    if (options.subscription === undefined) return undefined
    let atom = subscriptionAtoms.get(options.subscription)
    if (atom === undefined) {
      atom = subscriptionAtoms.size + 1
      subscriptionAtoms.set(options.subscription, atom)
    }
    return atom
  }
  const optionsReceipt = (options: LoadSubsetOptions) => ({
    ownFields: Object.keys(options).sort(),
    subscriptionAtom: subscriptionAtom(options),
    signalPresent: options.signal !== undefined,
    signalAborted: options.signal?.aborted,
    keys: requestedKeys(options),
    where: options.where,
    orderBy: options.orderBy,
    limit: options.limit,
    offset: options.offset,
    cursorPresent: options.cursor !== undefined,
    cursor: options.cursor,
  })
  const validateActualKey = (key: QueryKey, boundary: string) => {
    const valid =
      actualBaseKey !== undefined &&
      key.length >= actualBaseKey.length &&
      actualBaseKey.every((value, index) => value === key[index])
    emit(`actual-key-prefix`, { boundary, key, actualBaseKey, valid })
    if (!valid)
      throw new Error(`unlawful actual Query key prefix at ${boundary}`)
  }
  const rowIds = (value: unknown): Array<number> | undefined =>
    Array.isArray(value) &&
    value.every(
      (row: unknown) =>
        typeof row === `object` &&
        row !== null &&
        `id` in row &&
        typeof row.id === `number`,
    )
      ? value.map((row: { id: number }) => row.id)
      : undefined
  const answerPayload = (answer: AnswerFact | undefined) =>
    answer && {
      version: answer.version,
      backendVersion: answer.backendVersion,
      rows: [...answer.rows],
    }
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    validateActualKey(event.query.queryKey, `cache-${event.type}`)
    if (event.type === `updated` && event.action.type === `success`) {
      const atom = hashKey(event.query.queryKey)
      const answer = answers.get(atom)
      const actualRows = rowIds(event.query.state.data)
      if (
        answer &&
        answer.identity === event.query &&
        event.query.state.dataUpdateCount > answer.startCount &&
        JSON.stringify(answer.rows) === JSON.stringify(actualRows)
      ) {
        cacheVersions.set(atom, {
          ...answer,
          rows: [...answer.rows],
          installedCount: event.query.state.dataUpdateCount,
        })
      }
      emit(`cache-success`, {
        atom,
        key: event.query.queryKey,
        dataUpdateCount: event.query.state.dataUpdateCount,
        answer: answerPayload(cacheVersions.get(atom)),
        actualRows,
        physicalQuery: physicalQueryToken(event.query),
      })
    }
  })
  const hostEnqueue = (callback: () => void) => {
    if (history.scheduler === `microtask`) queueMicrotask(callback)
    else setTimeout(callback, 0)
  }
  const queueAnswer = (details: Record<string, unknown>) => {
    if (answerQueued) return
    hostEnqueue(() => {
      emit(`answer-executed`, details) // First callback action: before state changes or answers.
      holding = false
      for (const request of pending) request.release()
    })
    answerQueued = true
    emit(`answer-queued`, {
      ...details,
      scheduler: history.scheduler,
      enqueueReturned: true,
    })
  }
  const tryQueueResolvingAnswer = (cut: string) => {
    if (answerQueued) return
    const queries: Array<QueryFact> = queryClient
      .getQueryCache()
      .getAll()
      .flatMap((query) => {
        const atom = hashKey(query.queryKey)
        const scope = queryScopes.get(atom)
        if (!scope) return []
        return [
          {
            identity: query,
            atom,
            key: query.queryKey,
            keys: [...scope.keys],
            owner: scope.subscriptionAtom,
            status: query.state.status,
            fetchStatus: query.state.fetchStatus,
            dataUpdateCount: query.state.dataUpdateCount,
            rows: rowIds(query.state.data),
          },
        ]
      })
    const facts = findQueuedAnswerPremise(
      pivot,
      pending.map((request) => ({
        ...request,
        aborted: request.signal?.aborted === true,
      })),
      queries,
      [...answers.values()],
      [...cacheVersions.values()],
    )
    if (!facts) return
    captureBindings(`conflicting-cache-premise`)
    emit(`source-stack`, {
      cut: `queued-answer-premise`,
      stack: new Error(`H02 current Query answer path`).stack,
    })
    emit(`conflicting-cache-premise`, {
      cut,
      pivot,
      pendingAtom: facts.request.atom,
      pendingKey: facts.request.key,
      cached: answerPayload(facts.cached),
      emptySibling: {
        atom: facts.answer.atom,
        key: facts.answer.key,
        answer: answerPayload(facts.answer),
      },
      observed: {
        pending: facts.request.pending,
        aborted: facts.request.aborted,
        pendingScope: facts.request.keys,
        pendingOwner: facts.request.owner,
        pendingStartCount: facts.request.startCount,
        pendingActualCount: facts.current.dataUpdateCount,
        pendingStatus: facts.current.status,
        pendingFetchStatus: facts.current.fetchStatus,
        siblingScope: facts.sibling.keys,
        siblingOwner: facts.sibling.owner,
        siblingStartCount: facts.answer.startCount,
        siblingActualCount: facts.sibling.dataUpdateCount,
        siblingStatus: facts.sibling.status,
        siblingRows: facts.sibling.rows,
        physicalQueriesCurrent: true,
        pendingPhysicalQuery: physicalQueryToken(facts.request.identity),
        currentPhysicalQuery: physicalQueryToken(facts.current.identity),
        siblingPhysicalQuery: physicalQueryToken(facts.sibling.identity),
        siblingAnswerPhysicalQuery: physicalQueryToken(facts.answer.identity),
      },
    })
    emit(`retained-publication`, {
      rows: readLive(),
      ...(history.metadataKeys ? { entries: captureEntries(live) } : {}),
      reason: `resolving answer still pending`,
    })
    queueAnswer({
      kind: `resolving-conflict`,
      atom: facts.request.atom,
      key: facts.request.key,
      cachedVersion: facts.cached.version,
      emptyVersion: facts.answer.version,
    })
  }
  const markers = createCollection(
    queryCollectionOptions<Marker>({
      id: `h02-progress-markers`,
      queryClient,
      queryKey: (options) => {
        const keys = requestedKeys(options)
        const owner = subscriptionAtom(options)
        const base = [`h02-progress-markers`]
        const key =
          owner === undefined
            ? base
            : [
                ...base,
                ...(history.cacheIdentity === `subscription` ? [owner] : []),
                keys,
              ]
        // Retain the ACTUAL empty callback and returned base. All later actual
        // callbacks/cache entries/fetch contexts are checked against this value.
        const emptyOptions = Object.keys(options).length === 0
        if (emptyOptions && actualBaseKey === undefined)
          actualBaseKey = [...key]
        validateActualKey(key, `queryKey-callback`)
        const atom = hashKey(key)
        queryScopes.set(atom, { key: [...key], keys, subscriptionAtom: owner })
        emit(`query-key-callback`, {
          emptyOptions,
          options: optionsReceipt(options),
          key,
          atom,
          activeAttempt: activeAttempts.at(-1),
        })
        return key
      },
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      queryFn: (context) => {
        validateActualKey(context.queryKey, `queryFn-context`)
        const atom = hashKey(context.queryKey)
        const options: LoadSubsetOptions = context.meta?.loadSubsetOptions ?? {}
        const keys = requestedKeys(options)
        const scope = queryScopes.get(atom)
        if (!scope || JSON.stringify(scope.keys) !== JSON.stringify(keys))
          throw new Error(`actual key/request scope mismatch`)
        const physicalQuery = queryClient
          .getQueryCache()
          .find({ queryKey: context.queryKey, exact: true })
        if (!physicalQuery)
          throw new Error(`current physical Query missing at request start`)
        const startCount = physicalQuery.state.dataUpdateCount
        emit(`provider-request`, {
          atom,
          key: context.queryKey,
          options: optionsReceipt(options),
          backendVersion,
          cached: answerPayload(cacheVersions.get(atom)),
          physicalQuery: physicalQueryToken(physicalQuery),
          startCount,
        })
        // This finite receiving profile serves complete predicate results.
        // Refuse an unexpected ordered/window request instead of ignoring its
        // contract and silently supplying a different provider behavior.
        if (
          options.orderBy !== undefined ||
          options.limit !== undefined ||
          options.offset !== undefined ||
          options.cursor !== undefined
        )
          throw new Error(`predicate-only provider premise not reached`)
        const complete = () => {
          const result = keys
            .filter((id) => marked.has(id))
            .map((id) => ({ id, rowId: id }))
          const answer = {
            identity: physicalQuery,
            atom,
            key: [...context.queryKey],
            keys: [...keys],
            owner: scope.subscriptionAtom,
            startCount,
            version: ++answerVersion,
            backendVersion,
            rows: result.map(({ id }) => id),
          }
          answers.set(atom, answer)
          emit(`provider-answer`, {
            atom,
            key: context.queryKey,
            answer: answerPayload(answer),
            physicalQuery: physicalQueryToken(physicalQuery),
            startCount,
          })
          return result
        }
        if (!holding) return Promise.resolve(complete())
        return new Promise<Array<Marker>>((resolve) => {
          const request: PendingAnswer = {
            identity: physicalQuery,
            key: [...context.queryKey],
            owner: scope.subscriptionAtom,
            startCount,
            signal: options.signal,
            aborted: options.signal?.aborted === true,
            atom,
            keys,
            pending: true,
            release: () => {
              if (!request.pending) return
              request.pending = false
              resolve(complete())
            },
          }
          pending.push(request)
          tryQueueResolvingAnswer(`held-queryFn-registration`)
        })
      },
    }),
  )
  const actualLoad = markers._sync.loadSubset.bind(markers._sync)
  markers._sync.loadSubset = (options) => {
    // A prior provider request may still be pending when a later cache result
    // installs. Check that same physical current request before reacquisition.
    tryQueueResolvingAnswer(`existing-pending-before-acquisition`)
    const attempt = ++acquisitionSequence
    const sameOptions = attempts.get(options) ?? []
    sameOptions.push(attempt)
    attempts.set(options, sameOptions)
    activeAttempts.push(attempt)
    emit(`acquisition-attempt`, {
      attempt,
      options: optionsReceipt(options),
      pivotPresent: markers.has(pivot),
    })
    if (holding && !feedbackStackCaptured) {
      const scope = {
        owner: subscriptionAtom(options),
        keys: requestedKeys(options),
      }
      const identity = JSON.stringify(scope)
      if (heldAcquisitionScopes.has(identity)) {
        feedbackStackCaptured = true
        emit(`source-stack`, {
          cut: `first-repeated-held-acquisition`,
          attempt,
          ...scope,
          stack: new Error(`H02 repeated held acquisition path`).stack,
        })
      } else heldAcquisitionScopes.add(identity)
    }
    if (!initialStackCaptured) {
      initialStackCaptured = true
      emit(`source-stack`, {
        cut: `initial-acquisition`,
        stack: new Error(`H02 current initial acquisition path`).stack,
      })
    }
    if (answerQueued && !stackCaptured) {
      stackCaptured = true
      emit(`source-stack`, {
        stack: new Error(`H02 current acquisition path`).stack,
      })
    }
    try {
      const result = actualLoad(options)
      emit(`acquisition-accepted`, { attempt, literalTrue: result === true })
      if (following) {
        followupAttempts.set(attempt, `pending`)
        // Observe the adapter's original applied-settlement promise; return it
        // unchanged. These receipts do not supply expected public values.
        void Promise.resolve(result).then(
          () => {
            followupAttempts.set(attempt, `fulfilled`)
            emit(`followup-acquisition-settled`, {
              attempt,
              outcome: `fulfilled`,
            })
          },
          (error: unknown) => {
            followupAttempts.set(attempt, `rejected`)
            followupError ??= error
            emit(`followup-acquisition-settled`, {
              attempt,
              outcome: `rejected`,
              message: String(error),
            })
          },
        )
      }
      return result
    } finally {
      activeAttempts.pop()
    }
  }
  const actualUnload = markers._sync.unloadSubset.bind(markers._sync)
  markers._sync.unloadSubset = (options) => {
    const attempt = attempts.get(options)?.shift()
    emit(`acquisition-release`, {
      attempt,
      options: optionsReceipt(options),
      pivotPresent: markers.has(pivot),
    })
    return actualUnload(options)
  }
  const live = createLiveQueryCollection({
    ...(history.metadataKeys === `authored`
      ? { getKey: (row: ProgressRow) => `metadata-root-${row.id}` }
      : {}),
    query: (q) => {
      const joined = q
        .from({ row: source })
        .leftJoin({ marker: markers }, ({ row, marker }) =>
          eq(row.id, marker.rowId),
        )
        .where(({ marker }) => isUndefined(marker.rowId))
        .orderBy(({ row }) => row.rank)
      const selected = history.window ? joined.offset(1).limit(1) : joined
      if (history.includes) {
        return selected.select(({ row }) => ({
          id: row.id,
          rank: row.rank,
          markers: toArray(
            q
              .from({ child: markers })
              .where(({ child }) => eq(child.rowId, row.id))
              .select(({ child }) => child.id),
          ),
        }))
      }
      return selected.select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        markers: [] as Array<number>,
      }))
    },
  })
  const readLive = () =>
    history.metadataKeys
      ? captureMetadataRows(live.toArray)
      : copyRows(live.toArray)
  const captureEntries = (collection: {
    entries: () => IterableIterator<[string | number, object]>
  }) =>
    Array.from(collection.entries(), ([key, row]) => [
      key,
      captureMetadataRows([row])[0]!,
    ])
  const downstream = createLiveQueryCollection({
    ...(history.metadataKeys === `authored`
      ? { getKey: (row: ProgressRow) => `metadata-downstream-${row.id}` }
      : {}),
    query: (q) =>
      q
        .from({ row: live })
        .orderBy(({ row }) => row.rank)
        .select(({ row }) => ({
          id: row.id,
          rank: row.rank,
          markers: row.markers,
          ...(history.metadataKeys
            ? {
                observedKey: row.$key,
                observedCollectionId: row.$collectionId,
                observedOrigin: row.$origin,
                observedPending: row.$hasPendingWrites,
              }
            : {}),
        })),
  })
  const readDownstream = () =>
    history.metadataKeys
      ? captureMetadataRows(downstream.toArray)
      : copyRows(downstream.toArray)
  const snapshotEntries = () =>
    history.metadataKeys
      ? {
          entries: captureEntries(live),
          downstreamEntries: captureEntries(downstream),
        }
      : {}
  const captureChanges = (
    changes: ReadonlyArray<{ value: object; previousValue?: object }>,
  ) =>
    changes.map((change) => ({
      ...change,
      value: captureMetadataRows([change.value])[0]!,
      ...(change.previousValue === undefined
        ? {}
        : { previousValue: captureMetadataRows([change.previousValue])[0]! }),
    }))
  if (history.metadataKeys)
    emit(`metadata-identities`, {
      sourceId: source.id,
      rootId: live.id,
      downstreamId: downstream.id,
      keyLane: history.metadataKeys,
    })
  const subscription = live.subscribeChanges((changes) => {
    rootCallbacks++
    emit(`public-change`, {
      changes: history.metadataKeys ? captureChanges(changes) : changes,
      rows: readLive(),
      ...(history.metadataKeys ? { entries: captureEntries(live) } : {}),
    })
    if (backendVersion === 1 && pending.some(({ pending: waiting }) => waiting))
      emit(`retained-publication`, {
        rows: readLive(),
        ...(history.metadataKeys ? { entries: captureEntries(live) } : {}),
        reason: `provider answer held during event`,
      })
  })
  // The downstream recorder supplies observations to the same publication law.
  // It computes no expected value and preserves every delivered payload.
  const downstreamSubscription = downstream.subscribeChanges((changes) => {
    downstreamCallbacks++
    emit(`downstream-change`, {
      changes: history.metadataKeys ? captureChanges(changes) : changes,
      rows: readDownstream(),
      ...(history.metadataKeys
        ? {
            entries: captureEntries(downstream),
            upstreamEntries: captureEntries(live),
          }
        : {}),
    })
  })
  try {
    await live.preload()
    await downstream.preload()
    emit(`initial-publication`, {
      rows: readLive(),
      ...(history.metadataKeys
        ? { downstream: readDownstream(), ...snapshotEntries() }
        : {}),
      ready: live.status === `ready`,
    })
    backendVersion = 1
    marked.delete(pivot)
    holding = true
    emit(`reload-start`, { pivot })
    const reload = markers.reload()
    // Observe rejection without converting it to success or losing its cause.
    void reload.catch((error: unknown) =>
      emit(`reload-rejected`, { message: String(error) }),
    )
    await hostTurn()
    // This is a held-provider cut, before this driver releases any replay
    // answer. A positive pending count is a measured premise, not a delay.
    const heldProviderAnswers = pending.filter(
      ({ pending: waiting }) => waiting,
    ).length
    emit(
      heldProviderAnswers > 0
        ? `retained-publication`
        : `provider-hold-unreached`,
      {
        reason: `provider-hold-before-release`,
        rows: readLive(),
        downstream: readDownstream(),
        ...snapshotEntries(),
        pendingProviderAnswers: heldProviderAnswers,
      },
    )
    const strict =
      history.includes &&
      history.window &&
      history.cacheIdentity === `subscription`
    for (const keys of [
      [history.keyShift + 1, history.keyShift + 2],
      [pivot],
    ]) {
      const request = pending.find(
        (candidate) =>
          candidate.pending &&
          JSON.stringify(candidate.keys) === JSON.stringify(keys),
      )
      if (request) {
        emit(`release-scope`, { atom: request.atom, keys })
        request.release()
        await hostTurn()
      } else if (strict)
        throw new Error(
          `required semantic replay scope not reached: ${JSON.stringify(keys)}`,
        )
    }
    if (!hasQueuedAnswer()) {
      if (strict) throw new Error(`conflicting cache premise not reached`)
      queueAnswer({ kind: `lawful-control` })
    }
    await reload
    if (history.metadataFollowupQuarter !== undefined) emit(`reload-settled`)
    let stableTurns = 0
    let previousCount = -1
    while (stableTurns < 2) {
      await hostTurn()
      const quiet =
        pending.every(({ pending: waiting }) => !waiting) &&
        queryClient
          .getQueryCache()
          .getAll()
          .every((query) => query.state.fetchStatus === `idle`)
      stableTurns =
        quiet && previousCount === answerVersion ? stableTurns + 1 : 0
      previousCount = answerVersion
    }
    emit(`final-publication`, {
      rows: readLive(),
      downstream: readDownstream(),
      ...snapshotEntries(),
      ready: live.status === `ready`,
      syncError: live.health.hasErrors,
      health: live.health,
      ...(history.metadataFollowupQuarter === undefined
        ? {}
        : {
            reloadSettled: true,
            rootSubscriptionStatus: subscription.status,
            downstreamSubscriptionStatus: downstreamSubscription.status,
            rootLoadingSubset: live.isLoadingSubset,
            downstreamLoadingSubset: downstream.isLoadingSubset,
          }),
    })
    captureBindings(`final-publication`)
    if (history.metadataFollowupQuarter !== undefined) {
      // The child records its settled baseline first. Only the parent judges
      // it and locks bindings, in contiguous receipt order; no acknowledgment.
      const beforeRoot = rootCallbacks
      const beforeDownstream = downstreamCallbacks
      following = true
      emit(`followup-start`)
      if (!sourceControls.writeRank)
        throw new Error(`source rank control missing`)
      const receipt = sourceControls.writeRank({
        id: pivot,
        rank: (3 + history.metadataFollowupQuarter / 4) * history.rankScale,
      })
      emit(`followup-source-accepted`, { literalTrue: receipt === true })
      await receipt
      emit(`followup-source-applied`)
      let stableFollowupTurns = 0
      let previousFollowup = ``
      while (stableFollowupTurns < 2) {
        await hostTurn()
        if (followupError !== undefined) throw followupError
        const requiresCallbacks = history.metadataFollowupQuarter > 0
        const actual = {
          attempts: [...followupAttempts],
          rootCallbacks: rootCallbacks - beforeRoot,
          downstreamCallbacks: downstreamCallbacks - beforeDownstream,
          rootSubscriptionStatus: subscription.status,
          downstreamSubscriptionStatus: downstreamSubscription.status,
          rootLoadingSubset: live.isLoadingSubset,
          downstreamLoadingSubset: downstream.isLoadingSubset,
        }
        // Applied source receipt + all actual new acquisitions + actual output
        // callbacks (for a changed value) establish the candidate receiving cut.
        // Quiet turns only drain later work; they cannot establish it alone.
        const complete =
          actual.attempts.every(([, state]) => state === `fulfilled`) &&
          actual.rootSubscriptionStatus === `ready` &&
          actual.downstreamSubscriptionStatus === `ready` &&
          !actual.rootLoadingSubset &&
          !actual.downstreamLoadingSubset &&
          (!requiresCallbacks ||
            (actual.rootCallbacks > 0 && actual.downstreamCallbacks > 0)) &&
          pending.every(({ pending: waiting }) => !waiting) &&
          queryClient
            .getQueryCache()
            .getAll()
            .every((query) => query.state.fetchStatus === `idle`)
        const signature = JSON.stringify(actual)
        stableFollowupTurns =
          complete && signature === previousFollowup
            ? stableFollowupTurns + 1
            : 0
        previousFollowup = signature
      }
      emit(`followup-settled`, {
        attempts: [...followupAttempts],
        rootCallbacks: rootCallbacks - beforeRoot,
        downstreamCallbacks: downstreamCallbacks - beforeDownstream,
        rootSubscriptionStatus: subscription.status,
        downstreamSubscriptionStatus: downstreamSubscription.status,
        rootLoadingSubset: live.isLoadingSubset,
        downstreamLoadingSubset: downstream.isLoadingSubset,
      })
      emit(`followup-publication`, {
        rows: readLive(),
        downstream: readDownstream(),
        ...snapshotEntries(),
        ready: live.status === `ready`,
        syncError: live.health.hasErrors,
      })
      captureBindings(`followup-publication`)
    }
  } finally {
    emit(`cleanup-start`)
    holding = false
    for (const request of pending) request.release()
    downstreamSubscription.unsubscribe()
    subscription.unsubscribe()
    await downstream.cleanup()
    await live.cleanup()
    await source.cleanup()
    await markers.cleanup()
    unsubscribeCache()
    queryClient.clear()
    console.warn = originalWarn
    emit(`worker-cleaned`)
  }
}
