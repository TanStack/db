---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:261](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L261)

## Extended by

- [`OptimisticChangeMessage`](../OptimisticChangeMessage.md)

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

Defined in: [packages/db/src/types.ts:265](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L265)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:269](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L269)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:267](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L267)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:268](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L268)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:266](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L266)
