import type { SyncAppliedReceipt } from '@tanstack/db'

export type AppliedCommitCapture = {
  wait: () => Promise<void>
  dispose: () => void
}

export type AppliedCommitCaptureRegistry = {
  capture: (signal?: AbortSignal) => AppliedCommitCapture
  record: (receipt: SyncAppliedReceipt) => void
  readonly activeCount: number
}

/**
 * Captures every asynchronous commit receipt produced during an Electric
 * request. A capture is sealed before waiting, so later stream work cannot
 * become part of an already-settled request.
 */
export function createAppliedCommitCaptureRegistry(
  onActiveCountChange?: (activeCount: number) => void,
): AppliedCommitCaptureRegistry {
  const activeCaptures = new Set<Set<Promise<void>>>()
  const notifyActiveCount = () => onActiveCountChange?.(activeCaptures.size)

  return {
    capture: (signal) => {
      const receipts = new Set<Promise<void>>()
      let active = true
      const dispose = () => {
        if (!active) return
        active = false
        signal?.removeEventListener(`abort`, dispose)
        activeCaptures.delete(receipts)
        notifyActiveCount()
      }

      activeCaptures.add(receipts)
      notifyActiveCount()
      if (signal?.aborted) {
        dispose()
      } else {
        signal?.addEventListener(`abort`, dispose, { once: true })
      }

      return {
        wait: async () => {
          dispose()
          await Promise.all(receipts)
        },
        dispose,
      }
    },
    record: (receipt) => {
      if (receipt === true || activeCaptures.size === 0) return

      for (const receipts of activeCaptures) {
        receipts.add(receipt)
      }
      // A receipt can reject before its request Promise settles. Observe it
      // now while retaining the original Promise for every capture to await.
      void receipt.catch(() => undefined)
    },
    get activeCount() {
      return activeCaptures.size
    },
  }
}
