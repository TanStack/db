---
id: DehydratedCollectionChunk
title: DehydratedCollectionChunk
---

```ts
type DehydratedCollectionChunk<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L139)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### collectionId

```ts
collectionId: string;
```

Defined in: [packages/db/src/client.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L143)

***

### rows

```ts
rows: DehydratedCollectionRow<T, TKey>[];
```

Defined in: [packages/db/src/client.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L144)

***

### syncMeta?

```ts
optional syncMeta: unknown;
```

Defined in: [packages/db/src/client.ts:145](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L145)
