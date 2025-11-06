---
id: OptimisticChangeMessage
title: OptimisticChangeMessage
---

# Interface: OptimisticChangeMessage\<T\>

Defined in: [packages/db/src/types.ts:303](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L303)

## Extends

- [`ChangeMessage`](../ChangeMessage.md)\<`T`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### isActive?

```ts
optional isActive: boolean;
```

Defined in: [packages/db/src/types.ts:307](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L307)

***

### key

```ts
key: string | number;
```

Defined in: [packages/db/src/types.ts:296](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L296)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`key`](../ChangeMessage.md#key)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L300)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`metadata`](../ChangeMessage.md#metadata)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:298](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L298)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`previousValue`](../ChangeMessage.md#previousvalue)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L299)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`type`](../ChangeMessage.md#type)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L297)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`value`](../ChangeMessage.md#value)
