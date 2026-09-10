---
id: ContextFromUnionBranches
title: ContextFromUnionBranches
---

# Type Alias: ContextFromUnionBranches\<TBranches\>

```ts
type ContextFromUnionBranches<TBranches> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L183)

## Type Parameters

### TBranches

`TBranches` *extends* readonly \[[`QueryBuilder`](QueryBuilder.md)\<`any`\>, `...QueryBuilder<any>[]`\]

## Properties

### baseSchema

```ts
baseSchema: UnionBranchSchema<TBranches> & ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L186)

***

### fromSourceName

```ts
fromSourceName: keyof UnionBranchSchema<TBranches> & string;
```

Defined in: [packages/db/src/query/builder/types.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L189)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L190)

***

### hasResult

```ts
hasResult: true;
```

Defined in: [packages/db/src/query/builder/types.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L192)

***

### refsSchema

```ts
refsSchema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L188)

***

### result

```ts
result: PrettifyIfPlainObject<UnionBranchResult<TBranches>>;
```

Defined in: [packages/db/src/query/builder/types.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L191)

***

### schema

```ts
schema: UnionBranchSchema<TBranches> & ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L187)
