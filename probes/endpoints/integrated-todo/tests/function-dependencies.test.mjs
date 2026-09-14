import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import { PGlite } from '@electric-sql/pglite'
import { inspectSqlEffects as inspectSchema } from '../sql-effects.mjs'
import { transformBoundEndpoints } from '../bound-transform.mjs'
import { databaseSource } from './fixtures/compiler-source.mjs'

async function fixture(
  run,
  ddl = 'CREATE TABLE a(id text PRIMARY KEY,value integer);CREATE TABLE b(id text PRIMARY KEY,value integer)',
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'function-dependencies-')),
  )
  const pg = new PGlite()
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/database.server.ts'), databaseSource)
    await pg.exec(ddl)
    const snapshot = await inspectSchema(
      (sql) => pg.query(sql),
      'src/database.server.ts',
    )
    const compile = async (
      service,
      handler = 'return res.json(await change(req.body))',
      kind = 'mutation',
    ) => {
      await writeFile(join(root, 'src/service.server.ts'), service)
      await writeFile(
        join(root, 'src/barrel.server.ts'),
        "export {change} from './service.server'",
      )
      const code = `import {z} from 'zod';import {endpoints} from './runtime';import {change} from './barrel.server';export function App(client){const {query,mutation}=endpoints(client);const action=${kind}({input:z.object({${kind === 'query' ? '' : 'value:z.number().int()'}}),${kind === 'query' ? 'schema:z.object({id:z.string(),value:z.number()}),' : 'onMutate(){},'}async handler(req,res){${handler}}});return action}`
      return transformBoundEndpoints(
        code,
        join(root, 'src/endpoint.tsx'),
        parse(code, { sourceType: 'module' }),
        { root, snapshot },
      )
    }
    await run(compile, root)
  } finally {
    await pg.close()
    await rm(root, { recursive: true, force: true })
  }
}
const imports =
  "import {db,a,b} from './database.server';import {eq} from 'drizzle-orm';"
const writeDependencies = (result) =>
  JSON.parse(
    result.code.match(/scope:data.scope},\(\)=>(null|\[[^\n]*?\])\)/)[1],
  )

test('follows aliased reexports, local helpers and transaction parameters', async () =>
  fixture(async (compile, root) => {
    const result = await compile(
      imports +
        `async function save(tx,input){await tx.update(a).set({value:input.value}).where(eq(a.id,'row'));return {ok:true}}export async function change(input){return db.transaction(tx=>save(tx,input))}`,
    )
    assert.equal(writeDependencies(result)?.length, 1)
    assert.ok(result.watchFiles.includes(join(root, 'src/service.server.ts')))
    assert.ok(result.watchFiles.includes(join(root, 'src/barrel.server.ts')))
  }))

test('unions writes through branches and callbacks, including writes before failure', async () =>
  fixture(async (compile) => {
    const result = await compile(
      imports +
        `async function other(input){await db.delete(b).where(eq(b.id,'row'))}export async function change(input){await db.update(a).set({value:input.value});if(input.value>0){await other(input)}else{await Promise.all([other(input)])}throw new Error('failed')}`,
    )
    assert.equal(writeDependencies(result)?.length, 2)
  }))

test('follows returned service objects and query transforms', async () =>
  fixture(async (compile) => {
    const result = await compile(
      imports +
        `function repository(database){return {async read(){const rows=await database.select().from(a);return rows.map(row=>({id:row.id,value:row.value}))}}}export async function change(){const service=repository(db);return service.read()}`,
      undefined,
      'query',
    )
    assert.match(result.registryCode, /undefined,\[/)
  }))

test('unknown effects, recursive calls and raw SQL cannot yield partial proofs', async () =>
  fixture(async (compile) => {
    for (const service of [
      imports +
        `import {external} from 'opaque';export async function change(input){await db.update(a).set({value:input.value});await external()}`,
      imports +
        `export async function change(input){await db.update(a).set({value:input.value});return change(input)}`,
      imports +
        `export async function change(input){return db.execute('delete from b')}`,
      imports +
        `export async function change(input){return input.callback(db)}`,
    ])
      assert.equal(writeDependencies(await compile(service)), null)
  }))

test('helper source changes invalidate endpoint versions', async () =>
  fixture(async (compile) => {
    const first = await compile(
      imports +
        `export async function change(input){return db.update(a).set({value:input.value})}`,
    )
    const second = await compile(
      imports +
        `export async function change(input){return db.update(b).set({value:input.value})}`,
    )
    assert.notEqual(first.code, second.code)
    assert.notDeepEqual(writeDependencies(first), writeDependencies(second))
  }))

test('driver coercions cannot hide writes in SQL argument objects', async () =>
  fixture(async (compile) => {
    const result = await compile(
      imports +
        `export async function change(){const payload={toPostgres(){db.delete(b);return 1}};await db.update(a).set({value:payload});return {ok:true}}`,
    )
    assert.equal(writeDependencies(result), null)
  }))

test('function parameters preserve callbacks and namespace aliases', async () =>
  fixture(async (compile) => {
    const result = await compile(
      `import * as store from './database.server';async function perform(callback){return callback(store.db)}export async function change(input){return perform(async database=>{await database.update(store.a).set({value:input.value});return {ok:true}})}`,
    )
    assert.equal(writeDependencies(result)?.length, 1)
  }))

test('reassigned exported functions keep unknown effects', async () =>
  fixture(async (compile) => {
    const result = await compile(
      imports +
        `import {external} from 'opaque';export async function change(input){await db.update(a).set({value:input.value})}change=external`,
    )
    assert.equal(writeDependencies(result), null)
  }))

test('ordinary validation and transforms in service functions preserve write discovery', async () =>
  fixture(async (compile) => {
    const result = await compile(
      imports +
        `import {z} from 'zod';const schema=z.object({value:z.number()}).transform(input=>({value:input.value+1}));export async function change(raw){const input=schema.parse(raw);await db.update(a).set({value:input.value});return {ok:true}}`,
    )
    assert.equal(writeDependencies(result)?.length, 1)
  }))

test('validator callbacks with database effects remain unknown', async () =>
  fixture(async (compile) => {
    const result = await compile(
      imports +
        `import {z} from 'zod';const schema=z.object({value:z.number()}).transform(async input=>{await db.delete(b);return input});export async function change(raw){const input=schema.parse(raw);await db.update(a).set({value:input.value})}`,
    )
    assert.equal(writeDependencies(result), null)
  }))

// Builder reuse is a compiler aliasing boundary; check both assignment orders.
test('reused update builders retain every possible changed foreign-key column', async () => {
  await fixture(async (compile) => {
    for (const assignments of [
      ["{id:'next'}", '{value:input.value}'],
      ['{value:input.value}', "{id:'next'}"],
    ]) {
      const result = await compile(
        imports +
          `export async function change(input){const update=db.update(a);${assignments.map((value) => `await update.set(${value});`).join('')}return {ok:true}}`,
      )
      assert.equal(writeDependencies(result)?.length, 2)
    }
  }, 'CREATE TABLE a(id text PRIMARY KEY,value integer);CREATE TABLE b(id text PRIMARY KEY REFERENCES a(id) ON UPDATE CASCADE,value integer)')
})
