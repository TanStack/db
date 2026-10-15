---
id: ContextFromUnionBranches
title: ContextFromUnionBranches
---

```ts
type ContextFromUnionBranches<TBranches> = object;
```

Defined in: [packages/db/src/query/builder/types.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L185)

## Type Parameters

### TBranches

`TBranches` *extends* readonly \[[`QueryBuilder`](QueryBuilder.md)\<`any`\>, `...QueryBuilder<any>[]`\]

## Properties

### \[BranchUnionRefs\]

```ts
[BranchUnionRefs]: UnionBranchResult<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L195)

***

### baseSchema

```ts
baseSchema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L188)

***

### fromSourceName

```ts
fromSourceName: keyof UnionBranchSchema<TBranches> & string;
```

Defined in: [packages/db/src/query/builder/types.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L191)

***

### hasJoins

```ts
hasJoins: false;
```

Defined in: [packages/db/src/query/builder/types.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L192)

***

### hasResult

```ts
hasResult: true;
```

Defined in: [packages/db/src/query/builder/types.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L194)

***

### refsSchema

```ts
refsSchema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L190)

***

### result

```ts
result: PrettifyIfPlainObject<UnionBranchResult<TBranches>>;
```

Defined in: [packages/db/src/query/builder/types.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L193)

***

### schema

```ts
schema: UnionBranchSchema<TBranches>;
```

Defined in: [packages/db/src/query/builder/types.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L189)
