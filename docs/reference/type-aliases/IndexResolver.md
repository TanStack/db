---
id: IndexResolver
title: IndexResolver
---

# Type Alias: IndexResolver\<TKey\>

```ts
type IndexResolver<TKey> = 
  | IndexConstructor<TKey>
| () => Promise<IndexConstructor<TKey>>;
```

Defined in: packages/db/src/indexes/base-index.ts:225

Index resolver can be either a class constructor or async loader

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
