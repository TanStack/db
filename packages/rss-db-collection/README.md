# @tanstack/rss-db-collection

RSS/Atom feed collection for TanStack DB - sync data from RSS and Atom feeds with automatic polling, deduplication, and type safety.

## Features

- **📡 RSS & Atom Support**: Dedicated option creators for RSS 2.0 and Atom 1.0 feeds
- **🔄 Automatic Polling**: Configurable polling intervals with intelligent error recovery and manual refresh capability
- **✨ Deduplication**: Built-in deduplication based on feed item IDs/GUIDs
- **🔧 Transform Functions**: Custom transform functions to normalize feed data to your schema
- **📝 Full TypeScript Support**: Complete type safety with schema inference
- **🎛️ Mutation Handlers**: Support for `onInsert`, `onUpdate`, and `onDelete` callbacks
- **⚡ Optimistic Updates**: Seamless integration with TanStack DB's optimistic update system

## Installation

```bash
npm install @tanstack/rss-db-collection
# or
pnpm add @tanstack/rss-db-collection
# or
yarn add @tanstack/rss-db-collection
```

## Quick Start

### RSS Collection

```typescript
import { createCollection } from "@tanstack/db"
import { rssCollectionOptions } from "@tanstack/rss-db-collection"

interface BlogPost {
  id: string
  title: string
  description: string
  link: string
  publishedAt: Date
  author?: string
}

const rssFeed = createCollection({
  ...rssCollectionOptions<BlogPost>({
    feedUrl: "https://blog.example.com/rss.xml",
    pollingInterval: 5 * 60 * 1000, // Poll every 5 minutes
    getKey: (item) => item.id,
    transform: (item) => ({
      id: item.guid || item.link || "",
      title: item.title || "",
      description: item.description || "",
      link: item.link || "",
      publishedAt: new Date(item.pubDate || Date.now()),
      author: item.author,
    }),
  }),
})
```

### Atom Collection

```typescript
import { createCollection } from "@tanstack/db"
import { atomCollectionOptions } from "@tanstack/rss-db-collection"

const atomFeed = createCollection({
  ...atomCollectionOptions<BlogPost>({
    feedUrl: "https://blog.example.com/atom.xml",
    pollingInterval: 5 * 60 * 1000, // Poll every 5 minutes
    getKey: (item) => item.id,
    transform: (item) => ({
      id: item.id || "",
      title:
        typeof item.title === "string" ? item.title : item.title?.$text || "",
      description:
        typeof item.summary === "string"
          ? item.summary
          : item.summary?.$text || "",
      link: typeof item.link === "string" ? item.link : item.link?.href || "",
      publishedAt: new Date(item.published || item.updated || Date.now()),
      author: typeof item.author === "object" ? item.author?.name : item.author,
    }),
  }),
})
```

## Configuration Options

### RSS Collection Configuration

```typescript
interface RSSCollectionConfig {
  // Required
  feedUrl: string // RSS feed URL
  getKey: (item: T) => string // Extract unique key from item

  // Optional
  pollingInterval?: number // Polling interval in ms (default: 300000 = 5 minutes)
  startPolling?: boolean // Start polling immediately (default: true)
  maxSeenItems?: number // Max items to track for deduplication (default: 1000)

  // HTTP Configuration
  httpOptions?: {
    timeout?: number // Request timeout in ms (default: 30000)
    userAgent?: string // Custom user agent
    headers?: Record<string, string> // Additional headers
  }

  // Parsing Configuration
  parserOptions?: {
    ignoreAttributes?: boolean
    attributeNamePrefix?: string
    textNodeName?: string
    // ... other fast-xml-parser options
  }

  // Transform Function
  transform?: (item: RSSItem) => T // Transform RSS items to your type

  // Standard Collection Options
  id?: string
  schema?: StandardSchemaV1
  onInsert?: (params) => Promise<any>
  onUpdate?: (params) => Promise<any>
  onDelete?: (params) => Promise<any>
}
```

### Atom Collection Configuration

