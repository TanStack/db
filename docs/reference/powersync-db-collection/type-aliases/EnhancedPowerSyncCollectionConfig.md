---
id: EnhancedPowerSyncCollectionConfig
title: EnhancedPowerSyncCollectionConfig
---

# Type Alias: EnhancedPowerSyncCollectionConfig\<TTable, OutputType, TSchema\>

```ts
type EnhancedPowerSyncCollectionConfig<TTable, OutputType, TSchema> = CollectionConfig<OutputType, string, TSchema> & object;
```

Defined in: definitions.ts:254

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
