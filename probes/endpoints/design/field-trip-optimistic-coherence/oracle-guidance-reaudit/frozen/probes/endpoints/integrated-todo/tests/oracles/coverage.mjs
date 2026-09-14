// Test-surface metadata, never input to expected rows or admission decisions.
// A passing campaign must not imply that these missing generator dimensions ran.
export const sqlCoverage = {
  schemaGeneration:
    'fixed Todo schema; tables and column types are not generated',
  columnTypes: ['text', 'boolean', 'timestamp without time zone'],
  constraints: ['text primary key', 'not-null columns'],
  queryShapes: [
    'one table with fixture scope predicate',
    'full-row projection',
    'optional equality on completed',
    'ascending createdAt/id order',
  ],
  mutationShapes: [
    'insert',
    'update',
    'delete',
    'multiple statements',
    'partial commit then handler error',
  ],
  demandMode: 'eager full results',
  notGenerated: [
    'related tables, foreign keys, cascades, triggers, defaults and generated columns',
    'nullable columns and other PostgreSQL type families',
    'joins, aggregates, distinct, windows, set operations, subqueries and CTEs',
    'arbitrary expressions, functions, casts, collation and ordering modes',
    'upsert, merge, data-modifying CTEs and explicit database transactions',
    'on-demand predicates, finite windows, continuation, refill and subset ownership',
    'external writers, RLS, schema changes, extensions and other PostgreSQL versions',
  ],
}
