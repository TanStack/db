import {
  DuplicateRemoteSubsetOwnerError,
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  RetryableRemoteSubsetAcquisitionError,
  safeRandomUUID,
  toPersistedCollectionDurabilityError,
  toTransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'
import type {
  ApplyCommittedTxRequest,
  ApplyCommittedTxResponse,
  ApplyLocalMutationsResponse,
  EnsureRemoteSubsetRequest,
  EnsureRemoteSubsetResponse,
  IndeterminateCommitRequestType,
  PersistedCollectionCoordinator,
  PersistedIndexSpec,
  PersistedMutationEnvelope,
  PersistedRowMetadataMutation,
  PersistedTx,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  ReleaseRemoteSubsetRequest,
  ReleaseRemoteSubsetResponse,
  RemoteSubsetOwner,
  TransportedLoadSubsetOptions,
  TxCommitted,
} from '@tanstack/db-sqlite-persistence-core'
import type { LoadSubsetOptions } from '@tanstack/db'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 3_000
const RPC_TIMEOUT_MS = 10_000
const RPC_RETRY_ATTEMPTS = 2
const RPC_RETRY_DELAY_MS = 200
const REMOTE_SUBSET_REPLAY_RETRY_ATTEMPTS = 2
const RPC_DEDUPE_RETENTION_MS = 60_000
const WRITER_LOCK_BUSY_RETRY_MS = 50
const WRITER_LOCK_MAX_RETRIES = 20

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type RPCRequest =
  | EnsureRemoteSubsetRequest
  | ReleaseRemoteSubsetRequest
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
  | ApplyCommittedTxRequest
  | {
      type: `rpc:pullSince:req`
      rpcId: string
      fromRowVersion: number
    }

type RPCResponse =
  | EnsureRemoteSubsetResponse
  | ReleaseRemoteSubsetResponse
  | {
      type: `rpc:ensurePersistedIndex:res`
      rpcId: string
      ok: boolean
      error?: string
    }
  | ApplyLocalMutationsResponse
  | ApplyCommittedTxResponse
  | PullSinceResponse

type PendingRPC = {
  resolve: (response: RPCResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CollectionState = {
  isLeader: boolean
  leaderId: string | null
  lockAbortController: AbortController | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  latestTerm: number
  latestSeq: number
  latestRowVersion: number
  subscribers: Set<(message: ProtocolEnvelope<unknown>) => void>
}

type ActiveRemoteSubsetAcquisition = {
  collectionId: string
  requesterId: string
  acquisitionId: string
  owner: RemoteSubsetOwner
  options: TransportedLoadSubsetOptions
  load: Promise<void>
  transferred: boolean
  released: boolean
  terminalRelease: boolean
  release: Promise<void> | null
}

type AwaitingRemoteSubsetOwnerAcquisition = {
  collectionId: string
  requesterId: string
  acquisitionId: string
  options: TransportedLoadSubsetOptions
  released: true
  awaitingOwner: true
}

type RemoteSubsetAcquisition =
  | ActiveRemoteSubsetAcquisition
  | AwaitingRemoteSubsetOwnerAcquisition
  | {
      collectionId: string
      requesterId: string
      acquisitionId: string
      released: true
    }

type OutboundRemoteSubsetAcquisition = {
  collectionId: string
  acquisitionId: string
  options: TransportedLoadSubsetOptions
  acquiredLeaderId: string | null
  inFlight: Promise<void> | null
  forceReplay: boolean
  retryTimer: ReturnType<typeof setTimeout> | null
  retryAttempts: number
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ElectronCollectionCoordinatorOptions = {
  dbName: string
  adapter?: AdapterWithPullSince
}

// ---------------------------------------------------------------------------
// ElectronCollectionCoordinator
// ---------------------------------------------------------------------------

export class ElectronCollectionCoordinator implements PersistedCollectionCoordinator {
  private readonly nodeId = safeRandomUUID()
  private readonly dbName: string
  private defaultAdapter: AdapterWithPullSince | null
  private readonly collectionAdapters = new Map<string, AdapterWithPullSince>()
  private readonly remoteSubsetOwners = new Map<string, RemoteSubsetOwner>()
  private readonly remoteSubsetIds = new Map<
    string,
    WeakMap<LoadSubsetOptions, string>
  >()
  private readonly outboundRemoteSubsetAcquisitions = new Map<
    string,
    OutboundRemoteSubsetAcquisition
  >()
  private readonly inboundRemoteSubsetAcquisitions = new Map<
    string,
    RemoteSubsetAcquisition
  >()
  private readonly releasedRemoteSubsetAcquisitionTimes = new Map<
    string,
    number
  >()
  private readonly channel: BroadcastChannel
  private readonly collections = new Map<string, CollectionState>()
  private readonly pendingRPCs = new Map<string, PendingRPC>()
  private readonly appliedEnvelopeIds = new Map<
    string,
    { appliedAt: number; response: ApplyLocalMutationsResponse }
  >()
  private readonly inFlightLocalMutationEnvelopes = new Map<
    string,
    Promise<ApplyLocalMutationsResponse>
  >()
  private readonly appliedCommittedTxEnvelopes = new Map<
    string,
    { appliedAt: number; response: ApplyCommittedTxResponse }
  >()
  private readonly inFlightCommittedTxEnvelopes = new Map<
    string,
    Promise<ApplyCommittedTxResponse>
  >()
  private disposed = false

  /** Method indirection to prevent TypeScript from narrowing `disposed` across awaits */
  private isDisposed(): boolean {
    return this.disposed
  }

  private requireAdapter(collectionId: string): AdapterWithPullSince {
    const adapter =
      this.collectionAdapters.get(collectionId) ?? this.defaultAdapter
    if (!adapter) {
      throw new Error(
        `ElectronCollectionCoordinator: adapter not set for collection "${collectionId}". Call setAdapterForCollection() before using leader-side operations.`,
      )
    }
    return adapter
  }

  constructor(options: ElectronCollectionCoordinatorOptions) {
    this.dbName = options.dbName
    this.defaultAdapter = options.adapter ?? null
    this.channel = new BroadcastChannel(`tsdb:coord:${this.dbName}`)
    this.channel.onmessage = (event: MessageEvent) => {
      this.onChannelMessage(event.data)
    }
  }

  /**
   * Set or replace the persistence adapter used for leader-side RPC handling.
   * Called by `createElectronSQLitePersistence` to wire the internally-created
   * adapter into the coordinator.
   */
  setAdapter(adapter: AdapterWithPullSince): void {
    this.defaultAdapter = adapter
  }

  setAdapterForCollection(
    collectionId: string,
    adapter: AdapterWithPullSince,
  ): void {
    this.collectionAdapters.set(collectionId, adapter)
  }

  registerRemoteSubsetOwner(
    collectionId: string,
    owner: RemoteSubsetOwner,
  ): () => void {
    if (this.remoteSubsetOwners.has(collectionId)) {
      throw new DuplicateRemoteSubsetOwnerError(collectionId)
    }
    this.remoteSubsetOwners.set(collectionId, owner)
    for (const acquisition of this.outboundRemoteSubsetAcquisitions.values()) {
      if (acquisition.collectionId !== collectionId) continue
      acquisition.acquiredLeaderId = null
      acquisition.forceReplay = true
    }
    void this.replayRemoteSubsetAcquisitions(collectionId)
    this.rebindRemoteInboundSubsetAcquisitions(collectionId, owner)
    return () => {
      if (this.remoteSubsetOwners.get(collectionId) !== owner) return
      this.remoteSubsetOwners.delete(collectionId)
      this.releaseInboundRemoteSubsetAcquisitions(collectionId, owner)
    }
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
    const transportedOptions = toTransportedLoadSubsetOptions(options)
    let collectionIds = this.remoteSubsetIds.get(collectionId)
    if (!collectionIds) {
      collectionIds = new WeakMap()
      this.remoteSubsetIds.set(collectionId, collectionIds)
    }
    let acquisitionId = collectionIds.get(options)
    let acquisition = acquisitionId
      ? this.outboundRemoteSubsetAcquisitions.get(
          remoteSubsetAcquisitionKey(collectionId, acquisitionId),
        )
      : undefined
    if (!acquisition) {
      acquisitionId = safeRandomUUID()
      collectionIds.set(options, acquisitionId)
      acquisition = {
        collectionId,
        acquisitionId,
        options: transportedOptions,
        acquiredLeaderId: null,
        inFlight: null,
        forceReplay: false,
        retryTimer: null,
        retryAttempts: 0,
      }
      this.outboundRemoteSubsetAcquisitions.set(
        remoteSubsetAcquisitionKey(collectionId, acquisitionId),
        acquisition,
      )
    }

    await this.acquireRemoteSubset(acquisition)
  }

  async requestReleaseRemoteSubset(
    collectionId: string,
    options: LoadSubsetOptions,
  ): Promise<void> {
    const collectionIds = this.remoteSubsetIds.get(collectionId)
    const acquisitionId = collectionIds?.get(options)
    if (!acquisitionId) return
    const key = remoteSubsetAcquisitionKey(collectionId, acquisitionId)
    const acquisition = this.outboundRemoteSubsetAcquisitions.get(key)
    if (!acquisition) return
    this.outboundRemoteSubsetAcquisitions.delete(key)
    this.cancelRemoteSubsetReplayRetry(acquisition)
    collectionIds!.delete(options)

    const request: Extract<
      RPCRequest,
      { type: `rpc:releaseRemoteSubset:req` }
    > = {
      type: `rpc:releaseRemoteSubset:req`,
      rpcId: safeRandomUUID(),
      acquisitionId,
    }
    const response = this.isLeader(collectionId)
      ? await this.handleReleaseRemoteSubset(collectionId, request, this.nodeId)
      : await this.sendRPC<ReleaseRemoteSubsetResponse>(collectionId, request)

    if (!response.ok) {
      throw new Error(`releaseRemoteSubset failed: ${response.error}`)
    }
  }

  private async acquireRemoteSubset(
    acquisition: OutboundRemoteSubsetAcquisition,
  ): Promise<void> {
    if (acquisition.inFlight) return acquisition.inFlight

    const routedToLocalOwner = this.isLeader(acquisition.collectionId)
    let resolveWork!: () => void
    let rejectWork!: (error: unknown) => void
    const work = new Promise<void>((resolve, reject) => {
      resolveWork = resolve
      rejectWork = reject
    })
    acquisition.inFlight = work
    const run = async (): Promise<void> => {
      const request: Extract<
        RPCRequest,
        { type: `rpc:ensureRemoteSubset:req` }
      > = {
        type: `rpc:ensureRemoteSubset:req`,
        rpcId: safeRandomUUID(),
        acquisitionId: acquisition.acquisitionId,
        options: acquisition.options,
      }
      let response: EnsureRemoteSubsetResponse
      try {
        response = routedToLocalOwner
          ? await this.handleEnsureRemoteSubset(
              acquisition.collectionId,
              request,
              this.nodeId,
            )
          : await this.sendRPC<EnsureRemoteSubsetResponse>(
              acquisition.collectionId,
              request,
            )
      } catch (error) {
        if (
          routedToLocalOwner ||
          error instanceof RetryableRemoteSubsetAcquisitionError
        ) {
          throw error
        }
        throw new RetryableRemoteSubsetAcquisitionError(
          `Remote subset transport failed`,
          error,
        )
      }

      if (!response.ok) {
        if (response.retryable) {
          throw new RetryableRemoteSubsetAcquisitionError(response.error)
        }
        throw new Error(`ensureRemoteSubset failed: ${response.error}`)
      }
      acquisition.acquiredLeaderId = response.leaderId
    }
    void run().then(resolveWork, rejectWork)
    let acquired = false
    try {
      await work
      acquired = true
      this.cancelRemoteSubsetReplayRetry(acquisition)
    } finally {
      if (acquisition.inFlight === work) acquisition.inFlight = null
      const current = this.collections.get(acquisition.collectionId)
      const currentLeaderId = current?.isLeader
        ? this.nodeId
        : (current?.leaderId ?? null)
      const key = remoteSubsetAcquisitionKey(
        acquisition.collectionId,
        acquisition.acquisitionId,
      )
      if (
        acquired &&
        this.outboundRemoteSubsetAcquisitions.get(key) === acquisition &&
        (acquisition.forceReplay ||
          (currentLeaderId !== null &&
            acquisition.acquiredLeaderId !== currentLeaderId))
      ) {
        acquisition.forceReplay = false
        void this.acquireRemoteSubset(acquisition).catch((error) => {
          this.scheduleRemoteSubsetReplayRetry(acquisition, error)
        })
      }
    }
  }

  async requestEnsurePersistedIndex(
    collectionId: string,
    signature: string,
    spec: PersistedIndexSpec,
  ): Promise<void> {
    if (this.isLeader(collectionId)) {
      await this.requireAdapter(collectionId).ensureIndex(
        collectionId,
        signature,
        spec,
      )
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

  async requestApplyCommittedTx(
    collectionId: string,
    tx: PersistedTx,
  ): Promise<ApplyCommittedTxResponse> {
    const request: ApplyCommittedTxRequest = {
      type: `rpc:applyCommittedTx:req`,
      rpcId: safeRandomUUID(),
      envelopeId: safeRandomUUID(),
      tx,
    }
    if (this.isLeader(collectionId)) {
      return this.handleApplyCommittedTx(collectionId, request)
    }

    return this.sendRPC<ApplyCommittedTxResponse>(collectionId, request)
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

    for (const acquisition of this.outboundRemoteSubsetAcquisitions.values()) {
      this.cancelRemoteSubsetReplayRetry(acquisition)
      this.postRemoteSubsetRelease(acquisition)
    }
    this.outboundRemoteSubsetAcquisitions.clear()
    this.remoteSubsetIds.clear()

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
    this.collectionAdapters.clear()
    for (const collectionId of this.remoteSubsetOwners.keys()) {
      this.releaseInboundRemoteSubsetAcquisitions(collectionId)
    }
    this.remoteSubsetOwners.clear()
    this.inboundRemoteSubsetAcquisitions.clear()
    this.releasedRemoteSubsetAcquisitionTimes.clear()
    this.appliedEnvelopeIds.clear()
    this.inFlightLocalMutationEnvelopes.clear()
    this.appliedCommittedTxEnvelopes.clear()
    this.inFlightCommittedTxEnvelopes.clear()
  }

  // -----------------------------------------------------------------------
  // Leadership via Web Locks
  // -----------------------------------------------------------------------

  private ensureCollectionState(collectionId: string): CollectionState {
    let state = this.collections.get(collectionId)
    if (!state) {
      state = {
        isLeader: false,
        leaderId: null,
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
            const adapter = this.requireAdapter(collectionId)
            if (adapter.getStreamPosition) {
              const pos = await adapter.getStreamPosition(collectionId)
              state.latestTerm = pos.latestTerm
              state.latestSeq = pos.latestSeq
              state.latestRowVersion = pos.latestRowVersion
            }

            state.latestTerm++
            state.isLeader = true
            state.leaderId = this.nodeId

            this.emitHeartbeat(collectionId, state)
            void this.replayRemoteSubsetAcquisitions(collectionId)
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
            this.releaseInboundRemoteSubsetAcquisitions(collectionId)
            state.isLeader = false
            state.leaderId = null
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
    collectionId: string,
    state: CollectionState,
  ): void {
    this.releaseInboundRemoteSubsetAcquisitions(collectionId)
    if (state.lockAbortController) {
      state.lockAbortController.abort()
      state.lockAbortController = null
    }
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer)
      state.heartbeatTimer = null
    }
    state.isLeader = false
    state.leaderId = null
  }

  private postRemoteSubsetRelease(
    acquisition: OutboundRemoteSubsetAcquisition,
  ): void {
    const request: Extract<
      RPCRequest,
      { type: `rpc:releaseRemoteSubset:req` }
    > = {
      type: `rpc:releaseRemoteSubset:req`,
      rpcId: safeRandomUUID(),
      acquisitionId: acquisition.acquisitionId,
    }
    if (this.isLeader(acquisition.collectionId)) {
      void this.handleReleaseRemoteSubset(
        acquisition.collectionId,
        request,
        this.nodeId,
      ).catch(() => {
        // The owner already received the exact unload failure through onError.
      })
      return
    }
    this.channel.postMessage({
      v: 1,
      dbName: this.dbName,
      collectionId: acquisition.collectionId,
      senderId: this.nodeId,
      ts: Date.now(),
      payload: request,
    } satisfies ProtocolEnvelope<unknown>)
  }

  private cancelRemoteSubsetReplayRetry(
    acquisition: OutboundRemoteSubsetAcquisition,
  ): void {
    if (acquisition.retryTimer !== null) {
      clearTimeout(acquisition.retryTimer)
      acquisition.retryTimer = null
    }
    acquisition.retryAttempts = 0
  }

  private scheduleRemoteSubsetReplayRetry(
    acquisition: OutboundRemoteSubsetAcquisition,
    error: unknown,
  ): void {
    const key = remoteSubsetAcquisitionKey(
      acquisition.collectionId,
      acquisition.acquisitionId,
    )
    if (
      !(error instanceof RetryableRemoteSubsetAcquisitionError) ||
      this.isDisposed() ||
      this.outboundRemoteSubsetAcquisitions.get(key) !== acquisition ||
      acquisition.retryTimer !== null ||
      acquisition.retryAttempts >= REMOTE_SUBSET_REPLAY_RETRY_ATTEMPTS
    ) {
      return
    }

    acquisition.retryAttempts++
    acquisition.retryTimer = setTimeout(() => {
      acquisition.retryTimer = null
      if (
        this.isDisposed() ||
        this.outboundRemoteSubsetAcquisitions.get(key) !== acquisition
      ) {
        return
      }
      void this.acquireRemoteSubset(acquisition).catch((retryError) => {
        this.scheduleRemoteSubsetReplayRetry(acquisition, retryError)
      })
    }, RPC_RETRY_DELAY_MS)
  }

  private async replayRemoteSubsetAcquisitions(
    collectionId: string,
  ): Promise<void> {
    if (this.isDisposed()) return
    const state = this.collections.get(collectionId)
    const leaderId = state?.isLeader ? this.nodeId : state?.leaderId
    if (!leaderId) return

    const replays: Array<Promise<void>> = []
    for (const acquisition of this.outboundRemoteSubsetAcquisitions.values()) {
      if (
        acquisition.collectionId !== collectionId ||
        (!acquisition.forceReplay && acquisition.acquiredLeaderId === leaderId)
      ) {
        continue
      }
      if (acquisition.inFlight) {
        acquisition.forceReplay = true
        continue
      }
      acquisition.forceReplay = false
      replays.push(
        this.acquireRemoteSubset(acquisition).catch((error) => {
          this.scheduleRemoteSubsetReplayRetry(acquisition, error)
        }),
      )
    }
    await Promise.all(replays)
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

    if (type === `leader:heartbeat`) {
      const heartbeat = payload as {
        leaderId?: unknown
        term?: unknown
        latestSeq?: unknown
        latestRowVersion?: unknown
      }
      if (
        typeof heartbeat.leaderId === `string` &&
        typeof heartbeat.term === `number` &&
        typeof heartbeat.latestSeq === `number` &&
        typeof heartbeat.latestRowVersion === `number`
      ) {
        const state = this.ensureCollectionState(envelope.collectionId)
        if (heartbeat.term < state.latestTerm) return
        const changedLeader = state.leaderId !== heartbeat.leaderId
        state.leaderId = heartbeat.leaderId
        state.latestTerm = Math.max(state.latestTerm, heartbeat.term)
        state.latestSeq = Math.max(state.latestSeq, heartbeat.latestSeq)
        state.latestRowVersion = Math.max(
          state.latestRowVersion,
          heartbeat.latestRowVersion,
        )
        if (changedLeader) {
          void this.replayRemoteSubsetAcquisitions(envelope.collectionId)
        }
      }
    }

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
        void this.handleRPCRequest(
          collectionId,
          payload as RPCRequest,
          envelope.senderId,
        )
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
    let firstTransportCause: unknown
    const mutationRequestType = isMutatingRPCRequest(request)
      ? request.type
      : undefined
    const mutationRoute = mutationRequestType
      ? this.captureMutationRoute(collectionId)
      : undefined

    for (let attempt = 0; attempt <= RPC_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(RPC_RETRY_DELAY_MS * attempt)
      }

      if (
        mutationRoute &&
        mutationRequestType &&
        firstTransportCause !== undefined
      ) {
        this.assertMutationRouteUnchanged(
          collectionId,
          mutationRequestType,
          mutationRoute,
          firstTransportCause,
        )
      }

      if (this.isLeader(collectionId)) {
        return (await this.dispatchRPCRequest(
          collectionId,
          request,
          this.nodeId,
        )) as T
      }

      try {
        return await this.sendRPCOnce<T>(collectionId, request)
      } catch (error) {
        if (this.isDisposed()) throw error
        firstTransportCause ??= error
        if (mutationRoute && mutationRequestType) {
          this.assertMutationRouteUnchanged(
            collectionId,
            mutationRequestType,
            mutationRoute,
            firstTransportCause,
          )
        }
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }

    throw lastError ?? new Error(`RPC failed after retries`)
  }

  private captureMutationRoute(collectionId: string): {
    leaderId: string | null
    term: number | null
  } {
    const state = this.collections.get(collectionId)
    return {
      leaderId: state?.isLeader ? this.nodeId : (state?.leaderId ?? null),
      term: state?.latestTerm ?? null,
    }
  }

  private assertMutationRouteUnchanged(
    collectionId: string,
    requestType: IndeterminateCommitRequestType,
    previous: { leaderId: string | null; term: number | null },
    cause: unknown,
  ): void {
    const current = this.captureMutationRoute(collectionId)
    if (
      previous.leaderId !== null &&
      previous.term !== null &&
      current.leaderId === previous.leaderId &&
      current.term === previous.term
    ) {
      return
    }
    throw new IndeterminateCommitError({
      collectionId,
      requestType,
      previousLeaderId: previous.leaderId,
      previousTerm: previous.term,
      currentLeaderId: current.leaderId,
      currentTerm: current.term,
      cause,
    })
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
    requesterId: string,
  ): Promise<void> {
    let response: RPCResponse

    try {
      response = await this.dispatchRPCRequest(
        collectionId,
        request,
        requesterId,
      )
    } catch (error) {
      response = createRPCErrorResponse(request, error)
    }

    if (this.isDisposed()) {
      return
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

  private dispatchRPCRequest(
    collectionId: string,
    request: RPCRequest,
    requesterId: string,
  ): Promise<RPCResponse> {
    switch (request.type) {
      case `rpc:ensureRemoteSubset:req`:
        return this.handleEnsureRemoteSubset(collectionId, request, requesterId)
      case `rpc:releaseRemoteSubset:req`:
        return this.handleReleaseRemoteSubset(
          collectionId,
          request,
          requesterId,
        )
      case `rpc:ensurePersistedIndex:req`:
        return this.handleEnsurePersistedIndex(collectionId, request)
      case `rpc:applyLocalMutations:req`:
        return this.handleApplyLocalMutations(collectionId, request)
      case `rpc:applyCommittedTx:req`:
        return this.handleApplyCommittedTx(collectionId, request)
      case `rpc:pullSince:req`:
        return this.handlePullSince(collectionId, request)
    }
  }

  private async handleEnsureRemoteSubset(
    collectionId: string,
    request: Extract<RPCRequest, { type: `rpc:ensureRemoteSubset:req` }>,
    requesterId: string,
  ): Promise<EnsureRemoteSubsetResponse> {
    this.pruneReleasedRemoteSubsetAcquisitions()
    const key = inboundRemoteSubsetAcquisitionKey(
      collectionId,
      requesterId,
      request.acquisitionId,
    )
    const existing = this.inboundRemoteSubsetAcquisitions.get(key)
    const awaitingOwner =
      existing && `awaitingOwner` in existing ? existing : undefined
    if (existing) {
      if (`owner` in existing) {
        if (!existing.released) {
          await existing.load
          return {
            type: `rpc:ensureRemoteSubset:res`,
            rpcId: request.rpcId,
            ok: true,
            leaderId: this.nodeId,
          }
        }
        await existing.release
        if (existing.terminalRelease) {
          return {
            type: `rpc:ensureRemoteSubset:res`,
            rpcId: request.rpcId,
            ok: true,
            leaderId: this.nodeId,
          }
        }
        if (this.inboundRemoteSubsetAcquisitions.get(key) === existing) {
          this.inboundRemoteSubsetAcquisitions.delete(key)
        }
      } else if (!(`awaitingOwner` in existing)) {
        return {
          type: `rpc:ensureRemoteSubset:res`,
          rpcId: request.rpcId,
          ok: true,
          leaderId: this.nodeId,
        }
      }
    }

    const owner = this.remoteSubsetOwners.get(collectionId)
    if (!owner) {
      throw new RetryableRemoteSubsetAcquisitionError(
        `ElectronCollectionCoordinator: no remote subset owner registered for collection "${collectionId}"`,
      )
    }

    const acquisition: ActiveRemoteSubsetAcquisition = {
      collectionId,
      requesterId,
      acquisitionId: request.acquisitionId,
      owner,
      options: awaitingOwner?.options ?? request.options,
      load: Promise.resolve(),
      transferred: false,
      released: false,
      terminalRelease: false,
      release: null,
    }
    this.releasedRemoteSubsetAcquisitionTimes.delete(key)
    this.inboundRemoteSubsetAcquisitions.set(key, acquisition)
    let resolveLoad!: () => void
    let rejectLoad!: (error: unknown) => void
    acquisition.load = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve
      rejectLoad = reject
    })
    try {
      const load = owner(acquisition.options)
      acquisition.transferred = true
      void Promise.resolve(load).then(resolveLoad, rejectLoad)
    } catch (error) {
      rejectLoad(error)
    }
    try {
      await acquisition.load
    } catch (error) {
      if (
        !acquisition.transferred &&
        this.inboundRemoteSubsetAcquisitions.get(key) === acquisition
      ) {
        if (awaitingOwner) {
          this.inboundRemoteSubsetAcquisitions.set(key, awaitingOwner)
        } else {
          this.inboundRemoteSubsetAcquisitions.delete(key)
        }
      }
      reportRemoteSubsetOwnerError(owner, error)
      throw error
    }
    return {
      type: `rpc:ensureRemoteSubset:res`,
      rpcId: request.rpcId,
      ok: true,
      leaderId: this.nodeId,
    }
  }

  private async handleReleaseRemoteSubset(
    collectionId: string,
    request: Extract<RPCRequest, { type: `rpc:releaseRemoteSubset:req` }>,
    requesterId: string,
  ): Promise<ReleaseRemoteSubsetResponse> {
    this.pruneReleasedRemoteSubsetAcquisitions()
    const key = inboundRemoteSubsetAcquisitionKey(
      collectionId,
      requesterId,
      request.acquisitionId,
    )
    const acquisition = this.inboundRemoteSubsetAcquisitions.get(key)
    if (!acquisition) {
      this.setReleasedRemoteSubsetAcquisition(key, {
        collectionId,
        requesterId,
        acquisitionId: request.acquisitionId,
        released: true,
      })
    } else if (`owner` in acquisition) {
      acquisition.terminalRelease = true
      await this.releaseRemoteSubsetAcquisition(acquisition)
      if (this.inboundRemoteSubsetAcquisitions.get(key) === acquisition) {
        this.setReleasedRemoteSubsetAcquisition(key, {
          collectionId,
          requesterId,
          acquisitionId: request.acquisitionId,
          released: true,
        })
      }
    } else if (`awaitingOwner` in acquisition) {
      this.setReleasedRemoteSubsetAcquisition(key, {
        collectionId,
        requesterId,
        acquisitionId: request.acquisitionId,
        released: true,
      })
    }
    return {
      type: `rpc:releaseRemoteSubset:res`,
      rpcId: request.rpcId,
      ok: true,
    }
  }

  private releaseRemoteSubsetAcquisition(
    acquisition: ActiveRemoteSubsetAcquisition,
  ): Promise<void> {
    if (acquisition.release) return acquisition.release
    acquisition.released = true
    acquisition.release = (async () => {
      try {
        await acquisition.load
      } catch {
        // A returned promise transfers the lease even when initial loading fails.
      }
      try {
        if (acquisition.transferred) {
          await unloadRemoteSubsetOwner(acquisition.owner, acquisition.options)
        }
      } finally {
        if (!acquisition.terminalRelease) {
          const key = inboundRemoteSubsetAcquisitionKey(
            acquisition.collectionId,
            acquisition.requesterId,
            acquisition.acquisitionId,
          )
          if (this.inboundRemoteSubsetAcquisitions.get(key) === acquisition) {
            this.inboundRemoteSubsetAcquisitions.set(key, {
              collectionId: acquisition.collectionId,
              requesterId: acquisition.requesterId,
              acquisitionId: acquisition.acquisitionId,
              options: acquisition.options,
              released: true,
              awaitingOwner: true,
            })
          }
        }
      }
    })()
    return acquisition.release
  }

  private releaseInboundRemoteSubsetAcquisitions(
    collectionId: string,
    owner?: RemoteSubsetOwner,
  ): void {
    for (const acquisition of this.inboundRemoteSubsetAcquisitions.values()) {
      if (
        !(`owner` in acquisition) ||
        acquisition.collectionId !== collectionId ||
        (owner && acquisition.owner !== owner)
      ) {
        continue
      }
      void this.releaseRemoteSubsetAcquisition(acquisition).catch(
        () => undefined,
      )
    }
  }

  private rebindRemoteInboundSubsetAcquisitions(
    collectionId: string,
    owner: RemoteSubsetOwner,
  ): void {
    for (const acquisition of this.inboundRemoteSubsetAcquisitions.values()) {
      if (`awaitingOwner` in acquisition) {
        if (
          acquisition.collectionId === collectionId &&
          acquisition.requesterId !== this.nodeId
        ) {
          void this.bindAwaitingRemoteSubsetAcquisition(
            acquisition,
            owner,
          ).catch(() => {
            // The owner receives the exact load failure through onError.
          })
        }
        continue
      }
      if (
        !(`owner` in acquisition) ||
        acquisition.collectionId !== collectionId ||
        acquisition.requesterId === this.nodeId ||
        !acquisition.released ||
        acquisition.terminalRelease
      ) {
        continue
      }

      void this.rebindRemoteInboundSubsetAcquisition(acquisition, owner).catch(
        () => undefined,
      )
    }
  }

  private async rebindRemoteInboundSubsetAcquisition(
    previous: ActiveRemoteSubsetAcquisition,
    owner: RemoteSubsetOwner,
  ): Promise<void> {
    await previous.release
    if (
      previous.terminalRelease ||
      this.remoteSubsetOwners.get(previous.collectionId) !== owner
    ) {
      return
    }

    const key = inboundRemoteSubsetAcquisitionKey(
      previous.collectionId,
      previous.requesterId,
      previous.acquisitionId,
    )
    const current = this.inboundRemoteSubsetAcquisitions.get(key)
    if (current && current !== previous) {
      if (`awaitingOwner` in current) {
        await this.bindAwaitingRemoteSubsetAcquisition(current, owner)
      }
      return
    }

    const awaitingOwner: AwaitingRemoteSubsetOwnerAcquisition = {
      collectionId: previous.collectionId,
      requesterId: previous.requesterId,
      acquisitionId: previous.acquisitionId,
      options: previous.options,
      released: true,
      awaitingOwner: true,
    }
    this.inboundRemoteSubsetAcquisitions.set(key, awaitingOwner)
    await this.bindAwaitingRemoteSubsetAcquisition(awaitingOwner, owner)
  }

  private async bindAwaitingRemoteSubsetAcquisition(
    awaitingOwner: AwaitingRemoteSubsetOwnerAcquisition,
    owner: RemoteSubsetOwner,
  ): Promise<void> {
    if (this.remoteSubsetOwners.get(awaitingOwner.collectionId) !== owner) {
      return
    }
    const key = inboundRemoteSubsetAcquisitionKey(
      awaitingOwner.collectionId,
      awaitingOwner.requesterId,
      awaitingOwner.acquisitionId,
    )
    if (this.inboundRemoteSubsetAcquisitions.get(key) !== awaitingOwner) return

    const acquisition: ActiveRemoteSubsetAcquisition = {
      collectionId: awaitingOwner.collectionId,
      requesterId: awaitingOwner.requesterId,
      acquisitionId: awaitingOwner.acquisitionId,
      owner,
      options: awaitingOwner.options,
      load: Promise.resolve(),
      transferred: false,
      released: false,
      terminalRelease: false,
      release: null,
    }
    this.inboundRemoteSubsetAcquisitions.set(key, acquisition)
    let resolveLoad!: () => void
    let rejectLoad!: (error: unknown) => void
    acquisition.load = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve
      rejectLoad = reject
    })
    try {
      const load = owner(acquisition.options)
      acquisition.transferred = true
      void Promise.resolve(load).then(resolveLoad, rejectLoad)
    } catch (error) {
      rejectLoad(error)
    }
    try {
      await acquisition.load
    } catch (error) {
      if (
        !acquisition.transferred &&
        this.inboundRemoteSubsetAcquisitions.get(key) === acquisition
      ) {
        this.inboundRemoteSubsetAcquisitions.set(key, awaitingOwner)
      }
      reportRemoteSubsetOwnerError(owner, error)
      throw error
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
      this.requireAdapter(collectionId).ensureIndex(
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
    const envelopeKey = appliedEnvelopeKey(collectionId, request.envelopeId)
    const appliedEnvelope = this.appliedEnvelopeIds.get(envelopeKey)
    if (appliedEnvelope) {
      return { ...appliedEnvelope.response, rpcId: request.rpcId }
    }

    const inFlightEnvelope =
      this.inFlightLocalMutationEnvelopes.get(envelopeKey)
    if (inFlightEnvelope) {
      const response = await inFlightEnvelope
      return { ...response, rpcId: request.rpcId }
    }

    const response = this.applyLocalMutationsOnce(collectionId, request)
    this.inFlightLocalMutationEnvelopes.set(envelopeKey, response)
    try {
      return await response
    } finally {
      if (this.inFlightLocalMutationEnvelopes.get(envelopeKey) === response) {
        this.inFlightLocalMutationEnvelopes.delete(envelopeKey)
      }
    }
  }

  private async applyLocalMutationsOnce(
    collectionId: string,
    request: {
      type: `rpc:applyLocalMutations:req`
      rpcId: string
      envelopeId: string
      mutations: Array<PersistedMutationEnvelope>
    },
  ): Promise<ApplyLocalMutationsResponse> {
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
    const rowMetadataMutations: Array<PersistedRowMetadataMutation> = []
    for (const mutation of request.mutations) {
      if (!(`metadataChanged` in mutation) || !mutation.metadataChanged) {
        continue
      }
      rowMetadataMutations.push(
        mutation.metadata === undefined
          ? { type: `delete`, key: mutation.key }
          : {
              type: `set`,
              key: mutation.key,
              value: mutation.metadata,
            },
      )
    }
    const tx = {
      txId: safeRandomUUID(),
      term,
      seq,
      rowVersion,
      mutations: request.mutations.map((m) => ({
        type: m.type,
        key: m.key,
        value: m.value,
        ...(`metadataChanged` in m
          ? { metadata: m.metadata, metadataChanged: m.metadataChanged }
          : {}),
      })),
      rowMetadataMutations,
    }

    try {
      await this.withWriterLock(() =>
        this.requireAdapter(collectionId).applyCommittedTx(collectionId, tx),
      )
    } catch (error) {
      throw toPersistedCollectionDurabilityError(collectionId, error)
    }

    const response: ApplyLocalMutationsResponse = {
      type: `rpc:applyLocalMutations:res`,
      rpcId: request.rpcId,
      ok: true,
      term,
      seq,
      latestRowVersion: rowVersion,
      acceptedMutationIds: request.mutations.map((m) => m.mutationId),
    }
    if (this.isDisposed()) {
      return response
    }

    this.appliedEnvelopeIds.set(
      appliedEnvelopeKey(collectionId, request.envelopeId),
      { appliedAt: Date.now(), response },
    )
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
        rowMetadataMutations,
      },
    }
    this.channel.postMessage(txCommitted)

    // Deliver to local subscribers too
    for (const subscriber of state.subscribers) {
      subscriber(txCommitted)
    }

    return response
  }

  private async handleApplyCommittedTx(
    collectionId: string,
    request: ApplyCommittedTxRequest,
  ): Promise<ApplyCommittedTxResponse> {
    const envelopeKey = appliedEnvelopeKey(collectionId, request.envelopeId)
    const appliedEnvelope = this.appliedCommittedTxEnvelopes.get(envelopeKey)
    if (appliedEnvelope) {
      return { ...appliedEnvelope.response, rpcId: request.rpcId }
    }

    const inFlightEnvelope = this.inFlightCommittedTxEnvelopes.get(envelopeKey)
    if (inFlightEnvelope) {
      const response = await inFlightEnvelope
      return { ...response, rpcId: request.rpcId }
    }

    const response = this.applyCommittedTxOnce(collectionId, request)
    this.inFlightCommittedTxEnvelopes.set(envelopeKey, response)
    try {
      return await response
    } finally {
      if (this.inFlightCommittedTxEnvelopes.get(envelopeKey) === response) {
        this.inFlightCommittedTxEnvelopes.delete(envelopeKey)
      }
    }
  }

  private async applyCommittedTxOnce(
    collectionId: string,
    request: ApplyCommittedTxRequest,
  ): Promise<ApplyCommittedTxResponse> {
    const state = this.collections.get(collectionId)
    if (!state || !state.isLeader) {
      return {
        type: `rpc:applyCommittedTx:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `NOT_LEADER`,
        error: `not the leader for ${collectionId}`,
      }
    }

    state.latestSeq++
    state.latestRowVersion++
    const tx: PersistedTx = {
      ...request.tx,
      term: state.latestTerm,
      seq: state.latestSeq,
      rowVersion: state.latestRowVersion,
    }

    try {
      await this.withWriterLock(() =>
        this.requireAdapter(collectionId).applyCommittedTx(collectionId, tx),
      )
    } catch (error) {
      throw toPersistedCollectionDurabilityError(collectionId, error)
    }

    const response: ApplyCommittedTxResponse = {
      type: `rpc:applyCommittedTx:res`,
      rpcId: request.rpcId,
      ok: true,
      term: tx.term,
      seq: tx.seq,
      latestRowVersion: tx.rowVersion,
    }
    if (this.isDisposed()) {
      return response
    }
    this.appliedCommittedTxEnvelopes.set(
      appliedEnvelopeKey(collectionId, request.envelopeId),
      { appliedAt: Date.now(), response },
    )
    this.pruneAppliedEnvelopeIds()

    const committedBase = {
      type: `tx:committed` as const,
      term: tx.term,
      seq: tx.seq,
      txId: tx.txId,
      latestRowVersion: tx.rowVersion,
    }
    const committedPayload: TxCommitted = tx.truncate
      ? { ...committedBase, requiresFullReload: true }
      : {
          ...committedBase,
          requiresFullReload: false,
          changedRows: tx.mutations
            .filter((mutation) => mutation.type !== `delete`)
            .map((mutation) => ({
              key: mutation.key,
              value: mutation.value,
            })),
          deletedKeys: tx.mutations
            .filter((mutation) => mutation.type === `delete`)
            .map((mutation) => mutation.key),
          rowMetadataMutations: tx.rowMetadataMutations,
          collectionMetadataMutations: tx.collectionMetadataMutations,
        }
    const committed: ProtocolEnvelope<TxCommitted> = {
      v: 1,
      dbName: this.dbName,
      collectionId,
      senderId: this.nodeId,
      ts: Date.now(),
      payload: committedPayload,
    }
    this.channel.postMessage(committed)
    for (const subscriber of state.subscribers) {
      subscriber(committed)
    }

    return response
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

    const adapter = this.requireAdapter(collectionId)
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
  // DB Writer Lock
  // -----------------------------------------------------------------------

  private async withWriterLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockName = `tsdb:writer:${this.dbName}`

    for (let attempt = 0; attempt <= WRITER_LOCK_MAX_RETRIES; attempt++) {
      const callbackState = { entered: false }
      try {
        return await navigator.locks.request(lockName, async () => {
          callbackState.entered = true
          return fn()
        })
      } catch (error) {
        if (callbackState.entered) {
          throw error
        }
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
    const cutoff = Date.now() - RPC_DEDUPE_RETENTION_MS
    for (const [id, envelope] of this.appliedEnvelopeIds) {
      if (envelope.appliedAt < cutoff) {
        this.appliedEnvelopeIds.delete(id)
      }
    }
    for (const [key, envelope] of this.appliedCommittedTxEnvelopes) {
      if (envelope.appliedAt < cutoff) {
        this.appliedCommittedTxEnvelopes.delete(key)
      }
    }
  }

  private setReleasedRemoteSubsetAcquisition(
    key: string,
    acquisition: RemoteSubsetAcquisition,
  ): void {
    this.inboundRemoteSubsetAcquisitions.set(key, acquisition)
    this.releasedRemoteSubsetAcquisitionTimes.set(key, Date.now())
  }

  private pruneReleasedRemoteSubsetAcquisitions(): void {
    const cutoff = Date.now() - RPC_DEDUPE_RETENTION_MS
    for (const [key, releasedAt] of this.releasedRemoteSubsetAcquisitionTimes) {
      if (releasedAt < cutoff) {
        this.releasedRemoteSubsetAcquisitionTimes.delete(key)
        this.inboundRemoteSubsetAcquisitions.delete(key)
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

async function unloadRemoteSubsetOwner(
  owner: RemoteSubsetOwner,
  options: TransportedLoadSubsetOptions,
): Promise<void> {
  try {
    const result = (
      owner.unloadSubset as unknown as (
        options: TransportedLoadSubsetOptions,
      ) => unknown
    )(options)
    await Promise.resolve(result)
  } catch (error) {
    reportRemoteSubsetOwnerError(owner, error)
    throw error
  }
}

function reportRemoteSubsetOwnerError(
  owner: RemoteSubsetOwner,
  error: unknown,
): void {
  try {
    owner.onError(error)
  } catch {
    // Reporting must not replace the original owner failure.
  }
}

function appliedEnvelopeKey(collectionId: string, envelopeId: string): string {
  return JSON.stringify([collectionId, envelopeId])
}

function remoteSubsetAcquisitionKey(
  collectionId: string,
  acquisitionId: string,
): string {
  return JSON.stringify([collectionId, acquisitionId])
}

function inboundRemoteSubsetAcquisitionKey(
  collectionId: string,
  requesterId: string,
  acquisitionId: string,
): string {
  return JSON.stringify([collectionId, requesterId, acquisitionId])
}

function createRPCErrorResponse(
  request: RPCRequest,
  cause: unknown,
): RPCResponse {
  const error = cause instanceof Error ? cause.message : String(cause)
  switch (request.type) {
    case `rpc:ensureRemoteSubset:req`:
      return {
        type: `rpc:ensureRemoteSubset:res`,
        rpcId: request.rpcId,
        ok: false,
        error,
        ...(cause instanceof RetryableRemoteSubsetAcquisitionError
          ? { retryable: true as const }
          : {}),
      }
    case `rpc:releaseRemoteSubset:req`:
      return {
        type: `rpc:releaseRemoteSubset:res`,
        rpcId: request.rpcId,
        ok: false,
        error,
      }
    case `rpc:ensurePersistedIndex:req`:
      return {
        type: `rpc:ensurePersistedIndex:res`,
        rpcId: request.rpcId,
        ok: false,
        error,
      }
    case `rpc:applyLocalMutations:req`:
      if (cause instanceof PersistedCollectionDurabilityError) {
        return {
          type: `rpc:applyLocalMutations:res`,
          rpcId: request.rpcId,
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error,
          ...toSafeDurabilityDetails(cause),
        }
      }
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `CONFLICT`,
        error,
      }
    case `rpc:applyCommittedTx:req`:
      if (cause instanceof PersistedCollectionDurabilityError) {
        return {
          type: `rpc:applyCommittedTx:res`,
          rpcId: request.rpcId,
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error,
          ...toSafeDurabilityDetails(cause),
        }
      }
      return {
        type: `rpc:applyCommittedTx:res`,
        rpcId: request.rpcId,
        ok: false,
        code: `CONFLICT`,
        error,
      }
    case `rpc:pullSince:req`:
      return {
        type: `rpc:pullSince:res`,
        rpcId: request.rpcId,
        ok: false,
        error,
      }
  }
}

function isMutatingRPCRequest(request: RPCRequest): request is Extract<
  RPCRequest,
  {
    type: IndeterminateCommitRequestType
  }
> {
  return (
    request.type === `rpc:applyLocalMutations:req` ||
    request.type === `rpc:applyCommittedTx:req`
  )
}

function toSafeDurabilityDetails(error: PersistedCollectionDurabilityError): {
  sourceCode?: string | number
  path?: string | ReadonlyArray<string | number>
} {
  const sourceCode =
    typeof error.code === `string` || typeof error.code === `number`
      ? error.code
      : undefined
  const path =
    typeof error.path === `string` ||
    (Array.isArray(error.path) &&
      error.path.every(
        (part) => typeof part === `string` || typeof part === `number`,
      ))
      ? (error.path as string | ReadonlyArray<string | number>)
      : undefined
  return {
    ...(sourceCode === undefined ? {} : { sourceCode }),
    ...(path === undefined ? {} : { path }),
  }
}
