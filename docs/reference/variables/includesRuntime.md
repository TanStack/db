---
id: includesRuntime
title: includesRuntime
---

```ts
const includesRuntime: object;
```

Defined in: [packages/db/src/query/live/includes-runtime.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/includes-runtime.ts#L8)

The include materializer. `include()`, `toArray()`, and `materialize()`
carry it onto the query IR, so other apps do not bundle it.

## Type Declaration

### createBucketFacades()

```ts
createBucketFacades: (...args) => BucketFacadeAdapter;
```

#### Parameters

##### args

...\[`string`, `BucketFacadeCompilation`[], (`count`) => `void`\]

#### Returns

`BucketFacadeAdapter`

### materializeCompilation()

```ts
materializeCompilation: (compilation, getRootKey?) => MaterializedRootCompilation;
```

Compiles inline includes into the same D2 graph as their parent relation.
Collection-valued includes become inert bucket references. The public facade
adapter resolves those references after the graph reaches quiescence.

#### Parameters

##### compilation

`CompilationResult`

##### getRootKey?

(`row`) => `unknown`

#### Returns

`MaterializedRootCompilation`
