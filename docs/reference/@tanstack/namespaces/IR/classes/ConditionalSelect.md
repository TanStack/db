---
id: ConditionalSelect
title: ConditionalSelect
---

# Class: ConditionalSelect

Defined in: [packages/db/src/query/ir.ts:204](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L204)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L206)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:207](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L207)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:208](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L208)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L205)

#### Overrides

```ts
BaseExpression.type
```
