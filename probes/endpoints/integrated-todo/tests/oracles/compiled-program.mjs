import { mutationInputSchema } from './compiled-input.mjs'
import { markers } from './program.mjs'
export const tableName = (i) =>
  i === 0
    ? '"alpha"."items"'
    : i === 1
      ? '"beta"."items"'
      : `"alpha"."items${i}"`
export function ddl(program) {
  return (
    `CREATE SCHEMA alpha;CREATE SCHEMA beta;` +
    (program.nativeDefaults
      ? "CREATE TYPE alpha.state AS ENUM ('ready','done');"
      : '') +
    Array.from(
      { length: program.count },
      (_, i) =>
        `CREATE TABLE ${tableName(i)}(id text PRIMARY KEY,value integer NOT NULL${program.nativeDefaults ? ",state alpha.state DEFAULT 'ready',payload jsonb,created_at timestamptz DEFAULT now(),token uuid DEFAULT gen_random_uuid(),enabled boolean DEFAULT false" : ''}${program.foreignKey && i === 1 ? `,parent_id text REFERENCES ${tableName(0)}(id) ON DELETE CASCADE` : ''});INSERT INTO ${tableName(i)}(id,value${program.foreignKey && i === 1 ? ',parent_id' : ''}) VALUES ('row',${i + 1}${program.foreignKey && i === 1 ? ",'row'" : ''});`,
    ).join('') +
    (program.expressionIndex && program.opaqueIndex
      ? "CREATE FUNCTION alpha.opaque_index(text) RETURNS text LANGUAGE SQL IMMUTABLE AS 'SELECT lower($1)';"
      : '') +
    (program.expressionIndex
      ? Array.from(
          { length: program.count },
          (_, i) =>
            `CREATE INDEX folded${i} ON ${tableName(i)} (${program.opaqueIndex ? 'alpha.opaque_index(id)' : 'lower(id)'});`,
        ).join('')
      : '') +
    (program.pgFunctions
      ? `CREATE FUNCTION alpha.read_value(integer) RETURNS integer LANGUAGE SQL STABLE AS $$SELECT $1 + coalesce((SELECT value FROM ${tableName(1)} WHERE id='row'),0)$$;
         CREATE FUNCTION alpha.write_value(integer) RETURNS integer LANGUAGE SQL VOLATILE AS $$UPDATE ${tableName(0)} SET value=$1 WHERE id='row';UPDATE ${tableName(1)} SET value=$1+1 WHERE id='row';SELECT $1$$;`
      : '') +
    (program.trigger
      ? `CREATE FUNCTION alpha.fanout() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE ${tableName(1)} SET value=NEW.value+1 WHERE id=NEW.id;RETURN NEW;END$$;CREATE TRIGGER fanout AFTER UPDATE ON ${tableName(0)} FOR EACH ROW EXECUTE FUNCTION alpha.fanout();`
      : '')
  )
}
export function databaseSource(program) {
  return `import {PGlite} from '@electric-sql/pglite';import {drizzle} from 'drizzle-orm/pglite';import {pgSchema,text,integer,pgEnum,jsonb,timestamp,uuid,boolean} from 'drizzle-orm/pg-core';
export const pg=new PGlite();export const trace=[],handlerInputs=[];export const db=drizzle(pg,{logger:{logQuery(sql){trace.push(sql)}}});
const alpha=pgSchema('alpha'),beta=pgSchema('beta');
${program.nativeDefaults ? "const state=pgEnum('state',['ready','done']);" : ''}
${Array.from({ length: program.count }, (_, i) => `export const t${i}=${i === 1 ? 'beta' : 'alpha'}.table('${i <= 1 ? 'items' : `items${i}`}',{id:text('id').primaryKey(),value:integer('value').notNull()${program.nativeDefaults ? ",state:state('state'),payload:jsonb('payload'),createdAt:timestamp('created_at').defaultNow(),token:uuid('token').defaultRandom(),enabled:boolean('enabled').default(false)" : ''}${program.foreignKey && i === 1 ? ',parentId:text("parent_id")' : ''}});`).join('\n')}
const ready=pg.exec(${JSON.stringify(ddl(program))});
export async function control(input){await ready;if(input.command==='clearTrace')trace.length=0;return {trace,handlerInputs,rows:await Promise.all([${Array.from({ length: program.count }, (_, i) => `pg.query('SELECT id,value FROM ${tableName(i)} ORDER BY id').then(r=>r.rows)`).join(',')}])}}
export async function evidence(){await ready;return {ready:true}}
`
}
export function endpointSource(program, browser = false) {
  let declarations = Array.from({ length: program.count }, (_, i) => {
    const table = program.peerQuery && i === program.count - 1 ? 0 : i
    const selection =
      program.queryStyle === 'full'
        ? ''
        : `{id:t${table}.id,value:t${table}.value}`
    const read = `await db.select(${selection}).from(t${table})`
    const result =
      program.queryBinding === 'local'
        ? `const rows=${read};return res.json(rows)`
        : `return res.json(${read})`
    return `
const q${i}=query({input:z.object({}),schema:z.object({id:z.string(),value:z.number()}),async handler(req,res){${result}}});
const update${i}=mutation({input:${mutationInputSchema(program, true)},onMutate({input}){if(q${i}.has('row'))q${i}.update('row',d=>{d.value=input.value})},async handler(req,res){await db.update(t${i}).set({value:req.body.value}).where(eq(t${i}.id,'row'));return res.json({marker:${JSON.stringify(markers.join('|'))}})}});
const delete${i}=mutation({input:${mutationInputSchema(program, false)},onMutate(){if(q${i}.has('row'))q${i}.delete('row')},async handler(req,res){await db.delete(t${i}).where(eq(t${i}.id,'row'));return res.json({ok:true})}});
const insert${i}=mutation({input:${mutationInputSchema(program, true)},onMutate({input}){if(!q${i}.has('row'))q${i}.insert({id:'row',value:input.value})},async handler(req,res){await db.insert(t${i}).values({id:'row',value:req.body.value});return res.json({ok:true})}});`
  }).join('\n')
  if (program.inlineSql) {
    declarations = declarations.replaceAll(
      'async handler(req,res){',
      'async handler(req,res){await authorize(req);',
    )
    for (let i = 0; i < program.count; i++) {
      for (const operation of [
        `db.update(t${i}).set({value:req.body.value}).where(eq(t${i}.id,'row'))`,
        `db.delete(t${i}).where(eq(t${i}.id,'row'))`,
        `db.insert(t${i}).values({id:'row',value:req.body.value})`,
      ])
        declarations = declarations.replace(
          operation,
          `db.transaction(async (tx) => { return ${operation.replace('db.', 'tx.')} })`,
        )
    }
  }
  if (program.helpers && !program.inlineSql) {
    for (let i = 0; i < program.count; i++) {
      declarations = declarations
        .replace(
          `db.select({id:t${i}.id,value:t${i}.value}).from(t${i})`,
          `service.read${i}()`,
        )
        .replace(
          `db.update(t${i}).set({value:req.body.value}).where(eq(t${i}.id,'row'))`,
          `service.update${i}(req.body)`,
        )
        .replace(
          `db.delete(t${i}).where(eq(t${i}.id,'row'))`,
          `service.delete${i}()`,
        )
        .replace(
          `db.insert(t${i}).values({id:'row',value:req.body.value})`,
          `service.insert${i}(req.body)`,
        )
    }
  }
  if (program.pgFunctions) {
    declarations = declarations
      .replace(
        'await db.select({id:t0.id,value:t0.value}).from(t0)',
        '(await db.execute(sql`SELECT id, alpha.read_value(value) AS value FROM "alpha"."items" ORDER BY id`)).rows',
      )
      .replace(
        "await db.update(t0).set({value:req.body.value}).where(eq(t0.id,'row'))",
        'await db.execute(sql`SELECT alpha.write_value(${req.body.value})`)',
      )
  }
  const result = `{collections:[${Array.from({ length: program.count }, (_, i) => `q${i}`).join(',')}],actions:{${Array.from({ length: program.count }, (_, i) => `update${i},delete${i},insert${i}`).join(',')}}}`
  const moduleLevel = browser && program.moduleLevel
  const binding = `const {query,mutation}=endpoints(dbClient);${moduleLevel ? declarations.replaceAll('\nconst ', '\nexport const ') : declarations}`
  return `${program.inlineSql ? "import {authorize} from './guard.server';" : ''}${program.helpers ? "import {service} from './service.server';" : ''}import {z} from 'zod';import {endpoints} from '${moduleLevel ? '@tanstack/db-endpoints' : './runtime'}';import {db,handlerInputs,${Array.from({ length: program.count }, (_, i) => `t${i}`).join(',')}} from './database.server';import {eq,sql} from 'drizzle-orm';
${moduleLevel ? "import {dbClient} from './db.client';" : ''}
${browser ? "import {useEffect} from 'react';import {useDbClient,useLiveQuery} from '@tanstack/react-db';" : ''}
${moduleLevel ? binding : ''}
export function ${browser ? 'TodoApp()' : 'App(dbClient)'} {${browser && !moduleLevel ? 'const dbClient=useDbClient();' : ''}${moduleLevel ? '' : binding}
${browser ? `const result=useLiveQuery(q0);useEffect(()=>{window.compiledOracle=${result}},[${Array.from({ length: program.count }, (_, i) => `q${i},update${i},delete${i},insert${i}`).join(',')}]);return <main>{result.data.map(row=><p key={row.id}>{row.value}</p>)}</main>` : `return ${result}`}}
`
}

export function serviceSource(program) {
  return `import {db,${Array.from({ length: program.count }, (_, i) => `t${i}`).join(',')}} from './database.server';import {eq} from 'drizzle-orm';
function repository(database){return {${Array.from(
    { length: program.count },
    (_, i) => `
async read${i}(){const rows=await database.select({id:t${i}.id,value:t${i}.value}).from(t${i});return rows.map(row=>({id:row.id,value:row.value}))},
async update${i}(input){return save${i}(database,input)},
async insert${i}(input){return database.insert(t${i}).values({id:'row',value:input.value})},
async delete${i}(){return database.delete(t${i}).where(eq(t${i}.id,'row'))}`,
  ).join(',')}}}
${Array.from({ length: program.count }, (_, i) => `async function save${i}(database,input){await database.update(t${i}).set({value:input.value}).where(eq(t${i}.id,'row'));${program.helperFanout && i === 0 ? 'await indirect(database,input)' : ''}}`).join('\n')}
async function indirect(database,input){await database.update(t1).set({value:input.value+1}).where(eq(t1.id,'row'))}\nexport const service=repository(db)`
}
