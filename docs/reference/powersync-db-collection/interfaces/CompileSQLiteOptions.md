---
id: CompileSQLiteOptions
title: CompileSQLiteOptions
---

# Interface: CompileSQLiteOptions

Defined in: [sqlite-compiler.ts:20](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L20)

Options for controlling how SQL is compiled.

## Properties

### jsonColumn?

```ts
optional jsonColumn: string;
```

Defined in: [sqlite-compiler.ts:26](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L26)

When set, column references emit `json_extract(<jsonColumn>, '$.<columnName>')`
instead of `"<columnName>"`. The `id` column is excluded since it's stored
as a direct column in the tracked table.
