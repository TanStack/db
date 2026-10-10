---
id: DehydratedCollectionRow
title: DehydratedCollectionRow
---

```ts
type DehydratedCollectionRow<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L100)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### key

```ts
key: TKey;
```

Defined in: [packages/db/src/client.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L104)

***

### metadata?

```ts
optional metadata: unknown;
```

Defined in: [packages/db/src/client.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L106)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/client.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L105)
