---
id: ConditionalSelect
title: ConditionalSelect
---

Defined in: [packages/db/src/query/ir.ts:317](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L317)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new ConditionalSelect(branches, defaultValue?): ConditionalSelect;
```

Defined in: [packages/db/src/query/ir.ts:319](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L319)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:320](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L320)

***

### defaultValue?

```ts
optional defaultValue: SelectValueExpression;
```

Defined in: [packages/db/src/query/ir.ts:321](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L321)

***

### type

```ts
type: "conditionalSelect";
```

Defined in: [packages/db/src/query/ir.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L318)

#### Overrides

```ts
BaseExpression.type
```
