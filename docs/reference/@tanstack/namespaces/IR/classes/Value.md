---
id: Value
title: Value
---

Defined in: [packages/db/src/query/ir.ts:245](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L245)

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

Defined in: [packages/db/src/query/ir.ts:247](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L247)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:246](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L246)

#### Overrides

```ts
BaseExpression.type
```

***

### value

```ts
value: T;
```

Defined in: [packages/db/src/query/ir.ts:248](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L248)
