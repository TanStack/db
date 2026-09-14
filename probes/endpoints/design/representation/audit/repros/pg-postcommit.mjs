import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { PGlite } from '../../../../integrated-todo/node_modules/@electric-sql/pglite/dist/index.js'
import { refreshAfterMutation } from '../../../../integrated-todo/src/refresh.server.ts'
const pg = new PGlite()
try {
  await pg.exec('CREATE TABLE todo(id text PRIMARY KEY)')
  let reads = 0
  let rejection
  try {
    await refreshAfterMutation([{ id: 'all' }], {
      all: async () => { reads++; return (await pg.query('SELECT * FROM todo')).rows },
    }, async () => {
      await pg.query('INSERT INTO todo VALUES ($1)', ['committed'])
      await pg.query('INSERT INTO todo VALUES ($1)', ['committed'])
    })
  } catch (error) { rejection = { message: error.message, code: error.code } }
  const persisted = (await pg.query('SELECT * FROM todo')).rows
  assert.equal(rejection.code, '23505')
  assert.deepEqual(persisted, [{ id: 'committed' }])
  assert.equal(reads, 0)
  const report = { rejection, persisted, refreshReads: reads }
  console.log(JSON.stringify(report, null, 2))
  writeFileSync(new URL('./pg-postcommit-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
} finally { await pg.close() }
