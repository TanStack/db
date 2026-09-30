---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L172)

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

Defined in: [packages/db/src/query/ir.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L174)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L173)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L175)
