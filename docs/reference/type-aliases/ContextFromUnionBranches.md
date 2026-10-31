---
id: ContextFromUnionBranches
title: ContextFromUnionBranches
---

```ts
type ContextFromUnionBranches<TBranches> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L186)

## Type Parameters

### TBranches

`TBranches` *extends* readonly \[[`QueryBuilder`](QueryBuilder.md)\<`any`\>, `...QueryBuilder<any>[]`\]

## Properties

### \[BranchUnionRefs\]

```ts
[BranchUnionRefs]: UnionBranchResult<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L196)

***

### baseSchema

```ts
baseSchema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L189)

***

### fromSourceName

```ts
fromSourceName: keyof UnionBranchSchema<TBranches> & string;
```

Defined in: [packages/db/src/query/builder/types.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L192)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L193)

***

### hasResult

```ts
hasResult: true;
```

Defined in: [packages/db/src/query/builder/types.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L195)

***

### refsSchema

```ts
refsSchema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L191)

***

### result

```ts
result: PrettifyIfPlainObject<UnionBranchResult<TBranches>>;
```

Defined in: [packages/db/src/query/builder/types.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L194)

***

### schema

```ts
schema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L190)
