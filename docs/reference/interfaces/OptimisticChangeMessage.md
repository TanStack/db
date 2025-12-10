---
id: OptimisticChangeMessage
title: OptimisticChangeMessage
---

# Interface: OptimisticChangeMessage\<T\>

Defined in: [packages/db/src/types.ts:325](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L325)

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

Defined in: [packages/db/src/types.ts:329](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L329)

***

### key

```ts
key: string | number;
```

Defined in: [packages/db/src/types.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L318)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`key`](ChangeMessage.md#key)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:322](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L322)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`metadata`](ChangeMessage.md#metadata)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: [packages/db/src/types.ts:320](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L320)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`previousValue`](ChangeMessage.md#previousvalue)

***

### type

```ts
type: OperationType;
```

Defined in: [packages/db/src/types.ts:321](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L321)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`type`](ChangeMessage.md#type)

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/types.ts:319](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L319)

#### Inherited from

[`ChangeMessage`](ChangeMessage.md).[`value`](ChangeMessage.md#value)
