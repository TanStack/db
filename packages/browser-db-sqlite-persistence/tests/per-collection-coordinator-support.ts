// Fixtures shared by per-collection-coordinator-oracle.test.ts and
// per-collection-coordinator.test.ts: controlled BroadcastChannel and Web Locks
// seams, coordinator lifecycle and cleanup helpers, and the adapter recorders.
// Oracle laws and their models stay in the oracle file.

import { setImmediate as nextTurn } from 'node:timers/promises'
import { IR, createCollection, whenSyncAccepted } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { expect } from 'vitest'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { storageId } from './browser-coordinator-support'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type {
  PersistedStorageTarget,
  PersistenceAdapter,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'
import type { LoadSubsetOptions, Subscription, SyncConfig } from '@tanstack/db'
import type { BrowserWASQLiteDatabase } from '../src'

export const DEFAULT_RUNS = 12

export const durableTerms = new Map<string, number>()

export type CoordinatorOracleProperty = `remote-lease` | `routing`

export type CoordinatorOracleEnvironment = Record<string, string | undefined>

export type CoordinatorOracleReplay = {
  property: CoordinatorOracleProperty
  seed: number
  path: string
}

export function readCoordinatorOracleConfig(
  environment: CoordinatorOracleEnvironment = process.env,
): { runs: number; replay?: CoordinatorOracleReplay } {
  const runText =
    environment.TANSTACK_DB_COORDINATOR_ORACLE_RUNS ?? String(DEFAULT_RUNS)
  const runs = Number(runText)
  if (!/^\d+$/.test(runText) || !Number.isSafeInteger(runs) || runs < 1) {
    throw new Error(`Invalid TANSTACK_DB_COORDINATOR_ORACLE_RUNS`)
  }

  const seedText = environment.TANSTACK_DB_COORDINATOR_ORACLE_SEED
  const path = environment.TANSTACK_DB_COORDINATOR_ORACLE_PATH
  const property = environment.TANSTACK_DB_COORDINATOR_ORACLE_PROPERTY
  if (seedText === undefined && path === undefined && property === undefined) {
    return { runs }
  }
  if (seedText === undefined || path === undefined || property === undefined) {
    throw new Error(
      `Coordinator oracle replay requires SEED, PATH, and PROPERTY together`,
    )
  }

  const seed = Number(seedText)
  if (!/^-?\d+$/.test(seedText) || !Number.isSafeInteger(seed)) {
    throw new Error(`Invalid TANSTACK_DB_COORDINATOR_ORACLE_SEED`)
  }
  if (!/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(
      `TANSTACK_DB_COORDINATOR_ORACLE_PATH must be a numeric shrink path`,
    )
  }
  if (property !== `remote-lease` && property !== `routing`) {
    throw new Error(
      `TANSTACK_DB_COORDINATOR_ORACLE_PROPERTY must be remote-lease or routing`,
    )
  }
  return { runs, replay: { property, seed, path } }
}

export type MessageHandler = (event: { data: unknown }) => void

export type DelayedDelivery = {
  channel: string
  source: ControlledBroadcastChannel
  target: ControlledBroadcastChannel
  data: unknown
}

export type CloneAttempt = {
  data: unknown
  errorName?: string
}

export class ControlledBroadcastChannel {
  static readonly endpoints = new Map<string, Set<ControlledBroadcastChannel>>()
  static readonly delayed: Array<DelayedDelivery> = []
  static readonly cloneAttempts: Array<CloneAttempt> = []
  static retiredDeliveries = 0

  readonly name: string
  onmessage: MessageHandler | null = null

  constructor(name: string) {
    this.name = name
    const peers = ControlledBroadcastChannel.endpoints.get(name) ?? new Set()
    peers.add(this)
    ControlledBroadcastChannel.endpoints.set(name, peers)
  }

  postMessage(data: unknown): void {
    let copy: unknown
    try {
      copy = structuredClone(data)
      ControlledBroadcastChannel.cloneAttempts.push({ data })
    } catch (error) {
      ControlledBroadcastChannel.cloneAttempts.push({
        data,
        errorName: error instanceof Error ? error.name : String(error),
      })
      throw error
    }

    for (const target of ControlledBroadcastChannel.endpoints.get(this.name) ??
      []) {
      if (target === this || !target.onmessage) continue
      ControlledBroadcastChannel.delayed.push({
        channel: this.name,
        source: this,
        target,
        data: copy,
      })
    }
  }

  close(): void {
    const peers = ControlledBroadcastChannel.endpoints.get(this.name)
    peers?.delete(this)
    if (peers?.size === 0) {
      ControlledBroadcastChannel.endpoints.delete(this.name)
    }
    for (
      let index = ControlledBroadcastChannel.delayed.length - 1;
      index >= 0;
      index--
    ) {
      const delivery = ControlledBroadcastChannel.delayed[index]
      if (delivery?.source === this || delivery?.target === this) {
        ControlledBroadcastChannel.delayed.splice(index, 1)
        ControlledBroadcastChannel.retiredDeliveries++
      }
    }
    this.onmessage = null
  }

  static deliverAt(index: number): boolean {
    const [delivery] = this.delayed.splice(index, 1)
    if (!delivery) return false
    delivery.target.onmessage?.({ data: delivery.data })
    return true
  }

  static deliverWhere(predicate: (data: unknown) => boolean): boolean {
    const index = this.delayed.findIndex((delivery) => predicate(delivery.data))
    return index >= 0 ? this.deliverAt(index) : false
  }

  static reset(): void {
    this.endpoints.clear()
    this.delayed.length = 0
    this.cloneAttempts.length = 0
    this.retiredDeliveries = 0
  }
}

export type LockCallback = (lock: { name: string }) => Promise<unknown>

export type LockQueueEntry = {
  callback: LockCallback
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export const heldLocks = new Set<string>()

export const queuedLocks = new Map<string, Array<LockQueueEntry>>()

export function grantNextLock(name: string): void {
  if (heldLocks.has(name)) return
  const queue = queuedLocks.get(name)
  const next = queue?.shift()
  if (!next) return
  if (queue?.length === 0) queuedLocks.delete(name)
  if (next.signal?.aborted) {
    grantNextLock(name)
    return
  }

  heldLocks.add(name)
  void Promise.resolve(next.callback({ name })).then(
    (value) => {
      heldLocks.delete(name)
      next.resolve(value)
      grantNextLock(name)
    },
    (error) => {
      heldLocks.delete(name)
      next.reject(error)
      grantNextLock(name)
    },
  )
}

export const controlledLocks = {
  request: (
    name: string,
    optionsOrCallback: { signal?: AbortSignal } | LockCallback,
    maybeCallback?: LockCallback,
  ): Promise<unknown> => {
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    const signal =
      typeof optionsOrCallback === `object`
        ? optionsOrCallback.signal
        : undefined

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException(`Lock request aborted`, `AbortError`))
        return
      }
      const entry = { callback, signal, resolve, reject }
      const queue = queuedLocks.get(name) ?? []
      queue.push(entry)
      queuedLocks.set(name, queue)
      signal?.addEventListener(
        `abort`,
        () => {
          const current = queuedLocks.get(name)
          const index = current?.indexOf(entry) ?? -1
          if (index >= 0) {
            current!.splice(index, 1)
            if (current!.length === 0) queuedLocks.delete(name)
            reject(new DOMException(`Lock request aborted`, `AbortError`))
          }
        },
        { once: true },
      )
      grantNextLock(name)
    })
  },
}

