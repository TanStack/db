---
"@tanstack/query-db-collection": patch
---

Fix queryCollectionOptions to respect QueryClient defaultOptions when not overridden

Previously, when creating a QueryClient with defaultOptions (e.g., staleTime, retry, refetchOnWindowFocus), these options were ignored by queryCollectionOptions unless explicitly specified again in the collection config. This required duplicating configuration and prevented users from setting global defaults.

Now, queryCollectionOptions properly respects the QueryClient's defaultOptions as fallbacks. Options explicitly provided in queryCollectionOptions will still override the defaults.

Example - this now works as expected:

```typescript
const dbQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  },
})

queryCollectionOptions({
  id: "wallet-accounts",
  queryKey: ["wallet-accounts"],
  queryClient: dbQueryClient,
  // staleTime: Infinity is now inherited from defaultOptions
})
```
