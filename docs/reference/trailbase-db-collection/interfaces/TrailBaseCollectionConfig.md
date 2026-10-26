---
id: TrailBaseCollectionConfig
title: TrailBaseCollectionConfig
---

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:96](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L96)

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

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:115](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L115)

***

### recordApi

```ts
recordApi: RecordApi<TRecord>;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:107](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L107)

Record API name

***

### serialize

```ts
serialize: Conversions<TItem, TRecord>;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:116](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L116)

***

### syncMode?

```ts
optional syncMode: SyncMode;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:113](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L113)

The mode of sync to use for the collection.

#### Default

`eager`