export let originalBroadcastChannelDescriptor: PropertyDescriptor | undefined

export let originalNavigatorDescriptor: PropertyDescriptor | undefined

export function installControlledBrowserSeams(): void {
  originalBroadcastChannelDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    `BroadcastChannel`,
  )
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    `navigator`,
  )
  Object.defineProperty(globalThis, `BroadcastChannel`, {
    value: ControlledBroadcastChannel,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(globalThis, `navigator`, {
    value: { locks: controlledLocks },
    writable: true,
    configurable: true,
  })
}

export function restoreControlledBrowserSeams(): void {
  if (originalBroadcastChannelDescriptor) {
    Object.defineProperty(
      globalThis,
      `BroadcastChannel`,
      originalBroadcastChannelDescriptor,
    )
  } else {
    Reflect.deleteProperty(globalThis, `BroadcastChannel`)
  }
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, `navigator`, originalNavigatorDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, `navigator`)
  }
  originalBroadcastChannelDescriptor = undefined
  originalNavigatorDescriptor = undefined
}

export function payloadType(data: unknown): string | undefined {
  if (!data || typeof data !== `object` || !(`payload` in data))
    return undefined
  const payload = (data as { payload?: unknown }).payload
  if (!payload || typeof payload !== `object` || !(`type` in payload)) {
    return undefined
  }
  return String((payload as { type?: unknown }).type)
}

