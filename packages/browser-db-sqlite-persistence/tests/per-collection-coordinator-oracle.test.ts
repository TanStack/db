import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fc } from '@fast-check/vitest'
import { IR, createCollection } from '@tanstack/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type {
  PersistedCollectionCoordinator,
  PersistedMutationEnvelope,
  PersistedTx,
  PersistenceAdapter,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'
import type { LoadSubsetOptions, Subscription, SyncConfig } from '@tanstack/db'
import type { BrowserWASQLiteDatabase } from '../src'

const seedText = process.env.TANSTACK_DB_COORDINATOR_ORACLE_SEED ?? `165902`
const runText = process.env.TANSTACK_DB_COORDINATOR_ORACLE_RUNS ?? `12`
const SEED = Number(seedText)
const RUNS = Number(runText)
const PATH = process.env.TANSTACK_DB_COORDINATOR_ORACLE_PATH

if (!/^-?\d+$/.test(seedText) || !Number.isSafeInteger(SEED)) {
  throw new Error(`Invalid TANSTACK_DB_COORDINATOR_ORACLE_SEED`)
}
if (!/^\d+$/.test(runText) || !Number.isSafeInteger(RUNS) || RUNS < 1) {
  throw new Error(`Invalid TANSTACK_DB_COORDINATOR_ORACLE_RUNS`)
}
if (PATH !== undefined && !/^\d+(?::\d+)*$/.test(PATH)) {
  throw new Error(
    `TANSTACK_DB_COORDINATOR_ORACLE_PATH must be a numeric shrink path`,
  )
}

/*
Coverage owner and test cards
=============================

This suite owns the RFC #1659 Workstream 2 cut across
BrowserCollectionCoordinator, browser persistence resolution, and the
persisted sync wrapper. browser-coordinator.test.ts is still the focused RPC
unit owner, and db-sqlite-persistence-core/tests/persisted.test.ts is still the
single-runtime owner. Putting this history in either file would replace the
other production boundary with a stub and lose the collection x tab x adapter
identity question. The real SQLite witness below extends the existing browser
runtime helper instead of claiming a new driver model.

Routing law and source:
- RFC #1659 release invariants 3, 4, and 9; BrowserCollectionCoordinator's
  collectionId-bearing PersistedCollectionCoordinator API; issues #1589 and
  #1753. Configuration and adapter effects for collection A cannot be handled
  by collection B's adapter, before or after leadership transfer.
- History grammar: two distinct collections, distinct schema versions/policies,
  two tabs, reordered request delivery, local writes, and leadership transfer.
  The reference is a Map keyed by (tab, collection), not the
  coordinator's mutable adapter slot.
- Production/checkpoint: real coordinator RPC plus Web Locks seam; compare the
  adapter identity that applies each collection's transaction after both the
  initial and takeover phases. The fixed witness additionally checks real
  SQLite row count, registry schema, and reset epoch after merely subscribing.

Wire/ack law and source:
- RFC invariant 4, LoadSubsetOptions' immutable-request contract, and
  LoadSubsetFn's applied-receipt contract; issue #1498. The emitted heartbeat,
  RPC, and tx variants exercised by the partition below must survive
  structuredClone. Subset expression/cursor/order/window semantics cross the
  wire; live signal/subscription ownership stays local. A successful follower
  response is permitted only after the leader's exact upstream subset load has
  completed.
- History grammar: a callback-bearing Subscription witness plus clone-safe
  expression, limit, and offset request data. Requests and responses may be
  held separately.
- Production/checkpoint: BrowserCollectionCoordinator.sendRPC and the public
  persisted on-demand leader collection. Record postMessage clone failures,
  upstream load entry/completion, and follower settlement at response delivery.

Acquisition law and source:
- RFC invariant 4 and the remote-subset owner contract. Demand can survive
  leadership transfer, but every accepted physical acquisition creates an
  acquisition lease with one exact release obligation.
- History grammar: sibling logical owners, reused and distinct request-data
  objects, prefix and duplicate release, owner replacement, and leadership
  transfer. `RemoteLeaseOwnerLedger` is a model-only call ledger whose active
  entries represent physical acquisitions and their acquisition leases.
- Production/checkpoint: real coordinator ensure/release calls. Compare owner
  load/unload counts, exact request-data identity, active acquisitions, and
  cleanup after each release and takeover cut.

Write-ownership law and source:
- RFC invariants 3 and 9 and issue #1753. A sync-ingested persistent write has
  the same supported-owner requirement as a local write.
- History grammar: public source begin/write/commit after a modeled leadership
  change.
- Production/checkpoint: persistedCollectionOptions' wrapped source commit;
  record collection-visible rows, adapter calls, and the owner active at the
  exact applyCommittedTx call.

Reach, challenge, replay, cleanup, and limits:
- Green calibration tests prove structuredClone rejects a function payload,
  the leader upstream fixture can really enter/complete, and the ownership
  checker rejects an unowned apply. Every production-path test records a
  reached checkpoint before comparing the independent ledger.
- The default is one fixed fast-check campaign. Replay with
  TANSTACK_DB_COORDINATOR_ORACLE_{SEED,PATH,RUNS}; the thrown report retains the
  first failing trace and final shrunk candidate.
- Coordinators, Collections, and databases use failure-preserving cleanup. A
  final lifecycle test proves no channel, held lock, queued lock, or delayed
  delivery remains and that a fresh database name elects normally.
- The BroadcastChannel and Web Locks seams below perform real structuredClone
  and real coordinator code but are deterministic Node controls. They do not
  earn real-browser, multi-context, OPFS exclusive-handle, worker, Electric,
  PowerSync, or service credit. The focused Browser coordinator owner proves
  bounded replay after retryable follower transport or remote-owner admission
  failure, plus cancellation on release and disposal.
*/

type MessageHandler = (event: { data: unknown }) => void

type DelayedDelivery = {
  channel: string
  source: ControlledBroadcastChannel
  target: ControlledBroadcastChannel
  data: unknown
}

type CloneAttempt = {
  data: unknown
  errorName?: string
}

