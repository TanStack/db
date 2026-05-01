---
id: PowerSyncCollectionMeta
title: PowerSyncCollectionMeta
---

# Type Alias: PowerSyncCollectionMeta\<TTable\>

```ts
type PowerSyncCollectionMeta<TTable> = object;
```

Defined in: [definitions.ts:273](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L273)

Metadata for the PowerSync Collection.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### metadataIsTracked

```ts
metadataIsTracked: boolean;
```

Defined in: [definitions.ts:291](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L291)

Whether the PowerSync table tracks metadata.

***

### serializeValue()

```ts
serializeValue: (value) => ExtractedTable<TTable>;
```

Defined in: [definitions.ts:286](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L286)

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

Defined in: [definitions.ts:277](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L277)

The SQLite table representing the collection.

***

### trackedTableName

```ts
trackedTableName: string;
```

Defined in: [definitions.ts:281](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L281)

The internal table used to track diffs for the collection.
