/**
 * Base error class for RSS Collection errors
 */
export abstract class RSSCollectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * Error thrown when feed URL is required but not provided
 */
export class FeedURLRequiredError extends RSSCollectionError {
  constructor() {
    super(`Feed URL is required for RSS collection`)
  }
}

/**
 * Error thrown when polling interval is invalid
 */
export class InvalidPollingIntervalError extends RSSCollectionError {
  constructor(interval: number) {
    super(
      `Invalid polling interval: ${interval}. Must be a positive number in milliseconds.`
    )
  }
}

/**
 * Error thrown when feed parsing fails
 */
export class FeedParsingError extends RSSCollectionError {
  constructor(url: string, originalError: Error) {
    super(`Failed to parse feed from ${url}: ${originalError.message}`)
    this.cause = originalError
  }
}

/**
 * Error thrown when feed fetch fails
 */
export class FeedFetchError extends RSSCollectionError {
  constructor(url: string, status?: number) {
    super(
      status
        ? `Failed to fetch feed from ${url}: HTTP ${status}`
        : `Failed to fetch feed from ${url}`
    )
  }
}

/**
 * Error thrown when timeout occurs while fetching feed
 */
export class FeedTimeoutError extends RSSCollectionError {
  constructor(url: string, timeout: number) {
    super(`Timeout after ${timeout}ms while fetching feed from ${url}`)
  }
}

/**
 * Error thrown when feed format is not supported
 */
export class UnsupportedFeedFormatError extends RSSCollectionError {
  constructor(url: string) {
    super(
      `Unsupported feed format from ${url}. Only RSS and Atom feeds are supported.`
    )
  }
}

/**
 * Error thrown when required getKey function is not provided
 */
export class GetKeyRequiredError extends RSSCollectionError {
  constructor() {
    super(`getKey function is required for RSS collection`)
  }
}
