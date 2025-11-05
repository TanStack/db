---
id: Value
title: Value
---

# Class: Value\<T\>

Defined in: [packages/db/src/query/ir.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L101)

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

Defined in: [packages/db/src/query/ir.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L103)

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

Defined in: [packages/db/src/query/ir.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L69)

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

Defined in: [packages/db/src/query/ir.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L102)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L104)
