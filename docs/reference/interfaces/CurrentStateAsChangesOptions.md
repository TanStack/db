---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:780](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L780)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:784](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L784)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:785](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L785)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:783](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L783)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:782](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L782)

Pre-compiled expression for filtering the current state