```typescript
interface AtomCollectionConfig {
  // Required
  feedUrl: string // Atom feed URL
  getKey: (item: T) => string // Extract unique key from item

  // Optional
  pollingInterval?: number // Polling interval in ms (default: 300000 = 5 minutes)
  startPolling?: boolean // Start polling immediately (default: true)
  maxSeenItems?: number // Max items to track for deduplication (default: 1000)

  // HTTP Configuration
  httpOptions?: {
    timeout?: number // Request timeout in ms (default: 30000)
    userAgent?: string // Custom user agent
    headers?: Record<string, string> // Additional headers
  }

  // Parsing Configuration
  parserOptions?: {
    ignoreAttributes?: boolean
    attributeNamePrefix?: string
    textNodeName?: string
    // ... other fast-xml-parser options
  }

  // Transform Function
  transform?: (item: AtomItem) => T // Transform Atom items to your type

  // Standard Collection Options
  id?: string
  schema?: StandardSchemaV1
  onInsert?: (params) => Promise<any>
  onUpdate?: (params) => Promise<any>
  onDelete?: (params) => Promise<any>
}
```

## Feed Type Support

### RSS 2.0

```typescript
interface RSSItem {
  title?: string
  description?: string
  link?: string
  guid?: string
  pubDate?: string | Date
  author?: string
  category?: string | string[]
  enclosure?: {
    url: string
    type?: string
    length?: string
  }
  [key: string]: any
}
```

### Atom 1.0

```typescript
interface AtomItem {
  title?: string | { $text?: string; type?: string }
  summary?: string | { $text?: string; type?: string }
  content?: string | { $text?: string; type?: string }
  link?: string | { href?: string; rel?: string; type?: string } | Array<...>
  id?: string
  updated?: string | Date
  published?: string | Date
  author?: string | { name?: string; email?: string; uri?: string }
  category?: string | { term?: string; label?: string } | Array<...>
  [key: string]: any
}
```

## Advanced Usage

### Custom RSS Transform Function

```typescript
const newsCollection = createCollection({
  ...rssCollectionOptions<NewsArticle>({
    feedUrl: "https://news.example.com/rss.xml",
    getKey: (item) => item.id,
    transform: (item) => {
      return {
        id: item.guid || item.link || "",
        headline: item.title || "",
        content: item.description || "",
        url: item.link || "",
        publishedAt: new Date(item.pubDate || Date.now()),
        author: item.author,
        tags: Array.isArray(item.category)
          ? item.category
          : [item.category].filter(Boolean),
      }
    },
  }),
})
```

### Custom Atom Transform Function

```typescript
const blogCollection = createCollection({
  ...atomCollectionOptions<BlogPost>({
    feedUrl: "https://blog.example.com/atom.xml",
    getKey: (item) => item.id,
    transform: (item) => {
      return {
        id: item.id || "",
        title:
          typeof item.title === "string" ? item.title : item.title?.$text || "",
        content:
          typeof item.content === "string"
            ? item.content
            : item.content?.$text || "",
        url: typeof item.link === "string" ? item.link : item.link?.href || "",
        publishedAt: new Date(item.published || item.updated || Date.now()),
        author:
          typeof item.author === "object" ? item.author?.name : item.author,
        tags: Array.isArray(item.category)
          ? item.category.map((c) => c.term || c.label).filter(Boolean)
          : item.category
            ? [item.category.term || item.category.label].filter(Boolean)
            : [],
      }
    },
  }),
})
```

### With Mutation Handlers

```typescript
const blogCollection = createCollection({
  ...rssCollectionOptions<BlogPost>({
    feedUrl: "https://myblog.com/rss.xml",
    getKey: (item) => item.id,
    pollingInterval: 10 * 60 * 1000, // 10 minutes

    // Handle when new posts are fetched
    onInsert: async ({ transaction }) => {
      const newPosts = transaction.mutations.map((m) => m.modified)
      console.log(`New blog posts: ${newPosts.map((p) => p.title).join(", ")}`)

      // Send notifications, update analytics, etc.
      await sendNewPostNotifications(newPosts)
    },

    // Handle manual updates to posts
    onUpdate: async ({ transaction }) => {
      const updates = transaction.mutations.map((m) => ({
        id: m.key,
        changes: m.changes,
      }))

      await syncUpdatesToServer(updates)
    },
  }),
})
```

