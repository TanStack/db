---
id: DehydratedCollectionRow
title: DehydratedCollectionRow
---

```ts
type DehydratedCollectionRow<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L120)

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

Defined in: [packages/db/src/client.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L124)

***

### metadata?

```ts
optional metadata: unknown;
```

Defined in: [packages/db/src/client.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L126)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/client.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L125)
