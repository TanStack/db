import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { extract, build, inspectCatalog, check, repair, todo, sourceSchema, classifyKey } from './probe.mjs'

const source = await readFile(new URL('./fixtures/todo.ts', import.meta.url), 'utf8')
const pg = new PGlite()
await pg.exec(`CREATE TABLE todo(id text PRIMARY KEY, text text NOT NULL, completed boolean NOT NULL, created_at timestamp NOT NULL, user_id text NOT NULL);
INSERT INTO todo VALUES ('b','B',false,'2026-01-01','u'), ('a','A',false,'2026-01-01','u'), ('c','C',false,'2026-01-01','other');
CREATE TABLE tags(todo_id text, tag text); INSERT INTO tags VALUES ('a','x'),('a','y');`)
const evidence = { note: 'Individual rows are recorded only after their assertions pass; use the test runner exit code and test-output.txt for whole-suite status.', tests: [], versions: { node: process.version, postgres: (await pg.query('SELECT version()')).rows[0].version }, sourceSchema, classifyKey }
for (const name of ['drizzle-orm','@electric-sql/pglite','@babel/parser','pgsql-ast-parser']) {
  evidence.versions[name] = JSON.parse(await readFile(new URL(`./node_modules/${name}/package.json`, import.meta.url),'utf8')).version
}
function record(name, details) { evidence.tests.push({ name, status: 'pass', ...details }) }

test('direct handler facts trace to source and builder SQL', async () => {
  const facts = extract(source)
  assert.equal(facts.status, 'checked')
  assert.deepEqual(facts.fields.map(f => f.name), ['id','text','completed','createdAt'])
  assert.equal(source.slice(...facts.where.range), '.where(eq(todo.userId, user.id))'.slice(1))
  const exported = build(facts, 'u').toSQL()
  assert.equal(exported.sql, 'select "id", "text", "completed", "created_at" from "todo" where "todo"."user_id" = $1 order by "todo"."created_at" asc')
  assert.deepEqual(exported.params, ['u'])
  const rows = (await pg.query(exported.sql, exported.params)).rows
  assert.deepEqual(new Set(rows.map(r => r.id)), new Set(['a','b']))
  record('simple extraction', { facts, exported, rows })
})

test('non-total order repairs authored location and becomes total', async () => {
  const facts = extract(source)
  const catalog = await inspectCatalog(pg, 'todo')
  const before = check(facts, catalog)
  assert.equal(before.code, 'ENDPOINT_ORDER_NOT_TOTAL')
  assert.equal(before.location.line, 11)
  const fixed = repair(source, before)
  assert.match(fixed, /orderBy\(asc\(todo.createdAt\), asc\(todo.id\)\)/)
  const after = check(extract(fixed), catalog)
  assert.equal(after.status, 'supported')
  const exported = build(extract(fixed), 'u').toSQL()
  assert.deepEqual((await pg.query(exported.sql, exported.params)).rows.map(r => r.id), ['a','b'])
  assert.throws(() => repair(source + '\n', before), /stale/)
  record('order repair', { catalog, before, after, exported })
  await writeFile(new URL('./fixtures/todo.repaired.ts', import.meta.url), fixed)
})

test('join can duplicate the returned primary key and is not checked', async () => {
  const joined = source.replace('.from(todo)', '.from(todo).innerJoin(tags, eq(tags.todoId, todo.id))')
  assert.equal(extract(joined).reason, 'unsupported query chain: innerJoin')
  const rows = (await pg.query('SELECT todo.id FROM todo JOIN tags ON tags.todo_id = todo.id')).rows
  assert.deepEqual(rows.map(r => r.id), ['a','a'])
  record('join negative', { extraction: extract(joined), rows })
})

test('nullable unique and partial unique have counterexample rows', async () => {
  await pg.exec(`CREATE TABLE nullable_key(id text UNIQUE); INSERT INTO nullable_key VALUES (NULL),(NULL);
  CREATE TABLE partial_key(id text NOT NULL, active boolean); CREATE UNIQUE INDEX partial_id ON partial_key(id) WHERE active;
  INSERT INTO partial_key VALUES ('a',false),('a',false);`)
  for (const table of ['nullable_key','partial_key']) {
    const catalog = await inspectCatalog(pg, table)
    const result = classifyKey(catalog)
    assert.equal(result.reason, table === 'nullable_key' ? 'nullable key' : 'partial unique predicate not established')
    assert.equal(result.status, 'not checked')
    const rows = (await pg.query(`SELECT * FROM ${table}`)).rows
    assert.equal(rows.length, 2)
    record(table, { catalog, result, rows })
  }
})

test('omitting the selected key cannot certify a keyed result', async () => {
  const result = check(extract(source.replace('id: todo.id, ', '')), await inspectCatalog(pg,'todo'))
  assert.equal(result.reason, 'result does not select candidate key')
  record('missing selected key', { result })
})

test('source primary key cannot mask deployed schema drift', async () => {
  await pg.exec('ALTER TABLE todo DROP CONSTRAINT todo_pkey')
  const result = check(extract(source), await inspectCatalog(pg,'todo'))
  assert.equal(result.code, 'SCHEMA_MISMATCH')
  record('deployed schema mismatch', { result })
})

test('helpers branches transforms and shadowed operators remain explicit gaps', () => {
  const cases = [
    [source.replace('await db\n', 'await addFilters(db)\n'), 'unsupported query root'],
    [source.replace('const todos =', 'if (req.body.other) return res.json([])\n    const todos ='), 'unsupported handler statements or control flow'],
    [source.replace('res.json(todos)', 'res.json(todos.map(x => ({ id: x.id })))'), 'response transform or non-direct return'],
    [source.replace("from 'drizzle-orm'", "from './fake-operators'"), 'operator bindings not established'],
    [source.replace("'./fixture-bindings'", "'./untrusted-bindings'"), 'fixture bindings not established'],
    [source.replace('eq(todo.userId, user.id)', 'eq(todo.id, user.id)'), 'unsupported predicate'],
    [source.replace('asc(todo.createdAt)', 'desc(todo.createdAt)'), 'unsupported ordering'],
  ]
  for (const [fixture, reason] of cases) {
    assert.equal(extract(fixture).reason, reason)
    record(reason, { result: extract(fixture) })
  }
})

test('write machine-readable evidence', async () => {
  await writeFile(new URL('./results.json',import.meta.url), JSON.stringify(evidence,null,2)+'\n')
  await pg.close()
})