class ControlledBroadcastChannel {
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

type LockCallback = (lock: { name: string }) => Promise<unknown>
type LockQueueEntry = {
  callback: LockCallback
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

const heldLocks = new Set<string>()
const queuedLocks = new Map<string, Array<LockQueueEntry>>()

function grantNextLock(name: string): void {
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

const controlledLocks = {
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

let originalBroadcastChannelDescriptor: PropertyDescriptor | undefined
let originalNavigatorDescriptor: PropertyDescriptor | undefined

function installControlledBrowserSeams(): void {
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

function restoreControlledBrowserSeams(): void {
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

function payloadType(data: unknown): string | undefined {
  if (!data || typeof data !== `object` || !(`payload` in data))
    return undefined
  const payload = (data as { payload?: unknown }).payload
  if (!payload || typeof payload !== `object` || !(`type` in payload)) {
    return undefined
  }
  return String((payload as { type?: unknown }).type)
}

function envelopeCollection(data: unknown): string | undefined {
  if (!data || typeof data !== `object` || !(`collectionId` in data)) {
    return undefined
  }
  return String((data as { collectionId?: unknown }).collectionId)
}

async function pumpNetwork(): Promise<void> {
  for (let pass = 0; pass < 100; pass++) {
    while (ControlledBroadcastChannel.deliverAt(0)) {
      await Promise.resolve()
    }
    await nextTurn()
    if (ControlledBroadcastChannel.delayed.length === 0) return
  }
  throw new Error(`controlled network failed to become idle`)
}

async function waitFor(
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

async function waitForWithoutDelivery(
  predicate: () => boolean,
  checkpoint: string,
): Promise<void> {
  for (let pass = 0; pass < 100; pass++) {
    if (predicate()) return
    await nextTurn()
  }
  throw new Error(`did not reach ${checkpoint}`)
}

type CleanupDiagnostic = {
  resource: string
  error: string
}

const NO_PRIMARY_FAILURE = Symbol(`no-primary-failure`)

async function captureCleanup(
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

async function withFailurePreservingCleanup(
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

type AdapterCall = {
  operation: `load` | `apply` | `index` | `position` | `remote-subset` | `pull`
  adapterId: string
  collectionId: string
  ownerAtCall?: string
  argument?: SemanticValue
}

type PullFixtureResult = {
  latestRowVersion: number
  requiresFullReload: false
  changedKeys: Array<string | number>
  deletedKeys: Array<string | number>
}

type RecordedSubsetOptions = LoadSubsetOptions | TransportedLoadSubsetOptions

type RecordingAdapter = PersistenceAdapter & {
  id: string
  schemaVersion: number
  policy: `sync-present-reset` | `sync-absent-error`
  calls: Array<AdapterCall>
  getStreamPosition: (collectionId: string) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
  ensureRemoteSubset: (
    collectionId: string,
    options: RecordedSubsetOptions,
  ) => Promise<void>
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<PullFixtureResult>
}

function createRecordingAdapter(options: {
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
    loadSubset: (collectionId) => {
      record(`load`, collectionId)
      return Promise.resolve([])
    },
    applyCommittedTx: (collectionId) => {
      record(`apply`, collectionId)
      return Promise.resolve()
    },
    ensureIndex: (collectionId, signature, spec) => {
      record(`index`, collectionId, semanticValue({ signature, spec }))
      return Promise.resolve()
    },
    getStreamPosition: (collectionId) => {
      record(`position`, collectionId)
      return Promise.resolve({
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
      })
    },
    ensureRemoteSubset: (collectionId, subsetOptions) => {
      record(`remote-subset`, collectionId, subsetSemantics(subsetOptions))
      if (!options.remoteSubsetOwner) {
        throw new Error(`no remote subset owner for ${collectionId}`)
      }
      return options.remoteSubsetOwner(collectionId, subsetOptions)
    },
    pullSince: (collectionId, fromRowVersion) => {
      record(`pull`, collectionId, semanticValue({ fromRowVersion }))
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

type SemanticValue =
  | null
  | boolean
  | number
  | string
  | Array<SemanticValue>
  | { [key: string]: SemanticValue }

function semanticValue(value: unknown): SemanticValue {
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

function subsetSemantics(
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

function complexSubsetDemand(includeSubscription: boolean): LoadSubsetOptions {
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

const liveCoordinators = new Set<BrowserCollectionCoordinator>()

function createCoordinator(
  dbName: string,
  adapter: PersistenceAdapter,
): BrowserCollectionCoordinator {
  const coordinator = new BrowserCollectionCoordinator({ dbName, adapter })
  liveCoordinators.add(coordinator)
  return coordinator
}

function registerCollectionAdapter(
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

async function disposeCoordinator(
  coordinator?: BrowserCollectionCoordinator,
): Promise<void> {
  if (!coordinator || !liveCoordinators.has(coordinator)) return
  coordinator.dispose()
  liveCoordinators.delete(coordinator)
  await nextTurn()
}

function coordinatorFixtureSnapshot() {
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

beforeEach(() => {
  installControlledBrowserSeams()
})

afterEach(async () => {
  const cleanupDiagnostics: Array<CleanupDiagnostic> = []
  for (const coordinator of liveCoordinators) {
    await captureCleanup(cleanupDiagnostics, `afterEach live coordinator`, () =>
      coordinator.dispose(),
    )
  }
  liveCoordinators.clear()
  await captureCleanup(
    cleanupDiagnostics,
    `afterEach lock release`,
    async () => {
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `afterEach lock release`,
      )
    },
  )
  const cleanupSnapshot = coordinatorFixtureSnapshot()
  expect.soft(cleanupSnapshot).toEqual({
    delayed: 0,
    endpoints: 0,
    heldLocks: 0,
    queuedLocks: 0,
  })
  await captureCleanup(
    cleanupDiagnostics,
    `global browser descriptors`,
    restoreControlledBrowserSeams,
  )
  await captureCleanup(cleanupDiagnostics, `vitest timers and mocks`, () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  ControlledBroadcastChannel.reset()
  heldLocks.clear()
  queuedLocks.clear()
  expect.soft(cleanupDiagnostics).toEqual([])
})

type SubsetAckTrace = {
  ownerInvocation: `coordinator` | `fixture-fallback`
  decoded: SemanticValue | undefined
  expected: SemanticValue
  prematureResponses: number
  acknowledgedBeforeResponseDelivery: boolean
  ownerCompletedBeforeResponse: boolean
  acknowledgedAfterResponseDelivery: boolean
}

type SubsetWireTrace = {
  outcome: { ok: true } | { ok: false; errorName: string } | undefined
  decoded: ReadonlyArray<SemanticValue>
  expected: SemanticValue
}

// Clone-safe projection may remove live ownership callbacks. It must preserve
// every supported request-data value that determines subset semantics.
function subsetWireViolations(trace: SubsetWireTrace): Array<string> {
  const violations: Array<string> = []
  if (trace.outcome?.ok !== true) violations.push(`subset-transport-failed`)
  if (
    trace.decoded.length !== 1 ||
    JSON.stringify(trace.decoded[0]) !== JSON.stringify(trace.expected)
  ) {
    violations.push(`subset-semantics-mismatch`)
  }
  return violations
}

// A follower acknowledgement is valid only after the registered leader owner
// has accepted and completed the exact remote subset acquisition attempt.
function subsetAckViolations(trace: SubsetAckTrace): Array<string> {
  const violations: Array<string> = []
  if (trace.ownerInvocation !== `coordinator`) {
    violations.push(`leader-owner-not-invoked-by-coordinator`)
  }
  if (JSON.stringify(trace.decoded) !== JSON.stringify(trace.expected)) {
    violations.push(`decoded-subset-mismatch`)
  }
  if (trace.prematureResponses !== 0) {
    violations.push(`response-before-owner-completion`)
  }
  if (trace.acknowledgedBeforeResponseDelivery) {
    violations.push(`ack-before-response-delivery`)
  }
  if (!trace.ownerCompletedBeforeResponse) {
    violations.push(`response-before-owner-completion-checkpoint`)
  }
  if (!trace.acknowledgedAfterResponseDelivery) {
    violations.push(`missing-ack-after-response`)
  }
  return violations
}

async function observeOwnerEntryOrResponse(
  ownerEntered: () => boolean,
): Promise<`owner-entered` | `response-queued` | `no-progress`> {
  for (let turn = 0; turn < 20; turn++) {
    if (ownerEntered()) return `owner-entered`
    if (
      ControlledBroadcastChannel.delayed.some(
        ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:res`,
      )
    ) {
      return `response-queued`
    }
    await nextTurn()
  }
  return `no-progress`
}

describe(`per-collection coordinator wire and acknowledgement oracle`, () => {
  it(`posts the callback-bearing subset witness as clone-safe wire data`, async () => {
    const decoded: Array<SemanticValue> = []
    const leaderAdapter = createRecordingAdapter({
      id: `leader`,
      remoteSubsetOwner: (_collectionId, options) => {
        decoded.push(subsetSemantics(options))
        return Promise.resolve()
      },
    })
    const followerAdapter = createRecordingAdapter({ id: `follower` })
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      leader = createCoordinator(`clone-witness`, leaderAdapter)
      follower = createCoordinator(`clone-witness`, followerAdapter)
      registerCollectionAdapter(leader, `alpha`, leaderAdapter)
      registerCollectionAdapter(follower, `alpha`, followerAdapter)
      leader.subscribe(`alpha`, () => {})
      follower.subscribe(`alpha`, () => {})
      await waitFor(
        () => leader!.isLeader(`alpha`) && !follower!.isLeader(`alpha`),
        `clone-witness leader/follower topology`,
      )
      const safeTransportBeforeRequest =
        ControlledBroadcastChannel.cloneAttempts.filter(
          (attempt) => attempt.errorName === undefined,
        ).length
      expect(safeTransportBeforeRequest).toBeGreaterThan(0)

      const options = complexSubsetDemand(true)
      vi.useFakeTimers()
      let outcome: { ok: true } | { ok: false; errorName: string } | undefined
      void follower.requestEnsureRemoteSubset(`alpha`, options).then(
        () => {
          outcome = { ok: true }
        },
        (error: unknown) => {
          outcome = {
            ok: false,
            errorName: error instanceof Error ? error.name : String(error),
          }
        },
      )
      for (let step = 0; step < 12 && outcome === undefined; step++) {
        while (ControlledBroadcastChannel.deliverAt(0)) {
          await Promise.resolve()
        }
        await vi.advanceTimersByTimeAsync(100)
      }

      expect(outcome).toBeDefined()
      // Preserve the current-main DataCloneError as an observation without
      // making the defect a positive reach requirement for the GREEN suite.
      const observedCloneFault = ControlledBroadcastChannel.cloneAttempts.find(
        (attempt) => attempt.errorName !== undefined,
      )
      if (outcome?.ok === false) {
        expect(outcome.errorName).toBe(observedCloneFault?.errorName)
      }
      // D3 refinement: after clone-safe projection, the registered leader owner must
      // receive the exact supported semantics and the follower call succeeds.
      expect(
        subsetWireViolations({
          outcome,
          decoded,
          expected: subsetSemantics(options),
        }),
      ).toEqual([])
    }, [
      [
        `clone witness leader`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `clone witness follower`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
      [
        `clone witness timers`,
        async () => {
          vi.clearAllTimers()
          vi.useRealTimers()
          await nextTurn()
        },
      ],
    ])
  })

  it(`calibrates the clone checker against safe and function-valued payloads`, () => {
    const safe = {
      collectionId: `alpha`,
      where: { type: `eq`, field: `group`, value: `kept` },
      limit: 2,
    }
    const unsafe = { ...safe, callback: () => {} }

    expect(structuredClone(safe)).toEqual(safe)
    expect(() => structuredClone(unsafe)).toThrowError(
      expect.objectContaining({ name: `DataCloneError` }),
    )

    const expected = subsetSemantics(complexSubsetDemand(false))
    const allowed: SubsetWireTrace = {
      outcome: { ok: true },
      decoded: [expected],
      expected,
    }
    expect(subsetWireViolations(allowed)).toEqual([])
    expect(
      subsetWireViolations({
        ...allowed,
        outcome: { ok: false, errorName: `DataCloneError` },
      }),
    ).toContain(`subset-transport-failed`)
    expect(
      subsetWireViolations({ ...allowed, decoded: [semanticValue({})] }),
    ).toContain(`subset-semantics-mismatch`)
  })

  it(`round-trips supported subset semantics across the emitted message partition`, async () => {
    const leaderAdapter = createRecordingAdapter({
      id: `partition-leader`,
      remoteSubsetOwner: () => Promise.resolve(),
    })
    const followerAdapter = createRecordingAdapter({ id: `partition-follower` })
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      leader = createCoordinator(`wire-partition`, leaderAdapter)
      follower = createCoordinator(`wire-partition`, followerAdapter)
      registerCollectionAdapter(leader, `alpha`, leaderAdapter)
      registerCollectionAdapter(follower, `alpha`, followerAdapter)
      leader.subscribe(`alpha`, () => {})
      follower.subscribe(`alpha`, () => {})
      await waitFor(
        () => leader!.isLeader(`alpha`) && !follower!.isLeader(`alpha`),
        `wire partition leader/follower topology`,
      )

      const demand = complexSubsetDemand(false)
      const subsetRequest = follower.requestEnsureRemoteSubset(`alpha`, demand)
      const queuedSubset = ControlledBroadcastChannel.delayed.find(
        ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:req`,
      )?.data as { payload?: { options?: LoadSubsetOptions } } | undefined
      expect(subsetSemantics(queuedSubset?.payload?.options ?? {})).toEqual(
        subsetSemantics(demand),
      )
      await pumpNetwork()
      await subsetRequest

      const mutationValue = {
        id: `native-values`,
        at: new Date(`2026-09-16T12:34:56.000Z`),
        bytes: new Uint8Array([0, 127, 255]),
      }
      const mutationRequest = follower.requestApplyLocalMutations(`alpha`, [
        {
          mutationId: `native-values`,
          type: `insert`,
          key: `native-values`,
          value: mutationValue,
        },
      ])
      const queuedMutation = ControlledBroadcastChannel.delayed.find(
        ({ data }) => payloadType(data) === `rpc:applyLocalMutations:req`,
      )?.data as
        | {
            payload?: {
              mutations?: Array<{ value?: unknown }>
            }
          }
        | undefined
      expect(
        semanticValue(queuedMutation?.payload?.mutations?.[0]?.value),
      ).toEqual(semanticValue(mutationValue))
      await pumpNetwork()
      await mutationRequest

      const committedTx: PersistedTx = {
        txId: `committed-native-values`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [
          {
            type: `update`,
            key: `native-values`,
            value: mutationValue,
          },
        ],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `native-values`,
            value: { source: `wire-partition` },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: { offset: 4 } },
        ],
      }
      const committedRequest = follower.requestApplyCommittedTx(
        `alpha`,
        committedTx,
      )
      const queuedCommitted = ControlledBroadcastChannel.delayed.find(
        ({ data }) => payloadType(data) === `rpc:applyCommittedTx:req`,
      )?.data as { payload?: { tx?: PersistedTx } } | undefined
      expect(semanticValue(queuedCommitted?.payload?.tx)).toEqual(
        semanticValue(committedTx),
      )
      await pumpNetwork()
      const committedResponse = await committedRequest
      expect(committedResponse).toEqual({
        type: `rpc:applyCommittedTx:res`,
        rpcId: expect.any(String),
        ok: true,
        term: 1,
        seq: 2,
        latestRowVersion: 2,
      })

      const successfulPayloads = ControlledBroadcastChannel.cloneAttempts
        .filter(({ errorName }) => errorName === undefined)
        .map(({ data }) =>
          data && typeof data === `object` && `payload` in data
            ? (data as { payload?: unknown }).payload
            : undefined,
        )
      const matchingCommittedResponses = successfulPayloads.filter(
        (payload) =>
          payload !== undefined &&
          payload !== null &&
          typeof payload === `object` &&
          `type` in payload &&
          payload.type === `rpc:applyCommittedTx:res` &&
          `rpcId` in payload &&
          payload.rpcId === committedResponse.rpcId,
      )
      const matchingCommittedEvents = successfulPayloads.filter(
        (payload) =>
          payload !== undefined &&
          payload !== null &&
          typeof payload === `object` &&
          `type` in payload &&
          payload.type === `tx:committed` &&
          `txId` in payload &&
          payload.txId === committedTx.txId,
      )
      expect(matchingCommittedResponses).toEqual([committedResponse])
      expect(matchingCommittedEvents).toEqual([
        {
          type: `tx:committed`,
          term: 1,
          seq: 2,
          txId: `committed-native-values`,
          latestRowVersion: 2,
          requiresFullReload: false,
          changedRows: [{ key: `native-values`, value: mutationValue }],
          deletedKeys: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `native-values`,
              value: { source: `wire-partition` },
            },
          ],
          collectionMetadataMutations: [
            { type: `set`, key: `resume`, value: { offset: 4 } },
          ],
        },
      ])

      const indexRequest = follower.requestEnsurePersistedIndex(
        `alpha`,
        `score-index`,
        { expressionSql: [`score`] },
      )
      await pumpNetwork()
      await indexRequest
      const pullRequest = follower.pullSince(`alpha`, 0)
      await pumpNetwork()
      await pullRequest

      const successfulTypes = new Set(
        ControlledBroadcastChannel.cloneAttempts
          .filter(({ errorName }) => errorName === undefined)
          .map(({ data }) => payloadType(data))
          .filter((type): type is string => type !== undefined),
      )
      expect(successfulTypes).toEqual(
        new Set([
          `leader:heartbeat`,
          `rpc:ensureRemoteSubset:req`,
          `rpc:ensureRemoteSubset:res`,
          `rpc:applyLocalMutations:req`,
          `rpc:applyLocalMutations:res`,
          `rpc:applyCommittedTx:req`,
          `rpc:applyCommittedTx:res`,
          `tx:committed`,
          `rpc:ensurePersistedIndex:req`,
          `rpc:ensurePersistedIndex:res`,
          `rpc:pullSince:req`,
          `rpc:pullSince:res`,
        ]),
      )
    }, [
      [
        `wire partition leader`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `wire partition follower`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
    ])
  })

  it(`calibrates acknowledgement checks against entry-only and false-success faults`, () => {
    const expected = subsetSemantics(complexSubsetDemand(false))
    const allowed: SubsetAckTrace = {
      ownerInvocation: `coordinator`,
      decoded: expected,
      expected,
      prematureResponses: 0,
      acknowledgedBeforeResponseDelivery: false,
      ownerCompletedBeforeResponse: true,
      acknowledgedAfterResponseDelivery: true,
    }
    expect(subsetAckViolations(allowed)).toEqual([])
    expect(
      subsetAckViolations({
        ...allowed,
        ownerCompletedBeforeResponse: false,
      }),
    ).toContain(`response-before-owner-completion-checkpoint`)
    expect(
      subsetAckViolations({
        ...allowed,
        ownerInvocation: `fixture-fallback`,
        prematureResponses: 1,
      }),
    ).toEqual([
      `leader-owner-not-invoked-by-coordinator`,
      `response-before-owner-completion`,
    ])
  })

  it(`acknowledges a follower subset only after the leader source completed it`, async () => {
    const upstreamEvents: Array<{
      phase: `entered` | `completed`
      semantics: SemanticValue
    }> = []
    const releases: Array<() => void> = []
    const ownerDelegate: {
      invoke?: (
        collectionId: string,
        options: RecordedSubsetOptions,
      ) => Promise<void>
    } = {}
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined
    let cleanupLeaderCollection: (() => Promise<void>) | undefined

    await withFailurePreservingCleanup(async () => {
      const leaderAdapter = createRecordingAdapter({
        id: `leader-alpha`,
        remoteSubsetOwner: (collectionId, options) => {
          if (!ownerDelegate.invoke) {
            throw new Error(`leader owner not attached`)
          }
          return ownerDelegate.invoke(collectionId, options)
        },
      })
      const followerAdapter = createRecordingAdapter({
        id: `follower-alpha`,
      })
      leader = createCoordinator(`subset-ack`, leaderAdapter)
      follower = createCoordinator(`subset-ack`, followerAdapter)
      registerCollectionAdapter(leader, `alpha`, leaderAdapter, false)
      registerCollectionAdapter(follower, `alpha`, followerAdapter, false)
      const source: SyncConfig<{ id: string; group: string }, string> = {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              upstreamEvents.push({
                phase: `entered`,
                semantics: subsetSemantics(options),
              })
              return new Promise<void>((resolve) => {
                let released = false
                releases.push(() => {
                  if (released) return
                  released = true
                  upstreamEvents.push({
                    phase: `completed`,
                    semantics: subsetSemantics(options),
                  })
                  resolve()
                })
              })
            },
          }
        },
      }
      const leaderCollection = createCollection(
        persistedCollectionOptions({
          id: `alpha`,
          getKey: (row: { id: string; group: string }) => row.id,
          syncMode: `on-demand`,
          sync: source,
          persistence: { adapter: leaderAdapter, coordinator: leader },
        }),
      )
      cleanupLeaderCollection = () => leaderCollection.cleanup()
      ownerDelegate.invoke = async (collectionId, options) => {
        if (collectionId !== `alpha`) {
          throw new Error(`wrong leader subset collection ${collectionId}`)
        }
        await Promise.resolve(
          leaderCollection._sync.loadSubset(
            options as unknown as LoadSubsetOptions,
          ),
        )
      }

      leaderCollection.startSyncImmediate()
      follower.subscribe(`alpha`, () => {})
      await waitFor(
        () => leader!.isLeader(`alpha`) && !follower!.isLeader(`alpha`),
        `subset-ack leader/follower topology`,
      )

      const demand = complexSubsetDemand(false)
      const expectedSemantics = subsetSemantics(demand)
      let acknowledged = false
      const acknowledgement = follower
        .requestEnsureRemoteSubset(`alpha`, demand)
        .then(() => {
          acknowledged = true
        })

      expect(
        ControlledBroadcastChannel.deliverWhere(
          (data) =>
            payloadType(data) === `rpc:ensureRemoteSubset:req` &&
            envelopeCollection(data) === `alpha`,
        ),
      ).toBe(true)
      const firstProgress = await observeOwnerEntryOrResponse(() =>
        upstreamEvents.some(({ phase }) => phase === `entered`),
      )
      expect(firstProgress).not.toBe(`no-progress`)
      const prematureResponses = ControlledBroadcastChannel.delayed.filter(
        ({ data }) =>
          payloadType(data) === `rpc:ensureRemoteSubset:res` &&
          envelopeCollection(data) === `alpha`,
      )
      let ownerInvocation: SubsetAckTrace[`ownerInvocation`] = `coordinator`
      let ownerWork: Promise<void> | undefined
      if (!upstreamEvents.some(({ phase }) => phase === `entered`)) {
        ownerInvocation = `fixture-fallback`
        for (const response of prematureResponses) {
          const index = ControlledBroadcastChannel.delayed.indexOf(response)
          if (index >= 0) ControlledBroadcastChannel.delayed.splice(index, 1)
        }
        ownerWork = leaderAdapter.ensureRemoteSubset(`alpha`, demand)
        await waitForWithoutDelivery(
          () => upstreamEvents.some(({ phase }) => phase === `entered`),
          `fallback leader owner entry`,
        )
      }
      const entered = upstreamEvents.find(({ phase }) => phase === `entered`)
      expect(
        ControlledBroadcastChannel.delayed.some(
          ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:res`,
        ),
      ).toBe(false)
      expect(acknowledged).toBe(false)
      releases.at(-1)?.()
      await ownerWork
      await waitForWithoutDelivery(
        () => upstreamEvents.some(({ phase }) => phase === `completed`),
        `leader subset completion`,
      )
      if (ownerInvocation === `fixture-fallback`) {
        ControlledBroadcastChannel.delayed.push(...prematureResponses)
      } else {
        await waitForWithoutDelivery(
          () =>
            ControlledBroadcastChannel.delayed.some(
              ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:res`,
            ),
          `response after leader subset completion`,
        )
      }
      const acknowledgedBeforeResponseDelivery = acknowledged
      expect(acknowledged).toBe(false)
      expect(
        ControlledBroadcastChannel.deliverWhere(
          (data) =>
            payloadType(data) === `rpc:ensureRemoteSubset:res` &&
            envelopeCollection(data) === `alpha`,
        ),
      ).toBe(true)
      await acknowledgement
      const trace: SubsetAckTrace = {
        ownerInvocation,
        decoded: entered?.semantics,
        expected: expectedSemantics,
        prematureResponses: prematureResponses.length,
        acknowledgedBeforeResponseDelivery,
        ownerCompletedBeforeResponse: upstreamEvents.some(
          ({ phase }) => phase === `completed`,
        ),
        acknowledgedAfterResponseDelivery: acknowledged,
      }
      // D13 refinement: one comparator owns both the production verdict and hostile
      // entry-only/false-success calibrations above.
      expect(subsetAckViolations(trace)).toEqual([])
    }, [
      [
        `pending subset source releases`,
        () => {
          for (const release of releases) release()
        },
      ],
      [
        `leader collection`,
        async () => {
          await cleanupLeaderCollection?.()
        },
      ],
      [
        `leader coordinator`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `follower coordinator`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
    ])
  })
})

type RemoteLeaseEvent = {
  phase: `load` | `unload`
  token: number
  semantics: SemanticValue
  exactLoadedObject?: boolean
}

class RemoteLeaseOwnerLedger {
  private nextToken = 0
  private readonly tokens = new WeakMap<object, number>()
  private readonly loaded = new WeakSet<object>()
  readonly active = new Set<object>()
  readonly events: Array<RemoteLeaseEvent> = []

  private token(options: TransportedLoadSubsetOptions): number {
    let token = this.tokens.get(options)
    if (token === undefined) {
      token = ++this.nextToken
      this.tokens.set(options, token)
    }
    return token
  }

  readonly loadSubset = async (
    options: TransportedLoadSubsetOptions,
  ): Promise<void> => {
    const token = this.token(options)
    this.loaded.add(options)
    this.active.add(options)
    this.events.push({
      phase: `load`,
      token,
      semantics: subsetSemantics(options as unknown as LoadSubsetOptions),
    })
  }

  readonly unloadSubset = (options: TransportedLoadSubsetOptions): void => {
    const token = this.token(options)
    const exactLoadedObject = this.loaded.has(options)
    this.active.delete(options)
    this.events.push({
      phase: `unload`,
      token,
      semantics: subsetSemantics(options as unknown as LoadSubsetOptions),
      exactLoadedObject,
    })
  }

  /** Callable for today's owner boundary; properties are the crash-only owner. */
  readonly boundary = Object.assign(
    (options: TransportedLoadSubsetOptions) => this.loadSubset(options),
    {
      loadSubset: this.loadSubset,
      unloadSubset: this.unloadSubset,
      onError: () => {},
    },
  )

  snapshot() {
    return {
      loads: this.events.filter(({ phase }) => phase === `load`).length,
      unloads: this.events.filter(({ phase }) => phase === `unload`).length,
      active: this.active.size,
      exactUnloads: this.events
        .filter(
          (event): event is RemoteLeaseEvent & { phase: `unload` } =>
            event.phase === `unload`,
        )
        .every(({ exactLoadedObject }) => exactLoadedObject === true),
    }
  }
}

type RemoteLeaseTakeoverTrace = {
  initialOwnerAfterAcquire: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  retiredOwnerAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  newOwnerAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  newOwnerAfterRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
}

type RemoteLeaseTakeoverViolation = {
  checkpoint: string
  field: keyof ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  expected: number | boolean
  actual: number | boolean
}

const expectedRemoteLeaseTakeoverTrace: RemoteLeaseTakeoverTrace = {
  initialOwnerAfterAcquire: {
    loads: 1,
    unloads: 0,
    active: 1,
    exactUnloads: true,
  },
  retiredOwnerAfterTakeover: {
    loads: 1,
    unloads: 1,
    active: 0,
    exactUnloads: true,
  },
  newOwnerAfterTakeover: {
    loads: 1,
    unloads: 0,
    active: 1,
    exactUnloads: true,
  },
  newOwnerAfterRelease: {
    loads: 1,
    unloads: 1,
    active: 0,
    exactUnloads: true,
  },
}

function remoteLeaseTakeoverViolations(
  actual: RemoteLeaseTakeoverTrace,
): Array<RemoteLeaseTakeoverViolation> {
  const violations: Array<RemoteLeaseTakeoverViolation> = []
  for (const checkpoint of Object.keys(
    expectedRemoteLeaseTakeoverTrace,
  ) as Array<keyof RemoteLeaseTakeoverTrace>) {
    const expected = expectedRemoteLeaseTakeoverTrace[checkpoint]
    for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
      if (actual[checkpoint][field] !== expected[field]) {
        violations.push({
          checkpoint,
          field,
          expected: expected[field],
          actual: actual[checkpoint][field],
        })
      }
    }
  }
  return violations
}

type CollectionScopedLeaseSnapshot = Record<
  `alpha` | `beta`,
  { loads: number; unloads: number; active: number }
>

function collectionScopedLeaseViolations(
  actual: CollectionScopedLeaseSnapshot,
  expected: CollectionScopedLeaseSnapshot,
): Array<string> {
  const violations: Array<string> = []
  for (const collectionId of [`alpha`, `beta`] as const) {
    for (const field of [`loads`, `unloads`, `active`] as const) {
      if (actual[collectionId][field] !== expected[collectionId][field]) {
        violations.push(`${collectionId}:${field}`)
      }
    }
  }
  return violations
}

type RemoteLeaseHistory = {
  siblingCount: number
  releasePrefix: number
  identical: boolean
  duplicateRelease: boolean
  reverseFinalRelease: boolean
}

type RemoteLeaseHistoryTrace = {
  firstAfterAcquire: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  firstAfterPrefixRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  firstAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  secondAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  secondAfterFinalRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
}

const remoteLeaseHistoryArbitrary = fc.record({
  siblingCount: fc.integer({ min: 1, max: 3 }),
  releasePrefix: fc.integer({ min: 0, max: 2 }),
  identical: fc.boolean(),
  duplicateRelease: fc.boolean(),
  reverseFinalRelease: fc.boolean(),
})

// Every accepted physical acquisition remains active until its exact
// acquisition lease is released. Leadership transfer releases retired-owner
// acquisitions and establishes replacements only for surviving demand.
function remoteLeaseHistoryViolations(
  history: RemoteLeaseHistory,
  actual: RemoteLeaseHistoryTrace,
): Array<RemoteLeaseTakeoverViolation> {
  const releaseCount = Math.min(history.releasePrefix, history.siblingCount - 1)
  const remaining = history.siblingCount - releaseCount
  const expected: RemoteLeaseHistoryTrace = {
    firstAfterAcquire: {
      loads: history.siblingCount,
      unloads: 0,
      active: history.siblingCount,
      exactUnloads: true,
    },
    firstAfterPrefixRelease: {
      loads: history.siblingCount,
      unloads: releaseCount,
      active: remaining,
      exactUnloads: true,
    },
    firstAfterTakeover: {
      loads: history.siblingCount,
      unloads: history.siblingCount,
      active: 0,
      exactUnloads: true,
    },
    secondAfterTakeover: {
      loads: remaining,
      unloads: 0,
      active: remaining,
      exactUnloads: true,
    },
    secondAfterFinalRelease: {
      loads: remaining,
      unloads: remaining,
      active: 0,
      exactUnloads: true,
    },
  }
  const violations: Array<RemoteLeaseTakeoverViolation> = []
  for (const checkpoint of Object.keys(expected) as Array<
    keyof RemoteLeaseHistoryTrace
  >) {
    for (const field of Object.keys(expected[checkpoint]) as Array<
      keyof ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
    >) {
      if (actual[checkpoint][field] !== expected[checkpoint][field]) {
        violations.push({
          checkpoint,
          field,
          expected: expected[checkpoint][field],
          actual: actual[checkpoint][field],
        })
      }
    }
  }
  return violations
}

describe(`remote subset ownership lease oracle`, () => {
  it(`calibrates collection-scoped acquisition identity against a global-id mutant`, () => {
    const expected: CollectionScopedLeaseSnapshot = {
      alpha: { loads: 1, unloads: 0, active: 1 },
      beta: { loads: 1, unloads: 0, active: 1 },
    }
    expect(collectionScopedLeaseViolations(expected, expected)).toEqual([])
    expect(
      collectionScopedLeaseViolations(
        {
          alpha: { loads: 2, unloads: 0, active: 2 },
          beta: { loads: 1, unloads: 0, active: 1 },
        },
        expected,
      ),
    ).toEqual([`alpha:loads`, `alpha:active`])
  })

  it(`keeps reused option identities independent per collection across bounded histories`, async () => {
    type Action = {
      kind: `ensure` | `release`
      collectionId: `alpha` | `beta`
      objectId: 0 | 1
    }
    const histories: ReadonlyArray<{
      name: string
      actions: ReadonlyArray<Action>
    }> = [
      {
        name: `shared object A-B-A`,
        actions: [
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `ensure`, collectionId: `beta`, objectId: 0 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 0 },
        ],
      },
      {
        name: `released object reacquired beside sibling collection`,
        actions: [
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `ensure`, collectionId: `beta`, objectId: 0 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 0 },
        ],
      },
      {
        name: `two identities with duplicate releases`,
        actions: [
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 1 },
          { kind: `ensure`, collectionId: `beta`, objectId: 0 },
          { kind: `ensure`, collectionId: `beta`, objectId: 1 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 1 },
          { kind: `release`, collectionId: `beta`, objectId: 1 },
          { kind: `release`, collectionId: `alpha`, objectId: 1 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 0 },
        ],
      },
    ]

    for (const [historyIndex, history] of histories.entries()) {
      const owners = {
        alpha: new RemoteLeaseOwnerLedger(),
        beta: new RemoteLeaseOwnerLedger(),
      }
      const live = {
        alpha: new Set<number>(),
        beta: new Set<number>(),
      }
      const expected: CollectionScopedLeaseSnapshot = {
        alpha: { loads: 0, unloads: 0, active: 0 },
        beta: { loads: 0, unloads: 0, active: 0 },
      }
      const coordinator = createCoordinator(
        `collection-scoped-lease-${historyIndex}`,
        createRecordingAdapter({ id: `collection-scoped-${historyIndex}` }),
      )
      const unregisterAlpha = coordinator.registerRemoteSubsetOwner(
        `alpha`,
        owners.alpha.boundary,
      )
      const unregisterBeta = coordinator.registerRemoteSubsetOwner(
        `beta`,
        owners.beta.boundary,
      )
      coordinator.subscribe(`alpha`, () => {})
      coordinator.subscribe(`beta`, () => {})
      const objects: [LoadSubsetOptions, LoadSubsetOptions] = [
        { limit: 1, offset: 0 },
        { limit: 2, offset: 1 },
      ]

      await withFailurePreservingCleanup(async () => {
        await waitFor(
          () => coordinator.isLeader(`alpha`) && coordinator.isLeader(`beta`),
          `${history.name} leadership`,
        )
        for (const [actionIndex, action] of history.actions.entries()) {
          const liveObjects = live[action.collectionId]
          const expectedCollection = expected[action.collectionId]
          if (action.kind === `ensure`) {
            await coordinator.requestEnsureRemoteSubset(
              action.collectionId,
              objects[action.objectId],
            )
            if (!liveObjects.has(action.objectId)) {
              liveObjects.add(action.objectId)
              expectedCollection.loads++
              expectedCollection.active++
            }
          } else {
            await coordinator.requestReleaseRemoteSubset(
              action.collectionId,
              objects[action.objectId],
            )
            if (liveObjects.delete(action.objectId)) {
              expectedCollection.unloads++
              expectedCollection.active--
            }
          }

          const alpha = owners.alpha.snapshot()
          const beta = owners.beta.snapshot()
          const actual: CollectionScopedLeaseSnapshot = {
            alpha: {
              loads: alpha.loads,
              unloads: alpha.unloads,
              active: alpha.active,
            },
            beta: {
              loads: beta.loads,
              unloads: beta.unloads,
              active: beta.active,
            },
          }
          expect(
            collectionScopedLeaseViolations(actual, expected),
            `${history.name} action ${actionIndex}: ${JSON.stringify(action)}; actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
          ).toEqual([])
        }
      }, [
        [`${history.name} alpha owner`, unregisterAlpha],
        [`${history.name} beta owner`, unregisterBeta],
        [
          `${history.name} coordinator`,
          async () => {
            await disposeCoordinator(coordinator)
          },
        ],
      ])
    }
  })

  it(`keeps one public acquisition live across leader takeover and releases both owners exactly`, async () => {
    type Todo = { id: string; title: string }
    const firstOwner = new RemoteLeaseOwnerLedger()
    const secondOwner = new RemoteLeaseOwnerLedger()
    const dbName = `remote-lease-takeover-fixed`
    const collectionId = `lease-todos`
    let firstLeader: BrowserCollectionCoordinator | undefined
    let secondLeader: BrowserCollectionCoordinator | undefined
    let requester: BrowserCollectionCoordinator | undefined
    let unregisterFirst: (() => void) | undefined
    let unregisterSecond: (() => void) | undefined
    let cleanupCollection: (() => Promise<void>) | undefined

    await withFailurePreservingCleanup(async () => {
      firstLeader = createCoordinator(
        dbName,
        createRecordingAdapter({ id: `lease-first` }),
      )
      secondLeader = createCoordinator(
        dbName,
        createRecordingAdapter({ id: `lease-second` }),
      )
      requester = createCoordinator(
        dbName,
        createRecordingAdapter({ id: `lease-requester` }),
      )
      unregisterFirst = firstLeader.registerRemoteSubsetOwner(
        collectionId,
        firstOwner.boundary,
      )
      unregisterSecond = secondLeader.registerRemoteSubsetOwner(
        collectionId,
        secondOwner.boundary,
      )
      firstLeader.subscribe(collectionId, () => {})
      secondLeader.subscribe(collectionId, () => {})
      await waitFor(
        () =>
          firstLeader!.isLeader(collectionId) &&
          !secondLeader!.isLeader(collectionId),
        `initial remote subset owner`,
      )

      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (todo) => todo.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: {
            adapter: createRecordingAdapter({ id: `lease-requester-runtime` }),
            coordinator: requester,
          },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.startSyncImmediate()

      const demand: LoadSubsetOptions = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([collectionId, `group`]),
          new IR.Value(`owned`),
        ]),
        limit: 2,
      }
      const acquisition = Promise.resolve(collection._sync.loadSubset(demand))
      await pumpNetwork()
      await acquisition
      const initialOwnerAfterAcquire = firstOwner.snapshot()

      await disposeCoordinator(firstLeader)
      await waitFor(
        () => secondLeader!.isLeader(collectionId),
        `remote subset takeover leader`,
      )
      // Deliver the new leader heartbeat and every acquisition replay it
      // causes. The public acquisition remains live throughout this cut.
      await pumpNetwork()
      await nextTurn()
      await pumpNetwork()
      const retiredOwnerAfterTakeover = firstOwner.snapshot()
      const newOwnerAfterTakeover = secondOwner.snapshot()

      collection._sync.unloadSubset(demand)
      await pumpNetwork()
      await nextTurn()
      await pumpNetwork()
      const newOwnerAfterRelease = secondOwner.snapshot()

      const trace: RemoteLeaseTakeoverTrace = {
        initialOwnerAfterAcquire,
        retiredOwnerAfterTakeover,
        newOwnerAfterTakeover,
        newOwnerAfterRelease,
      }
      expect(remoteLeaseTakeoverViolations(trace)).toEqual([])
    }, [
      [
        `remote lease requester collection`,
        async () => {
          await cleanupCollection?.()
        },
      ],
      [`first remote subset owner`, () => unregisterFirst?.()],
      [`second remote subset owner`, () => unregisterSecond?.()],
      [
        `first remote subset leader`,
        async () => {
          await disposeCoordinator(firstLeader)
        },
      ],
      [
        `second remote subset leader`,
        async () => {
          await disposeCoordinator(secondLeader)
        },
      ],
      [
        `remote subset requester`,
        async () => {
          await disposeCoordinator(requester)
        },
      ],
    ])
  })

  it(`calibrates the lease checker against leak, missing replay, and inexact release mutants`, () => {
    expect(
      remoteLeaseTakeoverViolations(expectedRemoteLeaseTakeoverTrace),
    ).toEqual([])
    const hostile: RemoteLeaseTakeoverTrace = structuredClone(
      expectedRemoteLeaseTakeoverTrace,
    )
    hostile.retiredOwnerAfterTakeover = {
      loads: 1,
      unloads: 0,
      active: 1,
      exactUnloads: true,
    }
    hostile.newOwnerAfterTakeover = {
      loads: 0,
      unloads: 0,
      active: 0,
      exactUnloads: true,
    }
    hostile.newOwnerAfterRelease.exactUnloads = false
    expect(
      remoteLeaseTakeoverViolations(hostile).map(
        ({ checkpoint, field }) => `${checkpoint}:${field}`,
      ),
    ).toEqual([
      `retiredOwnerAfterTakeover:unloads`,
      `retiredOwnerAfterTakeover:active`,
      `newOwnerAfterTakeover:loads`,
      `newOwnerAfterTakeover:active`,
      `newOwnerAfterRelease:exactUnloads`,
    ])
  })

  it(`preserves independent sibling leases through release, retry-safe takeover, and cleanup histories`, async () => {
    let originalHistory: RemoteLeaseHistory | undefined
    let originalViolation: RemoteLeaseTakeoverViolation | undefined
    let targetDiscriminant: string | undefined
    const cleanupDiagnostics: Array<
      CleanupDiagnostic & { history: RemoteLeaseHistory }
    > = []
    const executionDiagnostics: Array<
      CleanupDiagnostic & { history: RemoteLeaseHistory; checkpoint: string }
    > = []
    let propertyFailure: unknown | typeof NO_PRIMARY_FAILURE =
      NO_PRIMARY_FAILURE
    let run = 0

    try {
      await fc.assert(
        fc.asyncProperty(remoteLeaseHistoryArbitrary, async (history) => {
          const firstOwner = new RemoteLeaseOwnerLedger()
          const secondOwner = new RemoteLeaseOwnerLedger()
          const suffix = `${++run}-${history.siblingCount}-${history.releasePrefix}`
          const dbName = `remote-lease-history-${suffix}`
          const collectionId = `lease-history-${suffix}`
          let firstLeader: BrowserCollectionCoordinator | undefined
          let secondLeader: BrowserCollectionCoordinator | undefined
          let requester: BrowserCollectionCoordinator | undefined
          let unregisterFirst: (() => void) | undefined
          let unregisterSecond: (() => void) | undefined
          let cleanupCollection: (() => Promise<void>) | undefined
          let semanticFailure: unknown | typeof NO_PRIMARY_FAILURE =
            NO_PRIMARY_FAILURE
          let checkpoint = `coordinator allocation`

          try {
            firstLeader = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-first` }),
            )
            secondLeader = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-second` }),
            )
            requester = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-requester` }),
            )
            unregisterFirst = firstLeader.registerRemoteSubsetOwner(
              collectionId,
              firstOwner.boundary,
            )
            unregisterSecond = secondLeader.registerRemoteSubsetOwner(
              collectionId,
              secondOwner.boundary,
            )
            firstLeader.subscribe(collectionId, () => {})
            secondLeader.subscribe(collectionId, () => {})
            checkpoint = `initial leadership`
            await waitFor(
              () =>
                firstLeader!.isLeader(collectionId) &&
                !secondLeader!.isLeader(collectionId),
              `generated remote subset owner`,
            )

            const collection = createCollection(
              persistedCollectionOptions<{ id: string }, string>({
                id: collectionId,
                getKey: (row) => row.id,
                syncMode: `on-demand`,
                sync: {
                  sync: ({ markReady }) => {
                    markReady()
                    return {}
                  },
                },
                persistence: {
                  adapter: createRecordingAdapter({ id: `history-runtime` }),
                  coordinator: requester,
                },
              }),
            )
            cleanupCollection = () => collection.cleanup()
            collection.startSyncImmediate()
            const demands = Array.from(
              { length: history.siblingCount },
              (_, index): LoadSubsetOptions => ({
                limit: 1,
                ...(history.identical ? {} : { offset: index }),
              }),
            )

            checkpoint = `initial acquisitions`
            for (const demand of demands) {
              const acquisition = Promise.resolve(
                collection._sync.loadSubset(demand),
              )
              await pumpNetwork()
              await acquisition
            }
            const firstAfterAcquire = firstOwner.snapshot()

            checkpoint = `prefix releases`
            const releaseCount = Math.min(
              history.releasePrefix,
              history.siblingCount - 1,
            )
            for (const demand of demands.slice(0, releaseCount)) {
              collection._sync.unloadSubset(demand)
              if (history.duplicateRelease) {
                collection._sync.unloadSubset(demand)
              }
            }
            await pumpNetwork()
            const firstAfterPrefixRelease = firstOwner.snapshot()

            checkpoint = `leadership takeover`
            await disposeCoordinator(firstLeader)
            await waitFor(
              () => secondLeader!.isLeader(collectionId),
              `generated remote subset takeover`,
            )
            await pumpNetwork()
            await nextTurn()
            await pumpNetwork()
            const firstAfterTakeover = firstOwner.snapshot()
            const secondAfterTakeover = secondOwner.snapshot()

            checkpoint = `final releases`
            const finalDemands = demands.slice(releaseCount)
            if (history.reverseFinalRelease) finalDemands.reverse()
            for (const demand of finalDemands) {
              collection._sync.unloadSubset(demand)
              if (history.duplicateRelease) {
                collection._sync.unloadSubset(demand)
              }
            }
            await pumpNetwork()
            await nextTurn()
            await pumpNetwork()
            const secondAfterFinalRelease = secondOwner.snapshot()

            checkpoint = `semantic comparison`
            const trace: RemoteLeaseHistoryTrace = {
              firstAfterAcquire,
              firstAfterPrefixRelease,
              firstAfterTakeover,
              secondAfterTakeover,
              secondAfterFinalRelease,
            }
            const [violation] = remoteLeaseHistoryViolations(history, trace)
            if (violation) {
              const discriminant = `${violation.checkpoint}:${violation.field}`
              if (targetDiscriminant === undefined) {
                targetDiscriminant = discriminant
                originalHistory = structuredClone(history)
                originalViolation = structuredClone(violation)
              }
              if (discriminant === targetDiscriminant) {
                semanticFailure = new Error(
                  `remote lease mismatch; discriminant=${discriminant}; originalViolation=${JSON.stringify(originalViolation)}; reducedViolation=${JSON.stringify(violation)}; original=${JSON.stringify(originalHistory)}; reduced=${JSON.stringify(history)}; trace=${JSON.stringify(trace)}`,
                )
              }
            }
          } catch (error) {
            executionDiagnostics.push({
              resource: `generated remote lease execution`,
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
              history: structuredClone(history),
              checkpoint,
            })
          }

          const historyCleanupDiagnostics: Array<CleanupDiagnostic> = []
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated remote lease collection`,
            async () => {
              await cleanupCollection?.()
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated first owner registration`,
            () => unregisterFirst?.(),
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated second owner registration`,
            () => unregisterSecond?.(),
          )
          for (const [resource, coordinator] of [
            [`generated first leader`, firstLeader],
            [`generated second leader`, secondLeader],
            [`generated requester`, requester],
          ] as const) {
            await captureCleanup(
              historyCleanupDiagnostics,
              resource,
              async () => {
                await disposeCoordinator(coordinator)
              },
            )
          }
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated remote lease transport and locks`,
            async () => {
              await waitForWithoutDelivery(
                () =>
                  heldLocks.size === 0 &&
                  queuedLocks.size === 0 &&
                  ControlledBroadcastChannel.delayed.length === 0,
                `generated remote lease cleanup`,
              )
            },
          )
          cleanupDiagnostics.push(
            ...historyCleanupDiagnostics.map((diagnostic) => ({
              ...diagnostic,
              history: structuredClone(history),
            })),
          )
          if (semanticFailure !== NO_PRIMARY_FAILURE) throw semanticFailure
        }),
        {
          seed: SEED,
          numRuns: RUNS,
          ...(PATH === undefined ? {} : { path: PATH }),
          examples: [
            [
              {
                siblingCount: 2,
                releasePrefix: 1,
                identical: true,
                duplicateRelease: true,
                reverseFinalRelease: true,
              },
            ],
          ],
        },
      )
    } catch (error) {
      propertyFailure = error
    }

