---
id: ConditionalSelect
title: ConditionalSelect
---

Defined in: [packages/db/src/query/ir.ts:313](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L313)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:315](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L315)

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:316](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L316)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:317](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L317)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:314](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L314)

#### Overrides

```ts
BaseExpression.type
```