export function envelopeCollection(data: unknown): string | undefined {
  if (!data || typeof data !== `object` || !(`collectionId` in data)) {
    return undefined
  }
  return String((data as { collectionId?: unknown }).collectionId)
}

export async function pumpNetwork(): Promise<void> {
  for (let pass = 0; pass < 100; pass++) {
    while (ControlledBroadcastChannel.deliverAt(0)) {
      await Promise.resolve()
    }
    await nextTurn()
    if (ControlledBroadcastChannel.delayed.length === 0) return
  }
  throw new Error(`controlled network failed to become idle`)
}

export async function waitFor(
  predicate: () => boolean,
  checkpoint: string,
): Promise<void> {
  for (let pass = 0; pass < 100; pass++) {
    if (predicate()) return
    await pumpNetwork()
    await nextTurn()
  }
  throw new Error(`did not reach ${checkpoint}`)
}

export async function waitForWithoutDelivery(
  predicate: () => boolean,
  checkpoint: string,
): Promise<void> {
  for (let pass = 0; pass < 100; pass++) {
    if (predicate()) return
    await nextTurn()
  }
  throw new Error(`did not reach ${checkpoint}`)
}

export type CleanupDiagnostic = {
  resource: string
  error: string
}

export const NO_PRIMARY_FAILURE = Symbol(`no-primary-failure`)

export async function captureCleanup(
  diagnostics: Array<CleanupDiagnostic>,
  resource: string,
  cleanup: () => Promise<void> | void,
): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    diagnostics.push({
      resource,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    })
  }
}

export async function withFailurePreservingCleanup(
  body: () => Promise<void>,
  cleanups: ReadonlyArray<readonly [string, () => Promise<void> | void]>,
): Promise<void> {
  let primaryFailure: unknown | typeof NO_PRIMARY_FAILURE = NO_PRIMARY_FAILURE
  const cleanupDiagnostics: Array<CleanupDiagnostic> = []
  try {
    await body()
  } catch (error) {
    primaryFailure = error
  }
  for (const [resource, cleanup] of cleanups) {
    await captureCleanup(cleanupDiagnostics, resource, cleanup)
  }
  expect.soft(cleanupDiagnostics).toEqual([])
  if (primaryFailure !== NO_PRIMARY_FAILURE) throw primaryFailure
}

export type AdapterCall = {
  operation: `load` | `apply` | `index` | `position` | `remote-subset` | `pull`
  adapterId: string
  collectionId: string
  ownerAtCall?: string
  argument?: SemanticValue
}

export type PullFixtureResult = {
  latestRowVersion: number
  requiresFullReload: false
  changedKeys: Array<string | number>
  deletedKeys: Array<string | number>
}

export type RecordedSubsetOptions =
  LoadSubsetOptions | TransportedLoadSubsetOptions

