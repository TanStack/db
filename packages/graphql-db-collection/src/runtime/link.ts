import { print } from "graphql"
import type { DocumentNode } from "graphql"

/**
 * GraphQL Link - handles transport, batching, and error handling
 *
 * This is inspired by Apollo Link but simplified for our use case.
 * Supports HTTP POST, automatic batching, and WebSocket subscriptions.
 */

export interface GraphQLLinkConfig {
  /** HTTP endpoint */
  endpoint: string
  /** WebSocket endpoint (optional, for subscriptions) */
  wsEndpoint?: string
  /** Headers function */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /** Enable batching (default: true) */
  batching?: boolean
  /** Batch interval in ms (default: 10) */
  batchInterval?: number
  /** Enable credentials (default: 'same-origin') */
  credentials?: RequestCredentials
  /** Custom fetch function */
  fetch?: typeof fetch
}

export interface GraphQLRequest {
  query: string | DocumentNode
  variables?: Record<string, unknown>
  operationName?: string
  signal?: AbortSignal
}

export interface GraphQLResponse<T = any> {
  data?: T
  errors?: Array<{
    message: string
    locations?: Array<{ line: number; column: number }>
    path?: Array<string | number>
    extensions?: Record<string, unknown>
  }>
  extensions?: Record<string, unknown>
}

interface PendingRequest {
  request: GraphQLRequest
  resolve: (value: GraphQLResponse) => void
  reject: (error: Error) => void
}

/**
 * GraphQL Link for executing operations
 */
export class GraphQLLink {
  private config: Required<
    Omit<GraphQLLinkConfig, `wsEndpoint` | `headers`>
  > & {
    wsEndpoint?: string
    headers?: () => Record<string, string> | Promise<Record<string, string>>
  }
  private batchQueue: Array<PendingRequest> = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: GraphQLLinkConfig) {
    this.config = {
      batching: true,
      batchInterval: 10,
      credentials: `same-origin`,
      fetch: globalThis.fetch,
      ...config,
    }
  }

  /**
   * Execute a single GraphQL operation
   */
  async execute<T = any>(
    document: DocumentNode,
    variables?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T> {
    const query = print(document)
    const request: GraphQLRequest = { query, variables, signal }

    if (this.config.batching) {
      return this.executeBatched<T>(request)
    }

    return this.executeSingle<T>(request)
  }

  /**
   * Execute a request immediately (no batching)
   */
  private async executeSingle<T>(request: GraphQLRequest): Promise<T> {
    const headers = await this.getHeaders()
    const query =
      typeof request.query === `string` ? request.query : print(request.query)

    const response = await this.config.fetch(this.config.endpoint, {
      method: `POST`,
      headers: {
        "Content-Type": `application/json`,
        ...headers,
      },
      body: JSON.stringify({
        query,
        variables: request.variables,
        operationName: request.operationName,
      }),
      credentials: this.config.credentials,
      signal: request.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result: GraphQLResponse<T> = await response.json()

    if (result.errors && result.errors.length > 0) {
      const error = new GraphQLError(result.errors[0].message, result.errors)
      throw error
    }

    return result.data!
  }

  /**
   * Execute a request with batching
   */
  private executeBatched<T>(request: GraphQLRequest): Promise<T> {
    return new Promise<GraphQLResponse<T>>((resolve, reject) => {
      this.batchQueue.push({ request, resolve, reject })

      if (this.batchTimer === null) {
        this.batchTimer = setTimeout(() => {
          this.flushBatch()
        }, this.config.batchInterval)
      }
    }).then((response) => {
      if (response.errors && response.errors.length > 0) {
        throw new GraphQLError(response.errors[0].message, response.errors)
      }
      return response.data!
    })
  }

  /**
   * Flush the batch queue and execute all pending requests
   */
  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) {
      return
    }

    const queue = this.batchQueue.slice()
    this.batchQueue = []
    this.batchTimer = null

    if (queue.length === 1) {
      // Single request, execute normally
      const { request, resolve, reject } = queue[0]
      try {
        const result = await this.executeSingle(request)
        resolve({ data: result })
      } catch (error) {
        reject(error as Error)
      }
      return
    }

    // Multiple requests, batch them
    try {
      const headers = await this.getHeaders()

      const operations = queue.map((item) => ({
        query:
          typeof item.request.query === `string`
            ? item.request.query
            : print(item.request.query),
        variables: item.request.variables,
        operationName: item.request.operationName,
      }))

      const response = await this.config.fetch(this.config.endpoint, {
        method: `POST`,
        headers: {
          "Content-Type": `application/json`,
          ...headers,
        },
        body: JSON.stringify(operations),
        credentials: this.config.credentials,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const results: Array<GraphQLResponse> = await response.json()

      // Resolve each request with its result
      for (let i = 0; i < queue.length; i++) {
        const { resolve } = queue[i]
        const result = results[i]
        resolve(result)
      }
    } catch (error) {
      // Reject all pending requests
      for (const { reject } of queue) {
        reject(error as Error)
      }
    }
  }

  /**
   * Get headers for the request
   */
  private async getHeaders(): Promise<Record<string, string>> {
    if (!this.config.headers) {
      return {}
    }
    return await this.config.headers()
  }

  /**
   * Cancel all pending batched requests
   */
  cancel(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    for (const { reject } of this.batchQueue) {
      reject(new Error(`Request cancelled`))
    }

    this.batchQueue = []
  }
}

/**
 * Custom GraphQL error class
 */
export class GraphQLError extends Error {
  constructor(
    message: string,
    public errors: Array<{
      message: string
      locations?: Array<{ line: number; column: number }>
      path?: Array<string | number>
      extensions?: Record<string, unknown>
    }>
  ) {
    super(message)
    this.name = `GraphQLError`
  }
}

/**
 * Create a GraphQL link
 */
export function createGraphQLLink(config: GraphQLLinkConfig): GraphQLLink {
  return new GraphQLLink(config)
}
