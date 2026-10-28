---
id: withCollectionConfigFactory
title: withCollectionConfigFactory
---

```ts
function withCollectionConfigFactory<TConfig>(
   config, 
   factory, 
claim?): CollectionConfigWithFactory<TConfig>;
```

Defined in: [packages/db/src/client.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L99)

Adds a fresh-config materializer to an adapter options object.

Adapter option creators should use this so a module-scoped descriptor can be
materialized safely by more than one DbClient.

## Type Parameters

### TConfig

`TConfig` *extends* `AnyCollectionConfig`

## Parameters

### config

`TConfig`

### factory

(`client`) => `TConfig`

### claim?

() => `void` \| () => `void`

## Returns

`CollectionConfigWithFactory`\<`TConfig`\>
