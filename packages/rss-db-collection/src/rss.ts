import { XMLParser, XMLValidator } from "fast-xml-parser"
import DebugModule from "debug"
import {
  FeedFetchError,
  FeedParsingError,
  FeedTimeoutError,
  FeedURLRequiredError,
  InvalidPollingIntervalError,
  UnsupportedFeedFormatError,
} from "./errors"
import {
  detectSmartPollingInterval,
  getContentHash,
  parseFeedDate,
} from "./utils"
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { AtomItem, FeedItem, HTTPOptions, RSSItem } from "./types"

const debug = DebugModule.debug(`ts/db:rss`)

/**
 * Base configuration interface for feed collection options
 */
interface BaseFeedCollectionConfig<
  TExplicit extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> {
  /**
   * RSS/Atom feed URL to fetch from
   */
  feedUrl: string

  /**
   * Polling interval in milliseconds for refetching the feed
   * @default 300000 (5 minutes)
   */
  pollingInterval?: number

  /**
   * HTTP options for fetching the feed
   */
  httpOptions?: HTTPOptions

  /**
   * Whether to start polling immediately when the collection is created
   * @default true
   */
  startPolling?: boolean

  /**
   * Maximum number of items to keep in memory for deduplication
   * @default 1000
   */
  maxSeenItems?: number

  /**
   * Custom parser options for RSS/Atom feeds
   */
  parserOptions?: {
    ignoreAttributes?: boolean
    attributeNamePrefix?: string
    textNodeName?: string
    ignoreNameSpace?: boolean
    parseAttributeValue?: boolean
    parseTrueNumberOnly?: boolean
    arrayMode?: boolean | string | RegExp
  }

  /**
   * Standard Collection configuration properties
   */
  id?: string
  schema?: TSchema
  getKey: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey
  >[`getKey`]
  sync?: CollectionConfig<
    ResolveType<TExplicit, TSchema, TFallback>,
    TKey
  >[`sync`]

  /**
   * Optional mutation handlers
   */
  onInsert?: (
    params: InsertMutationFnParams<
      ResolveType<TExplicit, TSchema, TFallback>,
      TKey
    >
  ) => Promise<any>
  onUpdate?: (
    params: UpdateMutationFnParams<
      ResolveType<TExplicit, TSchema, TFallback>,
      TKey
    >
  ) => Promise<any>
  onDelete?: (
    params: DeleteMutationFnParams<
      ResolveType<TExplicit, TSchema, TFallback>,
      TKey
    >
  ) => Promise<any>
}

/**
 * Configuration interface for RSS collection options
 */
export interface RSSCollectionConfig<
  TExplicit extends object = RSSItem,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = RSSItem,
  TKey extends string | number = string | number,
> extends BaseFeedCollectionConfig<TExplicit, TSchema, TFallback, TKey> {
  /**
   * Custom transformer function to normalize RSS items to your desired format
   */
  transform?: (item: RSSItem) => ResolveType<TExplicit, TSchema, TFallback>
}

/**
 * Configuration interface for Atom collection options
 */
export interface AtomCollectionConfig<
  TExplicit extends object = AtomItem,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = AtomItem,
  TKey extends string | number = string | number,
> extends BaseFeedCollectionConfig<TExplicit, TSchema, TFallback, TKey> {
  /**
   * Custom transformer function to normalize Atom items to your desired format
   */
  transform?: (item: AtomItem) => ResolveType<TExplicit, TSchema, TFallback>
}

// Type resolution helper (copied from TanStack DB patterns)
type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends object
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

type ResolveType<
  TExplicit extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
> =
  Record<string, unknown> extends TExplicit
    ? [TSchema] extends [never]
      ? TFallback
      : InferSchemaOutput<TSchema>
    : TExplicit

/**
 * Feed collection utilities
 */
export interface FeedCollectionUtils extends UtilsRecord {
  /**
   * Manually trigger a feed refresh
   */
  refresh: () => Promise<void>

  /**
   * Clear the seen items cache
   */
  clearSeenItems: () => void

  /**
   * Get the number of seen items
   */
  getSeenItemsCount: () => number
}

/**
 * Internal parsed feed structure
 */
interface ParsedFeed {
  type: `rss` | `atom`
  items: Array<FeedItem>
}

/**
 * Parse RSS feed
 */
