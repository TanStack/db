---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:739](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L739)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:743](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L743)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:744](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L744)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:742](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L742)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:741](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L741)

Pre-compiled expression for filtering the current state
