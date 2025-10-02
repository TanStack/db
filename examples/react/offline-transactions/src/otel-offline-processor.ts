import {
  OTelSpanStorage,
  deserializeSpan,
  serializeSpan,
} from "./otel-span-storage"
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base"

/**
 * Custom span processor that persists failed spans to IndexedDB
 * and retries sending them when back online
 */
export class OfflineRetrySpanProcessor {
  private storage: OTelSpanStorage
  private exporter: SpanExporter
  private isShutdown = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(exporter: SpanExporter) {
    this.exporter = exporter
    this.storage = new OTelSpanStorage()
  }

  async forceFlush(): Promise<void> {
    // Attempt to retry all stored spans
    await this.retryStoredSpans()
  }

  onStart(): void {
    // No-op for this processor
  }

  async onEnd(span: ReadableSpan): Promise<void> {
    if (this.isShutdown) {
      return
    }

    try {
      // Try to export the span immediately
      const result = await new Promise((resolve) => {
        this.exporter.export([span], (result) => {
          resolve(result)
        })
      })

      if (!result || result.code !== 0) {
        // Export failed, store for retry
        console.warn(
          `Failed to export span, storing for retry:`,
          span.name,
          result
        )
        await this.storage.store(serializeSpan(span))
      }
    } catch (error) {
      // Network error or exporter failure, store for retry
      console.warn(`Error exporting span, storing for retry:`, error)
      await this.storage.store(serializeSpan(span))
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return
    }

    this.isShutdown = true

    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    // Final flush attempt
    await this.forceFlush()
    await this.exporter.shutdown()
  }

  /**
   * Retry sending all stored spans
   * Returns the number of spans successfully sent
   */
  async retryStoredSpans(): Promise<number> {
    if (this.isShutdown) {
      return 0
    }

    const storedSpans = await this.storage.getAll()

    if (storedSpans.length === 0) {
      return 0
    }

    console.log(`Retrying ${storedSpans.length} stored spans`)
    let successCount = 0

    for (const stored of storedSpans) {
      try {
        const deserializedSpan = deserializeSpan(stored.span)
        const result = await new Promise((resolve) => {
          this.exporter.export([deserializedSpan], (result) => {
            resolve(result)
          })
        })

        if (result && result.code === 0) {
          // Success! Remove from storage
          await this.storage.remove(stored.id)
          successCount++
        } else {
          // Still failing, increment retry count
          await this.storage.incrementRetryCount(stored.id)
        }
      } catch (error) {
        // Still can't send, increment retry count
        console.warn(`Retry failed for span:`, error)
        await this.storage.incrementRetryCount(stored.id)
      }
    }

    console.log(
      `Successfully retried ${successCount}/${storedSpans.length} spans`
    )
    return successCount
  }

  /**
   * Start periodic retry attempts
   */
  startPeriodicRetry(intervalMs = 30000): void {
    if (this.retryTimer) {
      return
    }

    const retry = async () => {
      await this.retryStoredSpans()

      if (!this.isShutdown) {
        this.retryTimer = setTimeout(retry, intervalMs)
      }
    }

    this.retryTimer = setTimeout(retry, intervalMs)
  }

  /**
   * Stop periodic retry attempts
   */
  stopPeriodicRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /**
   * Get the number of spans waiting to be retried
   */
  async getPendingCount(): Promise<number> {
    return this.storage.getCount()
  }
}
