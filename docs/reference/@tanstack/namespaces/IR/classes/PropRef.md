---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L136)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new PropRef<T>(path, sourceAlias?): PropRef<T>;
```

Defined in: [packages/db/src/query/ir.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L139)

#### Parameters

##### path

`string`[]

##### sourceAlias?

`string`

#### Returns

`PropRef`\<`T`\>

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

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L140)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L138)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L137)

#### Overrides

```ts
BaseExpression.type
```
