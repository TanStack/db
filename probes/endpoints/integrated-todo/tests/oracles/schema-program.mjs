import assert from 'node:assert/strict'
import { databaseFixture, markers } from './program.mjs'

// SUT renderer: Drizzle declarations and calls. Never used by the reference.
export function renderSchemaProgram(program) {
  const names = program.tables.map((table) => table.name)
  const predicate = (node, table) =>
    node.args
      ? `${node.op}(${node.args.map((child) => predicate(child, table)).join(',')})`
      : `${node.op}(${table}.${node.column}${Object.hasOwn(node, 'value') ? ',' + JSON.stringify(node.value) : ''})`
  const columns = (table) => [
    'id',
    'text',
    'completed',
    'createdAt',
    ...table.columns.map((c) => c.name),
    ...(table.parent === null ? [] : ['parentId']),
  ]
  const declarations = program.queries.map((query, index) => {
    const table = program.tables[query.table],
      name = table.name
    const filter = query.predicate
      ? `and(eq(${name}.userId,user.id),${predicate(query.predicate, name)})`
      : `eq(${name}.userId,user.id)`
    return `const rows${index}=query({input:z.object({}),async handler(req,res){
      const user=await requireUser(req)
      const todos=await db.select({${columns(table)
        .map((c) => `${c}:${name}.${c}`)
        .join(
          ',',
        )}}).from(${name}).where(${filter}).orderBy(${program.orders[index].map((c) => `asc(${name}.${c})`).join(',')})
      // ${markers[1]}
      return res.json(todos)
    }})`
  })
  for (const [index, query] of program.queries.entries()) {
    const table = program.tables[query.table],
      name = table.name
    const next = program.tables[(query.table + 1) % program.tables.length].name
    const optimistic = {
      insert: `rows${index}.insert({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt,...input.extra})`,
      edit: `rows${index}.update(input.id,draft=>{draft.text=input.text;Object.assign(draft,input.extra)})`,
      complete: `rows${index}.update(input.id,draft=>{draft.completed=input.completed})`,
      delete: `rows${index}.delete(input.id)`,
    }
    const statement = {
      insert: `db.insert(${name}).values({id:input.id,text:input.text.trim(),completed:input.completed,createdAt:input.createdAt,userId:user.id,...input.extra})`,
      edit: `db.update(${name}).set({text:input.text.trim(),...input.extra}).where(and(eq(${name}.id,input.id),eq(${name}.userId,user.id)))`,
      complete: `db.update(${name}).set({completed:input.completed}).where(and(eq(${name}.id,input.id),eq(${name}.userId,user.id)))`,
      delete: `db.delete(${name}).where(and(eq(${name}.id,input.id),eq(${name}.userId,user.id)))`,
    }
    const types = {
      integer: 'z.number().int()',
      text: 'z.string()',
      boolean: 'z.boolean()',
    }
    const extra = table.columns.map(
      (c) => `${c.name}:${types[c.type]}${c.nullable ? '.nullable()' : ''}`,
    )
    if (table.parent !== null) extra.push('parentId:z.string().nullable()')
    for (const kind of Object.keys(statement))
      declarations.push(`const ${kind}${index}=mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),extra:z.object({${extra.join(',')}}),token:z.string(),cross:z.boolean(),otherId:z.string().nullable(),failAfterCommit:z.boolean()}),
      onMutate({input}){${optimistic[kind]}},
      async handler(req,res){const user=await requireUser(req);const input=req.body
        await beforeWrite(input.token,'${markers[0]}')
        await ${statement[kind]}
        if(input.cross&&input.otherId!==null)await db.update(${next}).set({text:input.text.trim(),completed:input.completed}).where(and(eq(${next}.id,input.otherId),eq(${next}.userId,user.id)))
        if(input.failAfterCommit)throw Error('oracle post-commit failure')
        return res.json({ok:true})
      }
    })`)
  }
  return `import {z} from 'zod'
import {endpoints} from './runtime'
import {db,${names.join(',')},requireUser,beforeWrite} from './database.server'
import {asc,eq,ne,and,or,gt,gte,lt,lte,isNull,isNotNull} from 'drizzle-orm'
import {useDbClient,useLiveQuery} from '@tanstack/react-db'
import {useOracleProbe} from './oracle-probe'
export function TodoApp(){const dbClient=useDbClient();const {query,mutation}=endpoints(dbClient)
${declarations.join('\n')}
${program.queries.map((_, i) => `const result${i}=useLiveQuery(rows${i})`).join('\n')}
useOracleProbe([${program.queries.map((_, i) => `rows${i}`).join(',')}],{${program.queries.flatMap((_, i) => ['insert', 'edit', 'complete', 'delete'].map((k) => k + i)).join(',')}})
return <main>${program.queries.map((_, i) => `<section data-query="${i}">{result${i}.data.map(row=><output key={row.id} data-row={row.id}>{row.text}</output>)}</section>`).join('')}</main>}`
}

