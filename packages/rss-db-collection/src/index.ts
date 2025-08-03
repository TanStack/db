/**
 * RSS/Atom Feed Collection for TanStack DB
 *
 * This package provides RSS and Atom feed collection capabilities with:
 * - Automatic feed type detection (RSS/Atom)
 * - Configurable polling intervals
 * - Built-in deduplication
 * - Custom transform functions
 * - Full TypeScript support
 *
 * @example RSS Collection
 * ```typescript
 * import { createCollection } from '@tanstack/db'
 * import { rssCollectionOptions } from '@tanstack/rss-db-collection'
 *
 * interface BlogPost {
 *   id: string
 *   title: string
 *   description: string
 *   link: string
 *   publishedAt: Date
 * }
 *
 * const blogFeed = createCollection({
 *   ...rssCollectionOptions<BlogPost>({
 *     feedUrl: 'https://blog.example.com/rss.xml',
 *     pollingInterval: 5 * 60 * 1000, // 5 minutes
 *     getKey: (item) => item.id,
 *     transform: (item) => ({
 *       id: item.guid || item.link || '',
 *       title: item.title || '',
 *       description: item.description || '',
 *       link: item.link || '',
 *       publishedAt: new Date(item.pubDate || Date.now())
 *     })
 *   })
 * })
 * ```
 *
 * @example Atom Collection
 * ```typescript
 * import { createCollection } from '@tanstack/db'
 * import { atomCollectionOptions } from '@tanstack/rss-db-collection'
 *
 * const atomFeed = createCollection({
 *   ...atomCollectionOptions<BlogPost>({
 *     feedUrl: 'https://blog.example.com/atom.xml',
 *     pollingInterval: 5 * 60 * 1000, // 5 minutes
 *     getKey: (item) => item.id,
 *     transform: (item) => ({
 *       id: item.id || '',
 *       title: typeof item.title === 'string' ? item.title : item.title?.$text || '',
 *       description: typeof item.summary === 'string' ? item.summary : item.summary?.$text || '',
 *       link: typeof item.link === 'string' ? item.link : item.link?.href || '',
 *       publishedAt: new Date(item.published || item.updated || Date.now())
 *     })
 *   })
 * })
 * ```
 */

// RSS collection functionality
export {
  rssCollectionOptions,
  type RSSCollectionConfig,
  type RSSItem,
} from "./rss"

// Atom collection functionality
export {
  atomCollectionOptions,
  type AtomCollectionConfig,
  type AtomItem,
} from "./rss"

// Shared types and utilities
export {
  type FeedItem,
  type FeedType,
  type HTTPOptions,
  type FeedCollectionUtils,
} from "./rss"

// Error types
export {
  RSSCollectionError,
  FeedURLRequiredError,
  InvalidPollingIntervalError,
  FeedParsingError,
  FeedFetchError,
  FeedTimeoutError,
  UnsupportedFeedFormatError,
  GetKeyRequiredError,
} from "./errors"
