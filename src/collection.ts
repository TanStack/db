import { Store, Derived, batch } from "@tanstack/store"
import {
  SyncConfig,
  MutationFn,
  ChangeMessage,
  PendingMutation,
  Row,
  Transaction,
  TransactionState,
} from "./types"
import { TransactionManager } from "./TransactionManager"
import { TransactionStore } from "./TransactionStore"

interface CollectionConfig {
  sync: SyncConfig
  mutationFn: MutationFn
}

interface PendingSyncedTransaction {
  committed: boolean
  operations: ChangeMessage[]
}

interface UpdateParams {
  key: string
  // eslint-disable-next-line
  data: Record<string, any>
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
  public transactionManager: TransactionManager
  private transactionStore: TransactionStore

  public optimisticOperations: Derived<ChangeMessage[]>
  public derivedState: Derived<Map<string, unknown>>

  private syncedData = new Store(new Map<string, unknown>())
  private pendingSyncedTransactions: PendingSyncedTransaction[] = []
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
        const result = Array.from(currDepVals[0].values())
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

        return result
      },
      deps: [this.transactionManager.transactions],
    })
    this.optimisticOperations.mount()
    // Combine together synced data & optimistic operations.
    this.derivedState = new Derived({
      // prevVal, prevDepVals,
      fn: ({ currDepVals }) => {
        const combined = new Map(currDepVals[0])
        // Apply the optimistic operations on top of the synced state.
        for (const operation of currDepVals[1]) {
          switch (operation.type) {
            case `insert`:
              combined.set(operation.key, operation.value)
              break
            case `update`:
              combined.set(operation.key, {
                ...currDepVals[0].get(operation.key)!,
                ...operation.value,
              })
              break
            case `delete`:
              combined.delete(operation.key)
              break
          }
        }
        return combined
      },
      deps: [this.syncedData, this.optimisticOperations],
    })

    this.config = config

    this.derivedState.mount()

    // Start the sync process
    config.sync.sync({
      collection: this,
      begin: () => {
        this.pendingSyncedTransactions.push({
          committed: false,
          operations: [],
        })
      },
      write: (message: ChangeMessage) => {
        const pendingTransaction =
          this.pendingSyncedTransactions[
            this.pendingSyncedTransactions.length - 1
          ]
        if (pendingTransaction.committed) {
          throw new Error(
            `The pending sync transaction is already committed, you can't still write to it.`
          )
        }
        pendingTransaction.operations.push(message)
      },
      commit: () => {
        const pendingTransaction =
          this.pendingSyncedTransactions[
            this.pendingSyncedTransactions.length - 1
          ]
        if (pendingTransaction.committed) {
          throw new Error(
            `The pending sync transaction is already committed, you can't commit it again.`
          )
        }

        pendingTransaction.committed = true

        this.tryToCommitPendingSyncedTransactions()
      },
    })

    // Listen to transactions and re-run tryToCommitPendingSyncedTransactions on changes
    // this.transactionManager.transactions.subscribe(
    //   this.tryToCommitPendingSyncedTransactions
    // )
  }

  tryToCommitPendingSyncedTransactions = () => {
    // Check if there's any transactions that aren't finished.
    // If not, proceed.
    // If so, subscribe to transactions and keep checking if can proceed.
    //
    // The plan is to have a finer-grained locking but just blocking applying
    // synced data until a persisting transaction is finished seems fine.
    // We also don't yet have support for transactions that don't immediately
    // persist so right now, blocking sync only delays their application for a
    // few hundred milliseconds. So not the worse thing in th world.
    // But something to fix in the future.
    // Create a Set with only the terminal states
    const terminalStates = new Set<TransactionState>([`completed`, `failed`])

    // Function to check if a state is NOT a terminal state
    function isNotTerminalState({ state }: Transaction): boolean {
      return !terminalStates.has(state as TransactionState)
    }
    if (
      this.transactions.size === 0 ||
      !Array.from(this.transactions.values()).some(isNotTerminalState)
    ) {
      batch(() => {
        for (const transaction of this.pendingSyncedTransactions) {
          for (const operation of transaction.operations) {
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
        }
      })

      this.pendingSyncedTransactions = []
    }
  }

  update = ({ key, data, metadata }: UpdateParams) => {
    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: this.value.get(key) || {},
      modified: { ...this.value.get(key), ...data },
      changes: data,
      key,
      metadata,
      type: `update`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return this.transactionManager.createTransaction([mutation], {
      type: `ordered`,
    })
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
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return this.transactionManager.createTransaction([mutation], {
      type: `ordered`,
    })
  }

  delete = ({ key, metadata }: DeleteParams) => {
    const mutation: PendingMutation = {
      mutationId: crypto.randomUUID(),
      original: this.value.get(key) || {},
      modified: { _deleted: true },
      changes: { _deleted: true },
      key,
      metadata,
      type: `delete`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return this.transactionManager.createTransaction([mutation], {
      type: `ordered`,
    })
  }

  // TODO should be withTransaction & it shouldn't start saving until it's explicitly started?
  // Not critical for now so we can defer this.
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
      createdAt: new Date(),
      updatedAt: new Date(),
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
