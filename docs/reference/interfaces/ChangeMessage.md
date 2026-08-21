---
id: ChangeMessage
title: ChangeMessage
---

# Interface: ChangeMessage\<T, TKey\>

Defined in: [packages/db/src/types.ts:403](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L403)

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

Defined in: [packages/db/src/types.ts:407](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L407)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:411](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L411)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:409](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L409)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:410](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L410)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:408](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L408)
