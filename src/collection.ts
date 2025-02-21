import { Store, Derived, batch } from "@tanstack/store"
import {
  SyncConfig,
  MutationFn,
  ChangeMessage,
  PendingMutation,
  Row,
} from "./types"
import { TransactionManager } from "./TransactionManager"
import { TransactionStore } from "./TransactionStore"

interface CollectionConfig {
  sync: SyncConfig
  mutationFn: MutationFn
}

interface UpdateParams {
  key: string
  // eslint-disable-next-line
  changes: Record<string, any>
  metadata?: unknown
}

interface InsertParams {
  key: string
  // eslint-disable-next-line
  data: Record<string, any>
  metadata?: unknown
}

interface DeleteParams {
  key: string
  metadata?: unknown
}

interface WithMutationParams {
  // eslint-disable-next-line
  changes: Record<string, any>[]
  metadata?: unknown
}

export class Collection {
  private transactionManager: TransactionManager
  private transactionStore: TransactionStore

  public optimisticOperations: Derived<ChangeMessage[]>

  private syncedData = new Store(new Map<string, unknown>())
  private pendingOperations: ChangeMessage[] = []
  public config: CollectionConfig

  constructor(config?: CollectionConfig) {
    if (!config?.sync) {
      throw new Error(`Collection requires a sync config`)
    }
    if (!config?.mutationFn && !config?.mutationFn?.persist) {
      throw new Error(`Collection requires a mutationFn`)
    }

    this.transactionStore = new TransactionStore()
    this.transactionManager = new TransactionManager(
      this.transactionStore,
      this
    )

    // Copies of live mutations are stored here and removed once the transaction completes.
    this.optimisticOperations = new Derived({
      fn: ({ currDepVals }) => {
        return Array.from(currDepVals[0].values())
          .filter(
            (transaction) =>
              transaction.state !== `completed` &&
              transaction.state !== `failed`
          )
          .map((transaction) =>
            transaction.mutations.map((mutation) => {
              return {
                type: mutation.type,
                key: mutation.key,
                value: mutation.modified as Row,
              } satisfies ChangeMessage
            })
          )
          .flat()
      },
      deps: [this.transactionManager.transactions],
    })
    this.optimisticOperations.mount()
    // Combine together synced data & optimistic operations.
    this.derivedState = new Derived({
      // prevVal, prevDepVals,
      fn: ({ currDepVals }) => {
        return currDepVals[0]
      },
      deps: [this.syncedData, this.optimisticOperations],
    })

    this.config = config

    this.derivedState.mount()

    // Start the sync process
    config.sync.sync({
      collection: this,
      begin: () => {
        this.pendingOperations = []
      },
      write: (message: ChangeMessage) => {
        this.pendingOperations.push(message)
      },
      commit: () => {
        batch(() => {
          for (const operation of this.pendingOperations) {
            this.syncedData.setState((prevData) => {
              switch (operation.type) {
                case `insert`:
                  prevData.set(operation.key, operation.value)
                  break
                case `update`:
                  prevData.set(operation.key, {
                    ...prevData.get(operation.key)!,
                    ...operation.value,
                  })
                  break
                case `delete`:
                  prevData.delete(operation.key)
                  break
              }
              return prevData
            })
          }
        })
        this.pendingOperations = []
      },
    })
  }

  update = ({ key, changes, metadata }: UpdateParams) => {
    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: this.syncedData.state.get(key) || {},
      modified: { ...this.syncedData.state.get(key), ...changes },
      changes,
      key,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: `created` as const,
    }

    this.transactionManager.createTransaction([mutation], { type: `ordered` })
  }

  insert = ({ key, data, metadata }: InsertParams) => {
    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: {},
      modified: data,
      changes: data,
      key,
      metadata,
      type: `insert`,
      created_at: new Date(),
      updated_at: new Date(),
      state: `created` as const,
    }

    return this.transactionManager.createTransaction([mutation], {
      type: `ordered`,
    })
  }

  deleteFn = ({ key, metadata }: DeleteParams) => {
    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: this.syncedData.state.get(key) || {},
      modified: { _deleted: true },
      changes: { _deleted: true },
      key,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: `created` as const,
    }

    this.transactionManager.createTransaction([mutation], { type: `ordered` })
  }

  withMutation = ({ changes, metadata }: WithMutationParams) => {
    const mutations = changes.map((change) => ({
      mutationId: crypto.randomUUID(),
      original:
        changes.map((change) => this.syncedData.state.get(change.key)) || [],
      modified: changes.map((change) => {
        return {
          ...this.syncedData.state.get(change.key),
          ...change.data,
        }
      }),
      changes: change,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      state: `created` as const,
    }))

    this.transactionManager.createTransaction(mutations, { type: `ordered` })
  }

  get value() {
    return this.derivedState.state
  }

  get transactions() {
    return this.transactionManager.transactions.state
  }
}