### Manual Refresh

```typescript
const collection = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://example.com/feed.xml",
    getKey: (item) => item.guid || item.link,
    startPolling: false, // Don't start automatically
  }),
})

// Manually refresh the feed
await collection.utils.refresh()
console.log("Feed refreshed!")

// Get status
console.log(`Seen items: ${collection.utils.getSeenItemsCount()}`)

// Clear deduplication cache
collection.utils.clearSeenItems()
```

### Schema Integration

```typescript
import { z } from "zod"

const blogPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  link: z.string().url(),
  publishedAt: z.date(),
  author: z.string().optional(),
})

const typedBlogCollection = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://blog.example.com/feed.xml",
    schema: blogPostSchema, // Automatic type inference
    getKey: (item) => item.id,
    transform: (item) => ({
      // Transform to match schema
      id: item.guid || item.link || "",
      title: item.title || "",
      description: item.description || "",
      link: item.link || "",
      publishedAt: new Date(item.pubDate || Date.now()),
      author: item.author,
    }),
  }),
})
```

## Error Handling

Both RSS and Atom collections handle various error scenarios gracefully:

```typescript
const resilientCollection = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://unreliable-feed.com/rss.xml",
    getKey: (item) => item.guid || item.link,
    pollingInterval: 60000, // 1 minute - will retry on errors

    httpOptions: {
      timeout: 10000, // 10 second timeout
      headers: {
        "User-Agent": "My App/1.0",
      },
    },

    onInsert: async ({ transaction }) => {
      try {
        await processNewItems(transaction.mutations.map((m) => m.modified))
      } catch (error) {
        console.error("Failed to process items:", error)
        // Error handling - the collection will continue working
      }
    },
  }),
})
```

Common error scenarios handled:

- Network timeouts and failures
- Invalid XML or malformed feeds
- HTTP error responses (404, 500, etc.)
- Feed parsing errors
- Transform function errors
- Mutation handler errors

## Utilities

### Collection Utils

```typescript
// Available on collection.utils for both RSS and Atom collections
interface FeedCollectionUtils {
  refresh(): Promise<void> // Manual feed refresh
  clearSeenItems(): void // Clear deduplication cache
  getSeenItemsCount(): number // Get number of tracked items
}
```

## API Reference

### RSS Collection

- `rssCollectionOptions<T>(config: RSSCollectionConfig<T>)` - Creates RSS collection options
- `RSSCollectionConfig<T>` - RSS collection configuration interface
- `RSSItem` - RSS feed item type

### Atom Collection

- `atomCollectionOptions<T>(config: AtomCollectionConfig<T>)` - Creates Atom collection options
- `AtomCollectionConfig<T>` - Atom collection configuration interface
- `AtomItem` - Atom feed item type

### Shared Types

- `FeedCollectionUtils` - Utilities available on both collection types
- `HTTPOptions` - HTTP configuration options
- `FeedItem` - Union type of RSS and Atom items

## Performance Considerations

### Memory Management

- **Deduplication Cache**: Limited by `maxSeenItems` (default: 1000)
- **Automatic Cleanup**: Old items are cleaned up after 10 polling cycles
- **Memory-Efficient**: Only tracks item IDs, not full content

### Network Optimization

- **Conditional Requests**: Respects HTTP caching headers
- **Timeout Management**: Configurable timeouts prevent hanging requests
- **Error Recovery**: Continues polling after network failures

### Polling Best Practices

```typescript
// Good: Reasonable polling intervals
pollingInterval: 5 * 60 * 1000 // 5 minutes

// Avoid: Too frequent polling
pollingInterval: 10 * 1000 // 10 seconds - may overwhelm server

// Consider: Feed update frequency
pollingInterval: 60 * 60 * 1000 // 1 hour for infrequently updated feeds
```

## License

MIT
