/**
 * Frozen query-result receipts from published @op-engineering/op-sqlite
 * packages. These are provider data, not a second decoder implementation.
 *
 * Provenance:
 * - 15.2.7 npm tarball SHA-256
 *   c800ff4388c1e689fa01468efeaa4756e540ad05e3e3ef7e947af9b1d9c42765
 *   (`src/functions.ts`, `src/types.ts`, `node/dist/database.js`). This is the
 *   package's current supported peer major and the repository lockfile version.
 * - 18.2.1 npm tarball SHA-256
 *   54ee28fc481371b3015155f7542c56f34f6b207da0014d92761da6a47a7143a5
 *   (`src/functions.ts`, `src/functions.web.ts`, `src/types.ts`, and
 *   `node/dist/database.js`). These forward receipts preserve the Node/browser
 *   carrier coexistence that motivated the decoder review.
 *
 * Native `executeAsync` returns the bridge's object-row result. Node adds
 * `columnNames` and `metadata`; the browser adds `columnNames` and retains an
 * undefined `insertId` property. Values are representative SELECT receipts,
 * with distinct rows and field order so dropping, copying, or reordering a row
 * cannot pass an exact-row comparison.
 */

export type OpSQLiteProviderQueryFixture = {
  label: string
  providerVersion: `15.2.7` | `18.2.1`
  runtime: `react-native` | `node` | `browser`
  method: `execute` | `executeAsync`
  support: `current-peer` | `upstream-forward`
  result: unknown
  expectedRows: ReadonlyArray<Record<string, unknown>>
}

const expectedRows = [
  { title: `Higher score`, score: 41, id: `2` },
  { title: `Lower score`, score: 7, id: `1` },
] as const

const columnNames = [`title`, `score`, `id`] as const

const metadata = [
  { name: `title`, type: `TEXT`, index: 0 },
  { name: `score`, type: `INTEGER`, index: 1 },
  { name: `id`, type: `TEXT`, index: 2 },
] as const

export const opSQLiteProviderQueryFixtures = [
  {
    label: `15.2.7 React Native executeAsync`,
    providerVersion: `15.2.7`,
    runtime: `react-native`,
    method: `executeAsync`,
    support: `current-peer`,
    result: {
      rowsAffected: 0,
      rows: expectedRows,
    },
    expectedRows,
  },
  {
    label: `15.2.7 Node executeAsync`,
    providerVersion: `15.2.7`,
    runtime: `node`,
    method: `executeAsync`,
    support: `current-peer`,
    result: {
      rowsAffected: 0,
      rows: expectedRows,
      columnNames,
      metadata,
    },
    expectedRows,
  },
  {
    label: `18.2.1 React Native executeAsync`,
    providerVersion: `18.2.1`,
    runtime: `react-native`,
    method: `executeAsync`,
    support: `upstream-forward`,
    result: {
      rowsAffected: 0,
      rows: expectedRows,
    },
    expectedRows,
  },
  {
    label: `18.2.1 Node executeAsync`,
    providerVersion: `18.2.1`,
    runtime: `node`,
    method: `executeAsync`,
    support: `upstream-forward`,
    result: {
      rowsAffected: 0,
      rows: expectedRows,
      columnNames,
      metadata,
    },
    expectedRows,
  },
  {
    label: `18.2.1 browser execute`,
    providerVersion: `18.2.1`,
    runtime: `browser`,
    method: `execute`,
    support: `upstream-forward`,
    result: {
      rowsAffected: 0,
      insertId: undefined,
      rows: expectedRows,
      columnNames,
    },
    expectedRows,
  },
] as const satisfies ReadonlyArray<OpSQLiteProviderQueryFixture>
