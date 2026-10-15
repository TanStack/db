---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:236](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L236)

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

Defined in: [packages/db/src/query/ir.ts:238](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L238)

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

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

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

Defined in: [packages/db/src/query/ir.ts:237](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L237)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:239](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L239)
