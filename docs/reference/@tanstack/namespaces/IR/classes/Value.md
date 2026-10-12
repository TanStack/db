---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L187)

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

Defined in: [packages/db/src/query/ir.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L189)

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

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

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

Defined in: [packages/db/src/query/ir.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L188)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L190)