    expect.soft(cleanupDiagnostics).toEqual([])
    expect.soft(executionDiagnostics).toEqual([])
    if (propertyFailure !== NO_PRIMARY_FAILURE) throw propertyFailure
  })
})

type RawCollectionSnapshot = {
  registryRowCount: number
  schemaVersion: number
  resetEpoch: number
  rowCount: number
}

type RawSnapshotViolation = {
  field: keyof RawCollectionSnapshot
  expected: number
  actual: number
}

function rawSnapshotViolations(
  actual: RawCollectionSnapshot,
  expected: RawCollectionSnapshot,
): Array<RawSnapshotViolation> {
  return (
    [`registryRowCount`, `schemaVersion`, `resetEpoch`, `rowCount`] as const
  ).flatMap((field) =>
    actual[field] === expected[field]
      ? []
      : [{ field, expected: expected[field], actual: actual[field] }],
  )
}

type FreshInitOutcome =
  | { status: `fulfilled` }
  | { status: `rejected`; error: string }

type FreshInitViolation =
  | { kind: `missing-outcome`; index: number }
  | { kind: `unexpected-outcome`; index: number }
  | { kind: `rejected`; index: number; error: string }

function freshInitViolations(
  outcomes: ReadonlyArray<FreshInitOutcome>,
): Array<FreshInitViolation> {
  const violations: Array<FreshInitViolation> = []
  for (let index = 0; index < 2; index++) {
    const outcome = outcomes[index]
    if (!outcome) {
      violations.push({ kind: `missing-outcome`, index })
    } else if (outcome.status === `rejected`) {
      violations.push({ kind: `rejected`, index, error: outcome.error })
    }
  }
  for (let index = 2; index < outcomes.length; index++) {
    violations.push({ kind: `unexpected-outcome`, index })
  }
  return violations
}

