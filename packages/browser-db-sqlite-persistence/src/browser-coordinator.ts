import { safeRandomUUID } from '@tanstack/db-sqlite-persistence-core'
import type {
  ApplyLocalMutationsResponse,
  ApplyPersistedTransactionResponse,
  PersistedCollectionCoordinator,
  PersistedIndexSpec,
  PersistedMutationEnvelope,
  PersistedTx,
  PersistenceAdapter,
  PositionlessPersistedTx,
  ProtocolEnvelope,
  PullSinceResponse,
} from '@tanstack/db-sqlite-persistence-core'
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
const TARGETED_INVALIDATION_KEY_LIMIT = 128

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
      type: `rpc:applyPersistedTransaction:req`
      rpcId: string
      transaction: PositionlessPersistedTx
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
  | ApplyPersistedTransactionResponse
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
type AdapterWithPullSince = PersistenceAdapter & {
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

class LostLeadershipError extends Error {}

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
  private readonly nodeId = safeRandomUUID()
  private readonly dbName: string
  private adapter: AdapterWithPullSince | null
  private readonly channel: BroadcastChannel
  private readonly collections = new Map<string, CollectionState>()
  private readonly pendingRPCs = new Map<string, PendingRPC>()
  private readonly appliedEnvelopeIds = new Map<string, number>()
  private readonly appliedPersistedTransactions = new Map<
    string,
    {
      timestamp: number
      term: number
      seq: number
      latestRowVersion: number
    }
  >()
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

  publish(collectionId: string, message: ProtocolEnvelope<unknown>): void {
    this.observeEnvelopePosition(collectionId, message)
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
      rpcId: safeRandomUUID(),
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
      rpcId: safeRandomUUID(),
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
        rpcId: safeRandomUUID(),
        envelopeId: safeRandomUUID(),
        mutations,
      })
    }

    return this.sendRPC<ApplyLocalMutationsResponse>(collectionId, {
      type: `rpc:applyLocalMutations:req`,
      rpcId: safeRandomUUID(),
      envelopeId: safeRandomUUID(),
      mutations,
    })
  }

  async requestApplyPersistedTransaction(
    collectionId: string,
    transaction: PositionlessPersistedTx,
  ): Promise<ApplyPersistedTransactionResponse> {
    while (!this.isDisposed()) {
      const request = {
        type: `rpc:applyPersistedTransaction:req` as const,
        rpcId: safeRandomUUID(),
        transaction,
      }

      if (this.isLeader(collectionId)) {
        const response = await this.handleApplyPersistedTransaction(
          collectionId,
          request,
        )
        if (response.ok || response.code !== `NOT_LEADER`) return response
      } else {
        try {
          const response =
            await this.sendRPCOnce<ApplyPersistedTransactionResponse>(
              collectionId,
              request,
            )
          if (response.ok || response.code !== `NOT_LEADER`) return response
        } catch (error) {
          if (this.isDisposed()) throw error
        }
      }

      await sleep(RPC_RETRY_DELAY_MS)
    }

    throw new Error(`coordinator disposed`)
  }

  async pullSince(
    collectionId: string,
    fromRowVersion: number,
  ): Promise<PullSinceResponse> {
    if (this.isLeader(collectionId)) {
      return this.handlePullSince(collectionId, {
        type: `rpc:pullSince:req`,
        rpcId: safeRandomUUID(),
        fromRowVersion,
      })
    }

    return this.sendRPC<PullSinceResponse>(collectionId, {
      type: `rpc:pullSince:req`,
      rpcId: safeRandomUUID(),
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
              const pos = await adapter.getStreamPosition(collectionId)
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
    this.observeEnvelopePosition(envelope.collectionId, envelope)

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
        case `rpc:applyPersistedTransaction:req`:
          response = await this.handleApplyPersistedTransaction(
            collectionId,
            request,
          )
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
      this.requireAdapter().ensureIndex(
        collectionId,
        request.signature,
        request.spec,
      ),
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
    try {
      return await this.withWriterLock(async () => {
        if (this.appliedEnvelopeIds.has(request.envelopeId)) {
          return {
            type: `rpc:applyLocalMutations:res` as const,
            rpcId: request.rpcId,
            ok: false as const,
            code: `CONFLICT` as const,
            error: `envelope ${request.envelopeId} already applied`,
          }
        }

        const appliedTransaction =
          await this.applyPositionlessTransactionWithWriterLock(collectionId, {
            txId: safeRandomUUID(),
            mutations: request.mutations.map((mutation) => ({
              type: mutation.type,
              key: mutation.key,
              value: mutation.value,
            })),
          })
        const tx = appliedTransaction.tx

        this.appliedEnvelopeIds.set(request.envelopeId, Date.now())
        this.pruneAppliedEnvelopeIds()
        if (appliedTransaction.applied) {
          this.publishCommittedTransaction(collectionId, tx)
        }

        return {
          type: `rpc:applyLocalMutations:res` as const,
          rpcId: request.rpcId,
          ok: true as const,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
          acceptedMutationIds: request.mutations.map(
            (mutation) => mutation.mutationId,
          ),
        }
      })
    } catch (error) {
      if (!(error instanceof LostLeadershipError)) throw error
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `NOT_LEADER`,
        error: `not the leader for ${collectionId}`,
      }
    }
  }

  private async handleApplyPersistedTransaction(
    collectionId: string,
    request: {
      type: `rpc:applyPersistedTransaction:req`
      rpcId: string
      transaction: PositionlessPersistedTx
    },
  ): Promise<ApplyPersistedTransactionResponse> {
    try {
      return await this.withWriterLock(async () => {
        const transactionKey = `${collectionId}:${request.transaction.txId}`
        const prior = this.appliedPersistedTransactions.get(transactionKey)
        if (prior) {
          return {
            type: `rpc:applyPersistedTransaction:res`,
            rpcId: request.rpcId,
            ok: true,
            txId: request.transaction.txId,
            term: prior.term,
            seq: prior.seq,
            latestRowVersion: prior.latestRowVersion,
          }
        }

        const appliedTransaction =
          await this.applyPositionlessTransactionWithWriterLock(
            collectionId,
            request.transaction,
          )
        const tx = appliedTransaction.tx
        this.appliedPersistedTransactions.set(transactionKey, {
          timestamp: Date.now(),
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        })
        this.pruneAppliedEnvelopeIds()
        if (appliedTransaction.applied) {
          this.publishCommittedTransaction(collectionId, tx)
        }
        return {
          type: `rpc:applyPersistedTransaction:res`,
          rpcId: request.rpcId,
          ok: true,
          txId: tx.txId,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }
      })
    } catch (error) {
      if (!(error instanceof LostLeadershipError)) throw error
      return {
        type: `rpc:applyPersistedTransaction:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `NOT_LEADER`,
        error: `not the leader for ${collectionId}`,
      }
    }
  }

  /** Called only from inside the database writer lock. */
  private async applyPositionlessTransactionWithWriterLock(
    collectionId: string,
    transaction: PositionlessPersistedTx,
  ): Promise<{ tx: PersistedTx; applied: boolean }> {
    const state = this.collections.get(collectionId)
    if (!state?.isLeader) throw new LostLeadershipError()

    const adapter = this.requireAdapter()
    const proposedTx: PersistedTx = {
      ...transaction,
      term: state.latestTerm,
      seq: state.latestSeq + 1,
      rowVersion: state.latestRowVersion + 1,
    }

    const application = await adapter.applyCommittedTx(collectionId, proposedTx)
    const tx = application
      ? {
          ...proposedTx,
          term: application.term,
          seq: application.seq,
          rowVersion: application.rowVersion,
        }
      : proposedTx
    this.observeCollectionPosition(state, tx.term, tx.seq, tx.rowVersion)
    return { tx, applied: application?.applied ?? true }
  }

  private publishCommittedTransaction(
    collectionId: string,
    tx: PersistedTx,
  ): void {
    const changedRows = tx.mutations
      .filter((mutation) => mutation.type !== `delete`)
      .map((mutation) => ({ key: mutation.key, value: mutation.value }))
    const deletedKeys = tx.mutations
      .filter((mutation) => mutation.type === `delete`)
      .map((mutation) => mutation.key)
    const rowMetadataMutations = tx.rowMetadataMutations ?? []
    const collectionMetadataMutations = tx.collectionMetadataMutations ?? []
    const changedKeyCount =
      changedRows.length +
      deletedKeys.length +
      rowMetadataMutations.length +
      collectionMetadataMutations.length
    const requiresFullReload =
      tx.truncate === true ||
      changedKeyCount === 0 ||
      changedKeyCount > TARGETED_INVALIDATION_KEY_LIMIT
    const payload = requiresFullReload
      ? {
          type: `tx:committed` as const,
          term: tx.term,
          seq: tx.seq,
          txId: tx.txId,
          latestRowVersion: tx.rowVersion,
          requiresFullReload: true as const,
        }
      : {
          type: `tx:committed` as const,
          term: tx.term,
          seq: tx.seq,
          txId: tx.txId,
          latestRowVersion: tx.rowVersion,
          requiresFullReload: false as const,
          changedRows,
          deletedKeys,
          rowMetadataMutations,
          collectionMetadataMutations,
        }
    const envelope: ProtocolEnvelope<unknown> = {
      v: 1,
      dbName: this.dbName,
      collectionId,
      senderId: this.nodeId,
      ts: Date.now(),
      payload,
    }
    this.observeEnvelopePosition(collectionId, envelope)
    this.channel.postMessage(envelope)

    const state = this.collections.get(collectionId)
    for (const subscriber of state?.subscribers ?? []) {
      subscriber(envelope)
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

    const result = await adapter.pullSince(collectionId, request.fromRowVersion)

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
      const lockAttempt = { enteredCallback: false }
      try {
        return await navigator.locks.request(lockName, async () => {
          lockAttempt.enteredCallback = true
          return fn()
        })
      } catch (error) {
        // The lock request may transiently fail before entering the callback,
        // but adapter and application failures must never be replayed.
        if (lockAttempt.enteredCallback) throw error

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

  private observeEnvelopePosition(
    collectionId: string,
    envelope: ProtocolEnvelope<unknown>,
  ): void {
    const payload = envelope.payload
    if (!payload || typeof payload !== `object`) return
    const record = payload as Record<string, unknown>
    if (
      record.type !== `tx:committed` ||
      typeof record.term !== `number` ||
      typeof record.seq !== `number` ||
      typeof record.latestRowVersion !== `number` ||
      !Number.isFinite(record.term) ||
      !Number.isFinite(record.seq) ||
      !Number.isFinite(record.latestRowVersion)
    ) {
      return
    }

    const state = this.collections.get(collectionId)
    if (!state) return
    this.observeCollectionPosition(
      state,
      record.term,
      record.seq,
      record.latestRowVersion,
    )
  }

  private observeCollectionPosition(
    state: CollectionState,
    term: number,
    seq: number,
    rowVersion: number,
  ): void {
    if (
      term > state.latestTerm ||
      (term === state.latestTerm && seq > state.latestSeq)
    ) {
      state.latestTerm = term
      state.latestSeq = seq
    }
    state.latestRowVersion = Math.max(state.latestRowVersion, rowVersion)
  }

  private pruneAppliedEnvelopeIds(): void {
    // Keep envelopes for 60 seconds for dedup
    const cutoff = Date.now() - 60_000
    for (const [id, ts] of this.appliedEnvelopeIds) {
      if (ts < cutoff) {
        this.appliedEnvelopeIds.delete(id)
      }
    }
    for (const [txId, applied] of this.appliedPersistedTransactions) {
      if (applied.timestamp < cutoff) {
        this.appliedPersistedTransactions.delete(txId)
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
