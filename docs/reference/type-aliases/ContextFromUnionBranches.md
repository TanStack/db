---
id: ContextFromUnionBranches
title: ContextFromUnionBranches
---

# Type Alias: ContextFromUnionBranches\<TBranches\>

```ts
type ContextFromUnionBranches<TBranches> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L169)

## Type Parameters

### TBranches

`TBranches` *extends* readonly \[[`QueryBuilder`](QueryBuilder.md)\<`any`\>, `...QueryBuilder<any>[]`\]

## Properties

### baseSchema

```ts
baseSchema: UnionBranchSchema<TBranches> & ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L172)

***

### fromSourceName

```ts
fromSourceName: keyof UnionBranchSchema<TBranches> & string;
```

Defined in: [packages/db/src/query/builder/types.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L175)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L176)

***

### hasResult

```ts
hasResult: true;
```

Defined in: [packages/db/src/query/builder/types.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L178)

***

### refsSchema

```ts
refsSchema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L174)

***

### result

```ts
result: PrettifyIfPlainObject<UnionBranchResult<TBranches>>;
```

Defined in: [packages/db/src/query/builder/types.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L177)

***

### schema

```ts
schema: UnionBranchSchema<TBranches> & ContextSchema;
```

Defined in: [packages/db/src/query/builder/types.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L173)
