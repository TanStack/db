---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1326](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1326)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1330](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1330)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1331](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1331)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1329](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1329)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1328](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1328)

Pre-compiled expression for filtering the current state
