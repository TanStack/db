import { createCollection } from '@tanstack/db'
import { startOfflineExecutor } from '../src/index'
import type { ChangeMessage, Collection, PendingMutation } from '@tanstack/db'
import type {
  LeaderElection,
  OfflineConfig,
  OfflineMutationFnParams,
  OnlineDetector,
  StorageAdapter,
} from '../src/types'

export class FakeStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.has(key) ? this.store.get(key)! : null)
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
    return Promise.resolve()
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }

  async keys(): Promise<Array<string>> {
    return Promise.resolve(Array.from(this.store.keys()))
  }

  async clear(): Promise<void> {
    this.store.clear()
    return Promise.resolve()
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store.entries())
  }
}

export interface TestItem {
  id: string
  value: string
  completed: boolean
  updatedAt: Date
}

interface SyncController {
  begin: () => void
  write: (message: Omit<ChangeMessage<TestItem>, `key`>) => void
  commit: () => void
  markReady: () => void
}

class FakeLeaderElection implements LeaderElection {
  private listeners = new Set<(isLeader: boolean) => void>()
  private leader = true

  // eslint-disable-next-line
  async requestLeadership(): Promise<boolean> {
    this.notify(this.leader)
    return this.leader
  }

  releaseLeadership(): void {
    this.leader = false
    this.notify(false)
  }

  isLeader(): boolean {
    return this.leader
  }

  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.listeners.add(callback)
    // Don't call callback immediately - matches real BaseLeaderElection behavior
    return () => {
      this.listeners.delete(callback)
    }
  }

  setLeader(isLeader: boolean): void {
    this.leader = isLeader
    this.notify(isLeader)
  }

  private notify(isLeader: boolean): void {
    for (const listener of this.listeners) {
      listener(isLeader)
    }
  }
}

export class FakeOnlineDetector implements OnlineDetector {
  private listeners = new Set<() => void>()
  online = true

  isOnline(): boolean {
    return this.online
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  notifyOnline(): void {
    if (!this.isOnline()) {
      return
    }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.warn(`FakeOnlineDetector listener error:`, error)
      }
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

type TestMutationFn = (
  params: OfflineMutationFnParams & { attempt: number },
) => Promise<any>

interface TestOfflineEnvironmentOptions {
  mutationFnName?: string
  mutationFn?: TestMutationFn
  storage?: FakeStorageAdapter
  config?: Partial<OfflineConfig>
}

function createDefaultCollection(): {
  collection: Collection<TestItem, string, {}>
  controller: SyncController
} {
  let controller!: SyncController

  const collection = createCollection<TestItem, string, {}>({
    id: `test-items`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: (params) => {
        controller = {
          begin: params.begin,
          write: params.write,
          commit: params.commit,
          markReady: params.markReady,
        }
        params.markReady()
      },
    },
  })

  return { collection, controller }
}

export function createTestOfflineEnvironment(
  options: TestOfflineEnvironmentOptions = {},
): {
  executor: ReturnType<typeof startOfflineExecutor>
  storage: FakeStorageAdapter
  collection: Collection<TestItem, string, {}>
  mutationFnName: string
  mutationCalls: Array<OfflineMutationFnParams & { attempt: number }>
  waitForLeader: () => Promise<void>
  leader: FakeLeaderElection
  serverState: Map<string, TestItem>
  applyMutations: (mutations: Array<PendingMutation<TestItem>>) => void
} {
  const mutationFnName = options.mutationFnName ?? `syncData`
  const storage = options.storage ?? new FakeStorageAdapter()
  const mutationCalls: Array<OfflineMutationFnParams & { attempt: number }> = []
  const attemptCounter = new Map<string, number>()

  const { collection, controller } = createDefaultCollection()
  const serverState = new Map<string, TestItem>()

  const applyMutations = (mutations: Array<PendingMutation<TestItem>>) => {
    controller.begin()

    for (const mutation of mutations) {
      switch (mutation.type) {
        case `insert`: {
          const value = mutation.modified
          serverState.set(value.id, value)
          controller.write({ type: `insert`, value })
          break
        }
        case `update`: {
          const value = mutation.modified
          serverState.set(value.id, value)
          controller.write({ type: `update`, value })
          break
        }
        case `delete`: {
          const original = mutation.original as TestItem | undefined
          const fallbackIdFromKey =
            (typeof mutation.key === `string` ? mutation.key : undefined) ??
            mutation.globalKey.split(`:`).pop()
          const id = original?.id ?? fallbackIdFromKey

          if (!id) {
            throw new Error(
              `Unable to determine id for delete mutation ${mutation.globalKey}`,
            )
          }

          const previousValue = serverState.get(id)
          serverState.delete(id)

          const emittedValue: TestItem = previousValue ?? {
            id,
            value: original?.value ?? ``,
            completed: original?.completed ?? false,
            updatedAt: original?.updatedAt ?? new Date(),
          }

          controller.write({
            type: `delete`,
            value: emittedValue,
          })
          break
        }
      }
    }

    controller.commit()
    controller.markReady()
  }

  const defaultMutation: TestMutationFn = (params) => {
    const mutations = params.transaction.mutations as Array<
      PendingMutation<TestItem>
    >

    applyMutations(mutations)

    return { ok: true, mutations }
  }

  const mutationFn: TestMutationFn = options.mutationFn ?? defaultMutation

  const leader = new FakeLeaderElection()

  const wrappedMutation = async (
    params: OfflineMutationFnParams,
  ): Promise<any> => {
    const currentAttempt = (attemptCounter.get(params.idempotencyKey) ?? 0) + 1
    attemptCounter.set(params.idempotencyKey, currentAttempt)
    const extendedParams = { ...params, attempt: currentAttempt }
    mutationCalls.push(extendedParams)
    return mutationFn(extendedParams)
  }

  const config: OfflineConfig = {
    collections: {
      ...(options.config?.collections ?? {}),
      [collection.id]: collection,
    },
    mutationFns: {
      ...(options.config?.mutationFns ?? {}),
      [mutationFnName]: wrappedMutation,
    },
    storage,
    maxConcurrency: options.config?.maxConcurrency,
    jitter: options.config?.jitter,
    beforeRetry: options.config?.beforeRetry,
    onUnknownMutationFn: options.config?.onUnknownMutationFn,
    onLeadershipChange: options.config?.onLeadershipChange,
    leaderElection: options.config?.leaderElection ?? leader,
    onlineDetector: options.config?.onlineDetector,
  }

  const executor = startOfflineExecutor(config)

  const waitForLeader = async () => {
    // Wait for full initialization including loading pending transactions
    await executor.waitForInit()
    if (!executor.isOfflineEnabled) {
      throw new Error(`Executor did not become leader`)
    }
  }

  return {
    executor,
    storage,
    collection,
    mutationFnName,
    mutationCalls,
    waitForLeader,
    leader,
    serverState,
    applyMutations,
  }
}
