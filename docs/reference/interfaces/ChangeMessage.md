---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:292](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L292)

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

Defined in: [packages/db/src/types.ts:296](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L296)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L300)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:298](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L298)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L299)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L297)
