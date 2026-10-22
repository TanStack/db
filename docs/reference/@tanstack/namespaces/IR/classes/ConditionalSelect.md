---
id: ConditionalSelect
title: ConditionalSelect
---

Defined in: [packages/db/src/query/ir.ts:322](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L322)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:324](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L324)

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:325](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L325)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:326](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L326)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:323](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L323)

#### Overrides

```ts
BaseExpression.type
```
