---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1190](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1190)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1194](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1194)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1195](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1195)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1193](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1193)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1192](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1192)

Pre-compiled expression for filtering the current state
