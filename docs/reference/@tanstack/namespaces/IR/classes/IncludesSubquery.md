---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:296](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L296)

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

Defined in: [packages/db/src/query/ir.ts:298](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L298)

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

(`compilation`, `getRootKey?`, `reduceJoinedPublicKeys`) => `MaterializedRootCompilation`

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

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

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

Defined in: [packages/db/src/query/ir.ts:301](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L301)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L300)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:302](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L302)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:307](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L307)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:305](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L305)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:306](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L306)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L299)

***

### runtime

```ts
runtime: object;
```

Defined in: [packages/db/src/query/ir.ts:304](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L304)

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
materializeCompilation: (compilation, getRootKey?, reduceJoinedPublicKeys) => MaterializedRootCompilation;
```

Compiles inline includes into the same D2 graph as their parent relation.
Collection-valued includes become inert bucket references. The public facade
adapter resolves those references after the graph reaches quiescence.

##### Parameters

###### compilation

`CompilationResult`

###### getRootKey?

(`row`) => `unknown`

###### reduceJoinedPublicKeys?

`boolean` = `false`

##### Returns

`MaterializedRootCompilation`

***

### scalarField?

```ts
optional scalarField: string;
```

Defined in: [packages/db/src/query/ir.ts:308](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L308)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L297)

#### Overrides

```ts
BaseExpression.type
```
