---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:620](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L620)

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

Defined in: [packages/db/src/types.ts:624](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L624)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:628](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L628)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:626](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L626)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:627](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L627)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:625](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L625)
