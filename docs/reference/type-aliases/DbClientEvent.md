---
id: DbClientEvent
title: DbClientEvent
---

# Type Alias: DbClientEvent

```ts
type DbClientEvent = 
  | {
  query: DbClientLiveQuery;
  type: "liveQueryAdded" | "liveQueryUpdated";
}
  | {
  error: unknown;
  type: "liveQueryStreamError";
};
```

Defined in: [packages/db/src/client.ts:145](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L145)
