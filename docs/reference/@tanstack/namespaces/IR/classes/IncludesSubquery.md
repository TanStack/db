---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:197](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L197)

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

Defined in: [packages/db/src/query/ir.ts:199](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L199)

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

Defined in: [packages/db/src/query/ir.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L78)

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

Defined in: [packages/db/src/query/ir.ts:202](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L202)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:201](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L201)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:203](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L203)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L206)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:204](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L204)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L205)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:200](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L200)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:207](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L207)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:198](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L198)

#### Overrides

```ts
BaseExpression.type
```
