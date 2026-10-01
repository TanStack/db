---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L206)

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

Defined in: [packages/db/src/query/ir.ts:208](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L208)

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

Defined in: [packages/db/src/query/ir.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L86)

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

Defined in: [packages/db/src/query/ir.ts:211](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L211)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L210)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L212)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L215)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L213)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L214)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L209)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:216](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L216)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:207](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L207)

#### Overrides

```ts
BaseExpression.type
```
