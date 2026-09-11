import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import { parse as parseSql } from 'pgsql-ast-parser'
import { asc, eq } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp, getTableConfig, QueryBuilder } from 'drizzle-orm/pg-core'

export const todo = pgTable('todo', {
  id: text('id').primaryKey(), text: text('text').notNull(),
  completed: boolean('completed').notNull(), createdAt: timestamp('created_at').notNull(), userId: text('user_id').notNull(),
})
export const sourceSchema = getTableConfig(todo).columns.map(c => ({ name: c.name, primary: c.primary, notNull: c.notNull }))
const hash = source => createHash('sha256').update(source).digest('hex')
const isId = (node, name) => node?.type === 'Identifier' && node.name === name
const member = (node, object, property) => node?.type === 'MemberExpression' && !node.computed && isId(node.object,object) && isId(node.property,property)
const span = node => ({ range: [node.start,node.end], location: { line: node.loc.start.line, column: node.loc.start.column + 1 } })
const gap = reason => ({ status: 'not checked', reason })

// This recognizer deliberately accepts only the disposable fixture grammar.
// It never imports application modules or executes a handler.
export function extract(source) {
  const ast = parse(source, { sourceType:'module', plugins:['typescript'] })
  const imports = ast.program.body.filter(n => n.type === 'ImportDeclaration')
  const operators = imports.find(n => n.source.value === 'drizzle-orm')
  if (!['eq','asc'].every(name => operators?.specifiers.some(s => s.type === 'ImportSpecifier' && isId(s.imported,name) && isId(s.local,name)))) return gap('operator bindings not established')
  const fixtureImports = imports.find(n => n.source.value === './fixture-bindings')
  if (imports.length !== 2 || !['db','todo','query','requireUser'].every(name => fixtureImports?.specifiers.some(s => s.type === 'ImportSpecifier' && isId(s.imported,name) && isId(s.local,name)))) return gap('fixture bindings not established')
  const declarations = ast.program.body.filter(n => n.type !== 'ImportDeclaration')
  if (declarations.length !== 1) return gap('unsupported top-level statements')
  const init = declarations[0].declaration?.declarations?.[0]?.init
  if (init?.type !== 'CallExpression' || !isId(init.callee,'query') || init.arguments.length !== 1) return gap('unsupported endpoint declaration')
  const properties = init.arguments[0].properties
  if (properties?.length !== 1) return gap('unsupported endpoint properties')
  const handler = properties[0]
  if (handler.type !== 'ObjectMethod' || !isId(handler.key,'handler') || !handler.async || handler.params.length !== 2 || !isId(handler.params[0],'req') || !isId(handler.params[1],'res')) return gap('unsupported handler signature')
  const statements = handler.body.body
  if (statements.length !== 3 || statements[0].type !== 'VariableDeclaration' || statements[1].type !== 'VariableDeclaration' || statements[2].type !== 'ReturnStatement') return gap('unsupported handler statements or control flow')
  const auth = statements[0].declarations[0]
  if (statements[0].kind !== 'const' || statements[0].declarations.length !== 1 || !isId(auth.id,'user') || auth.init?.type !== 'AwaitExpression' || !isId(auth.init.argument.callee,'requireUser') || auth.init.argument.arguments.length !== 1 || !isId(auth.init.argument.arguments[0],'req')) return gap('unsupported auth binding')
  const rows = statements[1].declarations[0]
  if (statements[1].kind !== 'const' || statements[1].declarations.length !== 1 || !isId(rows.id,'todos') || rows.init?.type !== 'AwaitExpression') return gap('unsupported query binding')
  const returned = statements[2].argument
  if (returned?.type !== 'CallExpression' || !member(returned.callee,'res','json') || returned.arguments.length !== 1 || !isId(returned.arguments[0],'todos')) return gap('response transform or non-direct return')
  const chain = []
  let cursor = rows.init.argument
  while (cursor?.type === 'CallExpression' && cursor.callee.type === 'MemberExpression' && !cursor.callee.computed) {
    chain.unshift({ name: cursor.callee.property.name, args: cursor.arguments, node: cursor, method: cursor.callee.property })
    cursor = cursor.callee.object
  }
  if (!isId(cursor,'db')) return gap('unsupported query root')
  const unexpected = chain.find(c => !['select','from','where','orderBy'].includes(c.name))
  if (unexpected) return gap(`unsupported query chain: ${unexpected.name}`)
  if (chain.map(c => c.name).join(',') !== 'select,from,where,orderBy') return gap('unsupported query chain shape')
  const [selection,from,where,order] = chain
  if (from.args.length !== 1 || !isId(from.args[0],'todo')) return gap('unsupported source table')
  if (selection.args.length !== 1 || selection.args[0].type !== 'ObjectExpression') return gap('unsupported projection')
  const fields = []
  for (const p of selection.args[0].properties) {
    if (p.type !== 'ObjectProperty' || p.computed || p.key.type !== 'Identifier' || !['id','text','completed','createdAt'].includes(p.key.name) || !member(p.value,'todo',p.key.name)) return gap('unsupported selected expression')
    fields.push({ name:p.key.name, ...span(p) })
  }
  if (new Set(fields.map(f => f.name)).size !== fields.length) return gap('duplicate projection')
  const predicate = where.args[0]
  if (where.args.length !== 1 || predicate?.type !== 'CallExpression' || !isId(predicate.callee,'eq') || predicate.arguments.length !== 2 || !member(predicate.arguments[0],'todo','userId') || !member(predicate.arguments[1],'user','id')) return gap('unsupported predicate')
  const orders = []
  for (const arg of order.args) {
    if (arg.type !== 'CallExpression' || !isId(arg.callee,'asc') || arg.arguments.length !== 1 || !['createdAt','id'].some(name => member(arg.arguments[0],'todo',name))) return gap('unsupported ordering')
    orders.push(arg.arguments[0].property.name)
  }
  if (!orders.length) return gap('missing order')
  return { status:'checked', sourceHash:hash(source), fields, where:{ column:'userId', parameter:'user.id', ...span({ ...where.node, start:where.method.start, loc:where.method.loc }) }, orders, order:{ ...span({ ...order.node,start:order.method.start,loc:order.method.loc }), insertAt:order.node.end-1 }, response:span(returned), assumptions:['fixture db/todo/query/requireUser bindings are trusted; auth semantics not checked','res.json serializes the untransformed row array; wire types not checked'] }
}

