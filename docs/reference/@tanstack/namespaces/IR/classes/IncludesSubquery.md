---
id: IncludesSubquery
title: IncludesSubquery
---

# Class: IncludesSubquery

Defined in: [packages/db/src/query/ir.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L184)

## Extends

- `BaseExpression`

## Constructors

### Constructor

```ts
new IncludesSubquery(
   query, 
   correlationField, 
   childCorrelationField, 
   fieldName, 
   parentFilters?, 
   parentProjection?, 
   materialization?, 
   scalarField?): IncludesSubquery;
```

Defined in: [packages/db/src/query/ir.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L186)

#### Parameters

##### query

[`QueryIR`](../interfaces/QueryIR.md)

##### correlationField

[`PropRef`](PropRef.md)

##### childCorrelationField

[`PropRef`](PropRef.md)

##### fieldName

`string`

##### parentFilters?

[`Where`](../type-aliases/Where.md)[]

##### parentProjection?

[`PropRef`](PropRef.md)\<`any`\>[]

##### materialization?

[`IncludesMaterialization`](../type-aliases/IncludesMaterialization.md) = `...`

##### scalarField?

`string`

#### Returns

`IncludesSubquery`

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

### childCorrelationField

```ts
childCorrelationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L189)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L188)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L190)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L193)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L191)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L192)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L187)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L194)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L185)

#### Overrides

```ts
BaseExpression.type
```
