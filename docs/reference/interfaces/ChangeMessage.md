---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:314](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L314)

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

Defined in: [packages/db/src/types.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L318)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:322](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L322)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:320](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L320)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:321](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L321)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:319](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L319)
