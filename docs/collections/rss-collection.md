---
title: RSS Collection
---

# RSS Collection

RSS and Atom feed collections provide seamless integration between TanStack DB and RSS/Atom feeds, enabling automatic synchronization with syndicated content from blogs, news sites, and other content sources.

## Overview

The `@tanstack/rss-db-collection` package allows you to create collections that:
- Automatically sync with RSS 2.0 and Atom 1.0 feeds
- Support smart polling with configurable intervals
- Provide content-aware deduplication
- Handle RFC-compliant date parsing
- Support custom transform functions for data normalization

## Installation

```bash
npm install @tanstack/rss-db-collection @tanstack/db
```

## Basic Usage

### RSS Collection

```typescript
import { createCollection } from "@tanstack/db"
import { rssCollectionOptions } from "@tanstack/rss-db-collection"

const rssFeed = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://blog.example.com/rss.xml",
    pollingInterval: 5 * 60 * 1000, // Poll every 5 minutes
    getKey: (item) => item.guid || item.link,
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
  ...atomCollectionOptions({
    feedUrl: "https://blog.example.com/atom.xml",
    pollingInterval: 5 * 60 * 1000, // Poll every 5 minutes
    getKey: (item) => item.id,
    transform: (item) => ({
      id: item.id || "",
      title: typeof item.title === "string" ? item.title : item.title?.$text || "",
      description: typeof item.summary === "string" ? item.summary : item.summary?.$text || "",
      link: typeof item.link === "string" ? item.link : item.link?.href || "",
      publishedAt: new Date(item.published || item.updated || Date.now()),
      author: typeof item.author === "object" ? item.author?.name : item.author,
    }),
  }),
})
```

## Configuration Options

The `rssCollectionOptions` and `atomCollectionOptions` functions accept the following options:

### Required Options

- `feedUrl`: The RSS or Atom feed URL to fetch from
- `getKey`: Function to extract the unique key from an item

### Optional Options

- `pollingInterval`: Polling interval in milliseconds (default: 5 minutes, or based on feed metadata)
- `startPolling`: Whether to start polling immediately (default: `true`)
- `maxSeenItems`: Maximum items to track for deduplication (default: 1000)

### HTTP Configuration

- `httpOptions.timeout`: Request timeout in milliseconds (default: 30000)
- `httpOptions.userAgent`: Custom user agent string
- `httpOptions.headers`: Additional HTTP headers

### Transform Function

- `transform`: Custom function to normalize feed items to your desired format

### Standard Collection Options

- `id`: Unique identifier for the collection
- `schema`: Schema for validating items
- `onInsert`: Handler called when new items are discovered
- `onUpdate`: Handler called when existing items are updated
- `onDelete`: Handler called when items are deleted

## Smart Features

### Smart Polling Intervals

The RSS collection automatically detects optimal polling intervals based on feed metadata:

```typescript
// The collection will automatically detect and use appropriate intervals
const feed = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://blog.example.com/feed.xml",
    // No pollingInterval specified - will use 5 minutes default or sy:updatePeriod if available
  }),
})
```

### Content-Aware Deduplication

Unlike simple GUID-based deduplication, this collection detects when feed items with the same GUID have changed content and treats them as updates:

- **New Items**: Items with unseen GUIDs are inserted
- **Content Changes**: Items with existing GUIDs but changed content are updated
- **No Changes**: Items with existing GUIDs and unchanged content are ignored

### RFC-Compliant Date Parsing

The collection uses strict RFC 2822 (RSS) and RFC 3339 (Atom) date parsing to avoid locale-dependent issues:

```typescript
import { parseFeedDate } from "@tanstack/rss-db-collection"

// Handles various date formats reliably
const date1 = parseFeedDate("Mon, 25 Dec 2023 10:30:00 GMT") // RFC 2822
const date2 = parseFeedDate("2023-12-25T10:30:00Z") // RFC 3339
```

## Advanced Usage

### Custom Transform Function

```typescript
const newsCollection = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://news.example.com/rss.xml",
    getKey: (item) => item.guid || item.link,
    transform: (item) => ({
      id: item.guid || item.link || "",
      headline: item.title || "",
      content: item.description || "",
      url: item.link || "",
      publishedAt: new Date(item.pubDate || Date.now()),
      author: item.author,
      tags: Array.isArray(item.category) ? item.category : [item.category].filter(Boolean),
    }),
  }),
})
```

### With Mutation Handlers

```typescript
const blogCollection = createCollection({
  ...rssCollectionOptions({
    feedUrl: "https://myblog.com/rss.xml",
    getKey: (item) => item.guid || item.link,
    pollingInterval: 10 * 60 * 1000, // 10 minutes

    onInsert: async ({ transaction }) => {
      const newPosts = transaction.mutations.map((m) => m.modified)
      console.log(`New blog posts: ${newPosts.map((p) => p.title).join(", ")}`)
      await sendNewPostNotifications(newPosts)
    },

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

// Get status and clear cache
console.log(`Seen items: ${collection.utils.getSeenItemsCount()}`)
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
    getKey: (item) => item.guid || item.link,
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

## Utility Methods

The collection provides these utility methods via `collection.utils`:

- `refresh()`: Manually refresh the feed data
- `clearSeenItems()`: Clear the deduplication cache
- `getSeenItemsCount()`: Get the number of tracked items

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
