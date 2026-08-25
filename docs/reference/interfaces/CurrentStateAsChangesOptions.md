---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:952](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L952)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:956](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L956)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:957](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L957)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:955](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L955)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:954](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L954)

Pre-compiled expression for filtering the current state