export type RecordingAdapter = PersistenceAdapter & {
  id: string
  schemaVersion: number
  policy: `sync-present-reset` | `sync-absent-error`
  calls: Array<AdapterCall>
  getStreamPosition: (target: PersistedStorageTarget) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
  ensureRemoteSubset: (
    collectionId: string,
    options: RecordedSubsetOptions,
  ) => Promise<void>
  pullSince: (
    target: PersistedStorageTarget,
    fromRowVersion: number,
  ) => Promise<PullFixtureResult>
}

export function createRecordingAdapter(options: {
  id: string
  schemaVersion?: number
  policy?: RecordingAdapter[`policy`]
  owner?: () => string | undefined
  remoteSubsetOwner?: (
    collectionId: string,
    options: RecordedSubsetOptions,
  ) => Promise<void>
  pullResult?: PullFixtureResult
}): RecordingAdapter {
  const calls: Array<AdapterCall> = []
  const record = (
    operation: AdapterCall[`operation`],
    collectionId: string,
    argument?: SemanticValue,
  ) => {
    calls.push({
      operation,
      adapterId: options.id,
      collectionId,
      ownerAtCall: options.owner?.(),
      ...(argument === undefined ? {} : { argument }),
    })
  }

  return {
    id: options.id,
    schemaVersion: options.schemaVersion ?? 1,
    policy: options.policy ?? `sync-present-reset`,
    calls,
    loadSubset: (target) => {
      record(`load`, storageId(target))
      return Promise.resolve([])
    },
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
    applyCommittedTx: (target) => {
      record(`apply`, storageId(target))
      return Promise.resolve()
    },
    ensureIndex: (target, signature, spec) => {
      record(`index`, storageId(target), semanticValue({ signature, spec }))
      return Promise.resolve()
    },
    getStreamPosition: (target) => {
      record(`position`, storageId(target))
      return Promise.resolve({
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
      })
    },
    async reserveLeadershipTerm(target, observedTerm) {
      const collectionId = storageId(target)
      const position = await this.getStreamPosition(target)
      const latestTerm =
        Math.max(
          position.latestTerm,
          durableTerms.get(collectionId) ?? 0,
          observedTerm,
        ) + 1
      durableTerms.set(collectionId, latestTerm)
      return { ...position, latestTerm }
    },
    ensureRemoteSubset: (collectionId, subsetOptions) => {
      record(`remote-subset`, collectionId, subsetSemantics(subsetOptions))
      if (!options.remoteSubsetOwner) {
        throw new Error(`no remote subset owner for ${collectionId}`)
      }
      return options.remoteSubsetOwner(collectionId, subsetOptions)
    },
    pullSince: (target, fromRowVersion) => {
      record(`pull`, storageId(target), semanticValue({ fromRowVersion }))
      const result = options.pullResult ?? {
        latestRowVersion: 0,
        requiresFullReload: false,
        changedKeys: [],
        deletedKeys: [],
      }
      return Promise.resolve(structuredClone(result))
    },
  }
}

export type SemanticValue =
  | null
  | boolean
  | number
  | string
  | Array<SemanticValue>
  | { [key: string]: SemanticValue }

export function semanticValue(value: unknown): SemanticValue {
  if (
    value === null ||
    typeof value === `boolean` ||
    typeof value === `number` ||
    typeof value === `string`
  ) {
    return value
  }
  if (value instanceof Date) return { date: value.toISOString() }
  if (value instanceof Uint8Array) return { bytes: Array.from(value) }
  if (Array.isArray(value)) return value.map(semanticValue)
  if (typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, semanticValue(entry)]),
    )
  }
  throw new Error(`unsupported semantic wire value: ${typeof value}`)
}

export function subsetSemantics(
  options: LoadSubsetOptions | TransportedLoadSubsetOptions,
): SemanticValue {
  return semanticValue({
    ...(options.where === undefined ? {} : { where: options.where }),
    ...(options.orderBy === undefined ? {} : { orderBy: options.orderBy }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.offset === undefined ? {} : { offset: options.offset }),
  })
}

