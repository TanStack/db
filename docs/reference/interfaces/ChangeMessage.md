---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:409](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L409)

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

Defined in: [packages/db/src/types.ts:413](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L413)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:417](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L417)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:415](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L415)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:416](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L416)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:414](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L414)
