---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:287](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L287)

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
   runtime, 
   parentFilters?, 
   parentProjection?, 
   materialization?, 
   scalarField?): IncludesSubquery;
```

Defined in: [packages/db/src/query/ir.ts:289](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L289)

#### Parameters

##### query

[`QueryIR`](../interfaces/QueryIR.md)

##### correlationField

[`PropRef`](PropRef.md)

##### childCorrelationField

[`PropRef`](PropRef.md)

##### fieldName

`string`

##### runtime

###### createBucketFacades

(...`args`) => `BucketFacadeAdapter` = `...`

###### materializeCompilation

(`compilation`, `getRootKey?`) => `MaterializedRootCompilation`

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

Defined in: [packages/db/src/query/ir.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L88)

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

Defined in: [packages/db/src/query/ir.ts:292](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L292)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:291](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L291)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:293](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L293)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:298](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L298)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:296](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L296)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L297)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:290](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L290)

***

### runtime

```ts
runtime: object;
```

Defined in: [packages/db/src/query/ir.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L295)

#### createBucketFacades()

```ts
createBucketFacades: (...args) => BucketFacadeAdapter;
```

##### Parameters

###### args

...\[`string`, `BucketFacadeCompilation`[], (`count`) => `void`\]

##### Returns

`BucketFacadeAdapter`

#### materializeCompilation()

```ts
materializeCompilation: (compilation, getRootKey?) => MaterializedRootCompilation;
```

Compiles inline includes into the same D2 graph as their parent relation.
Collection-valued includes become inert bucket references. The public facade
adapter resolves those references after the graph reaches quiescence.

##### Parameters

###### compilation

`CompilationResult`

###### getRootKey?

(`row`) => `unknown`

##### Returns

`MaterializedRootCompilation`

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L299)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:288](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L288)

#### Overrides

```ts
BaseExpression.type
```
