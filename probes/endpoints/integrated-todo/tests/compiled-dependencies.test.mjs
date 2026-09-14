import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import { PGlite } from '@electric-sql/pglite'
import { inspectSchema } from '../schema-snapshot.mjs'
import { transformBoundEndpoints } from '../bound-transform.mjs'
import { loadSchema } from '../compiled-dependencies.mjs'

import { source, databaseSource } from './fixtures/compiler-source.mjs'

test('compilation emits inspected read and write footprints, without catalog code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compiled-dependencies-'))
  const pg = new PGlite()
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/database.server.ts'), databaseSource)
    await pg.exec(
      'CREATE TABLE a(id text PRIMARY KEY,value integer);CREATE TABLE b(id text PRIMARY KEY,value integer)',
    )
    const snapshot = await inspectSchema(
      (sql) => pg.query(sql),
      'src/database.server.ts',
    )
    const compile = (code = source, schema = snapshot) =>
      transformBoundEndpoints(
        code,
        join(root, 'src/endpoint.tsx'),
        parse(code, { sourceType: 'module' }),
        { root, snapshot: schema },
      )
    const result = compile()
    assert.match(result.code, /scope:data.scope},\(\)=>\[/)
    assert.match(result.registryCode, /undefined,\[/)
    assert.doesNotMatch(
      result.code + result.registryCode,
      /pg_catalog|LOCK TABLE|inspectSchema/,
    )
    assert.match(compile(source, null).code, /scope:data.scope},\(\)=>null/)
    await pg.exec(
      `CREATE FUNCTION fanout() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE b SET value=NEW.value;RETURN NEW;END$$;CREATE TRIGGER fanout AFTER UPDATE ON a FOR EACH ROW EXECUTE FUNCTION fanout()`,
    )
    const changed = await inspectSchema(
      (sql) => pg.query(sql),
      'src/database.server.ts',
    )
    assert.match(compile(source, changed).code, /scope:data.scope},\(\)=>null/)
    assert.notEqual(
      compile(source, changed).definitions[0].version,
      result.definitions[0].version,
    )
  } finally {
    await pg.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('absent connection configuration removes stale compilation evidence', async () => {
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const root = await mkdtemp(join(tmpdir(), 'schema-build-'))
  try {
    await mkdir(join(root, '.endpoints'))
    await writeFile(join(root, '.endpoints/schema.json'), '{"stale":true}')
    const env = { ...process.env }
    delete env.DATABASE_URL
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../compile-schema.mjs', import.meta.url))],
      { cwd: root, env, encoding: 'utf8' },
    )
    assert.match(output, /dependencies remain unknown/)
    assert.equal(loadSchema(root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
