---
id: DehydratedCollectionRow
title: DehydratedCollectionRow
---

```ts
type DehydratedCollectionRow<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L130)

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

Defined in: [packages/db/src/client.ts:134](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L134)

***

### metadata?

```ts
optional metadata: unknown;
```

Defined in: [packages/db/src/client.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L136)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/client.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L135)
