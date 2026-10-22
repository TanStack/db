---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:250](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L250)

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

Defined in: [packages/db/src/query/ir.ts:252](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L252)

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:251](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L251)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:253](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L253)
