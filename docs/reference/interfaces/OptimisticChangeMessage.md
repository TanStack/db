---
id: OptimisticChangeMessage
title: OptimisticChangeMessage
---

# Interface: OptimisticChangeMessage\<T\>

Defined in: [packages/db/src/types.ts:322](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L322)

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

Defined in: [packages/db/src/types.ts:326](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L326)

***

### key

```ts
key: string | number;
```

Defined in: [packages/db/src/types.ts:315](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L315)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`key`](../ChangeMessage.md#key)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:319](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L319)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`metadata`](../ChangeMessage.md#metadata)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:317](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L317)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`previousValue`](../ChangeMessage.md#previousvalue)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L318)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`type`](../ChangeMessage.md#type)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:316](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L316)

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`value`](../ChangeMessage.md#value)