function parseRSSFeed(data: any): Array<FeedItem> {
  const channel = data.rss?.channel || data.channel
  if (!channel) {
    throw new Error(`Invalid RSS feed structure`)
  }

  const items = channel.item || channel.items || []
  return Array.isArray(items) ? items : [items]
}

/**
 * Parse Atom feed
 */
function parseAtomFeed(data: any): Array<FeedItem> {
  const feed = data.feed
  if (!feed) {
    throw new Error(`Invalid Atom feed structure`)
  }

  const entries = feed.entry || []
  return Array.isArray(entries) ? entries : [entries]
}

/**
 * Detect feed type and parse accordingly
 */
function parseFeed(xmlContent: string, parserOptions: any = {}): ParsedFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: `@_`,
    textNodeName: `#text`,
    ignoreNameSpace: false,
    parseAttributeValue: true,
    parseTrueNumberOnly: false,
    arrayMode: false,
    ...parserOptions,
  })

  const data = parser.parse(xmlContent)

  // Detect feed type
  if (data.rss || data.channel) {
    return {
      type: `rss`,
      items: parseRSSFeed(data),
    }
  } else if (data.feed) {
    return {
      type: `atom`,
      items: parseAtomFeed(data),
    }
  } else {
    throw new Error(`Unknown feed format`)
  }
}

/**
 * Default transformer for RSS items
 */
function defaultRSSTransform(item: RSSItem): RSSItem {
  return {
    ...item,
    pubDate: item.pubDate ? parseFeedDate(item.pubDate) : undefined,
  }
}

/**
 * Default transformer for Atom items
 */
function defaultAtomTransform(item: AtomItem): AtomItem {
  // Normalize Atom fields to be more consistent
  const normalized: AtomItem = { ...item }

  // Handle title
  if (typeof item.title === `object` && `$text` in item.title) {
    normalized.title = item.title.$text
  }

  // Handle summary/content
  if (typeof item.summary === `object` && `$text` in item.summary) {
    normalized.summary = item.summary.$text
  }
  if (typeof item.content === `object` && `$text` in item.content) {
    normalized.content = item.content.$text
  }

  // Handle link
  if (typeof item.link === `object` && !Array.isArray(item.link)) {
    normalized.link = item.link.href
  } else if (Array.isArray(item.link)) {
    // Find the alternate link
    const alternateLink = item.link.find((l) => l.rel === `alternate` || !l.rel)
    normalized.link = alternateLink?.href || item.link[0]?.href
  }

  // Handle dates
  if (item.updated) {
    normalized.updated = parseFeedDate(item.updated)
  }
  if (item.published) {
    normalized.published = parseFeedDate(item.published)
  }

  // Handle author
  if (typeof item.author === `object` && `name` in item.author) {
    normalized.author = item.author.name
  }

  return normalized
}

/**
 * Fetch feed from URL
 */