// Constructs a fresh query from recognized facts using trusted probe bindings.
// This is a bounded lowering, not execution/export of the original handler.
export function build(facts, userId) {
  if (facts.status !== 'checked') throw new Error('unchecked facts')
  return new QueryBuilder().select(Object.fromEntries(facts.fields.map(f => [f.name,todo[f.name]]))).from(todo).where(eq(todo.userId,userId)).orderBy(...facts.orders.map(name => asc(todo[name])))
}
export async function inspectCatalog(pg, table) {
  return (await pg.query(`SELECT c.relname AS table_name, a.attname AS column_name, a.attnotnull,
    i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts,
    pg_get_expr(i.indpred,i.indrelid) AS predicate, pg_get_expr(i.indexprs,i.indrelid) AS expressions,
    pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='id'
    LEFT JOIN pg_index i ON i.indrelid=c.oid AND a.attnum=ANY(i.indkey)
    WHERE n.nspname='public' AND c.relname=$1`,[table])).rows
}
export function classifyKey(catalog) {
  if (catalog.some(row => row.predicate !== null)) return gap('partial unique predicate not established')
  if (catalog.some(row => !row.attnotnull)) return gap('nullable key')
  const key = catalog.find(row => row.column_name === 'id' && row.attnotnull && row.indisunique && row.indisvalid && row.indisready && row.indnkeyatts === 1 && row.indnatts === 1 && row.predicate === null && row.expressions === null)
  return key ? { status:'supported', evidence:key.definition } : gap('no unconditional non-null single-column unique index')
}
export function check(facts, catalog) {
  if (facts.status !== 'checked') return facts
  // SQL parser is an independent grammar check; it supplies no key proof.
  const sqlAst = parseSql(build(facts,'symbolic-user-id').toSQL().sql)
  if (sqlAst.length !== 1 || sqlAst[0].type !== 'select') return gap('unsupported SQL')
  if (catalog.some(row => row.table_name !== 'todo')) return gap('catalog table does not match authored source; nullable/partial index facts cannot certify todo')
  const key = classifyKey(catalog)
  if (key.status !== 'supported') return { status:'not checked', code:'SCHEMA_MISMATCH', reason:key.reason }
  if (!facts.fields.some(f => f.name === 'id')) return gap('result does not select candidate key')
  if (facts.orders.includes('id')) return { status:'supported', key:'id', totalSqlOrder:true, evidence:key.evidence, visibleUiOrder:'not checked', stableAcrossUpdates:'not checked' }
  return { status:'violation',code:'ENDPOINT_ORDER_NOT_TOTAL', sourceHash:facts.sourceHash, location:facts.order.location, range:facts.order.range, evidence:key.evidence, edit:{ start:facts.order.insertAt,end:facts.order.insertAt,text:', asc(todo.id)' } }
}
export function repair(source, diagnostic) {
  if (hash(source) !== diagnostic.sourceHash) throw new Error('stale diagnostic: source revision changed')
  return source.slice(0,diagnostic.edit.start)+diagnostic.edit.text+source.slice(diagnostic.edit.end)
}
