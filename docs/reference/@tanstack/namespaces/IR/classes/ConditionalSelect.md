---
id: ConditionalSelect
title: ConditionalSelect
---

Defined in: [packages/db/src/query/ir.ts:304](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L304)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:306](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L306)

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

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

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

Defined in: [packages/db/src/query/ir.ts:307](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L307)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:308](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L308)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:305](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L305)

#### Overrides

```ts
BaseExpression.type
```
