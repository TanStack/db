---
id: StorageApi
title: StorageApi
---

# Type Alias: StorageApi

```ts
type StorageApi = Pick<Storage, "getItem" | "setItem" | "removeItem">;
```

Defined in: packages/db/src/local-storage.ts:23

Storage API interface - subset of DOM Storage that we need
