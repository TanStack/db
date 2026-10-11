---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:557](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L557)

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

Defined in: [packages/db/src/types.ts:561](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L561)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:565](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L565)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:563](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L563)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:564](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L564)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:562](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L562)
