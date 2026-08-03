---
id: StorageApi
title: StorageApi
---

# Type Alias: StorageApi

```ts
type StorageApi = Pick<Storage, "getItem" | "setItem" | "removeItem">;
```

Defined in: [packages/db/src/local-storage.ts:24](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L24)

Storage API interface - subset of DOM Storage that we need
