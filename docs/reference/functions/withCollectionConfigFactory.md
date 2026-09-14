---
id: withCollectionConfigFactory
title: withCollectionConfigFactory
---

# Function: withCollectionConfigFactory()

```ts
function withCollectionConfigFactory<TConfig>(config, factory): CollectionConfigWithFactory<TConfig>;
```

Defined in: [packages/db/src/client.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L81)

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

## Returns

`CollectionConfigWithFactory`\<`TConfig`\>
