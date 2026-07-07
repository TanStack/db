---
id: IncludesSubquery
title: IncludesSubquery
---

# Class: IncludesSubquery

Defined in: [packages/db/src/query/ir.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L176)

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

Defined in: [packages/db/src/query/ir.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L178)

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

Defined in: [packages/db/src/query/ir.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L82)

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

Defined in: [packages/db/src/query/ir.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L181)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:180](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L180)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L182)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L185)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L183)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L184)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L179)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L186)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L177)

#### Overrides

```ts
BaseExpression.type
```
