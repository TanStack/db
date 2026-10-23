---
id: IncludesSubquery
title: IncludesSubquery
---

Defined in: [packages/db/src/query/ir.ts:291](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L291)

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

Defined in: [packages/db/src/query/ir.ts:293](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L293)

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

Defined in: [packages/db/src/query/ir.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L92)

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

Defined in: [packages/db/src/query/ir.ts:296](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L296)

***

### correlationField

```ts
correlationField: PropRef;
```

Defined in: [packages/db/src/query/ir.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L295)

***

### fieldName

```ts
fieldName: string;
```

Defined in: [packages/db/src/query/ir.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L297)

***

### materialization

```ts
materialization: IncludesMaterialization;
```

Defined in: [packages/db/src/query/ir.ts:302](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L302)

***

### parentFilters?

```ts
optional parentFilters: Where[];
```

Defined in: [packages/db/src/query/ir.ts:300](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L300)

***

### parentProjection?

```ts
optional parentProjection: PropRef<any>[];
```

Defined in: [packages/db/src/query/ir.ts:301](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L301)

***

### query

```ts
query: QueryIR;
```

Defined in: [packages/db/src/query/ir.ts:294](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L294)

***

### runtime

```ts
runtime: object;
```

Defined in: [packages/db/src/query/ir.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L299)

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

Defined in: [packages/db/src/query/ir.ts:303](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L303)

***

### type

```ts
type: "includesSubquery";
```

Defined in: [packages/db/src/query/ir.ts:292](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L292)

#### Overrides

```ts
BaseExpression.type
```
