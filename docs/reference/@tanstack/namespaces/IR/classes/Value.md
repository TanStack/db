---
id: Value
title: Value
---

# Class: Value\<T\>

Defined in: [packages/db/src/query/ir.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L142)

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

Defined in: [packages/db/src/query/ir.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L144)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L143)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:145](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L145)
