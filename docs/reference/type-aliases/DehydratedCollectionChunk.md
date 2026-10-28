---
id: DehydratedCollectionChunk
title: DehydratedCollectionChunk
---

```ts
type DehydratedCollectionChunk<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L132)

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

Defined in: [packages/db/src/client.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L136)

***

### rows

```ts
rows: DehydratedCollectionRow<T, TKey>[];
```

Defined in: [packages/db/src/client.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L137)

***

### syncMeta?

```ts
optional syncMeta: unknown;
```

Defined in: [packages/db/src/client.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L138)
