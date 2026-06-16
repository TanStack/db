---
id: TrailBaseCollectionConfig
title: TrailBaseCollectionConfig
---

# Interface: TrailBaseCollectionConfig\<TItem, TRecord, TKey\>

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:92](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L92)

Configuration interface for Trailbase Collection

## Extends

- `Omit`\<`BaseCollectionConfig`\<`TItem`, `TKey`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"` \| `"syncMode"`\>

## Type Parameters

### TItem

`TItem` *extends* `ShapeOf`\<`TRecord`\>

### TRecord

`TRecord` *extends* `ShapeOf`\<`TItem`\> = `TItem`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### parse

```ts
parse: Conversions<TRecord, TItem>;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:111](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L111)

***

### recordApi

```ts
recordApi: RecordApi<TRecord>;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:103](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L103)

Record API name

***

### serialize

```ts
serialize: Conversions<TItem, TRecord>;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:112](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L112)

***

### syncMode?

```ts
optional syncMode: SyncMode;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:109](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L109)

The mode of sync to use for the collection.

#### Default

`eager`
