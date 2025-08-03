---
"@tanstack/rss-db-collection": patch
---

Add RSS and Atom feed collections for TanStack DB

Introduces `@tanstack/rss-db-collection` package with:

- `rssCollectionOptions()` for RSS 2.0 feeds
- `atomCollectionOptions()` for Atom 1.0 feeds  
- Automatic polling with configurable intervals
- Built-in deduplication based on feed item IDs
- Custom transform functions for data normalization
- Full TypeScript support with proper type inference
- Error recovery and robust feed parsing
- HTTP configuration options for headers and timeouts

Both collection types provide seamless integration with TanStack DB's live queries and optimistic mutations, allowing you to sync RSS/Atom feed data and query it alongside other collection types.