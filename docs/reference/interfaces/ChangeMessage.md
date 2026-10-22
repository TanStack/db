---
id: ChangeMessage
title: ChangeMessage
---

Defined in: [packages/db/src/types.ts:615](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L615)

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

Defined in: [packages/db/src/types.ts:619](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L619)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:623](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L623)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:621](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L621)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:622](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L622)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:620](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L620)
