---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L163)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new Value<T>(value): Value<T>;
```

Defined in: [packages/db/src/query/ir.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L165)

#### Parameters

##### value

`T`

#### Returns

`Value`\<`T`\>

#### Overrides

```ts
BaseExpression<T>.constructor
```

## Properties

### \_\_returnType

```ts
readonly __returnType: T;
```

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### type

```ts
type: "val";
```

Defined in: [packages/db/src/query/ir.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L164)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L166)
