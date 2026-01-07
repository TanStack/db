---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:353](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L353)

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

Defined in: [packages/db/src/types.ts:357](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L357)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:361](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L361)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:359](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L359)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:360](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L360)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:358](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L358)
