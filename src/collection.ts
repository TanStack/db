import { Store, Derived, batch } from "@tanstack/store"
import { SyncConfig, MutationFn, ChangeMessage } from "./types"

interface CollectionConfig {
  sync: SyncConfig
  mutationFn?: MutationFn
}

export class Collection {
  private syncedData = new Store(new Map<string, unknown>())
  // Copies of live mutations are stored here and removed once the transaction completes.
  private optimisticOperations = new Store([])
  private pendingOperations: ChangeMessage[] = []

  // Combine together synced data & optimistic operations.
  private derivedState = new Derived({
    // prevVal, prevDepVals,
    fn: ({ currDepVals }) => {
      console.log(`curr`, currDepVals)
      return currDepVals[0]
    },
    deps: [this.syncedData, this.optimisticOperations],
  })

  constructor(config?: CollectionConfig) {
    if (!config?.sync) {
      throw new Error(`Collection requires a sync config`)
    }
    if (!config?.mutationFn) {
      throw new Error(`Collection requires a mutationFn`)
    }

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

  get value() {
    return this.derivedState.state
  }
}
