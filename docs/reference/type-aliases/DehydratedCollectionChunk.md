---
id: DehydratedCollectionChunk
title: DehydratedCollectionChunk
---

# Type Alias: DehydratedCollectionChunk\<T, TKey\>

```ts
type DehydratedCollectionChunk<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L106)

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

Defined in: [packages/db/src/client.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L110)

***

### rows

```ts
rows: DehydratedCollectionRow<T, TKey>[];
```

Defined in: [packages/db/src/client.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L111)

***

### syncMeta?

```ts
optional syncMeta: unknown;
```

Defined in: [packages/db/src/client.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L112)
