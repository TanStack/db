---
id: Value
title: Value
---

# Class: Value\<T\>

Defined in: [packages/db/src/query/ir.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L150)

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

Defined in: [packages/db/src/query/ir.ts:152](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L152)

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

Defined in: [packages/db/src/query/ir.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L84)

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

Defined in: [packages/db/src/query/ir.ts:151](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L151)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L153)
