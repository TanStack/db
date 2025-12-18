---
id: OptimisticChangeMessage
title: OptimisticChangeMessage
---

# Interface: OptimisticChangeMessage\<T\>

Defined in: [packages/db/src/types.ts:364](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L364)

## Extends

- [`ChangeMessage`](ChangeMessage.md)\<`T`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### isActive?

```ts
optional isActive: boolean;
```

Defined in: [packages/db/src/types.ts:368](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L368)

***

### key

```ts
key: string | number;
```

Defined in: [packages/db/src/types.ts:357](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L357)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`key`](ChangeMessage.md#key)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:361](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L361)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`metadata`](ChangeMessage.md#metadata)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:359](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L359)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`previousValue`](ChangeMessage.md#previousvalue)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:360](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L360)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`type`](ChangeMessage.md#type)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:358](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L358)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`value`](ChangeMessage.md#value)
