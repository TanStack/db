---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1168](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1168)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1172](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1172)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1173](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1173)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1171](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1171)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1170](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1170)

Pre-compiled expression for filtering the current state
