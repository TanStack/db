/**
 * Type declarations for @durable-streams/client
 *
 * This module provides client types for the Durable Streams protocol.
 * See: https://github.com/durable-streams/durable-streams
 */

declare module '@durable-streams/client' {
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

  export interface FollowOptions {
    /**
     * The offset to start reading from.
     * Use '-1' to read from the beginning.
     */
    offset: string

    /**
     * Live mode for following the stream.
     * - 'long-poll': HTTP long-polling (default)
     * - 'sse': Server-Sent Events
     */
    live?: 'long-poll' | 'sse'
  }

  export interface StreamResult<TData = unknown> {
    /**
     * The data from this batch.
     * In JSON mode, this is an array of parsed JSON objects.
     */
    data: TData

    /**
     * The Stream-Next-Offset for this batch.
     * Use this offset to resume from this point.
     */
    offset: string
  }

  export interface ReadOptions {
    /**
     * The offset to start reading from.
     */
    offset?: string
  }

  export interface ReadResult<TData = unknown> extends StreamResult<TData> {}

  /**
   * Durable Streams client for reading from a Durable Stream.
   *
   * @example
   * ```typescript
   * const stream = new DurableStream({ url: 'https://api.example.com/v1/stream/events' })
   *
   * // Read from a specific offset
   * const result = await stream.read({ offset: '-1' })
   * console.log(result.data, result.offset)
   *
   * // Follow the stream live
   * for await (const result of stream.follow({ offset: '-1', live: 'long-poll' })) {
   *   console.log(result.data, result.offset)
   * }
   * ```
   */
  export class DurableStream<TData = unknown> {
    constructor(options: DurableStreamOptions)

    /**
     * Read data from the stream starting at the given offset.
     */
    read(options?: ReadOptions): Promise<ReadResult<TData>>

    /**
     * Follow the stream from a given offset, yielding results as they arrive.
     * This is an async iterator that yields results continuously.
     */
    follow(options: FollowOptions): AsyncIterable<StreamResult<TData>>
  }
}
