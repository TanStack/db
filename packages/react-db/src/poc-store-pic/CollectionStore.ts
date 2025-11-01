import * as React from "react"
import { startTransition } from "react"
import type { Collection } from "@tanstack/db"
import Emitter from "./Emitter"

/**
 * Access React internals to check if we're inside a transition
 * Based on react-concurrent-store implementation
 */
const sharedReactInternals: { T: unknown } =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as any

function reactTransitionIsActive() {
  return !!sharedReactInternals.T
}

/**
 * Snapshot of a Collection's state at a point in time
 * This is what gets committed/pending
 */
export interface CollectionSnapshot<
  TResult extends object,
  TKey extends string | number,
> {
  entries: Array<[TKey, TResult]>
  status: string
  version: number
}

/**
 * CollectionStore wraps a TanStack Collection with concurrent-safe state management
 *
 * Maintains two snapshots:
 * - committedSnapshot: State shown to sync renders and newly mounting components
 * - pendingSnapshot: State shown to components already rendering in a transition
 *
 * This prevents tearing and enables proper state rebasing when sync updates
 * happen during transitions.
 */
export class CollectionStore<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> extends Emitter<[]> {
  private collection: Collection<TResult, TKey, TUtils>
  private pendingSnapshot: CollectionSnapshot<TResult, TKey>
  private committedSnapshot: CollectionSnapshot<TResult, TKey>
  private version: number = 0
  private collectionUnsubscribe: (() => void) | null = null

  constructor(collection: Collection<TResult, TKey, TUtils>) {
    super()
    this.collection = collection

    // Start syncing the collection if not already
    if (typeof collection.startSyncImmediate === "function") {
      collection.startSyncImmediate()
    }

    // Create initial snapshot
    const initialSnapshot = this.captureSnapshot()
    this.pendingSnapshot = initialSnapshot
    this.committedSnapshot = initialSnapshot

    // Subscribe to collection changes
    this.collectionUnsubscribe = collection.subscribeChanges(() => {
      this.handleCollectionUpdate()
    })

    // If collection is already ready, trigger initial update
    if (collection.status === "ready") {
      this.handleCollectionUpdate()
    }
  }

  /**
   * Capture current state of the collection as a snapshot
   */
  private captureSnapshot(): CollectionSnapshot<TResult, TKey> {
    return {
      entries: Array.from(this.collection.entries()),
      status: this.collection.status,
      version: this.version,
    }
  }

  /**
   * Commit a snapshot as the committed state
   * Called by StoreManager after transitions complete
   */
  commit(snapshot: CollectionSnapshot<TResult, TKey>) {
    this.committedSnapshot = snapshot
  }

  getCommittedSnapshot(): CollectionSnapshot<TResult, TKey> {
    return this.committedSnapshot
  }

  getPendingSnapshot(): CollectionSnapshot<TResult, TKey> {
    return this.pendingSnapshot
  }

  getCollection(): Collection<TResult, TKey, TUtils> {
    return this.collection
  }

  /**
   * Handle updates from the underlying collection
   * Implements state rebasing for concurrent safety
   */
  private handleCollectionUpdate() {
    this.version += 1
    const noPendingTransitions =
      this.committedSnapshot === this.pendingSnapshot

    // Capture new snapshot
    const newSnapshot = this.captureSnapshot()
    this.pendingSnapshot = newSnapshot

    if (reactTransitionIsActive()) {
      // For transition updates, everything is simple. Just notify all readers
      // of the new pending state.
      this.notify()
    } else {
      // For sync updates, we must consider if we need to juggle multiple state
      // updates.

      // If there are no pending transition updates, things are very similar to
      // a transition update except that we can proactively mark the new state
      // as committed.
      if (noPendingTransitions) {
        this.committedSnapshot = newSnapshot
        this.notify()
      } else {
        // If there are pending transition updates, we must ensure sync renders
        // see the committed state updated, while transition renders continue
        // with their pending state.

        // For Collections, we don't have a reducer to rebase with, so we
        // treat the new collection state as both the new committed state
        // and the new pending state. This is a simplification compared to
        // Redux-style stores, but works for TanStack Collections which are
        // self-contained reactive stores.

        this.committedSnapshot = newSnapshot
        this.notify()

        // Now schedule a transition update so components in the transition
        // update to the new state
        this.pendingSnapshot = newSnapshot
        startTransition(() => {
          this.notify()
        })
      }
    }
  }

  /**
   * Clean up subscriptions
   */
  destroy() {
    if (this.collectionUnsubscribe) {
      this.collectionUnsubscribe()
      this.collectionUnsubscribe = null
    }
  }
}
