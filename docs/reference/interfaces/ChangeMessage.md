---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:359](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L359)

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

Defined in: [packages/db/src/types.ts:363](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L363)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:367](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L367)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:365](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L365)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:366](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L366)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:364](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L364)
