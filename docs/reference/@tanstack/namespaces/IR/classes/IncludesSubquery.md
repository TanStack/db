---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:221](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L221)

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

Defined in: [packages/db/src/query/ir.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L223)

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

Defined in: [packages/db/src/query/ir.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L79)

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

Defined in: [packages/db/src/query/ir.ts:226](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L226)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:225](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L225)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L227)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:230](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L230)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:228](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L228)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:229](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L229)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:224](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L224)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:231](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L231)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:222](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L222)

#### Overrides

```ts
BaseExpression.type
```
