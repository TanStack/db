---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:381](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L381)

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

Defined in: [packages/db/src/types.ts:385](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L385)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:389](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L389)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:387](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L387)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:388](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L388)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:386](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L386)
