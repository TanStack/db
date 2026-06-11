---
id: SQLiteCompiledQuery
title: SQLiteCompiledQuery
---

# Interface: SQLiteCompiledQuery

Defined in: [sqlite-compiler.ts:6](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L6)

Result of compiling LoadSubsetOptions to SQLite

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [sqlite-compiler.ts:12](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L12)

The LIMIT value

***

### orderBy?

```ts
optional orderBy: string;
```

Defined in: [sqlite-compiler.ts:10](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L10)

The ORDER BY clause (without "ORDER BY" keyword), e.g., "price DESC"

***

### params

```ts
params: unknown[];
```

Defined in: [sqlite-compiler.ts:14](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L14)

Parameter values in order, to be passed to SQLite query

***

### where?

```ts
optional where: string;
```

Defined in: [sqlite-compiler.ts:8](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L8)

The WHERE clause (without "WHERE" keyword), e.g., "price > ?"
