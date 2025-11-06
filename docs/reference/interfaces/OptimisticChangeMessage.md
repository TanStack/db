---
id: OptimisticChangeMessage
title: OptimisticChangeMessage
---

# Interface: OptimisticChangeMessage\<T\>

Defined in: packages/db/src/types.ts:272

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

Defined in: packages/db/src/types.ts:276

***

### key

```ts
key: string | number;
```

Defined in: packages/db/src/types.ts:265

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`key`](../ChangeMessage.md#key)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: packages/db/src/types.ts:269

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`metadata`](../ChangeMessage.md#metadata)

***

### previousValue?

```ts
optional previousValue: T;
```

Defined in: packages/db/src/types.ts:267

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`previousValue`](../ChangeMessage.md#previousvalue)

***

### type

```ts
type: OperationType;
```

Defined in: packages/db/src/types.ts:268

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`type`](../ChangeMessage.md#type)

***

### value

```ts
value: T;
```

Defined in: packages/db/src/types.ts:266

#### Inherited from

[`ChangeMessage`](../ChangeMessage.md).[`value`](../ChangeMessage.md#value)
