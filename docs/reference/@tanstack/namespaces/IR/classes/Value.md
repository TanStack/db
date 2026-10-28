---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L241)

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

Defined in: [packages/db/src/query/ir.ts:243](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L243)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:242](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L242)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:244](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L244)
