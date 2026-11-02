---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:660](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L660)

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

Defined in: [packages/db/src/types.ts:664](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L664)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:668](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L668)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:666](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L666)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:667](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L667)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:665](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L665)
