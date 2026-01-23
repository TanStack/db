---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:824](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L824)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:828](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L828)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:829](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L829)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:827](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L827)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:826](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L826)

Pre-compiled expression for filtering the current state