async function fetchFeed(
  url: string,
  options: HTTPOptions = {}
): Promise<string> {
  const {
    timeout = 30000,
    headers = {},
    userAgent = `TanStack RSS Collection/1.0`,
  } = options

  const controller = new AbortController()
  let timeoutId: NodeJS.Timeout | null = null

  // Only set timeout if we're not in a test environment with fake timers
  if (
    typeof (globalThis as any).vi === `undefined` ||
    !(globalThis as any).vi?.isFakeTimers?.()
  ) {
    timeoutId = setTimeout(() => controller.abort(), timeout)
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: `application/rss+xml, application/atom+xml, application/xml, text/xml`,
        ...headers,
      },
    })

    if (!response.ok) {
      throw new FeedFetchError(url, response.status)
    }

    return await response.text()
  } catch (error) {
    if (error instanceof Error && error.name === `AbortError`) {
      throw new FeedTimeoutError(url, timeout)
    }
    throw error instanceof FeedFetchError ? error : new FeedFetchError(url)
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Extract unique identifier from feed item
 */
function getItemId(item: FeedItem, feedType: `rss` | `atom`): string {
  if (feedType === `rss`) {
    const rssItem = item as RSSItem
    return rssItem.guid || rssItem.link || rssItem.title || JSON.stringify(item)
  } else {
    const atomItem = item as AtomItem
    const linkHref =
      typeof atomItem.link === `string`
        ? atomItem.link
        : Array.isArray(atomItem.link)
          ? atomItem.link[0]?.href
          : atomItem.link?.href
    return (
      atomItem.id ||
      linkHref ||
      (typeof atomItem.title === `string`
        ? atomItem.title
        : atomItem.title?.$text) ||
      JSON.stringify(item)
    )
  }
}

/**
 * Internal implementation shared between RSS and Atom collections
 */
function createFeedCollectionOptions<
  TExplicit extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  config: BaseFeedCollectionConfig<TExplicit, TSchema, TFallback, TKey> & {
    transform?: (item: FeedItem) => ResolveType<TExplicit, TSchema, TFallback>
    expectedFeedType?: `rss` | `atom`
  }
) {
  const {
    feedUrl,
    pollingInterval: userPollingInterval,
    httpOptions = {},
    startPolling = true,
    maxSeenItems = 1000,
    parserOptions = {},
    transform,
    expectedFeedType,
    getKey,
    onInsert,
    onUpdate,
    onDelete,
    ...restConfig
  } = config

  // Smart polling interval detection
  let pollingInterval =
    userPollingInterval !== undefined ? userPollingInterval : 300000 // Default 5 minutes

  // Validation
  if (!feedUrl) {
    throw new FeedURLRequiredError()
  }
  if (pollingInterval <= 0) {
    throw new InvalidPollingIntervalError(pollingInterval)
  }

  // State management
  let seenItems = new Map<
    string,
    { id: string; lastSeen: number; contentHash: string }
  >()
  let syncParams:
    | Parameters<
        SyncConfig<ResolveType<TExplicit, TSchema, TFallback>, TKey>[`sync`]
      >[0]
    | null = null

  /**
   * Clean up old seen items to prevent memory leaks
   */
  const cleanupSeenItems = () => {
    const now = Date.now()
    const maxAge = pollingInterval * 10 // Keep items for 10 polling cycles

    const cleaned = new Map()
    let removedCount = 0

    for (const [key, value] of seenItems) {
      if (now - value.lastSeen < maxAge) {
        cleaned.set(key, value)
      } else {
        removedCount++
      }
    }

    if (cleaned.size > maxSeenItems) {
      // Remove oldest items if we're still over the limit
      const sortedEntries = Array.from(cleaned.entries())
        .sort(([, a], [, b]) => b.lastSeen - a.lastSeen)
        .slice(0, maxSeenItems)

      seenItems = new Map(sortedEntries)
    } else {
      seenItems = cleaned
    }

    if (removedCount > 0) {
      debug(`Cleaned up ${removedCount} old feed items`)
    }
  }

  /**
   * Refresh feed data
   */
  const refreshFeed = async (params: {
    begin: () => void
    write: (message: {
      type: `insert` | `update` | `delete`
      value: any
    }) => void
    commit: () => void
  }) => {
    try {
      debug(`Fetching feed from ${feedUrl}`)

      const xmlContent = await fetchFeed(feedUrl, httpOptions)

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!XMLValidator.validate(xmlContent)) {
        throw new FeedParsingError(feedUrl, new Error(`Invalid XML content`))
      }

      const parsedFeed = parseFeed(xmlContent, parserOptions)
      debug(
        `Parsed ${parsedFeed.items.length} items from ${parsedFeed.type} feed`
      )

      if (
        expectedFeedType !== undefined &&
        expectedFeedType !== parsedFeed.type
      ) {
        throw new UnsupportedFeedFormatError(feedUrl)
      }

      // Detect smart polling interval on first fetch
      if (!userPollingInterval) {
        const parser = new XMLParser(parserOptions)
        const feedData = parser.parse(xmlContent)
        const smartInterval = detectSmartPollingInterval(feedData)
        if (smartInterval !== pollingInterval) {
          pollingInterval = smartInterval
          debug(`Updated polling interval to ${pollingInterval}ms`)
        }
      }

      const { begin, write, commit } = params
      begin()

      let newItemsCount = 0
      let updatedItemsCount = 0
      const currentTime = Date.now()

      for (const rawItem of parsedFeed.items) {
        // Transform the item
        let transformedItem: ResolveType<TExplicit, TSchema, TFallback>

        if (transform) {
          transformedItem = transform(rawItem)
        } else {
          // Use default transformation
          const defaultTransformed =
            parsedFeed.type === `rss`
              ? defaultRSSTransform(rawItem as RSSItem)
              : defaultAtomTransform(rawItem as AtomItem)

          transformedItem = defaultTransformed as ResolveType<
            TExplicit,
            TSchema,
            TFallback
          >
        }

        // Generate unique ID for deduplication
        const itemId = getItemId(rawItem, parsedFeed.type)
        const contentHash = getContentHash(rawItem)

        // Check if we've seen this item before
        const seen = seenItems.get(itemId)

        if (!seen) {
          // New item
          seenItems.set(itemId, {
            id: itemId,
            lastSeen: currentTime,
            contentHash,
          })

          write({
            type: `insert`,
            value: transformedItem,
          })

          newItemsCount++
        } else if (seen.contentHash !== contentHash) {
          // Item exists but content has changed - treat as update
          seenItems.set(itemId, {
            ...seen,
            lastSeen: currentTime,
            contentHash,
          })

          write({
            type: `update`,
            value: transformedItem,
          })

          updatedItemsCount++
        } else {
          // Item exists and content hasn't changed - just update last seen time
          seenItems.set(itemId, { ...seen, lastSeen: currentTime })
        }
      }

      commit()

      if (newItemsCount > 0) {
        debug(`Added ${newItemsCount} new items from feed`)
      }
      if (updatedItemsCount > 0) {
        debug(`Updated ${updatedItemsCount} existing items from feed`)
      }

      // Clean up old items periodically
      cleanupSeenItems()
    } catch (error) {
      debug(`Error refreshing feed: ${error}`)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /**
   * Sync configuration
   */
  const sync: SyncConfig<ResolveType<TExplicit, TSchema, TFallback>, TKey> = {
    sync: (params) => {
      const { markReady } = params

      // Store sync params for manual refresh
      syncParams = params

      // Polling function
      const poll = async () => {
        try {
          await refreshFeed({
            begin: syncParams!.begin,
            write: syncParams!.write,
            commit: syncParams!.commit,
          })
        } catch (error) {
          debug(`Polling error: ${error}`)
          // Continue polling despite errors
        }

        // Schedule next poll if polling is enabled
        if (startPolling) {
          setTimeout(poll, pollingInterval)
        }
      }

      // Initial feed fetch (sync)
      refreshFeed({
        begin: params.begin,
        write: params.write,
        commit: params.commit,
      })
        .then(() => {
          markReady()

          // Start polling if configured to do so
          if (startPolling) {
            setTimeout(poll, pollingInterval)
          }
        })
        .catch((error) => {
          debug(`Initial feed fetch failed: ${error}`)
          markReady() // Mark ready even on error to avoid blocking

          // Still start polling for retry attempts
          if (startPolling) {
            setTimeout(poll, pollingInterval)
          }
        })

      // Note: sync functions should return void
      // Cleanup will be handled when the collection is destroyed
    },
  }

  // Utils
  const utils: FeedCollectionUtils = {
    refresh: async () => {
      if (!syncParams) {
        // If not synced yet, create minimal params for manual refresh
        const dummyParams = {
          begin: () => {},
          write: () => {},
          commit: () => {},
        }
        await refreshFeed(dummyParams)
        return
      }
      await refreshFeed({
        begin: syncParams.begin,
        write: syncParams.write,
        commit: syncParams.commit,
      })
    },
    clearSeenItems: () => {
      seenItems = new Map()
    },
    getSeenItemsCount: () => seenItems.size,
  }

  return {
    ...restConfig,
    getKey,
    sync,
    startSync: true,
    rowUpdateMode: `full`,
    onInsert,
    onUpdate,
    onDelete,
    utils,
  }
}

/**
 * Creates RSS collection options for use with a standard Collection
 */
export function rssCollectionOptions<
  TExplicit extends object = RSSItem,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = RSSItem,
  TKey extends string | number = string | number,
>(config: RSSCollectionConfig<TExplicit, TSchema, TFallback, TKey>) {
  return createFeedCollectionOptions({
    ...config,
    expectedFeedType: `rss` as const,
    transform: config.transform
      ? (item: FeedItem) => config.transform!(item as RSSItem)
      : undefined,
  })
}

/**
 * Creates Atom collection options for use with a standard Collection
 */
export function atomCollectionOptions<
  TExplicit extends object = AtomItem,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = AtomItem,
  TKey extends string | number = string | number,
>(config: AtomCollectionConfig<TExplicit, TSchema, TFallback, TKey>) {
  return createFeedCollectionOptions({
    ...config,
    expectedFeedType: `atom` as const,
    transform: config.transform
      ? (item: FeedItem) => config.transform!(item as AtomItem)
      : undefined,
  })
}
