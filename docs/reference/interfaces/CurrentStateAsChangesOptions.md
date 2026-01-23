---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:819](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L819)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:823](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L823)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:824](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L824)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:822](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L822)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:821](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L821)

Pre-compiled expression for filtering the current state
