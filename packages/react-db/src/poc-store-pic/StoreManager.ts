import Emitter from "./Emitter"
import { CollectionStore, CollectionSnapshot } from "./CollectionStore"

type RefCountedSubscription = {
  count: number
  unsubscribe: () => void
}

type StoresSnapshot = Map<CollectionStore<any, any, any>, CollectionSnapshot<any, any>>

/**
 * StoreManager tracks all actively rendered stores in the tree and maintains a
 * reference-counted subscription to each one. This allows the <CommitTracker />
 * component to observe every state update and record each store's committed
 * state.
 *
 * Based on react-concurrent-store's StoreManager implementation.
 */
export class StoreManager extends Emitter<[]> {
  _storeRefCounts: Map<
    CollectionStore<any, any, any>,
    RefCountedSubscription
  > = new Map()

  /**
   * Get all committed snapshots for all tracked stores
   */
  getAllCommittedSnapshots(): StoresSnapshot {
    return new Map(
      Array.from(this._storeRefCounts.keys()).map((store) => [
        store,
        store.getCommittedSnapshot(),
      ])
    )
  }

  /**
   * Get all pending snapshots for all tracked stores
   */
  getAllPendingSnapshots(): StoresSnapshot {
    return new Map(
      Array.from(this._storeRefCounts.keys()).map((store) => [
        store,
        store.getPendingSnapshot(),
      ])
    )
  }

  /**
   * Add a store to be tracked
   * Uses reference counting to handle multiple components using the same store
   */
  addStore(store: CollectionStore<any, any, any>) {
    const prev = this._storeRefCounts.get(store)
    if (prev == null) {
      this._storeRefCounts.set(store, {
        unsubscribe: store.subscribe(() => {
          this.notify()
        }),
        count: 1,
      })
    } else {
      this._storeRefCounts.set(store, { ...prev, count: prev.count + 1 })
    }
  }

  /**
   * Commit all stores to their snapshots
   * Called after a render commits to the DOM
   */
  commitAllSnapshots(snapshots: StoresSnapshot) {
    for (const [store, snapshot] of snapshots) {
      store.commit(snapshot)
    }
    this.sweep()
  }

  /**
   * Remove a store from tracking
   * Decrements ref count but doesn't immediately clean up
   * (actual cleanup happens in sweep())
   */
  removeStore(store: CollectionStore<any, any, any>) {
    const prev = this._storeRefCounts.get(store)
    if (prev == null) {
      throw new Error(
        "Imbalance in CollectionStore reference counting. This is a bug in the store-pic POC."
      )
    }

    // We decrement the count here, but don't actually do the cleanup. This is
    // because a state update could cause the last store subscriber to unmount
    // while also mounting a new subscriber. In this case we need to ensure we
    // don't lose the currently committed snapshot in the moment between when
    // the cleanup of the unmounting component is run and the useLayoutEffect
    // of the mounting component is run.

    // So, we cleanup unreferenced stores after each commit.
    this._storeRefCounts.set(store, {
      unsubscribe: prev.unsubscribe,
      count: prev.count - 1,
    })
  }

  /**
   * Clean up any stores with zero references
   * Called after commits
   */
  sweep() {
    for (const [store, refs] of this._storeRefCounts) {
      if (refs.count < 1) {
        refs.unsubscribe()
        this._storeRefCounts.delete(store)
        store.destroy()
      }
    }
  }
}
