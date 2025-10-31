# Cloudflare Workers Compatibility

TanStack DB automatically detects when running in Cloudflare Workers runtime and defers collection initialization to prevent "Disallowed operation called within global scope" errors.

## Automatic Detection

Starting from version 0.5.0, `createCollection` automatically detects Cloudflare Workers runtime using `navigator.userAgent === 'Cloudflare-Workers'` and applies lazy initialization when needed.

```typescript
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

// This works in Cloudflare Workers without any changes!
export const missionsCollection = createCollection(
  queryCollectionOptions({
    queryKey: orpc.missions.list.queryKey(),
    queryFn: () => orpc.missions.list.call(),
    queryClient,
    getKey: (item) => item.id,
  })
)
```

## How It Works

In Cloudflare Workers, certain operations (like creating Promises or using the crypto API) are not allowed in the global scope. TanStack DB solves this by:

1. Detecting the Cloudflare Workers runtime environment
2. Wrapping the collection in a transparent lazy-loading proxy
3. Deferring initialization until the first property access (which happens during request handling, not at module load time)

The proxy is completely transparent - you use the collection exactly as you would in any other environment.

## Manual Lazy Loading (Advanced)

If you need to apply lazy loading to other resources, you can use the `lazyInitForWorkers` utility function:

```typescript
import { lazyInitForWorkers } from "@tanstack/db"

export const myResource = lazyInitForWorkers(() => {
  // This code only runs when myResource is first accessed
  return createExpensiveResource()
})
```

## Performance Considerations

The lazy initialization approach has minimal performance impact:

- **Singleton behavior**: The collection is only initialized once, on first access
- **Transparent proxy**: All operations are passed directly to the underlying instance
- **No overhead after initialization**: Once initialized, there's no proxying overhead

## Query Collection Synchronization

When using query collections (TanStack Query integration), the synchronization works correctly with lazy initialization:

- The query client is used as the data source
- Multiple lazy collections can share the same query client
- Each collection maintains its own subscription to the query client
- Changes in the query client are propagated to all collections

## Live Queries

Live queries work seamlessly with lazy initialization:

- Collections subscribe to other collections on first access
- Reactivity is maintained through the query client
- No additional configuration needed

## Testing

When testing code that uses collections in a simulated Cloudflare Workers environment:

```typescript
// Mock Cloudflare Workers environment
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Cloudflare-Workers" },
  writable: true,
  configurable: true,
})

// Your collections will automatically use lazy initialization
const collection = createCollection(...)
```

## Troubleshooting

### Collection is undefined or null

Make sure you're accessing the collection during request handling, not at module load time:

```typescript
// ❌ BAD: Don't do this at module level
const data = collection.toArray // This runs at module load

// ✅ GOOD: Access during request handling
export default {
  async fetch(request: Request) {
    const data = collection.toArray // This runs during request
    return Response.json(data)
  },
}
```

### Type errors with lazy collections

The lazy proxy should be completely transparent to TypeScript, but if you encounter type issues, you can cast to `any` for specific operations:

```typescript
const collection = createCollection(...) as any
```

However, this should rarely be necessary - please report any type issues you encounter!
