import { writeSync } from 'node:fs'
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
import { queryCollectionOptions } from '../src/query.js'
import { progressFacts } from './queued-answer-progress-oracle.js'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { QueryKey } from '@tanstack/query-core'
import type {
  ProgressHistory,
  ProgressRow,
} from './queued-answer-progress-oracle.js'

type Marker = { id: number; rowId: number }
type PendingAnswer = {
  atom: string
  keys: Array<number>
  pending: boolean
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
  let sequence = 0
  const emit = (phase: string, details: Record<string, unknown> = {}) => {
    writeSync(
      1,
      JSON.stringify({ h02: true, sequence: ++sequence, phase, ...details }) +
        `\n`,
    )
  }
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
  const sourceControls: { change?: () => void } = {}
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
      const preload = live.preload()
      if (history.kind === `sync-initial`) {
        if (!hasLiteralTrueReceipt())
          throw new Error(`literal-true initial premise not reached`)
        emit(`immediate-publication`, {
          rows: copyRows(live.toArray),
          ready: live.status === `ready`,
        })
      }
      await preload
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
  const answers = new Map<
    string,
    { version: number; backendVersion: number; rows: Array<number> }
  >()
  const cacheVersions = new Map<
    string,
    { version: number; backendVersion: number; rows: Array<number> }
  >()
  const attempts = new WeakMap<LoadSubsetOptions, Array<number>>()
  const pending: Array<PendingAnswer> = []
  let actualBaseKey: QueryKey | undefined
  const activeAttempts: Array<number> = []
  let acquisitionSequence = 0
  let answerVersion = 0
  let backendVersion = 0
  let holding = false
  let answerQueued = false
  const hasQueuedAnswer = () => answerQueued
  let stackCaptured = false
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
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    validateActualKey(event.query.queryKey, `cache-${event.type}`)
    if (event.type === `updated` && event.action.type === `success`) {
      const atom = hashKey(event.query.queryKey)
      const answer = answers.get(atom)
      const actualRows = rowIds(event.query.state.data)
      if (
        answer &&
        JSON.stringify(answer.rows) === JSON.stringify(actualRows)
      ) {
        cacheVersions.set(atom, { ...answer, rows: [...answer.rows] })
      }
      emit(`cache-success`, {
        atom,
        key: event.query.queryKey,
        dataUpdateCount: event.query.state.dataUpdateCount,
        answer: cacheVersions.get(atom),
        actualRows,
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
        emit(`provider-request`, {
          atom,
          key: context.queryKey,
          options: optionsReceipt(options),
          backendVersion,
          cached: cacheVersions.get(atom),
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
            version: ++answerVersion,
            backendVersion,
            rows: result.map(({ id }) => id),
          }
          answers.set(atom, answer)
          emit(`provider-answer`, { atom, key: context.queryKey, answer })
          return result
        }
        if (!holding) return Promise.resolve(complete())
        return new Promise<Array<Marker>>((resolve) => {
          const request: PendingAnswer = {
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
          const cached = cacheVersions.get(atom)
          const emptySibling = [...cacheVersions].find(
            ([other, version]) =>
              other !== atom &&
              version.backendVersion === 1 &&
              version.rows.length === 0 &&
              JSON.stringify(queryScopes.get(other)?.keys) ===
                JSON.stringify([pivot]),
          )
          if (
            !answerQueued &&
            keys.length === 1 &&
            keys[0] === pivot &&
            cached?.rows.includes(pivot) &&
            cached.backendVersion === 0 &&
            emptySibling
          ) {
            captureBindings(`conflicting-cache-premise`)
            emit(`source-stack`, {
              cut: `queued-answer-premise`,
              stack: new Error(`H02 current Query answer path`).stack,
            })
            emit(`conflicting-cache-premise`, {
              pivot,
              pendingAtom: atom,
              pendingKey: context.queryKey,
              cached,
              emptySibling: {
                atom: emptySibling[0],
                key: queryScopes.get(emptySibling[0])?.key,
                answer: emptySibling[1],
              },
            })
            emit(`retained-publication`, {
              rows: readLive(),
              reason: `resolving answer still pending`,
            })
            queueAnswer({
              kind: `resolving-conflict`,
              atom,
              key: context.queryKey,
              cachedVersion: cached.version,
              emptyVersion: emptySibling[1].version,
            })
          }
        })
      },
    }),
  )
  const actualLoad = markers._sync.loadSubset.bind(markers._sync)
  markers._sync.loadSubset = (options) => {
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
  const live = createLiveQueryCollection((q) => {
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
  })
  const readLive = () => copyRows(live.toArray)
  const downstream = createLiveQueryCollection((q) =>
    q
      .from({ row: live })
      .orderBy(({ row }) => row.rank)
      .select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        markers: row.markers,
      })),
  )
  const subscription = live.subscribeChanges((changes) => {
    emit(`public-change`, { changes, rows: readLive() })
    if (backendVersion === 1 && pending.some(({ pending: waiting }) => waiting))
      emit(`retained-publication`, {
        rows: readLive(),
        reason: `provider answer held during event`,
      })
  })
  const downstreamSubscription = downstream.subscribeChanges(() => {})
  try {
    await live.preload()
    await downstream.preload()
    emit(`initial-publication`, {
      rows: readLive(),
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
      downstream: copyRows(downstream.toArray),
      ready: live.status === `ready`,
      syncError: live.health.hasErrors,
      health: live.health,
    })
    captureBindings(`final-publication`)
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
