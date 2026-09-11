import { getLoadSubsetDemandKey } from './ir-stable-identity.js'
import type { LoadSubsetFn, LoadSubsetOptions } from '../types.js'

/**
 * Deduplicates exact canonical demands without inferring broader coverage.
 * Requests follow the immutable LoadSubsetOptions contract; no copies are made.
 */
export class DeduplicatedLoadSubset {
  private readonly completed = new Set<string | undefined>()
  private readonly inflight = new Map<string | undefined, Promise<void>>()
  private generation = 0

  constructor(
    private readonly options: {
      loadSubset: LoadSubsetFn
      onDeduplicate?: (options: LoadSubsetOptions) => void
    },
  ) {}

  loadSubset = (options: LoadSubsetOptions): true | Promise<void> => {
    const key = getLoadSubsetDemandKey(options)
    if (this.completed.has(key)) {
      this.options.onDeduplicate?.(options)
      return true
    }

    // Requests with independent cancellation own independent transports.
    // Unabortable requests can share without an ownership protocol.
    const existing = options.signal ? undefined : this.inflight.get(key)
    if (existing) {
      // Observer failures must not reject a detached promise after success.
      void existing
        .then(() => this.options.onDeduplicate?.(options))
        .catch(() => {})
      return existing
    }

    const generation = this.generation
    const result = this.options.loadSubset(options)

    if (result === true) {
      if (generation === this.generation && !options.signal?.aborted) {
        this.completed.add(key)
      }
      return true
    }

    const promise = result
      .then((value) => {
        if (generation === this.generation && !options.signal?.aborted) {
          this.completed.add(key)
        }
        return value
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key)
      })
    if (!options.signal && generation === this.generation) {
      this.inflight.set(key, promise)
    }
    return promise
  }

  reset(): void {
    this.completed.clear()
    this.inflight.clear()
    this.generation++
  }
}
