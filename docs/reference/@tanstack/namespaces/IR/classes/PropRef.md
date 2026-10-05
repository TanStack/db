---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L144)

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

Defined in: [packages/db/src/query/ir.ts:147](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L147)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L148)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L146)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:145](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L145)

#### Overrides

```ts
BaseExpression.type
```
