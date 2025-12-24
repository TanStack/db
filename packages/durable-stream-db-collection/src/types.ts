import type { StandardSchemaV1 } from '@standard-schema/spec'

/**
 * Storage adapter interface for offset persistence.
 * Compatible with localStorage, sessionStorage, AsyncStorage, etc.
 */
export interface OffsetStorage {
  getItem: (key: string) => string | null | Promise<string | null>
  setItem: (key: string, value: string) => void | Promise<void>
}

/**
 * Live mode options for following a Durable Stream.
 */
export type LiveMode = 'long-poll' | 'sse'

/**
 * Configuration interface for Durable Stream collection options.
 * @template TRow - The type of items in the collection
 */
export interface DurableStreamCollectionConfig<TRow extends object> {
  // ═══════════════════════════════════════════════════════════════════
  // Required
  // ═══════════════════════════════════════════════════════════════════

  /**
   * URL of the Durable Stream endpoint.
   * Must be a stream in JSON mode.
   */
  url: string

  /**
   * Extract a unique key from each row.
   * Used as the collection's primary key for lookups and updates.
   */
  getKey: (row: TRow) => string | number

  /**
   * Extract a deduplication key from each row.
   * Used to filter out replayed rows when resuming from a batch offset.
   *
   * This key must be unique within the stream and deterministic -
   * the same row must always produce the same deduplication key.
   *
   * Common patterns:
   * - `${row.id}` for rows with unique IDs
   * - `${row.groupId}:${row.seq}` for rows with sequence numbers per group
   */
  getDeduplicationKey: (row: TRow) => string

  // ═══════════════════════════════════════════════════════════════════
  // Optional
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Unique identifier for the collection.
   * Auto-generated from URL if not provided.
   */
  id?: string

  /**
   * Schema for runtime validation and type inference.
   * Must be a Standard Schema compatible schema (Zod, Valibot, etc.)
   */
  schema?: StandardSchemaV1<TRow>

  /**
   * Initial offset to start reading from.
   * Use '-1' to read from the beginning.
   *
   * @default '-1'
   */
  initialOffset?: string

  /**
   * HTTP headers to include in stream requests.
   * Useful for authentication tokens.
   */
  headers?: Record<string, string>

  /**
   * Delay in milliseconds before reconnecting after an error.
   *
   * @default 5000
   */
  reconnectDelay?: number

  /**
   * Live mode for following the stream.
   *
   * @default 'long-poll'
   */
  liveMode?: LiveMode

  /**
   * Storage key prefix for persisting offsets.
   * Set to false to disable offset persistence.
   *
   * @default 'durable-stream'
   */
  storageKey?: string | false

  /**
   * Custom storage adapter for offset persistence.
   * Defaults to localStorage in browsers.
   */
  storage?: OffsetStorage

  /**
   * AbortSignal to cancel the stream sync.
   * When aborted, the sync will stop and cleanup will be called.
   */
  signal?: AbortSignal
}

/**
 * Output row type includes the batch offset.
 * Each row from a Durable Stream batch is annotated with the batch's offset.
 */
export type RowWithOffset<TRow> = TRow & { offset: string }

/**
 * Result from a Durable Stream follow iteration.
 * In JSON mode, data is the parsed array of rows.
 */
export interface DurableStreamResult<TRow> {
  /**
   * The data from this batch. In JSON mode, this is an array of parsed JSON objects.
   */
  data: Array<TRow>

  /**
   * The Stream-Next-Offset for this batch.
   * Use this offset to resume from this point.
   */
  offset: string
}

/**
 * Options for the DurableStream.follow() method.
 */
export interface FollowOptions {
  /**
   * The offset to start reading from.
   * Use '-1' to read from the beginning.
   */
  offset: string

  /**
   * Live mode for following the stream.
   */
  live?: LiveMode
}

/**
 * Interface for the Durable Streams client.
 * This matches the @durable-streams/client package API.
 */
export interface DurableStreamClient<TRow = unknown> {
  /**
   * Follow the stream from a given offset, yielding results as they arrive.
   */
  follow: (options: FollowOptions) => AsyncIterable<DurableStreamResult<TRow>>
}

/**
 * Constructor options for DurableStream client.
 */
export interface DurableStreamOptions {
  /**
   * URL of the Durable Stream endpoint.
   */
  url: string

  /**
   * HTTP headers to include in requests.
   */
  headers?: Record<string, string>
}
