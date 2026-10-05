---
id: EnhancedPowerSyncCollectionConfig
title: EnhancedPowerSyncCollectionConfig
---

```ts
type EnhancedPowerSyncCollectionConfig<TTable, OutputType, TSchema> = CollectionConfig<OutputType, string, TSchema, PowerSyncCollectionUtils<TTable>> & object;
```

Defined in: [definitions.ts:303](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L303)

A CollectionConfig which includes utilities for PowerSync.

## Type Declaration

### id?

```ts
optional id: string;
```

### schema?

```ts
optional schema: TSchema;
```

### utils

```ts
utils: PowerSyncCollectionUtils<TTable>;
```

## Type Parameters

### TTable

`TTable` *extends* `Table`

### OutputType

`OutputType` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`
