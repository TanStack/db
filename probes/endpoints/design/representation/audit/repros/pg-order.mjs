import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { PGlite } from '../../../../integrated-todo/node_modules/@electric-sql/pglite/dist/index.js'
const pg = new PGlite()
try {
  const ids = ['\uE000', '\u{10000}']
  const { rows } = await pg.query('SELECT id FROM (VALUES ($1::text), ($2::text)) x(id) ORDER BY id', ids)
  assert.deepEqual(rows.map(row => row.id), ids)
  const report = { ids, pgOrder: rows.map(row => row.id), jsOrder: [...ids].sort(),
    databaseLocale: (await pg.query('SELECT datcollate, datctype FROM pg_database WHERE datname=current_database()')).rows }
  console.log(JSON.stringify(report, null, 2))
  writeFileSync(new URL('./pg-order-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
} finally { await pg.close() }
