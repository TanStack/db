---
id: PropRef
title: PropRef
---

Defined in: [packages/db/src/query/ir.ts:151](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L151)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new PropRef<T>(
   path, 
   sourceAlias?, 
bindingId?): PropRef<T>;
```

Defined in: [packages/db/src/query/ir.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L155)

#### Parameters

##### path

`string`[]

##### sourceAlias?

`string`

##### bindingId?

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

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### bindingId?

```ts
readonly optional bindingId: string;
```

Defined in: [packages/db/src/query/ir.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L154)

***

### path

```ts
path: string[];
```

Defined in: [packages/db/src/query/ir.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L156)

***

### sourceAlias?

```ts
readonly optional sourceAlias: string;
```

Defined in: [packages/db/src/query/ir.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L153)

***

### type

```ts
type: "ref";
```

Defined in: [packages/db/src/query/ir.ts:152](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L152)

#### Overrides

```ts
BaseExpression.type
```
