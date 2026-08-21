---
id: ConditionalSelect
title: ConditionalSelect
---

# Class: ConditionalSelect

Defined in: [packages/db/src/query/ir.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L212)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L214)

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

Defined in: [packages/db/src/query/ir.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L84)

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

Defined in: [packages/db/src/query/ir.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L215)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:216](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L216)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L213)

#### Overrides

```ts
BaseExpression.type
```