export function complexSubsetDemand(
  includeSubscription: boolean,
): LoadSubsetOptions {
  return {
    where: new IR.Func(`eq`, [
      new IR.PropRef([`alpha`, `createdAt`]),
      new IR.Value(new Date(`2026-09-16T12:34:56.000Z`)),
    ]),
    orderBy: [
      {
        expression: new IR.PropRef([`alpha`, `score`]),
        compareOptions: { direction: `desc`, nulls: `last` },
      },
    ],
    limit: 3,
    cursor: {
      whereFrom: new IR.Func(`gt`, [
        new IR.PropRef([`alpha`, `token`]),
        new IR.Value(new Uint8Array([1, 2, 255])),
      ]),
      whereCurrent: new IR.Func(`eq`, [
        new IR.PropRef([`alpha`, `score`]),
        new IR.Value(42),
      ]),
      lastKey: `a-42`,
    },
    offset: 1,
    ...(includeSubscription
      ? {
          subscription: {
            on: () => () => {},
          } as unknown as Subscription,
        }
      : {}),
  }
}

export const liveCoordinators = new Set<BrowserCollectionCoordinator>()

export function createCoordinator(
  dbName: string,
  adapter: PersistenceAdapter,
): BrowserCollectionCoordinator {
  const coordinator = new BrowserCollectionCoordinator({ dbName, adapter })
  liveCoordinators.add(coordinator)
  return coordinator
}

export function registerCollectionAdapter(
  coordinator: BrowserCollectionCoordinator,
  collectionId: string,
  adapter: RecordingAdapter,
  registerOwner: boolean = true,
): void {
  coordinator.setAdapterForCollection(collectionId, adapter)
  if (!registerOwner) return
  coordinator.registerRemoteSubsetOwner(
    collectionId,
    Object.assign(
      (options: TransportedLoadSubsetOptions) =>
        adapter.ensureRemoteSubset(collectionId, options),
      {
        // These route/wire laws do not exercise acquisition-release semantics; the
        // dedicated remote-ownership oracle below owns exact unload behavior.
        unloadSubset: () => {},
        onError: () => {},
      },
    ),
  )
}

export async function disposeCoordinator(
  coordinator?: BrowserCollectionCoordinator,
): Promise<void> {
  if (!coordinator || !liveCoordinators.has(coordinator)) return
  coordinator.dispose()
  liveCoordinators.delete(coordinator)
  await nextTurn()
}

export function coordinatorFixtureSnapshot() {
  return {
    delayed: ControlledBroadcastChannel.delayed.length,
    endpoints: ControlledBroadcastChannel.endpoints.size,
    heldLocks: heldLocks.size,
    queuedLocks: Array.from(queuedLocks.values()).reduce(
      (count, queue) => count + queue.length,
      0,
    ),
  }
}

export type RemoteLeaseHistory = {
  siblingCount: number
  releasePrefix: number
  identical: boolean
  duplicateRelease: boolean
  reverseFinalRelease: boolean
}

export type RemoteLeaseGrammarPlan = {
  demands: Array<{ limit: number; offset?: number }>
  releaseCount: number
  prefixReleaseIndexes: Array<number>
  finalReleaseIndexes: Array<number>
  releasePasses: number
}

export function remoteLeaseGrammarPlan(
  history: RemoteLeaseHistory,
): RemoteLeaseGrammarPlan {
  const demands = Array.from(
    { length: history.siblingCount },
    (_unused, index) => ({
      limit: 1,
      ...(history.identical ? {} : { offset: index }),
    }),
  )
  const releaseCount = Math.min(history.releasePrefix, history.siblingCount - 1)
  const prefixReleaseIndexes = Array.from(
    { length: releaseCount },
    (_unused, index) => index,
  )
  const finalReleaseIndexes = Array.from(
    { length: history.siblingCount - releaseCount },
    (_unused, index) => releaseCount + index,
  )
  if (history.reverseFinalRelease) finalReleaseIndexes.reverse()
  return {
    demands,
    releaseCount,
    prefixReleaseIndexes,
    finalReleaseIndexes,
    releasePasses: history.duplicateRelease ? 2 : 1,
  }
}

