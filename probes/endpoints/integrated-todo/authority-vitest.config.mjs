import { resolve } from 'node:path'
const repo = resolve(import.meta.dirname, '../../..'),
  local = resolve(import.meta.dirname, 'node_modules'),
  shared = '/Users/kylemathews/programs/tanstack-db/node_modules'
export default {
  root: repo,
  resolve: {
    alias: [
      {
        find: /^@tanstack\/pacer-lite\/(.*)$/,
        replacement: resolve(local, '@tanstack/pacer-lite/dist/$1'),
      },
      {
        find: '@tanstack/db',
        replacement: resolve(repo, 'packages/db/src/index.ts'),
      },
      {
        find: '@tanstack/db-ivm',
        replacement: resolve(repo, 'packages/db-ivm/src/index.ts'),
      },
      ...[
        '@tanstack/pacer-lite',
        'fractional-indexing',
        'sorted-btree',
        '@tanstack/query-core',
        'fast-check',
      ].map((name) => ({ find: name, replacement: resolve(local, name) })),
      ...['vitest', '@fast-check/vitest'].map((name) => ({
        find: name,
        replacement: resolve(shared, name),
      })),
    ],
  },
  test: {
    include: [
      'packages/db/tests/collection-subscription-lifecycle-publication.property.test.ts',
      'packages/db/tests/collection-subscription-lifecycle-history.property.test.ts',
      'packages/db/tests/query/includes-optimistic-oracle.property.test.ts',
      'packages/db/tests/query/includes-collection-oracle.property.test.ts',
      'packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts',
      'packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts',
      'packages/query-db-collection/tests/authority-permit.test.ts',
      'packages/db/tests/coordinated-publication.test.ts',
      'packages/db/tests/transactions.test.ts',
      'packages/db/tests/query/scheduler.test.ts',
      'packages/db/tests/query/includes-publication-oracle.test.ts',
      'packages/db/tests/collection-query-publication-boundaries.test.ts',
    ],
    environment: 'node',
    testTimeout: 30000,
  },
}
