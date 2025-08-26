# @tanstack/rss-db-collection

RSS/Atom feed collection for TanStack DB - sync data from RSS and Atom feeds with automatic polling, deduplication, and type safety.

## Features

- **📡 RSS & Atom Support**: Dedicated option creators for RSS 2.0 and Atom 1.0 feeds
- **🔄 Smart Polling**: Configurable polling intervals with automatic detection based on feed metadata
- **✨ Content-Aware Deduplication**: Built-in deduplication that detects content changes for existing GUIDs
- **📅 RFC-Compliant Date Parsing**: Strict RFC 2822/3339 date parsing for reliable timezone handling
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

```typescript
import { createCollection } from "@tanstack/db"
import { rssCollectionOptions } from "@tanstack/rss-db-collection"

const blogFeed = createCollection({
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

## Documentation

For complete documentation, examples, and API reference, visit the [TanStack DB documentation](https://tanstack.com/db/latest/docs/overview).

## License

MIT
