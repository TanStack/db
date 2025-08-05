/**
 * Types for RSS feed items
 */
export interface RSSItem {
  title?: string
  description?: string
  link?: string
  guid?: string
  pubDate?: string | Date
  author?: string
  category?: string | Array<string>
  enclosure?: {
    url: string
    type?: string
    length?: string
  }
  [key: string]: any
}

/**
 * Types for Atom feed items
 */
export interface AtomItem {
  title?: string | { $text?: string; type?: string }
  summary?: string | { $text?: string; type?: string }
  content?: string | { $text?: string; type?: string }
  link?:
    | string
    | { href?: string; rel?: string; type?: string }
    | Array<{ href?: string; rel?: string; type?: string }>
  id?: string
  updated?: string | Date
  published?: string | Date
  author?: string | { name?: string; email?: string; uri?: string }
  category?:
    | string
    | { term?: string; label?: string }
    | Array<{ term?: string; label?: string }>
  [key: string]: any
}

/**
 * Union type for feed items
 */
export type FeedItem = RSSItem | AtomItem

/**
 * Feed type detection
 */
export type FeedType = `rss` | `atom` | `auto`

/**
 * HTTP options for fetching feeds
 */
export interface HTTPOptions {
  timeout?: number
  headers?: Record<string, string>
  userAgent?: string
}

/**
 * Parsed feed data structure from XMLParser
 */
export interface ParsedFeedData {
  rss?: {
    channel?: {
      title?: string
      description?: string
      link?: string
      "sy:updatePeriod"?: string
      "sy:updateFrequency"?: string | number
      item?: Array<Record<string, any>>
      [key: string]: any
    }
    [key: string]: any
  }
  feed?: {
    title?: string
    subtitle?: string
    link?: string
    "sy:updatePeriod"?: string
    "sy:updateFrequency"?: string | number
    entry?: Array<Record<string, any>>
    [key: string]: any
  }
  [key: string]: any
}
