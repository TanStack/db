---
id: DehydratedCollectionChunk
title: DehydratedCollectionChunk
---

```ts
type DehydratedCollectionChunk<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L129)

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

Defined in: [packages/db/src/client.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L133)

***

### rows

```ts
rows: DehydratedCollectionRow<T, TKey>[];
```

Defined in: [packages/db/src/client.ts:134](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L134)

***

### syncMeta?

```ts
optional syncMeta: unknown;
```

Defined in: [packages/db/src/client.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L135)
