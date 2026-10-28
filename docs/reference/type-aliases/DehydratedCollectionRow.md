---
id: DehydratedCollectionRow
title: DehydratedCollectionRow
---

```ts
type DehydratedCollectionRow<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L123)

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

Defined in: [packages/db/src/client.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L127)

***

### metadata?

```ts
optional metadata: unknown;
```

Defined in: [packages/db/src/client.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L129)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/client.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L128)
