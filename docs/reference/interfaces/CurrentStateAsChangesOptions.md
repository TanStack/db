---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:902](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L902)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:906](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L906)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:907](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L907)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:905](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L905)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:904](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L904)

Pre-compiled expression for filtering the current state
