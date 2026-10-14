---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:578](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L578)

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

Defined in: [packages/db/src/types.ts:582](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L582)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:586](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L586)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:584](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L584)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:585](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L585)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:583](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L583)
