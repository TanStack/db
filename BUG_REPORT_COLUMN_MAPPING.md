# Bug Report: Column Mapping Not Applied in On-Demand/Progressive Sync Modes

## Summary

When using `columnMapper: snakeCamelMapper()` with Electric collections in `on-demand` or `progressive` sync modes, camelCase column names in queries are not converted back to snake_case when sending subset requests to the Electric server. This causes reference errors because PostgreSQL expects the original snake_case column names.

## Affected Versions
- `@tanstack/electric-db-collection`: All versions using on-demand sync
- `@electric-sql/client`: ^1.3.1+

## Bug 1: Column Mapper Not Applied to SQL Compilation

### Reproduction

```typescript
import { createCollection } from '@tanstack/db';
import { electricCollectionOptions, snakeCamelMapper } from '@tanstack/electric-db-collection';
import { CamelCasedPropertiesDeep } from 'type-fest';

// Database has snake_case columns: program_template_id, created_at, etc.
type Row = CamelCasedPropertiesDeep<Tables<'program_template_days'>>;

const collection = createCollection(
  electricCollectionOptions<Row>({
    id: 'program-template-days',
    getKey: (row) => row.id,
    shapeOptions: {
      columnMapper: snakeCamelMapper(),  // Converts snake_case -> camelCase
      url: `${electricUrl}/v1/shape`,
      params: { table: 'program_template_days' },
    },
    syncMode: 'on-demand',  // Bug appears in on-demand and progressive modes
  })
);

// This query fails because "programTemplateId" is sent to Postgres instead of "program_template_id"
const { data } = useLiveQuery(
  (q) => q
    .from({ d: collection })
    .where(({ d }) => eq(d.programTemplateId, selectedProgramId))  // ❌ Fails
    .select(({ d }) => d)
);
```

### Expected Behavior

The query should work because `columnMapper: snakeCamelMapper()` should:
1. Convert `program_template_id` → `programTemplateId` when receiving data (this works)
2. Convert `programTemplateId` → `program_template_id` when sending WHERE clauses (this is broken)

### Actual Behavior

The SQL compiler in TanStack DB generates:
```sql
WHERE "programTemplateId" = $1
```

But PostgreSQL expects:
```sql
WHERE "program_template_id" = $1
```

### Root Cause

The bug is in `/packages/electric-db-collection/src/sql-compiler.ts`:

```typescript
function quoteIdentifier(name: string): string {
  return `"${name}"`  // Uses property name directly without transformation
}

function compileBasicExpression(exp, params): string {
  switch (exp.type) {
    case `ref`:
      return quoteIdentifier(exp.path[0]!)  // ❌ No column mapping applied
    // ...
  }
}
```

The `compileSQL` function doesn't have access to the `columnMapper` from `shapeOptions`, so it cannot transform camelCase property names back to snake_case column names.

### Why Eager Mode Works

In `eager` mode, all data is synced without WHERE clause filtering, so no column names are sent to the server in subset queries. The column mapper only transforms incoming data, which works correctly.

### Technical Details

The Electric client supports two ways to receive subset params:
1. **Legacy string format** (`where`, `orderBy`): Pre-compiled SQL strings
2. **Structured expressions** (`whereExpr`, `orderByExpr`): IR that allows column mapping during compilation

TanStack DB only sends the legacy string format. The Electric client's `encodeWhereClause` function attempts to transform column names in the string, but quoted identifiers like `"programTemplateId"` may not be properly handled.

## Bug 2: Basic Collection Query Returns No Data in On-Demand Mode

### Reproduction

```typescript
// Collection configured with on-demand sync
const collection = createCollection(
  electricCollectionOptions<Row>({
    syncMode: 'on-demand',
    // ...
  })
);

// This returns no data
const { data: rows } = useLiveQuery(myElectricCollection);

// But this works:
const { data: rows } = useLiveQuery(
  (q) => q.from({ collection: myElectricCollection })
);
```

### Expected Behavior

Both queries should return data when using an on-demand collection.

### Actual Behavior

Passing the collection directly to `useLiveQuery` (without a query builder function) returns no data. Using the query builder function works.

### Note from Reporter

The user noted this may be intended behavior based on documentation review, but the inconsistency is confusing.

## Proposed Solutions

### Solution 1: Pass Column Mapper to SQL Compiler

Modify `createLoadSubsetDedupe` and `compileSQL` to accept a column mapper:

```typescript
// electric.ts
const loadSubsetDedupe = createLoadSubsetDedupe({
  stream,
  syncMode,
  // ...
  columnMapper: shapeOptions.columnMapper,  // Pass mapper
});

// sql-compiler.ts
export function compileSQL<T>(
  options: LoadSubsetOptions,
  columnMapper?: { encode?: (col: string) => string }
): SubsetParams {
  // Use columnMapper.encode when quoting identifiers
}
```

### Solution 2: Send Structured Expressions (whereExpr)

Modify TanStack DB to send structured IR expressions alongside or instead of compiled SQL strings:

```typescript
// Instead of just { where: '"programTemplateId" = $1' }
// Send:
{
  where: '"programTemplateId" = $1',
  whereExpr: {
    type: 'func',
    name: 'eq',
    args: [{ type: 'ref', path: ['programTemplateId'] }, { type: 'val', value: 'uuid-123' }]
  }
}
```

The Electric client can then apply column mapping to the structured expression.

### Solution 3: Store Original Column Names

Track the original database column names and use them during SQL compilation, rather than relying on TypeScript property names.

## Workarounds

### Workaround 1: Use snake_case in TypeScript Types

Don't transform types with `CamelCasedPropertiesDeep`. Use snake_case property names throughout:

```typescript
type Row = Tables<'program_template_days'>;  // Keep snake_case
```

### Workaround 2: Use Eager Sync Mode

If possible, use `syncMode: 'eager'` which syncs all data without WHERE clause filtering:

```typescript
syncMode: 'eager',  // Works but may not be suitable for large datasets
```

### Workaround 3: Client-Side Filtering

Sync all data and filter client-side (not recommended for large datasets):

```typescript
// Sync all, filter in JS
const { data } = useLiveQuery(collection);
const filtered = data.filter(d => d.programTemplateId === selectedProgramId);
```

## References

- [Electric PR #3662: Document camelCase vs snake_case naming conventions](https://github.com/electric-sql/electric/pull/3662)
- [Electric TypeScript Client - Column Mapper API](https://electric-sql.com/docs/api/clients/typescript)

## Files Involved

- `/packages/electric-db-collection/src/sql-compiler.ts` - SQL compilation (missing column mapping)
- `/packages/electric-db-collection/src/electric.ts` - Electric sync configuration
- `/packages/db/src/types.ts` - Type definitions for LoadSubsetOptions
