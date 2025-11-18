---
id: ResultStream
title: ResultStream
---

# Type Alias: ResultStream

```ts
type ResultStream = IStreamBuilder<[unknown, [any, string | undefined]]>;
```

Defined in: [packages/db/src/types.ts:678](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L678)

Result stream type representing the output of compiled queries
Always returns [key, [result, orderByIndex]] where orderByIndex is undefined for unordered queries
