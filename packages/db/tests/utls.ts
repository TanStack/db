import type {
  CollectionConfig,
  MutationFnParams,
  SyncConfig,
} from "../src/index.js"

type MockSyncCollectionConfig<T> = {
  id: string
  initialData: Array<T>
  getKey: (item: T) => string | number
}

export function mockSyncCollectionOptions<
  T extends object = Record<string, unknown>,
>(config: MockSyncCollectionConfig<T>) {
  let begin: () => void
  let write: Parameters<SyncConfig<T>[`sync`]>[0][`write`]
  let commit: () => void

  let syncPendingPromise: Promise<void> | undefined
  let syncPendingResolve: (() => void) | undefined
  let syncPendingReject: ((error: Error) => void) | undefined

  const awaitSync = async () => {
    if (syncPendingPromise) {
      return syncPendingPromise
    }
    syncPendingPromise = new Promise((resolve, reject) => {
      syncPendingResolve = resolve
      syncPendingReject = reject
    })
    syncPendingPromise.then(() => {
      syncPendingPromise = undefined
      syncPendingResolve = undefined
      syncPendingReject = undefined
    })
    return syncPendingPromise
  }

  const utils = {
    begin: () => begin!(),
    write: ((value) => write!(value)) as typeof write,
    commit: () => commit!(),
    resolveSync: () => {
      syncPendingResolve!()
    },
    rejectSync: (error: Error) => {
      syncPendingReject!(error)
    },
  }

  const options: CollectionConfig<T> & { utils: typeof utils } = {
    sync: {
      sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        const markReady = params.markReady

        begin()
        config.initialData.forEach((item) => {
          write({
            type: `insert`,
            value: item,
          })
        })
        commit()
        markReady()
      },
    },
    startSync: true,
    onInsert: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    onUpdate: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    onDelete: async (_params: MutationFnParams<T>) => {
      // TODO
      await awaitSync()
    },
    utils,
    ...config,
  }

  return options
}
