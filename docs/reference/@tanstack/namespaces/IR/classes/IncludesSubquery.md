---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L280)

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

Defined in: [packages/db/src/query/ir.ts:282](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L282)

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

Defined in: [packages/db/src/query/ir.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L83)

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

Defined in: [packages/db/src/query/ir.ts:285](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L285)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:284](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L284)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:286](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L286)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:289](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L289)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:287](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L287)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:288](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L288)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:283](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L283)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:290](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L290)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:281](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L281)

#### Overrides

```ts
BaseExpression.type
```
