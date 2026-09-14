// Integration control for the pg adapter. Requires the disposable Kitchen fixture.
// Only catalog reads run here; no application modules are evaluated.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { loadSchema } from '../../compiled-dependencies.mjs'
const base = resolve(import.meta.dirname, '../..')
const root = await mkdtemp(join(tmpdir(), 'schema-postgres-'))
try {
  await mkdir(join(root, 'node_modules'))
  await symlink(
    join(base, 'node_modules/pg'),
    join(root, 'node_modules/pg'),
    'dir',
  )
  execFileSync(
    process.execPath,
    [join(base, 'compile-schema.mjs'), 'src/endpoints/database.server.ts'],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://postgres@127.0.0.1:55480/kitchen_endpoints',
      },
      stdio: 'pipe',
    },
  )
  const snapshot = loadSchema(root)
  assert.ok(snapshot, 'CLI snapshot validates')
  assert.deepEqual(snapshot.searchPath, ['public'])
  assert.ok(snapshot.tables.some((t) => t.name === 'recipe_comments'))
  assert.doesNotMatch(
    await readFile(join(root, '.endpoints/schema.json'), 'utf8'),
    /postgresql:\/\//,
  )
  console.log(
    JSON.stringify({
      ok: true,
      adapter: 'pg',
      relations: snapshot.tables.length,
      searchPath: snapshot.searchPath,
    }),
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
