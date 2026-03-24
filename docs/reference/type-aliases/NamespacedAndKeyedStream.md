---
id: NamespacedAndKeyedStream
title: NamespacedAndKeyedStream
---

# Type Alias: NamespacedAndKeyedStream

```ts
type NamespacedAndKeyedStream = IStreamBuilder<KeyedNamespacedRow>;
```

Defined in: [packages/db/src/types.ts:779](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L779)

A namespaced and keyed stream is a stream of rows
This is used throughout a query pipeline and as the output from a query without
a `select` clause.
