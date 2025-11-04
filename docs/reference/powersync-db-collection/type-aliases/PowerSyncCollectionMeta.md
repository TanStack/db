---
id: PowerSyncCollectionMeta
title: PowerSyncCollectionMeta
---

# Type Alias: PowerSyncCollectionMeta\<TTable\>

```ts
type PowerSyncCollectionMeta<TTable> = object;
```

Defined in: [definitions.ts:235](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L235)

Metadata for the PowerSync Collection.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### serializeValue()

```ts
serializeValue: (value) => ExtractedTable<TTable>;
```

Defined in: [definitions.ts:248](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L248)

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

Defined in: [definitions.ts:239](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L239)

The SQLite table representing the collection.

***

### trackedTableName

```ts
trackedTableName: string;
```

Defined in: [definitions.ts:243](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L243)

The internal table used to track diffs for the collection.
