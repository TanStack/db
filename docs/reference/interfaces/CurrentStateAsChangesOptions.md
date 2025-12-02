---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:736](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L736)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:740](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L740)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:741](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L741)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:739](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L739)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:738](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L738)

Pre-compiled expression for filtering the current state
