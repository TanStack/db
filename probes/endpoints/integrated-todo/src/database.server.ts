import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pgTable,text,boolean,timestamp,getTableConfig } from 'drizzle-orm/pg-core'
export const todo=pgTable('todo',{
 id:text('id').primaryKey(),text:text('text').notNull(),completed:boolean('completed').notNull(),
 createdAt:timestamp('created_at').notNull().defaultNow(),userId:text('user_id').notNull(),
})
// Keep one instance through dev module reloads. Tests can choose an isolated path.
const databasePath=process.env.TODO_DB_PATH ?? resolve(process.cwd(),'.data/todos')
if(databasePath!=='memory://')mkdirSync(dirname(databasePath),{recursive:true})
const databaseHost=globalThis as typeof globalThis & {endpointTodoDatabase?:PGlite}
export const pg=databaseHost.endpointTodoDatabase ??= new PGlite(databasePath)
export const sqlTrace:Array<{sql:string;params:unknown[]}>=[]
export const db=drizzle(pg,{logger:{logQuery(sql,params){sqlTrace.push({sql,params})}}})
const ready=pg.exec(`CREATE TABLE IF NOT EXISTS todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL DEFAULT now(),user_id text NOT NULL);`)
export const fixture={writeDelay:0,readDelay:0,rejectWrite:false,failNextRead:false,events:[] as string[]}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
export async function requireUser(req:{scope:string;kind?:string;endpointSourceHash?:string}) {
 await ready
 if(req.kind==='query')endpointSourceHash=req.endpointSourceHash
 if(!['alice','bob'].includes(req.scope))throw Error('Unknown disposable fixture user')
 fixture.events.push(`${req.kind}:${req.scope}`)
 if(req.kind==='query'){await delay(fixture.readDelay);if(fixture.failNextRead){fixture.failNextRead=false;throw Error('Fixture refetch unavailable')}}
 return {id:req.scope}
}
export async function beforeWrite() {
 fixture.events.push('write:start')
 await delay(fixture.writeDelay)
 if(fixture.rejectWrite)throw Error('Fixture write rejected')
 fixture.events.push('write:ready')
}
// Test control is server-only and exposed by a local probe endpoint below.
export async function control(input:{writeDelay?:number;readDelay?:number;rejectWrite?:boolean;failNextRead?:boolean;reset?:boolean}) {
 await ready
 if(input.reset){await pg.exec('DELETE FROM todo');fixture.events.length=0;sqlTrace.length=0}
 for(const key of ['writeDelay','readDelay','rejectWrite','failNextRead'] as const)if(input[key]!==undefined)Object.assign(fixture,{[key]:input[key]})
 return {rows:(await pg.query('SELECT * FROM todo ORDER BY id')).rows,events:fixture.events,sql:sqlTrace}
}

let endpointSourceHash:string|undefined
const instanceId=crypto.randomUUID()
export async function evidence(){
 await ready
 const schema=(await pg.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS "notNull" FROM pg_attribute a WHERE a.attrelid='todo'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows
 const indexes=(await pg.query(`SELECT c.relname AS table_name,a.attname AS column_name,a.attnotnull,i.indisunique,i.indisvalid,i.indisready,i.indnkeyatts,i.indnatts,pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_expr(i.indexprs,i.indrelid) AS expressions,pg_get_indexdef(i.indexrelid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='id' LEFT JOIN pg_index i ON i.indrelid=c.oid AND a.attnum=ANY(i.indkey) WHERE n.nspname='public' AND c.relname='todo'`)).rows
 return {instanceId,endpointSourceHash,capturedAt:new Date().toISOString(),databaseVersion:(await pg.query('SELECT version()')).rows[0],expectedSchema:getTableConfig(todo).columns.map(c=>({name:c.name,type:c.getSQLType()==='timestamp'?'timestamp without time zone':c.getSQLType(),notNull:c.notNull})),schema,indexes,query:sqlTrace.filter(q=>q.sql.startsWith('select')).at(-1)}
}
