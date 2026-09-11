import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expectedSchema as boundSchema } from './context.mjs'
import { extract, build, inspectCatalog } from '../probe.mjs'
const { checkSql, inspectSchema } = await import(process.env.PHASE2_BASELINE === '1' ? './red-baseline.mjs' : './checker.mjs')
const source = await readFile(new URL('./fixtures/todo.ts',import.meta.url),'utf8')
const fixedSource = source.replace('asc(todo.createdAt))','asc(todo.createdAt), asc(todo.id))')
const drizzleInput = text => ({ ...build(extract(text),'u').toSQL(), parameterTypes:['text'], drizzleSource:text })
const rawInput = {sql:'select id, text, completed, created_at from todo where user_id = $1 order by created_at asc, id asc;',params:['u'],parameterTypes:['text']}
const expectedSchema = [
 {name:'id',type:'text',notNull:true}, {name:'text',type:'text',notNull:true},
 {name:'completed',type:'boolean',notNull:true}, {name:'created_at',type:'timestamp without time zone',notNull:true}, {name:'user_id',type:'text',notNull:true},
]
assert.deepEqual(boundSchema, expectedSchema)
const db = new PGlite()
await db.exec(`CREATE TABLE todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL,user_id text NOT NULL);
INSERT INTO todo VALUES ('b','B',false,'2026-01-01','u'),('a','A',false,'2026-01-01','u');`)
const context = { indexes:await inspectCatalog(db,'todo'), schema:await inspectSchema(db), expectedSchema, schemaIdentity:'disposable-public-todo' }
const results = []
function record(name,result) {results.push({name,result})}

test('changed deployed selected-column SQL type cannot inherit the key-only pass', () => {
 const drift={...context,schema:context.schema.map(c=>c.name==='text'?{...c,type:'integer'}:c)}
 const result=checkSql(drizzleInput(fixedSource),drift)
 assert.equal(result.code,'SCHEMA_MISMATCH'); assert.equal(result.status,'not checked')
 record('selected-column type drift',result)
})
test('changed selected-column nullability cannot inherit the key-only pass', () => {
 const drift={...context,schema:context.schema.map(c=>c.name==='text'?{...c,notNull:false}:c)}
 assert.equal(checkSql(drizzleInput(fixedSource),drift).code,'SCHEMA_MISMATCH')
})
test('raw and Drizzle SQL share semantic output and execute equal rows', async () => {
 const a=checkSql(rawInput,context),b=checkSql(drizzleInput(fixedSource),context)
 assert.equal(a.status,'supported'); assert.deepEqual(a,b)
 const ar=(await db.query(rawInput.sql,rawInput.params)).rows
 const bi=drizzleInput(fixedSource),br=(await db.query(bi.sql,bi.params)).rows
 assert.deepEqual(ar,br); assert.deepEqual(ar.map(r=>r.id),['a','b'])
 record('same SQL checker', {a,b,rows:ar})
})
test('non-total raw and Drizzle SQL share order failure', () => {
 const a=checkSql({...rawInput,sql:rawInput.sql.replace(', id asc','')},context)
 const b=checkSql(drizzleInput(source),context)
 assert.equal(a.code,'ENDPOINT_ORDER_NOT_TOTAL'); assert.deepEqual(a,b)
 record('shared failure',a)
})
test('SQL layer rejects relational and output-shape gaps independently of adapters', () => {
 const negatives=[
  [rawInput.sql.replace('from todo','from todo join tags on tags.todo_id=todo.id'),'UNSUPPORTED_SQL'],
  [rawInput.sql.replace('select id,','select id as renamed,'),'UNSUPPORTED_SQL'],
  [rawInput.sql.replace(', id asc',', lower(id) asc'),'UNSUPPORTED_SQL'],
  [rawInput.sql.replace('user_id = $1','user_id = $1 or true'),'UNSUPPORTED_SQL'],
  [rawInput.sql.replace('select id,','select'),'RESULT_KEY_MISSING'],
 ]
 for (const [sql,code] of negatives) {const result=checkSql({...rawInput,sql},context);assert.equal(result.code,code);assert.equal(result.status,'not checked');record(code,result)}
})
test('parameter type/count and missing schema identity fail explicitly', () => {
 assert.equal(checkSql({...rawInput,parameterTypes:['integer']},context).code,'PARAMETER_CONTEXT_MISMATCH')
 assert.equal(checkSql({...rawInput,params:[]},context).code,'PARAMETER_CONTEXT_MISMATCH')
 assert.equal(checkSql(rawInput,{...context,schemaIdentity:undefined}).code,'SCHEMA_CONTEXT_MISSING')
})
test('actual PG selected-column type change invalidates both adapters', async () => {
 await db.exec('ALTER TABLE todo ALTER COLUMN text TYPE integer USING 1')
 const changed={...context,schema:await inspectSchema(db)}
 assert.equal(checkSql(rawInput,changed).code,'SCHEMA_MISMATCH')
 assert.equal(checkSql(drizzleInput(fixedSource),changed).code,'SCHEMA_MISMATCH')
 record('actual type drift',changed.schema)
})
test.after(async()=>{await writeFile(new URL(process.env.PHASE2_BASELINE === '1' ? './baseline-results.json' : './semantic-results.json',import.meta.url),JSON.stringify({node:process.version,results},null,2)+'\n');await db.close()})