export type CollectionName = `alpha` | `beta`

export type TabName = `leader` | `follower`

export type RoutingHistory = {
  alphaVersion: number
  betaVersion: number
  registrationOrder: [CollectionName, CollectionName]
  firstDeliveryOrder: [CollectionName, CollectionName]
  secondDeliveryOrder: [CollectionName, CollectionName]
}

export type RoutingHistoryAxes = Omit<RoutingHistory, `betaVersion`> & {
  versionDelta: number
}

export function routingHistoryFromAxes({
  alphaVersion,
  versionDelta,
  ...history
}: RoutingHistoryAxes): RoutingHistory {
  return {
    ...history,
    alphaVersion,
    betaVersion: alphaVersion + versionDelta,
  }
}

export type RoutingGrammarPlan = {
  initialCollection: CollectionName
  registrationOrder: [CollectionName, CollectionName]
  firstDeliveryOrder: [CollectionName, CollectionName]
  secondDeliveryOrder: [CollectionName, CollectionName]
  adapterIds: Record<TabName, Record<CollectionName, string>>
}

export function routingGrammarPlan(
  history: RoutingHistory,
): RoutingGrammarPlan {
  return {
    initialCollection: history.registrationOrder[0],
    registrationOrder: history.registrationOrder,
    firstDeliveryOrder: history.firstDeliveryOrder,
    secondDeliveryOrder: history.secondDeliveryOrder,
    adapterIds: {
      leader: {
        alpha: `leader-alpha-v${history.alphaVersion}-reset`,
        beta: `leader-beta-v${history.betaVersion}-error`,
      },
      follower: {
        alpha: `follower-alpha-v${history.alphaVersion}-reset`,
        beta: `follower-beta-v${history.betaVersion}-error`,
      },
    },
  }
}

// Node's own BroadcastChannel and Web Locks, captured before any test installs
// the controlled seams. This lane swaps them in for its body only.
export const nativeBroadcastChannel = globalThis.BroadcastChannel

export const nativeNavigator = globalThis.navigator

