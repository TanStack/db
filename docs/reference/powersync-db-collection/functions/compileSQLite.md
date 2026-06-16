---
id: compileSQLite
title: compileSQLite
---

# Function: compileSQLite()

```ts
function compileSQLite(options, compileOptions?): SQLiteCompiledQuery;
```

Defined in: [sqlite-compiler.ts:45](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/sqlite-compiler.ts#L45)

Compiles TanStack DB LoadSubsetOptions to SQLite query components.

## Parameters

### options

`LoadSubsetOptions`

### compileOptions?

[`CompileSQLiteOptions`](../interfaces/CompileSQLiteOptions.md)

## Returns

[`SQLiteCompiledQuery`](../interfaces/SQLiteCompiledQuery.md)

## Example

```typescript
const compiled = compileSQLite({
  where: { type: 'func', name: 'gt', args: [
    { type: 'ref', path: ['price'] },
    { type: 'val', value: 100 }
  ]},
  orderBy: [{ expression: { type: 'ref', path: ['price'] }, compareOptions: { direction: 'desc', nulls: 'last' } }],
  limit: 50
})
// Result: { where: '"price" > ?', orderBy: '"price" DESC', limit: 50, params: [100] }
```
