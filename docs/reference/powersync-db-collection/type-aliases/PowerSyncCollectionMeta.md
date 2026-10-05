---
id: PowerSyncCollectionMeta
title: PowerSyncCollectionMeta
---

```ts
type PowerSyncCollectionMeta<TTable> = object;
```

Defined in: [definitions.ts:279](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L279)

Metadata for the PowerSync Collection.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### metadataIsTracked

```ts
metadataIsTracked: boolean;
```

Defined in: [definitions.ts:297](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L297)

Whether the PowerSync table tracks metadata.

***

### serializeValue()

```ts
serializeValue: (value) => ExtractedTable<TTable>;
```

Defined in: [definitions.ts:292](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L292)

Serializes a collection value to the SQLite type

#### Parameters

##### value

`any`

#### Returns

`ExtractedTable`\<`TTable`\>

***

### tableName

```ts
tableName: string;
```

Defined in: [definitions.ts:283](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L283)

The SQLite table representing the collection.

***

### trackedTableName

```ts
trackedTableName: string;
```

Defined in: [definitions.ts:287](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L287)

The internal table used to track diffs for the collection.
