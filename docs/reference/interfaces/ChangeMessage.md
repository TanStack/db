---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:600](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L600)

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

Defined in: [packages/db/src/types.ts:604](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L604)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:608](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L608)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:606](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L606)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:607](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L607)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:605](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L605)
