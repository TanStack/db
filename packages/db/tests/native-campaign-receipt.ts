// Native registrations still use fast-check. Its completion hook supplies the
// original owners' diagnostic replay/report receipts without replacing the
// native reporter. Only the current native test activates a receipt callback.
import fc from 'fast-check'
import { afterEach, beforeEach } from 'vitest'

type Receipt = (details: fc.RunDetails<unknown>) => void | Promise<void>
let activeReceipt: Receipt | undefined
let reporting = false

fc.installGlobalPlugin(() => ({
  onAllRunsComplete: (details) => {
    // The owner's automatic replay uses the same checker. Its inner check
    // must not recursively produce another completion report.
    if (!activeReceipt || reporting) return
    reporting = true
    const preserveDiagnostic = (error: unknown): void => {
      // Let assert() reach its own reporter, including a guarded replay
      // witness. Preserve the old diagnostic as the failed run's cause.
      if (!details.failed) throw error
      details.errorInstance = error
    }
    try {
      const result = activeReceipt(details)
      if (result instanceof Promise)
        return result.catch(preserveDiagnostic).finally(() => {
          reporting = false
        })
      reporting = false
      return undefined
    } catch (error) {
      reporting = false
      preserveDiagnostic(error)
      return undefined
    }
  },
}))

export function nativeCampaignReceipt<T>(
  completed: (details: fc.RunDetails<[T]>) => void | Promise<void>,
): void {
  let previous: Receipt | undefined
  beforeEach(() => {
    previous = activeReceipt
    activeReceipt = (details) => completed(details as fc.RunDetails<[T]>)
  })
  afterEach(() => {
    activeReceipt = previous
  })
}
