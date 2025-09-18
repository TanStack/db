import {
  CollectionInErrorStateError,
  InvalidCollectionStatusTransitionError,
} from "../errors"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { CollectionImpl } from "./index.js"
import type { CollectionStatus } from "../types"

export class CollectionLifecycleManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  public status: CollectionStatus = `idle`
  public hasBeenReady = false
  public hasReceivedFirstCommit = false
  public onFirstReadyCallbacks: Array<() => void> = []
  public gcTimeoutId: ReturnType<typeof setTimeout> | null = null

  /**
   * Creates a new CollectionLifecycleManager instance
   */
  constructor(
    public collection: CollectionImpl<TOutput, TKey, any, TSchema, TInput>
  ) {}

  /**
   * Validates state transitions to prevent invalid status changes
   */
  public validateStatusTransition(
    from: CollectionStatus,
    to: CollectionStatus
  ): void {
    if (from === to) {
      // Allow same state transitions
      return
    }
    const validTransitions: Record<
      CollectionStatus,
      Array<CollectionStatus>
    > = {
      idle: [`loading`, `error`, `cleaned-up`],
      loading: [`initialCommit`, `ready`, `error`, `cleaned-up`],
      initialCommit: [`ready`, `error`, `cleaned-up`],
      ready: [`cleaned-up`, `error`],
      error: [`cleaned-up`, `idle`],
      "cleaned-up": [`loading`, `error`],
    }

    if (!validTransitions[from].includes(to)) {
      throw new InvalidCollectionStatusTransitionError(
        from,
        to,
        this.collection.id
      )
    }
  }

  /**
   * Safely update the collection status with validation
   * @private
   */
  public setStatus(newStatus: CollectionStatus): void {
    this.validateStatusTransition(this.status, newStatus)
    const previousStatus = this.status
    this.status = newStatus

    // Resolve indexes when collection becomes ready
    if (newStatus === `ready` && !this.collection._indexes.isIndexesResolved) {
      // Resolve indexes asynchronously without blocking
      this.collection._indexes.resolveAllIndexes().catch((error) => {
        console.warn(`Failed to resolve indexes:`, error)
      })
    }

    // Emit event
    this.collection._events.emitStatusChange(newStatus, previousStatus)
  }

  /**
   * Validates that the collection is in a usable state for data operations
   * @private
   */
  public validateCollectionUsable(operation: string): void {
    switch (this.status) {
      case `error`:
        throw new CollectionInErrorStateError(operation, this.collection.id)
      case `cleaned-up`:
        // Automatically restart the collection when operations are called on cleaned-up collections
        this.collection._sync.startSync()
        break
    }
  }

  /**
   * Mark the collection as ready for use
   * This is called by sync implementations to explicitly signal that the collection is ready,
   * providing a more intuitive alternative to using commits for readiness signaling
   * @private - Should only be called by sync implementations
   */
  public markReady(): void {
    // Can transition to ready from loading or initialCommit states
    if (this.status === `loading` || this.status === `initialCommit`) {
      this.setStatus(`ready`)

      // Call any registered first ready callbacks (only on first time becoming ready)
      if (!this.hasBeenReady) {
        this.hasBeenReady = true

        // Also mark as having received first commit for backwards compatibility
        if (!this.hasReceivedFirstCommit) {
          this.hasReceivedFirstCommit = true
        }

        const callbacks = [...this.onFirstReadyCallbacks]
        this.onFirstReadyCallbacks = []
        callbacks.forEach((callback) => callback())
      }
    }

    // Always notify dependents when markReady is called, after status is set
    // This ensures live queries get notified when their dependencies become ready
    if (this.collection._changes.changeListeners.size > 0) {
      this.collection._changes.emitEmptyReadyEvent()
    }
  }

  /**
   * Start the garbage collection timer
   * Called when the collection becomes inactive (no subscribers)
   */
  public startGCTimer(): void {
    if (this.gcTimeoutId) {
      clearTimeout(this.gcTimeoutId)
    }

    const gcTime = this.collection.config.gcTime ?? 300000 // 5 minutes default

    // If gcTime is 0, GC is disabled
    if (gcTime === 0) {
      return
    }

    this.gcTimeoutId = setTimeout(() => {
      if (this.collection._changes.activeSubscribersCount === 0) {
        // We call the main collection cleanup, not just the one for the
        // lifecycle manager
        this.collection.cleanup()
      }
    }, gcTime)
  }

  /**
   * Cancel the garbage collection timer
   * Called when the collection becomes active again
   */
  public cancelGCTimer(): void {
    if (this.gcTimeoutId) {
      clearTimeout(this.gcTimeoutId)
      this.gcTimeoutId = null
    }
  }

  public cleanup(): void {
    if (this.gcTimeoutId) {
      clearTimeout(this.gcTimeoutId)
      this.gcTimeoutId = null
    }

    this.hasBeenReady = false
    this.onFirstReadyCallbacks = []

    // Set status to cleaned-up
    this.setStatus(`cleaned-up`)
  }
}
