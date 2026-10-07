---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:551](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L551)

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

Defined in: [packages/db/src/types.ts:555](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L555)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:559](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L559)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:557](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L557)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:558](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L558)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:556](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L556)
