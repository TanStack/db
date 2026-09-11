---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:472](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L472)

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

Defined in: [packages/db/src/types.ts:476](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L476)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:480](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L480)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:478](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L478)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:479](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L479)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:477](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L477)
