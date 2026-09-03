---
id: DehydratedCollectionRow
title: DehydratedCollectionRow
---

# Type Alias: DehydratedCollectionRow\<T, TKey\>

```ts
type DehydratedCollectionRow<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L98)

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

Defined in: [packages/db/src/client.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L102)

***

### metadata?

```ts
optional metadata: unknown;
```

Defined in: [packages/db/src/client.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L104)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/client.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L103)
