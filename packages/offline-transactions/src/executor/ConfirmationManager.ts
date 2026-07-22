import { createOptimisticHold } from './OptimisticHold'
import type { OptimisticHold } from './OptimisticHold'
import type { ConfirmWriteContext, OfflineConfig } from '../types'

const DEFAULT_MAX_CONFIRMATION_HOLDS = 1000

type ConfirmationConfig = Pick<
  OfflineConfig,
  `confirmWrite` | `maxConfirmationHolds`
>

function getMaxConfirmationHolds(configured: number | undefined): number {
  if (configured === undefined) {
    return DEFAULT_MAX_CONFIRMATION_HOLDS
  }

  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_MAX_CONFIRMATION_HOLDS
  }

  return Math.floor(configured)
}

/**
 * Runs post-commit confirmation hooks outside the serial outbox path while
 * keeping the committed mutations visible until each hook settles.
 */
export class ConfirmationManager {
  private readonly holds = new Set<OptimisticHold>()
  private disposed = false

  constructor(private readonly config: ConfirmationConfig) {}

  /**
   * Schedule confirmation without throwing into the caller's already-committed
   * write path. The hook still runs when a hold cannot be created or is capped.
   */
  schedule(context: ConfirmWriteContext): void {
    if (this.disposed) {
      return
    }

    const confirmWrite = this.config.confirmWrite
    if (!confirmWrite) {
      return
    }

    const hold = this.tryCreateHold(context)

    // Start on a microtask so confirmation never blocks the serial drain. A
    // synchronous throw and an async rejection have the same guarded behavior.
    void Promise.resolve()
      .then(() => confirmWrite(context))
      .catch((error) => {
        console.warn(
          `confirmWrite rejected for ${context.transactionId}:`,
          error,
        )
      })
      .finally(() => {
        this.releaseHold(hold)
      })
  }

  /** Release every optimistic hold, for example during clear or dispose. */
  releaseAll(): void {
    for (const hold of [...this.holds]) {
      this.releaseHold(hold)
    }
  }

  /** Permanently stop accepting confirmations and release every active hold. */
  dispose(): void {
    this.disposed = true
    this.releaseAll()
  }

  /** Number of active holds currently keeping optimistic state visible. */
  getActiveHoldCount(): number {
    return this.holds.size
  }

  private tryCreateHold(context: ConfirmWriteContext): OptimisticHold | null {
    if (context.mutations.length === 0) {
      return null
    }

    const maxHolds = getMaxConfirmationHolds(this.config.maxConfirmationHolds)
    if (this.holds.size >= maxHolds) {
      return null
    }

    try {
      const hold = createOptimisticHold(context.mutations)
      this.holds.add(hold)
      return hold
    } catch (error) {
      // The write is already committed. Failure to paint a hold may cause a
      // brief flicker, but must never retry or roll back the durable write.
      console.warn(`Failed to create confirmation hold:`, error)
      return null
    }
  }

  private releaseHold(hold: OptimisticHold | null): void {
    if (!hold) {
      return
    }

    this.holds.delete(hold)
    try {
      hold.release()
    } catch (error) {
      console.warn(`Failed to release confirmation hold:`, error)
    }
  }
}
