---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:450](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L450)

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

Defined in: [packages/db/src/types.ts:454](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L454)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:458](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L458)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:456](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L456)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:457](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L457)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:455](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L455)
