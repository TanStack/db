---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:840](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L840)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:844](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L844)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:845](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L845)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:843](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L843)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:842](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L842)

Pre-compiled expression for filtering the current state
