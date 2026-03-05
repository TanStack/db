import type {
  ApplyLocalMutationsResponse,
  PersistedCollectionCoordinator,
  PersistedIndexSpec,
  PersistedMutationEnvelope,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type { LoadSubsetOptions } from '@tanstack/db'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 3_000
const RPC_TIMEOUT_MS = 10_000
const RPC_RETRY_ATTEMPTS = 2
const RPC_RETRY_DELAY_MS = 200
const WRITER_LOCK_BUSY_RETRY_MS = 50
const WRITER_LOCK_MAX_RETRIES = 20

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type RPCRequest =
  | {
      type: `rpc:ensureRemoteSubset:req`
      rpcId: string
      options: LoadSubsetOptions
    }
  | {
      type: `rpc:ensurePersistedIndex:req`
      rpcId: string
      signature: string
      spec: PersistedIndexSpec
    }
  | {
      type: `rpc:applyLocalMutations:req`
      rpcId: string
      envelopeId: string
      mutations: Array<PersistedMutationEnvelope>
    }
  | {
      type: `rpc:pullSince:req`
      rpcId: string
      fromRowVersion: number
    }

type RPCResponse =
  | {
      type: `rpc:ensureRemoteSubset:res`
      rpcId: string
      ok: boolean
      error?: string
    }
  | {
      type: `rpc:ensurePersistedIndex:res`
      rpcId: string
      ok: boolean
      error?: string
    }
  | ApplyLocalMutationsResponse
  | PullSinceResponse

type PendingRPC = {
  resolve: (response: RPCResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CollectionState = {
  isLeader: boolean
  lockAbortController: AbortController | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  latestTerm: number
  latestSeq: number
  latestRowVersion: number
  subscribers: Set<(message: ProtocolEnvelope<unknown>) => void>
}

// Adapter with pullSince support
type AdapterWithPullSince = PersistenceAdapter<
  Record<string, unknown>,
  string | number
> & {
  pullSince?: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<
    | {
        latestRowVersion: number
        requiresFullReload: true
      }
    | {
        latestRowVersion: number
        requiresFullReload: false
        changedKeys: Array<string | number>
        deletedKeys: Array<string | number>
      }
  >
  getStreamPosition?: (collectionId: string) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type BrowserCollectionCoordinatorOptions = {
  dbName: string
  adapter?: AdapterWithPullSince
}

// ---------------------------------------------------------------------------
// BrowserCollectionCoordinator
// ---------------------------------------------------------------------------

export class BrowserCollectionCoordinator implements PersistedCollectionCoordinator {
  private readonly nodeId = crypto.randomUUID()
  private readonly dbName: string
  private adapter: AdapterWithPullSince | null
  private readonly channel: BroadcastChannel
  private readonly collections = new Map<string, CollectionState>()
  private readonly pendingRPCs = new Map<string, PendingRPC>()
  private readonly appliedEnvelopeIds = new Map<string, number>()
  private disposed = false

  /** Method indirection to prevent TypeScript from narrowing `disposed` across awaits */
  private isDisposed(): boolean {
    return this.disposed
  }

  private requireAdapter(): AdapterWithPullSince {
    if (!this.adapter) {
      throw new Error(
        `BrowserCollectionCoordinator: adapter not set. Call setAdapter() before using leader-side operations.`,
      )
    }
    return this.adapter
  }

  constructor(options: BrowserCollectionCoordinatorOptions) {
    this.dbName = options.dbName
    this.adapter = options.adapter ?? null
    this.channel = new BroadcastChannel(`tsdb:coord:${this.dbName}`)
    this.channel.onmessage = (event: MessageEvent) => {
      this.onChannelMessage(event.data)
    }
  }

  /**
   * Set or replace the persistence adapter used for leader-side RPC handling.
   * Called by `createBrowserWASQLitePersistence` to wire the internally-created
   * adapter into the coordinator.
   */
  setAdapter(adapter: AdapterWithPullSince): void {
    this.adapter = adapter
  }

  // -----------------------------------------------------------------------
  // PersistedCollectionCoordinator interface
  // -----------------------------------------------------------------------

  getNodeId(): string {
    return this.nodeId
  }

  subscribe(
    collectionId: string,
    onMessage: (message: ProtocolEnvelope<unknown>) => void,
  ): () => void {
    const state = this.ensureCollectionState(collectionId)
    state.subscribers.add(onMessage)
    return () => {
      state.subscribers.delete(onMessage)
    }
  }

  publish(_collectionId: string, message: ProtocolEnvelope<unknown>): void {
    this.channel.postMessage(message)
  }

  isLeader(collectionId: string): boolean {
    return this.collections.get(collectionId)?.isLeader ?? false
  }

  async ensureLeadership(collectionId: string): Promise<void> {
    const state = this.ensureCollectionState(collectionId)
    if (state.isLeader) return
    await this.acquireLeadership(collectionId, state)
  }

  async requestEnsureRemoteSubset(
    collectionId: string,
    options: LoadSubsetOptions,
  ): Promise<void> {
    if (this.isLeader(collectionId)) return

    const response = await this.sendRPC<{
      type: `rpc:ensureRemoteSubset:res`
      rpcId: string
      ok: boolean
      error?: string
    }>(collectionId, {
      type: `rpc:ensureRemoteSubset:req`,
      rpcId: crypto.randomUUID(),
      options,
    })

    if (!response.ok) {
      throw new Error(
        `ensureRemoteSubset failed: ${response.error ?? `unknown error`}`,
      )
    }
  }

  async requestEnsurePersistedIndex(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ): Promise<void> {
    if (this.isLeader(collectionId)) {
      await this.requireAdapter().ensureIndex(collectionId, signature, spec)
      return
    }

    const response = await this.sendRPC<{
      type: `rpc:ensurePersistedIndex:res`
      rpcId: string
      ok: boolean
      error?: string
    }>(collectionId, {
      type: `rpc:ensurePersistedIndex:req`,
      rpcId: crypto.randomUUID(),
      signature,
      spec,
    })

    if (!response.ok) {
      throw new Error(
        `ensurePersistedIndex failed: ${response.error ?? `unknown error`}`,
      )
    }
  }

  async requestApplyLocalMutations(
    collectionId: string,
    mutations: Array<PersistedMutationEnvelope>,
  ): Promise<ApplyLocalMutationsResponse> {
    if (this.isLeader(collectionId)) {
      return this.handleApplyLocalMutations(collectionId, {
        type: `rpc:applyLocalMutations:req`,
        rpcId: crypto.randomUUID(),
        envelopeId: crypto.randomUUID(),
        mutations,
      })
    }

    return this.sendRPC<ApplyLocalMutationsResponse>(collectionId, {
      type: `rpc:applyLocalMutations:req`,
      rpcId: crypto.randomUUID(),
      envelopeId: crypto.randomUUID(),
      mutations,
    })
  }

  async pullSince(
    collectionId: string,
    fromRowVersion: number,
  ): Promise<PullSinceResponse> {
    if (this.isLeader(collectionId)) {
      return this.handlePullSince(collectionId, {
        type: `rpc:pullSince:req`,
        rpcId: crypto.randomUUID(),
        fromRowVersion,
      })
    }

    return this.sendRPC<PullSinceResponse>(collectionId, {
      type: `rpc:pullSince:req`,
      rpcId: crypto.randomUUID(),
      fromRowVersion,
    })
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    this.disposed = true

    for (const [collectionId, state] of this.collections) {
      this.releaseLeadership(collectionId, state)
    }

    for (const [, pending] of this.pendingRPCs) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`coordinator disposed`))
    }
    this.pendingRPCs.clear()

    this.channel.close()
    this.collections.clear()
  }

  // -----------------------------------------------------------------------
  // Leadership via Web Locks
  // -----------------------------------------------------------------------

  private ensureCollectionState(collectionId: string): CollectionState {
    let state = this.collections.get(collectionId)
    if (!state) {
      state = {
        isLeader: false,
        lockAbortController: null,
        heartbeatTimer: null,
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        subscribers: new Set(),
      }
      this.collections.set(collectionId, state)
      void this.acquireLeadership(collectionId, state)
    }
    return state
  }

  private async acquireLeadership(
    collectionId: string,
    state: CollectionState,
  ): Promise<void> {
    if (this.disposed || state.isLeader) return

    const lockName = `tsdb:leader:${this.dbName}:${collectionId}`
    const abortController = new AbortController()
    state.lockAbortController = abortController

    try {
      await navigator.locks.request(
        lockName,
        { signal: abortController.signal },
        async () => {
          if (this.isDisposed()) return

          try {
            // Restore stream position from DB before claiming leadership
            const adapter = this.requireAdapter()
            if (adapter.getStreamPosition) {
              const pos =
                await adapter.getStreamPosition(collectionId)
              state.latestTerm = pos.latestTerm
              state.latestSeq = pos.latestSeq
              state.latestRowVersion = pos.latestRowVersion
            }

            state.latestTerm++
            state.isLeader = true

            this.emitHeartbeat(collectionId, state)
            state.heartbeatTimer = setInterval(() => {
              this.emitHeartbeat(collectionId, state)
            }, HEARTBEAT_INTERVAL_MS)

            // Hold the lock until disposed or aborted
            await new Promise<void>((resolve) => {
              const onAbort = () => {
                abortController.signal.removeEventListener(`abort`, onAbort)
                resolve()
              }
              if (abortController.signal.aborted) {
                resolve()
                return
              }
              abortController.signal.addEventListener(`abort`, onAbort)
            })
          } finally {
            state.isLeader = false
            if (state.heartbeatTimer) {
              clearInterval(state.heartbeatTimer)
              state.heartbeatTimer = null
            }
          }
        },
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === `AbortError`) {
        return
      }
      console.warn(`Failed to acquire leadership for ${collectionId}:`, error)
    }

    // Re-acquire if not disposed (leadership was released by another means)
    if (!this.isDisposed()) {
      void this.acquireLeadership(collectionId, state)
    }
  }

  private releaseLeadership(
    _collectionId: string,
    state: CollectionState,
  ): void {
    if (state.lockAbortController) {
      state.lockAbortController.abort()
      state.lockAbortController = null
    }
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer)
      state.heartbeatTimer = null
    }
    state.isLeader = false
  }

  private emitHeartbeat(collectionId: string, state: CollectionState): void {
    const envelope: ProtocolEnvelope<unknown> = {
      v: 1,
      dbName: this.dbName,
      collectionId,
      senderId: this.nodeId,
      ts: Date.now(),
      payload: {
        type: `leader:heartbeat`,
        term: state.latestTerm,
        leaderId: this.nodeId,
        latestSeq: state.latestSeq,
        latestRowVersion: state.latestRowVersion,
      },
    }
    this.channel.postMessage(envelope)
  }

  // -----------------------------------------------------------------------
  // BroadcastChannel message handling
  // -----------------------------------------------------------------------

  private onChannelMessage(data: unknown): void {
    if (!isProtocolEnvelope(data)) return

    const envelope = data

    // Ignore own messages
    if (envelope.senderId === this.nodeId) return

    const payload = envelope.payload
    if (!payload || typeof payload !== `object`) return

    const type = (payload as Record<string, unknown>).type as string | undefined

    // Handle RPC responses (for pending outbound RPCs)
    if (type && type.endsWith(`:res`)) {
      const rpcId = (payload as { rpcId?: string }).rpcId
      if (rpcId && this.pendingRPCs.has(rpcId)) {
        const pending = this.pendingRPCs.get(rpcId)!
        this.pendingRPCs.delete(rpcId)
        clearTimeout(pending.timer)
        pending.resolve(payload as RPCResponse)
        return
      }
    }

    // Handle RPC requests (leader only)
    if (type && type.endsWith(`:req`)) {
      const collectionId = envelope.collectionId
      if (this.isLeader(collectionId)) {
        void this.handleRPCRequest(collectionId, payload as RPCRequest)
      }
      return
    }

    // Forward protocol messages to subscribers
    const state = this.collections.get(envelope.collectionId)
    if (state) {
      for (const subscriber of state.subscribers) {
        subscriber(envelope)
      }
    }
  }

  // -----------------------------------------------------------------------
  // RPC - Outbound (follower side)
  // -----------------------------------------------------------------------

  private async sendRPC<T extends RPCResponse>(
    collectionId: string,
    request: RPCRequest,
  ): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= RPC_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(RPC_RETRY_DELAY_MS * attempt)
      }

      try {
        return await this.sendRPCOnce<T>(collectionId, request)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }

    throw lastError ?? new Error(`RPC failed after retries`)
  }

  private sendRPCOnce<T extends RPCResponse>(
    collectionId: string,
    request: RPCRequest,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const rpcId = request.rpcId

      const timer = setTimeout(() => {
        this.pendingRPCs.delete(rpcId)
        reject(
          new Error(`RPC ${request.type} timed out after ${RPC_TIMEOUT_MS}ms`),
        )
      }, RPC_TIMEOUT_MS)

      this.pendingRPCs.set(rpcId, {
        resolve: resolve as (response: RPCResponse) => void,
        reject,
        timer,
      })

      const envelope: ProtocolEnvelope<unknown> = {
        v: 1,
        dbName: this.dbName,
        collectionId,
        senderId: this.nodeId,
        ts: Date.now(),
        payload: request,
      }
      this.channel.postMessage(envelope)
    })
  }

  // -----------------------------------------------------------------------
  // RPC - Inbound (leader side)
  // -----------------------------------------------------------------------

  private async handleRPCRequest(
    collectionId: string,
    request: RPCRequest,
  ): Promise<void> {
    let response: RPCResponse

    try {
      switch (request.type) {
        case `rpc:ensureRemoteSubset:req`:
          response = await this.handleEnsureRemoteSubset(collectionId, request)
          break
        case `rpc:ensurePersistedIndex:req`:
          response = await this.handleEnsurePersistedIndex(
            collectionId,
            request,
          )
          break
        case `rpc:applyLocalMutations:req`:
          response = await this.handleApplyLocalMutations(collectionId, request)
          break
        case `rpc:pullSince:req`:
          response = await this.handlePullSince(collectionId, request)
          break
        default:
          return
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      response = {
        type: request.type.replace(`:req`, `:res`) as RPCResponse[`type`],
        rpcId: request.rpcId,
        ok: false,
        error: errorMessage,
      } as RPCResponse
    }

    const envelope: ProtocolEnvelope<unknown> = {
      v: 1,
      dbName: this.dbName,
      collectionId,
      senderId: this.nodeId,
      ts: Date.now(),
      payload: response,
    }
    this.channel.postMessage(envelope)
  }

  private handleEnsureRemoteSubset(
    _collectionId: string,
    request: { type: `rpc:ensureRemoteSubset:req`; rpcId: string },
  ): RPCResponse {
    // Leader doesn't need to do anything special — the remote subset
    // is ensured by the leader's own sync connection
    return {
      type: `rpc:ensureRemoteSubset:res`,
      rpcId: request.rpcId,
      ok: true,
    }
  }

  private async handleEnsurePersistedIndex(
    collectionId: string,
    request: {
      type: `rpc:ensurePersistedIndex:req`
      rpcId: string
      signature: string
      spec: PersistedIndexSpec
    },
  ): Promise<RPCResponse> {
    await this.withWriterLock(() =>
      this.requireAdapter().ensureIndex(collectionId, request.signature, request.spec),
    )
    return {
      type: `rpc:ensurePersistedIndex:res`,
      rpcId: request.rpcId,
      ok: true,
    }
  }

  private async handleApplyLocalMutations(
    collectionId: string,
    request: {
      type: `rpc:applyLocalMutations:req`
      rpcId: string
      envelopeId: string
      mutations: Array<PersistedMutationEnvelope>
    },
  ): Promise<ApplyLocalMutationsResponse> {
    // Dedupe by envelopeId
    if (this.appliedEnvelopeIds.has(request.envelopeId)) {
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `CONFLICT`,
        error: `envelope ${request.envelopeId} already applied`,
      }
    }

    const state = this.collections.get(collectionId)
    if (!state || !state.isLeader) {
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `NOT_LEADER`,
        error: `not the leader for ${collectionId}`,
      }
    }

    // Assign stream position
    state.latestSeq++
    state.latestRowVersion++

    const term = state.latestTerm
    const seq = state.latestSeq
    const rowVersion = state.latestRowVersion

    // Build and apply the persisted transaction
    const tx = {
      txId: crypto.randomUUID(),
      term,
      seq,
      rowVersion,
      mutations: request.mutations.map((m) => ({
        type: m.type,
        key: m.key,
        value: m.value,
      })),
    }

    await this.withWriterLock(() =>
      this.requireAdapter().applyCommittedTx(collectionId, tx),
    )

    // Track envelope for dedup
    this.appliedEnvelopeIds.set(request.envelopeId, Date.now())
    this.pruneAppliedEnvelopeIds()

    // Broadcast tx:committed to all tabs
    const changedRows = request.mutations
      .filter((m) => m.type !== `delete`)
      .map((m) => ({ key: m.key, value: m.value }))
    const deletedKeys = request.mutations
      .filter((m) => m.type === `delete`)
      .map((m) => m.key)

    const txCommitted: ProtocolEnvelope<unknown> = {
      v: 1,
      dbName: this.dbName,
      collectionId,
      senderId: this.nodeId,
      ts: Date.now(),
      payload: {
        type: `tx:committed`,
        term,
        seq,
        txId: tx.txId,
        latestRowVersion: rowVersion,
        requiresFullReload: false,
        changedRows,
        deletedKeys,
      },
    }
    this.channel.postMessage(txCommitted)

    // Deliver to local subscribers too
    for (const subscriber of state.subscribers) {
      subscriber(txCommitted)
    }

    return {
      type: `rpc:applyLocalMutations:res`,
      rpcId: request.rpcId,
      ok: true,
      term,
      seq,
      latestRowVersion: rowVersion,
      acceptedMutationIds: request.mutations.map((m) => m.mutationId),
    }
  }

  private async handlePullSince(
    collectionId: string,
    request: {
      type: `rpc:pullSince:req`
      rpcId: string
      fromRowVersion: number
    },
  ): Promise<PullSinceResponse> {
    const state = this.collections.get(collectionId)

    const adapter = this.requireAdapter()
    if (!adapter.pullSince) {
      return {
        type: `rpc:pullSince:res`,
        rpcId: request.rpcId,
        ok: true,
        latestTerm: state?.latestTerm ?? 0,
        latestSeq: state?.latestSeq ?? 0,
        latestRowVersion: state?.latestRowVersion ?? 0,
        requiresFullReload: true,
      }
    }

    const result = await adapter.pullSince(
      collectionId,
      request.fromRowVersion,
    )

    if (result.requiresFullReload) {
      return {
        type: `rpc:pullSince:res`,
        rpcId: request.rpcId,
        ok: true,
        latestTerm: state?.latestTerm ?? 0,
        latestSeq: state?.latestSeq ?? 0,
        latestRowVersion: result.latestRowVersion,
        requiresFullReload: true,
      }
    }

    return {
      type: `rpc:pullSince:res`,
      rpcId: request.rpcId,
      ok: true,
      latestTerm: state?.latestTerm ?? 0,
      latestSeq: state?.latestSeq ?? 0,
      latestRowVersion: result.latestRowVersion,
      requiresFullReload: false,
      changedKeys: result.changedKeys,
      deletedKeys: result.deletedKeys,
    }
  }

  // -----------------------------------------------------------------------
  // DB Writer Lock (Workstream E)
  // -----------------------------------------------------------------------

  private async withWriterLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockName = `tsdb:writer:${this.dbName}`

    for (let attempt = 0; attempt <= WRITER_LOCK_MAX_RETRIES; attempt++) {
      try {
        return await navigator.locks.request(lockName, async () => fn())
      } catch (error) {
        if (error instanceof DOMException && error.name === `AbortError`) {
          throw error
        }

        if (attempt < WRITER_LOCK_MAX_RETRIES) {
          await sleep(WRITER_LOCK_BUSY_RETRY_MS * Math.min(attempt + 1, 5))
          continue
        }

        throw error
      }
    }

    // Unreachable but satisfies TypeScript
    throw new Error(`writer lock acquisition failed`)
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private pruneAppliedEnvelopeIds(): void {
    // Keep envelopes for 60 seconds for dedup
    const cutoff = Date.now() - 60_000
    for (const [id, ts] of this.appliedEnvelopeIds) {
      if (ts < cutoff) {
        this.appliedEnvelopeIds.delete(id)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isProtocolEnvelope(data: unknown): data is ProtocolEnvelope<unknown> {
  if (!data || typeof data !== `object`) return false
  const record = data as Record<string, unknown>
  return (
    record.v === 1 &&
    typeof record.dbName === `string` &&
    typeof record.collectionId === `string` &&
    typeof record.senderId === `string` &&
    typeof record.ts === `number`
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