export function renderSchemaDatabase(program) {
  const declarations = program.tables.map(
    (table) =>
      `export const ${table.name}=pgTable(${JSON.stringify(table.name)},{id:text('id').primaryKey(),text:text('text').notNull(),completed:boolean('completed').notNull(),createdAt:timestamp('created_at').notNull(),userId:text('user_id').notNull(),${table.columns.map((c) => `${c.name}:${c.type}('${c.name}')${c.nullable ? '' : '.notNull()'}`).join(',')}${table.parent === null ? '' : ",parentId:text('parent_id')"}})`,
  )
  const ddl = program.tables
    .map(
      (table) =>
        `CREATE TABLE "${table.name}"(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL,user_id text NOT NULL${table.columns.map((c) => `,"${c.name}" ${c.type}${c.nullable ? '' : ' NOT NULL'}`).join('')}${table.parent === null ? '' : `,parent_id text REFERENCES "${program.tables[table.parent].name}"(id) ON DELETE SET NULL`})`,
    )
    .join(';')
  const reset = program.tables
    .map((table) => {
      const fields = [
        'id',
        'text',
        'completed',
        'createdAt',
        'scope',
        ...table.columns.map((c) => c.name),
        ...(table.parent === null ? [] : ['parentId']),
      ]
      return `for(const row of input.rows.filter(row=>row.table===${JSON.stringify(table.name)}))await pg.query('INSERT INTO "${table.name}" VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})',${JSON.stringify(fields)}.map(field=>row[field]))`
    })
    .join('\n')
  const replacements = [
    [
      '{pgTable,text,boolean,timestamp}',
      '{pgTable,text,boolean,timestamp,integer}',
    ],
    [
      "export const todo=pgTable('todo',{id:text('id').primaryKey(),text:text('text').notNull(),completed:boolean('completed').notNull(),createdAt:timestamp('created_at').notNull(),userId:text('user_id').notNull()})",
      declarations.join('\n'),
    ],
    [
      "const ready=pg.exec('/* '+marker+' */ CREATE TABLE todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL,user_id text NOT NULL)')",
      `const ready=pg.exec('/* '+marker+' */ '+${JSON.stringify(ddl)})`,
    ],
    [
      "await pg.exec('DELETE FROM todo')",
      `await pg.exec(${JSON.stringify('TRUNCATE ' + program.tables.map((t) => '"' + t.name + '"').join(',') + ' CASCADE')})`,
    ],
    [
      "for(const row of input.rows??[])await pg.query('INSERT INTO todo VALUES ($1,$2,$3,$4,$5)',[row.id,row.text,row.completed,row.createdAt,row.scope])",
      reset,
    ],
    [
      "rows:(await pg.query('SELECT id,text,completed,created_at,user_id FROM todo ORDER BY id')).rows",
      'rows:[]',
    ],
  ]
  return replacements.reduce((source, [before, after]) => {
    assert.equal(
      source.split(before).length,
      2,
      'schema fixture replacement must be unique',
    )
    return source.replace(before, after)
  }, databaseFixture)
}