export function withNativeBrowserTransport<T>(
  body: () => Promise<T>,
): Promise<T> {
  const controlledChannel = globalThis.BroadcastChannel
  const controlledNavigator = globalThis.navigator
  const define = (channel: unknown, navigator: unknown) => {
    Object.defineProperty(globalThis, `BroadcastChannel`, {
      value: channel,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, `navigator`, {
      value: navigator,
      writable: true,
      configurable: true,
    })
  }
  define(nativeBroadcastChannel, nativeNavigator)
  return body().finally(() => define(controlledChannel, controlledNavigator))
}

export type RealTabSource = `receipt` | `query-db`

export type RealTabRow = { id: string; group: string }

// One tab: a real SQLite connection to the shared file, a real coordinator,
// browser persistence, and the persisted on-demand Collection every tab
// defines. Only the leader's source runs; a follower routes demand.
export function createRealTab(options: {
  dbName: string
  filename: string
  source: RealTabSource
  upstream: Map<string, RealTabRow>
  holdUpstream?: () => Promise<void>
  readGate?: (rows: ReadonlyArray<unknown>) => Promise<void>
  now?: () => number
  // Commit on every load: a newer version of a delivered row (`update`), or
  // the same row inserted again (`reinsert`, an equal-value insert core
  // reconciles as an update).
  commitEachLoad?: `update` | `reinsert`
}) {
  const database = createWASQLiteTestDatabase({ filename: options.filename })
  const gatedDatabase: BrowserWASQLiteDatabase = {
    execute: async (sql, params) => {
      const rows = await database.execute(sql, params)
      if (options.readGate && /^\s*select/i.test(sql)) {
        await options.readGate(rows)
      }
      return rows as never
    },
    close: () => database.close?.(),
  }
  const coordinator = new BrowserCollectionCoordinator({
    dbName: options.dbName,
  })
  liveCoordinators.add(coordinator)
  const persistence = createBrowserWASQLitePersistence({
    database: gatedDatabase,
    coordinator,
    ...(options.now
      ? { now: options.now, cacheGenerationClaimTtlMs: 10_000 }
      : {}),
  })
  const upstreamRows = (where: unknown) => {
    const wanted = JSON.stringify(where ?? null)
    return Array.from(options.upstream.values()).filter((row) =>
      wanted.includes(`"${row.id}"`),
    )
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const trace: Array<string> = []
  let storageCollectionId: string | undefined
  const setAdapter = coordinator.setAdapterForCollection.bind(coordinator)
  coordinator.setAdapterForCollection = (collectionId, adapter, claimId) => {
    if (claimId) storageCollectionId = collectionId
    setAdapter(collectionId, adapter, claimId)
  }
  const ensure = coordinator.requestEnsureRemoteSubset.bind(coordinator)
  coordinator.requestEnsureRemoteSubset = (collectionId, subset) => {
    trace.push(`ensure`)
    return ensure(collectionId, subset).finally(() =>
      trace.push(`ensure-settled`),
    )
  }
  const loadUpstream = async (where: unknown) => {
    trace.push(`upstream`)
    await options.holdUpstream?.()
    return upstreamRows(where)
  }
  const delivered = new Set<string>()
  let version = 0
  const receiptSource: SyncConfig<RealTabRow, string> = {
    sync: ({ begin, write, commit, markReady }) => {
      markReady()
      return {
        loadSubset: async (subset) => {
          if (options.commitEachLoad) {
            const fresh = await loadUpstream(subset.where)
            if (fresh.length === 0) return
            begin()
            for (const row of fresh) {
              const delivered_ = delivered.has(row.id)
              delivered.add(row.id)
              if (options.commitEachLoad === `update` && delivered_) {
                const next = { ...row, group: `v${++version}` }
                options.upstream.set(row.id, next)
                write({ type: `update`, value: next })
              } else write({ type: `insert`, value: row })
            }
            await whenSyncAccepted(commit())
            return
          }
          // Like a real source, deliver each upstream row version once.
          const rows = (await loadUpstream(subset.where)).filter(
            (row) => !delivered.has(row.id),
          )
          for (const row of rows) delivered.add(row.id)
          if (rows.length === 0) return
          begin()
          for (const row of rows) write({ type: `insert`, value: row })
          await whenSyncAccepted(commit())
        },
      }
    },
  }
  const collection =
    options.source === `receipt`
      ? createCollection(
          persistedCollectionOptions<RealTabRow, string>({
            id: `real-tab-items`,
            schemaVersion: 1,
            persistence,
            syncMode: `on-demand`,
            getKey: (row) => row.id,
            sync: receiptSource,
          }),
        )
      : createCollection(
          persistedCollectionOptions<RealTabRow, string>({
            id: `real-tab-items`,
            schemaVersion: 1,
            persistence,
            ...queryCollectionOptions<
              RealTabRow,
              unknown,
              Array<string>,
              string
            >({
              queryKey: [`real-tab-items`],
              queryClient,
              syncMode: `on-demand`,
              getKey: (row) => row.id,
              queryFn: (context) =>
                loadUpstream(context.meta?.loadSubsetOptions?.where),
            }),
          }),
        )
  return {
    coordinator,
    collection,
    trace,
    storageCollectionId: () => storageCollectionId,
    cleanup: async () => {
      await collection.cleanup()
      queryClient.clear()
      coordinator.dispose()
      liveCoordinators.delete(coordinator)
      database.close?.()
    },
  }
}
