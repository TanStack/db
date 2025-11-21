---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:311](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L311)

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

Defined in: [packages/db/src/types.ts:315](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L315)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:319](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L319)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:317](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L317)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L318)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:316](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L316)
