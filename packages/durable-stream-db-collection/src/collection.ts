import { DurableStream } from '@durable-streams/client'
import { loadOffset, saveOffset } from './offset-storage'
import type { CollectionConfig, SyncConfig } from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  DurableStreamCollectionConfig,
  DurableStreamResult,
  RowWithOffset,
} from './types'

/**
 * Helper type to extract the output type from a standard schema
 */
type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends object
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Creates Durable Stream collection options for use with a standard Collection.
 *
 * This is a read-only collection that syncs data from a Durable Streams server
 * in JSON mode. Each row is annotated with the batch offset for tracking.
 *
 * @template TRow - The type of items in the collection
 * @param config - Configuration options for the Durable Stream collection
 * @returns Collection configuration compatible with TanStack DB createCollection()
 *
 * @example
 * ```typescript
 * import { createCollection } from '@tanstack/db'
 * import { durableStreamCollectionOptions } from '@tanstack/durable-stream-db-collection'
 *
 * const eventsCollection = createCollection(
 *   durableStreamCollectionOptions({
 *     url: 'https://api.example.com/v1/stream/events',
 *     getKey: (row) => row.id,
 *     getDeduplicationKey: (row) => `${row.id}:${row.seq}`,
 *   })
 * )
 * ```
 */

// Overload for when schema is provided
export function durableStreamCollectionOptions<
  T extends StandardSchemaV1,
  TRow extends object = InferSchemaOutput<T>,
>(
  config: DurableStreamCollectionConfig<TRow> & {
    schema: T
  },
): Omit<CollectionConfig<RowWithOffset<TRow>, string | number, T>, `utils`> & {
  id: string
  schema: T
}

// Overload for when no schema is provided
export function durableStreamCollectionOptions<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow> & {
    schema?: never
  },
): Omit<CollectionConfig<RowWithOffset<TRow>, string | number>, `utils`> & {
  id: string
  schema?: never
}

// Implementation
export function durableStreamCollectionOptions<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow>,
): Omit<
  CollectionConfig<RowWithOffset<TRow>, string | number, any>,
  `utils`
> & {
  id: string
  schema?: any
} {
  const collectionId = config.id ?? `durable-stream:${config.url}`

  const sync: SyncConfig<RowWithOffset<TRow>>[`sync`] = (params) => {
    const { begin, write, commit, markReady } = params

    let aborted = false

    // Track seen deduplication keys to filter replayed rows
    const seenKeys = new Set<string>()

    const syncLoop = async () => {
      let isFirstBatch = true

      // Load persisted offset or use initial offset
      const persistedOffset = await loadOffset(config)
      let currentOffset = persistedOffset ?? config.initialOffset ?? `-1`

      // Create the Durable Stream client
      const stream = new DurableStream({
        url: config.url,
        headers: config.headers,
        signal: config.signal,
      })

      try {
        const followOptions = {
          offset: currentOffset,
          live: config.liveMode ?? `long-poll`,
        }

        for await (const chunk of stream.read(followOptions)) {
          if (aborted) break

          // Parse JSON from raw bytes
          // The stream returns Uint8Array, we need to decode and parse
          let rows: Array<TRow>
          try {
            const text = new TextDecoder().decode(chunk.data)
            if (!text.trim()) {
              // Empty response, skip
              continue
            }
            const parsed = JSON.parse(text)
            // Server may return array directly or wrapped in an object
            rows = Array.isArray(parsed) ? parsed : [parsed]
          } catch {
            // Skip malformed JSON
            continue
          }

          const result: DurableStreamResult<TRow> = {
            data: rows,
            offset: chunk.offset,
          }

          // Only start a transaction if we have rows to process
          if (rows.length > 0) {
            begin()

            for (const row of rows) {
              // Deduplicate - batch offsets may cause replay on resume
              const dedupKey = config.getDeduplicationKey(row)
              if (seenKeys.has(dedupKey)) {
                continue
              }
              seenKeys.add(dedupKey)

              // Attach batch offset to row
              const rowWithOffset: RowWithOffset<TRow> = {
                ...row,
                offset: result.offset,
              }

              write({
                type: `insert`,
                value: rowWithOffset,
              })
            }

            commit()
          }

          // Update offset for next iteration / persistence
          currentOffset = result.offset
          await saveOffset(config, currentOffset)

          // Mark ready after first successful batch
          if (isFirstBatch) {
            markReady()

            isFirstBatch = false
          }
        }
      } catch (error) {
        console.error(`Durable stream sync error:`, error)

        // Ensure markReady is called even on error so UI doesn't hang
        if (isFirstBatch) {
          markReady()
        }

        // Reconnect after delay if not aborted
        if (!aborted) {
          const delay = config.reconnectDelay ?? 5000

          setTimeout(syncLoop, delay)
        }
      }
    }

    // Start sync loop
    syncLoop()

    // Return cleanup function
    return {
      cleanup: () => {
        aborted = true
      },
    }
  }

  // Create the getKey function that extracts from RowWithOffset
  const getKey = (row: RowWithOffset<TRow>): string | number => {
    // Extract the original row (without offset) for the user's getKey function
     
    const { offset: _offset, ...originalRow } = row
    return config.getKey(originalRow as TRow)
  }

  return {
    id: collectionId,
    schema: config.schema,
    getKey,
    sync: { sync },
    // No mutation handlers - this is a read-only sync
  }
}
