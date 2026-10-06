---
id: ConditionalSelect
title: ConditionalSelect
---

Defined in: [packages/db/src/query/ir.ts:221](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L221)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L223)

#### Parameters

##### branches

[`ConditionalSelectBranch`](../type-aliases/ConditionalSelectBranch.md)[]

##### defaultValue?

[`SelectValueExpression`](../type-aliases/SelectValueExpression.md)

#### Returns

`ConditionalSelect`

#### Overrides

```ts
BaseExpression.constructor
```

## Properties

### \_\_returnType

```ts
readonly __returnType: any;
```

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### branches

```ts
branches: ConditionalSelectBranch[];
```

Defined in: [packages/db/src/query/ir.ts:224](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L224)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:225](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L225)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:222](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L222)

#### Overrides

```ts
BaseExpression.type
```