async function readRawCollectionSnapshot(
  database: BrowserWASQLiteDatabase,
  collectionId: string,
): Promise<RawCollectionSnapshot> {
  const registry = await database.execute<{
    table_name: string
    schema_version: number
  }>(
    `SELECT table_name, schema_version FROM collection_registry WHERE collection_id = ?`,
    [collectionId],
  )
  const row = registry[0]
  if (!row) throw new Error(`missing registry row for ${collectionId}`)
  const reset = await database.execute<{ reset_epoch: number }>(
    `SELECT reset_epoch FROM collection_reset_epoch WHERE collection_id = ?`,
    [collectionId],
  )
  const tableName = `"${row.table_name.replaceAll(`"`, `""`)}"`
  const count = await database.execute<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${tableName}`,
  )
  return {
    registryRowCount: registry.length,
    schemaVersion: row.schema_version,
    resetEpoch: reset[0]?.reset_epoch ?? -1,
    rowCount: count[0]?.count ?? -1,
  }
}

describe(`per-collection adapter and SQLite-state oracle`, () => {
  it(`preserves alpha rows, schema, and reset epoch when beta registers a different adapter`, async () => {
    let directory: string | undefined
    let database: BrowserWASQLiteDatabase | undefined
    let coordinator: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      directory = mkdtempSync(join(tmpdir(), `db-coordinator-routing-`))
      const createdDatabase = createWASQLiteTestDatabase({
        filename: join(directory, `state.sqlite`),
      })
      database = createdDatabase
      const createdCoordinator = createCoordinator(
        `real-sqlite-routing`,
        createRecordingAdapter({ id: `bootstrap` }),
      )
      coordinator = createdCoordinator
      const persistence = createBrowserWASQLitePersistence({
        database: createdDatabase,
        coordinator: createdCoordinator,
      })
      const resolve = (
        collectionId: string,
        schemaVersion: number,
      ): PersistenceAdapter => {
        const resolved = persistence.resolvePersistenceForCollection?.({
          collectionId,
          mode: `sync-present`,
          schemaVersion,
        })
        if (!resolved) throw new Error(`missing per-collection resolver`)
        return resolved.adapter
      }

      const alphaAdapter = resolve(`alpha`, 11)
      await alphaAdapter.applyCommittedTx(`alpha`, {
        txId: `alpha-seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `a-1`,
            value: { id: `a-1`, group: `kept` },
          },
        ],
      })
      const expected: RawCollectionSnapshot = {
        registryRowCount: 1,
        schemaVersion: 11,
        resetEpoch: 0,
        rowCount: 1,
      }
      const before = await readRawCollectionSnapshot(createdDatabase, `alpha`)
      expect(rawSnapshotViolations(before, expected)).toEqual([])

      // Merely resolving beta replaces the coordinator's one adapter slot.
      // The later alpha leadership read therefore runs through beta's schema.
      const betaAdapter = resolve(`beta`, 22)
      await betaAdapter.loadSubset(`beta`, {})
      createdCoordinator.subscribe(`alpha`, () => {})
      await waitFor(
        () => createdCoordinator.isLeader(`alpha`),
        `alpha leadership after beta registration`,
      )
      const after = await readRawCollectionSnapshot(createdDatabase, `alpha`)

      // D2 fixed cross-collection contamination witness. The shared
      // comparator reports schema, reset, and row losses independently.
      expect(rawSnapshotViolations(after, expected)).toEqual([])
    }, [
      [
        `real SQLite coordinator`,
        async () => {
          await disposeCoordinator(coordinator)
        },
      ],
      [
        `real SQLite database`,
        async () => {
          await Promise.resolve(database?.close?.())
        },
      ],
      [
        `real SQLite directory`,
        () => {
          if (directory) rmSync(directory, { recursive: true, force: true })
        },
      ],
    ])
  })

  it(`initializes one fresh collection safely across matching adapter instances`, async () => {
    let directory: string | undefined
    let database: BrowserWASQLiteDatabase | undefined

    await withFailurePreservingCleanup(async () => {
      directory = mkdtempSync(join(tmpdir(), `db-adapter-init-race-`))
      const createdDatabase = createWASQLiteTestDatabase({
        filename: join(directory, `state.sqlite`),
      })
      database = createdDatabase
      const createAdapter = (): PersistenceAdapter => {
        const persistence = createBrowserWASQLitePersistence({
          database: createdDatabase,
        })
        const resolved = persistence.resolvePersistenceForCollection?.({
          collectionId: `shared`,
          mode: `sync-present`,
          schemaVersion: 7,
        })
        if (!resolved) throw new Error(`missing per-collection resolver`)
        return resolved.adapter
      }
      const first = createAdapter()
      const second = createAdapter()

      const outcomes = await Promise.allSettled([
        first.loadSubset(`shared`, {}),
        second.loadSubset(`shared`, {}),
      ])
      const observed: Array<FreshInitOutcome> = outcomes.map((outcome) =>
        outcome.status === `fulfilled`
          ? { status: outcome.status }
          : {
              status: outcome.status,
              error:
                outcome.reason instanceof Error
                  ? outcome.reason.message
                  : String(outcome.reason),
            },
      )

      const initialized = await readRawCollectionSnapshot(
        createdDatabase,
        `shared`,
      )
      expect(
        rawSnapshotViolations(initialized, {
          registryRowCount: 1,
          schemaVersion: 7,
          resetEpoch: 0,
          rowCount: 0,
        }),
      ).toEqual([])

      // Separate #1753 checkpoint: same collection and same version/policy is
      // legal in two tabs. Both production adapter initializations must finish;
      // this does not rely on the cross-version reset assertion above.
      expect(freshInitViolations(observed)).toEqual([])
    }, [
      [
        `race SQLite database`,
        async () => {
          await Promise.resolve(database?.close?.())
        },
      ],
      [
        `race SQLite directory`,
        () => {
          if (directory) rmSync(directory, { recursive: true, force: true })
        },
      ],
    ])
  })

  it(`calibrates SQLite-state and fresh-registry checks against hostile results`, () => {
    const expected: RawCollectionSnapshot = {
      registryRowCount: 1,
      schemaVersion: 11,
      resetEpoch: 0,
      rowCount: 1,
    }
    expect(rawSnapshotViolations(expected, expected)).toEqual([])
    expect(
      rawSnapshotViolations(
        {
          registryRowCount: 0,
          schemaVersion: 22,
          resetEpoch: 1,
          rowCount: 0,
        },
        expected,
      ).map(({ field }) => field),
    ).toEqual([`registryRowCount`, `schemaVersion`, `resetEpoch`, `rowCount`])

    const allowed: Array<FreshInitOutcome> = [
      { status: `fulfilled` },
      { status: `fulfilled` },
    ]
    expect(freshInitViolations(allowed)).toEqual([])
    expect(
      freshInitViolations([
        allowed[0]!,
        {
          status: `rejected`,
          error: `UNIQUE constraint failed: collection_registry`,
        },
      ]),
    ).toEqual([
      {
        kind: `rejected`,
        index: 1,
        error: `UNIQUE constraint failed: collection_registry`,
      },
    ])
    expect(freshInitViolations([allowed[0]!])).toEqual([
      { kind: `missing-outcome`, index: 1 },
    ])
  })
})

type CollectionName = `alpha` | `beta`
type TabName = `leader` | `follower`

type RoutingHistory = {
  alphaVersion: number
  betaVersion: number
  registrationOrder: [CollectionName, CollectionName]
  firstDeliveryOrder: [CollectionName, CollectionName]
  secondDeliveryOrder: [CollectionName, CollectionName]
}

type RoutedApply = {
  phase: `initial-owner` | `after-takeover`
  collectionId: CollectionName
  adapterId: string
}

type RouteViolation = {
  kind: `missing-apply` | `duplicate-apply` | `misrouted-apply`
  checkpoint: RoutedApply[`phase`]
  collectionId: CollectionName
  expectedAdapterId: string
  actualAdapterIds: Array<string>
}

type CoordinatorRouteObservation = {
  phase: RoutedApply[`phase`]
  operation: `remote-subset` | `index` | `pull`
  collectionId: CollectionName
  calls: Array<{
    adapterId: string
    collectionId: string
    argument?: SemanticValue
  }>
  result: SemanticValue
}

type CoordinatorRouteViolation = {
  operation: CoordinatorRouteObservation[`operation`]
  checkpoint: CoordinatorRouteObservation[`phase`]
  collectionId: CollectionName
  field: `calls` | `result`
  expected: SemanticValue
  actual: SemanticValue
}

function coordinatorRouteViolations(
  observed: ReadonlyArray<CoordinatorRouteObservation>,
  expected: ReadonlyArray<CoordinatorRouteObservation>,
): Array<CoordinatorRouteViolation> {
  const violations: Array<CoordinatorRouteViolation> = []
  for (const expectedCell of expected) {
    const actualCell = observed.find(
      ({ phase, operation, collectionId }) =>
        phase === expectedCell.phase &&
        operation === expectedCell.operation &&
        collectionId === expectedCell.collectionId,
    )
    for (const field of [`calls`, `result`] as const) {
      const expectedValue = semanticValue(expectedCell[field])
      const actualValue = semanticValue(actualCell?.[field] ?? [])
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        violations.push({
          operation: expectedCell.operation,
          checkpoint: expectedCell.phase,
          collectionId: expectedCell.collectionId,
          field,
          expected: expectedValue,
          actual: actualValue,
        })
      }
    }
  }
  return violations
}

function routeViolationDiscriminant(violation: RouteViolation): string {
  return `${violation.kind}:${violation.checkpoint}:${violation.collectionId}`
}

function routeViolations(
  observed: ReadonlyArray<RoutedApply>,
  expected: ReadonlyArray<RoutedApply>,
): Array<RouteViolation> {
  const violations: Array<RouteViolation> = []
  for (const expectedRoute of expected) {
    const actualAdapterIds = observed
      .filter(
        ({ phase, collectionId }) =>
          phase === expectedRoute.phase &&
          collectionId === expectedRoute.collectionId,
      )
      .map(({ adapterId }) => adapterId)
    if (actualAdapterIds.length === 0) {
      violations.push({
        kind: `missing-apply`,
        checkpoint: expectedRoute.phase,
        collectionId: expectedRoute.collectionId,
        expectedAdapterId: expectedRoute.adapterId,
        actualAdapterIds,
      })
      continue
    }
    if (actualAdapterIds.length !== 1) {
      violations.push({
        kind: `duplicate-apply`,
        checkpoint: expectedRoute.phase,
        collectionId: expectedRoute.collectionId,
        expectedAdapterId: expectedRoute.adapterId,
        actualAdapterIds,
      })
      continue
    }
    if (actualAdapterIds[0] !== expectedRoute.adapterId) {
      violations.push({
        kind: `misrouted-apply`,
        checkpoint: expectedRoute.phase,
        collectionId: expectedRoute.collectionId,
        expectedAdapterId: expectedRoute.adapterId,
        actualAdapterIds,
      })
    }
  }
  return violations
}

// Collection identity and elected ownership jointly select the adapter. The
// model deliberately uses Maps instead of the coordinator's routing storage.
class PerCollectionRouteOracle {
  private readonly routes = new Map<string, string>()
  private readonly owners = new Map<CollectionName, TabName>()

  register(tab: TabName, collection: CollectionName, adapterId: string): void {
    this.routes.set(`${tab}:${collection}`, adapterId)
  }

  setOwner(collection: CollectionName, tab: TabName): void {
    this.owners.set(collection, tab)
  }

  expectedApply(
    phase: RoutedApply[`phase`],
    collectionId: CollectionName,
  ): RoutedApply {
    const owner = this.owners.get(collectionId)
    const adapterId = owner
      ? this.routes.get(`${owner}:${collectionId}`)
      : undefined
    if (!owner || !adapterId) {
      throw new Error(`oracle has no owner/route for ${collectionId}`)
    }
    return { phase, collectionId, adapterId }
  }
}

const orderArbitrary = fc
  .boolean()
  .map((forward): [CollectionName, CollectionName] =>
    forward ? [`alpha`, `beta`] : [`beta`, `alpha`],
  )

const routingHistoryArbitrary: fc.Arbitrary<RoutingHistory> = fc
  .record({
    alphaVersion: fc.integer({ min: 1, max: 50 }),
    versionDelta: fc.integer({ min: 1, max: 50 }),
    registrationOrder: orderArbitrary,
    firstDeliveryOrder: orderArbitrary,
    secondDeliveryOrder: orderArbitrary,
  })
  .map(({ alphaVersion, versionDelta, ...history }) => ({
    ...history,
    alphaVersion,
    betaVersion: alphaVersion + versionDelta,
  }))

function mutation(
  collectionId: CollectionName,
  phase: RoutedApply[`phase`],
): Array<PersistedMutationEnvelope> {
  return [
    {
      mutationId: `${phase}:${collectionId}`,
      type: `insert`,
      key: `${phase}:${collectionId}`,
      value: { id: `${phase}:${collectionId}`, collectionId },
    },
  ]
}

function applyObservation(
  phase: RoutedApply[`phase`],
  calls: ReadonlyArray<AdapterCall>,
): Array<RoutedApply> {
  return calls
    .filter(
      (call): call is AdapterCall & { collectionId: CollectionName } =>
        call.operation === `apply` &&
        (call.collectionId === `alpha` || call.collectionId === `beta`),
    )
    .map(({ collectionId, adapterId }) => ({
      phase,
      collectionId,
      adapterId,
    }))
    .sort((left, right) => left.collectionId.localeCompare(right.collectionId))
}

async function requestBothCollections(
  requester: BrowserCollectionCoordinator,
  phase: RoutedApply[`phase`],
  deliveryOrder: [CollectionName, CollectionName],
): Promise<void> {
  const pending = ([`alpha`, `beta`] as const).map((collectionId) =>
    requester.requestApplyLocalMutations(
      collectionId,
      mutation(collectionId, phase),
    ),
  )
  for (const collectionId of deliveryOrder) {
    expect(
      ControlledBroadcastChannel.deliverWhere(
        (data) =>
          payloadType(data) === `rpc:applyLocalMutations:req` &&
          envelopeCollection(data) === collectionId,
      ),
    ).toBe(true)
    await nextTurn()
  }
  await pumpNetwork()
  const responses = await Promise.all(pending)
  expect(responses.every((response) => response.ok)).toBe(true)
}

describe(`generated collection-route histories`, () => {
  it(`calibrates collection-key comparison against one peer-routed apply`, () => {
    const expected: Array<RoutedApply> = [
      {
        phase: `initial-owner`,
        collectionId: `alpha`,
        adapterId: `leader-alpha`,
      },
      {
        phase: `initial-owner`,
        collectionId: `beta`,
        adapterId: `leader-beta`,
      },
    ]
    const misrouted: Array<RoutedApply> = [
      expected[0]!,
      { ...expected[1]!, adapterId: `leader-alpha` },
    ]

    expect(routeViolations(expected, expected)).toEqual([])
    const [violation] = routeViolations(misrouted, expected)
    expect(violation).toEqual({
      kind: `misrouted-apply`,
      checkpoint: `initial-owner`,
      collectionId: `beta`,
      expectedAdapterId: `leader-beta`,
      actualAdapterIds: [`leader-alpha`],
    })
    expect(routeViolationDiscriminant(violation!)).toBe(
      `misrouted-apply:initial-owner:beta`,
    )

    const routedCell: CoordinatorRouteObservation = {
      phase: `initial-owner`,
      operation: `index`,
      collectionId: `alpha`,
      calls: [
        {
          adapterId: `leader-alpha`,
          collectionId: `alpha`,
          argument: semanticValue({ signature: `alpha-index` }),
        },
      ],
      result: semanticValue({ status: `fulfilled` }),
    }
    expect(coordinatorRouteViolations([routedCell], [routedCell])).toEqual([])
    expect(
      coordinatorRouteViolations(
        [{ ...routedCell, calls: [] }],
        [routedCell],
      ).map(({ operation, checkpoint, collectionId, field }) => ({
        operation,
        checkpoint,
        collectionId,
        field,
      })),
    ).toEqual([
      {
        operation: `index`,
        checkpoint: `initial-owner`,
        collectionId: `alpha`,
        field: `calls`,
      },
    ])
  })

  it(`routes every adapter-bound RPC by collection before and after leadership transfer`, async () => {
    const makePullResult = (
      marker: string,
      latestRowVersion: number,
    ): PullFixtureResult => ({
      latestRowVersion,
      requiresFullReload: false,
      changedKeys: [`${marker}:changed`],
      deletedKeys: [`${marker}:deleted`],
    })
    const leaderPullResults = {
      alpha: makePullResult(`leader-alpha`, 101),
      beta: makePullResult(`leader-beta`, 202),
    }
    const followerPullResults = {
      alpha: makePullResult(`follower-alpha`, 303),
      beta: makePullResult(`follower-beta`, 404),
    }
    const createPhaseAdapters = (
      tab: TabName,
      pullResults: Record<CollectionName, PullFixtureResult>,
    ): Record<CollectionName, RecordingAdapter> => ({
      alpha: createRecordingAdapter({
        id: `${tab}-alpha`,
        remoteSubsetOwner: () => Promise.resolve(),
        pullResult: pullResults.alpha,
      }),
      beta: createRecordingAdapter({
        id: `${tab}-beta`,
        remoteSubsetOwner: () => Promise.resolve(),
        pullResult: pullResults.beta,
      }),
    })
    const leaderAdapters = createPhaseAdapters(`leader`, leaderPullResults)
    const followerAdapters = createPhaseAdapters(
      `follower`,
      followerPullResults,
    )
    const requesterAdapter = createRecordingAdapter({ id: `requester` })
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined
    let requester: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      const observed: Array<CoordinatorRouteObservation> = []
      const expected: Array<CoordinatorRouteObservation> = []
      const dbName = `adapter-bound-rpc-matrix`
      leader = createCoordinator(dbName, leaderAdapters.alpha)
      follower = createCoordinator(dbName, followerAdapters.alpha)
      for (const collectionId of [`alpha`, `beta`] as const) {
        // Register beta last so a global mutable adapter misroutes alpha.
        registerCollectionAdapter(
          leader,
          collectionId,
          leaderAdapters[collectionId],
        )
        registerCollectionAdapter(
          follower,
          collectionId,
          followerAdapters[collectionId],
        )
        leader.subscribe(collectionId, () => {})
        follower.subscribe(collectionId, () => {})
      }
      await waitFor(
        () =>
          leader!.isLeader(`alpha`) &&
          leader!.isLeader(`beta`) &&
          !follower!.isLeader(`alpha`) &&
          !follower!.isLeader(`beta`),
        `adapter-bound initial leadership`,
      )

      const exercisePhase = async (
        phase: RoutedApply[`phase`],
        rpcRequester: BrowserCollectionCoordinator,
        ownerAdapters: Record<CollectionName, RecordingAdapter>,
        pullResults: Record<CollectionName, PullFixtureResult>,
      ): Promise<void> => {
        for (const operation of [`remote-subset`, `index`, `pull`] as const) {
          for (const collectionId of [`alpha`, `beta`] as const) {
            const before = new Map(
              Object.values(ownerAdapters).map((adapter) => [
                adapter,
                adapter.calls.length,
              ]),
            )
            let requestType: string
            let argument: SemanticValue
            let pending: Promise<unknown>
            let expectedResult: SemanticValue

            if (operation === `remote-subset`) {
              const demand: LoadSubsetOptions = {
                where: new IR.Func(`eq`, [
                  new IR.PropRef([collectionId, `group`]),
                  new IR.Value(`${phase}:${collectionId}`),
                ]),
                limit: collectionId === `alpha` ? 1 : 2,
                offset: phase === `initial-owner` ? 0 : 1,
              }
              requestType = `rpc:ensureRemoteSubset:req`
              argument = subsetSemantics(demand)
              pending = rpcRequester
                .requestEnsureRemoteSubset(collectionId, demand)
                .then(() => ({ status: `fulfilled` }))
              expectedResult = semanticValue({ status: `fulfilled` })
            } else if (operation === `index`) {
              const signature = `${phase}:${collectionId}:index`
              const spec = {
                expressionSql: [`${collectionId}_score`, phase],
              }
              requestType = `rpc:ensurePersistedIndex:req`
              argument = semanticValue({ signature, spec })
              pending = rpcRequester
                .requestEnsurePersistedIndex(collectionId, signature, spec)
                .then(() => ({ status: `fulfilled` }))
              expectedResult = semanticValue({ status: `fulfilled` })
            } else {
              const fromRowVersion =
                (phase === `initial-owner` ? 0 : 100) +
                (collectionId === `alpha` ? 11 : 22)
              requestType = `rpc:pullSince:req`
              argument = semanticValue({ fromRowVersion })
              pending = rpcRequester.pullSince(collectionId, fromRowVersion)
              const pullResult = pullResults[collectionId]
              expectedResult = semanticValue({
                ok: true,
                latestTerm: 1,
                latestSeq: 0,
                latestRowVersion: pullResult.latestRowVersion,
                requiresFullReload: false,
                changedKeys: pullResult.changedKeys,
                deletedKeys: pullResult.deletedKeys,
              })
            }

            expect(
              ControlledBroadcastChannel.deliverWhere(
                (data) =>
                  payloadType(data) === requestType &&
                  envelopeCollection(data) === collectionId,
              ),
            ).toBe(true)
            await pumpNetwork()
            const result = await pending
            const calls = Object.values(ownerAdapters)
              .flatMap((adapter) =>
                adapter.calls
                  .slice(before.get(adapter) ?? 0)
                  .filter((call) => call.operation === operation)
                  .map(
                    ({
                      adapterId,
                      collectionId: calledId,
                      argument: callArgument,
                    }) => ({
                      adapterId,
                      collectionId: calledId,
                      ...(callArgument === undefined
                        ? {}
                        : { argument: callArgument }),
                    }),
                  ),
              )
              .sort((left, right) =>
                left.adapterId.localeCompare(right.adapterId),
              )
            const resultValue =
              operation === `pull`
                ? semanticValue(
                    result && typeof result === `object`
                      ? Object.fromEntries(
                          Object.entries(result).filter(
                            ([key]) => key !== `type` && key !== `rpcId`,
                          ),
                        )
                      : result,
                  )
                : semanticValue(result)
            observed.push({
              phase,
              operation,
              collectionId,
              calls,
              result: resultValue,
            })
            expected.push({
              phase,
              operation,
              collectionId,
              calls: [
                {
                  adapterId: ownerAdapters[collectionId].id,
                  collectionId,
                  argument,
                },
              ],
              result: expectedResult,
            })
          }
        }
      }

      await exercisePhase(
        `initial-owner`,
        follower,
        leaderAdapters,
        leaderPullResults,
      )
      await disposeCoordinator(leader)
      await waitFor(
        () => follower!.isLeader(`alpha`) && follower!.isLeader(`beta`),
        `adapter-bound follower takeover`,
      )
      requester = createCoordinator(dbName, requesterAdapter)
      await exercisePhase(
        `after-takeover`,
        requester,
        followerAdapters,
        followerPullResults,
      )

      // Each violation retains operation, phase, collection, and whether the
      // loss was the exact routed call or the exact response.
      expect(coordinatorRouteViolations(observed, expected)).toEqual([])
    }, [
      [
        `adapter-bound initial leader`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `adapter-bound takeover leader`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
      [
        `adapter-bound post-takeover requester`,
        async () => {
          await disposeCoordinator(requester)
        },
      ],
    ])
  })

  it(`uses the collection's registered adapter before and after leadership transfer`, async () => {
    let originalFailingTrace: RoutingHistory | undefined
    let originalViolation: RouteViolation | undefined
    let targetDiscriminant: string | undefined
    const cleanupDiagnostics: Array<
      CleanupDiagnostic & { history: RoutingHistory }
    > = []
    const executionDiagnostics: Array<
      CleanupDiagnostic & { history: RoutingHistory; checkpoint: string }
    > = []
    let propertyFailure: unknown | typeof NO_PRIMARY_FAILURE =
      NO_PRIMARY_FAILURE

    try {
      await fc.assert(
        fc.asyncProperty(routingHistoryArbitrary, async (history) => {
          const oracle = new PerCollectionRouteOracle()
          const leaderAdapters = {
            alpha: createRecordingAdapter({
              id: `leader-alpha-v${history.alphaVersion}-reset`,
              schemaVersion: history.alphaVersion,
              policy: `sync-present-reset`,
            }),
            beta: createRecordingAdapter({
              id: `leader-beta-v${history.betaVersion}-error`,
              schemaVersion: history.betaVersion,
              policy: `sync-absent-error`,
            }),
          }
          const followerAdapters = {
            alpha: createRecordingAdapter({
              id: `follower-alpha-v${history.alphaVersion}-reset`,
              schemaVersion: history.alphaVersion,
              policy: `sync-present-reset`,
            }),
            beta: createRecordingAdapter({
              id: `follower-beta-v${history.betaVersion}-error`,
              schemaVersion: history.betaVersion,
              policy: `sync-absent-error`,
            }),
          }
          const dbName = `generated-route-${history.alphaVersion}-${history.betaVersion}`
          const initialCollection = history.registrationOrder[0]
          let leader: BrowserCollectionCoordinator | undefined
          let follower: BrowserCollectionCoordinator | undefined
          const observed: Array<RoutedApply> = []
          const expected: Array<RoutedApply> = []
          let semanticFailure: unknown | typeof NO_PRIMARY_FAILURE =
            NO_PRIMARY_FAILURE
          let checkpoint = `coordinator allocation`

          try {
            leader = createCoordinator(
              dbName,
              leaderAdapters[initialCollection],
            )
            follower = createCoordinator(
              dbName,
              followerAdapters[initialCollection],
            )

            for (const collectionId of history.registrationOrder) {
              registerCollectionAdapter(
                leader,
                collectionId,
                leaderAdapters[collectionId],
              )
              registerCollectionAdapter(
                follower,
                collectionId,
                followerAdapters[collectionId],
              )
              oracle.register(
                `leader`,
                collectionId,
                leaderAdapters[collectionId].id,
              )
              oracle.register(
                `follower`,
                collectionId,
                followerAdapters[collectionId].id,
              )
            }

            checkpoint = `initial leadership`
            for (const collectionId of [`alpha`, `beta`] as const) {
              leader.subscribe(collectionId, () => {})
              follower.subscribe(collectionId, () => {})
              oracle.setOwner(collectionId, `leader`)
            }
            await waitFor(
              () =>
                leader!.isLeader(`alpha`) &&
                leader!.isLeader(`beta`) &&
                !follower!.isLeader(`alpha`) &&
                !follower!.isLeader(`beta`),
              `generated initial two-collection leadership`,
            )

            checkpoint = `initial routed applies`
            await requestBothCollections(
              follower,
              `initial-owner`,
              history.firstDeliveryOrder,
            )
            observed.push(
              ...applyObservation(`initial-owner`, [
                ...leaderAdapters.alpha.calls,
                ...leaderAdapters.beta.calls,
              ]),
            )
            expected.push(
              oracle.expectedApply(`initial-owner`, `alpha`),
              oracle.expectedApply(`initial-owner`, `beta`),
            )

            checkpoint = `leadership transfer`
            await disposeCoordinator(leader)
            for (const collectionId of [`alpha`, `beta`] as const) {
              oracle.setOwner(collectionId, `follower`)
            }
            await waitFor(
              () => follower!.isLeader(`alpha`) && follower!.isLeader(`beta`),
              `generated follower takeover`,
            )

            checkpoint = `post-takeover routed applies`
            // The new leader's direct calls still exercise the same production
            // handler and must look up adapters per collection.
            for (const collectionId of history.secondDeliveryOrder) {
              const response = await follower.requestApplyLocalMutations(
                collectionId,
                mutation(collectionId, `after-takeover`),
              )
              expect(response.ok).toBe(true)
            }
            observed.push(
              ...applyObservation(`after-takeover`, [
                ...followerAdapters.alpha.calls,
                ...followerAdapters.beta.calls,
              ]),
            )
            expected.push(
              oracle.expectedApply(`after-takeover`, `alpha`),
              oracle.expectedApply(`after-takeover`, `beta`),
            )

            const [violation] = routeViolations(observed, expected)
            if (violation) {
              const discriminant = routeViolationDiscriminant(violation)
              if (targetDiscriminant === undefined) {
                targetDiscriminant = discriminant
                originalViolation = structuredClone(violation)
                originalFailingTrace = structuredClone(history)
              }
              // A smaller candidate is a valid reduction only when it reaches
              // the same checkpoint and misroutes the same collection.
              if (discriminant === targetDiscriminant) {
                semanticFailure = new Error(
                  `per-collection route mismatch; discriminant=${discriminant}; originalViolation=${JSON.stringify(originalViolation)}; reducedViolation=${JSON.stringify(violation)}; original=${JSON.stringify(originalFailingTrace)}; reduced=${JSON.stringify(history)}; expected=${JSON.stringify(expected)}; observed=${JSON.stringify(observed)}`,
                )
              }
            }
          } catch (error) {
            executionDiagnostics.push({
              resource: `generated route execution`,
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
              history: structuredClone(history),
              checkpoint,
            })
          }

          const historyCleanupDiagnostics: Array<CleanupDiagnostic> = []
          await captureCleanup(
            historyCleanupDiagnostics,
            `leader coordinator`,
            async () => {
              await disposeCoordinator(leader)
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `follower coordinator`,
            async () => {
              await disposeCoordinator(follower)
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `coordinator locks`,
            async () => {
              await waitForWithoutDelivery(
                () => heldLocks.size === 0 && queuedLocks.size === 0,
                `generated history lock cleanup`,
              )
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `coordinator transport`,
            () => {
              const snapshot = {
                endpoints: ControlledBroadcastChannel.endpoints.size,
                delayed: ControlledBroadcastChannel.delayed.length,
              }
              if (snapshot.endpoints !== 0 || snapshot.delayed !== 0) {
                throw new Error(JSON.stringify(snapshot))
              }
            },
          )
          cleanupDiagnostics.push(
            ...historyCleanupDiagnostics.map((diagnostic) => ({
              ...diagnostic,
              history: structuredClone(history),
            })),
          )

          if (semanticFailure !== NO_PRIMARY_FAILURE) throw semanticFailure
        }),
        {
          seed: SEED,
          numRuns: RUNS,
          ...(PATH === undefined ? {} : { path: PATH }),
        },
      )
    } catch (error) {
      propertyFailure = error
    }

    // Cleanup diagnostics are evaluated outside fast-check, so cleanup cannot
    // become the predicate that selects or shrinks a semantic route failure.
    expect.soft(cleanupDiagnostics).toEqual([])
    // Setup/reach/fixture failures are also reported outside the property;
    // only the locked semantic discriminant is eligible for shrinking.
    expect.soft(executionDiagnostics).toEqual([])
    if (propertyFailure !== NO_PRIMARY_FAILURE) throw propertyFailure
  })
})

type OwnershipObservation = {
  collectionId: string
  ownerAtCall?: string
}

// A source commit may apply only while the elected persistence owner holds the
// writer boundary. Collection visibility alone does not establish ownership.
function findUnownedWrites(
  observations: ReadonlyArray<OwnershipObservation>,
  electedOwner: string,
): Array<OwnershipObservation> {
  return observations.filter(
    (observation) => observation.ownerAtCall !== electedOwner,
  )
}

describe(`sync-ingested write ownership oracle`, () => {
  it(`applies a source commit through the elected persistence owner after leadership changes`, async () => {
    type Todo = { id: string; title: string }
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

    let electedOwner = `tab-a`
    let activeWriter: string | undefined
    let sourceParams: SourceParams | undefined
    let ownerRequests = 0
    const adapter = createRecordingAdapter({
      id: `sync-alpha`,
      owner: () => activeWriter,
    })
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `tab-a`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => electedOwner === `tab-a`,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      // Remote subset ownership is unrelated to this write-owner law.
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyCommittedTx: async (collectionId, tx) => {
        ownerRequests++
        const ownerTx = {
          ...tx,
          term: 1,
          seq: ownerRequests,
          rowVersion: ownerRequests,
        }
        activeWriter = electedOwner
        try {
          await adapter.applyCommittedTx(collectionId, ownerTx)
        } finally {
          activeWriter = undefined
        }
        return {
          type: `rpc:applyCommittedTx:res`,
          rpcId: `owned-${ownerRequests}`,
          ok: true,
          term: 1,
          seq: ownerRequests,
          latestRowVersion: ownerRequests,
        }
      },
    }
    let cleanupCollection: (() => Promise<void>) | undefined

    await withFailurePreservingCleanup(async () => {
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-alpha`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.startSyncImmediate()
      await waitForWithoutDelivery(
        () => sourceParams !== undefined,
        `wrapped source controls`,
      )

      // Legal leadership history: the original tab loses ownership before an
      // external source callback ingests its next transaction.
      electedOwner = `tab-b`
      sourceParams!.begin()
      sourceParams!.write({
        type: `insert`,
        value: { id: `sync-1`, title: `from source` },
      })
      const receipt = sourceParams!.commit()
      if (receipt !== true) await receipt

      const applies = adapter.calls
        .filter(({ operation }) => operation === `apply`)
        .map(({ collectionId, ownerAtCall }) => ({
          collectionId,
          ownerAtCall,
        }))

      // Positive production reach: the source write became collection-visible
      // and reached exactly one persistence apply call.
      expect(collection.get(`sync-1`)).toMatchObject({
        id: `sync-1`,
        title: `from source`,
      })
      expect(applies).toHaveLength(1)
      // Ownership checkpoint: a direct-adapter bypass runs outside the elected
      // tab-b writer scope. Owner-routed implementations pass this unchanged
      // regardless of request count.
      expect(findUnownedWrites(applies, electedOwner)).toEqual([])
    }, [
      [
        `sync-ingested collection`,
        async () => {
          await cleanupCollection?.()
        },
      ],
    ])
  })

  it(`calibrates the owner checker against one bypass and one owned write`, () => {
    expect(
      findUnownedWrites(
        [
          { collectionId: `alpha`, ownerAtCall: `tab-b` },
          { collectionId: `beta` },
        ],
        `tab-b`,
      ),
    ).toEqual([{ collectionId: `beta` }])
  })

  it(`routes a rich source commit through the new elected Browser owner`, async () => {
    type Todo = { id: string; title: string }
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]
    type TxAdapter = PersistenceAdapter & { applied: Array<PersistedTx> }

    const createTxAdapter = (): TxAdapter => {
      const applied: Array<PersistedTx> = []
      return {
        applied,
        loadSubset: () => Promise.resolve([]),
        applyCommittedTx: (_collectionId, tx) => {
          applied.push(structuredClone(tx))
          return Promise.resolve()
        },
        ensureIndex: () => Promise.resolve(),
        getStreamPosition: () =>
          Promise.resolve({
            latestTerm: 0,
            latestSeq: 0,
            latestRowVersion: 0,
          }),
      }
    }

    const retiredAdapter = createTxAdapter()
    const electedAdapter = createTxAdapter()
    const requesterAdapter = createTxAdapter()
    const originalElectedApply =
      electedAdapter.applyCommittedTx.bind(electedAdapter)
    let electedApplyEntered = false
    let releaseElectedApply = (): void => {}
    const electedApplyGate = new Promise<void>((resolve) => {
      releaseElectedApply = resolve
    })
    electedAdapter.applyCommittedTx = async (collectionId, tx) => {
      electedApplyEntered = true
      await electedApplyGate
      await originalElectedApply(collectionId, tx)
    }
    let retired: BrowserCollectionCoordinator | undefined
    let elected: BrowserCollectionCoordinator | undefined
    let requester: BrowserCollectionCoordinator | undefined
    let cleanupCollection: (() => Promise<void>) | undefined
    const electedCommitted: Array<unknown> = []
    const requesterCommitted: Array<unknown> = []

    await withFailurePreservingCleanup(async () => {
      const dbName = `source-owner-transfer`
      retired = createCoordinator(dbName, retiredAdapter)
      elected = createCoordinator(dbName, electedAdapter)
      requester = createCoordinator(dbName, requesterAdapter)
      retired.subscribe(`todos`, () => {})
      elected.subscribe(`todos`, (message) => {
        const payload = message.payload as { type?: string }
        if (payload.type === `tx:committed`) {
          electedCommitted.push(structuredClone(payload))
        }
      })
      requester.subscribe(`todos`, (message) => {
        const payload = message.payload as { type?: string }
        if (payload.type === `tx:committed`) {
          requesterCommitted.push(structuredClone(payload))
        }
      })
      await waitFor(
        () =>
          retired!.isLeader(`todos`) &&
          !elected!.isLeader(`todos`) &&
          !requester!.isLeader(`todos`),
        `initial source owner`,
      )

      await disposeCoordinator(retired)
      await waitFor(
        () => elected!.isLeader(`todos`) && !requester!.isLeader(`todos`),
        `transferred source owner`,
      )

      let sourceParams: SourceParams | undefined
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `todos`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter: requesterAdapter, coordinator: requester },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.startSyncImmediate()
      await waitForWithoutDelivery(
        () => sourceParams !== undefined,
        `Browser source controls`,
      )

      sourceParams!.begin()
      sourceParams!.metadata?.collection.set(`resume`, { offset: 11 })
      sourceParams!.truncate()
      sourceParams!.write({
        type: `insert`,
        value: { id: `rich`, title: `through Browser owner` },
        metadata: { source: `browser-sync` },
      })
      const receipt = sourceParams!.commit()
      let receiptSettled = receipt === true
      const receiptPromise = receipt === true ? Promise.resolve() : receipt
      void receiptPromise.then(
        () => {
          receiptSettled = true
        },
        () => {
          receiptSettled = true
        },
      )

      await pumpNetwork()
      await waitForWithoutDelivery(
        () => electedApplyEntered,
        `elected Browser source apply entry`,
      )
      expect({
        receiptSettled,
        electedApplies: electedAdapter.applied.length,
        requesterInvalidations: requesterCommitted.length,
      }).toEqual({
        receiptSettled: false,
        electedApplies: 0,
        requesterInvalidations: 0,
      })

      releaseElectedApply()
      await pumpNetwork()
      await receiptPromise
      await pumpNetwork()

      expect(collection.get(`rich`)).toMatchObject({
        id: `rich`,
        title: `through Browser owner`,
      })
      expect(retiredAdapter.applied).toEqual([])
      expect(requesterAdapter.applied).toEqual([])
      expect(electedAdapter.applied).toHaveLength(1)
      expect(electedAdapter.applied[0]).toMatchObject({
        truncate: true,
        mutations: [
          {
            type: `update`,
            key: `rich`,
            value: { id: `rich`, title: `through Browser owner` },
          },
        ],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `rich`,
            value: { source: `browser-sync` },
          },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: { offset: 11 } },
        ],
      })
      const committedTxId = electedAdapter.applied[0]!.txId
      const expectedCommitted = {
        type: `tx:committed`,
        term: 1,
        seq: 1,
        txId: committedTxId,
        latestRowVersion: 1,
        requiresFullReload: true,
      }
      expect(electedCommitted).toEqual([expectedCommitted])
      expect(requesterCommitted).toEqual([expectedCommitted])
    }, [
      [
        `elected Browser source apply gate`,
        () => {
          releaseElectedApply()
        },
      ],
      [
        `Browser source collection`,
        async () => {
          await cleanupCollection?.()
        },
      ],
      [
        `retired Browser source owner`,
        async () => {
          await disposeCoordinator(retired)
        },
      ],
      [
        `elected Browser source owner`,
        async () => {
          await disposeCoordinator(elected)
        },
      ],
      [
        `Browser source requester`,
        async () => {
          await disposeCoordinator(requester)
        },
      ],
    ])
  })
})

describe(`coordinator fixture lifecycle`, () => {
  it(`releases delayed transport and leadership state before a fresh lifecycle`, async () => {
    let first: BrowserCollectionCoordinator | undefined
    let peer: BrowserCollectionCoordinator | undefined
    let fresh: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      first = createCoordinator(
        `cleanup-first`,
        createRecordingAdapter({ id: `first` }),
      )
      peer = createCoordinator(
        `cleanup-first`,
        createRecordingAdapter({ id: `peer` }),
      )
      first.subscribe(`alpha`, () => {})
      peer.subscribe(`alpha`, () => {})
      await waitFor(
        () => first!.isLeader(`alpha`) && !peer!.isLeader(`alpha`),
        `first lifecycle leadership`,
      )

      const retiredBefore = ControlledBroadcastChannel.retiredDeliveries
      first.publish(`alpha`, {
        v: 1,
        dbName: `cleanup-first`,
        collectionId: `alpha`,
        senderId: first.getNodeId(),
        ts: Date.now(),
        payload: { type: `lifecycle:pending` },
      })
      expect(ControlledBroadcastChannel.delayed.length).toBeGreaterThan(0)
      await disposeCoordinator(first)
      await disposeCoordinator(peer)
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `first lifecycle release`,
      )
      expect(ControlledBroadcastChannel.retiredDeliveries).toBeGreaterThan(
        retiredBefore,
      )
      expect(coordinatorFixtureSnapshot()).toEqual({
        delayed: 0,
        endpoints: 0,
        heldLocks: 0,
        queuedLocks: 0,
      })

      fresh = createCoordinator(
        `cleanup-fresh`,
        createRecordingAdapter({ id: `fresh` }),
      )
      fresh.subscribe(`alpha`, () => {})
      await waitFor(
        () => fresh!.isLeader(`alpha`),
        `fresh lifecycle leadership`,
      )
      expect(fresh.isLeader(`alpha`)).toBe(true)
      await disposeCoordinator(fresh)
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `fresh lifecycle release`,
      )
      expect(coordinatorFixtureSnapshot()).toEqual({
        delayed: 0,
        endpoints: 0,
        heldLocks: 0,
        queuedLocks: 0,
      })
    }, [
      [
        `first lifecycle coordinator`,
        async () => {
          await disposeCoordinator(first)
        },
      ],
      [
        `first lifecycle peer`,
        async () => {
          await disposeCoordinator(peer)
        },
      ],
      [
        `fresh lifecycle coordinator`,
        async () => {
          await disposeCoordinator(fresh)
        },
      ],
    ])
  })
})
