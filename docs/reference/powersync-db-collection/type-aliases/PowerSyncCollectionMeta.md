---
id: PowerSyncCollectionMeta
title: PowerSyncCollectionMeta
---

# Type Alias: PowerSyncCollectionMeta\<TTable\>

```ts
type PowerSyncCollectionMeta<TTable> = object;
```

Defined in: definitions.ts:235

Metadata for the PowerSync Collection.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### metadataIsTracked

```ts
metadataIsTracked: boolean;
```

Defined in: definitions.ts:253

Whether the PowerSync table tracks metadata.

***

### serializeValue()

```ts
serializeValue: (value) => ExtractedTable<TTable>;
```

Defined in: definitions.ts:248

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

Defined in: definitions.ts:239

The SQLite table representing the collection.

***

### trackedTableName

```ts
trackedTableName: string;
```

Defined in: definitions.ts:243

The internal table used to track diffs for the collection.
