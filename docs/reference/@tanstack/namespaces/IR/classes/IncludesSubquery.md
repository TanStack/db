---
id: IncludesSubquery
title: IncludesSubquery
---

# Class: IncludesSubquery

Defined in: [packages/db/src/query/ir.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L139)

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

Defined in: [packages/db/src/query/ir.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L141)

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

Defined in: [packages/db/src/query/ir.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L73)

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

Defined in: [packages/db/src/query/ir.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L144)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L143)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:145](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L145)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L148)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L146)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:147](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L147)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L142)

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L149)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L140)

#### Overrides

```ts
BaseExpression.type
```
